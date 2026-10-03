#include "c-function.h"
#include "ffi-type.h"
#include "js-callback.h"
#include "js-helpers.h"
#include <cutils.h>
#include <ffi.h>

/* one argument or return slot; only the member of the declared kind
 * is live.
 * little-endian: a narrower member than the union still reads right. */
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
  int abi;
  int variadic; /* the arguments after sig's come as (type, value) pairs */
} CFunctionData;

static JSClassID js_cfunction_class_id;

/* the FFIType name of a kind, for an error message. */
static const char*
kind_name(int kind) {
  switch(kind) {
    case K_BOOL: return "bool";
    case K_I8: return "i8";
    case K_U8: return "u8";
    case K_I16: return "i16";
    case K_U16: return "u16";
    case K_I32: return "i32";
    case K_U32: return "u32";
    case K_I64: return "i64";
    case K_U64: return "u64";
    case K_I64_FAST: return "i64_fast";
    case K_U64_FAST: return "u64_fast";
    case K_F32: return "f32";
    case K_F64: return "f64";
  }

  return "number";
}

/* converts argument `index` (counting from 1) to the native slot of `kind`.
 *
 * a number, bigint, boolean, null or undefined converts, an integer kind
 * wrapping to its width; a string or a Symbol is a TypeError, as in bun.
 *
 *   returns  0, or -1 with an exception pending
 */
static int
js_to_native_arg(JSContext* ctx, int kind, union native_value* out, JSValueConst v, int index) {
  int64_t i64 = 0;
  double d = 0;

  switch(kind) {
    case K_BOOL: out->i64 = JS_ToBool(ctx, v) > 0; return 0;
    case K_I8:
    case K_U8:
    case K_I16:
    case K_U16:
    case K_I32:
    case K_U32:
    case K_I64:
    case K_I64_FAST:
    case K_U64:
    case K_U64_FAST:
    case K_F32:
    case K_F64: break;
    default: out->i64 = 0; return 0;
  }

  if(JS_IsString(v) || JS_IsSymbol(v)) {
    JS_ThrowTypeError(ctx, "CFunction: cannot convert argument %d to '%s'", index, kind_name(kind));
    return -1;
  }

  if(kind == K_F32 || kind == K_F64) {
    if(JS_ToFloat64(ctx, &d, v))
      return -1;

    if(kind == K_F32)
      out->f32 = (float)d;
    else
      out->f64 = d;

    return 0;
  }

  if(JS_ToInt64Ext(ctx, &i64, v))
    return -1;

  switch(kind) {
    case K_I8:
    case K_I16:
    case K_I32: out->i64 = (int32_t)i64; break;
    default: out->i64 = i64; break;
  }

  return 0;
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
    JSValue variadic_val = JS_GetPropertyStr(ctx, spec, "variadic");

    if(!JS_IsUndefined(abi_val)) {
      const char* s = JS_ToCString(ctx, abi_val);
      abi = ffi_resolve_abi(s);
      JS_FreeCString(ctx, s);
    }

    cf->variadic = JS_ToBool(ctx, variadic_val) > 0;
    JS_FreeValue(ctx, abi_val);
    JS_FreeValue(ctx, variadic_val);
  }

  cf->abi = abi;
  cf->fp = fp;

  if(ffi_prep_cif(&cf->cif, abi, cf->sig.argc, cf->sig.ret_type, cf->sig.arg_types) != FFI_OK) {
    JS_ThrowTypeError(ctx, "CFunction: ffi_prep_cif failed");
    js_cfunction_data_free(JS_GetRuntime(ctx), cf);
    return NULL;
  }

  return cf;
}

/* a variadic call: the arguments after the fixed ones are (type, value)
 * pairs. fills kinds/types/vals for all of them and prepares `cif`, which
 * the C default argument promotions shape: a type narrower than an int is
 * an int, a float a double.
 *
 * ```js
 * printf("%d %f\n", "i32", 5, "f64", 2.5);
 * ```
 *
 *   returns  0, or -1 with an exception pending
 */
