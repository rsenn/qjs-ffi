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
 * The returned JS function's own closure data holds the ffi_cif/fp/arg-type
 * array built once at construction time -- calling it invokes libffi
 * directly against that stored cif, so there is nothing to look up (no
 * strcmp scan, unlike ffi.c's legacy define()/call()).
 */
int js_cfunction_init(JSContext*, JSModuleDef*);

#endif /* defined(QJSFFI_C_FUNCTION_H) */
