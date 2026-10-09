#!/usr/bin/env qjsm
/* gen-bindings.js: generates qjs-ffi bindings from C and C++ headers.
 *
 * ```sh
 * qjsm gen-bindings.js [options] <source.c>...
 * qjsm gen-bindings.js [options] --from-ir=<ir.json>
 * ```
 *
 * two phases, joined by the IR (see tools/gen-bindings/ir.js):
 *
 *   1. clang -> IR   the AST of `clang -Xclang -ast-dump=json`, condensed
 *                    to the functions, variables, enums, structs and
 *                    classes that can be bound (cached, see --cache-dir)
 *   2. IR -> output  a JS module of CFunction bindings, the symbol specs
 *                    for dlopen() (--emit-specs), or the IR (--emit-ir)
 *
 * several sources are merged into one output; a function or enum declared
 * in more than one is emitted once. --help lists the options, and
 * doc/gen-bindings.md explains them.
 */
import { main } from "./gen-bindings/main.js";

main();