static int
js_cfunction_variadic(JSContext* ctx, CFunctionData* cf, int argc, JSValueConst argv[], int* kinds,
                      ffi_type** types, JSValueConst* vals, ffi_cif* cif, int* count) {
  int fixed = cf->sig.argc;
  int extra = argc > fixed ? argc - fixed : 0;

  if(extra % 2) {
    JS_ThrowTypeError(ctx, "CFunction: the arguments after the fixed ones are (type, value) pairs");
    return -1;
  }

  if(fixed + extra / 2 > FFI_MAX_ARGS) {
    JS_ThrowRangeError(ctx, "CFunction: at most %d arguments", FFI_MAX_ARGS);
    return -1;
  }

  for(int i = 0; i < fixed; i++) {
    kinds[i] = cf->sig.arg_kind[i];
    types[i] = cf->sig.arg_types[i];
    vals[i] = i < argc ? argv[i] : JS_UNDEFINED;
  }

  for(int j = 0; j < extra / 2; j++) {
    int kind = K_I32;
    ffi_type* t = ffi_resolve_scalar(ctx, argv[fixed + 2 * j], &kind);

    if(!t) {
      JS_ThrowTypeError(ctx, "CFunction: argument %d is not a scalar type name (a variadic type)",
                        fixed + 2 * j + 1);
      return -1;
    }

    switch(kind) {
      case K_BOOL:
      case K_I8:
      case K_U8:
      case K_I16:
      case K_U16: kind = K_I32, t = &ffi_type_sint32; break;
      case K_F32: kind = K_F64, t = &ffi_type_double; break;
    }

    kinds[fixed + j] = kind;
    types[fixed + j] = t;
    vals[fixed + j] = argv[fixed + 2 * j + 1];
  }

  *count = fixed + extra / 2;

  if(ffi_prep_cif_var(cif, cf->abi, fixed, *count, cf->sig.ret_type, types) != FFI_OK) {
    JS_ThrowTypeError(ctx, "CFunction: ffi_prep_cif_var failed");
    return -1;
  }

  return 0;
}

/* JSClassDef.call of CFunction: ffi_call() on the stored cif.
 * the object is its own opaque holder; no wrapper/holder pair.
 * returns the converted result, or JS_EXCEPTION (TypeError once closed). */
