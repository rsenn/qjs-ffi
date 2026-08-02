#include "opaque-call.h"
#include <list.h>
#include <cutils.h>

JSClassID js_closure_class_id;
JSValue opaque_call_proto, opaque_call_ctor;

static struct list_head opaque_list;

static CallClosure*
opaque_dup(CallClosure* cl) {
  ++cl->ref_count;
  return cl;
}

static int64_t
opaque_call(void* arg) {
  CallClosure* call = arg;
  JSContext* ctx = call->ctx;

  JSValue ret = JS_Call(ctx, call->func, call->this, 0, 0);
  int64_t result;
  JS_ToInt64(ctx, &result, ret);
  JS_FreeValue(ctx, ret);

  call->called++;

  return result;
}

CallFunction*
opaque_address(void) {
  return &opaque_call;
}

static CallClosure*
opaque_realloc(JSContext* ctx, CallClosure* cl, int argc) {
  CallClosure* closure;
  int oldargc = cl->argc;

  if(!(closure = js_realloc(ctx, cl, sizeof(CallClosure) + sizeof(JSValue) * argc)))
    return NULL;

  if(oldargc < argc) {
    for(int i = oldargc; i < argc; i++)
      closure->args[i] = JS_UNDEFINED;

  } else if(oldargc > argc) {
    for(int i = argc; i < oldargc; i++) {
      JS_FreeValue(ctx, closure->args[i]);
      closure->args[i] = JS_UNDEFINED;
    }
  }

  cl->argc = argc;
  return closure;
}

CallClosure*
opaque_new(JSContext* ctx, JSValueConst func_obj, JSValueConst this_obj, int argc, const JSValueConst argv[]) {
  CallClosure* cl;

  if(!(cl = js_mallocz(ctx, sizeof(CallClosure) + sizeof(JSValue) * argc)))
    return NULL;

  if(!opaque_list.next)
    init_list_head(&opaque_list);

  list_add(&cl->link, &opaque_list);

  cl->ref_count = 1;
  cl->called = 0;
  cl->index = 0;
  cl->ctx = ctx;
  cl->exception = JS_NULL;
  cl->func = JS_DupValue(ctx, func_obj);
  cl->this = JS_DupValue(ctx, this_obj);

  for(int i = 0; i < argc; i++)
    cl->args[i] = JS_DupValue(ctx, argv[i]);

  cl->argc = argc;
  return cl;
}

static void
opaque_free(JSRuntime* rt, CallClosure* cl) {
  if(--cl->ref_count <= 0) {
    JS_FreeValueRT(rt, cl->func);
    JS_FreeValueRT(rt, cl->this);

    for(int i = 0; i < cl->argc; i++)
      JS_FreeValueRT(rt, cl->args[i]);

    list_del(&cl->link);

    js_free_rt(rt, cl);
  }
}

JSValue
js_closure_wrap(JSContext* ctx, JSValueConst proto, CallClosure* cl) {
  JSValue obj = JS_NewObjectProtoClass(ctx, proto, js_closure_class_id);

  if(JS_IsException(obj))
    return JS_EXCEPTION;

  JS_SetOpaque(obj, cl);
  return obj;
}

static JSValue
js_closure_constructor(JSContext* ctx, JSValueConst new_target, int argc, JSValueConst argv[]) {
  CallClosure* cl;

  if((cl = JS_GetOpaque(argv[0], js_closure_class_id))) {
    CallClosure* tmp;

    if(!(tmp = opaque_new(ctx, cl->func, cl->this, cl->argc, cl->args)))
      return JS_EXCEPTION;

    cl = tmp;
  } else {
    JSValueConst func_obj = argc > 0 ? argv[0] : JS_NULL;
    JSValueConst this_obj = argc > 1 ? argv[1] : JS_NULL;

    if(!(cl = opaque_new(ctx, func_obj, this_obj, argc >= 2 ? argc - 2 : 0, argc >= 2 ? argv + 2 : 0)))
      return JS_EXCEPTION;
  }

  /* using new_target to get the prototype is necessary when the class is extended. */
  JSValue proto = JS_GetPropertyStr(ctx, new_target, "prototype");
  if(JS_IsException(proto))
    goto fail;

  JSValue obj = JS_NewObjectProtoClass(ctx, proto, js_closure_class_id);
  JS_FreeValue(ctx, proto);
  if(JS_IsException(obj))
    goto fail;

  JS_SetOpaque(obj, cl);
  return obj;

fail:
  js_free(ctx, cl);
  JS_FreeValue(ctx, obj);
  return JS_EXCEPTION;
}

