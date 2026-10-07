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
- No arrays. Documented as YAGNI in the existing README
  `TODO`/`Limitations` sections. (Varargs were listed here too and are
  supported now: `variadic: true`, see doc/c-function.md.)
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

Done: `README.md` has the new API as primary and `legacy.js` as the old one;
`test-ffi.js`, `test.js` and `examples/portmidi.js` use the new API (the
generated `lib/*.js` examples already did; `test2.js` uses no ffi). Left:
`test-portmidi.js` stops at `Pm_CreateVirtualInput`, which the installed
libportmidi does not have.

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

Re-run 2026-10-07 against bun 1.4.2 with the build that has `K_STRUCT_PTR`, the
`types` argument and `gc_mark`: all 77 cases of `tests/bun-diff/probe.mjs` still
give what bun gives (`diff` of the two outputs is empty); the new class types
are not in the probe, as bun has none.

### 5.1 Missing

1. `JSCallback` option `threadsafe`: accepted and ignored (the `.threadsafe`
   property reads it back as a boolean). Needs a hop to the
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

---

## 6. Classes that inherit from ArrayBuffer, as types in specs

Supersedes the `FFIStruct`/`CStruct` runtime plan: there is no runtime
struct engine, no layout code and no native accessors. `gen-bindings`
emits a plain JS class per C struct, union or C++ class; the FFI only
learns that such a constructor is a type.

### The generated class

```js
class Point extends ArrayBuffer {
  static size = 16;                      // sizeof, from clang at generation
  constructor(init) { super(Point.size); if(init) Object.assign(this, init); }
  static at(ptr) {                       // a view over C memory, not owned
    return Object.setPrototypeOf(toArrayBuffer(ptr, 0, Point.size), Point.prototype);
  }
  get x() { return read.f64(this, 0); }  set x(v) { write.f64(this, 0, v); }
  get y() { return read.f64(this, 8); }  set y(v) { write.f64(this, 8, v); }
  len() { return symbols.Point_len(this); }  // the generator wires methods
}
class Dog extends Animal { /* C++ single inheritance is JS extends */ }
```

*   `static size` is required where the class is used in `returns` or
    `{ type: C }`; offsets and `size` come from clang, so no layout is
    computed at runtime. A union is a class whose accessors share offset 0.
*   Methods, constructors/destructors and virtual calls are generated JS
    (calling `symbols.*`); nothing is attached by `dlopen()`.
*   Instances are real `ArrayBuffer`s, so `read`, `write`, `ptr()`, typed
    arrays, `DataView` and `"pointer"` arguments take them unchanged.

### In a spec

```js
dlopen("libgeom.so", {
  Point_len: { args: [Point], returns: "f64" },
  Point_new: { args: ["f64", "f64"], returns: Point },
  origin:    { type: Point },            // a global `Point origin;`
});
```

| Where | Rule |
| ----- | ---- |
| a type | a function `C` with a static integer `size` whose instances are buffers: `prototype` inherits from `ArrayBuffer.prototype`, or (loose form) is any object, built with `Reflect.construct(ArrayBuffer, ...)`; `C !== ArrayBuffer`; new kind `K_STRUCT_PTR` carries `C` |
| `args: [C]` | the pointer to the bytes (`JS_GetArrayBuffer`). Accepted: an instance of `C` or of a subclass (`Dog` for `Animal`, single inheritance at offset 0); `null` as NULL; a plain `ArrayBuffer`/view of at least `C.size` bytes (shorter: `RangeError`). An instance of an unrelated class: `TypeError` naming both |
| `returns: C` | `null` for NULL, else a new **non-owning** `ArrayBuffer` over the pointer (`JS_NewArrayBuffer(ctx, p, C.size, NULL, NULL, FALSE)`) with `JS_SetPrototype(ctx, ab, C.prototype)`; the constructor is not run |
| `{ type: C }` | the variable's own memory as a `C` instance, where it was a plain `ArrayBuffer` |
| `"pointer"`, `"T *"` | unchanged: untyped, take any instance |

*   The argument check is `JS_IsInstanceOf(arg, C)`: no registry, no layout
    comparison. `C.size` missing or not a non-negative integer is a
    `TypeError` when the spec is parsed (`returns`, `{ type }`), and at the
    first call for a `args` buffer check.
