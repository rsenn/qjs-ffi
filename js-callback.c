#include "js-callback.h"
#include "js-helpers.h"
#include <cutils.h>

JSClassID js_callback_class_id;
static JSValue js_callback_proto;

static struct list_head callback_list;

/* the exception a callback threw inside the CFunction call now running,
 * if any: the first one wins. */
static JSValue pending_exception;
static int pending_set;
static int call_depth;

void
js_callback_scope_begin(CallbackScope* scope) {
  scope->outer = pending_exception;
  scope->outer_set = pending_set;
  pending_exception = JS_UNDEFINED;
  pending_set = 0;
  call_depth++;
}

int
js_callback_scope_end(CallbackScope* scope, JSValue* thrown) {
  int set = pending_set;

  *thrown = pending_exception;
  pending_exception = scope->outer;
  pending_set = scope->outer_set;
  call_depth--;
  return set;
}

/* keeps the exception now pending in `ctx` as cl->exception, and for the
 * call that is running to throw; with no call running it stays in
 * cl->exception only. */
static void
callback_threw(JSContext* ctx, JSCallback* cl) {
  JSValue e = JS_GetException(ctx);

  JS_FreeValue(ctx, cl->exception);
  cl->exception = JS_DupValue(ctx, e);

  if(call_depth > 0 && !pending_set) {
    pending_exception = e;
    pending_set = 1;
  } else {
    JS_FreeValue(ctx, e);
  }
}

/* converts the JS function's return value into the native return slot.
 *
 * an integer narrower than a word is written as a full ffi_arg, sign- or
 * zero-extended: libffi closures require it, and a narrower write
 * corrupts the return register. arguments keep their declared size.
 *
 *   returns  0, or -1 with an exception pending
 */
static int
js_to_native_ret(JSContext* ctx, int kind, void* ret, JSValueConst v) {
  int64_t i64 = 0;
  double d = 0;

  switch(kind) {
    case K_VOID: return 0;
    case K_BOOL: *(ffi_arg*)ret = (ffi_arg)(JS_ToBool(ctx, v) > 0); return 0;

    case K_F32:
      if(JS_ToFloat64(ctx, &d, v))
        return -1;

      *(float*)ret = (float)d;
      return 0;

    case K_F64:
      if(JS_ToFloat64(ctx, &d, v))
        return -1;

      *(double*)ret = d;
      return 0;
  }

  if(JS_ToInt64Ext(ctx, &i64, v))
    return -1;

  switch(kind) {
    case K_I8: *(ffi_arg*)ret = (ffi_arg)(ffi_sarg)(int8_t)i64; break;
    case K_U8: *(ffi_arg*)ret = (ffi_arg)(uint8_t)i64; break;
    case K_I16: *(ffi_arg*)ret = (ffi_arg)(ffi_sarg)(int16_t)i64; break;
    case K_U16: *(ffi_arg*)ret = (ffi_arg)(uint16_t)i64; break;
    case K_I32: *(ffi_arg*)ret = (ffi_arg)(ffi_sarg)(int32_t)i64; break;
    case K_U32: *(ffi_arg*)ret = (ffi_arg)(uint32_t)i64; break;
    case K_I64:
    case K_I64_FAST: *(int64_t*)ret = i64; break;
    case K_U64:
    case K_U64_FAST: *(uint64_t*)ret = (uint64_t)i64; break;
    case K_POINTER:
    case K_CSTRING: *(void**)ret = (void*)(intptr_t)i64; break;
  }

  return 0;
}

static JSCallback*
callback_dup(JSCallback* cl) {
  ++cl->ref_count;
  return cl;
}

/* the libffi closure trampoline, which native code calls through
 * cl->code: converts the arguments, calls the JS function, converts
 * the result back. an exception is kept in cl->exception and thrown by
 * the CFunction call that led here (see CallbackScope). */
static void
js_callback_handler(ffi_cif* cif, void* ret, void** args, void* user_data) {
  JSCallback* cl = user_data;
  JSContext* ctx = cl->ctx;
  JSValue argv[FFI_MAX_ARGS];
  int i;

  for(i = 0; i < cl->sig.argc; i++)
    argv[i] = ffi_native_to_js(ctx, cl->sig.arg_kind[i], args[i]);

  JS_FreeValue(ctx, cl->exception);
  cl->exception = JS_UNDEFINED;

  JSValue r = JS_Call(ctx, cl->func, JS_UNDEFINED, cl->sig.argc, argv);

  for(i = 0; i < cl->sig.argc; i++)
    JS_FreeValue(ctx, argv[i]);

  cl->called++;

  if(JS_IsException(r)) {
    callback_threw(ctx, cl);
    r = JS_UNDEFINED;
  }

  if(js_to_native_ret(ctx, cl->sig.ret_kind, ret, r)) {
    callback_threw(ctx, cl);
    memset(ret, 0, sizeof(ffi_arg));
  }

  JS_FreeValue(ctx, r);
}

static void
js_callback_release(JSContext* ctx, JSCallback* cl) {
  if(cl->closure) {
    ffi_closure_free(cl->closure);
    cl->closure = NULL;
    cl->code = NULL;
  }

  ffi_sig_free(JS_GetRuntime(ctx), &cl->sig);
}

