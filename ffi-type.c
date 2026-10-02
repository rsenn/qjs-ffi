#include "ffi-type.h"
#include "js-helpers.h"
#include <cutils.h>
#include <inttypes.h>
#include <string.h>

#define T(name, type, kind, id) JS_PROP_INT32_DEF(name, id, JS_PROP_C_W_E),
#define P(name, id) JS_PROP_INT32_DEF(name, id, JS_PROP_C_W_E),

const JSCFunctionListEntry js_ffitype_funcs[FFI_TYPE_COUNT] = {FFI_TYPE_LIST(T) FFI_TYPE_EXTRA(P) FFI_TYPE_INDEX(P)};

#undef T
#undef P

#define T(name, type, kind, id) {name, &type, kind, id},

static const struct {
  const char* name;
  ffi_type* type;
  int kind;
  int id;
} type_table[] = {FFI_TYPE_LIST(T)};

#undef T

ffi_type*
ffi_resolve_type_id(int id, int* kind) {
  size_t i;

  for(i = 0; i < countof(type_table); i++)
    if(type_table[i].id == id) {
      *kind = type_table[i].kind;
      return type_table[i].type;
    }

  return NULL;
}

int
ffi_is_pointer_name(const char* name) {
  size_t n = name ? strlen(name) : 0;

  while(n && (name[n - 1] == ' ' || name[n - 1] == '\t'))
    n--;

  return n && name[n - 1] == '*';
}

ffi_type*
ffi_resolve_type(const char* name, int* kind) {
  size_t i;

  if(name)
    for(i = 0; i < countof(type_table); i++)
      if(!strcmp(type_table[i].name, name)) {
        *kind = type_table[i].kind;
        return type_table[i].type;
      }

  if(ffi_is_pointer_name(name)) {
    *kind = K_POINTER;
    return &ffi_type_pointer;
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
    case K_POINTER: return js_new_pointer(ctx, *(void* const*)p);
    case K_CSTRING: {
      const char* s = *(const char* const*)p;
      return s ? JS_NewString(ctx, s) : JS_NULL;
    }
    default: return JS_UNDEFINED;
  }
}

#define STRUCT_MAX_DEPTH 8
#define STRUCT_MAX_ELEMENTS 1024

static ffi_type* value_to_type(JSContext* ctx, FFISignature* sig, JSValueConst value, int* kind, int depth);

/* The struct type of an array of element types, owned by `sig`. NULL with an
 * exception pending on error. libffi fills in size and alignment in
 * ffi_prep_cif(), from the elements alone, so they have to list every scalar
 * member in memory order.
 */
static ffi_type*
struct_type(JSContext* ctx, FFISignature* sig, JSValueConst value, int depth) {
  int64_t n = 0;

  js_try_get_length(ctx, value, &n);
  ffi_type *st, **elements, **list;

  if(depth >= STRUCT_MAX_DEPTH) {
    JS_ThrowRangeError(ctx, "struct type nested more than %d deep", STRUCT_MAX_DEPTH);
    return NULL;
  }

  if(n < 1 || n > STRUCT_MAX_ELEMENTS) {
    JS_ThrowRangeError(ctx, "struct type needs 1 to %d elements", STRUCT_MAX_ELEMENTS);
    return NULL;
  }

  if(!(st = js_mallocz(ctx, sizeof(ffi_type) + sizeof(ffi_type*) * (n + 1))))
    return NULL;

  if(!(list = js_realloc(ctx, sig->aggregates, sizeof(ffi_type*) * (sig->aggregate_count + 1)))) {
    js_free(ctx, st);
    return NULL;
  }

  sig->aggregates = list;
  sig->aggregates[sig->aggregate_count++] = st;

  elements = (ffi_type**)(st + 1);
  st->type = FFI_TYPE_STRUCT;
  st->elements = elements;

  for(int64_t i = 0; i < n; i++) {
    JSValue item = JS_GetPropertyUint32(ctx, value, i);
    int kind = K_I32;
    ffi_type* t = value_to_type(ctx, sig, item, &kind, depth + 1);

    JS_FreeValue(ctx, item);

    if(kind < 0)
      return NULL;

    if(!t || kind == K_VOID) {
      JS_ThrowTypeError(ctx, "struct type element %" PRId64 " is not a type name or a struct", i);
      return NULL;
    }

    elements[i] = t;
  }

  elements[n] = NULL;
  return st;
}