*   Passing a struct by value stays the array form (`["f32", "f32"]`).
*   A function-pointer or embedded-struct field is generated JS too
    (`C2.at(ptr + offset)`, `ptr(read.ptr(...))`); a keep-alive reference
    from a view to its parent is a plain property the generator sets.

### Naming the class: `types` (done)

A spec may say `"Point *"` and be given the classes in an object, so a table
of specs stays plain data (the generator's `--emit-specs` JSON): `dlopen(path,
symbols, { Point })`, `linkSymbols(symbols, { Point })`, `cc({ ..., types })`,
or a `types` property on one spec. `ffi_class_lookup()` (`ffi-type.c`) strips
`const`/`volatile`/`struct`/`union`/`class`, needs exactly one `*` (none for a
variable's `type`), tries the whole name then its last `::` segment, and the
spec's own `types` before the table's. `"Point **"`, a missing name and a
variable of type `"Point *"` stay plain pointers. Documented in
`doc/struct.md#naming-a-class-types`, tested in `tests/test-struct-types.js`.
Left: `--emit-specs` writes `"struct pt *"` already, so it needs only the
object at the call site; a `--class-names` list in its output would say which
names to pass.

### Array types in specs: `"Point []"`, `"Point *[]"` (BLOCKED, do not implement)

Status: **blocked**. Reasons: *needs further consideration* (ownership,
copy-back and length rules are policy, not mechanics) and *is totally
non-standard* (no counterpart in bun:ffi, Deno or Node's `node:ffi`; every
other runtime would need the generator to rewrite the type). Nothing of this
exists in the code; this is only the idea, kept so it is not rediscovered.

*   `"Point []"` as an argument: C's array parameter (a decayed `Point *`) to
    contiguous `Point`s: an `ArrayBuffer`/view whose length is a multiple of
    `C.size` (else `RangeError`), or an array of instances copied into a
    temporary buffer and copied back after the call.
*   `"Point *[]"`: an array of instances or `null`, copied into a temporary
    `void *` array with one extra trailing NULL slot; no copy back.
*   `"Point [3]"`, `"Point *[3]"`: the same with a fixed count; as a return, a
    JS `Array` of 3 views. A return without a literal count is a `TypeError`.
*   Not the same as `{ array: T, length: N }`, which is a by-value array inside
    a struct; the string forms would mean the decayed pointer.
*   Under `--target=bun`/`deno` they would map to `"pointer"`.
*   Until then: `Point **` and arrays of pointers are untyped pointers, and the
    generator's pointer-array members already read as a proxy of
    `Point.at(p)`/`null` (`__ptrArray`); a `(array, n)` helper in the generator
    is the other open idea, also not started.

### Files

| File | Change |
| ---- | ------ |
| `ffi-type.h/.c` | `K_STRUCT_PTR`; `ffi_resolve_scalar()`/`ffi_sig_parse()` accept the constructor; `FFISignature` holds one `JSValue` per such argument and `ffi_sig_free()` releases them |
| `c-function.c` | the marshaller: argument check and pointer, the `returns` wrap, `js_variable_define()` for `{ type: C }`; the owning `CFunction` gets a `gc_mark` for the held constructors (check whether it has one) |
| `js-callback.c` | the same kind in `args`/`returns` of a callback (a C callback receiving a `Point *`) |
| `gen-bindings` | emits the classes and uses them in the specs it writes; replaces its current struct classes |
| `doc/struct.md` | rewritten as "classes as types" (generated class shape, the table above); `README.md`, `doc/README.md`, `doc/ffi.md` rename the `FFIStruct` references |

### Phases

Status: 1-4 done (`tests/test-struct-types.js`, 11 tests; `K_STRUCT_PTR` in
`ffi-type.c`, `js_struct_arg()`/`js_struct_view()`/`js_is_buffer_class()` in
`js-helpers.c`, the marshaller in `c-function.c` and `js-callback.c`, a
`gc_mark` on `CFunction` and `FFIVariable` for the held classes).

1. **Recognition** (done) -> `K_STRUCT_PTR` in `ffi_sig_parse()`; a
   non-class function stays an unknown-type `TypeError`; a missing
   `C.size` is a `TypeError` at parse time for args and returns alike.
2. **Arguments** (done) -> instance, subclass, unrelated class, plain buffer
   long and short, view, `null`.
