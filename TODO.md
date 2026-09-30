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
- No struct-by-value, no varargs, no arrays. Documented as YAGNI in the
  existing README `TODO`/`Limitations` sections.
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
libffi struct types (struct-by-value is unsupported today).

### Next: emit structs and extern variables in the generated JS

Currently only functions, enum constants and constants with a known value are
emitted. Extern variables need `dlsym` + a typed read/write through `ptr`;
structs need a layout (sizes/offsets are not in clang's JSON, so ask for them
with `-fdump-record-layouts` or `-Xclang -fdump-record-layouts-complete`, or
compute them from the field types).

### Next: C++ classes and methods

The IR gets a `classes` list shaped like `describeClass()` output
(`constructorParams`, `prototypeChain`, `staticChain`, with `methods`/`fields`
entries as for functions). Work items:

1. Run `clang++` (`-x c++`, `-std=` option) and keep `CXXRecordDecl`,
   `CXXMethodDecl`, `CXXConstructorDecl`, `CXXDestructorDecl`, `NamespaceDecl`,
   `FieldDecl` in `nodePolicy()` (drop template bodies, `CXXMethodDecl` bodies,
   `AccessSpecDecl` except to track `public:`; only public members are bound).
2. Symbol names: read `mangledName` from the JSON (clang emits it for
   functions/methods/ctors/dtors/vars in C++ mode; an `extern "C"` function
   has `mangledName == name`). `dlsym` takes the mangled name. Constructors
   and destructors have two ABI variants (`C1`/`C2`, `D0`/`D1`/`D2`): use the
   complete-object ones (`C1`, `D1`); the deleting destructor (`D0`) frees.
3. `this` pointer: an instance method is a `CFunction` whose first arg is
   `pointer`; IR marks it `static: false` and `params` does not list `this`,
   the generator prepends it. Static methods and namespace functions stay plain
   functions. `const` methods only differ in the mangled name.
4. Object lifetime: allocate `sizeof(T)` (needs the record layout, see above)
   and call the complete constructor on it; free after the destructor. Classes
   with virtual methods need the vtable pointer set by the constructor, so
   never construct by memcpy.
5. Overloads: the IR keeps every overload as its own entry (distinguished by
   `mangledName`); the generated JS dispatches by `arguments.length` first,
   type only when arity is ambiguous. References (`T&`) map to `pointer`;
   by-value class parameters stay unsupported (like struct-by-value).
6. Inheritance: `bases` on each class, used to flatten inherited methods
   (the `this` adjustment for multiple inheritance needs the base offset, so
   only single non-virtual inheritance in the first version).
7. Out of scope: templates (only explicit instantiations), exceptions across
   the FFI boundary, virtual inheritance.

Verify with a small C++ header + `.so` under `tests/`, checking mangled names
against `nm -D`.
