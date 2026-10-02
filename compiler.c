#include "compiler.h"

#ifdef CONFIG_TCC

#include <cutils.h>
#include <libtcc.h>
#include <stdio.h>
#include <string.h>

#include "c-function.h"
#include "js-helpers.h"

/* the first lines of libtcc's diagnostics, reported in the thrown error. */
typedef struct {
  char text[1024];
  size_t len;
} cc_errors;

static void
cc_error_func(void* opaque, const char* msg) {
  cc_errors* e = opaque;
  int n = snprintf(e->text + e->len, sizeof(e->text) - e->len, "%s%s", e->len ? "\n" : "", msg);

  if(n > 0)
    e->len = MIN((size_t)n + e->len, sizeof(e->text) - 1);
}

static void*
cc_resolve(void* handle, const char* name) {
  return tcc_get_symbol(handle, name);
}

/* applies `fn(s, str)` to each string in `options[key]`, which is a
 * string or an array of strings; absent does nothing.
 *
 *   returns  0, or -1 with an exception pending: TypeError for another
 *            type, InternalError if `fn` fails
 */
static int
cc_each_string(JSContext* ctx, JSValueConst options, const char* key, TCCState* s, int (*fn)(TCCState*, const char*)) {
  JSValue arr = JS_GetPropertyStr(ctx, options, key);
  int64_t i, len;
  int ret = 0;

  if(JS_IsException(arr))
    return -1;
  if(JS_IsUndefined(arr))
    return 0;

  if(JS_IsString(arr)) {
    const char* str = JS_ToCString(ctx, arr);

    if(!str)
      ret = -1;
    else if(fn(s, str) < 0) {
      JS_ThrowInternalError(ctx, "cc: %s: cannot add '%s'", key, str);
      ret = -1;
    }
    if(str)
      JS_FreeCString(ctx, str);
    JS_FreeValue(ctx, arr);
    return ret;
  }

  if(js_try_get_length(ctx, arr, &len)) {
    JS_ThrowTypeError(ctx, "cc: %s must be a string or an array of strings", key);
    ret = -1;
  }

  for(i = 0; ret == 0 && i < len; i++) {
    JSValue item = JS_GetPropertyUint32(ctx, arr, i);
    const char* str = JS_IsException(item) ? NULL : JS_ToCString(ctx, item);

    JS_FreeValue(ctx, item);

    if(!str)
      ret = -1;
    else if(fn(s, str) < 0) {
      JS_ThrowInternalError(ctx, "cc: %s: cannot add '%s'", key, str);
      ret = -1;
    }
    if(str)
      JS_FreeCString(ctx, str);
  }

  JS_FreeValue(ctx, arr);
  return ret;
}

static int
cc_define_all(JSContext* ctx, JSValueConst options, TCCState* s) {
  JSValue defs = JS_GetPropertyStr(ctx, options, "define");
  JSPropertyEnum* tab = NULL;
  uint32_t i, len = 0;
  int ret = 0;

  if(JS_IsException(defs))
    return -1;
  if(JS_IsUndefined(defs))
    return 0;

  if(!JS_IsObject(defs)) {
    JS_FreeValue(ctx, defs);
    JS_ThrowTypeError(ctx, "cc: define must be an object");
    return -1;
  }

  if(JS_GetOwnPropertyNames(ctx, &tab, &len, defs, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY)) {
    JS_FreeValue(ctx, defs);
    return -1;
  }

  for(i = 0; ret == 0 && i < len; i++) {
    const char* name = JS_AtomToCString(ctx, tab[i].atom);
    JSValue val = JS_GetProperty(ctx, defs, tab[i].atom);
    const char* str = JS_IsException(val) ? NULL : JS_ToCString(ctx, val);

    if(name && str)
      tcc_define_symbol(s, name, str);
    else
      ret = -1;

    if(str)
      JS_FreeCString(ctx, str);
    if(name)
      JS_FreeCString(ctx, name);
    JS_FreeValue(ctx, val);
  }

  for(i = 0; i < len; i++)
    JS_FreeAtom(ctx, tab[i].atom);
  js_free(ctx, tab);
  JS_FreeValue(ctx, defs);
  return ret;
}