3. **Returns and variables** (done) -> NULL, a view that sees C's writes,
   `instanceof C`, a global of class type; `gc()` after dropping classes.
4. **Callbacks** (done) -> a `JSCallback` with a `C` argument and return.
5. **gen-bindings** (generator side done, see its note below) -> classes with
   `--structs`/`--c++`, `--class-types` writes them as types
   (`tests/test-gen-bindings-classtypes.js`, which also loads a generated
   module and calls through it). Left: `--emit-specs` still writes `"T *"`
   (JSON holds no constructor); `--class-types` stays opt-in: measured 2026-10-07 on zlib.h and
   freetype.h, it is ~1% smaller and ~5% slower per call (2M
   `deflateBound(strm, 100)`: 2.16s vs 2.28s, after `js_struct_arg()` skips
   `Symbol.hasInstance` and caches the `prototype` atom; it was ~25% before),
   so it is still not at least as good as `"T *"`; `lib/*.js` are not regenerated.
6. **Docs/examples** -> `doc/struct.md` rewritten (done); left: switch one
   example in `examples/` to the new classes.
7. **Other runtimes** -> `gen-bindings.js --target=bun|deno|node`: bun:ffi
   and Deno.dlopen have no constructor-as-type, so those targets keep the
   string types (`"pointer"`) and the generated classes take the
   `ArrayBuffer` through `ptr()`; node emits `node:ffi` calls (doc/node-ffi.md), testable under qjsm with
   `-I ffi-hooks.js`. Plan in section 8.

### Open points

1.  `JS_SetPrototype()` on a fresh `ArrayBuffer` and `JS_NewArrayBuffer()`
    with a NULL free function: confirm in this fork's `quickjs.c` that
    neither is refused for the ArrayBuffer class.
2.  `structuredClone` of such an instance copies the bytes into a plain
    `ArrayBuffer` (the prototype is lost): acceptable, document it.
3.  A subclass passed where a base is declared assumes the base at offset 0;
    multiple inheritance (`this` adjustment) is not covered, the same gap as
    "C++ gaps" in section 4. Virtual calls stay generated JS until
    [`internals/cxx-virtual-dispatch.md`](doc/internals/cxx-virtual-dispatch.md)
    lands.
4.  Demangling C++ symbols (to name methods from `_ZN3Dog5speakEv`) is an
    option, not planned in C: `gen-bindings` can run `c++filt` at generation
    time, or a `demangle()` export could `dlsym(RTLD_DEFAULT,
    "__cxa_demangle")` at runtime (libstdc++/libc++abi, no `-lstdc++` link).
5.  Bit-fields: not supported; the generator emits shift/mask accessors.

## 7. Constants in symbol specs (replaces the CEnum idea)

There is no `CEnum`, no `c-enum.[ch]`. A constant is one more kind of entry
in the table `dlopen()`, `linkSymbols()` and `cc()` already take, next to
functions and variables. It has no symbol in the library (a `#define`, an
`enum`), so nothing is `dlsym()`ed for it.

### Spec format

```js
const { symbols } = dlopen("libfoo.so", {
  foo_len: { args: ["cstring"], returns: "u64" },   // function (as now)
  counter: { type: "i32" },                         // variable (as now)

  FOO_MAX: { value: 4096 },                         // constant: a number
  FOO_NAME: { value: "foo" },                       // a string
  FOO_MASK: { value: 0xffffffffffffffffn, type: "u64" },
  FOO_RATIO: { value: 0.5, type: "f32" },           // checked, then stored

  Color: { enum: { RED: 0, GREEN: 1, BLUE: 4 }, type: "u32" },
  Flags: { enum: { A: 1, B: 2, C: 4 }, type: "u8", flags: true },
});

symbols.FOO_MAX;      // 4096, a plain frozen data property
symbols.Color.BLUE;   // 4
symbols.Color[4];     // "BLUE" (reverse map, non-enumerable)
```

| Key | Meaning |
| --- | ------- |
| `value` | marks a constant; a number, bigint, string or boolean, stored as is |
| `type` | optional; a scalar type the value must fit (`300` into `u8` is a `RangeError`); a bigint where the type is 64-bit; no `type` keeps the JS value untouched |
| `enum` | marks an enum: `{ NAME: value }`, values are numbers or bigints; `value` and `enum` together are a `TypeError` |
| `flags` | enum only; `true` requires disjoint bits (or 0), else `RangeError` |

