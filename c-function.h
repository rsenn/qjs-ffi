#ifndef QJSFFI_C_FUNCTION_H
#define QJSFFI_C_FUNCTION_H

#include <quickjs.h>

/* CFunction: wraps an already-resolved native function pointer as a plain
 * callable JS function, with no name-keyed registry involved. Mirrors
 * bun:ffi's CFunction:
 *
 *   const fn = CFunction({ ptr: dlsym(h, "strdup"), args: ["cstring"], returns: "cstring" });
 *   fn("hello");
 *
 * The returned object is itself the opaque holder of the ffi_cif/fp/arg-type
 * array built once at construction time, and is made callable via the
 * `.call` entry in its own JSClassDef (the same pattern qjs-lws's
 * JSCClosure uses, see js-utils.c:405-409) -- calling it invokes libffi
 * directly against that stored cif, so there is nothing to look up (no
 * strcmp scan, unlike ffi.c's legacy define()/call()).
 */

/* Builds a CFunction around `fp` from a `{ args, returns, abi }` spec; a
 * non-object spec yields a no-argument, void-returning function. Returns
 * JS_EXCEPTION on failure.
 */
JSValue js_cfunction_create(JSContext*, void* fp, JSValueConst spec);

int js_cfunction_init(JSContext*, JSModuleDef*);

#endif /* defined(QJSFFI_C_FUNCTION_H) */