static JSValue
js_closure_call(JSContext* ctx, JSValueConst func_obj, JSValueConst this_val, int argc, JSValueConst argv[], int flags) {
  CallClosure* cl;

  if(!(cl = js_closure_data2(ctx, func_obj)))
    return JS_EXCEPTION;

  int n = 0;
  JSValueConst args[argc + cl->argc];

  for(int i = 0; i < cl->argc; i++)
    args[n++] = cl->args[i];

  for(int i = 0; i < argc; i++)
    args[n++] = argv[i];

  JSValue ret = JS_Call(ctx, cl->func, cl->this, n, args);

  if(JS_IsException(ret)) {
    JS_FreeValue(ctx, cl->exception);
    cl->exception = JS_GetException(ctx);
  } else {
    cl->called++;
  }

  return ret;
}

enum {
  METHOD_CLONE,
  METHOD_CLEAR,
};

static JSValue
js_closure_method(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[], int magic) {
  JSValue ret = JS_UNDEFINED;
  CallClosure* cl;

  if(!(cl = js_closure_data2(ctx, this_val)))
    return JS_EXCEPTION;

  switch(magic) {
    case METHOD_CLONE: {
      ret = js_closure_new(ctx, cl->func, cl->this, cl->argc, cl->args);
      break;
    }

    case METHOD_CLEAR: {
      JS_FreeValue(ctx, cl->func);
      cl->func = JS_UNDEFINED;
      JS_FreeValue(ctx, cl->this);
      cl->this = JS_UNDEFINED;

      for(int i = 0; i < cl->argc; i++) {
        JS_FreeValue(ctx, cl->args[i]);
        cl->args[i] = JS_UNDEFINED;
      }

      cl->argc = 0;
      cl->called = 0;
      break;
    }
  }

  return ret;
}

enum {
  PROP_LIST,
  PROP_CALLADDR,
  PROP_OPAQUE,
  PROP_CALLED,
  PROP_FUNCOBJ,
  PROP_THISOBJ,
  PROP_ARGC,
  PROP_ARGS,
  PROP_EXCEPTION,
};

static JSValue
js_closure_get(JSContext* ctx, JSValueConst this_val, int magic) {
  const CallClosure* cl;
  void* addr = 0;

  if(magic >= PROP_CALLED)
    if(!(cl = JS_GetOpaque(this_val, js_closure_class_id)))
      return JS_EXCEPTION;

  switch(magic) {
    case PROP_LIST: {
      JSValue ret = JS_NewArray(ctx);
      struct list_head* el;
      uint32_t i = 0;

      list_for_each(el, &opaque_list) {
        JSValue element = js_closure_wrap(ctx, opaque_call_proto, opaque_dup(list_entry(el, CallClosure, link)));
        JS_SetPropertyUint32(ctx, ret, i++, element);
      }

      return ret;
    }

    case PROP_CALLADDR: {
      addr = opaque_address();
      break;
    }

    case PROP_OPAQUE: {
      addr = JS_GetOpaque(this_val, js_closure_class_id);
      break;
    }

    case PROP_CALLED: {
      return JS_NewInt32(ctx, cl->called);
    }

    case PROP_FUNCOBJ: {
      return JS_DupValue(ctx, cl->func);
    }

    case PROP_THISOBJ: {
      return JS_DupValue(ctx, cl->this);
    }

    case PROP_ARGC: {
      return JS_NewInt32(ctx, cl->argc);
    }

    case PROP_ARGS: {
      JSValue ret = JS_NewArray(ctx);

      for(int i = 0; i < cl->argc; i++)
        JS_SetPropertyUint32(ctx, ret, i, JS_DupValue(ctx, cl->args[i]));

      return ret;
    }

    case PROP_EXCEPTION: {
      return JS_DupValue(ctx, cl->exception);
    }
  }

  char buf[sizeof(void*) * 2 + 3];
  return JS_NewStringLen(ctx, buf, snprintf(buf, sizeof(buf), "%p", addr));
}

static JSValue
js_closure_set(JSContext* ctx, JSValueConst this_val, JSValueConst value, int magic) {
  CallClosure* cl;

  if(!(cl = js_closure_data2(ctx, this_val)))
    return JS_EXCEPTION;

  switch(magic) {
    case PROP_FUNCOBJ: {
      JS_FreeValue(ctx, cl->func);

      cl->func = JS_DupValue(ctx, value);
      break;
    }

    case PROP_THISOBJ: {
      JS_FreeValue(ctx, cl->this);

      cl->this = JS_DupValue(ctx, value);
      break;
    }

    case PROP_ARGS: {
      JSValue lenprop = JS_GetPropertyStr(ctx, value, "length");
      uint32_t len = 0;
      int nargs = cl->argc;
      JS_ToUint32(ctx, &len, lenprop);
      JS_FreeValue(ctx, lenprop);
      JS_SetOpaque(this_val, 0);

      for(int i = 0; i < nargs; i++) {
        JS_FreeValue(ctx, cl->args[i]);
        cl->args[i] = JS_UNDEFINED;
      }

      if(!(cl = opaque_realloc(ctx, cl, len)))
        return JS_EXCEPTION;

      for(uint32_t i = 0; i < len; i++) {
        JSValue member = JS_GetPropertyUint32(ctx, value, i);
        cl->args[i] = member;
      }

      cl->argc = len;
      JS_SetOpaque(this_val, cl);
      break;
    }

    case PROP_EXCEPTION: {
      JS_FreeValue(ctx, cl->exception);
      cl->exception = JS_DupValue(ctx, value);
      break;
    }
  }

  return JS_UNDEFINED;
}

