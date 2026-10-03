/**********************************************************************
 *                                                                    *
 * ffi.c                                                              *
 *                                                                    *
 * Copyright (c) 2020 Fred Weigel                                     *
 * Fred Weigel                                                        *
 *                                                                    *
 * Permission is hereby granted, free of charge, to any person        *
 * obtaining a copy of this software and associated documentation     *
 * files (the "Software"), to deal in the Software without            *
 * restriction, including without limitation the rights to use,       *
 * copy, modify, merge, publish, distribute, sublicense, and/or sell  *
 * copies of the Software, and to permit persons to whom the          *
 * Software is furnished to do so, subject to the following           *
 * conditions:                                                        *
 *                                                                    *
 * The above copyright notice and this permission notice shall be     *
 * included in all copies or substantial portions of the Software.    *
 *                                                                    *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,    *
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES    *
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND           *
 * NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT       *
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,       *
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING       *
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR      *
 * OTHER DEALINGS IN THE SOFTWARE.                                    *
 *                                                                    *
 ********************************************************************* */

#define _GNU_SOURCE
#include <assert.h>
#include <dlfcn.h>
#include <errno.h>
#include <ffi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <cutils.h>
#include <quickjs.h>

#include "c-string.h"
#include "compiler.h"
#include "js-helpers.h"

#define countof(x) (sizeof(x) / sizeof((x)[0]))

#include "c-function.h"
#include "ffi-read.h"
#include "ffi-write.h"
#include "ffi-type.h"
#include "js-callback.h"

/* debug(): a stub that returns null. */
static JSValue
js_debug(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  return JS_NULL;
}

/* errno(): the C errno, as a Number. */
static JSValue
js_errno(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  return JS_NewInt32(ctx, errno);
}

static JSValue js_dlopen_symbols(JSContext*, JSValueConst path_val, JSValueConst symbol_specs);

/* dlopen(path, flags) opens a library; dlopen(path, symbolSpecs) is
 * bun's form, picked when argument 2 is an object.
 *
 * ```js
 * dlopen("libm.so.6", RTLD_NOW);  // the handle, or null (see dlerror())
 * dlopen("libm.so.6", { cos: { args: ["f64"], returns: "f64" } });
 * ```
 *
 * the second form returns { symbols, close }, see js_dlopen_symbols(). */
static JSValue
js_dlopen(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  const char* s;
  uint32_t n;

  if(argc > 1 && JS_IsObject(argv[1]))
    return js_dlopen_symbols(ctx, argv[0], argv[1]);

  if(JS_IsNull(argv[0]))
    s = NULL;
  else if(!(s = JS_ToCString(ctx, argv[0])))
    return JS_EXCEPTION;

  if(JS_ToUint32(ctx, &n, argv[1]))
    return JS_EXCEPTION;

  void* res = dlopen(s, n);

  if(s)
    JS_FreeCString(ctx, s);

  if(res == NULL)
    return JS_NULL;

  return js_new_pointer(ctx, res);
}

/* dlerror(): the text of the last libdl error, or null. */
static JSValue
js_dlerror(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  char* res = dlerror();

  return res ? JS_NewString(ctx, res) : JS_NULL;
}

/* dlclose(handle): closes the library and returns dlclose()'s result,
 * 0 on success. throws TypeError for a bad or NULL handle. */
static JSValue
js_dlclose(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  void* ptr;

  if(js_to_address(ctx, &ptr, argv[0]))
    return JS_ThrowTypeError(ctx, "argument 1 must be BigInt | Number");

  if(ptr == NULL)
    return JS_ThrowTypeError(ctx, "argument 1 must be a non-NULL pointer");

  return JS_NewInt32(ctx, dlclose(ptr));
}

/* dlsym(handle, name): the symbol's address as a pointer, or null. */
static JSValue
js_dlsym(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  void* ptr;
  const char* s;

  if(js_to_address(ctx, &ptr, argv[0]))
    return JS_ThrowTypeError(ctx, "argument 1 must be BigInt | Number");

  if(!(s = JS_ToCString(ctx, argv[1])))
    return JS_EXCEPTION;

  void* res = dlsym(ptr, s);

  if(s)
    JS_FreeCString(ctx, s);

  if(res == NULL)
    return JS_NULL;

  return js_new_pointer(ctx, res);
}

/* close() of dlopen(path, symbolSpecs): closes the library and returns
 * dlclose()'s result. a second call returns 0 and does nothing.
 * the handle is in data[0]. */