*   The discriminator is the key, checked in this order: `args`/`returns`
    (function), `value` or `enum` (constant), `type` (variable). A mix such
    as `{ value, args }` or `{ value, address }` is a `TypeError`.
*   A constant is an enumerable, read-only, non-configurable data property of
    `symbols`, never a getter: reading costs nothing and it survives
    `close()`.
*   An enum is a frozen plain object, names enumerable (so
    `Object.keys(symbols.Color)` is `["RED","GREEN","BLUE"]`), the reverse
    entries not. Two names with one value are aliases; the reverse map keeps
    the first. `type` defaults to `i32`.
*   Constants need no library: they work in `linkSymbols()` and `cc()`
    unchanged, and `dlopen(null, { ... })` with only constants is valid.
*   `gen-bindings` emits these entries for `#define` and `enum` instead of
    the loose constants it writes now.

### Where in the code

| File | Change |
| ---- | ------ |
| `c-function.c` | `js_constant_define()` beside `js_variable_define()` (c-function.c:476); the table loop of `dlopen`/`linkSymbols` picks function, constant or variable by the order above and skips `dlsym` for a constant |
| `compiler.c` | `cc()` takes the same table, nothing to resolve |
| `ffi-type.c` | reuse `ffi_resolve_scalar()` for `type`; a range check helper next to it |
| `doc/dlopen.md` | a "Constants" section after "Variables" |

### Phases

Status: 1, 2 and 4 done (`tests/test-constants.js`, `tests/test-gen-bindings-consts.js`,
`doc/dlopen.md#constants`); 3 (enum-typed struct fields) not started.

1. **Numbers and strings** -> `value` with and without `type`, range errors,
   frozen property, works with `dlopen(null, ...)`.
2. **Enums** -> `enum`, reverse map, aliases, `flags`, `Object.keys`.
3. **Struct fields** -> a field `{ type: "u32", enum: symbols.Color }` reads
   the number and writes a number or a name (generated classes, see
   section 6); `toJSON` and inspect show the name via the reverse map.
4. **gen-bindings** -> emit the entries.
   Tests: `tests/test-constants.js` (tinytest), added to `tests/run-all.sh`.

### Open points

1.  `i32` vs `u32` default for an enum without `type`: gcc picks unsigned
    when no value is negative; `i32` is kept as the portable default.
2.  Constants in `symbols` or in a separate `constants` result key: `symbols`
    is proposed (variables already live there, one lookup place), at the
    cost of `symbols` no longer being only callable things.
3.  A name written for an enum parameter (`f("RED")`): not in this step.

## 8. gen-bindings for Bun, Deno and Node (planned)

