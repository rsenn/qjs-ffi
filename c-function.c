#include "c-function.h"
#include "js-helpers.h"
#include <cutils.h>
#include <ffi.h>
#include <string.h>

#define CFUNCTION_MAX_ARGS 32

/* Marshaling kinds, matching bun:ffi's FFIType vocabulary (see the
 * `FFIType` export in ffi-type.c and doc/c-function.md). Kept local to this
 * file, same as js-callback.c: c-function.c doesn't depend on ffi.c's
 * mutable, string-keyed type registry.
 */
enum {
  K_VOID = 0,
  K_BOOL,
  K_I8,
  K_U8,
  K_I16,
  K_U16,
  K_I32,
  K_U32,
  K_I64,
  K_U64,
  K_I64_FAST,
  K_U64_FAST,
  K_F32,
  K_F64,
  K_POINTER,
  K_CSTRING,
};

static const struct {
  const char* name;
  ffi_type* type;
  int kind;
} type_table[] = {
    {"void", &ffi_type_void, K_VOID},
    {"bool", &ffi_type_uint8, K_BOOL},
    {"i8", &ffi_type_sint8, K_I8},
    {"u8", &ffi_type_uint8, K_U8},
    {"i16", &ffi_type_sint16, K_I16},
    {"u16", &ffi_type_uint16, K_U16},
    {"i32", &ffi_type_sint32, K_I32},
    {"u32", &ffi_type_uint32, K_U32},
    {"i64", &ffi_type_sint64, K_I64},
    {"u64", &ffi_type_uint64, K_U64},
    {"i64_fast", &ffi_type_sint64, K_I64_FAST},
    {"u64_fast", &ffi_type_uint64, K_U64_FAST},
    {"f32", &ffi_type_float, K_F32},
    {"f64", &ffi_type_double, K_F64},
    {"pointer", &ffi_type_pointer, K_POINTER},
    {"ptr", &ffi_type_pointer, K_POINTER},
    {"function", &ffi_type_pointer, K_POINTER},
    {"cstring", &ffi_type_pointer, K_CSTRING},
};

static ffi_type*
resolve_type(const char* name, int* kind) {
  size_t i;

  if(name)
    for(i = 0; i < countof(type_table); i++)
      if(!strcmp(type_table[i].name, name)) {
        *kind = type_table[i].kind;
        return type_table[i].type;
      }

  return NULL;
}

static int
resolve_abi(const char* name) {
  if(name == NULL || !strcmp(name, "default"))
    return FFI_DEFAULT_ABI;
#ifdef FFI_SYSV
  if(!strcmp(name, "sysv"))
    return FFI_SYSV;
#endif
#ifdef FFI_UNIX64
  if(!strcmp(name, "unix64"))
    return FFI_UNIX64;
#endif
#ifdef FFI_STDCALL
  if(!strcmp(name, "stdcall"))
    return FFI_STDCALL;
#endif
#ifdef FFI_WIN64
  if(!strcmp(name, "win64"))
    return FFI_WIN64;
#endif
  return FFI_DEFAULT_ABI;
}

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
  int argc;
  ffi_type** arg_types;
  int* arg_kind;
  ffi_type* ret_type;
  int ret_kind;
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
    case K_I32: JS_ToInt32(ctx, &i32, v); out->i64 = i32; break;

    case K_U8:
    case K_U16:
    case K_U32: JS_ToInt64Ext(ctx, &i64, v); out->i64 = i64; break;

    case K_I64:
    case K_I64_FAST:
    case K_U64:
    case K_U64_FAST: JS_ToInt64Ext(ctx, &i64, v); out->i64 = i64; break;

    case K_F32: JS_ToFloat64(ctx, &d, v); out->f32 = (float)d; break;
    case K_F64: JS_ToFloat64(ctx, &d, v); out->f64 = d; break;

    case K_POINTER: out->ptr = js_ptr(ctx, v); break;

    default: out->i64 = 0; break;
  }
}