static JSValue
js_dlopen_symbols_close(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[], int magic, JSValueConst data[]) {
  void* ptr;
  JSValue ret = JS_UNDEFINED;

  if(JS_IsUndefined(data[0]))
    return JS_NewInt32(ctx, 0);

  if(!js_to_address(ctx, &ptr, data[0]))
    ret = JS_NewInt32(ctx, dlclose(ptr));

  JS_FreeValue(ctx, data[0]);
  data[0] = JS_UNDEFINED;
  return ret;
}

/* builds the `symbols` object, documented at js_build_symbols() in
 * c-function.h. */
JSValue
js_build_symbols(JSContext* ctx, void* handle, JSValueConst symbol_specs, int linked, const char* who, js_symbol_resolver* resolve) {
  JSPropertyEnum* tab = NULL;
  uint32_t i, len = 0;

  if(JS_GetOwnPropertyNames(ctx, &tab, &len, symbol_specs, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY))
    return JS_EXCEPTION;

  JSValue symbols = JS_NewObject(ctx);

  for(i = 0; i < len; i++) {
    const char* name = JS_AtomToCString(ctx, tab[i].atom);
    void* fp = NULL;

    if(!name)
      goto fail;

    JSValue spec = JS_GetPropertyStr(ctx, symbol_specs, name);
    int data;

    if(JS_IsException(spec)) {
      JS_FreeCString(ctx, name);
      goto fail;
    }

    if((data = js_is_data_spec(ctx, spec, who, name)) < 0) {
      JS_FreeCString(ctx, name);
      JS_FreeValue(ctx, spec);
      goto fail;
    }

    if(linked && JS_IsObject(spec)) {
      JSValue ptr_val = JS_GetPropertyStr(ctx, spec, "ptr");
      int bad = !JS_IsUndefined(ptr_val) && (js_to_address(ctx, &fp, ptr_val) || !fp);

      JS_FreeValue(ctx, ptr_val);

      if(bad) {
        JS_ThrowTypeError(ctx, "%s: %s: ptr must be a valid function pointer", who, name);
        JS_FreeCString(ctx, name);
        JS_FreeValue(ctx, spec);
        goto fail;
      }
    }

    if(!fp && !(fp = resolve ? resolve(handle, name) : dlsym(handle, name))) {
      JS_ThrowTypeError(ctx, "%s: symbol not found: %s", who, name);
      JS_FreeCString(ctx, name);
      JS_FreeValue(ctx, spec);
      goto fail;
    }

    if(data) {
      int rc = js_variable_define(ctx, symbols, tab[i].atom, fp, spec, who, name);

      JS_FreeCString(ctx, name);
      JS_FreeValue(ctx, spec);

      if(rc)
        goto fail;

      JS_FreeAtom(ctx, tab[i].atom);
      continue;
    }

    JS_FreeCString(ctx, name);

    JSValue fn = js_cfunction_create(ctx, fp, spec);
    JS_FreeValue(ctx, spec);

    if(JS_IsException(fn))
      goto fail;

    /* takes `fn`, not the atom: the atom is freed here */
    JS_DefinePropertyValue(ctx, symbols, tab[i].atom, fn, JS_PROP_C_W_E);
    JS_FreeAtom(ctx, tab[i].atom);
  }

  js_free(ctx, tab);
  return symbols;

fail:
  for(; i < len; i++)
    JS_FreeAtom(ctx, tab[i].atom);

  js_free(ctx, tab);
  JS_FreeValue(ctx, symbols);
  return JS_EXCEPTION;
}

/* dlopen(path, symbolSpecs): opens the library with RTLD_NOW and returns
 * { symbols, close() }.
 *
 * ```js
 * const { symbols, close } = dlopen("libm.so.6", {
 *   cos: { args: ["f64"], returns: "f64" },
 * });
 * symbols.cos(0); // 1
 * close();
 * ```
 *
 * throws Error with code ERR_DLOPEN_FAILED if the library does not
 * open, TypeError for a symbol it does not have. */
