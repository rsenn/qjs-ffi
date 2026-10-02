#!/usr/bin/env qjsm
/* gen-bindings.js -- generate qjs-ffi JS bindings from a C source file's AST.
 *
 * Runs in two phases joined by an intermediate JSON format (the "IR"):
 *
 *   1. clang -> IR:  `clang -Xclang -ast-dump=json -fsyntax-only` output is
 *      tokenized with json.JsonParser and condensed on the fly to just the
 *      nodes needed here (the condensed AST is cached, see --cache-dir), then
 *      the top-level, externally visible functions, enums, structs/unions and
 *      variables are extracted into an IR shaped like describeObject() /
 *      describeClass() output (qjs-modules lib/describe-*.js): `methods` holds
 *      kind:"function" entries with `args` ("name: type") and `returns`,
 *      `fields` holds variables, `enums`/`structs` the compound types.
 *   2. IR -> JS:     the IR alone (no clang) is turned into a JS module.
 *
 * The JS module emitted is either:
 *
 *   --api=cfunction (default) -- one `CFunction({ ptr, args, returns })`
 *                                 per function(see doc/c-function.md)
 *   --api=define              -- one `define()`+`call()` pair per function,
 *                                 wrapped in a plain JS function(legacy API)
 *
 * C++ classes (see --c++) become `export class ns_Name`, extending their
 * first public base class; see classesCode() for what a class offers.
 *
 * Also emits `export const NAME = value;` for every enum reachable from a
 * bound function's args/returns (enum-typed or enum-typedef-typed), so
 * callers get the same symbolic constants the C API uses.
 *
 * Usage:
 *   qjsm gen-bindings.js [options] <source.c>...
 *   qjsm gen-bindings.js [options] --from-ir=<ir.json>
 *
 * Several sources are merged into one output, with a function or enum
 * constant declared in more than one of them emitted once.
 *
 * Options:
 *   --api=cfunction|define   which qjs-ffi API to target (default: cfunction)
 *   --follow-includes        also bind functions from every header under a
 *                            source's own directory that it (transitively)
 *                            includes, e.g. SDL.h -> SDL_video.h, SDL_render.h
 *   --ffitype                write types as FFIType.i32 instead of "i32" (cfunction
 *                            API only); imports FFIType from 'ffi'
 *   --structs                also emit, for every struct/union of the sources, a
 *                            class extending ArrayBuffer (see gen-structs.js:
 *                            member accessors, `new Name()`, `Name.at(ptr)`,
 *                            `.ptr`; its typedef names are aliases) that can be
 *                            passed to a pointer parameter as it is, with the
 *                            layout in `Name.size/align/fields`, and for every
 *                            extern variable an accessor { ptr, value }
 *   --finalize               a C++ object made with `new` is also destroyed (its
 *                            destructor run and its memory freed) when it is
 *                            garbage collected, not only by .delete(); the
 *                            object then lives in calloc'd memory, and the
 *                            destructor runs on a later turn of the event loop
 *                            (--api=cfunction)
 *   --describe               name the parameters of every bound function, method
 *                            and constructor in its JS signature, and attach
 *                            each one's C types and overloads as
 *                            fn[Symbol.for('describe')], so describeObject() /
 *                            describeClass() (qjs-modules lib/describe-*.js)
 *                            report them; plain C functions become wrappers
 *   --jsdoc                  put a JSDoc comment (@param {type} name - C type,
 *                            @returns, @overload per overload) before every
 *                            bound function, method and class
 *   --exclude=<name>         do not bind this function(repeatable), e.g. one
 *                            the shared library does not actually export
 *   --c++                    parse every source as C++ (implied by a .cc, .cpp,
 *                            .cxx, .hh, .hpp or .hxx extension; a .h needs this)
 *   --std=<std>              C++ standard passed to clang, e.g. c++17
 *   --namespace=<name>       drop the C++ namespace prefix <name>:: from generated
 *                            class/function names (stk::Foo -> Foo instead of stk_Foo);
 *                            repeatable, every listed namespace is dropped (with
 *                            a and b, a::b::Foo is Foo)
 *   -I<dir>                  extra clang include dir (repeatable)
 *   -D<name[=val]>           extra clang macro define (repeatable)
 *   --library=<path>         dlopen() this shared library instead of
 *                            assuming the symbols are already loaded
 *                            (RTLD_DEFAULT)
 *   --clang=<path>           clang binary to invoke (default: "clang")
 *   --emit-ir=<file>         write the intermediate JSON and stop (no JS output)
 *   --from-ir=<file>         generate from this IR instead of running clang
 *   --cache-dir=<dir>        condensed-AST cache directory (default: .tmp/gen-bindings)
 *   --no-cache               ignore and do not write the condensed-AST cache
 *   -o, --output=<path>      write generated JS here instead of stdout
 *   -h, --help               show this help
 */
import { main } from './gen-bindings/main.js';

main();
