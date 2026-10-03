# `node:ffi` on top of `ffi`

Node 26 has an experimental [`node:ffi`](https://nodejs.org/api/ffi.html). Its
API is not bun:ffi's, which is what the module `ffi` follows, and two names
mean different things in them (`toArrayBuffer(pointer, length)` against
`toArrayBuffer(ptr, byteOffset, byteLength)`). So the Node API is a separate
module, `node-ffi.js`, installed next to `ffi`:

```js
import { dlopen, getInt32, setInt32 } from "node-ffi.js";

const { lib, functions } = dlopen("libm.so.6", {
  cos: { arguments: ["float64"], return: "float64" },
});

functions.cos(0); // 1
lib.close();
```

## Running a script written for `node:ffi`

A script that says `import { dlopen } from "node:ffi"` runs unchanged with the
hook file installed next to the module:

```sh
qjsm -I ffi-hooks.js script.js
```

`-I` runs the hook first and it stays for every later import, dynamic ones too.
It maps `node:ffi` to `node-ffi.js`, and `bun:ffi` to `ffi`, so a script written
for Bun runs the same way.

**Without the hook `qjsm` reads `node:ffi` as plain `ffi`**, which is the bun
API under Node's name: `dlopen()` then returns `{ symbols, close }`, not
`{ lib, functions }`, and a script written for Node misbehaves without saying
why.

## What it has

| `node:ffi` | Here |
| --- | --- |
| `dlopen(path, definitions)` | `{ lib, functions }`, closable with `using` |
| `dlclose(handle)`, `dlsym(handle, name)` | a `DynamicLibrary` or a raw handle; `dlsym` gives a `bigint` |
| `class DynamicLibrary` | `getFunction`, `getFunctions`, `getSymbol`, `getSymbols`, `registerCallback`, `unregisterCallback`, `refCallback`, `unrefCallback`, `close`, `[Symbol.dispose]` |
| `fn.pointer` | the function's address as a `bigint` |
| `getInt8` ... `getFloat64`, `setInt8` ... `setFloat64` | [`read`](pointers.md#read) and [`write`](pointers.md#write) under Node's names |
| `toString`, `toBuffer`, `toArrayBuffer` | `(pointer[, length[, copy]])` as in Node: a copy unless `copy` is `false` |
| `exportString`, `exportBuffer`, `exportArrayBuffer`, `exportArrayBufferView` | copy into native memory, with a length check |
| `getRawPointer(source)` | the address of a buffer, as a `bigint` |
| `suffix` | `"so"`, `"dylib"` or `"dll"` |

## Where it follows Node, not `ffi`

*   A pointer is always a `bigint`, `0n` for NULL (`ffi` gives a `number` or
    `null`). A pointer argument takes a `bigint`, `null`, a buffer, a typed
    array or a `DataView`.
*   A 64-bit integer is a `bigint`; 8, 16 and 32-bit integers and floats are
    `number`s. `bool` is a `u8` number and `char` an `i8`.
*   `string` as an argument is a UTF-8 string for the duration of the call; as a
    return it is the address, like every pointer. `buffer`, `arraybuffer` and
    `function` are pointers.
*   `toBuffer` gives a `Uint8Array`, as QuickJS has no `Buffer`.
*   The type names are Node's (`int32`, `float64`, `string`, ...), and a
    signature is `{ arguments, return }`.

## What is not there

*   `getCurrentEventLoop()` and the permission flags.
*   A callback is not checked: it may throw, return a promise, or close its own
    library, which Node calls undefined behavior. It has to run on the thread
    that made it, as for [`JSCallback`](js-callback.md).
*   `refCallback` and `unrefCallback` hold the callback strongly or not; one
    that is collected is gone and calling it crashes, as in Node.

## Not in `node:ffi`, but here

[Structs by value](types.md#structs-by-value), [variables](dlopen.md#variables),
[variadic functions](c-function.md#variadic-functions), `errno()` and `cc()` are
in `ffi`, not in this module's Node API; import them from `"ffi"`.
