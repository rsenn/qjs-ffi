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

### Phase 4 — pointer/buffer helper parity

1. Add `ptr(buffer)`, `toBuffer(ptr, len)` as bun-named wrappers over the
   existing `toPointer`/`toArrayBuffer` implementations (thin aliasing, no new
   logic).
2. Add a `CString` class (lazy pointer→string, `.length`, `.ptr`) layered over
   existing `toString()`.
3. **Verify**: round-trip a buffer through `ptr()`/`toBuffer()` and compare
   bytes.

### Phase 5 — `linkSymbols`, `suffix` (low priority, additive)

1. `suffix` constant (`"so"` on Linux — this project apparently only targets
   Linux/Windows per README, so this can be a compile-time constant, no
   runtime platform detection needed beyond what already exists).
2. `linkSymbols(symbolSpecs)` — same as `dlopen` symbol-building path from
   Phase 2, minus opening a new library (symbols pre-resolved, e.g. via
   `RTLD_DEFAULT`).
3. **Verify**: define two libc symbols via `RTLD_DEFAULT` through
   `linkSymbols` and call both.

### Phase 6 — deprecate/remove legacy `define`/`call`/`function_s`

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
   "legacy" (or removed, depending on Phase 6 outcome).
2. Update `test-ffi.js`/`test.js`/`test2.js`/`examples/` to the new API.
