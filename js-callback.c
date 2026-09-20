#include "js-callback.h"
#include "js-helpers.h"
#include <cutils.h>
#include <string.h>

JSClassID js_callback_class_id;
JSValue js_callback_proto, js_callback_ctor;

static struct list_head callback_list;

#define JS_CALLBACK_MAX_ARGS 32

/* Marshaling kinds, matching bun:ffi's FFIType vocabulary (see the
 * `FFIType` export in ffi-type.c and doc/js-callback.md). Kept local to this
 * file: js-callback.c doesn't depend on ffi.c's mutable, string-keyed type
 * registry.
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

/* Native argument (from libffi's `void** args`) -> JSValue, per declared kind. */
static JSValue
native_to_js(JSContext* ctx, int kind, void* p) {
  switch(kind) {
    case K_BOOL: return JS_NewBool(ctx, *(uint8_t*)p != 0);
    case K_I8: return JS_NewInt32(ctx, *(int8_t*)p);
    case K_U8: return JS_NewInt32(ctx, *(uint8_t*)p);
    case K_I16: return JS_NewInt32(ctx, *(int16_t*)p);
    case K_U16: return JS_NewInt32(ctx, *(uint16_t*)p);
    case K_I32: return JS_NewInt32(ctx, *(int32_t*)p);
    case K_U32: return JS_NewInt64(ctx, *(uint32_t*)p);
    case K_I64: return JS_NewBigInt64(ctx, *(int64_t*)p);
    case K_U64: return JS_NewBigUint64(ctx, *(uint64_t*)p);
    case K_I64_FAST: return JS_NewFloat64(ctx, (double)*(int64_t*)p);
    case K_U64_FAST: return JS_NewFloat64(ctx, (double)*(uint64_t*)p);
    case K_F32: return JS_NewFloat64(ctx, *(float*)p);
    case K_F64: return JS_NewFloat64(ctx, *(double*)p);
    case K_POINTER: return js_newptr(ctx, *(void**)p);
    case K_CSTRING: {
      char* s = *(char**)p;
      return s ? JS_NewString(ctx, s) : JS_NULL;
    }
    default: return JS_UNDEFINED;
  }
}

/* JSValue (the JS function's return value) -> native return slot, per
 * declared kind.
 *
 * libffi requires integer return values smaller than a machine word to be
 * written as a full ffi_arg (sign/zero-extended), not their natural size --
 * this is a closure-specific ABI quirk (unlike arguments, which use their
 * exact declared size). Getting this wrong corrupts the return register on
 * common ABIs.
 */
static void
js_to_native_ret(JSContext* ctx, int kind, void* ret, JSValueConst v) {
  int32_t i32 = 0;
  int64_t i64 = 0;
  double d = 0;

  switch(kind) {
    case K_VOID: break;

    case K_BOOL: *(ffi_arg*)ret = (ffi_arg)(JS_ToBool(ctx, v) > 0); break;

    case K_I8:
      JS_ToInt32(ctx, &i32, v);
      *(ffi_arg*)ret = (ffi_arg)(ffi_sarg)(int8_t)i32;
      break;

    case K_U8:
      JS_ToInt32(ctx, &i32, v);
      *(ffi_arg*)ret = (ffi_arg)(uint8_t)i32;
      break;

    case K_I16:
      JS_ToInt32(ctx, &i32, v);
      *(ffi_arg*)ret = (ffi_arg)(ffi_sarg)(int16_t)i32;
      break;

    case K_U16:
      JS_ToInt32(ctx, &i32, v);
      *(ffi_arg*)ret = (ffi_arg)(uint16_t)i32;
      break;

    case K_I32:
      JS_ToInt32(ctx, &i32, v);
      *(ffi_arg*)ret = (ffi_arg)(ffi_sarg)i32;
      break;

    case K_U32:
      JS_ToInt32(ctx, &i32, v);
      *(ffi_arg*)ret = (ffi_arg)(uint32_t)i32;
      break;

    case K_I64:
    case K_I64_FAST:
      JS_ToInt64Ext(ctx, &i64, v);
      *(int64_t*)ret = i64;
      break;

    case K_U64:
    case K_U64_FAST:
      JS_ToInt64Ext(ctx, &i64, v);
      *(uint64_t*)ret = (uint64_t)i64;
      break;

    case K_F32:
      JS_ToFloat64(ctx, &d, v);
      *(float*)ret = (float)d;
      break;

    case K_F64:
      JS_ToFloat64(ctx, &d, v);
      *(double*)ret = d;
      break;

    case K_POINTER:
    case K_CSTRING:
      JS_ToInt64Ext(ctx, &i64, v);
      *(void**)ret = (void*)(intptr_t)i64;
      break;
  }
}

static JSCallback*
callback_dup(JSCallback* cl) {
  ++cl->ref_count;
  return cl;
}

