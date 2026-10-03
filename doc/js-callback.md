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
| `args`    | no       | Array of types, names or `FFIType` numbers (see [Types](#types)) declaring the native parameter list, in order. Omit or use `[]` for a callback that takes no arguments; a value that is not an array is a `TypeError`. At most 32 arguments; more is a `TypeError`. |
| `returns` | no       | Type name for the value the native return slot expects (see [Types](#types)). Defaults to `"void"`. |

Throws if `ffi_closure_alloc()`/`ffi_prep_cif()`/`ffi_prep_closure_loc()`
fail (e.g. the platform is out of executable closure trampoline memory).

A `JSCallback` can be passed itself where a pointer is taken: a `CFunction`
argument declared `"pointer"`, `"function"` or `"T *"`, `ptr()` and `read`. `cb`
and `cb.ptr` are the same there, and a closed callback is a `TypeError`.
(`toArrayBuffer()` wants an address, not a callback.) The
`buffer_length` type is not supported in a callback (`TypeError`).

## Properties

| Property    | Type      | Description                                                                 |
| ----------- | --------- | ----------------------------------------------------------------------------- |
| `.ptr`      | `number` \| `bigint` \| `null` | The native function pointer: `number` (a `bigint` only above 2^53 - 1), or `null` after `.close()` (the trampoline is gone, there is no pointer). Pass this to any C API expecting a callback of the declared signature. |
| `.called`   | `number`  | How many times the trampoline has been invoked by native code so far.        |
| `.funcObj`  | `Function`| The wrapped JS function passed to the constructor.                          |
| `.exception`| any       | The exception thrown by the JS function on its most recent invocation, or `undefined` if it didn't throw. Reset to `undefined` at the start of each invocation. |
| `.threadsafe` | boolean | The `threadsafe` option as a boolean, `false` by default. The option is accepted for bun's sake; the callback still runs only when native code calls it on the JS thread. |

`JSCallback.list` is a static getter returning an array snapshot of every
currently-live `JSCallback` instance (useful for debugging/introspection).

## Methods

- `.close()` -- frees the `ffi_closure` (and the stored arg-type arrays)
  immediately, rather than waiting for GC. `.ptr` must not be called by
  native code afterward. Safe to call more than once.
- `.toString()` -- returns a string like `"#JSCallback (0x...)(*0x...)"`
  identifying the trampoline address.
- `[Symbol.toPrimitive]()` -- the function pointer as a number, `0` once closed,
  so `+cb` is what to pass to C.
- `[Symbol.dispose]()` -- the same as `.close()`, so `using cb = new
  JSCallback(...)` closes the callback at the end of the block. QuickJS has no
  `Symbol.dispose` yet: the method is then installed under the registered symbol
  `Symbol.for("Symbol.dispose")`, which is what the usual polyfills use, and it is
  the engine's own `Symbol.dispose` as soon as there is one.

## Types

Same vocabulary as in [Types and ABI](types.md), matching
[bun:ffi's `FFIType`](https://bun.com/docs/runtime/ffi#ffitype), without struct
types:

| Name                    | C type                          | JS value                                              |
| ----------------------- | -------------------------------- | ------------------------------------------------------ |
| `"void"`                | `void`                            | `undefined` (only valid as `returns`)                   |
| `"bool"`                | `_Bool` / `uint8_t`               | `boolean`                                                |
| `"i8"`, `"u8"`          | `int8_t`, `uint8_t`               | `number`                                                 |
| `"i16"`, `"u16"`        | `int16_t`, `uint16_t`             | `number`                                                 |
| `"i32"`                 | `int32_t`                         | `number`                                                 |
| `"u32"`                 | `uint32_t`                        | `number`                                                 |
| `"i64"`, `"u64"`        | `int64_t`, `uint64_t`             | `bigint` -- exact, no precision loss                     |
| `"i64_fast"`, `"u64_fast"` | `int64_t`, `uint64_t`          | `number` while the value is exact, else an exact `bigint`, see [Types and ABI](types.md#i64_fast-and-u64_fast) |
| `"f32"`                 | `float`                           | `number`                                                 |
| `"f64"`                 | `double`                          | `number`                                                 |
| `"pointer"` / `"ptr"` / `"function"` | `void *`             | `null` for a NULL pointer; otherwise a `number`, or a `bigint` above 2^53 - 1 |
| `"cstring"`             | `char *`                          | `string` -- the argument value is decoded from the incoming C string; returning `"cstring"` from `fn` is not automatically re-encoded to a native pointer (the return conversion writes the string's JS pointer representation, not a fresh C allocation) -- prefer numeric/`"pointer"` returns unless you know what you're doing |

An unrecognized type name in `args` or `returns` is a `TypeError` naming it.

## Exceptions thrown by `fn`

If the wrapped JS function throws while native code runs it, the native
caller cannot be told, so the callback returns what the declared `returns` type
converts `undefined` to (`0` for integer types, `NULL` for `"pointer"`), the
native function carries on, and when it returns the [`CFunction`](c-function.md)
call that started it **throws that exception**, as in bun:

```js
const cmp = new JSCallback(() => { throw new RangeError("boom"); }, { args: ["pointer", "pointer"], returns: "i32" });

try {
  qsort(data, 3, 4, cmp);
} catch(e) {
  e instanceof RangeError; // true: the exception of the comparator
}
```

*   If the callback throws more than once during one call (a comparator does),
    the first exception is the one thrown.
*   A return value that cannot be converted (a `Symbol` for an `i32`) is thrown
    the same way.
*   Nested calls are separate: a callback that catches the exception of its own
    `CFunction` call keeps the outer call clean.
*   `.exception` holds the exception of the callback's latest invocation too, and
    is the only record of one that happens outside a call.

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
