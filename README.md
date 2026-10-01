qjs-ffi
=======

## What is it? ##
**qjs-ffi** is a foreign function interface for QuickJS
<https://bellard.org/quickjs/>. It lets a script load shared libraries, call
their C functions, and hand JavaScript functions back to C as function
pointers.

The API follows [bun:ffi](https://bun.com/docs/runtime/ffi): `dlopen()` with a
symbol table returns directly callable functions, there is no name lookup at
call time, and 64-bit integers come back as `BigInt`. The older
`define()`/`call()` interface is still available, see [Legacy API](doc/legacy.md).

libffi and libdl are required. Linux x86_64 is the main target, mingw64
cross builds compile but have not been tested.

See tests/ for small runnable examples, examples/ for bindings to real
libraries (cairo, freetype, SDL2, zlib, portmidi) and doc/ for the reference.

## How to use it? ##
Use dlopen() with a table of symbols. Every entry becomes a function that can
be called directly:

```
	import { dlopen } from "ffi";

	const lib = dlopen("libm.so.6", {
	  pow: { args: ["f64", "f64"], returns: "f64" },
	  sqrt: { args: ["f64"], returns: "f64" },
	});

	console.log(lib.symbols.pow(2, 10));  // 1024
	console.log(lib.symbols.sqrt(144));  // 12

	lib.close();
```

`dlopen(path, symbolSpecs)` returns `{ symbols, close() }`. `path` may be
null to search the symbols already loaded into the process. A missing library
or symbol throws a TypeError.

Each spec has the form `{ args, returns, abi }`, the same options as
[CFunction](doc/c-function.md). The other functions are in
[doc/ffi.md](doc/ffi.md).

## Installation ##
Installing qjs-ffi is done with CMake:

```
$ cmake -S . -B build
$ cmake --build build --target quickjs-ffi
```

This produces the module `build/ffi.so` (`ffi.dll` on Windows). Point QuickJS
at it and import it as `ffi`:

```
$ export QUICKJS_MODULE_PATH=$PWD/build
$ qjsm script.js
```

CMake options:

*   `BUILD_STATIC_MODULES` also builds a static `quickjs-ffi.a`
*   `BUILD_LIBFFI` checks out libffi into third_party/libffi and builds it
    instead of using the system library
*   `ENABLE_TCC` checks out TinyCC into third_party/tinycc, builds libtcc and
    exports `cc()`, see [doc/c-compiler.md](doc/c-compiler.md)

Run the tests with:

```
$ tests/run-all.sh
```

Scripts in this project are run with `qjsm`, not `qjs`: `qjs` lacks
`process` and other globals, and swallows uncaught errors in module mode.

## Documentation ##

The reference is in [doc/](doc/README.md), organised like the bun:ffi pages:

*   [Foreign function interface](doc/ffi.md): overview, with every import
*   [Libraries and symbols](doc/dlopen.md): `dlopen()`, `linkSymbols()`, `dlsym()`, `dlerror()`, `errno()`, `RTLD_*`
*   [Types and ABI](doc/types.md): `FFIType`, type names, structs by value, ABI names
*   [CFunction](doc/c-function.md) and [JSCallback](doc/js-callback.md)
*   [Pointers and memory](doc/pointers.md): `ptr()`, `toArrayBuffer()`, `read`, `CString`, `toString()`
*   [C compiler](doc/c-compiler.md): `cc()`, with TinyCC (`-DENABLE_TCC=ON`)
*   [Generating bindings](doc/gen-bindings.md): `tools/gen-bindings.js`
*   [Legacy API](doc/legacy.md): `define()` and `call()`

## Limitations ##

* Structure pass by value needs the member types spelled out (no unions, no
  C++ classes, not in a JSCallback)
* No varargs
* C structures are accessed through generated classes (see
  [doc/gen-bindings.md](doc/gen-bindings.md)), or with read() and toArrayBuffer()
* Only little-endian
* Only the legacy API is limited to double return values

## TODO ##

* Remove the legacy define()/call() (postponed, see TODO.md)
* Update examples/ and the older test scripts to the new API
* Test the mingw64 build
