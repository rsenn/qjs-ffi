# Foreign function interface

`ffi` is a QuickJS module that loads shared libraries, calls their C
functions, hands JavaScript functions back to C as function pointers, and reads
native memory. Its API follows [bun:ffi](https://bun.com/docs/runtime/ffi): a
symbol table passed to `dlopen()` gives directly callable functions, with no
name lookup at call time, and 64-bit integers are `BigInt`.

```js
import { dlopen } from "ffi";

const { symbols, close } = dlopen("libm.so.6", {
  pow: { args: ["f64", "f64"], returns: "f64" },
  sqrt: { args: ["f64"], returns: "f64" },
});

console.log(symbols.pow(2, 10)); // 1024
console.log(symbols.sqrt(144)); // 12
close();
```

Everything is imported from `"ffi"`:

```js
import { dlopen, dlsym, dlclose, dlerror, errno,
         linkSymbols, CFunction, JSCallback, cc,
         ptr, toBuffer, toArrayBuffer, toPointer, toString, read, write, CString,
         FFIType, suffix, pointerSize, JSContext, debug,
         RTLD_LAZY, RTLD_NOW, RTLD_GLOBAL, RTLD_LOCAL,
         RTLD_NODELETE, RTLD_NOLOAD, RTLD_DEEPBIND,
         RTLD_DEFAULT, RTLD_NEXT } from "ffi";
```

The module also has a default export, an object holding all of these (the same
values), as bun:ffi does: `import ffi from "ffi"; ffi.dlopen(...)`.

`cc` exists only in a build with `ENABLE_TCC`, and the `RTLD_*` constants only
where the platform defines them. Run scripts with `qjsm`, see
[Installation](../README.md#installation).

## Contents

| Page | What it covers |
| ---- | -------------- |
| [Libraries and symbols](dlopen.md) | `dlopen()`, `linkSymbols()`, `dlsym()`, `dlclose()`, `dlerror()`, `errno()`, `suffix`, `RTLD_*` |
| [Types and ABI](types.md) | `FFIType` and its numbers, the type names, structs by value, ABI names |
| [CFunction](c-function.md) | a function pointer as a callable function |
| [JSCallback](js-callback.md) | a JavaScript function as a function pointer |
| [Pointers and memory](pointers.md) | `ptr()`, `toArrayBuffer()`, `read`, `write`, `CString`, `toString()`, `toPointer()`, `pointerSize` |
| [C compiler](c-compiler.md) | `cc()`: compile and run C from JavaScript |
| [Miscellaneous](misc.md) | `JSContext()`, `debug()` |
| [Generating bindings](gen-bindings.md) | `tools/gen-bindings.js`, a binding generator for C and C++ headers |
| [Legacy API](legacy.md) | `define()` and `call()`, in the module `legacy.js` |
| [node:ffi](node-ffi.md) | the API of Node's `node:ffi` on top of `ffi`, in the module `node-ffi.js`, and the hook file that maps `node:ffi` and `bun:ffi` to the right module |

## Usage

`dlopen(path, symbols)` opens a library and returns `{ symbols, close }`.
Each entry of the symbol table becomes a function:

```js
import { dlopen, FFIType, suffix } from "ffi";

const path = `libsqlite3.${suffix}`;
const { symbols: { sqlite3_libversion } } = dlopen(path, {
  sqlite3_libversion: {
    args: [],
    returns: FFIType.cstring,
  },
});

console.log(`SQLite 3 version: ${sqlite3_libversion()}`);
```

`path` may be `null` to search the symbols already loaded into the process
(libc, and whatever the interpreter links). A missing library throws an `Error`
with `code: "ERR_DLOPEN_FAILED"`, a missing symbol a `TypeError`. See [Libraries and symbols](dlopen.md).

## Types

A signature is `{ args: [...], returns }`, written with the names of
[Types and ABI](types.md): the sized integers `i8`..`u64`, `f32`, `f64`, `bool`,
`pointer`, `cstring`, `void` (return only) and C-style aliases such as `int` and
`double`, or the matching `FFIType` number (`FFIType.i32`, which is `5`). A struct
passed or returned by value is an array of member types.

| Type | C type | JavaScript |
| ---- | ------ | ---------- |
| `i8`..`i32`, `u8`..`u32` | `int8_t`..`uint32_t` | `number` |
| `i64`, `u64` | `int64_t`, `uint64_t` | `bigint` |
| `i64_fast`, `u64_fast` | `int64_t`, `uint64_t` | `number`, or an exact `bigint` past 2^53 |
| `f32`, `f64` | `float`, `double` | `number` |
| `bool` | `bool` | `boolean` |
| `pointer`, `ptr`, `function` | `void *` | `null`, `number` or `bigint` |
| `cstring` | `char *` | `string` |

## Function pointers

`CFunction()` wraps a pointer you already have, for example from `dlsym()`:

```js
import { dlsym, CFunction, RTLD_DEFAULT } from "ffi";

const strdup = CFunction({
  ptr: dlsym(RTLD_DEFAULT, "strdup"),
  args: ["cstring"],
  returns: "cstring",
});

console.log(strdup("hello"));
```

`linkSymbols()` is `dlopen()` without opening a library: every entry is
resolved from its own `ptr`, or else with `dlsym(RTLD_DEFAULT, name)`:

```js
import { linkSymbols } from "ffi";

const { symbols: { gnu_get_libc_version } } = linkSymbols({
  gnu_get_libc_version: { args: [], returns: "cstring" },
});

console.log(gnu_get_libc_version());
```

See [CFunction](c-function.md) and [Libraries and symbols](dlopen.md#linksymbols).

## Callbacks

`JSCallback` turns a JavaScript function into a native function pointer, which
`.ptr` gives, to pass to C:

```js
import { JSCallback, CFunction, dlsym, read, RTLD_DEFAULT } from "ffi";

const compare = new JSCallback((a, b) => read.i32(a) - read.i32(b), {
  args: ["pointer", "pointer"],
  returns: "i32",
});

const qsort = CFunction({ ptr: dlsym(RTLD_DEFAULT, "qsort"), args: ["pointer", "u64", "u64", "pointer"], returns: "void" });

const numbers = new Int32Array([5, 3, 9, 1]);
qsort(numbers, numbers.length, 4n, compare);
console.log(numbers); // 1, 3, 5, 9

compare.close();
```

Call `close()` when the callback is no longer needed. See
[JSCallback](js-callback.md) for the details, including exceptions thrown by
the function.

## Strings

`cstring` converts at the boundary: a JavaScript string argument is encoded as
a NUL-terminated UTF-8 string for the duration of the call, and a `cstring`
result is decoded into a new JavaScript string. For a `char *` that you hold as
an address, `CString(ptr)` decodes it, and `toString(ptr, length)` decodes
an exact number of bytes. A `char *` type spelled that way is a plain pointer.
See [Pointers and memory](pointers.md#cstring).

## Pointers

A pointer is `null`, a `number` (exact up to 2^53 - 1, which every user-space
address is), and a `bigint` above that. `ptr()` takes the address of an `ArrayBuffer` or typed
array, `toArrayBuffer()` makes an `ArrayBuffer` over memory at an address, and
`read` reads a value straight from an address:

```js
import { ptr, read, toArrayBuffer } from "ffi";

const bytes = new Uint8Array([1, 2, 3, 4]);
const p = ptr(bytes);

console.log(read.u8(p, 2)); // 3
console.log(read.u32(p, 0)); // 67305985 (0x04030201)

const view = new Uint8Array(toArrayBuffer(p, 1, 2)); // [2, 3], aliasing `bytes`
```

See [Pointers and memory](pointers.md).

## Compiling C

`cc()` compiles C source in memory with TinyCC and returns its functions, with
the same signatures:

```js
import { cc } from "ffi";

const { symbols: { hello } } = cc({
  source: "hello.c",
  symbols: { hello: { args: [], returns: "int" } },
});

console.log(hello()); // 42
```

It needs a build with `-DENABLE_TCC=ON`. See [C compiler](c-compiler.md).

## Memory management

`ffi` does not manage native memory: whatever C allocates, you free, and a
pointer outlives nothing. In particular

*   `toArrayBuffer()` makes a view over the memory, not a copy. Keep the memory
    alive while the buffer is used, `.slice(0)` the buffer to copy it, or pass a
    native deallocator to be called when the buffer is garbage collected, see
    [Pointers and memory](pointers.md#toarraybuffer).
*   A `JSCallback` pointer is valid until `close()`.
*   After `dlopen()`'s `close()` the library's functions and data are gone.
*   A pointer derived from a `cstring` argument is valid only for that call.

## Notes

*   64-bit values: `i64`/`u64` are exact `bigint`s. An argument may be a
    `number` or a `bigint`.
*   Structs by value are supported, with the member types spelled out. Varargs
    are not.
*   Little-endian targets only. Linux x86_64 is the main target; mingw64 cross
    builds compile but are untested.
*   `qjsm`, not `qjs`, runs the scripts and tests of this project.

## Differences from bun:ffi

This module follows bun:ffi but is not a drop-in replacement yet. The open
items are tracked in [TODO.md](../TODO.md#5-meeting-the-bunffi-spec-remaining-discrepancies):

Not implemented:

*   `JSCallback`'s `threadsafe` option works as a property only: it reads back as
    `true`, and the callback still runs on the JS thread alone. `viewSource` is
    missing.

An extension: a spec with `type` instead of `args`/`returns` exposes a
[variable](dlopen.md#variables), which bun does not.

Different on purpose or for now:

*   `toBuffer()` returns an `ArrayBuffer` (QuickJS has no `Buffer`).
*   `read.ptr` and every pointer result are exact (a `bigint` above 2^53 - 1);
    bun's `read.ptr` rounds to a `number`.
*   A closed `JSCallback` passed as a pointer is a `TypeError`; bun passes a stale
    pointer. An out-of-range `bigint`
    pointer wraps modulo 2^64, as in bun.

`tests/test-bun-diff.js` runs one script under `bun` and under `qjsm`; all 77
cases of it give what bun 1.4.2 gives (`tests/bun-diff/known-differences.txt` is
empty).
