#ifndef QJSFFI_OPAQUE_CALL_H
#define QJSFFI_OPAQUE_CALL_H

#include <quickjs.h>
#include <list.h>

typedef struct {
  int ref_count, called, index, argc;
  JSContext* ctx;
  struct list_head link;
  JSValue exception, func, this, args[];
} CallClosure;

typedef int64_t CallFunction(void*);

extern JSClassID js_closure_class_id;
extern JSValue opaque_call_proto, opaque_call_ctor;

CallFunction* opaque_address(void);
CallClosure* opaque_new(JSContext*, JSValueConst, JSValueConst, int, const JSValueConst[]);
void opaque_free(JSRuntime*, CallClosure*);
JSValue opaque_arraybuffer(JSContext*, CallClosure*);
JSValue js_closure_wrap(JSContext*, JSValueConst, CallClosure*);
int js_closure_init(JSContext*, JSModuleDef*);

static inline CallClosure*
js_closure_data(JSValueConst value) {
  return JS_GetOpaque(value, js_closure_class_id);
}

static inline CallClosure*
js_closure_data2(JSContext* ctx, JSValueConst value) {
  return JS_GetOpaque2(ctx, value, js_closure_class_id);
}

#define js_closure_new(ctx, args...) js_closure_wrap((ctx), opaque_call_proto, opaque_new((ctx), args))

#endif /* defined(QJSFFI_OPAQUE_CALL_H) */
