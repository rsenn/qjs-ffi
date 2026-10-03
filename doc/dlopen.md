# Libraries and symbols

Opening shared libraries and finding symbols in them. These are the functions
behind everything else in `ffi`: [`CFunction`](c-function.md) and
[`JSCallback`](js-callback.md) work on the addresses they return.

*   [`dlopen(path, symbols)`](#dlopenpath-symbols)
*   [`linkSymbols(symbols)`](#linksymbols)
*   [Variables](#variables)
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
| `symbols` | An object with one function per key of `symbolSpecs`, each named after its symbol. Not enumerable, so `Object.keys(lib)` is `["close"]`, as in bun. |
| `close()` | `dlclose()`s the library and returns `undefined`, as in bun. Calling it again does nothing. |
| `[Symbol.dispose]()` | The same as `close()`, so `using lib = dlopen(...)` closes it (the registered `Symbol.for("Symbol.dispose")` where the engine has none). |

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
[Types and ABI](types.md). A library that cannot be opened throws an `Error`
with `code: "ERR_DLOPEN_FAILED"` (as bun's) and the `dlerror()` text in its
message; a symbol that is not in it throws a `TypeError`. Nothing stays open
then.

## `linkSymbols`

```js
const { symbols } = linkSymbols(symbolSpecs);
```

Like `dlopen()`, without opening a library, and without `close()`. A spec is
resolved from its own `ptr` if it has one (a non-NULL `number` or `bigint`; NULL,
a string or anything else is a `TypeError`), and otherwise with `dlsym(RTLD_DEFAULT, name)`. It makes
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

## Variables

An extension: bun exposes only functions. A spec with `type` and no `args` or
`returns` is a variable (a spec with both throws a `TypeError`). It works the
same in `dlopen()`, `linkSymbols()` and [`cc()`](c-compiler.md):

```js
const { symbols } = cc({
  source: "counter.c", // int counter = 5; const double pi = 3.14; struct { float x, y; } origin;
  symbols: {
    counter: { type: "i32" },
    pi: { type: "f64", readonly: true },
    origin: { type: ["f32", "f32"] },
    hello: { args: [], returns: "i32" }, // functions as before
  },
});

symbols.counter; // 5, the memory is read each time
symbols.counter = 7; // and written
```

`symbols.<name>` is an enumerable accessor property, so it is live. A read
converts the value as a `returns` of that type does, a write as an `args` of it
does (a `bigint` for `i64`, a pointer for `pointer`; see [Types](types.md)).

*   `readonly: true`: a write throws a `TypeError`.
*   A struct type (an array, see [structs](types.md#structs-by-value)) reads as
    an `ArrayBuffer` over the variable's own memory, with no copy: writes
    through a view reach the variable. This is also how a C array is exposed
    (`{ array: "i32", length: 8 }`, see [array types](types.md#array-types)). It
    cannot be assigned.
*   `cstring` reads the string a `char *` variable points to (`null` for NULL)
    and cannot be assigned. `function` reads as a pointer.
*   `void` (and `buffer_length`) is a `TypeError`.
*   `address: true` makes the property a plain pointer value, the address like
    `dlsym()` gives, for passing `&counter` to C or to `read`.
    A variable that is not in the library is a `TypeError` as for functions.

The address is the library's: after `close()` a variable dangles as the
functions do.

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
library handle, or `RTLD_DEFAULT` or `RTLD_NEXT`: a `number`, a `bigint` (taken
modulo 2^64, so `2n ** 64n - 1n` is `RTLD_NEXT`) or `null`/`undefined` for
`RTLD_DEFAULT`. A boolean, a string or an object is a `TypeError`. Pass the
result to [`CFunction`](c-function.md) or as a `ptr`.

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
