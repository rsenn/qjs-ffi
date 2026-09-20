#include "ffi-type.h"
#include "js-helpers.h"
#include <cutils.h>
#include <string.h>

#define T(name, type, kind) JS_PROP_STRING_DEF(name, name, JS_PROP_C_W_E),

const JSCFunctionListEntry js_ffitype_funcs[FFI_TYPE_COUNT] = {FFI_TYPE_LIST(T)};

#undef T

#define T(name, type, kind) {name, &type, kind},

static const struct {
  const char* name;
  ffi_type* type;
  int kind;
} type_table[] = {FFI_TYPE_LIST(T)};

#undef T

ffi_type*
ffi_resolve_type(const char* name, int* kind) {
  size_t i;

  if(name)
    for(i = 0; i < countof(type_table); i++)
      if(!strcmp(type_table[i].name, name)) {
        *kind = type_table[i].kind;
        return type_table[i].type;
      }

  return NULL;
}

int
ffi_resolve_abi(const char* name) {
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
#ifdef FFI_THISCALL
  if(!strcmp(name, "thiscall"))
    return FFI_THISCALL;
#endif
#ifdef FFI_FASTCALL
  if(!strcmp(name, "fastcall"))
    return FFI_FASTCALL;
#endif
#ifdef FFI_MS_CDECL
  if(!strcmp(name, "ms_cdecl"))
    return FFI_MS_CDECL;
#endif
#ifdef FFI_WIN64
  if(!strcmp(name, "win64"))
    return FFI_WIN64;
#endif
  return FFI_DEFAULT_ABI;
}

JSValue
ffi_native_to_js(JSContext* ctx, int kind, const void* p) {
  switch(kind) {
    case K_BOOL: return JS_NewBool(ctx, *(const uint8_t*)p != 0);
    case K_I8: return JS_NewInt32(ctx, *(const int8_t*)p);
    case K_U8: return JS_NewInt32(ctx, *(const uint8_t*)p);
    case K_I16: return JS_NewInt32(ctx, *(const int16_t*)p);
    case K_U16: return JS_NewInt32(ctx, *(const uint16_t*)p);
    case K_I32: return JS_NewInt32(ctx, *(const int32_t*)p);
    case K_U32: return JS_NewInt64(ctx, *(const uint32_t*)p);
    case K_I64: return JS_NewBigInt64(ctx, *(const int64_t*)p);
    case K_U64: return JS_NewBigUint64(ctx, *(const uint64_t*)p);
    case K_I64_FAST: return JS_NewFloat64(ctx, (double)*(const int64_t*)p);
    case K_U64_FAST: return JS_NewFloat64(ctx, (double)*(const uint64_t*)p);
    case K_F32: return JS_NewFloat64(ctx, *(const float*)p);
    case K_F64: return JS_NewFloat64(ctx, *(const double*)p);
    case K_POINTER: return js_newptr(ctx, *(void* const*)p);
    case K_CSTRING: {
      const char* s = *(const char* const*)p;
      return s ? JS_NewString(ctx, s) : JS_NULL;
    }
    default: return JS_UNDEFINED;
  }
}

static ffi_type*
value_to_type(JSContext* ctx, JSValueConst value, int* kind) {
  const char* s = JS_ToCString(ctx, value);
  ffi_type* t = ffi_resolve_type(s, kind);

  JS_FreeCString(ctx, s);
  return t;
}

int
ffi_sig_parse(JSContext* ctx, FFISignature* sig, JSValueConst options) {
  ffi_type* types[FFI_MAX_ARGS];
  int kinds[FFI_MAX_ARGS];
  int64_t argc = 0;

  *sig = (FFISignature){0, NULL, NULL, &ffi_type_void, K_VOID};

  if(!JS_IsObject(options))
    return 0;

  JSValue args_val = JS_GetPropertyStr(ctx, options, "args");

  if((argc = js_array_length(ctx, args_val)) < 0)
    argc = 0;

  if(argc > FFI_MAX_ARGS)
    argc = FFI_MAX_ARGS;

  for(int64_t i = 0; i < argc; i++) {
    JSValue item = JS_GetPropertyUint32(ctx, args_val, i);
    int kind = K_I32;
    ffi_type* t = value_to_type(ctx, item, &kind);

    JS_FreeValue(ctx, item);

    types[i] = t ? t : &ffi_type_sint32;
    kinds[i] = t ? kind : K_I32;
  }

  JS_FreeValue(ctx, args_val);

  JSValue ret_val = JS_GetPropertyStr(ctx, options, "returns");

  if(!JS_IsUndefined(ret_val)) {
    int kind;
    ffi_type* t = value_to_type(ctx, ret_val, &kind);

    if(t) {
      sig->ret_type = t;
      sig->ret_kind = kind;
    }
  }

  JS_FreeValue(ctx, ret_val);

  if(argc) {
    if(!(sig->arg_types = js_malloc(ctx, sizeof(ffi_type*) * argc)) || !(sig->arg_kind = js_malloc(ctx, sizeof(int) * argc))) {
      ffi_sig_free(JS_GetRuntime(ctx), sig);
      return -1;
    }

    memcpy(sig->arg_types, types, sizeof(ffi_type*) * argc);
    memcpy(sig->arg_kind, kinds, sizeof(int) * argc);
  }

  sig->argc = argc;
  return 0;
}

void
ffi_sig_free(JSRuntime* rt, FFISignature* sig) {
  if(sig->arg_types)
    js_free_rt(rt, sig->arg_types);

  if(sig->arg_kind)
    js_free_rt(rt, sig->arg_kind);

  sig->arg_types = NULL;
  sig->arg_kind = NULL;
  sig->argc = 0;
}
