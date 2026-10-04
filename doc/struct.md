# FFIStruct

`FFIStruct` describes a C `struct`, `union` or C++ class once and returns a
constructor. Its instances are **real `ArrayBuffer`s** over the native
memory, decorated with one accessor per field and one method per C function
that takes the type as its first argument. This is an extension; bun:ffi has
no equivalent (it only gives `toArrayBuffer()` and `read`).

*   [Usage](#usage)
*   [FFIStruct()](#ffistruct-1)
*   [Fields](#fields)
*   [Instances](#instances)
*   [The constructor](#the-constructor)
*   [Methods](#methods)
*   [Function pointers](#function-pointers)
*   [In signatures and variables](#in-signatures-and-variables)
*   [Errors](#errors)

## Usage

```js
import { dlopen, FFIStruct } from "ffi";

const Point = FFIStruct({
  name: "Point",
  fields: { x: "f64", y: "f64" },
});

const { symbols } = dlopen("libgeom.so", {
  Point_len: { args: [Point], returns: "f64" }, // becomes Point.prototype.len
  Point_new: { args: ["f64", "f64"], returns: Point },
});

const p = symbols.Point_new(3, 4); // a Point over the pointer C returned
p.x;                               // 3
p.y = 8;                           // writes the C memory
p.len();                           // Point_len(p), a number

p instanceof ArrayBuffer;          // true
p.byteLength;                      // 16
new Uint8Array(p);                 // the same bytes
```

An instance is not a wrapper around an `ArrayBuffer`: it is one, so every
function that takes a buffer (`read`, `write`, `ptr()`, a `"pointer"`
argument, `DataView`, `structuredClone`) takes it unchanged.

## FFIStruct()

```js
Type = FFIStruct({ name, kind, fields, size, align, methods })
```

| Option    | Required | Description |
| --------- | -------- | ----------- |
| `fields`  | yes      | An object, one entry per member, in memory order, see [Fields](#fields). Empty is a `RangeError`. |
| `name`    | no       | Shown by `inspect` and in errors; the name of the returned constructor. Default `"FFIStruct"`. |
| `kind`    | no       | `"struct"` (default) or `"union"`. A union puts every field at offset 0 and sizes the type by its largest member. |
| `size`    | no       | The byte size, when the C type has trailing padding or members that are not declared. Smaller than the fields need is a `RangeError`. Default: the fields, rounded up to `align`. |
| `align`   | no       | The alignment, a power of two. Default: the largest member alignment. |
| `methods` | no       | Functions called with the instance as first argument, see [Methods](#methods). |

`FFIStruct()` is called without `new`. The offsets are the C ones for the
platform: each field sits at the next multiple of its own alignment, unless it
sets `offset`.

## Fields

An entry is a type, or an object with the type and what is not natural:

```js
fields: {
  id: "i32",                           // offset 0
  flags: "u8",                         // offset 4
  size: { type: "u64", offset: 16 },   // explicit offset
  name: { type: "u8", count: 16 },     // char name[16], a Uint8Array
  pos: Point,                          // an embedded Point, a view
  next: "pointer",                     // an address, or null
  label: "cstring",                    // char *, decoded to a string
  draw: { type: "function", args: ["f64"], returns: "void" },
}
```

| Property | Description |
| -------- | ----------- |
| `type`   | Any [type](types.md) (name, alias, `FFIType` number), another `FFIStruct` constructor (embedded, not a pointer), or `"function"` with `args` and `returns`. A by-value array form (`["f32", "f32"]`) is not a field type: use `FFIStruct()` for it. |
| `offset` | Byte offset from the start. Default: after the previous field, aligned. |
| `count`  | An array of `count` elements, at least 1. |
| `args`, `returns`, `abi`, `self`, `native` | For `type: "function"` only, see [Function pointers](#function-pointers). |

What a field reads as, per type:

| Field type | Read | Write |
| ---------- | ---- | ----- |
| `bool`, `i8` to `u32`, `f32`, `f64` | `number` (`bool`: `boolean`) | a number, converted as an argument is (integers wrap to their width) |
| `i64`, `u64` | `bigint` | a `bigint` or `number` |
| `i64_fast`, `u64_fast` | `number`, or a `bigint` when not exact | as above |
| `pointer`, `"T *"` | `null`, a `number`, or a `bigint` above 2^53 - 1 | an address, a view, a `JSCallback`, or `null`; as in [Pointer values](pointers.md#pointer-values) |
| `cstring` | the `string` the `char *` points to, `null` for NULL | a string is **not** accepted: a C string needs an owner, so write the pointer of a buffer you keep alive |
| `count` of a numeric type | a typed array over the elements (`Float64Array` for `f64`, `Uint8Array` for `u8` and `bool`, `BigInt64Array` for `i64`, ...), aliasing the memory | not assignable; write into the typed array |
| another `FFIStruct` | an instance over the embedded bytes | not assignable; assign the fields of the view |
| `count` of an `FFIStruct` | a frozen `Array` of views, rebuilt on each read | not assignable |
| `function` | a [`CFunction`](c-function.md), the JS function of an open `JSCallback`, or `null` | an address, a `CFunction`, a `JSCallback` or `null`; a plain function is a `TypeError` |

Reading a field a second time gives the memory as it is then: nothing is
cached. A view (typed array or embedded instance) stays valid as long as the
instance that made it does; it keeps that instance alive.

Bit-fields are not supported: describe the storage unit as an integer field
and mask it.

## Instances

An instance is an `ArrayBuffer` whose prototype chain is `Type.prototype`,
then `FFIStruct.prototype`, then `ArrayBuffer.prototype`. It has no own
properties. Everything below is inherited.

| Member | Description |
| ------ | ----------- |
| a field name | the [field](#fields) accessor. The accessors are enumerable on the prototype, so `"x" in p` is true. |
| `byteLength`, `slice()`, ... | the `ArrayBuffer` ones, correct for the type's size. `resizable` is false; `resize()` is a `TypeError` |
| `p.type` | the constructor the instance was made by |
| `p.toJSON()` | a plain object of every field, recursively: pointers as numbers, 64-bit integers as strings, `function` fields as `null` or the address |
| `p.set(object)` | assigns each own enumerable property that is a field name; an unknown name is a `TypeError`. Returns `p` |
| `Symbol.for("nodejs.util.inspect.custom")` | `Point { x: 3, y: 8 }` |

An instance is not extensible: `p.typo = 1` is a `TypeError` in strict code
(module code), so a misspelled field is not silently a new property.

```js
JSON.stringify(p);        // {"x":3,"y":8}
Object.assign(p, {x: 1}); // works too: each assignment hits the accessor
p.set({ x: 1, y: 2 });    // Point { x: 1, y: 2 }
```

An access to an instance whose buffer was detached (`p.transfer()`) is a
`TypeError`. `transfer()` copies the bytes into a new plain `ArrayBuffer`
and leaves the C memory untouched.

## The constructor

```js
new Point();           // zeroed memory the instance owns, freed with it
new Point({ x: 1 });   // the same, then p.set({ x: 1 })
Point.at(ptr);         // the memory at ptr, not owned: a view
Point.at(ptr, count);  // an Array of `count` views, element size apart
```

| Member | Description |
| ------ | ----------- |
| `new Type([init])` | Allocates `Type.size` zeroed bytes. `init` is an object for `p.set()`. The memory is freed with the instance. |
| `Type.at(ptr[, count])` | A view of the native memory at `ptr` (an address or a buffer), never freed by this module. `null` for a NULL `ptr`. With `count`, an `Array` of views over consecutive elements. A buffer shorter than `Type.size` is a `RangeError`. |
| `Type.size` | the size in bytes (`sizeof`) |
| `Type.align` | the alignment in bytes |
| `Type.kind` | `"struct"` or `"union"` |
| `Type.fields` | `{ x: { type, offset, count }, ... }`, frozen; `type` as given |
| `Type.offsetof(name)` | the byte offset of a field; an unknown name is a `TypeError` |
| `Type.method(name, spec)` | adds a [method](#methods) after the fact |
| `Type.name` | the `name` option |

`Type.at()` is how a pointer returned by C becomes an object, when the
signature did not already say so (see [In signatures](#in-signatures-and-variables)). Memory
behind `at()` is the library's: after `close()` or a `free()` the instance dangles,
as any [pointer](pointers.md) does.

A view made by `at()` reads and writes with no copy, so two views of the same
address see each other's writes.

## Methods

A method is a C function whose first parameter is a pointer to the type. The
instance is passed there; the other arguments are the call's.

```js
const Point = FFIStruct({
  name: "Point",
  fields: { x: "f64", y: "f64" },
  methods: {
    scale: { ptr: dlsym(h, "Point_scale"), args: ["f64"], returns: "void" },
  },
});

new Point({ x: 1, y: 2 }).scale(3);  // Point_scale(&p, 3.0)
```

`args` in `methods` does not list the instance. `ptr` is as in
[`CFunction`](c-function.md). A method is a `CFunction` bound on the
prototype, so it is shared by every instance.

[`dlopen()`](dlopen.md), `linkSymbols()` and `cc()` attach methods themselves:
a function symbol whose **first argument is an `FFIStruct` constructor** is
also added to that type's prototype.

```js
dlopen("libgeom.so", {
  Point_len: { args: [Point], returns: "f64" },                // p.len()
  Point_dist: { args: [Point, Point], returns: "f64" },        // p.dist(q)
  point_free: { args: [Point], returns: "void", method: "free" }, // p.free()
  point_dump: { args: [Point], returns: "void", method: false },  // not attached
});
```

*   The method is named after the symbol with a leading `<Type.name>_`
    removed (`Point_len` is `len`), else the symbol name. `method: "free"`
    gives another name; `method: false` attaches nothing.
*   The function is still returned in `symbols` as a plain function taking the
    instance as its first argument.
*   Attaching a name that is a field, or a method already there, is a
    `TypeError` that names both.
*   C++: a member function is a symbol with its mangled name and `this` as the
    first argument; give it `method` to get a readable name.

## Function pointers

A field of `type: "function"` holds a C function pointer. Reading it gives a
[`CFunction`](c-function.md) for the address, `null` for NULL, or the JS
function behind a [`JSCallback`](js-callback.md) (see below).

```js
const Ops = FFIStruct({
  name: "Ops",
  fields: {
    count: "i32",
    add: { type: "function", args: ["i32", "i32"], returns: "i32" },
    reset: { type: "function", self: true, args: [], returns: "void" },
  },
});

const ops = Ops.at(getOps());
ops.add(1, 2);      // a plain CFunction: add(1, 2)
ops.reset();        // reset(&ops): self puts the instance first
ops.add = null;     // the pointer is NULL now
ops.add;            // null

const fn = (a, b) => a + b;
const cb = new JSCallback(fn, { args: ["i32", "i32"], returns: "i32" });
ops.add = cb;       // you make the JSCallback and you close() it
ops.add === fn;     // true: no JS -> C -> JS hop
ops.add = fn;       // TypeError: a plain function is not converted
```

| Property | Description |
| -------- | ----------- |
| `args`, `returns`, `abi` | the signature, as for `CFunction` |
| `self`   | `true` passes the instance as the first argument, as a C++ virtual or a "vtable" call does. `args` does not list it. Default `false` |
| `native` | `true` always reads a `CFunction`, never the JS function of a callback. Default `false` |

**Writing.** A field takes an address (`number` or `bigint`), a `CFunction`, a
`JSCallback` (its `.ptr`) or `null`. A plain JS function is a `TypeError` that
says to wrap it in a `JSCallback`: the struct never creates one, so it never
decides when one is closed. The `JSCallback` stays yours; closing it leaves
the field holding a dead address.

**Reading.** If the address is the trampoline of an open `JSCallback`, the
field reads as the function that callback wraps; otherwise as a `CFunction`
for the address. The unwrapped function is the plain JS function, so called
from JS it differs from a call through C:

*   arguments and the return value are not converted to the declared types
*   an exception is thrown at once, not held until a native call returns
*   `this` is the instance, not `undefined`

With `self: true` the function read is a wrapper that passes the address of
the instance first, as the callback expects. It is not unwrapped when the
callback's parameter count differs from the field's `args` (plus the instance
for `self`); the field then reads as a `CFunction`. `native: true` skips all of
it.

The `CFunction` is rebuilt for the address on each read when the address
changed; reading twice gives the same function while the field is unchanged.
Closing it does nothing to the field.

## In signatures and variables

A constructor can be used where a type is expected:

| Where | Meaning |
| ----- | ------- |
| `args: [Point]` | a pointer to the instance's bytes (`Point *`); an instance, or a buffer of at least `Point.size`, or `null` |
| `returns: Point` | the returned pointer, as `Point.at()`; `null` for NULL |
| `{ type: Point }` as a variable | the variable's own memory as an instance, where it used to be a plain `ArrayBuffer` |
| a field `type: Point` | the type embedded, not a pointer |
| a field `type: "pointer"` | a plain address |

A struct passed by value stays the array form (`["f32", "f32"]`), see
[Structs by value](types.md#structs-by-value); `FFIStruct` is for memory that has
an address.

```js
const { symbols } = dlopen("libgeom.so", {
  origin: { type: Point },          // a global `Point origin;`
  Point_make: { args: [], returns: Point },
});

symbols.origin.x = 5;               // writes the library's variable
```

## Errors

| Thrown | When |
| ------ | ---- |
| `TypeError` | a field type that is unknown, a by-value array form or an `FFIStruct` that is not yet complete (self-embedding); `fields` missing or not an object; an unknown name in `set()` or `offsetof()`; a write to a read-only member (an array or embedded struct); a method name that is taken; `cstring` assigned a string; a `function` field assigned a plain function; an access on a detached instance |
| `RangeError` | no fields; `count` below 1; an `offset` or `size` that makes fields overlap in a `struct` or does not fit the type; `align` not a power of two; `at()` on a buffer shorter than the type |
| the exception from the field | a field's `args`/`returns` that does not parse: as in [`CFunction`](c-function.md) |

A struct that contains itself is a `TypeError`; one that points to itself is
a `"pointer"` field, with `Type.at()` on what it reads.
