# Types and ABI


The names a signature is written with, matching [bun:ffi's
`FFIType`](https://bun.com/docs/runtime/ffi#ffitype). They are the same for
[`dlopen()`](dlopen.md), [`linkSymbols()`](dlopen.md#linksymbols),
[`CFunction`](c-function.md), [`cc()`](c-compiler.md) and
[`JSCallback`](js-callback.md) (which takes no struct types).

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
| C-style aliases         | as the short name               | `"int8_t"`/`"int16_t"`/`"int32_t"`/`"int"` = `i8`/`i16`/`i32`/`i32`; `"int64_t"`/`"isize"` = `i64`; `"uint8_t"`/`"uint16_t"`/`"uint32_t"` = `u8`/`u16`/`u32`; `"uint64_t"`/`"usize"` = `u64`; `"float"` = `f32`; `"double"` = `f64`; `"char"` = `i8`; `"buffer"`/`"fn"`/`"callback"` = `pointer` (bun:ffi's names) |
| `"<type> *"`            | `<type> *`                        | same as `"pointer"`, for any `<type>` (`"int *"`, `"struct node **"`, `"void*"`): every name ending in `*` is a pointer and what precedes it is documentation. `"char *"` is therefore a plain pointer; use `"cstring"` for a string |
| `"cstring"`             | `char *`                          | `string` (return) / `string` (argument, copied via `JS_ToCString`) -- decoded/encoded as a NUL-terminated C string |
| `[ <type>, ... ]`       | a struct passed or returned by value | an `ArrayBuffer` of the struct's bytes, see [Structs by value](#structs-by-value) |

An unrecognized type name in `args` silently falls back to `"i32"`; an
unrecognized `returns` falls back to `"void"`. This matches `JSCallback`'s
behavior and is a known rough edge -- prefer sticking to the table above.

`"cstring"` arguments are converted with `JS_ToCString()` for the duration
of the call and freed immediately afterward; the native function must not
retain the pointer past the call returning.

## Structs by value

A type given as an array is a struct passed (in `args`) or returned (as
`returns`) by value. The array lists the struct's members in memory order, each
a type name from the table or, for a nested struct, an array; an array member is
listed once per element, and a bitfield by the integers covering its bytes:

```js
// struct vec3 { float x, y, z; };  vec3 vec3_add(vec3 a, vec3 b);
const VEC3 = ['f32', 'f32', 'f32'];
const add = CFunction({ ptr, args: [VEC3, VEC3], returns: VEC3 });

const r = add(a, b); // an ArrayBuffer of 12 bytes: new Float32Array(r)
```

libffi works out the size, the alignment and which registers the struct travels
in from that list alone, so it has to reproduce the real layout member by
member: a list that does not is accepted and the call then silently reads or
writes the wrong bytes. `tools/gen-bindings.js` checks this against the
compiler's layout and only binds a function when it holds.

*   An argument is an `ArrayBuffer` or a view of one (so a generated struct
    class works as it is), at least as big as the struct, else `TypeError`. Its
    bytes are copied for the call.
*   The result is a new `ArrayBuffer` holding a copy of the returned bytes.
*   An empty array, a nesting more than 8 deep, or a member that is not a type
    name or an array throws when the `CFunction` is made.
*   `JSCallback` does not take struct types and throws a `TypeError`.


## FFIType

`FFIType` holds bun:ffi's type constants, so `FFIType.i32` can be used where
`"i32"` is written, and the other way round:

```js
import { dlopen, FFIType } from "ffi";

const { symbols } = dlopen(null, {
  abs: { args: [FFIType.i32], returns: FFIType.i32 },
});
```

As in bun:ffi, every member is a number, and a signature takes a name or a
number: `FFIType.i32` is `5`, and `{ args: [5], returns: 5 }` means the same as
`{ args: ["i32"], returns: "i32" }`. The numbers are bun's:

| Number | Members |
| ------ | ------- |
| 0 | `char` |
| 1, 2 | `i8` `int8_t`; `u8` `uint8_t` |
| 3, 4 | `i16` `int16_t`; `u16` `uint16_t` |
| 5, 6 | `i32` `int32_t` `int` `c_int`; `u32` `uint32_t` `c_uint` |
| 7, 8 | `i64` `int64_t` `isize`; `u64` `uint64_t` `usize` |
| 9, 10 | `f64` `double`; `f32` `float` |
| 11 | `bool` |
| 12 | `pointer` `ptr` `"void*"` `"char*"` |
| 13, 14 | `void`; `cstring` |
| 15, 16 | `i64_fast`; `u64_fast` |
| 17 | `function` `callback` `fn` |
| 18, 19 | `napi_env`, `napi_value` |
| 20 | `buffer` |
| 21 | `buffer_length` `buffer_bytelength` |

Each of the numbers 0 to 17 is also a key that maps to itself (`FFIType[5] ===
5`), as in bun, which has 61 members in all.

Not every member can be used in a signature. `napi_env` and `napi_value` only
mean something in Node-API, and `buffer_length` is not implemented yet: they are
unknown types, which an argument reads as `i32` and a return as `void`.

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
