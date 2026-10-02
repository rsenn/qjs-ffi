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

/* Resolves `name` against an opaque `handle` (dlopen's handle, a TCCState..). */
typedef void* js_symbol_resolver(void* handle, const char* name);

/* { name: CFunction } for every key of `symbol_specs`, each looked up with
 * `resolve` (dlsym when NULL). With `linked`, a spec's own `ptr` takes
 * precedence. `who` prefixes error messages. */
JSValue js_build_symbols(JSContext*, void* handle, JSValueConst symbol_specs, int linked, const char* who, js_symbol_resolver* resolve);

/* Data symbols: a spec with `type` (and not `args`/`returns`) is a variable.
 * js_is_data_spec() is 1 for one, 0 for a function spec, -1 (TypeError) for a
 * mix. js_variable_define() defines property `prop` of `obj` for the variable
 * at `addr`: an accessor over its memory, or with `address: true` the address
 * as a pointer value. `who` and `name` prefix error messages. Returns 0 or -1. */
int js_is_data_spec(JSContext*, JSValueConst spec, const char* who, const char* name);
int js_variable_define(JSContext*, JSValueConst obj, JSAtom prop, void* addr, JSValueConst spec, const char* who, const char* name);

/* `defaults`, if an object, also gets CFunction (the module's default export). */
int js_cfunction_init(JSContext*, JSModuleDef*, JSValueConst defaults);

#endif /* defined(QJSFFI_C_FUNCTION_H) */
