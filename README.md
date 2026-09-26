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
`define()`/`call()` interface is still available, see [Legacy API](#legacy-api).

libffi and libdl are required. Linux x86_64 is the main target, mingw64
cross builds compile but have not been tested.

See tests/ for small runnable examples, examples/ for bindings to real
libraries (cairo, freetype, SDL2, zlib, portmidi) and doc/ for the reference
pages of individual classes.

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
[CFunction](doc/c-function.md).

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

Run the tests with:

```
$ tests/run-all.sh
```

Scripts in this project are run with `qjsm`, not `qjs`: `qjs` lacks
`process` and other globals, and swallows uncaught errors in module mode.

## Available imports ##
```
  import { dlopen, dlsym, dlclose, dlerror, errno,
           linkSymbols, CFunction, JSCallback,
           ptr, toBuffer, toArrayBuffer, toPointer, toString, CString,
           FFIType, suffix, pointerSize, JSContext, debug,
           define, call,
           RTLD_LAZY, RTLD_NOW, RTLD_GLOBAL, RTLD_LOCAL,
           RTLD_NODELETE, RTLD_NOLOAD, RTLD_DEEPBIND,
           RTLD_DEFAULT, RTLD_NEXT } from "ffi";
```

The RTLD_* constants are only published if the platform defines them.

## dlopen, dlsym, dlclose, dlerror, errno ##

dlopen() has two call shapes, picked by the type of the second argument:

```
  lib = dlopen(path, symbolSpecs)   // object: bun-shaped, see above
  h   = dlopen(path, flags)         // number: raw libdl handle
```

The raw form, dlsym(), dlclose() and dlerror() are thin wrappers around the
libdl functions of the same name, described in the **man** pages, which also
describe the RTLD_* constants. Note that errno() is a function.

dlsym() returns the address as a Number or BigInt, or null if not found.

## CFunction ##

CFunction() wraps an already resolved function pointer, for example one from
dlsym(), as a plain callable function:

```
	import { dlsym, CFunction, RTLD_DEFAULT } from "ffi";

	const strdup = CFunction({
	  ptr: dlsym(RTLD_DEFAULT, "strdup"),
	  args: ["cstring"],
	  returns: "cstring",
	});

	console.log(strdup("hello"));
```

The prepared libffi call interface is built once, when the function is
created. See [doc/c-function.md](doc/c-function.md).

## linkSymbols ##

linkSymbols() is dlopen() without opening a library. Each entry is resolved
from its own `ptr`, or else with `dlsym(RTLD_DEFAULT, name)`:

```
	import { linkSymbols } from "ffi";

	const { symbols } = linkSymbols({
	  abs: { args: ["i32"], returns: "i32" },
	  strlen: { args: ["cstring"], returns: "u64" },
	});

	symbols.abs(-5);         // 5
	symbols.strlen("hello"); // 5n
```

It returns `{ symbols }` and has no close(), since nothing was opened.
`suffix` is `"so"` (`"dll"` on Windows), for building library file names:

```
	dlopen(`libz.${suffix}.1`, { ... });
```

## JSCallback ##

new JSCallback(fn, { args, returns }) turns a JavaScript function into a
native function pointer. Pass its `.ptr` to C code that expects a callback,
and call `.close()` when done:

```
	import { JSCallback } from "ffi";

	const cb = new JSCallback((a, b) => a + b, { args: ["i32", "i32"], returns: "i32" });

	someNativeFunction(cb.ptr);

	cb.close();
```

See [doc/js-callback.md](doc/js-callback.md).

## Pointers and buffers ##

*   `p = ptr(buffer[, offset])` returns the address of an ArrayBuffer (or typed
    array) as a Number or BigInt.
*   `b = toBuffer(p, n)` creates an ArrayBuffer of length n from pointer p.
    This is the same function as toArrayBuffer().
*   `b = toArrayBuffer(p, n[, copy])` does the same. The contents are copied
    unless `copy` is `false`, in which case the ArrayBuffer views the original
    memory and the caller must keep it alive.
*   `s = toString(p[, n])` converts a pointer to a C string, n bytes long if n
    is given.
*   `s = toPointer(buffer[, offset])` is like ptr(), but returns the address
    as a string such as `"0x55d0c8a4e2a0"`.
*   `new CString(p[, byteOffset[, byteLength]])` wraps a C string. `.ptr` is
    the address, `.length` its length in bytes and `.toString()` decodes it.
    Without byteLength the string ends at the first NUL byte.

```
	const src = new Uint8Array([1, 2, 3, 4]);
	const back = new Uint8Array(toBuffer(ptr(src.buffer), src.length));
```

Note that a string passed to toArrayBuffer() is taken as content, not as an
address. That is why ptr() returns a number and toPointer() should only be used
for display.

## FFIType ##

`FFIType` holds the type names as constants, so `FFIType.i32` can be used
where `"i32"` is written above.

## ABI ##

ABI is the call type for a function pointer. The following values are allowed.
Not specifying an abi is the same as "default". Names that are unknown, or not
available on the platform, fall back to "default".

*   "default"
*   "sysv"
*   "unix64"
*   "stdcall"
*   "win64"

## TYPES ##
Types define parameter and return types. NOTE: structure passing by value is not
yet supported. "void" is only useful as a return type.

*   "void"
*   "bool"
*   "i8", "u8"
*   "i16", "u16"
*   "i32", "u32"
*   "i64", "u64" (BigInt, exact)
*   "i64_fast", "u64_fast" (Number, lossy above 2^53)
*   "f32", "f64"
*   "pointer", "ptr", "function" (null for NULL, else Number or BigInt)
*   "cstring" (JavaScript string, converted for the duration of the call)

An unrecognized parameter type falls back to "i32", an unrecognized return type
to "void".

## Generating bindings ##

tools/gen-bindings.js reads C headers with clang and writes a JavaScript module
with one CFunction per function, plus an export for every enum used:

```
$ qjsm tools/gen-bindings.js --library=libcairo.so.2 /usr/include/cairo/cairo.h -o lib/cairo.js
```

Useful options are `--follow-includes` to also bind the headers included by
the source, `--exclude=<name>` to skip a function, `-I` and `-D` for clang, and
`--api=define` to target the legacy API. Ready made bindings are in lib/.

```
	import * as cairo from "./lib/cairo.js";

	const surface = cairo.cairo_image_surface_create(cairo.CAIRO_FORMAT_ARGB32, 320, 240);
```

See examples/cairo.js and tests/test-cairo.js, which draws to PNG and SVG.

## JSContext ##

Returns the current JSContext *ctx. This allows functions within the
QuickJS C API to be called from within a js module. This allows for
limited "introspection".

## debug ##

This is provided as a convenience feature, to allow debugging of ffi.so. If
ffi.so is compiled with debug (-g), debugging with gdb can be done:
```
$ gdb qjsm
(gdb) set args script.js
(gdb) b js_debug
Make breakpoint pending on future shared library load? (y or [n]) y
(gdb) run
```
The breakpoint is triggered on the first call to debug() in the JavaScript.

## Legacy API ##

The original interface registers functions by name in a global list. It still
works and is unchanged, but every call() searches that list by string
comparison, and every result is a double. Prefer dlopen() or CFunction().

```
	import { dlsym, define, call, toString, RTLD_DEFAULT } from "ffi";

	define("strdup", dlsym(RTLD_DEFAULT, "strdup"), null, "char *", "char *");
	var p = call("strdup", "hello");
	console.log(toString(p));
```

define(name, function_pointer, abi, ret_type, types...) returns true if the
function has been defined. n = call(name, params...) calls it.

*   call() always returns a double, which presumes that all integers and
    pointers fit into 52 bits.
*   JavaScript strings are copied and passed as a pointer to the copy. They
    cannot be altered by the C function.
*   ArrayBuffers are passed as a pointer, and their contents can be written.
*   true and false become 1 and 0, null becomes NULL.
*   Up to 30 parameters can be defined.
*   If null is passed as the function pointer, define() substitutes a dummy
    function that prints "dummy function in ffi" on stderr.

Legacy types are the libffi names ("sint8", "uint32", "double", "pointer",
...), C-like aliases ("int", "long", "size_t", "unsigned char", "char *",
"void *") and the semantic types "string" (JavaScript string) and "buffer"
(ArrayBuffer).

## Limitations ##

* No structure pass by value
* No varargs
* No C structure access, use toBuffer() and a typed array or DataView
* Only little-endian
* Only the legacy API is limited to double return values

## TODO ##

* Remove the legacy define()/call() (postponed, see TODO.md)
* Update examples/ and the older test scripts to the new API
* Test the mingw64 build