`gen-bindings.js --target=qjs|bun|deno|node` (default `qjs`, today's output).

*   **bun** (done: `--target=bun`, `tests/test-gen-bindings-bun.js` compares it
    with qjsm under the installed bun 1.4.2; C structs, variables, C++ classes
    work; by-value structs and variadics are skipped): `import { dlopen, FFIType, ptr, read, toArrayBuffer } from
    "bun:ffi"`; the same specs (`{ args, returns }`), classes as today, a
    class argument is passed as `ptr(instance)` (bun has no class types), a
    class return is `Class.at(ptr)`. No `--class-types`.
*   **deno** (done: `--target=deno`, `tests/test-gen-bindings-deno.js`; it is
    the bun output plus a prelude, one `dlopen()` per function, not the one
    described below, and variadics are the only skip; the notes that follow
    are the original probes; probed with deno 2.9.7, no
    `--unstable-ffi` needed, `--allow-ffi` is):
    *   *Spec*: `Deno.dlopen(path, { name: { parameters, result } })` returns
        `{ symbols, close }`; `args` -> `parameters`, `returns` -> `result`.
        Types: `i8..i32, u8..u32, i64, u64, f32, f64, bool, void, pointer,
        function` as they are; `cstring` -> `"buffer"` (a NUL-terminated
        `Uint8Array`, the generator encodes the string), `i64_fast` ->
        `"isize"`, `u64_fast` -> `"usize"`; every `"T *"` -> `"pointer"`.
    *   *No dlsym*: a symbol has no address in Deno. The module opens every
        function of the header in one `dlopen()` at the top, each with
        `optional: true` (a missing one, e.g. an inline member, gives `null`
        instead of throwing) and exports `lib.symbols.name`; a function
        pointer called through a vtable (`__virtual`) uses
        `new Deno.UnsafeFnPointer(pointer, definition)`.
    *   *Pointers*: a `Deno.PointerValue` is an opaque object (`null` for
        NULL), not a Number: the prelude's `__ptrOut`/`__ptrIn` convert with
        `Deno.UnsafePointer.value(p)` (a bigint) and
        `Deno.UnsafePointer.create(bigint)`; `__ptr(buf, off)` is
        `UnsafePointer.offset(UnsafePointer.of(buf), off)`. Passing an
        `ArrayBuffer` (a generated class instance) to a `"buffer"` or
        `"pointer"` parameter works.
    *   *Memory*: `__view(cls, p, size)` is
        `Deno.UnsafePointerView.getArrayBuffer(p, size)` plus
        `setPrototypeOf` (non-owning, as bun's `toArrayBuffer`); `__rd`/`__wr`
        reuse the DataView helpers of the bun prelude, over
        `getArrayBuffer(p + off, n)` for an address.
    *   *Variables*: a static `{ type: "i32" }` is a snapshot at `dlopen()` time
        (probed: `counter` stays 5 after `bump()`), so a variable is declared
        `{ type: "pointer" }`, which is the symbol's address (probed: live
        reads and writes through a view of it); the `__variable()` helper
        then reads and writes at that address. A constant needs no symbol.
    *   *By value*: unlike bun, Deno takes `{ struct: [...] }` for a parameter
        and a result (probed: `pt_swap` works; the result is a `Uint8Array`),
        so `ir.byValue` maps to it (same element lists, type names renamed)
        and `dropForBun()` is not applied; the returned bytes become the class
        through `__ret`, as in the default output.
    *   *Variadics*: not supported by Deno, skipped with the reason (a symbol
        alias `{ name: "printf", ... }` per call shape is possible later).
    *   *Callbacks*: a `function` parameter takes a `Deno.UnsafeCallback`;
        the generator does not make one, it only types the parameter.
    *   *Options*: `--target=deno` needs `--library` as bun does (no
        `RTLD_DEFAULT`; `Deno.dlopen(null)` is not a thing here), and refuses
        `--finalize` (needs libc `calloc`/`free`: fixable by adding the two to
        the one `dlopen()` of libc, left out until wanted) and
        `--class-types`.
    *   *Files*: `args.js` (`deno` in `--target`), `emit/functions.js` (the
        import-less header, the one `dlopen()`, the `CFunction` lines become
        `lib.symbols.x` with a `__ret`/`__at` wrap), `emit/runtime.js` (a
        `DENO_HELPERS` prelude next to `BUN_HELPERS`), `emit/common.js`
        (`cfType()` renames), `by-value.js` (byValue element lists renamed).
    *   *Tests*: `tests/test-gen-bindings-deno.js`, the same probes as the
        bun test (`probe()` takes the runner `deno run --allow-ffi
        --allow-read`), plus a by-value probe; skipped when `deno` is not
        installed.
    *   *Open*: whether one `dlopen()` with hundreds of symbols is slow to
        load (measured: no, SDL2's 816 functions import in 25-130 ms) (Deno builds every symbol eagerly unless `lazy: true`, which
        also exists and would make it a getter per symbol: prefer it for big
        headers); whether a C++ class works (mangled names are plain symbol
        names to Deno: expected yes, to be probed first).
*   **node** (done: `--target=node`, `tests/test-gen-bindings-node.js`, run
    against Node 26.11 under `~/.nvm`): the bun output plus a prelude over
    `DynamicLibrary.getFunction()`; a virtual call resolves its address among
    the bound C++ symbols; by-value structs and variadics are skipped. The
    generated modules were also run for SDL2 (816 functions) under qjsm, bun,
    deno and node with equal results; import takes ~130 ms on node, ~25-130 ms
    on deno.
*   The runtime helpers (`__rd`, `__wr`, `__view`, `__ptr`) become one
    per-target prelude; the specs and classes are shared. Open: what the
    Node layer lacks of `read`/`write`/`toArrayBuffer`; test each target
    with the runtime itself when it is installed (`tests/bun-diff` shows
    how bun is driven).