static JSCallback*
js_callback_new(JSContext* ctx, JSValueConst func_obj, JSValueConst options) {
  JSCallback* cl;

  if(!(cl = js_mallocz(ctx, sizeof(JSCallback))))
    return NULL;

  if(ffi_sig_parse(ctx, &cl->sig, options)) {
    js_free(ctx, cl);
    return NULL;
  }

  for(int i = 0; i < cl->sig.argc; i++)
    if(cl->sig.arg_kind[i] == K_BUFFER_LENGTH) {
      JS_ThrowTypeError(ctx, "JSCallback: buffer_length is not supported in a callback");
      ffi_sig_free(JS_GetRuntime(ctx), &cl->sig);
      js_free(ctx, cl);
      return NULL;
    }

  if(ffi_sig_has_struct(&cl->sig)) {
    JS_ThrowTypeError(ctx, "JSCallback: a struct passed or returned by value is not supported");
    ffi_sig_free(JS_GetRuntime(ctx), &cl->sig);
    js_free(ctx, cl);
    return NULL;
  }

  cl->ref_count = 1;
  cl->called = 0;
  cl->ctx = ctx;
  cl->exception = JS_UNDEFINED;
  cl->func = JS_DupValue(ctx, func_obj);

  if(!(cl->closure = ffi_closure_alloc(sizeof(ffi_closure), &cl->code)) ||
     ffi_prep_cif(&cl->cif, FFI_DEFAULT_ABI, cl->sig.argc, cl->sig.ret_type, cl->sig.arg_types) !=
         FFI_OK ||
     ffi_prep_closure_loc(cl->closure, &cl->cif, js_callback_handler, cl, cl->code) != FFI_OK) {
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

static void
js_callback_free(JSRuntime* rt, JSCallback* cl) {
  if(--cl->ref_count <= 0) {
    JS_FreeValueRT(rt, cl->func);
    JS_FreeValueRT(rt, cl->exception);

    if(cl->closure)
      ffi_closure_free(cl->closure);

    ffi_sig_free(rt, &cl->sig);

    list_del(&cl->link);
    js_free_rt(rt, cl);
  }
}

static JSValue
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

  JSValue obj = js_callback_wrap(ctx, proto, cl);
  JS_FreeValue(ctx, proto);

  if(JS_IsException(obj))
    js_callback_free(JS_GetRuntime(ctx), cl);

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
          JSValue element = js_callback_wrap(ctx, js_callback_proto,
                                             callback_dup(list_entry(el, JSCallback, link)));
          JS_SetPropertyUint32(ctx, ret, i++, element);
        }

      return ret;
    }

    case PROP_PTR: return js_new_pointer(ctx, cl->code);
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

/* cb[Symbol.toPrimitive](): the function pointer as a Number, 0 once
 * closed, so `+cb` is what to give C. */
static JSValue
js_callback_toprimitive(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  JSCallback* cl;

  if(!(cl = JS_GetOpaque2(ctx, this_val, js_callback_class_id)))
    return JS_EXCEPTION;

  return JS_NewInt64(ctx, (int64_t)(intptr_t)cl->code);
}

static const JSCFunctionListEntry js_callback_proto_funcs[] = {
    JS_CFUNC_DEF("[Symbol.toPrimitive]", 1, js_callback_toprimitive),
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

/* sets `proto[Symbol.dispose]` to `proto.close`, so `using` works.
 * the symbol is Symbol.dispose, or when the engine has none (QuickJS
 * does not yet) Symbol.for("Symbol.dispose"), as polyfills install it. */
void
js_callback_define_dispose(JSContext* ctx, JSValueConst proto) {
  JSValue global = JS_GetGlobalObject(ctx);
  JSValue Symbol = JS_GetPropertyStr(ctx, global, "Symbol");
  JSValue sym = JS_IsObject(Symbol) ? JS_GetPropertyStr(ctx, Symbol, "dispose") : JS_UNDEFINED;

  if(!JS_IsSymbol(sym) && JS_IsObject(Symbol)) {
    JSValue key = JS_NewString(ctx, "Symbol.dispose");
    JSAtom for_ = JS_NewAtom(ctx, "for");

    JS_FreeValue(ctx, sym);
    sym = JS_Invoke(ctx, Symbol, for_, 1, &key);
    JS_FreeAtom(ctx, for_);
    JS_FreeValue(ctx, key);
  }

  if(JS_IsSymbol(sym)) {
    JSAtom atom = JS_ValueToAtom(ctx, sym);

    JS_DefinePropertyValue(ctx, proto, atom, JS_GetPropertyStr(ctx, proto, "close"),
                           JS_PROP_CONFIGURABLE | JS_PROP_WRITABLE);
    JS_FreeAtom(ctx, atom);
  }

  JS_FreeValue(ctx, sym);
  JS_FreeValue(ctx, Symbol);
  JS_FreeValue(ctx, global);
}

int
js_callback_init(JSContext* ctx, JSModuleDef* m, JSValueConst defaults) {
  JS_NewClassID(&js_callback_class_id);
  JS_NewClass(JS_GetRuntime(ctx), js_callback_class_id, &js_callback_class);

  js_callback_proto = JS_NewObject(ctx);
  JS_SetPropertyFunctionList(ctx, js_callback_proto, js_callback_proto_funcs,
                             countof(js_callback_proto_funcs));
  js_callback_define_dispose(ctx, js_callback_proto);
  JS_SetClassProto(ctx, js_callback_class_id, js_callback_proto);

  JSValue ctor =
      JS_NewCFunction2(ctx, js_callback_constructor, "JSCallback", 1, JS_CFUNC_constructor, 0);

  JS_SetConstructor(ctx, ctor, js_callback_proto);
  JS_SetPropertyFunctionList(ctx, ctor, js_callback_static_funcs,
                             countof(js_callback_static_funcs));

  if(JS_IsObject(defaults))
    JS_SetPropertyStr(ctx, defaults, "JSCallback", JS_DupValue(ctx, ctor));

  if(m)
    JS_SetModuleExport(ctx, m, "JSCallback", ctor);
  else
    JS_FreeValue(ctx, ctor);

  return 0;
}
