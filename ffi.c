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
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <ffi.h>
#include <dlfcn.h>

#include <quickjs.h>
#include <cutils.h>

#include "js-helpers.h"
#include "compiler.h"
#include "c-string.h"

#define countof(x) (sizeof(x) / sizeof((x)[0]))

#include "js-callback.h"
#include "c-function.h"
#include "ffi-read.h"
#include "ffi-type.h"

/* debug() */
static JSValue
js_debug(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  return JS_NULL;
}

/* errno() */
static JSValue
js_errno(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  return JS_NewInt32(ctx, errno);
}

static JSValue js_dlopen_symbols(JSContext*, JSValueConst path_val, JSValueConst symbol_specs);

/* h = dlopen(name, flags)
 * { symbols, close() } = dlopen(name, symbolSpecs) -- bun-shaped overload,
 * picked when argv[1] is an object rather than a number (TODO.md Phase 2).
 */
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

  return js_newptr(ctx, res);
}

/* s = dlerror() */
static JSValue
js_dlerror(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  char* res = dlerror();

  return res ? JS_NewString(ctx, res) : JS_NULL;
}

/* n = dlclose(h) */
static JSValue
js_dlclose(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  void* ptr;

  if(js_toptr(ctx, &ptr, argv[0]))
    return JS_EXCEPTION;

  if(ptr == NULL)
    return JS_ThrowTypeError(ctx, "argument 1 must be a non-NULL pointer");

  return JS_NewInt32(ctx, dlclose(ptr));
}

/* p = dlsym(h, name) */
static JSValue
js_dlsym(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  void* ptr;
  const char* s;

  if(js_toptr(ctx, &ptr, argv[0]))
    return JS_EXCEPTION;

  if(!(s = JS_ToCString(ctx, argv[1])))
    return JS_EXCEPTION;

  void* res = dlsym(ptr, s);

  if(s)
    JS_FreeCString(ctx, s);

  if(res == NULL)
    return JS_NULL;

  return js_newptr(ctx, res);
}

/* n = dlopen(path, symbolSpecs).close() -- frees the dlopen() handle, passed
 * through js_function_cclosure()'s `opaque` (see js-helpers.c/.h) rather
 * than boxed into a func_data JSValue. */
static JSValue
js_dlopen_symbols_close(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[], int magic, JSValueConst data[]) {
  void* ptr;
  JSValue ret = JS_UNDEFINED;

  if(JS_IsUndefined(data[0]))
    return JS_NewInt32(ctx, 0);

  if(!js_toptr(ctx, &ptr, data[0]))
    ret = JS_NewInt32(ctx, dlclose(ptr));

  JS_FreeValue(ctx, data[0]);
  data[0] = JS_UNDEFINED;
  return ret;
}

/* symbols = { name: CFunction } for every key of symbol_specs, resolved with
 * resolve(handle, name), or dlsym() when `resolve` is NULL. With `linked`, a
 * spec's own `ptr` takes precedence over the lookup (linkSymbols()). */
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

    if(JS_IsException(spec)) {
      JS_FreeCString(ctx, name);
      goto fail;
    }

    if(linked && JS_IsObject(spec)) {
      JSValue ptr_val = JS_GetPropertyStr(ctx, spec, "ptr");
      int bad = !JS_IsUndefined(ptr_val) && (js_toptr(ctx, &fp, ptr_val) || !fp);

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

    JS_FreeCString(ctx, name);

    JSValue fn = js_cfunction_create(ctx, fp, spec);
    JS_FreeValue(ctx, spec);

    if(JS_IsException(fn))
      goto fail;

    /* JS_DefinePropertyValue() does not consume `prop` -- the shape's own
     * property table dups its own atom reference internally (see
     * add_shape_property() in quickjs.c) -- so this atom is still ours to
     * free right here, same as every other path out of this loop body. */
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

/* { symbols, close() } = dlopen(path, symbolSpecs) -- bun-shaped overload,
 * dispatched to from js_dlopen() when argv[1] is an object rather than a
 * flags number (TODO.md Phase 2). Opens the library, dlsym()s each key in
 * symbolSpecs, and wraps each as a CFunction (see doc/c-function.md) --
 * no name-keyed registry, no strcmp scan at call time.
 */
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

  if(!handle)
    return JS_ThrowTypeError(ctx, "dlopen: %s", dlerror());

  JSValue symbols = js_build_symbols(ctx, handle, symbol_specs, FALSE, "dlopen", NULL);

  if(JS_IsException(symbols)) {
    dlclose(handle);
    return symbols;
  }

  JSValue close_data = js_newptr(ctx, handle);
  JSValue close_fn = JS_NewCFunctionData(ctx, js_dlopen_symbols_close, 0, 0, 1, &close_data);
  JS_FreeValue(ctx, close_data);

  JSValue result = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, result, "symbols", symbols);
  JS_SetPropertyStr(ctx, result, "close", close_fn);
  return result;
}

