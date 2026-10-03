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
  `TODO`/`Limitations` sections.
- Assumes little-endian.
- `dlopen`/`dlsym`/`dlclose`/`dlerror`/`errno` are thin 1:1 libdl/libc wrappers
  — these map cleanly onto bun:ffi's internal use of dlopen and don't need to
  change shape, just visibility (bun:ffi hides them behind `dlopen(path, symbols)`).

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
  Our equivalent optimization is simply: don't do string lookups (see
  `CFunction` in [`doc/c-function.md`](doc/c-function.md)).

## 3. Migration Plan

Each phase must independently build (`cmake --build build --target quickjs-ffi`)
and be exercised by a runnable `.js` test under `qjsm` before moving to the
next phase. Do not start a phase until the previous one's tests pass.
New/changed tests get the 5x flakiness check per
`.claude/rules/check-tests-for-flakiness.md`.

### Phase 7 — docs/examples pass

1. Update `README.md` to document the new API as primary, old API as
   "legacy" (`legacy.js`).
2. Update `test-ffi.js`/`test.js`/`test2.js`/`examples/` to the new API.

---

## 4. `tools/gen-bindings.js`: intermediate JSON (IR) and C++ support

### Next: `ffi.c` loader

The specs `--emit-specs --js` writes (`{ library, symbols, constants, omitted }`,
[`doc/gen-bindings.md`](doc/gen-bindings.md#specs-from-the-ir)) already need no
generated `.js`: `dlopen(specs.library, specs.symbols)` is the loader. What is
left is the constants (a loader that exports them) and the classes, which stay
generated.

### Next: C++ gaps

1. Multiple and virtual inheritance: the `this` adjustment needs base offsets
   (`BaseOffsets` in the record layout dump, not captured yet). Extra bases
   are only noted in a comment.
2. Free functions with C++ linkage: still missing default arguments (every argument must be passed), and the
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

1. `JSCallback` option `threadsafe`: accepted and ignored. Needs a hop to the
   JS thread (job queue/`os` message), or a clear `TypeError` until then.
2. **Postponed** (low value: bun's `viewSource` is for debugging its own C code
   generator, and there is none here). `viewSource(symbols[, false])` /
   `viewSource(fn, true)`: bun returns the C it generates for a binding
   (`string[]` / `string`). A binding here is a libffi `cif`, so the plan is to
   return the C declaration it stands for, in bun's shapes:

   ```js
   viewSource({ add: { args: ["i32", "i32"], returns: "i32" } })
   // ["int32_t add(int32_t a0, int32_t a1);"]
   viewSource({ args: ["pointer", "f64"], returns: "void" }, true)
   // "void (*)(void *a0, double a1)"
   ```

   *   `ffi-type.c`: a function giving the C spelling of a type spec (name,
       alias, `FFIType` number or struct array, recursively: `struct { float f0;
       float f1; }`), from `ffi_resolve_type()`/`ffi_resolve_type_id()` and a
       kind-to-C-type table (`K_I8` `int8_t`, `K_POINTER` `void *`, `K_CSTRING`
       `const char *`, ...). An unresolved type falls back as a call would: `i32`
       as an argument, `void` as a return.
   *   `ffi.c`: `js_viewsource()`, in `js_funcs` as `viewSource` (2); keys in
       order; it never calls `dlsym()` and ignores `ptr`; a non-object argument
       is a `TypeError`. The default export gets it with the rest.
   *   `tests/test-view-source.js` (scalars, aliases, numbers, struct and nested
       struct, callback form, unknown types, key order, errors); a section in
       `doc/ffi.md` saying that it shows declarations, not generated code.
   *   Open decision: bun's shapes (array / string), as above, or an object
       keyed by symbol name. Bun's shapes are the plan, so that code indexing
       the array works.

Order of work: 5.1.2 (`viewSource`, postponed), and 5.1.1 (`threadsafe`) last.