static void
cc_free_source(JSContext* ctx, const char* path, char* text) {
  if(path)
    JS_FreeCString(ctx, path);
  if(text)
    js_free(ctx, text);
}

JSValue
js_compiler_cc(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  cc_errors errors = {{0}, 0};
  const char* path = NULL;
  char* text = NULL;
  TCCState* s;
  JSValue src, symbols;
  int rc;

  if(argc < 1 || !JS_IsObject(argv[0]))
    return JS_ThrowTypeError(ctx,
                             "cc: expected an options object { source, "
                             "symbols [, library, flags, define] }");

  JSValueConst options = argv[0];

  symbols = JS_GetPropertyStr(ctx, options, "symbols");
  if(!JS_IsObject(symbols)) {
    if(!JS_IsException(symbols))
      JS_ThrowTypeError(ctx, "cc: symbols must be an object");
    JS_FreeValue(ctx, symbols);
    return JS_EXCEPTION;
  }

  /* source: a file path (string), else a buffer holding the C text */
  src = JS_GetPropertyStr(ctx, options, "source");

  if(JS_IsString(src)) {
    path = JS_ToCString(ctx, src);
  } else if(!JS_IsException(src)) {
    ByteSpan view;

    if(js_try_get_bytes(ctx, &view, src) == 0) {
      text = js_malloc(ctx, view.size + 1);
      if(text) {
        memcpy(text, view.data, view.size);
        text[view.size] = 0;
      }
    } else {
      JS_ThrowTypeError(ctx,
                        "cc: source must be a file name or an "
                        "ArrayBuffer/TypedArray/DataView of C code");
    }
  }
  JS_FreeValue(ctx, src);

  if(!path && !text) {
    JS_FreeValue(ctx, symbols);
    return JS_EXCEPTION;
  }

  if(!(s = tcc_new())) {
    cc_free_source(ctx, path, text);
    JS_FreeValue(ctx, symbols);
    return JS_ThrowInternalError(ctx, "cc: tcc_new() failed");
  }

  tcc_set_error_func(s, &errors, cc_error_func);
#ifdef CONFIG_TCC_LIB_DIR
  tcc_set_lib_path(s, CONFIG_TCC_LIB_DIR);
#endif
  tcc_set_output_type(s, TCC_OUTPUT_MEMORY);

  if(cc_each_string(ctx, options, "flags", s, tcc_set_options) || cc_each_string(ctx, options, "include", s, tcc_add_include_path) || cc_define_all(ctx, options, s) ||
     cc_each_string(ctx, options, "library", s, tcc_add_library))
    goto fail;

  rc = path ? tcc_add_file(s, path) : tcc_compile_string(s, text);
  cc_free_source(ctx, path, text);
  path = NULL;
  text = NULL;

  if(rc < 0 || tcc_relocate(s) < 0) {
    JS_ThrowInternalError(ctx, "cc: %s", errors.len ? errors.text : "compilation failed");
    goto fail;
  }

  /* no close(), as in bun: the TCCState, so the compiled code, lives on */
  JSValue fns = js_build_symbols(ctx, s, symbols, FALSE, "cc", cc_resolve);

  JS_FreeValue(ctx, symbols);

  if(JS_IsException(fns)) {
    tcc_delete(s);
    return fns;
  }

  JSValue ret = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, ret, "symbols", fns);
  return ret;

fail:
  cc_free_source(ctx, path, text);
  JS_FreeValue(ctx, symbols);
  tcc_delete(s);
  return JS_EXCEPTION;
}

#endif /* defined(CONFIG_TCC) */