static void
js_closure_finalizer(JSRuntime* rt, JSValue val) {
  CallClosure* cl;

  if((cl = JS_GetOpaque(val, js_closure_class_id))) {
    opaque_free(rt, cl);
  }
}

static JSClassDef js_closure_class = {
    .class_name = "CallClosure",
    .finalizer = js_closure_finalizer,
    .call = js_closure_call,
};

static const JSCFunctionListEntry js_closure_proto_funcs[] = {
    JS_CFUNC_MAGIC_DEF("clone", 0, js_closure_method, METHOD_CLONE),
    JS_CFUNC_MAGIC_DEF("clear", 0, js_closure_method, METHOD_CLEAR),
    JS_CGETSET_MAGIC_DEF("calladdr", js_closure_get, 0, PROP_CALLADDR),
    JS_CGETSET_MAGIC_DEF("opaque", js_closure_get, 0, PROP_OPAQUE),
    JS_CGETSET_MAGIC_DEF("called", js_closure_get, 0, PROP_CALLED),
    JS_CGETSET_MAGIC_DEF("thisObj", js_closure_get, js_closure_set, PROP_THISOBJ),
    JS_CGETSET_MAGIC_DEF("funcObj", js_closure_get, js_closure_set, PROP_FUNCOBJ),
    JS_CGETSET_MAGIC_DEF("argc", js_closure_get, 0, PROP_ARGC),
    JS_CGETSET_MAGIC_DEF("args", js_closure_get, js_closure_set, PROP_ARGS),
    JS_CGETSET_MAGIC_DEF("exception", js_closure_get, js_closure_set, PROP_EXCEPTION),
    JS_PROP_STRING_DEF("[Symbol.toStringTag]", "CallClosure", JS_PROP_CONFIGURABLE),
};

enum {
  FUNC_CREATE = 0,
};

static JSValue
js_closure_function(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[], int magic) {
  JSValue ret = JS_UNDEFINED;

  switch(magic) {
    case FUNC_CREATE: {
      CallClosure* cl;
      JSValueConst func_obj = argc > 0 ? argv[0] : JS_NULL;
      JSValueConst this_obj = argc > 1 ? argv[1] : JS_NULL;

      if(!(cl = opaque_new(ctx, func_obj, this_obj, argc >= 2 ? argc - 2 : 0, argc >= 2 ? argv + 2 : 0)))
        return JS_EXCEPTION;

      ret = js_closure_wrap(ctx, opaque_call_proto, cl);
      break;
    }
  }

  return ret;
}

static const JSCFunctionListEntry js_closure_static_funcs[] = {
    JS_CFUNC_MAGIC_DEF("create", 0, js_closure_function, FUNC_CREATE),
    JS_CGETSET_MAGIC_DEF("list", js_closure_get, 0, PROP_LIST),
};

int
js_closure_init(JSContext* ctx, JSModuleDef* m) {
  JS_NewClassID(&js_closure_class_id);
  JS_NewClass(JS_GetRuntime(ctx), js_closure_class_id, &js_closure_class);

  JSValue tmp_func = JS_NewCFunctionMagic(ctx, js_closure_method, NULL, 0, JS_CFUNC_generic_magic, 0);
  JSValue func_proto = JS_GetPrototype(ctx, tmp_func);
  JS_FreeValue(ctx, tmp_func);

  opaque_call_proto = JS_NewObjectProto(ctx, func_proto);
  JS_SetPropertyFunctionList(ctx, opaque_call_proto, js_closure_proto_funcs, countof(js_closure_proto_funcs));
  JS_SetClassProto(ctx, js_closure_class_id, opaque_call_proto);

  opaque_call_ctor = JS_NewCFunction2(ctx, js_closure_constructor, "CallClosure", 1, JS_CFUNC_constructor, 0);

  JS_SetConstructor(ctx, opaque_call_ctor, opaque_call_proto);
  JS_SetPropertyFunctionList(ctx, opaque_call_ctor, js_closure_static_funcs, countof(js_closure_static_funcs));

  JS_FreeValue(ctx, func_proto);

  if(m)
    JS_SetModuleExport(ctx, m, "CallClosure", opaque_call_ctor);

  return 0;
}
