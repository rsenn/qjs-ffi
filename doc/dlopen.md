# Libraries and symbols

Opening shared libraries and finding symbols in them. These are the functions
behind everything else in `ffi`: [`CFunction`](c-function.md) and
[`JSCallback`](js-callback.md) work on the addresses they return.

*   [`dlopen(path, symbols)`](#dlopenpath-symbols)
*   [`linkSymbols(symbols)`](#linksymbols)
*   [`dlopen(path, flags)`, `dlsym()`, `dlclose()`, `dlerror()`](#raw-libdl)
*   [`errno()`](#errno)
*   [`suffix`](#suffix) and the [RTLD constants](#rtld-constants)

## `dlopen(path, symbols)`

```js
const { symbols, close } = dlopen(path, symbolSpecs);
```

Opens the library with `RTLD_NOW`, looks up every key of `symbolSpecs` and
wraps it as a [`CFunction`](c-function.md). The result is

| Property | Description |
| -------- | ----------- |
| `symbols` | An object with one function per key of `symbolSpecs`. |
| `close()` | `dlclose()`s the library and returns its result (`0`). Calling it again does nothing and returns `0`. |

```js
import { dlopen } from "ffi";

const lib = dlopen("libm.so.6", {
  pow: { args: ["f64", "f64"], returns: "f64" },
});

console.log(lib.symbols.pow(2, 10)); // 1024
lib.close();
```

`path` is a library name or file name, as `dlopen(3)` takes it, or `null` for
the symbols that are already loaded into the process:

```js
const { symbols: { abs } } = dlopen(null, { abs: { args: ["i32"], returns: "i32" } });
```

Each spec is `{ args, returns, abi }`, exactly as for
[`CFunction`](c-function.md) without `ptr`; the names are in
[Types and ABI](types.md). A library that cannot be opened, or a symbol that is
not in it, throws a `TypeError` carrying the `dlerror()` text. Nothing stays
open then.

## `linkSymbols`

```js
const { symbols } = linkSymbols(symbolSpecs);
```

Like `dlopen()`, without opening a library, and without `close()`. A spec is
resolved from its own `ptr` if it has one (a number or `bigint`; a NULL `ptr`
is a `TypeError`), and otherwise with `dlsym(RTLD_DEFAULT, name)`. It makes
functions from pointers you got elsewhere in one call:

```js
import { linkSymbols, dlsym, RTLD_DEFAULT } from "ffi";

const { symbols } = linkSymbols({
  myabs: { ptr: dlsym(RTLD_DEFAULT, "abs"), args: ["i32"], returns: "i32" },
  strlen: { args: ["cstring"], returns: "u64" }, // found with dlsym(RTLD_DEFAULT, "strlen")
});

symbols.myabs(-7); // 7
symbols.strlen("hello"); // 5n
```

A symbol that is not found throws a `TypeError`. Only available where the
platform defines `RTLD_DEFAULT`.

## Raw libdl

`dlopen()` takes a second argument of two kinds, told apart by its type: an
object is the symbol table above, a number is the `flags` of the raw call.
`dlsym()`, `dlclose()` and `dlerror()` are thin wrappers over libdl, described
in the **dlopen(3)** manual page.

### `dlopen(path, flags)`

```js
const handle = dlopen("libz.so.1", RTLD_NOW | RTLD_GLOBAL);
```

Returns the library handle as a pointer (a `number` or a `bigint`), or `null`
if it cannot be opened; `dlerror()` then tells why. `path` may be `null` for
the main program.

### `dlsym(handle, name)`

```js
const fp = dlsym(handle, "compress");
```

Returns the address of the symbol, or `null` if it is not found. `handle` is a
library handle, or `RTLD_DEFAULT` or `RTLD_NEXT`. Pass the result to
[`CFunction`](c-function.md) or as a `ptr`.

### `dlclose(handle)`

```js
dlclose(handle); // 0
```

Closes the library and returns `dlclose(3)`'s result (`0` on success). A
`null` handle is a `TypeError`.

### `dlerror()`

Returns the text of the last libdl error as a string and clears it, or `null`
if there is none.

```js
const h = dlopen("libnope.so", RTLD_NOW); // null
console.log(dlerror()); // "libnope.so: cannot open shared object file: ..."
console.log(dlerror()); // null
```

## `errno()`

```js
errno(); // the C library's current errno
```

A function, not a property: call it right after the failing C call, before
anything else that may set it.

## `suffix`

The file name extension of shared libraries on the platform: `"so"` on
Linux and `"dll"` on Windows. Use it to build a file name:

```js
const path = `libsqlite3.${suffix}`;
```

## RTLD constants

The `flags` of `dlopen(path, flags)` and the pseudo-handles of `dlsym()`.
`RTLD_LAZY`, `RTLD_NOW`, `RTLD_GLOBAL`, `RTLD_LOCAL`, `RTLD_NODELETE`,
`RTLD_NOLOAD` and `RTLD_DEEPBIND` are numbers to combine with `|`.
`RTLD_DEFAULT` (`0`) and `RTLD_NEXT` (`-1`) are the handles that search the
global scope and the libraries loaded after the caller. A constant is only
exported where the platform's `<dlfcn.h>` defines it.
