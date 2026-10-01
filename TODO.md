# TODO: Migrate qjs-ffi to a bun:ffi-compatible API

## 1. Current qjs-ffi API (as-is assessment)

### Shape

- Global, name-keyed function registry (`function_s` linked list, `ffi.c:23-31,215`).
  `define(name, fp, abi, rtype, ...argtypes)` builds an `ffi_cif` and prepends a
  `function_s` node. `call(name, ...args)` walks the list doing `strcmp` per node
  until it finds a match (`ffi.c:369-371`). `define()` itself also does a linear
  `strcmp` scan to reject duplicate names (`ffi.c:240-242`).
- Types are *also* a global linked list looked up by `strcmp`
  (`find_ffi_type`/`find_type`, `ffi.c:75-102`), scanned once per argument on
  every `define()` call.
- **This is the core problem the user flagged**: every `call()` pays an O(n)
  strcmp scan over every function ever defined, and every `define()` pays the
  same over both the function list and the type list. There is no handle
  returned from `define()` — the only way to invoke a function is to re-supply
  its string name to `call()`, which is what forces the scan to exist at all.
- Return values are always coerced into a single `double` (`call_function`,
  `ffi.c:456-484`) — real 64-bit ints/pointers above 2^53 are not
  representable.
- No varargs, no arrays. Documented as YAGNI in the existing README
  `TODO`/`Limitations` sections. (Struct-by-value has since been added, see
  "Done: struct by value".)
- Assumes little-endian.
- `dlopen`/`dlsym`/`dlclose`/`dlerror`/`errno` are thin 1:1 libdl/libc wrappers
  — these map cleanly onto bun:ffi's internal use of dlopen and don't need to
  change shape, just visibility (bun:ffi hides them behind `dlopen(path, symbols)`).

### `CallClosure` / `opaque-call.[ch]` (native callback support)

Done — rebuilt as `JSCallback` (`js-callback.c`/`js-callback.h`), a real
`ffi_closure`-based trampoline that marshals actual inbound native
arguments/return value per a declared `(args, returns)` signature. See
[`doc/js-callback.md`](doc/js-callback.md).

### Build/test surface

- `CMakeLists.txt` builds one shared module per binding (`ffi.c` +
  `js-callback.c` + `c-function.c` + `ffi-type.c` → `quickjs-ffi` MODULE,
  `CMakeLists.txt:110`).
- Existing smoke tests: `test.js`, `test2.js`, `test-ffi.js`, `test-portmidi.js`
  (manual, run under `qjsm`/`qjs`, no assertions/harness — visual inspection
  of `console.log` output).

## 2. Bun.js `bun:ffi` API (target shape)

Reference: <https://bun.com/docs/runtime/ffi>

```js
import { dlopen, FFIType, CFunction, JSCallback, ptr, toBuffer, toArrayBuffer, CString, suffix } from "bun:ffi";

const lib = dlopen(`libsqlite3.${suffix}`, {
  sqlite3_libversion: { args: [], returns: FFIType.cstring },
});
lib.symbols.sqlite3_libversion(); // called directly, no name lookup
lib.close();
```

### Key shape differences from qjs-ffi

