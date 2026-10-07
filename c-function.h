#ifndef QJSFFI_C_FUNCTION_H
#define QJSFFI_C_FUNCTION_H

#include <quickjs.h>

/* CFunction: a native function pointer as a plain JS function, as in
 * bun:ffi.
 *
 * ```js
 * const fn = CFunction({
 *   ptr: dlsym(h, "strdup"),
 *   args: ["cstring"],
 *   returns: "cstring",
 * });
 * fn("hello");
 * fn.close();
 * ```
 *
 *   number|bigint  ptr      address of the function, not NULL
 *   type[]         args     argument types, default none; an array
 *                           type is a struct by value
 *   type           returns  default "void"
 *   string         abi      libffi ABI name, default the platform's
 *
 *   throws  TypeError for a non-object argument, a NULL or bad ptr, or
 *           a type that does not parse; RangeError for a struct type
 *           that is empty, too long or nested too deep
 *
 * `new CFunction(...)` works too; the callable holds the cif, built
 * once, so a call does no name lookup.
 */

/* makes the JS function for one native function. */
JSValue js_cfunction_create(JSContext*, void* fp, JSValueConst spec, JSValueConst types);

/* finds the address of the symbol called `name`, or NULL.
 * dlsym() does it for a library; cc() has its own for the code it built. */
typedef void* js_symbol_resolver(void* handle, const char* name);

/* builds the `symbols` object that dlopen(), linkSymbols() and cc()
 * return, from the table the caller passed. */
JSValue js_build_symbols(JSContext*, void* handle, JSValueConst symbol_specs,
	int linked, const char* who, js_symbol_resolver* resolve, JSValueConst types);

/* tells a variable spec from a function spec.
 *
 * ```js
 * { type: "i32" }                    // variable: returns 1
 * { args: ["i32"], returns: "i32" }  // function: returns 0
 * { type: "i32", args: [] }          // both: TypeError, returns -1
 * ```
 */
int js_is_data_spec(JSContext*, JSValueConst spec, const char* who, const char* name);

/* defines the property for a constant or an enum, a spec with `value`
 * or `enum`; nothing is looked up in the library.
 *
 * ```js
 * { value: 4096 }                          // symbols.X is 4096
 * { value: 300, type: "u8" }               // RangeError
 * { enum: { RED: 0, BLUE: 4 }, type: "u32" }  // symbols.X.BLUE, X[4]
 * ```
 *
 * returns  1 if it defined one, 0 if `spec` is not a constant, -1 with an
 *          exception pending */
int js_constant_define(JSContext*, JSValueConst obj, JSAtom prop, JSValueConst spec, const char* who, const char* name);

/* defines the property for one variable on the symbols object.
 * returns  0, or -1 with an exception pending */
int js_variable_define(JSContext*, JSValueConst obj, JSAtom prop, void* addr, JSValueConst spec, const char* who, const char* name, JSValueConst types);

/* sets up the CFunction class and exports it. */
int js_cfunction_init(JSContext*, JSModuleDef*, JSValueConst defaults);

#endif /* defined(QJSFFI_C_FUNCTION_H) */
