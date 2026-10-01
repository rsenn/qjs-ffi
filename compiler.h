#ifndef QJSFFI_COMPILER_H
#define QJSFFI_COMPILER_H

#include <quickjs.h>

/* cc({ source, symbols, library, flags, define }) -- as Bun's bun:ffi cc()
 * (https://bun.com/docs/runtime/c-compiler): compiles and links the C file
 * `source` (a file name, or else an ArrayBuffer/TypedArray/DataView holding
 * the C source text) in memory with libtcc and returns
 * { symbols: { name: CFunction } } for every entry of `symbols`
 * ({ args, returns }, as for dlopen()).
 *
 *   library: string | string[]   libraries to link, e.g. ["sqlite3"]
 *   flags:   string | string[]   compiler flags such as -I and -D
 *   define:  { NAME: "value" }   preprocessor definitions
 *
 * Only built when ENABLE_TCC is set (CONFIG_TCC defined).
 */

JSValue js_compiler_cc(JSContext*, JSValueConst this_val, int argc, JSValueConst argv[]);

#endif /* defined(QJSFFI_COMPILER_H) */
