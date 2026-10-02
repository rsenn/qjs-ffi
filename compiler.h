#ifndef QJSFFI_COMPILER_H
#define QJSFFI_COMPILER_H

#include <quickjs.h>

/* cc: compiles C in memory with TinyCC and binds it (bun:ffi's cc()).
 *
 * ```js
 * const { symbols } = cc({
 *   source: "add.c",
 *   symbols: { add: { args: ["i32", "i32"], returns: "i32" } },
 * });
 * symbols.add(1, 2); // 3
 * ```
 *
 *   string|buffer    source   a C file name, or the C text as a buffer
 *   object           symbols  { name: { args, returns } }, or
 *                             { name: { type } } for a variable
 *   string|string[]  library  libraries to link, e.g. ["sqlite3"]
 *   string|string[]  include  include directories, as -I
 *   string|string[]  flags    compiler flags such as -D and -L
 *   object           define   preprocessor definitions { NAME: "value" }
 *
 *   returns  { symbols } as dlopen() gives
 *   throws   TypeError for bad options or a missing symbol;
 *            InternalError with the compiler's message on a C error
 *
 * only built when ENABLE_TCC is set (CONFIG_TCC defined).
 */

JSValue js_compiler_cc(JSContext*, JSValueConst this_val, int argc, JSValueConst argv[]);

#endif /* defined(QJSFFI_COMPILER_H) */
