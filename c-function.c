#include "c-function.h"
#include "ffi-type.h"
#include "js-helpers.h"
#include <cutils.h>
#include <ffi.h>

/* Storage for one argument, or the return value. Only one member is ever
 * live at a time; which one depends on the declared kind. Relies on the
 * same little-endian assumption already documented in ffi.c: writing/reading
 * a narrower member than the union's size still lands on the right bytes.
 */
union native_value {
  int64_t i64;
  uint64_t u64;
  float f32;
  double f64;
  void* ptr;
};

typedef struct CFunctionData {
  void* fp;
  ffi_cif cif;
  FFISignature sig;
} CFunctionData;

static JSClassID js_cfunction_class_id;

static void
js_to_native_arg(JSContext* ctx, int kind, union native_value* out, JSValueConst v) {
  int32_t i32 = 0;
  int64_t i64 = 0;
  double d = 0;

  switch(kind) {
    case K_BOOL: out->i64 = JS_ToBool(ctx, v) > 0; break;

    case K_I8:
    case K_I16:
    case K_I32:
      JS_ToInt32(ctx, &i32, v);
      out->i64 = i32;
      break;

    case K_U8:
    case K_U16:
    case K_U32:
    case K_I64:
    case K_I64_FAST:
    case K_U64:
    case K_U64_FAST:
      JS_ToInt64Ext(ctx, &i64, v);
      out->i64 = i64;
      break;

    case K_F32:
      JS_ToFloat64(ctx, &d, v);
      out->f32 = (float)d;
      break;
    case K_F64:
      JS_ToFloat64(ctx, &d, v);
      out->f64 = d;
      break;

    case K_POINTER: js_ptr(ctx, &out->ptr, v); break;

    default: out->i64 = 0; break;
  }
}

static void
js_cfunction_data_free(JSRuntime* rt, CFunctionData* cf) {
  ffi_sig_free(rt, &cf->sig);
  js_free_rt(rt, cf);
}

static CFunctionData*
js_cfunction_new(JSContext* ctx, void* fp, JSValueConst spec) {
  CFunctionData* cf;
  int abi = FFI_DEFAULT_ABI;

  if(!(cf = js_mallocz(ctx, sizeof(CFunctionData))))
    return NULL;

  if(ffi_sig_parse(ctx, &cf->sig, spec)) {
    js_free(ctx, cf);
    return NULL;
  }

  if(JS_IsObject(spec)) {
    JSValue abi_val = JS_GetPropertyStr(ctx, spec, "abi");

    if(!JS_IsUndefined(abi_val)) {
      const char* s = JS_ToCString(ctx, abi_val);
      abi = ffi_resolve_abi(s);
      JS_FreeCString(ctx, s);
    }

    JS_FreeValue(ctx, abi_val);
  }

  cf->fp = fp;

  if(ffi_prep_cif(&cf->cif, abi, cf->sig.argc, cf->sig.ret_type, cf->sig.arg_types) != FFI_OK) {
    JS_ThrowTypeError(ctx, "CFunction: ffi_prep_cif failed");
    js_cfunction_data_free(JS_GetRuntime(ctx), cf);
    return NULL;
  }

  return cf;
}

/* The CFunction instance's own .call handler (JSClassDef.call): the object
 * returned by CFunction() IS the callable, opaque-holding object -- no
 * separate JS_NewCFunctionData wrapper/holder pair needed (same pattern as
 * qjs-lws's JSCClosure, see js-utils.c:405-409).
 */
static JSValue
js_cfunction_invoke(JSContext* ctx, JSValueConst func_obj, JSValueConst this_val, int argc, JSValueConst argv[], int flags) {
  CFunctionData* cf = JS_GetOpaque(func_obj, js_cfunction_class_id);
  union native_value args_storage[FFI_MAX_ARGS];
  void* ptrs[FFI_MAX_ARGS];
  const char* cstrings[FFI_MAX_ARGS];
  int cstring_count = 0;
  union native_value rc;

  if(!cf)
    return JS_ThrowTypeError(ctx, "CFunction: invalid function");

  for(int i = 0; i < cf->sig.argc; i++) {
    JSValueConst v = i < argc ? argv[i] : JS_UNDEFINED;

    if(cf->sig.arg_kind[i] == K_CSTRING) {
      const char* s = JS_ToCString(ctx, v);
      cstrings[cstring_count++] = s;
      args_storage[i].ptr = (void*)s;
    } else {
      js_to_native_arg(ctx, cf->sig.arg_kind[i], &args_storage[i], v);
    }

    ptrs[i] = &args_storage[i];
  }

  ffi_call(&cf->cif, cf->fp, &rc, cf->sig.argc ? ptrs : NULL);

  JSValue ret = ffi_native_to_js(ctx, cf->sig.ret_kind, &rc);

  while(cstring_count > 0)
    JS_FreeCString(ctx, cstrings[--cstring_count]);

  return ret;
}

static void
js_cfunction_finalizer(JSRuntime* rt, JSValue val) {
  CFunctionData* cf;

  if((cf = JS_GetOpaque(val, js_cfunction_class_id)))
    js_cfunction_data_free(rt, cf);
}

static JSClassDef js_cfunction_class = {
    .class_name = "CFunction",
    .finalizer = js_cfunction_finalizer,
    .call = js_cfunction_invoke,
};

JSValue
js_cfunction_create(JSContext* ctx, void* fp, JSValueConst spec) {
  CFunctionData* cf;

  if(!(cf = js_cfunction_new(ctx, fp, spec)))
    return JS_EXCEPTION;

  JSValue func_proto = js_function_prototype(ctx);
  JSValue func_obj = JS_NewObjectProtoClass(ctx, func_proto, js_cfunction_class_id);
  JS_FreeValue(ctx, func_proto);

  if(JS_IsException(func_obj)) {
    js_cfunction_data_free(JS_GetRuntime(ctx), cf);
    return JS_EXCEPTION;
  }

  JS_SetOpaque(func_obj, cf);
  return func_obj;
}

/* fn = CFunction({ ptr, args, returns, abi }) */
static JSValue
js_cfunction_constructor(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  JSValueConst options = argc > 0 ? argv[0] : JS_UNDEFINED;

  if(!JS_IsObject(options))
    return JS_ThrowTypeError(ctx, "CFunction: argument 1 must be an object");

  JSValue ptr_val = JS_GetPropertyStr(ctx, options, "ptr");
  void* fp;

  if(js_toptr(ctx, &fp, ptr_val) || !fp) {
    JS_FreeValue(ctx, ptr_val);
    return JS_ThrowTypeError(ctx, "CFunction: options.ptr must be a valid function pointer");
  }

  JS_FreeValue(ctx, ptr_val);
  return js_cfunction_create(ctx, fp, options);
}

int
js_cfunction_init(JSContext* ctx, JSModuleDef* m) {
  JS_NewClassID(&js_cfunction_class_id);
  JS_NewClass(JS_GetRuntime(ctx), js_cfunction_class_id, &js_cfunction_class);

  if(m)
    JS_SetModuleExport(ctx, m, "CFunction", JS_NewCFunction(ctx, js_cfunction_constructor, "CFunction", 1));

  return 0;
}
