# Pointers and memory

Native memory is addressed by numbers. This page covers the functions that
turn buffers into addresses and addresses into buffers, values or strings.

*   [Pointer values](#pointer-values)
*   [`ptr()`](#ptr) and [`toPointer()`](#topointer): address of a buffer
*   [`toArrayBuffer()`, `toBuffer()`](#toarraybuffer): an `ArrayBuffer` over memory
*   [`read`](#read): read a value from an address
*   [`CString`](#cstring) and [`toString()`](#tostring): C strings
*   [`pointerSize`](#pointersize)

## Pointer values

Everywhere a pointer is returned (`dlsym()`, a `pointer`-typed result,
`ptr()`, `JSCallback.ptr`) it is

*   `null` for NULL,
*   a `number` up to 2^53 - 1 (`Number.MAX_SAFE_INTEGER`), which is exact and
    covers every user-space address on 64-bit Linux and Windows (they are below
    2^47), so pointer arithmetic is plain (`ptr(buf) + 8`),
*   an exact, unsigned `bigint` above that.

As in bun:ffi a `number` is what you get in practice. Unlike bun's `read.ptr`,
which rounds to a `number` above 2^53, a pointer is never rounded here.

Where a pointer is taken (a pointer argument, `ptr()`, `read`), a `number`, a
`bigint`, `null` (NULL), an `ArrayBuffer` or view (its address) or a
[`JSCallback`](js-callback.md) (its function pointer; a closed one is a
`TypeError`) is accepted, so a typed array or a
[generated struct class](gen-bindings.md) can be passed to a `pointer`
parameter as it is. A string is never read as an address (see
[`toPointer()`](#topointer)).

## `ptr()`

```js
const p = ptr(buffer[, byteOffset]);
```

The address of an `ArrayBuffer` or typed array, plus the offset of the view
(`new Uint8Array(buf, 8)` is at `ptr(buf) + 8`) plus `byteOffset`, which may
be negative. A number is returned as it is. Anything else throws a
`TypeError`.

```js
import { ptr } from "ffi";

const bytes = new Uint8Array(32);
const p = ptr(bytes);
const mid = ptr(bytes, 16); // 16 bytes further
```

The address is only good while the buffer is alive and not resized or
detached.

## `toPointer()`

```js
toPointer(buffer[, byteOffset]); // "0x55d0c8a4e2a0"
```

Like `ptr()`, but returns the address as a hexadecimal string, `"0"` for NULL.
Meant for display. Do not pass the string back as a pointer to the functions
here: a string is read as content by `toArrayBuffer()`, and is copied by the
legacy `call()`.

## `toArrayBuffer()`

```js
const ab = toArrayBuffer(ptr[, byteOffset[, byteLength[, deallocatorContext], jsTypedArrayBytesDeallocator]]);
```

Makes an `ArrayBuffer` over the memory at `ptr + byteOffset`, as bun:ffi's
`toArrayBuffer()`. `toBuffer()` is the same function (QuickJS has no Node
`Buffer`, so it also returns an `ArrayBuffer`).

| Argument | Description |
| -------- | ----------- |
| `ptr` | An address (`number` or `bigint`). NULL throws a `TypeError`. |
| `byteOffset` | Bytes to skip first. Defaults to 0. |
| `byteLength` | Size of the buffer in bytes. Omitted, the memory is read up to the first NUL byte, as a C string is. Negative is a `RangeError`. |
| `deallocatorContext` | An address passed to the deallocator. `null` or omitted for NULL. |
| `jsTypedArrayBytesDeallocator` | The address of a native function `void (*)(void *bytes, void *context)`, called when the buffer is freed. |

The buffer is a view, not a copy: writes to it change the native memory, and
the memory must stay valid for as long as the buffer is used. Without a
deallocator the memory is never freed. `.slice(0)` makes a copy:

```js
import { toArrayBuffer, ptr } from "ffi";

const src = new Uint8Array([1, 2, 3, 4, 5]);
const view = new Uint8Array(toArrayBuffer(ptr(src), 1, 3)); // [2, 3, 4]
src[2] = 99;
console.log(view[1]); // 99: the same memory

const copy = toArrayBuffer(ptr(src), 0, 5).slice(0); // not affected by later writes
```

### Freeing the memory with the buffer

`jsTypedArrayBytesDeallocator` is the address of a *native* function, not a
JavaScript one. With a context it is the fifth argument; without, the fourth:

```js
import { toArrayBuffer, dlsym, CFunction, RTLD_DEFAULT } from "ffi";

const malloc = CFunction({ ptr: dlsym(RTLD_DEFAULT, "malloc"), args: ["u64"], returns: "pointer" });
const free = dlsym(RTLD_DEFAULT, "free");

let ab = toArrayBuffer(malloc(1024n), 0, 1024, free); // free(bytes, <ignored>)
ab = null; // when the buffer is collected: free() runs
```

The deallocator runs on the JavaScript thread, while QuickJS is finalizing the
buffer: it must not call back into JavaScript, so a [`JSCallback`](js-callback.md)
is rejected (`TypeError`), as is anything that is not an address.

### From an `ArrayBuffer` or a string

The older form `toArrayBuffer(source[, size[, copy]])` still works for a source
that is an `ArrayBuffer` (or view) or a string. A string is taken as content
and is copied, as an `ArrayBuffer` is unless `copy` is `false`:

```js
toArrayBuffer("hello"); // an ArrayBuffer holding 5 bytes
toArrayBuffer(buffer, 4, false); // the first 4 bytes of `buffer`, not copied
```

A boolean among the later arguments of the pointer form is a `TypeError`: the
copy flag exists only here.

## `read`

```js
read.u8(ptr, byteOffset);
```

Reads a value directly from an address, without making a `DataView` or an
`ArrayBuffer`. `ptr` is an address, or an `ArrayBuffer` or view. The offset
defaults to 0, may be negative, and the read need not be aligned. NULL throws a
`TypeError`.

| Function | Reads | Returns |
| -------- | ----- | ------- |
| `read.i8` / `read.u8` | 1 byte, signed / unsigned | `number` |
| `read.i16` / `read.u16` | 2 bytes | `number` |
| `read.i32` / `read.u32` | 4 bytes | `number` |
| `read.i64` / `read.u64` | 8 bytes | `bigint` |
| `read.f32` / `read.f64` | `float` / `double` | `number` |
| `read.ptr` | a pointer | [pointer value](#pointer-values) |
| `read.intptr` | a pointer-sized signed integer | `number` |

All reads are little-endian. Reading past the memory, or from a bad address,
crashes the process.

```js
import { read, ptr } from "ffi";

const mem = new Uint8Array([1, 0xff, 2, 0x80, 0x78, 0x56, 0x34, 0x12]);

read.u8(ptr(mem), 1); // 255
read.i8(ptr(mem), 1); // -1
read.u32(ptr(mem), 4); // 0x12345678
```

## `CString`

```js
const s = CString(ptr[, byteOffset[, byteLength]]);
```

The C string at `ptr + byteOffset`, decoded as UTF-8 into a JavaScript string.
Without `byteLength` it ends at the first NUL byte. It is a string, not an
object, so it stays valid after the memory is freed; NULL (or no argument)
gives `""`. As in bun:ffi it may be called with `new`, which also gives a string.
`ptr` may be an address or an `ArrayBuffer` or view.

```js
import { CString, ptr } from "ffi";

const bytes = Uint8Array.from("hello\0world", c => c.charCodeAt(0));

console.log(CString(ptr(bytes))); // hello
console.log(CString(ptr(bytes), 6, 5)); // world
console.log(CString(ptr(bytes), 6)); // world
console.log(CString(null) === ""); // true
```

A negative `byteLength` is a `RangeError`. (bun refuses a `byteLength` of 0;
here it gives `""`.) To get a string from a function that returns `char *`,
declare the return type `"cstring"` and it arrives decoded.

## `toString()`

```js
toString(buffer[, byteOffset[, byteLength]]);
toString(ptr[, byteLength]);
```

Decodes bytes as UTF-8 into a string. A buffer argument takes the offset and
length of the bytes to use, the whole buffer by default. An address reads
`byteLength` bytes, or up to the first NUL byte when omitted. NULL gives `null`.

```js
toString(bytes.buffer, 6, 5); // "world"
toString(ptr(bytes)); // "hello"
toString(ptr(bytes), 3); // "hel"
```

## `pointerSize`

The size of a pointer in bytes: `8` on 64-bit targets. Use it to lay out
structures of pointers and to step over arrays of them.

```js
read.ptr(p, i * pointerSize);
```