static JSValue
js_cfunction_invoke(JSContext* ctx, JSValueConst func_obj, JSValueConst this_val, int argc,
                    JSValueConst argv[], int flags) {
  CFunctionData* cf = JS_GetOpaque(func_obj, js_cfunction_class_id);
  union native_value args_storage[FFI_MAX_ARGS];
  void* ptrs[FFI_MAX_ARGS];
  const char* cstrings[FFI_MAX_ARGS];
  JSValueConst vals[FFI_MAX_ARGS];
  int kinds_buf[FFI_MAX_ARGS];
  ffi_type* types_buf[FFI_MAX_ARGS];
  ffi_cif vcif;
  int cstring_count = 0;
  union native_value rc;
  CallbackScope scope;
  JSValue ret, thrown;

  if(!cf)
    return JS_ThrowTypeError(ctx, "CFunction: invalid function");

  const int* kinds = cf->sig.arg_kind;
  ffi_type** types = cf->sig.arg_types;
  ffi_cif* cif = &cf->cif;
  int n = cf->sig.argc;

  if(cf->variadic) {
    if(js_cfunction_variadic(ctx, cf, argc, argv, kinds_buf, types_buf, vals, &vcif, &n))
      return JS_EXCEPTION;

    kinds = kinds_buf;
    types = types_buf;
    cif = &vcif;
  } else {
    for(int i = 0; i < n; i++)
      vals[i] = i < argc ? argv[i] : JS_UNDEFINED;
  }

  for(int i = 0; i < n; i++) {
    JSValueConst v = vals[i];

    if(kinds[i] == K_CSTRING) {
      const char* s = JS_ToCString(ctx, v);
      cstrings[cstring_count++] = s;
      args_storage[i].ptr = (void*)s;
    } else if(kinds[i] == K_POINTER) {
      /* pointer: an address, a view, or a JSCallback's function pointer. */
      if(js_to_pointer(ctx, &args_storage[i].ptr, v)) {
        ret = js_throw_pointer_error(ctx, v);
        goto done;
      }
    } else if(kinds[i] == K_BUFFER_LENGTH) {
      /* buffer_length: byte size of the view given here, the same view
       * as the buffer argument before it. */
      ByteSpan buf;

      if(js_try_get_bytes(ctx, &buf, v)) {
        ret = JS_ThrowTypeError(
            ctx,
            "CFunction: argument %d must be a TypedArray, DataView or ArrayBuffer (buffer_length)",
            i + 1);
        goto done;
      }

      args_storage[i].u64 = buf.size;
    } else if(kinds[i] == K_STRUCT) {
      /* libffi takes the address of the struct's bytes, which must all be
       * there: the argument is an ArrayBuffer or view of at least its size. */
      ByteSpan buf;

      if(js_try_get_bytes(ctx, &buf, v) || buf.size < types[i]->size) {
        ret = JS_ThrowTypeError(ctx,
                                "CFunction: argument %d must be an ArrayBuffer of at least %zu "
                                "bytes (a struct passed by value)",
                                i + 1, types[i]->size);
        goto done;
      }

      ptrs[i] = buf.data;
      continue;
    } else if(js_to_native_arg(ctx, kinds[i], &args_storage[i], v, i + 1)) {
      ret = JS_EXCEPTION;
      goto done;
    }

    ptrs[i] = &args_storage[i];
  }

  if(cf->sig.ret_kind == K_STRUCT) {
    /* libffi writes at least a register's worth, even for a tiny struct. */
    size_t size = cf->sig.ret_type->size;
    void* out = js_malloc(ctx, size < sizeof(ffi_arg) ? sizeof(ffi_arg) : size);

    if(!out) {
      ret = JS_EXCEPTION;
      goto done;
    }

    js_callback_scope_begin(&scope);
    ffi_call(cif, cf->fp, out, n ? ptrs : NULL);

    if(js_callback_scope_end(&scope, &thrown))
      ret = JS_Throw(ctx, thrown);
    else
      ret = JS_NewArrayBufferCopy(ctx, out, size);

    js_free(ctx, out);
  } else {
    js_callback_scope_begin(&scope);
    ffi_call(cif, cf->fp, &rc, n ? ptrs : NULL);

    if(js_callback_scope_end(&scope, &thrown))
      ret = JS_Throw(ctx, thrown);
    else
      ret = ffi_native_to_js(ctx, cf->sig.ret_kind, &rc);
  }

done:
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

/* fn.close(): frees the signature early; the function throws a TypeError
 * after that, as in invoke. Idempotent. */
static JSValue
js_cfunction_close(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  CFunctionData* cf = JS_GetOpaque2(ctx, this_val, js_cfunction_class_id);

  if(!cf)
    return JS_GetClassID(this_val) == js_cfunction_class_id ? JS_UNDEFINED : JS_EXCEPTION;

  js_cfunction_data_free(JS_GetRuntime(ctx), cf);
  JS_SetOpaque(this_val, NULL);
  return JS_UNDEFINED;
}

/* a variable exported from C: JS reads it with `symbols.n` (converted like
 * a return value) and writes it with `symbols.n = 7` (like an argument).
 * doc/dlopen.md has the JS side. */
typedef struct VariableData {
  void* addr;
  char* name;
  FFISignature sig; /* only .ret_type and .ret_kind: the variable's type */
  int readonly;
} VariableData;

static JSClassID js_variable_class_id;

static void
js_variable_finalizer(JSRuntime* rt, JSValue val) {
  VariableData* v;

  if((v = JS_GetOpaque(val, js_variable_class_id))) {
    ffi_sig_free(rt, &v->sig);
    js_free_rt(rt, v->name);
    js_free_rt(rt, v);
  }
}

static JSClassDef js_variable_class = {
    .class_name = "FFIVariable",
    .finalizer = js_variable_finalizer,
};

static JSValue
js_variable_get(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[], int magic,
                JSValueConst data[]) {
  VariableData* v = JS_GetOpaque(data[0], js_variable_class_id);

  /* struct or array: an ArrayBuffer over the memory itself, no copy and
   * no free function. */
  if(v->sig.ret_kind == K_STRUCT)
    return JS_NewArrayBuffer(ctx, v->addr, v->sig.ret_type->size, NULL, NULL, FALSE);

  return ffi_native_to_js(ctx, v->sig.ret_kind, v->addr);
}

static JSValue
js_variable_set(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[], int magic,
                JSValueConst data[]) {
  VariableData* v = JS_GetOpaque(data[0], js_variable_class_id);
  JSValueConst arg = argc > 0 ? argv[0] : JS_UNDEFINED;
  union native_value nv;

  if(v->readonly)
    return JS_ThrowTypeError(ctx, "%s is read-only", v->name);

  if(v->sig.ret_kind == K_CSTRING)
    return JS_ThrowTypeError(
        ctx, "%s is a cstring and cannot be assigned (its storage would have to outlive the call)",
        v->name);

  nv.i64 = 0;

  if(v->sig.ret_kind == K_POINTER) {
    if(js_to_pointer(ctx, &nv.ptr, arg))
      return js_throw_pointer_error(ctx, arg);
  } else {
    if(js_to_native_arg(ctx, v->sig.ret_kind, &nv, arg, 1))
      return JS_EXCEPTION;
  }

  memcpy(v->addr, &nv, v->sig.ret_type->size);
  return JS_UNDEFINED;
}

/* returns 1 if `spec` has `type`, 0 if not, -1 with a TypeError if
 * `args` or `returns` come with it. */
int
js_is_data_spec(JSContext* ctx, JSValueConst spec, const char* who, const char* name) {
  int ret = 0;

  if(!JS_IsObject(spec))
    return 0;

  JSValue type = JS_GetPropertyStr(ctx, spec, "type");

  if(JS_IsException(type))
    return -1;

  if(!JS_IsUndefined(type)) {
    JSValue args = JS_GetPropertyStr(ctx, spec, "args"),
            returns = JS_GetPropertyStr(ctx, spec, "returns");

    ret = 1;

    if(!JS_IsUndefined(args) || !JS_IsUndefined(returns)) {
      JS_ThrowTypeError(ctx,
                        "%s: %s: a variable has `type`, a function `args` and `returns`, not both",
                        who, name);
      ret = -1;
    }

    JS_FreeValue(ctx, args);
    JS_FreeValue(ctx, returns);
  }

  JS_FreeValue(ctx, type);
  return ret;
}

int
js_variable_define(JSContext* ctx, JSValueConst obj, JSAtom prop, void* addr, JSValueConst spec,
                   const char* who, const char* name) {
  JSValue address = JS_GetPropertyStr(ctx, spec, "address"),
          readonly = JS_GetPropertyStr(ctx, spec, "readonly");
  int want_address = JS_ToBool(ctx, address) > 0, want_readonly = JS_ToBool(ctx, readonly) > 0;
  VariableData* v = NULL;
  JSValue holder = JS_UNDEFINED, getter, setter;

  JS_FreeValue(ctx, address);
  JS_FreeValue(ctx, readonly);

  /* address: true: a read-only pointer value, as dlsym() returns. */
  if(want_address)
    return JS_DefinePropertyValue(ctx, obj, prop, js_new_pointer(ctx, addr),
                                  JS_PROP_ENUMERABLE | JS_PROP_CONFIGURABLE) < 0
               ? -1
               : 0;

  JSValue options = JS_NewObject(ctx);

  JS_SetPropertyStr(ctx, options, "returns", JS_GetPropertyStr(ctx, spec, "type"));

  if(!(v = js_mallocz(ctx, sizeof(VariableData)))) {
    JS_FreeValue(ctx, options);
    return -1;
  }

  v->addr = addr;
  v->readonly = want_readonly;

  if(ffi_sig_parse(ctx, &v->sig, options)) {
    JS_FreeValue(ctx, options);
    js_free(ctx, v);
    return -1;
  }

  JS_FreeValue(ctx, options);

  if(v->sig.ret_kind == K_VOID || v->sig.ret_kind == K_BUFFER_LENGTH) {
    JS_ThrowTypeError(ctx, "%s: %s: not a type a variable can have", who, name);
    goto fail;
  }

  if(v->sig.ret_kind == K_STRUCT) {
    /* ffi_prep_cif() works out the struct's size and alignment. */
    ffi_cif cif;

    if(ffi_prep_cif(&cif, FFI_DEFAULT_ABI, 0, v->sig.ret_type, NULL) != FFI_OK) {
      JS_ThrowTypeError(ctx, "%s: %s: ffi_prep_cif failed", who, name);
      goto fail;
    }

    v->readonly = TRUE;
  }

  if(!(v->name = js_strdup(ctx, name)))
    goto fail;

  holder = JS_NewObjectClass(ctx, js_variable_class_id);

  if(JS_IsException(holder))
    goto fail;

  JS_SetOpaque(holder, v);
  v = NULL;

  getter = JS_NewCFunctionData(ctx, js_variable_get, 0, 0, 1, (JSValueConst*)&holder);
  setter = JS_NewCFunctionData(ctx, js_variable_set, 1, 0, 1, (JSValueConst*)&holder);
  JS_FreeValue(ctx, holder);

  if(JS_IsException(getter) || JS_IsException(setter)) {
    JS_FreeValue(ctx, getter);
    JS_FreeValue(ctx, setter);
    return -1;
  }

  return JS_DefinePropertyGetSet(ctx, obj, prop, getter, setter,
                                 JS_PROP_ENUMERABLE | JS_PROP_CONFIGURABLE) < 0
             ? -1
             : 0;

fail:
  if(v) {
    ffi_sig_free(JS_GetRuntime(ctx), &v->sig);
    js_free(ctx, v->name);
    js_free(ctx, v);
  }

  return -1;
}

static const JSCFunctionListEntry js_cfunction_proto_funcs[] = {
    JS_CFUNC_DEF("close", 0, js_cfunction_close),
};

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

  JSValue func_obj = JS_NewObjectClass(ctx, js_cfunction_class_id);

  if(JS_IsException(func_obj)) {
    js_cfunction_data_free(JS_GetRuntime(ctx), cf);
    return JS_EXCEPTION;
  }

  JS_SetOpaque(func_obj, cf);

  /* ptr: the address of the function, as bun's functions have it */
  JS_DefinePropertyValueStr(ctx, func_obj, "ptr", js_new_pointer(ctx, fp), 0);

  /* length: like a function's own: configurable, not writable/enumerable. */
  if(JS_DefinePropertyValueStr(ctx, func_obj, "length", JS_NewInt32(ctx, cf->sig.argc),
                               JS_PROP_CONFIGURABLE) < 0) {
    JS_FreeValue(ctx, func_obj);
    return JS_EXCEPTION;
  }

  return func_obj;
}