static JSValue
js_dlopen_symbols(JSContext* ctx, JSValueConst path_val, JSValueConst symbol_specs) {
  const char* path = NULL;

  if(JS_IsNull(path_val))
    path = NULL;
  else if(!(path = JS_ToCString(ctx, path_val)))
    return JS_EXCEPTION;

  void* handle = dlopen(path, RTLD_NOW);

  if(path)
    JS_FreeCString(ctx, path);

  if(!handle) {
    /* an Error with code ERR_DLOPEN_FAILED, as bun throws (no TypeError) */
    const char* err = dlerror();
    char msg[1024];
    JSValue error = JS_NewError(ctx);

    snprintf(msg, sizeof(msg), "dlopen: %s", err ? err : "failed");
    JS_DefinePropertyValueStr(ctx, error, "message", JS_NewString(ctx, msg), JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
    JS_DefinePropertyValueStr(ctx, error, "code", JS_NewString(ctx, "ERR_DLOPEN_FAILED"), JS_PROP_C_W_E);
    return JS_Throw(ctx, error);
  }

  JSValue symbols = js_build_symbols(ctx, handle, symbol_specs, FALSE, "dlopen", NULL);

  if(JS_IsException(symbols)) {
    dlclose(handle);
    return symbols;
  }

  JSValue close_data = js_new_pointer(ctx, handle);
  JSValue close_fn = JS_NewCFunctionData(ctx, js_dlopen_symbols_close, 0, 0, 1, &close_data);
  JS_FreeValue(ctx, close_data);

  JSValue result = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, result, "symbols", symbols);
  JS_SetPropertyStr(ctx, result, "close", close_fn);
  js_callback_define_dispose(ctx, result);
  return result;
}

#ifdef RTLD_DEFAULT
/* linkSymbols(symbolSpecs): like dlopen(path, symbolSpecs), without a
 * library; returns { symbols }.
 *
 * ```js
 * linkSymbols({
 *   myabs: { ptr: p, args: ["i32"], returns: "i32" },
 *   strlen: { args: ["cstring"], returns: "u64" },
 * });
 * ```
 *
 * a spec's own `ptr` is used; without one the symbol is found with
 * dlsym(RTLD_DEFAULT, name), as for `strlen` above. */
static JSValue
js_linksymbols(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  if(argc < 1 || !JS_IsObject(argv[0]))
    return JS_ThrowTypeError(ctx, "linkSymbols: argument 1 must be an object");

  JSValue symbols = js_build_symbols(ctx, RTLD_DEFAULT, argv[0], TRUE, "linkSymbols", NULL);

  if(JS_IsException(symbols))
    return symbols;

  JSValue result = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, result, "symbols", symbols);
  return result;
}
#endif

/* toString(buffer[, byteOffset[, byteLength]]) or toString(ptr[, length]):
 * decodes bytes as a string.
 *
 * ```js
 * toString(ab, 2, 3);  // 3 bytes of a buffer, from byte 2
 * toString(ptr);       // up to the first NUL byte
 * toString(ptr, 5);    // 5 bytes
 * ```
 *
 * a NULL pointer gives null. */
static JSValue
js_tostring(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  ByteSpan buf;

  if(!js_parse_span_args(ctx, &buf, argc, argv)) {
    OffsetLength ol = {0, INT64_MAX};

    if(!js_parse_range(ctx, &ol, argc, argv))
      return JS_ThrowTypeError(ctx, "argument 1 must be ArrayBuffer|Number|string");

    buf.data = (void*)(ptrdiff_t)ol.ofs;
    buf.size = argc == 1 || ol.len == INT64_MAX ? SIZE_MAX : ol.len;
  }

  const char* str = (const char*)buf.data;

  return str ? (buf.size != SIZE_MAX && buf.size < INT64_MAX) ? JS_NewStringLen(ctx, str, buf.size) : JS_NewString(ctx, str) : JS_NULL;
}

static void
free_objptr(JSRuntime* rt, void* opaque, void* ptr) {
  if(opaque) {
    JSValue buf = JS_MKPTR(JS_TAG_OBJECT, opaque);
    JS_FreeValueRT(rt, buf);
  }
}

/* toArrayBuffer(buffer|string[, size[, copy]]): the form from before
 * bun:ffi, still used for a buffer or a string as the source. */
