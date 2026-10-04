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

## 6. FFIStruct: structs, unions and classes as ArrayBuffers

API: [`doc/struct.md`](doc/struct.md), written first; this is how to build it.

### Design

An instance is a **real `ArrayBuffer`** (`JS_CLASS_ARRAY_BUFFER`) made by
`JS_NewArrayBuffer(ctx, base, size, free_fn, opaque, FALSE)` and given a
per-type prototype with `JS_SetPrototype()`:

```
instance -> Type.prototype -> FFIStruct.prototype -> ArrayBuffer.prototype
```

*   `JS_GetArrayBuffer()` yields the base pointer, so `read`, `write`,
    `js_buffer_get`, `CFunction` buffer arguments, typed arrays and `DataView`
    work with no change. The inherited `byteLength`, `slice` and the rest are
    correct.
*   No native state per instance. Each field accessor is a
    `JS_NewCFunctionData` closure holding its `FieldDesc`; it fetches the base
    with `JS_GetArrayBuffer(this)`, so a detached buffer throws on its own.
*   An exotic class was rejected: `JS_GetOpaque2(this, JS_CLASS_ARRAY_BUFFER)`
    checks the object's own class, so a class that only inherits from
    `ArrayBuffer.prototype` throws in every inherited method.

Trade-offs taken, and why each is acceptable:

| Cost | Handling |
| ---- | -------- |
| fields are prototype accessors, not own properties | `toJSON()`, an inspect hook, `Type.fields` |
| `p.typo = 1` makes a property | `JS_PreventExtensions()` on every instance |
| no per-instance slot (the ArrayBuffer opaque is QuickJS's) | the two things that need one, the keep-alive reference of a view and the function-pointer cache, go in a symbol-keyed hidden property |
| `count` of structs cannot be indexed natively | a frozen `Array` of views |
| `transfer()`/`resize()` | `transfer()` copies (the memory is not ours to move), `resize()` throws |

### Files

| File | Holds |
| ---- | ----- |
| `ffi-struct.h` / `ffi-struct.c` | `js_ffistruct_init()`, the `FFIStruct` factory, the constructor statics, `Type.at()`, the prototype builder. One header block per JS-facing function, as in the other `.h` files |
| `ffi-struct-layout.c` | `StructType`, `ffi_struct_layout()`: offsets, size, align, validation. No JS beyond reading the spec; testable alone |
| `ffi-struct-field.c` | the accessors: `field_get()`/`field_set()` per kind, the numeric-array to typed-array map, `toJSON`, `set` |
| `ffi.c` | `FFIStruct` in `js_funcs`; `js_ffistruct_init()` from the module init |
| `c-function.c` | `dlopen`/`linkSymbols` learn a constructor as a type and attach methods; `js_variable_define()` returns an instance for `{ type: Point }` |
| `ffi-type.c` | `ffi_resolve_scalar()` and `ffi_sig_parse()` accept a constructor: a new kind `K_STRUCT_PTR` |
| `compiler.c` | `cc()` attaches methods the same way as `dlopen()` |
| `CMakeLists.txt` | the new sources into the `quickjs-ffi` MODULE |

### Data

```c
typedef struct FieldDesc {
  JSAtom name;
  uint32_t offset;
  uint32_t count;          /* 0: a scalar, not an array */
  int kind;                /* K_* from ffi-type.h, or K_STRUCT, K_FUNCTION */
  struct StructType* sub;  /* K_STRUCT: the embedded type */
  FFISignature sig;        /* K_FUNCTION */
  uint8_t self;            /* K_FUNCTION: instance goes first */
} FieldDesc;

typedef struct StructType {
  int refcount;            /* shared by the prototype and the accessors */
  uint32_t size, align;
  int is_union;
  uint32_t nfields;
  FieldDesc* fields;
  JSValue proto;           /* Type.prototype */
} StructType;
```

Accessors get the `StructType` through the closure's data slot (a `JSValue`
holding a small opaque object whose finalizer drops the refcount); no global
registry.

