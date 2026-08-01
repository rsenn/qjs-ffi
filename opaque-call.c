#include "opaque-call.h"
#include <list.h>

static struct list_head opaque_list;

int64_t
opaque_call(void* arg) {
  OpaqueCall* call = arg;

  JSValue ret = JS_Call(call->ctx, call->func, call->this, 0, 0);
  int64_t result;
  JS_ToInt64(call->ctx, &result, ret);
  JS_FreeValue(call->ctx, ret);
  return result;
}

OpaqueCall*
opaque_new(JSContext* ctx, JSValueConst func) {
  OpaqueCall* closure;

  if(!(closure = js_malloc(ctx, sizeof(OpaqueCall))))
    return NULL;

  if(!opaque_list.next)
    init_list_head(&opaque_list);

  list_add(&closure->link, &opaque_list);

  closure->ctx = JS_DupContext(ctx);
  closure->func = JS_DupValue(ctx, func);
  closure->this = JS_UNDEFINED;
  return closure;
}

void
opaque_free(JSContext* ctx, OpaqueCall* closure) {
  JS_FreeValue(ctx, closure->func);
  JS_FreeValue(ctx, closure->this);
  JS_FreeContext(closure->ctx);

  list_del(&closure->link);

  js_free(ctx, closure);
}
