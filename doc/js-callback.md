# JSCallback

`JSCallback` wraps a JavaScript function as a native function pointer
(`.ptr`) that, when invoked by C code, calls back into JS with the real
arguments the native caller passed. It mirrors [bun:ffi's
`JSCallback`](https://bun.com/docs/runtime/ffi#jscallback).

```js
import { JSCallback } from "ffi";

const cb = new JSCallback((a, b) => a + b, { args: ["i32", "i32"], returns: "i32" });

someNativeApiExpectingAFunctionPointer(cb.ptr);

// ...

cb.close();
```

Each `JSCallback` instance owns its own `ffi_closure`/`ffi_cif`, built from
the declared `args`/`returns` types via `ffi_closure_alloc()` +
`ffi_prep_closure_loc()`. `.ptr` is a real trampoline: native code calling
through it has its arguments marshaled into `JSValue`s per the declared
types, the JS function is called with those real values, and its return
value is marshaled back into the native ABI return slot per the declared
return type.

## Constructor

```js
cb = new JSCallback(fn, { args, returns })
```

| Parameter | Required | Description                                                                 |
| --------- | -------- | ---------------------------------------------------------------------------- |
| `fn`      | yes      | The JS function to call back into. Must be callable, or a `TypeError` is thrown. |
| `args`    | no       | Array of type names (see [Types](#types)) declaring the native parameter list, in order. Omit or use `[]` for a callback that takes no arguments. Up to 32 arguments are supported; extras beyond that are dropped. |
| `returns` | no       | Type name for the value the native return slot expects (see [Types](#types)). Defaults to `"void"`. |

Throws if `ffi_closure_alloc()`/`ffi_prep_cif()`/`ffi_prep_closure_loc()`
fail (e.g. the platform is out of executable closure trampoline memory).

## Properties

| Property    | Type      | Description                                                                 |
| ----------- | --------- | ----------------------------------------------------------------------------- |
| `.ptr`      | `number`  | The native function pointer. Pass this to any C API expecting a callback of the declared signature. |
| `.called`   | `number`  | How many times the trampoline has been invoked by native code so far.        |
| `.funcObj`  | `Function`| The wrapped JS function passed to the constructor.                          |
| `.exception`| any       | The exception thrown by the JS function on its most recent invocation, or `undefined` if it didn't throw. Reset to `undefined` at the start of each invocation. |

`JSCallback.list` is a static getter returning an array snapshot of every
currently-live `JSCallback` instance (useful for debugging/introspection).

## Methods

- `.close()` -- frees the `ffi_closure` (and the stored arg-type arrays)
  immediately, rather than waiting for GC. `.ptr` must not be called by
  native code afterward. Safe to call more than once.
- `.toString()` -- returns a string like `"#JSCallback (0x...)(*0x...)"`
  identifying the trampoline address.

## Types

Same vocabulary as [`CFunction`](c-function.md#types), matching
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
| `"pointer"` / `"ptr"` / `"function"` | `void *`             | `number` address                                          |
| `"cstring"`             | `char *`                          | `string` -- the argument value is decoded from the incoming C string; returning `"cstring"` from `fn` is not automatically re-encoded to a native pointer (the return conversion writes the string's JS pointer representation, not a fresh C allocation) -- prefer numeric/`"pointer"` returns unless you know what you're doing |

An unrecognized type name in `args` silently falls back to `"i32"`; an
unrecognized `returns` falls back to `"void"`.

## Exceptions thrown by `fn`

If the wrapped JS function throws during an invocation, the exception is
caught, stored on `.exception`, and the native return value is whatever the
declared `returns` type converts `undefined` to (e.g. `0` for integer
types, `NULL` for `"pointer"`/`"cstring"`). The native caller is not made
aware that an exception occurred -- check `.exception` afterward if that
matters.

## Example: using a JSCallback with qsort()

```js
import { dlopen, dlsym, JSCallback, CFunction, RTLD_DEFAULT } from "ffi";

const cmp = new JSCallback(
  (a, b) => {
    // a, b are the two "pointer" values qsort is comparing (as numbers);
    // in a real comparator you'd deref them via toArrayBuffer()/toString().
    return 0;
  },
  { args: ["pointer", "pointer"], returns: "i32" },
);

const qsort = CFunction({
  ptr: dlsym(RTLD_DEFAULT, "qsort"),
  args: ["pointer", "u64", "u64", "pointer"],
  returns: "void",
});

// qsort(base, nmemb, size, cmp.ptr);
cmp.close();
```

## Relationship to CFunction

[`CFunction`](c-function.md) and `JSCallback` are mirror images: `CFunction`
lets JS call into native code, `JSCallback` lets native code call into JS.

## See also

- [`doc/c-function.md`](c-function.md)
- [`TODO.md`](../TODO.md) -- Phase 0 of the `bun:ffi`-compatible API migration this class is part of. Replaces the previous `CallClosure`/`opaque-call.[ch]`, whose trampoline was hardcoded to a fixed `int64_t(*)(void*)` signature and always invoked the JS function with zero arguments.
- [bun:ffi docs](https://bun.com/docs/runtime/ffi)
