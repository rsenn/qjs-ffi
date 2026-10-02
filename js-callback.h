#ifndef QJSFFI_JS_CALLBACK_H
#define QJSFFI_JS_CALLBACK_H

#include <quickjs.h>
#include <list.h>
#include <ffi.h>
#include "ffi-type.h"

/* JSCallback: a native function pointer that calls a JS function
 * (bun:ffi's JSCallback).
 *
 * ```js
 * const cb = new JSCallback(fn, { args: ["i32"], returns: "i32" });
 * nativeApi(cb.ptr); // when C calls it, fn runs with the C arguments
 * cb.close();
 * ```
 *
 *   function  fn       receives the native arguments, converted
 *   type[]    args     argument types, default none
 *   type      returns  default "void"
 *
 *   cb.ptr        the function pointer; null once closed
 *   cb.called     how many times C has called it
 *   cb.exception  what fn threw in the last call, else undefined
 *   cb.funcObj    fn
 *   cb.close()    frees the trampoline; same as [Symbol.dispose]
 *
 *   throws  TypeError if fn is not a function
 *
 * each instance owns its ffi_closure and cif, built from `args` and
 * `returns`, so .ptr is a real trampoline.
 */
typedef struct JSCallback {
  int ref_count, called;
  JSContext* ctx;
  struct list_head link;
  JSValue exception, func;
  ffi_cif cif;
  ffi_closure* closure;
  void* code;
  FFISignature sig;
} JSCallback;

extern JSClassID js_callback_class_id;

/* exports JSCallback from the module.
 *
 *   JSModuleDef*  m         receives the export; may be NULL
 *   JSValueConst  defaults  if an object, also gets JSCallback (the
 *                           default export)
 */
int js_callback_init(JSContext*, JSModuleDef*, JSValueConst defaults);

/* sets `proto[Symbol.dispose]` to `proto.close`, so `using` works. */
void js_callback_define_dispose(JSContext*, JSValueConst proto);

static inline JSCallback*
js_callback_data(JSValueConst value) {
  return JS_GetOpaque(value, js_callback_class_id);
}

static inline JSCallback*
js_callback_data2(JSContext* ctx, JSValueConst value) {
  return JS_GetOpaque2(ctx, value, js_callback_class_id);
}

#endif /* defined(QJSFFI_JS_CALLBACK_H) */