static JSValue
js_toarraybuffer_legacy(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  ByteSpan buf = {0, SIZE_MAX};
  void* opaque = 0;
  int copy = -1;

  if(argc > 0 && JS_IsBool(argv[argc - 1])) {
    copy = JS_ToBool(ctx, argv[argc - 1]);
    argc--;
  }

  if(!js_try_get_bytes(ctx, &buf, argv[0])) {
    if(!copy)
      opaque = JS_VALUE_GET_PTR(JS_DupValue(ctx, argv[0]));
  } else if(copy == -1 && JS_IsString(argv[0])) {
    buf.data = (uint8_t*)JS_ToCStringLen(ctx, &buf.size, argv[0]);
    copy = TRUE;
  } else if(JS_IsString(argv[0])) {
    /* the legacy form only: a string with a copy flag is an address, "0x..."
     * as toPointer() writes it */
    int64_t addr;

    if(JS_ToInt64Ext(ctx, &addr, argv[0]))
      return JS_EXCEPTION;

    buf.data = (uint8_t*)(intptr_t)addr;
  } else {
    if(js_to_pointer(ctx, (void**)&buf.data, argv[0]))
      return js_throw_pointer_error(ctx, argv[0]);
  }

  if(argc > 1) {
    int64_t len;

    if(js_to_index(ctx, &len, argv[1]))
      return JS_ThrowTypeError(ctx, "argument 2 must be BigInt | Number");

    if(buf.size) {
      len = WRAP(len, buf.size);
      len = CLAMP(len, 0, buf.size);
    }

    buf.size = len;
  }

  return copy ? JS_NewArrayBufferCopy(ctx, buf.data, buf.size) : JS_NewArrayBuffer(ctx, buf.data, buf.size, &free_objptr, opaque, FALSE);
}

/* the native deallocator of memory wrapped by toArrayBuffer(), supplied
 * by the caller: void (*)(void *bytes, void *deallocatorContext). */
typedef void bytes_deallocator(void* bytes, void* context);

typedef struct {
  bytes_deallocator* fn;
  void* context;
} bytes_free_data;

static void
free_bytes(JSRuntime* rt, void* opaque, void* ptr) {
  bytes_free_data* d = opaque;

  d->fn(ptr, d->context);
  free(d);
}

/* reads a deallocator or its context: a C address as a Number or BigInt;
 * null and undefined mean none. a JSCallback is refused: the deallocator
 * runs while QuickJS finalizes the ArrayBuffer, where JS must not run. */
static int
js_cptr(JSContext* ctx, void** pptr, JSValueConst v, const char* what) {
  *pptr = NULL;

  if(JS_IsUndefined(v) || JS_IsNull(v))
    return 0;

  if(!JS_IsNumber(v) && !JS_IsBigInt(ctx, v)) {
    JS_ThrowTypeError(ctx, "toArrayBuffer: %s must be a C pointer (Number or BigInt)", what);
    return -1;
  }

  if(js_to_address(ctx, pptr, v)) {
    JS_ThrowTypeError(ctx, "toArrayBuffer: %s must be a C pointer (Number or BigInt)", what);
    return -1;
  }

  return 0;
}

/* toArrayBuffer(ptr[, byteOffset[, byteLength[, deallocatorContext],
 * deallocator]]): bun:ffi's form, an ArrayBuffer over native memory.
 *
 * ```js
 * toArrayBuffer(ptr, 4, 16);  // 16 bytes at ptr + 4, not a copy
 * toArrayBuffer(ptr);         // the C string at ptr, up to its NUL
 * ```
 *
 * the memory is freed only if a deallocator is given: the address of a
 * native `void (*)(void *bytes, void *context)`. */