### Phases

Each phase ends with a suite in `tests/` and its part of `doc/struct.md`
being true.

1. **Layout** (`ffi-struct-layout.c`) → verify: `Type.size`, `Type.align` and
   every `offsetof(name)` equal the C compiler's for a header of cases
   (padding, a `u8` before a `u64`, a union, explicit `offset`, `size` larger,
   a `count`), built with `cc()`.
2. **Scalars** → `FFIStruct()`, `new`, `Type.at(ptr)`, field get/set for
   every scalar kind, `toJSON`, `set`, `p.type`, the non-extensible check,
   `instanceof ArrayBuffer`, `byteLength`, `new Uint8Array(p)`.
   → `tests/test-struct.js`
3. **Nested and arrays** → typed array per numeric `count`, an embedded view
   that keeps its parent alive (drop the parent, `gc`, read the child),
   `Array` of views, `Type.at(ptr, n)`.
4. **Methods** → `methods:` option; `dlopen()`/`linkSymbols()`/`cc()` attach a
   function whose first argument is a constructor, with the `<Name>_` rule,
   `method: name | false`, and the clash `TypeError`; a small library built
   with `cc()` in the test.
5. **Function pointers** → `type: "function"`, `self`, `native`; assign number,
   `CFunction`, `JSCallback`, `null`; a plain function is a `TypeError`
   (the struct never creates a `JSCallback`, so it never closes one); the
   rebuilt-on-change rule. Reading unwraps an open callback: add
   `js_callback_find(ctx, code)` to `js-callback.h/.c` (scan of
   `callback_list` by `code`, same runtime), return `cl->func`, or for `self` a
   wrapper passing `ptr(this)` first; no unwrap when the parameter count
   differs from the field's. → verify: `ops.add === fn` after
   `ops.add = cb`; after `cb.close()` it reads a `CFunction`; `native: true`
   gives the `CFunction`; an exception in an unwrapped call throws at once.
6. **Signatures and variables** → a constructor in `args`, `returns` and
   `{ type: Point }`; NULL in and out; a buffer shorter than the type is a
   `RangeError`.
7. **Docs/examples** → `doc/struct.md` re-read against the tests; switch one
   example in `examples/` from generated classes to `FFIStruct`.

### Open points to settle while building

1.  `JS_SetPrototype()` on a fresh ArrayBuffer, then `JS_PreventExtensions()`:
    confirm in this fork's `quickjs.c` that neither is refused for the
    ArrayBuffer class.
2.  Cost of an embedded view: one `JS_NewArrayBuffer` + `JS_SetPrototype` per
    read. If it shows in a profile, cache the child in the hidden property,
    keyed by the field and the parent's base pointer.
3.  The hidden property holds `{ parent, fnCache }` (nothing owned: no
    callback is created by the struct); check that
    `structuredClone` does not copy it (it would be a dangling alias).
4.  Methods attached by `dlopen()` mutate the shared prototype. The doc
    allows adding one after instances exist; keep that unless a test shows a
    problem.
5.  C++: `this` adjustment for a base-class subobject (multiple inheritance) is
    not covered, the same gap as "C++ gaps" in section 4. Virtual calls are
    `self: true` function-pointer fields until
    [`internals/cxx-virtual-dispatch.md`](doc/internals/cxx-virtual-dispatch.md)
    lands; `gen-bindings` could then emit `FFIStruct` specs instead of classes.
6.  Auto-creating a `JSCallback` for `ops.add = function(){}` is postponed.
    Owning it by the slot (closed on overwrite, and on collection of an
    instance that owns its memory) is the likely policy, but a callback the C
    side copied elsewhere would dangle; it needs a `keep: true` field option
    for that case. `js_callback_find()` exists by then, so the read side
    already round-trips.
7.  `js_callback_find()` scans a list per read; make it a hash if a
    function-pointer field in a hot loop shows in a profile.
8.  Bit-fields: not supported; a spec option `bits: [lo, hi]` on an integer
    field is the likely extension.
