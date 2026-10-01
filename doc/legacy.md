# Legacy API

The original interface registers functions by name, with `define()`, and calls
them by name, with `call()`. It is not part of the `ffi` module any more: it
lives in the JavaScript module `legacy.js`, which builds each function on a
[`CFunction`](c-function.md). Prefer [`dlopen()`](dlopen.md) or `CFunction`
directly; this page is for code that still uses `define()` and `call()`.

```js
import { dlsym, RTLD_DEFAULT } from "ffi";
import { define, call } from "legacy.js";

define("strlen", dlsym(RTLD_DEFAULT, "strlen"), null, "int", "char *");
console.log(call("strlen", "hello")); // 5
```

`legacy.js` is installed next to `ffi.so` (the QuickJS C module directory) and
copied to the build directory, so one `QUICKJS_MODULE_PATH` finds both. In the
source tree, import it by path (`../legacy.js`).

## `define()`

```js
define(name, functionPointer, abi, returnType, ...parameterTypes);
```

Registers the function at `functionPointer` under `name` and returns `true`.
`abi` is an [ABI name](types.md#abi) or `null` for the default. It returns
`false`, with a message on stderr, if a type is unknown or cannot be used.

*   A `null` or NULL `functionPointer` throws a `TypeError`.
*   A name that is already defined is left as it is and `true` is returned.
*   Up to 30 parameters can be defined; more are ignored.

## `call()`

```js
const n = call(name, ...params);
```

Calls the function registered as `name`. An unknown name throws an `Error`.

*   The result is always a number (a `double`), which presumes that all
    integers and pointers fit into 52 bits. A function returning `void` gives
    `0`, and a NULL pointer gives `0`. Only a return type of `"string"` or
    `"char *"` gives a string (`null` for NULL).
*   A JavaScript string passed for a pointer parameter is copied, with its
    terminating NUL, and the pointer is that of the copy. The callee cannot
    change the string.
*   An `ArrayBuffer` or typed array is passed by its address, and its contents
    can be written.
*   A [`JSCallback`](js-callback.md) is passed as its function pointer.
*   `true` and `false` are 1 and 0, `null` is NULL.

## Types

Legacy types are the libffi names (`"sint8"`, `"uint32"`, `"double"`,
`"pointer"`, ...), C-like aliases (`"int"`, `"long"`, `"size_t"`,
`"unsigned char"`, `"char *"`, `"void *"`) and the semantic types `"string"`
(a JavaScript string) and `"buffer"` (an `ArrayBuffer`). Any other name ending
in `*` is a pointer as well (`"struct foo *"`). These are not the type names
of [Types and ABI](types.md).

Two things differ from the C implementation this replaced: `"longdouble"` is
refused (a `CFunction` has no such type), and `"size_t"` is 64 bits wide (it
was a 32-bit `uint`).