/* Return-value slot -> JSValue, per declared kind. */
static JSValue
native_ret_to_js(JSContext* ctx, int kind, union native_value* rc) {
  switch(kind) {
    case K_VOID: return JS_UNDEFINED;
    case K_BOOL: return JS_NewBool(ctx, rc->i64 != 0);
    case K_I8:
    case K_I16:
    case K_I32: return JS_NewInt32(ctx, (int32_t)rc->i64);
    case K_U8:
    case K_U16: return JS_NewInt32(ctx, (int32_t)rc->i64);
    case K_U32: return JS_NewInt64(ctx, (int64_t)(uint32_t)rc->i64);
    case K_I64: return JS_NewBigInt64(ctx, rc->i64);
    case K_U64: return JS_NewBigUint64(ctx, rc->u64);
    case K_I64_FAST: return JS_NewFloat64(ctx, (double)rc->i64);
    case K_U64_FAST: return JS_NewFloat64(ctx, (double)rc->u64);
    case K_F32: return JS_NewFloat64(ctx, rc->f32);
    case K_F64: return JS_NewFloat64(ctx, rc->f64);
    case K_POINTER: return JS_NewInt64(ctx, (int64_t)(intptr_t)rc->ptr);
    case K_CSTRING: return rc->ptr ? JS_NewString(ctx, rc->ptr) : JS_NULL;
    default: return JS_UNDEFINED;
  }
}

static void
js_cfunction_data_free(JSContext* ctx, CFunctionData* cf) {
  if(cf->arg_types)
    js_free(ctx, cf->arg_types);
  if(cf->arg_kind)
    js_free(ctx, cf->arg_kind);
  js_free(ctx, cf);
}

static CFunctionData*
js_cfunction_new(JSContext* ctx, JSValueConst options) {
  CFunctionData* cf;
  ffi_type* types[CFUNCTION_MAX_ARGS];
  int kinds[CFUNCTION_MAX_ARGS];
  ffi_type* ret_type = &ffi_type_void;
  int ret_kind = K_VOID;
  int abi = FFI_DEFAULT_ABI;
  void* fp = NULL;
  uint32_t argc = 0, i;

  if(!JS_IsObject(options)) {
    JS_ThrowTypeError(ctx, "CFunction: argument 1 must be an object");
    return NULL;
  }

  JSValue ptr_val = JS_GetPropertyStr(ctx, options, "ptr");
  fp = js_ptr(ctx, ptr_val);
  JS_FreeValue(ctx, ptr_val);

  if(!fp) {
    JS_ThrowTypeError(ctx, "CFunction: options.ptr must be a valid function pointer");
    return NULL;
  }

  JSValue args_val = JS_GetPropertyStr(ctx, options, "args");

  if(JS_IsArray(ctx, args_val)) {
    JSValue len_val = JS_GetPropertyStr(ctx, args_val, "length");
    JS_ToUint32(ctx, &argc, len_val);
    JS_FreeValue(ctx, len_val);

    if(argc > CFUNCTION_MAX_ARGS)
      argc = CFUNCTION_MAX_ARGS;

    for(i = 0; i < argc; i++) {
      JSValue item = JS_GetPropertyUint32(ctx, args_val, i);
      const char* s = JS_ToCString(ctx, item);
      int kind = K_I32;
      ffi_type* t = resolve_type(s, &kind);

      if(s)
        JS_FreeCString(ctx, s);
      JS_FreeValue(ctx, item);

      types[i] = t ? t : &ffi_type_sint32;
      kinds[i] = t ? kind : K_I32;
    }
  }

  JS_FreeValue(ctx, args_val);

  JSValue ret_val = JS_GetPropertyStr(ctx, options, "returns");

  if(!JS_IsUndefined(ret_val)) {
    const char* s = JS_ToCString(ctx, ret_val);
    int kind;
    ffi_type* t = resolve_type(s, &kind);

    if(s)
      JS_FreeCString(ctx, s);

    if(t) {
      ret_type = t;
      ret_kind = kind;
    }
  }

  JS_FreeValue(ctx, ret_val);

  JSValue abi_val = JS_GetPropertyStr(ctx, options, "abi");

  if(!JS_IsUndefined(abi_val)) {
    const char* s = JS_ToCString(ctx, abi_val);
    abi = resolve_abi(s);

    if(s)
      JS_FreeCString(ctx, s);
  }

  JS_FreeValue(ctx, abi_val);

  if(!(cf = js_mallocz(ctx, sizeof(CFunctionData))))
    return NULL;

  if(argc) {
    if(!(cf->arg_types = js_mallocz(ctx, sizeof(ffi_type*) * argc)) || !(cf->arg_kind = js_mallocz(ctx, sizeof(int) * argc))) {
      js_cfunction_data_free(ctx, cf);
      return NULL;
    }

    memcpy(cf->arg_types, types, sizeof(ffi_type*) * argc);
    memcpy(cf->arg_kind, kinds, sizeof(int) * argc);
  }

  cf->fp = fp;
  cf->argc = argc;
  cf->ret_type = ret_type;
  cf->ret_kind = ret_kind;

  if(ffi_prep_cif(&cf->cif, abi, cf->argc, cf->ret_type, cf->arg_types) != FFI_OK) {
    JS_ThrowTypeError(ctx, "CFunction: ffi_prep_cif failed");
    js_cfunction_data_free(ctx, cf);
    return NULL;
  }

  return cf;
}

