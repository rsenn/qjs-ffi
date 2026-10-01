# Legacy API

The original interface registers functions by name in a global list, with
`define()`, and calls them by name, with `call()`. It still works and is
unchanged, but every `call()` searches that list by string comparison and every
result is a `double`. Prefer [`dlopen()`](dlopen.md) or
[`CFunction`](c-function.md). Removing it is postponed, see
[TODO.md](../TODO.md).

```js
import { dlsym, define, call, toString, RTLD_DEFAULT } from "ffi";

define("strdup", dlsym(RTLD_DEFAULT, "strdup"), null, "char *", "char *");
const p = call("strdup", "hello");
console.log(toString(p));
```

## `define()`

```js
define(name, functionPointer, abi, returnType, ...parameterTypes);
```

Registers the function at `functionPointer` under `name` and returns `true` if
it has been defined. `abi` is an [ABI name](types.md#abi) or `null` for the
default. A name that is already defined, or an unknown type, fails.

*   Up to 30 parameters can be defined.
*   If `null` is passed as the function pointer, `define()` substitutes a dummy
    function that prints "dummy function in ffi" on stderr.

## `call()`

```js
const n = call(name, ...params);
```

Calls the function registered as `name`.

*   `call()` always returns a `double`, which presumes that all integers and
    pointers fit into 52 bits.
*   JavaScript strings are copied and passed as a pointer to the copy. They
    cannot be altered by the C function.
*   `ArrayBuffer`s are passed as a pointer, and their contents can be written.
*   `true` and `false` become 1 and 0, `null` becomes NULL.

## Types

Legacy types are the libffi names (`"sint8"`, `"uint32"`, `"double"`,
`"pointer"`, ...), C-like aliases (`"int"`, `"long"`, `"size_t"`,
`"unsigned char"`, `"char *"`, `"void *"`) and the semantic types `"string"`
(a JavaScript string) and `"buffer"` (an `ArrayBuffer`). Any other name ending
in `*` is a pointer as well (`"struct foo *"`). These are not the type names
of [Types and ABI](types.md).