| Aspect | qjs-ffi (current) | bun:ffi |
|---|---|---|
| Binding a function | `define(name, fp, abi, rtype, ...)` registers globally by string | `dlopen(path, { name: {args, returns} })` returns `{ symbols: { name: fn } }` — `fn` is a real callable bound directly to its own `cif`/`fp`, no name needed at call time |
| Calling | `call(name, ...args)` — global strcmp scan | `lib.symbols.name(...args)` — direct call through the object's own function pointer, O(1) |
| Wrapping a raw pointer (no dlopen) | not supported | `CFunction({ ptr, args, returns })` — one-off wrapper around an already-resolved pointer (e.g. from `dlsym`-equivalent or JIT'd code) |
| JS function → native function pointer | `CallClosure` (broken trampoline, see §1) | `new JSCallback(jsFn, { args, returns })` — real `ffi_closure`-based trampoline; `.ptr` is passed to native code, `.close()` frees it |
| Types | ad-hoc libffi names + C aliases + "string"/"buffer" semantic types, all in one flat string-keyed list | `FFIType` enum with a fixed small vocabulary: `bool, cstring, function, i8/u8, i16/u16, i32/u32, i64/u64, i64_fast/u64_fast, f32, f64, ptr/pointer, void, napi_env, napi_value` — string aliases resolve through a static table, not a mutable registry |
| Return value fidelity | always coerced to `double` | per-type: `i64`/`u64` return `bigint`, `i64_fast`/`u64_fast` return `number` when safe, `cstring` returns a decoded JS string, `ptr` returns a `number`/`bigint` address |
| Pointer/buffer helpers | `toPointer`, `toArrayBuffer`, `toString` (custom) | `ptr(buffer)`, `toBuffer(ptr, len)`, `toArrayBuffer(ptr, len)`, `CString` class (lazy pointer→string wrapper with `.length`, `byteOffset`) |
| Closing/lifetime | closures freed via GC finalizer only | `lib.close()` (dlclose + free all symbol wrappers), `callback.close()` (frees the `ffi_closure`) — explicit and GC |
| Platform suffix | none | `suffix` constant (`"so"`/`"dylib"`/`"dll"`) for building library filenames |
| Multiple libs, shared symbol table | not supported | `linkSymbols({ ... })` — define symbols without a `dlopen`, or merge several libs |

### What we will *not* chase in this migration

- `napi_env`/`napi_value` types (N-API interop) — no N-API layer exists in
  quickjs; out of scope.
- Bun's JIT'd fast-path (`tryCall`) internals — irrelevant, that's a V8/JSC
  engine-specific optimization we can't replicate in a libffi-backed module.
  Our equivalent optimization is simply: don't do string lookups (done, see
  `CFunction` in [`doc/c-function.md`](doc/c-function.md)).

## 3. Migration Plan

Each phase must independently build (`cmake --build build --target quickjs-ffi`)
and be exercised by a runnable `.js` test under `qjsm` before moving to the
next phase. Do not start a phase until the previous one's tests pass.
New/changed tests get the 5x flakiness check per
`.claude/rules/check-tests-for-flakiness.md`.

Phase 2 (`dlopen(path, symbolSpecs)`, bun-shaped) is done: `js_dlopen()` in
`ffi.c` dispatches to `js_dlopen_symbols()` when `argv[1]` is an object
(overload by argument shape, resolving the naming-collision decision point —
legacy `dlopen(path, flags)` is untouched for the number-flags call shape).
It `dlsym()`s each key in `symbolSpecs`, builds a `CFunction` per symbol via
the exported `js_cfunction_create()` (`c-function.h`), and returns
`{ symbols: { ...name: CFunction }, close() }` where `close()` `dlclose()`s
the handle. Verified in `tests/test-dlopen-symbols.js` (legacy form still
works, symbol-not-found and bad-path both throw `TypeError`, `close()`
actually releases the handle).

Phase 4 (pointer/buffer helper parity) is done: `toBuffer` aliases
`toArrayBuffer`; `ptr(buffer[, offset])` is its own small function
(`js_ptr_address` in `ffi.c`) rather than an alias of `toPointer`, because
`toPointer` returns a `"0x..."` string and `toArrayBuffer` reads a string
argument as content, so the round trip needs a Number/BigInt address.
`CString(ptr[, byteOffset[, byteLength]])` has `.ptr`, `.length` and
`.toString()`; it decodes on demand. Verified in
`tests/test-pointer-helpers.js`.