/* The libffi closure trampoline: invoked by native code through cl->code. */
static void
js_callback_handler(ffi_cif* cif, void* ret, void** args, void* user_data) {
  JSCallback* cl = user_data;
  JSContext* ctx = cl->ctx;
  JSValue argv[JS_CALLBACK_MAX_ARGS];
  int i;

  for(i = 0; i < cl->argc; i++)
    argv[i] = native_to_js(ctx, cl->arg_kind[i], args[i]);

  JS_FreeValue(ctx, cl->exception);
  cl->exception = JS_UNDEFINED;

  JSValue r = JS_Call(ctx, cl->func, JS_UNDEFINED, cl->argc, argv);

  for(i = 0; i < cl->argc; i++)
    JS_FreeValue(ctx, argv[i]);

  cl->called++;

  if(JS_IsException(r)) {
    cl->exception = JS_GetException(ctx);
    JS_FreeValue(ctx, r);
    r = JS_UNDEFINED;
  }

  js_to_native_ret(ctx, cl->ret_kind, ret, r);
  JS_FreeValue(ctx, r);
}

static void
js_callback_release(JSContext* ctx, JSCallback* cl) {
  if(cl->closure) {
    ffi_closure_free(cl->closure);
    cl->closure = NULL;
    cl->code = NULL;
  }

  if(cl->arg_types) {
    js_free(ctx, cl->arg_types);
    cl->arg_types = NULL;
  }

  if(cl->arg_kind) {
    js_free(ctx, cl->arg_kind);
    cl->arg_kind = NULL;
  }
}