/* Sets *kind to -1 if an exception is pending (an invalid struct type); NULL
 * with any other kind is an unknown type name. */
static ffi_type*
value_to_type(JSContext* ctx, FFISignature* sig, JSValueConst value, int* kind, int depth) {
  const char* s;
  ffi_type* t;

  if(JS_IsArray(ctx, value)) {
    ffi_type* st = struct_type(ctx, sig, value, depth);

    *kind = st ? K_STRUCT : -1;
    return st;
  }

  if(JS_IsNumber(value)) {
    int32_t id;

    return JS_ToInt32(ctx, &id, value) ? NULL : ffi_resolve_type_id(id, kind);
  }

  s = JS_ToCString(ctx, value);
  t = ffi_resolve_type(s, kind);

  JS_FreeCString(ctx, s);
  return t;
}

int
ffi_sig_parse(JSContext* ctx, FFISignature* sig, JSValueConst options) {
  ffi_type* types[FFI_MAX_ARGS];
  int kinds[FFI_MAX_ARGS];
  int64_t argc = 0;

  *sig = (FFISignature){0, NULL, NULL, &ffi_type_void, K_VOID, NULL, 0};

  if(!JS_IsObject(options))
    return 0;

  JSValue args_val = JS_GetPropertyStr(ctx, options, "args");

  if(js_try_get_length(ctx, args_val, &argc))
    argc = 0;

  if(argc > FFI_MAX_ARGS)
    argc = FFI_MAX_ARGS;

  for(int64_t i = 0; i < argc; i++) {
    JSValue item = JS_GetPropertyUint32(ctx, args_val, i);
    int kind = K_I32;
    ffi_type* t = value_to_type(ctx, sig, item, &kind, 0);

    JS_FreeValue(ctx, item);

    if(kind < 0) {
      JS_FreeValue(ctx, args_val);
      ffi_sig_free(JS_GetRuntime(ctx), sig);
      return -1;
    }

    types[i] = t ? t : &ffi_type_sint32;
    kinds[i] = t ? kind : K_I32;
  }

  JS_FreeValue(ctx, args_val);

  JSValue ret_val = JS_GetPropertyStr(ctx, options, "returns");

  if(!JS_IsUndefined(ret_val)) {
    int kind;
    ffi_type* t = value_to_type(ctx, sig, ret_val, &kind, 0);

    if(kind < 0) {
      JS_FreeValue(ctx, ret_val);
      ffi_sig_free(JS_GetRuntime(ctx), sig);
      return -1;
    }

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

int
ffi_sig_has_struct(const FFISignature* sig) {
  if(sig->ret_kind == K_STRUCT)
    return 1;

  for(int i = 0; i < sig->argc; i++)
    if(sig->arg_kind[i] == K_STRUCT)
      return 1;

  return 0;
}

void
ffi_sig_free(JSRuntime* rt, FFISignature* sig) {
  for(int i = 0; i < sig->aggregate_count; i++)
    js_free_rt(rt, sig->aggregates[i]);

  if(sig->aggregates)
    js_free_rt(rt, sig->aggregates);

  if(sig->arg_types)
    js_free_rt(rt, sig->arg_types);

  if(sig->arg_kind)
    js_free_rt(rt, sig->arg_kind);

  sig->aggregates = NULL;
  sig->aggregate_count = 0;
  sig->arg_types = NULL;
  sig->arg_kind = NULL;
  sig->argc = 0;
}