static JSValue
js_toarraybuffer(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  uint8_t* p;
  int64_t len;
  bytes_deallocator* dealloc = NULL;
  void* context = NULL;

  if(argc < 1 || !(JS_IsNull(argv[0]) || JS_IsNumber(argv[0]) || JS_IsBigInt(ctx, argv[0])))
    return js_toarraybuffer_legacy(ctx, this_val, argc, argv);

  for(int i = 1; i < argc; i++)
    if(JS_IsBool(argv[i]))
      return JS_ThrowTypeError(ctx,
                               "toArrayBuffer: argument %d must not be a boolean (the copy flag "
                               "exists only for an ArrayBuffer or string source)",
                               i + 1);

  if(js_to_address(ctx, (void**)&p, argv[0]))
    return JS_ThrowTypeError(ctx, "toArrayBuffer: argument 1 must be BigInt | Number");

  if(!p)
    return JS_ThrowTypeError(ctx, "toArrayBuffer: pointer is NULL");

  /* byteOffset and byteLength; undefined counts as omitted */
  OffsetLength range;
  int given = argc > 2 && !JS_IsUndefined(argv[2]) ? 2 : argc > 1 && !JS_IsUndefined(argv[1]) ? 1 : 0;
  int parsed = js_parse_range(ctx, &range, given, argv + 1);

  if(parsed < given)
    return JS_ThrowTypeError(ctx, "toArrayBuffer: byteOffset and byteLength must be BigInt | Number");

  if(parsed < 2) {
    /* no byteLength: the C string at ptr; a negative byteOffset counts
     * from its end, as in slice() */
    range = range_wrap(range, strlen((const char*)p));
    p += range.ofs;
    len = strlen((const char*)p);
  } else {
    if(range.len < 0)
      return JS_ThrowRangeError(ctx, "toArrayBuffer: byteLength must not be negative");

    p += range.ofs;
    len = range.len;
  }

  /* the last argument is the deallocator, the one before it its context */
  if(argc > 4) {
    if(js_cptr(ctx, &context, argv[3], "deallocatorContext") || js_cptr(ctx, (void**)&dealloc, argv[4], "jsTypedArrayBytesDeallocator"))
      return JS_EXCEPTION;
  } else if(argc > 3) {
    if(js_cptr(ctx, (void**)&dealloc, argv[3], "jsTypedArrayBytesDeallocator"))
      return JS_EXCEPTION;
  }

  if(!dealloc)
    return JS_NewArrayBuffer(ctx, p, len, NULL, NULL, FALSE);

  bytes_free_data* d = malloc(sizeof(*d));

  if(!d)
    return JS_ThrowOutOfMemory(ctx);

  d->fn = dealloc;
  d->context = context;

  JSValue ab = JS_NewArrayBuffer(ctx, p, len, free_bytes, d, FALSE);

  if(JS_IsException(ab))
    free(d);

  return ab;
}

/* toPointer(buffer[, offset]): the address of a buffer, as a string.
 *
 * ```js
 * toPointer(ab);     // "0x7f12a4001230"
 * toPointer(ab, 8);  // 8 bytes further
 * ```
 *
 * the offset is added to the address and may be negative.
 * ptr() gives a Number or BigInt instead. */
static JSValue
js_topointer(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  uint8_t* ptr = NULL;

  if(js_to_pointer(ctx, (void**)&ptr, argv[0]))
    return js_throw_pointer_error(ctx, argv[0]);

  if(argc > 1 && !JS_IsUndefined(argv[1])) {
    int64_t ofs = 0;

    if(js_to_index(ctx, &ofs, argv[1]))
      return JS_ThrowTypeError(ctx, "toPointer: argument 2 must be BigInt | Number");

    ptr += ofs;
  }

  char str[64];
  snprintf(str, sizeof(str), ptr ? "%p" : "0", ptr);
  return JS_NewString(ctx, str);
}

/* ptr(buffer[, offset]): the address of a buffer as a Number or BigInt,
 * which toBuffer() and CString() read as an address; a string would be
 * read as content.
 *
 * ```js
 * ptr(ab);     // 140123456789
 * ptr(ab, 8);  // 8 bytes further
 * ```
 */
static JSValue
js_ptr_address(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  uint8_t* ptr = NULL;

  if(argc < 1)
    return JS_ThrowTypeError(ctx, "ptr: argument 1 must be a pointer");

  if(js_to_pointer(ctx, (void**)&ptr, argv[0]))
    return js_throw_pointer_error(ctx, argv[0]);

  if(argc > 1 && !JS_IsUndefined(argv[1])) {
    int64_t ofs = 0;

    if(js_to_index(ctx, &ofs, argv[1]))
      return JS_ThrowTypeError(ctx, "ptr: argument 2 must be BigInt | Number");

    ptr += ofs;
  }

  return js_new_pointer(ctx, ptr);
}

/* JSContext(): the address of the running JSContext, as a pointer. */
static JSValue
js_context(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  return js_new_pointer(ctx, ctx);
}