JSCallback*
js_callback_new(JSContext* ctx, JSValueConst func_obj, JSValueConst options) {
  JSCallback* cl;
  ffi_type* types[JS_CALLBACK_MAX_ARGS];
  int kinds[JS_CALLBACK_MAX_ARGS];
  ffi_type* ret_type = &ffi_type_void;
  int ret_kind = K_VOID;
  int64_t argc = 0;

  if(!JS_IsUndefined(options) && !JS_IsNull(options)) {
    JSValue args_val = JS_GetPropertyStr(ctx, options, "args");

    if((argc = js_array_length(ctx, args_val)) < 0)
      argc = 0;

    if(argc > JS_CALLBACK_MAX_ARGS)
      argc = JS_CALLBACK_MAX_ARGS;

    for(int64_t i = 0; i < argc; i++) {
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
  }

  if(!(cl = js_mallocz(ctx, sizeof(JSCallback))))
    return NULL;

  if(argc) {
    if(!(cl->arg_types = js_mallocz(ctx, sizeof(ffi_type*) * argc)) || !(cl->arg_kind = js_mallocz(ctx, sizeof(int) * argc))) {
      js_callback_release(ctx, cl);
      js_free(ctx, cl);
      return NULL;
    }

    memcpy(cl->arg_types, types, sizeof(ffi_type*) * argc);
    memcpy(cl->arg_kind, kinds, sizeof(int) * argc);
  }

  cl->ref_count = 1;
  cl->called = 0;
  cl->ctx = ctx;
  cl->exception = JS_UNDEFINED;
  cl->func = JS_DupValue(ctx, func_obj);
  cl->argc = argc;
  cl->ret_type = ret_type;
  cl->ret_kind = ret_kind;

  if(!(cl->closure = ffi_closure_alloc(sizeof(ffi_closure), &cl->code))) {
    JS_FreeValue(ctx, cl->func);
    js_callback_release(ctx, cl);
    js_free(ctx, cl);
    return NULL;
  }

  if(ffi_prep_cif(&cl->cif, FFI_DEFAULT_ABI, cl->argc, cl->ret_type, cl->arg_types) != FFI_OK || ffi_prep_closure_loc(cl->closure, &cl->cif, js_callback_handler, cl, cl->code) != FFI_OK) {
    JS_FreeValue(ctx, cl->func);
    js_callback_release(ctx, cl);
    js_free(ctx, cl);
    return NULL;
  }

  if(!callback_list.next)
    init_list_head(&callback_list);

  list_add(&cl->link, &callback_list);
  return cl;
}

void
js_callback_free(JSRuntime* rt, JSCallback* cl) {
  if(--cl->ref_count <= 0) {
    JS_FreeValueRT(rt, cl->func);
    JS_FreeValueRT(rt, cl->exception);

    if(cl->closure)
      ffi_closure_free(cl->closure);

    if(cl->arg_types)
      js_free_rt(rt, cl->arg_types);
    if(cl->arg_kind)
      js_free_rt(rt, cl->arg_kind);

    list_del(&cl->link);
    js_free_rt(rt, cl);
  }
}

JSValue
js_callback_wrap(JSContext* ctx, JSValueConst proto, JSCallback* cl) {
  JSValue obj = JS_NewObjectProtoClass(ctx, proto, js_callback_class_id);

  if(JS_IsException(obj))
    return JS_EXCEPTION;

  JS_SetOpaque(obj, cl);
  return obj;
}

static JSValue
js_callback_constructor(JSContext* ctx, JSValueConst new_target, int argc, JSValueConst argv[]) {
  JSCallback* cl;
  JSValueConst func_obj = argc > 0 ? argv[0] : JS_UNDEFINED;
  JSValueConst options = argc > 1 ? argv[1] : JS_UNDEFINED;

  if(!JS_IsFunction(ctx, func_obj))
    return JS_ThrowTypeError(ctx, "JSCallback: argument 1 must be a function");

  if(!(cl = js_callback_new(ctx, func_obj, options)))
    return JS_EXCEPTION;

  JSValue proto = JS_GetPropertyStr(ctx, new_target, "prototype");

  if(JS_IsException(proto)) {
    js_callback_free(JS_GetRuntime(ctx), cl);
    return JS_EXCEPTION;
  }

  JSValue obj = JS_NewObjectProtoClass(ctx, proto, js_callback_class_id);
  JS_FreeValue(ctx, proto);

  if(JS_IsException(obj)) {
    js_callback_free(JS_GetRuntime(ctx), cl);
    return JS_EXCEPTION;
  }

  JS_SetOpaque(obj, cl);
  return obj;
}

static JSValue
js_callback_close(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  JSCallback* cl;

  if(!(cl = js_callback_data2(ctx, this_val)))
    return JS_EXCEPTION;

  js_callback_release(ctx, cl);
  return JS_UNDEFINED;
}

static JSValue
js_callback_tostring(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  JSCallback* cl;
  char buf[64];

  if(!(cl = js_callback_data2(ctx, this_val)))
    return JS_EXCEPTION;

  snprintf(buf, sizeof(buf), "#JSCallback (%p)(*%p)", cl->code, cl);
  return JS_NewString(ctx, buf);
}

enum {
  PROP_LIST,
  PROP_PTR,
  PROP_CALLED,
  PROP_FUNCOBJ,
  PROP_EXCEPTION,
};

static JSValue
js_callback_get(JSContext* ctx, JSValueConst this_val, int magic) {
  JSCallback* cl;

  if(magic != PROP_LIST)
    if(!(cl = js_callback_data2(ctx, this_val)))
      return JS_EXCEPTION;

  switch(magic) {
    case PROP_LIST: {
      JSValue ret = JS_NewArray(ctx);
      struct list_head* el;
      uint32_t i = 0;

      if(callback_list.next)
        list_for_each(el, &callback_list) {
          JSValue element = js_callback_wrap(ctx, js_callback_proto, callback_dup(list_entry(el, JSCallback, link)));
          JS_SetPropertyUint32(ctx, ret, i++, element);
        }

      return ret;
    }

    case PROP_PTR: return js_newptr(ctx, cl->code);
    case PROP_CALLED: return JS_NewInt32(ctx, cl->called);
    case PROP_FUNCOBJ: return JS_DupValue(ctx, cl->func);
    case PROP_EXCEPTION: return JS_DupValue(ctx, cl->exception);
  }

  return JS_UNDEFINED;
}

static void
js_callback_finalizer(JSRuntime* rt, JSValue val) {
  JSCallback* cl;

  if((cl = JS_GetOpaque(val, js_callback_class_id)))
    js_callback_free(rt, cl);
}

static JSClassDef js_callback_class = {
    .class_name = "JSCallback",
    .finalizer = js_callback_finalizer,
};

static const JSCFunctionListEntry js_callback_proto_funcs[] = {
    JS_CFUNC_DEF("close", 0, js_callback_close),
    JS_CFUNC_DEF("toString", 0, js_callback_tostring),
    JS_CGETSET_MAGIC_DEF("ptr", js_callback_get, 0, PROP_PTR),
    JS_CGETSET_MAGIC_DEF("called", js_callback_get, 0, PROP_CALLED),
    JS_CGETSET_MAGIC_DEF("funcObj", js_callback_get, 0, PROP_FUNCOBJ),
    JS_CGETSET_MAGIC_DEF("exception", js_callback_get, 0, PROP_EXCEPTION),
    JS_PROP_STRING_DEF("[Symbol.toStringTag]", "JSCallback", JS_PROP_CONFIGURABLE),
};

static const JSCFunctionListEntry js_callback_static_funcs[] = {
    JS_CGETSET_MAGIC_DEF("list", js_callback_get, 0, PROP_LIST),
};

int
js_callback_init(JSContext* ctx, JSModuleDef* m) {
  JS_NewClassID(&js_callback_class_id);
  JS_NewClass(JS_GetRuntime(ctx), js_callback_class_id, &js_callback_class);

  js_callback_proto = JS_NewObject(ctx);
  JS_SetPropertyFunctionList(ctx, js_callback_proto, js_callback_proto_funcs, countof(js_callback_proto_funcs));
  JS_SetClassProto(ctx, js_callback_class_id, js_callback_proto);

  js_callback_ctor = JS_NewCFunction2(ctx, js_callback_constructor, "JSCallback", 1, JS_CFUNC_constructor, 0);

  JS_SetConstructor(ctx, js_callback_ctor, js_callback_proto);
  JS_SetPropertyFunctionList(ctx, js_callback_ctor, js_callback_static_funcs, countof(js_callback_static_funcs));

  if(m)
    JS_SetModuleExport(ctx, m, "JSCallback", js_callback_ctor);

  return 0;
}
