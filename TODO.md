# TODO

What is left. Everything done is in the docs ([`doc/`](doc/README.md)) and the
tests; this file lists only open work, most likely to matter first.

## 1. bun:ffi differences still open

Checked against <https://bun.com/docs/runtime/ffi> and Bun's `ffi.d.ts`.

1. `JSCallback` option `threadsafe`: accepted and ignored (the `.threadsafe`
   property reads it back as a boolean, see `doc/js-callback.md`). Needs a hop
   to the JS thread (job queue / `os` message), or a clear `TypeError` until
   then.
2. **Postponed** (low value: bun's `viewSource` shows the C its own code
   generator writes, and there is none here). `viewSource(symbols[, false])` /
   `viewSource(fn, true)` returning the C declaration a binding stands for, in
   bun's shapes (`string[]` / `string`):

   ```js
   viewSource({ add: { args: ['i32', 'i32'], returns: 'i32' } })
   // ['int32_t add(int32_t a0, int32_t a1);']
   viewSource({ args: ['pointer', 'f64'], returns: 'void' }, true)
   // 'void (*)(void *a0, double a1)'
   ```

   *   `ffi-type.c`: a function giving the C spelling of a type spec (name,
       alias, `FFIType` number or struct array, recursively), from
       `ffi_resolve_type()` and a kind-to-C-type table (`K_I8` `int8_t`,
       `K_POINTER` `void *`, `K_CSTRING` `const char *`, ...). An unresolved
       type falls back as a call would: `i32` as an argument, `void` as a return.
   *   `ffi.c`: `js_viewsource()` in `js_funcs` (2 arguments); keys in order;
       it never calls `dlsym()` and ignores `ptr`; a non-object argument is a
       `TypeError`.
   *   `tests/test-view-source.js`, and a section in `doc/ffi.md` saying that it
       shows declarations, not generated code.

Do `viewSource` (if wanted) before `threadsafe`.

## 2. Classes as types (`doc/struct.md`)

1. **Array types in specs** (`"Point []"`, `"Point *[]"`, `"Point [3]"`):
   **blocked**, do not implement. Ownership, copy-back and length rules are
   policy, and there is no counterpart in bun:ffi, Deno or `node:ffi`. Until
   then `Point **` and arrays of pointers are untyped pointers, and the
   generator's pointer-array members read as a proxy of `Point.at(p)`/`null`.
   A `(array, n)` helper in the generator is the other idea, not started.
2. `--emit-specs` writes `"struct pt *"` and no constructor (JSON holds none):
   the call site passes the classes (`dlopen(path, symbols, { Point })`). A
   `--class-names` list in its output would say which names to pass.
3. `--class-types` stays opt-in: measured on zlib.h and freetype.h it is ~1%
   smaller and ~5% slower per call than `"T *"`. Make it the default only if
   it gets at least as fast.
4. `lib/bindings/*.js` are not regenerated with the current generator.
5. No example in `examples/` uses the generated classes yet; switch one.
6. `structuredClone` of an instance copies the bytes into a plain
   `ArrayBuffer` and loses the prototype: acceptable, not yet documented.
7. Demangling C++ symbols (to name methods from `_ZN3Dog5speakEv`): `gen-bindings`
   could run `c++filt` at generation time, or a `demangle()` export could
   `dlsym(RTLD_DEFAULT, "__cxa_demangle")`. Not planned.

## 3. gen-bindings C++ gaps

1. Multiple and virtual inheritance: the `this` adjustment needs base offsets
   (`BaseOffsets` in the record layout dump, not captured yet). Extra bases are
   only noted in a comment. A subclass passed where a base is declared assumes
   the base at offset 0.
2. Free functions with C++ linkage: default arguments (every argument must be
   passed) and the by-value class types (`Point`, `Size`, `Mat`, `Scalar`,
   `Ptr<T>`) most OpenCV signatures use.
3. A class without declared constructors is zero-filled on `new` (only when not
   polymorphic); its implicit constructor has no symbol.
4. Out of scope: templates (only explicit instantiations), exceptions across
   the FFI boundary, by-value class parameters and returns, operators.
5. Virtual calls stay generated JS until
   [`doc/internals/cxx-virtual-dispatch.md`](doc/internals/cxx-virtual-dispatch.md)
   lands.

## 4. Constants and enums (`doc/dlopen.md#constants`)

1. **Struct fields** (not started): a field `{ type: 'u32', enum: symbols.Color }`
   reads the number and writes a number or a name (generated classes);
   `toJSON` and inspect show the name via the reverse map.
2. An enum without `type` is `i32` (gcc picks unsigned when no value is
   negative; `i32` is the portable default).
3. A name written for an enum parameter (`f('RED')`): not supported.

## 5. gen-bindings for other runtimes

`--target=bun|deno|node` work (`tests/test-gen-bindings-{bun,deno,node}.js`);
by-value structs and variadics are skipped, as noted in `doc/gen-bindings.md`.

1. `--target=deno` refuses `--finalize`: it needs libc `calloc`/`free`, which
   could be added to the one `dlopen()`.
2. What the Node layer lacks of `read`/`write`/`toArrayBuffer` (`lib/node/ffi.js`,
   `doc/node-ffi.md`) is still to be listed.
3. A C++ class under `--target=deno` is expected to work (mangled names are
   plain symbol names) but was never probed.
4. The scripts under `tools/gen-bindings/` still import the native `json`
   module (`JsonParser`), so they do not run under node or bun yet.