Phase 5 (`linkSymbols`, `suffix`) is done: `suffix` is a compile-time
`"so"`/`"dll"` string. `linkSymbols(symbolSpecs)` returns `{ symbols }` (no
`close()`, nothing is opened) and resolves each spec from its own `ptr` (bun
shape) or else `dlsym(RTLD_DEFAULT, name)`. It shares `js_build_symbols()` in
`ffi.c` with the `dlopen(path, symbolSpecs)` path. Verified in
`tests/test-link-symbols.js`.

### Phase 6 — deprecate/remove legacy `define`/`call`/`function_s`

**Postponed by decision: legacy `define()`/`call()` stay, undeprecated and
unchanged, until further notice.** Do not start this phase unprompted.

Only once Phases 1–5 are stable and everything in `test.js`/`test2.js`/
`test-ffi.js`/`test-portmidi.js`/`examples/` has been ported to the new API:

1. Mark `define`/`call` deprecated (keep working, maybe a one-time `warn()`).
2. Once nothing in-tree uses them, delete `function_s`, `define_function`,
   `call_function`, and the global `ffi_type_head` list/`find_ffi_type`/
   `find_type` (superseded by the static `FFIType` export, done — see
   `js_ffitype_funcs` in `ffi-type.c`, spliced into `ffi.c`'s `js_funcs` via
   `JS_OBJECT_DEF`).
3. This is the step that actually deletes the strcmp-scanning code the user
   flagged — everything before this phase is additive, so the old path keeps
   working throughout the migration and can be dropped only when nothing
   depends on it anymore.

### Phase 7 — docs/examples pass

1. Update `README.md` to document the new API as primary, old API as
   "legacy" (Phase 6 is postponed, so the old API stays).
2. Update `test-ffi.js`/`test.js`/`test2.js`/`examples/` to the new API.

---

## 4. `tools/gen-bindings.js`: intermediate JSON (IR) and C++ support

### Done

- clang's JSON AST is condensed while parsing (`AstCondenser`, `json.JsonParser`)
  and cached in `.tmp/gen-bindings/` (`--cache-dir`, `--no-cache`); a cached AST
  is reused until one of the files it was built from is newer.
- Phase 1 (clang -> IR, `--emit-ir=<file>`) and phase 2 (IR -> JS,
  `--from-ir=<file>`) are separate runs. The IR follows `describeObject()`:
  `methods` (kind `function`, `arity`, `params` as `"name: type"`, `returnType`),
  `fields` (extern/const variables), plus `enums`, `structs`, `skipped`.

### Next: `ffi.c` loader