/* fn = CFunction({ ptr, args, returns, abi }), also with `new` as in bun:ffi */
static JSValue
js_cfunction_constructor(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  JSValueConst options = argc > 0 ? argv[0] : JS_UNDEFINED;

  if(!JS_IsObject(options))
    return JS_ThrowTypeError(ctx, "CFunction: argument 1 must be an object");

  JSValue ptr_val = JS_GetPropertyStr(ctx, options, "ptr");
  void* fp;

  if(js_to_address(ctx, &fp, ptr_val) || !fp) {
    JS_FreeValue(ctx, ptr_val);
    return JS_ThrowTypeError(ctx, "CFunction: options.ptr must be a valid function pointer");
  }

  JS_FreeValue(ctx, ptr_val);
  return js_cfunction_create(ctx, fp, options);
}

int
js_cfunction_init(JSContext* ctx, JSModuleDef* m, JSValueConst defaults) {
  JS_NewClassID(&js_cfunction_class_id);
  JS_NewClass(JS_GetRuntime(ctx), js_cfunction_class_id, &js_cfunction_class);
  JS_NewClassID(&js_variable_class_id);
  JS_NewClass(JS_GetRuntime(ctx), js_variable_class_id, &js_variable_class);

  /* class prototype: Function.prototype's call, apply and bind, plus close(). */
  JSValue func_proto = js_function_prototype(ctx);
  JSValue proto = JS_NewObjectProto(ctx, func_proto);

  JS_FreeValue(ctx, func_proto);
  JS_SetPropertyFunctionList(ctx, proto, js_cfunction_proto_funcs,
                             countof(js_cfunction_proto_funcs));
  js_callback_define_dispose(ctx, proto);
  JS_SetClassProto(ctx, js_cfunction_class_id, proto);

  JSValue ctor = JS_NewCFunction2(ctx, js_cfunction_constructor, "CFunction", 1,
                                  JS_CFUNC_constructor_or_func, 0);

  if(JS_IsObject(defaults))
    JS_SetPropertyStr(ctx, defaults, "CFunction", JS_DupValue(ctx, ctor));

  if(m)
    JS_SetModuleExport(ctx, m, "CFunction", ctor);
  else
    JS_FreeValue(ctx, ctor);

  return 0;
}
