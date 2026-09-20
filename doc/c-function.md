# CFunction

`CFunction` wraps an already-resolved native function pointer as a plain,
directly-callable JavaScript function. It mirrors [bun:ffi's
`CFunction`](https://bun.com/docs/runtime/ffi#cfunction).

Unlike the legacy [`define()`/`call()`](../README.md#define-call-tostring-toarraybuffer)
pair, there is no name-keyed registry: the `ffi_cif` (libffi's prepared call
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

`CFunction()` is a factory function, not a constructor -- call it directly,
without `new`.

```js
fn = CFunction({ ptr, args, returns, abi })
```

| Option    | Required | Description                                                                                       |
| --------- | -------- | --------------------------------------------------------------------------------------------------- |
| `ptr`     | yes      | The native function pointer to call. Anything accepted by `toPointer`/`js_ptr` works: `null`, a number/BigInt address (e.g. from `dlsym()`, which itself returns `null` for a NULL pointer), or an ArrayBuffer/TypedArray. |
| `args`    | no       | Array of type names (see [Types](#types)) declaring the parameter list, in order. Omit or use `[]` for a function that takes no arguments; a value with no usable `length` (not an object, or a `length` that is missing, negative or throws) is treated the same as omitted. Up to 32 arguments are supported; extras beyond that are dropped. |
| `returns` | no       | Type name for the return value (see [Types](#types)). Defaults to `"void"`.                       |
| `abi`     | no       | Call ABI name (see [ABI](#abi)). Defaults to `"default"`.                                          |

If `ptr` cannot be resolved to a non-null pointer, or the declared types
can't be turned into a working `ffi_cif`, `CFunction()` throws a
`TypeError`.

The returned function's `.length` matches the declared `args` count. Extra
arguments passed at call time are ignored; missing ones are treated as
`undefined` (and converted per the declared type, e.g. `0`/`NaN`-like for
numeric types).

## Types

Same vocabulary as [`JSCallback`](js-callback.md#types), matching
[bun:ffi's `FFIType`](https://bun.com/docs/runtime/ffi#ffitype):

| Name                    | C type                          | JS value                                              |
| ----------------------- | -------------------------------- | ------------------------------------------------------ |
| `"void"`                | `void`                            | `undefined` (only valid as `returns`)                   |
| `"bool"`                | `_Bool` / `uint8_t`               | `boolean`                                                |
| `"i8"`, `"u8"`          | `int8_t`, `uint8_t`               | `number`                                                 |
| `"i16"`, `"u16"`        | `int16_t`, `uint16_t`             | `number`                                                 |
| `"i32"`                 | `int32_t`                         | `number`                                                 |
| `"u32"`                 | `uint32_t`                        | `number`                                                 |
| `"i64"`, `"u64"`        | `int64_t`, `uint64_t`             | `bigint` -- exact, no precision loss                     |
| `"i64_fast"`, `"u64_fast"` | `int64_t`, `uint64_t`          | `number` -- fast to convert, but lossy above 2^53         |
| `"f32"`                 | `float`                           | `number`                                                 |
| `"f64"`                 | `double`                          | `number`                                                 |
| `"pointer"` / `"ptr"` / `"function"` | `void *`             | `null` for a NULL pointer; otherwise `number` if the address fits in 32 bits, `bigint` otherwise |
| `"cstring"`             | `char *`                          | `string` (return) / `string` (argument, copied via `JS_ToCString`) -- decoded/encoded as a NUL-terminated C string |

An unrecognized type name in `args` silently falls back to `"i32"`; an
unrecognized `returns` falls back to `"void"`. This matches `JSCallback`'s
behavior and is a known rough edge -- prefer sticking to the table above.

`"cstring"` arguments are converted with `JS_ToCString()` for the duration
of the call and freed immediately afterward; the native function must not
retain the pointer past the call returning.

## ABI

| Name        | Notes                                    |
| ----------- | ----------------------------------------- |
| `"default"` | Platform default. Used when `abi` is omitted. |
| `"sysv"`    | Only available where libffi defines `FFI_SYSV`. |
| `"unix64"`  | Only available where libffi defines `FFI_UNIX64`. |
| `"stdcall"` | Windows only (`FFI_STDCALL`).             |
| `"win64"`   | Windows only (`FFI_WIN64`).                |

An unrecognized or platform-unavailable ABI name falls back to
`"default"`.

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
Passing a `JSCallback`'s `.ptr` as a `CFunction` argument (declared
`"pointer"`) is how you hand a JS-backed callback to a native API expecting
a function pointer.

## See also

- [`doc/js-callback.md`](js-callback.md)
- [`TODO.md`](../TODO.md) -- Phase 1 of the `bun:ffi`-compatible API migration this class is part of.
- [bun:ffi docs](https://bun.com/docs/runtime/ffi)