static const JSCFunctionListEntry js_funcs[] = {
    JS_CFUNC_DEF("debug", 0, js_debug),
    JS_CFUNC_DEF("dlopen", 2, js_dlopen),
    JS_CFUNC_DEF("dlerror", 0, js_dlerror),
    JS_CFUNC_DEF("dlclose", 1, js_dlclose),
    JS_CFUNC_DEF("dlsym", 2, js_dlsym),
    JS_CFUNC_DEF("toString", 1, js_tostring),
    JS_CFUNC_DEF("toArrayBuffer", 1, js_toarraybuffer),
    JS_CFUNC_DEF("toPointer", 1, js_topointer),
    JS_CFUNC_DEF("ptr", 2, js_ptr_address),
#ifdef RTLD_DEFAULT
    JS_CFUNC_DEF("linkSymbols", 1, js_linksymbols),
#endif
    JS_CFUNC_DEF("toBuffer", 1, js_toarraybuffer),
    JS_CFUNC_DEF("errno", 0, js_errno),
    JS_CFUNC_DEF("JSContext", 0, js_context),
#ifdef CONFIG_TCC
    JS_CFUNC_DEF("cc", 1, js_compiler_cc),
#endif
#ifdef RTLD_LAZY
    JS_PROP_INT32_DEF("RTLD_LAZY", RTLD_LAZY, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_NOW
    JS_PROP_INT32_DEF("RTLD_NOW", RTLD_NOW, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_GLOBAL
    JS_PROP_INT32_DEF("RTLD_GLOBAL", RTLD_GLOBAL, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_LOCAL
    JS_PROP_INT32_DEF("RTLD_LOCAL", RTLD_LOCAL, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_NODELETE
    JS_PROP_INT32_DEF("RTLD_NODELETE", RTLD_NODELETE, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_NOLOAD
    JS_PROP_INT32_DEF("RTLD_NOLOAD", RTLD_NOLOAD, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_DEEPBIND
    JS_PROP_INT32_DEF("RTLD_DEEPBIND", RTLD_DEEPBIND, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_DEFAULT
    JS_PROP_INT64_DEF("RTLD_DEFAULT", (ptrdiff_t)RTLD_DEFAULT, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_NEXT
    JS_PROP_INT64_DEF("RTLD_NEXT", (ptrdiff_t)RTLD_NEXT, JS_PROP_CONFIGURABLE),
#endif
#ifdef _WIN32
    JS_PROP_STRING_DEF("suffix", "dll", JS_PROP_CONFIGURABLE),
#else
    JS_PROP_STRING_DEF("suffix", "so", JS_PROP_CONFIGURABLE),
#endif
    JS_PROP_INT32_DEF("pointerSize", sizeof(void*), JS_PROP_CONFIGURABLE),
    JS_OBJECT_DEF("FFIType", js_ffitype_funcs, FFI_TYPE_COUNT, JS_PROP_CONFIGURABLE),
    JS_OBJECT_DEF("read", js_ffiread_funcs, FFI_READ_COUNT, JS_PROP_CONFIGURABLE),
    JS_OBJECT_DEF("write", js_ffiwrite_funcs, FFI_WRITE_COUNT, JS_PROP_CONFIGURABLE),
};

static int
js_init(JSContext* ctx, JSModuleDef* m) {
  /* default export: an object holding every export, as in bun:ffi, so
   * `import ffi from "ffi"` works; the named exports are the same values */
  JSValue defaults = JS_NewObject(ctx);

  js_callback_init(ctx, m, defaults);
  js_cfunction_init(ctx, m, defaults);
  js_cstring_init(ctx, m, defaults);

  /* the list makes its entries non-enumerable; copying them lets
   * `Object.keys(ffi)` list them, as for the named exports */
  JSValue all = JS_NewObject(ctx);

  JS_SetPropertyFunctionList(ctx, all, js_funcs, countof(js_funcs));

  for(size_t i = 0; i < countof(js_funcs); i++) {
    JSValue v = JS_GetPropertyStr(ctx, all, js_funcs[i].name);

    JS_SetPropertyStr(ctx, defaults, js_funcs[i].name, JS_DupValue(ctx, v));
    JS_SetModuleExport(ctx, m, js_funcs[i].name, v);
  }

  JS_FreeValue(ctx, all);
  return JS_SetModuleExport(ctx, m, "default", defaults);
}

#ifdef JS_SHARED_LIBRARY
#define JS_INIT_MODULE js_init_module
#else
#define JS_INIT_MODULE js_init_module_ffi
#endif

JSModuleDef*
JS_INIT_MODULE(JSContext* ctx, const char* module_name) {
  JSModuleDef* m;

  if(!(m = JS_NewCModule(ctx, module_name, js_init)))
    return NULL;

  JS_AddModuleExport(ctx, m, "JSCallback");
  JS_AddModuleExport(ctx, m, "CFunction");
  JS_AddModuleExport(ctx, m, "CString");
  JS_AddModuleExport(ctx, m, "default");
  JS_AddModuleExportList(ctx, m, js_funcs, countof(js_funcs));
  return m;
}

/* ce: .mc; */