A loader in the `ffi` module that builds `CFunction`s (and constants) straight
from the IR JSON, so no generated `.js` is needed. Needs: the IR `source`/
library name, `dlopen` handling, and a decision on how `structs` map to
libffi struct types (CFunction takes them as arrays now, see "Done: struct by
value").

- Struct/union layouts (size, align, field byte offsets, bitfield bit offsets)
  come from clang's `-fdump-record-layouts-simple`, forced by a probe
  translation unit (`runLayoutDump()`), and are stored in the IR and the AST
  cache. `--structs` emits them as ArrayBuffer classes (the `gen-structs.js`
  ones, see "Done: one generator" below), plus `{ ptr, value }` accessors for
  extern variables (resolved on first use). Off by default so existing
  generated output does not change.

### Next: struct accessors beyond scalars

Bitfield, array and nested-struct members only have a layout entry. Add
accessors for them (done since, and struct-by-value too, see "Done: struct by
value").

### Done: C++ classes and methods

`--c++` / `--std=` (or a `.cc/.cpp/.cxx/.hh/.hpp/.hxx` source) run clang as
C++; the IR gets `classes` (see `newIR()` in `tools/gen-bindings.js` for the
shape) with each public constructor, method, field and the destructor,
carrying clang's `mangledName`, plus bases, size/align and field offsets.
Namespaces and `extern "C"` blocks are descended, and enum-typed parameters
resolve by qualified name; `T&` maps to `pointer`; a struct with no methods or
bases stays in `structs` (qualified name).

Each class is emitted (`classesCode()`) as `export class ns_Name`: `new`
allocates `size` bytes and runs the complete constructor (`C1`), `.delete()`
runs the destructor (`D1`), `Class.from(ptr)` wraps without owning, public
fields are accessors, static members are class properties. Overloads dispatch
by arity, then argument type; a wrapped object passed as an argument becomes
its pointer. Symbols bind on first call, as inline members often have none.
A class extends its first public, non-virtual base when that sits at offset 0.
`tests/test-gen-bindings-cxx.js` checks every IR `mangledName` against
`nm -D` of a compiled fixture, then runs the generated module against it.

Constructors of an abstract class are omitted: the compiler emits only the
base-object constructor (`C2`) for it, so there is no `C1` to `dlsym()`. A
pure virtual method has no symbol either.

### Done: field sizes, typedefs, describeObject() shape

Struct and class IR entries are `describeObject()`-shaped (`type: "object"`,
`methods`/`getters`/`setters`/`fields`/`prototypeChain`; a class's
`prototypeChain` lists its ancestors) and every field carries a byte `offset`
and `size` (a bitfield has `bits`/`bitOffset` instead). Sizes come from the
layout probe (`char[sizeof(field)]` records, see `runLayoutDump()`), limited to
the files being collected. `typedef` and `using` aliases are collected into
`ir.typedefs` (qualified name, `type`, `cType`, `resolved?`, `record?`,
`size?`), including those nested in classes. JS output is unchanged: nothing
emits `typedefs` or field sizes yet.

### Done: typed pointers

The ffi module reads any type name ending in `*` as a pointer (`ffi_is_pointer_name()`
in `ffi-type.c`, for `CFunction`/`JSCallback` and for the legacy `define()`),
and `tools/gen-bindings.js` now writes `"<type> *"` where it wrote `"pointer"`
(a C++ `T&` becomes `"T *"`, a class's `this` `"ns::Class *"`). `char *`
stays `cstring`. Generated modules need an `ffi` with this change: an older one
reads `"int *"` as an unknown name and silently falls back to `i32`.

### Done: reads through ffi's read()

Generated modules read struct members, extern variables and vtable slots with
`read.*` (imported as `__rd`) instead of a DataView; writes still use a
DataView (`__dv`), as `ffi` has no write counterpart. Needs an `ffi` with
`read` (5.1.1), like the `toArrayBuffer` change; `lib/*.js` are older output and
were not regenerated.

### Done: --describe

`--describe` gives every bound function, method and constructor a JS signature
with the C parameter names, and sets `fn[Symbol.for('describe')]` to
`[{ params: ["name: type"], returnType, arity }, ...]` (one entry per overload),
so `describeObject()`/`describeClass()` (qjs-modules `lib/describe-*.js`, which
merge it as `signatures` / `constructorSignatures`) report them. Overloads share
the widest overload's names. Without the flag the output is unchanged. Plain C
functions become a named wrapper around the `CFunction` (one extra call).
Default arguments are not in the IR, so none are reported. The struct and union
wrappers (`tools/gen-bindings/structs.js`, also `gen-structs.js --describe`) get
`__sig` signatures on their constructor and `at()` and the `Name.size/align/fields`
layout, where `fields` holds each member's ffi type and offset.

### Done: --jsdoc

`--jsdoc` puts a JSDoc block before every bound function, method and class:
`@param {type} name - ffi type` and `@returns {type} - ffi type`, one
`@overload` group per overload, `@extends` on a class and its constructors'
`@param`s in the class block. JS types follow the ffi table (`number`,
`bigint`, `boolean`, `string`); a pointer is `number|bigint|null|object`, plus
the class when it points to a bound one. Independent of `--describe`. Struct,
union and C++ class blocks also list a `@property {type} name - C type, offset N`
per member, typed by what its getter returns (`Int32Array` for an array,
the wrapper class for a nested struct, `bigint` for 64-bit integers).

### Done: one generator, ArrayBuffer wrappers

`tools/gen-bindings.js` is a small entry script over `tools/gen-bindings/`
(args, clang + AST cache, condenser, IR collection, `emit/*`), and
`tools/gen-structs.js` a thin CLI over `tools/gen-bindings/structs.js`, which
`--structs` and the C++ class output now share. Structs, unions and bound C++
classes are all classes extending `ArrayBuffer` (C++ ones through a common
`__CxxObject`), so an instance is passed to a `CFunction` pointer argument as it
is; `.ptr`, `at(ptr)` (`from(ptr)` for C++ classes) and `delete()` stay.
Breaking for generated code: `struct_<name>.alloc()/view(p)` became
`new Name()` / `Name.at(p)`, and C++ instances no longer have `__ptr`/`__buf`.
Installed, the tools live in `share/qjs-ffi/tools` (qjsm resolves a script's
imports against the path it is run as, not a symlink's target), with
`qjs-ffi-genbindings`/`qjs-ffi-genstructs` as wrappers in `bin/`. `lib/` still
holds output of the previous generator; `regen.sh` brings it up to date.

### Done: struct by value

`CFunction` takes an array as a type: the struct's members in memory order
(`['f32','f32','f32']`, nested arrays for nested structs), which `ffi-type.c`
turns into a libffi struct type owned by the signature. An argument is an
ArrayBuffer (or view) of at least the struct's size, the result a new
ArrayBuffer; `JSCallback` rejects struct types. libffi derives the layout and
registers from the list alone, so a wrong list is silently wrong:
`tools/gen-bindings/by-value.js` lays it out the way libffi does and binds a
function only if every member lands on the IR's offset and the size matches
(packed structs fail this). A bitfield is covered by integer pieces. An
anonymous struct or union member, which the IR does not describe, is filled
with integers, which is sound only for structs over 16 bytes (passed in memory
on x86-64 SysV, aarch64 and win64 whatever they hold), so smaller ones stay
skipped. Left out: unions and C++ classes by value (a class with a non-trivial
copy constructor is passed by hidden reference, which libffi does not know),
`--api=define`, structs in `JSCallback`, 32-bit targets (the layout check
assumes 8-byte alignment of 64-bit members). Needs the new `ffi` module
installed (`tests/test-struct-by-value.js`).

### Done: virtual dispatch

A virtual method is called through the object's vtable (`__virtual(slot, spec)`
in the generated module: the slot of the vtable its first word points to, a
`CFunction` per target), so an object wrapped by a base class
(`Base.at(ptr)`, e.g. what a factory returns) runs its real class's override,
a pure virtual method is callable, and `.delete()` through a base runs the
derived destructor (also an implicit one that inherits a virtual destructor).
The slots come from clang: `runLayoutDump()` adds a probe per polymorphic
class (a call of the destructor, and the address of a virtual method) and
compiles with `-S -emit-llvm -fdump-vtable-layouts`, whose `VTable indices`
blocks `vtable.js` parses; `ir.js` matches each class's own methods to them by
name, number of parameters and constness, as the AST flags no overrider as
virtual. A method that does not match exactly one entry (two overloads equal in
those three) keeps its own symbol, as does everything with `--api=define`.
Needs codegen for the probe, so a header with polymorphic classes takes a bit
longer. Not covered: an overrider in a class whose destructor is non-virtual and
no method is declared `virtual` (nothing triggers its layout), multiple and
virtual inheritance (below).

### Done: --finalize

`--finalize` (opt-in, `--api=cfunction`) also destroys an object made with
`new` when it is garbage collected: its destructor runs and its memory is
freed, where without it only `.delete()` runs the destructor. A
FinalizationRegistry callback gets what was registered, not the object, whose
memory would be gone, so the object lives in `calloc`'d memory that the
wrapper only views (an external ArrayBuffer, the constructor returning it), and
the callback runs the destructor on a view of its own, through the vtable for a
virtual one, then `free`s it. `.delete()` still destroys at once and marks the
record, so the collector does not destroy it twice; it keeps the memory until
collection, so a field read after it stays valid. An object wrapped with
`at(ptr)` is never registered. Limits: the callback runs on a later turn of the
event loop, not inside the collection (`std.gc()` then an `os.setTimeout` turn);
an object still alive at exit is not destroyed; a destructor runs at an
arbitrary time, which is why it is not the default. Checked in
`tests/test-gen-bindings-finalize.js`, also under valgrind.

### Next: C++ gaps

1. Multiple and virtual inheritance: the `this` adjustment needs base offsets
   (`BaseOffsets` in the record layout dump, not captured yet). Extra bases
   are only noted in a comment.
2. Free functions with C++ linkage are bound (`geo::add` is exported as
   `geo_add`, overloads dispatched like methods, symbols bound on first call).
   Still missing: default arguments (every argument must be passed), and the
   by-value class types (`Point`, `Size`, `Mat`, `Scalar`, `Ptr<T>`) most
   OpenCV signatures use.
3. A class without declared constructors is zero-filled on `new` (only when
   not polymorphic); its implicit constructor has no symbol.
4. Out of scope: templates (only explicit instantiations), exceptions across
   the FFI boundary, by-value class parameters and returns, operators.

---

## 5. Meeting the bun:ffi spec: remaining discrepancies

Checked 2026-10-02 against <https://bun.com/docs/runtime/ffi>, Bun's
`packages/bun-types/ffi.d.ts` and its implementation (`src/runtime/ffi/`).
Probed against this module (built with `ENABLE_TCC=ON`). Phases 1-5 above and
`cc()` ([`doc/c-compiler.md`](doc/c-compiler.md)) are done; this is what is left.
Ordered roughly by how likely bun code is to trip over it.

### 5.1 Missing

1. **Done** (`ffi-read.[ch]`, `tests/test-read.js`).
   `read.{ptr,i8,i16,i32,i64,u8,u16,u32,u64,f32,f64}(ptr, byteOffset)`: straight
   reads from an address, no DataView.
2. `buffer_length` argument type (`FFIType.buffer_length`, bun enum value 21): a
   `buffer` argument followed by its byte length, filled in from the same
   object at call time. Not implemented: the name is unknown, so it silently
   becomes `i32` and the call gets the wrong arity. Argument-only; as a
   `returns` it must throw ("buffer_length is an argument-only type").
3. `JSCallback` option `threadsafe`: accepted and ignored. Needs a hop to the
   JS thread (job queue/`os` message), or a clear `TypeError` until then.
4. `cc()` option `include` (`string | string[]`, `-I`), from `ffi.d.ts` (the docs
   page only lists `flags`/`define`). Bun's default `flags` are
   `-std=c11 -Wl,--export-all-symbols -g -O2`.
5. `CFunction(...).close()`: `ffi.d.ts` declares it (frees the wrapper).
6. `JSCallback` instance as a `function`/`ptr` argument (the docs pass it
   directly, `.ptr` being only "slightly faster"): currently converts to 0, so
   the C side gets NULL. `js_ptr()` should unwrap a `JSCallback`.

### 5.2 Different shape

1. **Done** (see 5.3; callers ported, `tests/test-to-array-buffer.js`).
   `toArrayBuffer`/`toBuffer`: bun is `(ptr, byteOffset?, byteLength?,
   [deallocatorContext,] jsTypedArrayBytesDeallocator?)`, with a NUL-terminated
   read when `byteLength` is omitted; ours is the legacy
   `(ArrayBuffer|number|string, size, copy)` (`js_toarraybuffer`, `ffi.c`), so
   `toArrayBuffer(p, 1, 3)` yields 1 byte. See 5.3. Breaking for every caller of
   the legacy form (`lib/*.js`, `tools/gen-bindings/emit/*`, `README.md`,
   `test-ffi.js`, `tests/test-pointer-helpers.js`).
   `toBuffer` returns an ArrayBuffer (QuickJS has no Node `Buffer`); keep.
2. `new CFunction({ ptr, args, returns })`: docs use `new`; ours is a factory
   that throws "CFunction is not a constructor" with `new` (and `CFunction(...)`
   is what `doc/c-function.md` documents). Accept both.
3. `CString`: bun's `CString(ptr[, byteOffset[, byteLength]])` is callable with
   or without `new`, a falsy `ptr` gives `""`, and the result is a string. Ours
   needs `new`, returns an object with `.ptr`/`.length`/`.toString()` and
   neither `byteOffset` nor `byteLength`. (bun-types types it as `string`; the
   object form with `.ptr` is what older Bun gave.)
4. Pointers: bun hands out a `number` (to 2^53); ours are `bigint` once past 32
   bits, so `ptr(u8)`, `JSCallback.ptr` and a `malloc()` result are all
   `bigint`. Anything doing `ptr + 8` throws a mixed-type error. Decision
   needed: return `number` when it fits in 2^53 (what bun does, and 64-bit
   Linux/Windows user-space addresses always do), `bigint` only above.
5. `FFIType.*` are strings here and numbers in bun (`FFIType.i32 === 5`,
   `buffer_length === 21`); code that compares or indexes by the number
   differs. Also `suffix` has no `"dylib"` (macOS is not a target).
6. Errors: bun's `dlopen` failure is an `Error` with `code:
   "ERR_DLOPEN_FAILED"`; ours is a `TypeError`. A missing symbol is a
   `TypeError` in both.

### 5.3 toArrayBuffer/toBuffer deallocator arguments: research (implemented)

Read from Bun's `FFIObject.rs` (`to_array_buffer`/`to_buffer`):

*   Both extra arguments are **raw C addresses** (`number | bigint`), not
    JavaScript functions. `jsTypedArrayBytesDeallocator` is the address of a
    native `void (*)(void *bytes, void *deallocatorContext)`
    (JSC's `JSTypedArrayBytesDeallocator`), transmuted from the number;
    `deallocatorContext` is an address handed back to it untouched. Anything
    else throws "Expected callback to be a C pointer (number or BigInt)".
*   Forms: `(ptr, off, len, dealloc)` (4th is the function) and `(ptr, off,
    len, ctx, dealloc)`; `ctx` may be `null`/`undefined`. With a dealloc but no
    ctx it is called with NULL.
*   No deallocator: the memory is borrowed, never freed (`toBuffer` installs a
    no-op deallocator for the same reason).
*   A `JSCallback.ptr` is a number too, so it is *accepted*, but the docs warn
    the callback "may execute on garbage-collector threads and must not call
    JavaScript". It is not the intended use.
*   Typical use: `toArrayBuffer(p, 0, n, dlsym(RTLD_DEFAULT, "free"))`; `free`
    ignores the second argument, which is fine on the SysV x86-64 and aarch64
    ABIs.

Implemented as below in `js_toarraybuffer()` (`ffi.c`): a null/Number/BigInt
first argument takes bun's form, anything else the legacy
`js_toarraybuffer_legacy()`. A boolean among the later arguments of the bun form
throws, so a missed `(p, n, false)` caller fails loudly; a missed
`(p, n)` caller does not (it now means byteOffset), the one silent break. The
in-tree callers (`lib/*.js`, `tools/gen-bindings`, `examples/`, tests) were
ported: `(p, n, false)` became `(p, 0, n)`, and the copying `(p, n)` became
`(p, 0, n).slice(0)`. `toArrayBuffer(ptr, off, len, dealloc)` takes an address only.

Plan for QuickJS: `JS_NewArrayBuffer(ctx, ptr + off, len, free_func, opaque,
FALSE)` takes `void (*)(JSRuntime*, void *opaque, void *ptr)`, a different
signature, so `opaque` is a small malloc'd `{ fn, ctx }` and `free_func` calls
`fn(ptr, ctx)` then frees `opaque`. No deallocator: `free_func = NULL`
(borrow). QuickJS runs it synchronously on the JS thread, when the last
reference is dropped or the runtime is freed (not on a GC thread), so a
`JSCallback.ptr` would re-enter the interpreter in the middle of a
finalization: reject a `JSCallback` instance with a `TypeError` and accept only
numbers/bigints. Open decision: legacy `toArrayBuffer(ptr, size)` and bun's
`toArrayBuffer(ptr, byteOffset)` collide for a numeric first argument with two
arguments. Proposed: bun's meaning for number/bigint/null first arguments,
and keep the legacy meaning only for an `ArrayBuffer`/string first argument
(not valid in bun), then port the callers listed in 5.2.1.

### 5.4 Plan: exposing variables (data symbols)

What bun does: nothing. Its docs prose for `cc()` says "functions and
variables", but `symbols` is typed `Record<string, FFIFunction>` and the
implementation (`generate_symbol_for_function`, `ffi_body.rs`) requires `args`
as an array and builds a call wrapper for each entry, so only functions are
exposed. Variables would be an extension, so the shape below is ours.

Shape: a spec with a `type` and no `args`/`returns` is a data symbol.

```js
const { symbols } = cc({
  source: "counter.c",          // int counter = 5; const double pi = 3.14;
  symbols: {
    counter: { type: "i32" },
    pi:      { type: "f64", readonly: true },
    origin:  { type: ["f32", "f32"] },   // struct: an ArrayBuffer viewing it
    hello:   { args: [], returns: "i32" }, // functions as before
  },
});
symbols.counter;      // 5      (reads the memory each time)
symbols.counter = 7;  // writes it (TypeError if readonly)
```

*   `symbols.<name>` is an accessor property (enumerable), so it is live: a read
    converts the current value with the `returns` conversion of that type, a
    write with the `args` conversion. A struct type (array) gives a getter only,
    returning an external ArrayBuffer over the variable's memory (no copy, no
    free function), which is also how a C array is exposed.
*   The address, for passing `&counter` to C: `{ type: "i32", address: true }`
    makes the property a plain read-only pointer value, like `dlsym()`. (Open
    decision against a separate accessor; keeps one property per name.)
*   Where: `js_build_symbols()` (`ffi.c`) decides function vs data by an own
    `type` property, resolves the address as it already does (`dlsym` /
    `tcc_get_symbol` / spec `ptr`), so `dlopen`, `linkSymbols` and `cc` all get
    it. `c-function.c` already has the JS-to-native and native-to-JS
    conversions per kind; factor them out to share with a getter/setter pair
    made with `JS_DefinePropertyGetSet` over `JS_NewCFunctionData` (data: the
    address and the kind; a struct type needs its `ffi_type*`, owned by the
    spec the way `CFunction` owns its signature).
*   `void`, `cstring` setters and `function` are the edge cases: `void` is
    rejected; a `cstring` variable (`char *name`) reads like a `cstring`
    return, and a write is rejected (it would need the string's storage to
    outlive the call); a `function` variable reads as a pointer.
*   Lifetime is the one of the library: after `dlopen().close()` the address
    dangles, as with the functions. `cc()` code is never freed.
*   Tests (`tests/test-cc.js`, `tests/test-dlopen-symbols.js`): read/write each
    scalar kind, readonly, struct view aliasing the C memory, `address: true`
    against `read`, unknown symbol, `{ type }` mixed with `{ args }` throws.
*   Docs: replace the "Only functions can be exposed" paragraph in
    `doc/c-compiler.md`, add to `doc/dlopen.md`/`doc/types.md`.

Order of work: ~~5.1.1 (`read`)~~ (done), ~~5.2.1 + 5.3~~ (done),
5.2.4, 5.1.2, 5.1.6, 5.2.2/3, 5.1.4/5, the variables of 5.4, 5.1.3 last.
