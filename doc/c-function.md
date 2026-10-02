# CFunction

`CFunction` wraps an already-resolved native function pointer as a plain,
directly-callable JavaScript function. It mirrors [bun:ffi's
`CFunction`](https://bun.com/docs/runtime/ffi#cfunction).

Unlike the legacy [`define()`/`call()`](legacy.md)
pair (which is built on `CFunction` itself), there is no name-keyed registry: the `ffi_cif` (libffi's prepared call
interface) is built once, at construction time, and stored directly on the
returned function's closure data. Calling the function invokes libffi
against that stored `cif`/function pointer with no string lookup involved.

## Usage

```js
import { dlopen, dlsym, CFunction, RTLD_DEFAULT } from "ffi";

const fp = dlsym(RTLD_DEFAULT, "strdup");

const strdup = CFunction({
  ptr: fp,
  args: ["cstring"],
  returns: "cstring",
});

console.log(strdup("hello")); // "hello"
```

`CFunction()` may be called with or without `new`, as in bun:ffi: either way it
returns the callable function.

```js
fn = CFunction({ ptr, args, returns, abi })
```

| Option    | Required | Description                                                                                       |
| --------- | -------- | --------------------------------------------------------------------------------------------------- |
| `ptr`     | yes      | The native function pointer to call: a `number` or `bigint` address, e.g. from `dlsym()`. NULL, `undefined`, a view, a `JSCallback`, a string or anything else is not a function pointer: `TypeError`. |
| `args`    | no       | Array of types, names or `FFIType` numbers (see [Types](#types)) declaring the parameter list, in order. Omit or use `[]` for a function that takes no arguments; a value with no usable `length` (not an object, or a `length` that is missing, negative or throws) is treated the same as omitted. Up to 32 arguments are supported; extras beyond that are dropped. |
| `returns` | no       | Type name for the return value (see [Types](#types)). Defaults to `"void"`.                       |
| `abi`     | no       | Call ABI name (see [ABI](types.md#abi)). Defaults to `"default"`.                                          |

If `ptr` is not a non-NULL `number` or `bigint`, or the declared types can't
be turned into a working `ffi_cif`, `CFunction()` throws a `TypeError`.

An argument declared `"pointer"`, `"function"` or `"T *"` is converted as
described in [Pointer values](pointers.md#pointer-values): an address, a view, a
`JSCallback`, or `null`/`undefined` for NULL; a boolean, a string or an object is
a `TypeError`.

The returned function's `.length` matches the declared `args` count. Extra
arguments passed at call time are ignored; missing ones are treated as
`undefined` (and converted per the declared type, e.g. `0`/`NaN`-like for
numeric types).

## Types

Signatures are written with the names in [Types and ABI](types.md): `"i32"`,
`"f64"`, `"pointer"`, `"cstring"`, C-style aliases such as `"int"`, and an array
of member types for a struct passed by value.

## Examples

Calling a libm function with `f64` arguments and return:

```js
import { dlopen, dlsym, CFunction, RTLD_DEFAULT } from "ffi";

const pow = CFunction({
  ptr: dlsym(RTLD_DEFAULT, "pow"),
  args: ["f64", "f64"],
  returns: "f64",
});

console.log(pow(2, 10)); // 1024
```

64-bit integers round-trip exactly as `BigInt`:

```js
const llabs = CFunction({
  ptr: dlsym(RTLD_DEFAULT, "llabs"),
  args: ["i64"],
  returns: "i64",
});

llabs(-9007199254740993n); // 9007199254740993n
```

`malloc`/`free` via `pointer`:

```js
const malloc = CFunction({ ptr: dlsym(RTLD_DEFAULT, "malloc"), args: ["u64"], returns: "pointer" });
const free = CFunction({ ptr: dlsym(RTLD_DEFAULT, "free"), args: ["pointer"], returns: "void" });

const p = malloc(16n);
free(p);
```

## Relationship to JSCallback

`CFunction` and [`JSCallback`](js-callback.md) are mirror images: `CFunction`
lets JS call into native code, `JSCallback` lets native code call into JS.
Passing a `JSCallback` as a `CFunction` argument (declared `"pointer"`,
`"function"` or `"T *"`) is how you hand a JS-backed callback to a native API
expecting a function pointer. It passes the callback's function pointer, so
`cb` and `cb.ptr` are the same; a closed callback is a `TypeError`. (Any
function that takes a pointer, such as `ptr()` or `read`, unwraps a
`JSCallback` the same way.)

## See also

- [`doc/js-callback.md`](js-callback.md)
- [`TODO.md`](../TODO.md) -- Phase 1 of the `bun:ffi`-compatible API migration this class is part of.
- [bun:ffi docs](https://bun.com/docs/runtime/ffi)
