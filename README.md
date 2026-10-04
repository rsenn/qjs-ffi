# qjs-ffi

## What is it?

**qjs-ffi** is a foreign function interface for
[QuickJS](https://bellard.org/quickjs/). A script can

*   load shared libraries and call their C functions, with `bigint` for 64-bit
    integers and structs passed by value,
*   hand JavaScript functions back to C as function pointers (`JSCallback`),
*   read and write native memory (`ptr()`, `read`, `toArrayBuffer()`, `CString`),
*   compile and run C code in memory (`cc()`, optional, uses TinyCC),
*   generate bindings from C and C++ headers (`tools/gen-bindings.js`).

The API follows [bun:ffi](https://bun.com/docs/runtime/ffi): `dlopen()` with a
symbol table returns directly callable functions, and there is no name lookup at
call time. The older `define()`/`call()` interface is available as the module
`legacy.js`, see [Legacy API](doc/legacy.md).

Linux x86_64 is the main target. mingw64 cross builds compile but have not been
tested. libffi and libdl are required.

## How to use it

Use `dlopen()` with a table of symbols. Every entry becomes a function that can
be called directly:

```js
import { dlopen } from "ffi";

const lib = dlopen("libm.so.6", {
  pow: { args: ["f64", "f64"], returns: "f64" },
  sqrt: { args: ["f64"], returns: "f64" },
});

console.log(lib.symbols.pow(2, 10)); // 1024
console.log(lib.symbols.sqrt(144)); // 12

lib.close();
```

`dlopen(path, symbolSpecs)` returns `{ symbols, close() }`. `path` may be `null`
to search the symbols already loaded into the process. A missing library or
symbol throws a `TypeError`. Each spec has the form `{ args, returns, abi }`,
the same options as [CFunction](doc/c-function.md).

Native code can call back into JavaScript. This sorts an array with libc's
`qsort()`, comparing with a JavaScript function:

```js
import { JSCallback, CFunction, dlsym, read, RTLD_DEFAULT } from "ffi";

const compare = new JSCallback((a, b) => read.i32(a) - read.i32(b), {
  args: ["pointer", "pointer"],
  returns: "i32",
});

const qsort = CFunction({
  ptr: dlsym(RTLD_DEFAULT, "qsort"),
  args: ["pointer", "u64", "u64", "pointer"],
  returns: "void",
});

const numbers = new Int32Array([5, 3, 9, 1]);
qsort(numbers, numbers.length, 4n, compare);
console.log(numbers); // 1, 3, 5, 9

compare.close();
```

With `ENABLE_TCC` (see below), C source can be compiled and called directly:

```js
import { cc } from "ffi";

const { symbols } = cc({
  source: "hello.c", // int hello() { return 42; }
  symbols: { hello: { args: [], returns: "int" } },
});

console.log(symbols.hello()); // 42
```

The other functions are in [doc/ffi.md](doc/ffi.md).

## Installation

Needs CMake, a C compiler, the libffi development files, and QuickJS with its
`qjsm` launcher. `clang` is only needed to run the binding generator, and `git`
with network access only for the `BUILD_LIBFFI` and `ENABLE_TCC` options below.

```sh
cmake -S . -B build
cmake --build build --target quickjs-ffi
```

This produces the module `build/ffi.so` (`ffi.dll` on Windows). To use it from
the build directory, point QuickJS at it and import it as `ffi`:

```sh
export QUICKJS_MODULE_PATH=$PWD/build
qjsm script.js
```

To install it, run `cmake --install build`. The module goes to the QuickJS C
module directory that the configure step prints (`C module directory`), where
`import ... from "ffi"` finds it without `QUICKJS_MODULE_PATH`. The binding
generator is installed too, see [doc/gen-bindings.md](doc/gen-bindings.md).

CMake options:

*   `BUILD_STATIC_MODULES` also builds a static `quickjs-ffi.a`
*   `BUILD_LIBFFI` checks out libffi into third_party/libffi and builds it
    instead of using the system library
*   `ENABLE_TCC` checks out TinyCC into third_party/tinycc, builds libtcc and
    exports `cc()`, see [doc/c-compiler.md](doc/c-compiler.md)

## Documentation

The reference is in [doc/](doc/README.md), organised like the bun:ffi pages.
Good places to start:

*   [Foreign function interface](doc/ffi.md): overview, with every import and the
    differences from bun:ffi
*   [Types and ABI](doc/types.md): type names, structs by value
*   [Pointers and memory](doc/pointers.md): `ptr()`, `toArrayBuffer()`, `read`,
    `CString`
*   [C compiler](doc/c-compiler.md): `cc()`

See tests/ for small runnable examples and examples/ for bindings to real
libraries (cairo, freetype, SDL2, zlib, portmidi).

## Tests

```sh
tests/run-all.sh
```

runs every suite in tests/ with `qjsm`. Scripts in this project are run with
`qjsm`, not `qjs`: `qjs` lacks `process` and other globals, and swallows
uncaught errors in module mode.

## Limitations

*   No varargs.
*   A struct passed or returned by value needs its member types spelled out (no
    unions, no C++ classes, not in a `JSCallback`).
*   Little-endian targets only.
*   C structures are accessed through [`FFIStruct`](doc/struct.md), generated
    classes (see [doc/gen-bindings.md](doc/gen-bindings.md)), or with `read` and
    `toArrayBuffer()`.
*   The [legacy API](doc/legacy.md) returns every result as a `double`.