#ifdef RTLD_DEFAULT
/* { symbols } = linkSymbols(symbolSpecs) -- like dlopen(path, symbolSpecs)
 * without opening a library: each spec is resolved from its own `ptr` if it
 * has one, else with dlsym(RTLD_DEFAULT, name). */
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

/* s = toString(BUF[, ofs, len] or PTR[, len]) */
static JSValue
js_tostring(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  ptr_len buf;

  if(!js_buf_arguments(ctx, &buf, argc, argv)) {
    ofs_len ol = {0, INT64_MAX};

    if(!js_offsetlength(ctx, &ol, argc, argv))
      return JS_ThrowTypeError(ctx, "argument 1 must be ArrayBuffer|Number|string");

    buf.ptr = (void*)(ptrdiff_t)ol.ofs;
    buf.len = argc == 1 || ol.len == INT64_MAX ? SIZE_MAX : ol.len;
  }

  const char* str = (const char*)buf.ptr;

  return str ? (buf.len != SIZE_MAX && buf.len < INT64_MAX) ? JS_NewStringLen(ctx, str, buf.len) : JS_NewString(ctx, str) : JS_NULL;
}

static void
free_objptr(JSRuntime* rt, void* opaque, void* ptr) {
  if(opaque) {
    JSValue buf = JS_MKPTR(JS_TAG_OBJECT, opaque);
    JS_FreeValueRT(rt, buf);
  }
}

/* b = toArrayBuffer(ArrayBuffer|string[, size[, copy]]) -- the pre-bun:ffi
 * form, still used for a buffer or string source (not valid in bun:ffi). */
static JSValue
js_toarraybuffer_legacy(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  ptr_len buf = {0, SIZE_MAX};
  void* opaque = 0;
  int copy = -1;

  if(argc > 0 && JS_IsBool(argv[argc - 1])) {
    copy = JS_ToBool(ctx, argv[argc - 1]);
    argc--;
  }

  if(!js_buf(ctx, &buf, argv[0])) {
    if(!copy)
      opaque = JS_VALUE_GET_PTR(JS_DupValue(ctx, argv[0]));
  } else if(copy == -1 && JS_IsString(argv[0])) {
    buf.ptr = (uint8_t*)JS_ToCStringLen(ctx, &buf.len, argv[0]);
    copy = TRUE;
  } else {
    if(js_ptr(ctx, &buf.ptr, argv[0]))
      return JS_EXCEPTION;
  }

  if(argc > 1) {
    int64_t len;

    if(js_index(ctx, &len, argv[1]))
      return JS_EXCEPTION;

    if(buf.len) {
      len = WRAP(len, buf.len);
      len = CLAMP(len, 0, buf.len);
    }

    buf.len = len;
  }

  return copy ? JS_NewArrayBufferCopy(ctx, buf.ptr, buf.len) : JS_NewArrayBuffer(ctx, buf.ptr, buf.len, &free_objptr, opaque, FALSE);
}

/* Deallocator of an ArrayBuffer made by toArrayBuffer(): the native
 * `void (*)(void *bytes, void *deallocatorContext)` the caller supplied. */
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

/* A deallocator or its context: a C address, as a Number or BigInt (null and
 * undefined mean none). Not a JSCallback: the deallocator runs while
 * QuickJS is finalizing the ArrayBuffer, where re-entering JS is unsafe. */
static int
js_cptr(JSContext* ctx, void** pptr, JSValueConst v, const char* what) {
  *pptr = NULL;

  if(JS_IsUndefined(v) || JS_IsNull(v))
    return 0;

  if(!JS_IsNumber(v) && !JS_IsBigInt(ctx, v)) {
    JS_ThrowTypeError(ctx, "toArrayBuffer: %s must be a C pointer (Number or BigInt)", what);
    return -1;
  }

  return js_toptr(ctx, pptr, v) ? -1 : 0;
}