static JSValue
js_cfunction_call(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv, int magic, JSValue* func_data) {
  CFunctionData* cf = JS_GetOpaque(func_data[0], js_cfunction_class_id);
  union native_value args_storage[CFUNCTION_MAX_ARGS];
  void* ptrs[CFUNCTION_MAX_ARGS];
  const char* cstrings[CFUNCTION_MAX_ARGS];
  int cstring_count = 0;
  union native_value rc;
  int i;
  JSValue ret;

  if(!cf)
    return JS_ThrowTypeError(ctx, "CFunction: invalid function");

  for(i = 0; i < cf->argc; i++) {
    JSValueConst v = i < argc ? argv[i] : JS_UNDEFINED;

    if(cf->arg_kind[i] == K_CSTRING) {
      const char* s = JS_ToCString(ctx, v);
      cstrings[cstring_count++] = s;
      args_storage[i].ptr = (void*)s;
    } else {
      js_to_native_arg(ctx, cf->arg_kind[i], &args_storage[i], v);
    }

    ptrs[i] = &args_storage[i];
  }

  ffi_call(&cf->cif, cf->fp, &rc, cf->argc ? ptrs : NULL);

  ret = native_ret_to_js(ctx, cf->ret_kind, &rc);

  while(cstring_count > 0)
    JS_FreeCString(ctx, cstrings[--cstring_count]);

  return ret;
}

static void
js_cfunction_finalizer(JSRuntime* rt, JSValue val) {
  CFunctionData* cf;

  if((cf = JS_GetOpaque(val, js_cfunction_class_id))) {
    if(cf->arg_types)
      js_free_rt(rt, cf->arg_types);
    if(cf->arg_kind)
      js_free_rt(rt, cf->arg_kind);
    js_free_rt(rt, cf);
  }
}

static JSClassDef js_cfunction_class = {
    .class_name = "CFunctionData",
    .finalizer = js_cfunction_finalizer,
};

/* fn = CFunction({ ptr, args, returns, abi }) */
static JSValue
js_cfunction_ctor(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst* argv) {
  JSValueConst options = argc > 0 ? argv[0] : JS_UNDEFINED;
  CFunctionData* cf;
  JSValue holder, func;

  if(!(cf = js_cfunction_new(ctx, options)))
    return JS_EXCEPTION;

  holder = JS_NewObjectClass(ctx, js_cfunction_class_id);

  if(JS_IsException(holder)) {
    js_cfunction_data_free(ctx, cf);
    return JS_EXCEPTION;
  }

  JS_SetOpaque(holder, cf);

  func = JS_NewCFunctionData(ctx, js_cfunction_call, cf->argc, 0, 1, &holder);
  JS_FreeValue(ctx, holder);
  return func;
}

int
js_cfunction_init(JSContext* ctx, JSModuleDef* m) {
  JSValue ctor;

  JS_NewClassID(&js_cfunction_class_id);
  JS_NewClass(JS_GetRuntime(ctx), js_cfunction_class_id, &js_cfunction_class);

  ctor = JS_NewCFunction(ctx, js_cfunction_ctor, "CFunction", 1);

  if(m)
    JS_SetModuleExport(ctx, m, "CFunction", ctor);

  return 0;
}
