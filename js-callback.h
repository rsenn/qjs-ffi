#ifndef QJSFFI_JS_CALLBACK_H
#define QJSFFI_JS_CALLBACK_H

#include <quickjs.h>
#include <list.h>
#include <ffi.h>

/* JSCallback: a native function pointer (.ptr) that, when called by C code,
 * invokes a JS function. Mirrors bun:ffi's JSCallback:
 *
 *   const cb = new JSCallback(fn, { args: [...], returns: ... });
 *   someNativeApiExpectingAFunctionPointer(cb.ptr);
 *   ...
 *   cb.close();
 *
 * Each instance owns its own ffi_closure/ffi_cif built from the declared
 * arg/return types, so .ptr is a real trampoline that marshals the actual
 * native call arguments into JS values (and the JS return value back into
 * the native ABI return slot) -- unlike the previous CallClosure, which
 * always invoked the JS function with zero arguments.
 */
typedef struct JSCallback {
  int ref_count, called;
  JSContext* ctx;
  struct list_head link;
  JSValue exception, func;
  ffi_cif cif;
  ffi_closure* closure;
  void* code;
  int argc;
  ffi_type** arg_types;
  int* arg_kind;
  ffi_type* ret_type;
  int ret_kind;
} JSCallback;

extern JSClassID js_callback_class_id;
extern JSValue js_callback_proto, js_callback_ctor;

JSCallback* js_callback_new(JSContext*, JSValueConst func, JSValueConst options);
void js_callback_free(JSRuntime*, JSCallback*);
JSValue js_callback_wrap(JSContext*, JSValueConst proto, JSCallback*);
int js_callback_init(JSContext*, JSModuleDef*);

static inline JSCallback*
js_callback_data(JSValueConst value) {
  return JS_GetOpaque(value, js_callback_class_id);
}

static inline JSCallback*
js_callback_data2(JSContext* ctx, JSValueConst value) {
  return JS_GetOpaque2(ctx, value, js_callback_class_id);
}

#endif /* defined(QJSFFI_JS_CALLBACK_H) */