/* b = toArrayBuffer(ptr[, byteOffset[, byteLength[, deallocatorContext], jsTypedArrayBytesDeallocator]])
 *
 * bun:ffi's form, for a pointer (Number, BigInt): an ArrayBuffer over the
 * memory itself (not a copy) from ptr + byteOffset, NUL-terminated when
 * byteLength is omitted. The memory is only freed if a deallocator, the
 * address of a native `void (*)(void *bytes, void *context)`, is given. */
static JSValue
js_toarraybuffer(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  uint8_t* p;
  int64_t off = 0, len = -1;
  bytes_deallocator* dealloc = NULL;
  void* context = NULL;

  if(argc < 1 || !(JS_IsNull(argv[0]) || JS_IsNumber(argv[0]) || JS_IsBigInt(ctx, argv[0])))
    return js_toarraybuffer_legacy(ctx, this_val, argc, argv);

  for(int i = 1; i < argc; i++)
    if(JS_IsBool(argv[i]))
      return JS_ThrowTypeError(ctx, "toArrayBuffer: argument %d must not be a boolean (the copy flag exists only for an ArrayBuffer or string source)", i + 1);

  if(js_toptr(ctx, &p, argv[0]))
    return JS_EXCEPTION;

  if(!p)
    return JS_ThrowTypeError(ctx, "toArrayBuffer: pointer is NULL");

  if(argc > 1 && !JS_IsUndefined(argv[1]) && JS_ToInt64(ctx, &off, argv[1]))
    return JS_EXCEPTION;

  p += off;

  if(argc > 2 && !JS_IsUndefined(argv[2]) && JS_ToInt64(ctx, &len, argv[2]))
    return JS_EXCEPTION;

  if(len < 0 && argc > 2 && !JS_IsUndefined(argv[2]))
    return JS_ThrowRangeError(ctx, "toArrayBuffer: byteLength must not be negative");

  /* (ptr, off, len, dealloc) or (ptr, off, len, context, dealloc) */
  if(argc > 4) {
    if(js_cptr(ctx, &context, argv[3], "deallocatorContext") || js_cptr(ctx, (void**)&dealloc, argv[4], "jsTypedArrayBytesDeallocator"))
      return JS_EXCEPTION;
  } else if(argc > 3) {
    if(js_cptr(ctx, (void**)&dealloc, argv[3], "jsTypedArrayBytesDeallocator"))
      return JS_EXCEPTION;
  }

  if(len < 0)
    len = strlen((const char*)p);

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

/* s = toPointer(ArrayBuffer[, offset])
 *
 * returns string 0xAABBCCDD which is the base of the ArrayBuffer
 * plus an optional offset. A negative offset can be used,
 * indicating an offset from the end of the buffer.
 */
static JSValue
js_topointer(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  uint8_t* ptr = NULL;

  if(js_ptr(ctx, &ptr, argv[0]))
    return JS_EXCEPTION;

  if(argc > 1) {
    int64_t ofs = 0;

    if(!js_index(ctx, &ofs, argv[1]))
      ptr += ofs;
  }

  char str[64];
  snprintf(str, sizeof(str), ptr ? "%p" : "0", ptr);
  return JS_NewString(ctx, str);
}

/* p = ptr(ArrayBuffer[, offset]) -- like toPointer(), but returns the address
 * as a Number/BigInt so it can be fed back into toBuffer()/CString, where a
 * string argument would be read as content rather than an address. */
static JSValue
js_ptr_address(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  uint8_t* ptr = NULL;

  if(argc < 1 || js_ptr(ctx, &ptr, argv[0]))
    return JS_ThrowTypeError(ctx, "argument 1 must be ArrayBuffer|Number");

  if(argc > 1) {
    int64_t ofs = 0;

    if(!js_index(ctx, &ofs, argv[1]))
      ptr += ofs;
  }

  return js_newptr(ctx, ptr);
}

/* p = JSContext() */
static JSValue
js_context(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  return js_newptr(ctx, ctx);
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
};

static int
js_init(JSContext* ctx, JSModuleDef* m) {
  /* bun:ffi's default export is an object holding every export, so `import ffi
   * from "ffi"` works: the named exports are the same values. */
  JSValue defaults = JS_NewObject(ctx);

  js_callback_init(ctx, m, defaults);
  js_cfunction_init(ctx, m, defaults);
  js_cstring_init(ctx, m, defaults);

  /* The list instantiates its entries non-enumerable; they are copied so that
   * `Object.keys(ffi)` lists them, as for the named exports. */
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
