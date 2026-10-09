# Classes as types

A class whose instances are `ArrayBuffer`s can be used as a type in `args`,
`returns` and `{ type }` of a symbol spec. An instance is a real
`ArrayBuffer`, so `read`, `write`, `ptr()`, typed arrays and `DataView` take
it unchanged. This is an extension; bun:ffi has no equivalent. The class is
plain JS: [`gen-bindings`](gen-bindings.md) writes it (`--structs`, `--c++`,
`--class-types`) with the layout clang computed, qjs-ffi only learns that
such a constructor is a type.

*   [Usage](#usage)
*   [The class](#the-class)
*   [In a spec](#in-a-spec)
*   [Type checking](#type-checking)
*   [Callbacks](#callbacks)
*   [Errors](#errors)

## Usage

```js
import { dlopen, read, write, toArrayBuffer } from 'ffi';

class Point extends ArrayBuffer {
  static size = 16; // sizeof(Point), required
  constructor() { super(Point.size); }
  get x() { return read.f64(this, 0); }
  set x(v) { write.f64(this, 0, v); }
  get y() { return read.f64(this, 8); }
  set y(v) { write.f64(this, 8, v); }
}

const { symbols } = dlopen('libgeom.so', {
  Point_len: { args: [Point], returns: 'f64' },
  Point_new: { args: ['f64', 'f64'], returns: Point },
  origin: { type: Point }, // a global `Point origin;`
});

const p = symbols.Point_new(3, 4); // a Point over the pointer C returned
p.x; // 3
symbols.Point_len(p); // 5
p instanceof ArrayBuffer; // true
```

## The class

A constructor is a type when either holds (`ArrayBuffer` itself is neither):

*   its `prototype` inherits from `ArrayBuffer.prototype`; it needs a static
    `size`, a non-negative integer, read once when the spec is parsed (missing
    is a `TypeError`)
*   it has a static `size` and its instances are buffers made without that
    prototype, so `byteLength` or `slice` can be field names:

```js
class Raw {
  static size = 16;
  constructor() { return Reflect.construct(ArrayBuffer, [Raw.size], new.target); }
}
```

C++ single inheritance is JS `extends`: `class Dog extends Animal` takes the
base's place wherever `Animal` is declared (the base sits at offset 0).

## In a spec

| Where | Meaning |
| ----- | ------- |
| `args: [C]` | a pointer to the instance's bytes; see [Type checking](#type-checking) |
| `returns: C` | `null` for NULL, else a new non-owning `ArrayBuffer` of `C.size` bytes over the pointer, with `C.prototype`; the constructor does not run |
| `{ type: C }` | the variable's own memory as an instance; it cannot be assigned |
| `"pointer"`, `"T *"` | unchanged: untyped, they take any instance |

The memory of a returned or variable instance is C's: after `close()` or a
`free()` it dangles as any [pointer](pointers.md) does. Two instances over
the same address see each other's writes. A struct passed by value stays the
array form (`["f32", "f32"]`), see [Structs by value](types.md#structs-by-value).

## Naming a class: `types`

A spec can also say `"Point *"` and be given the classes by name, in an
object. It reads like the C declaration, and a table of specs stays plain data
(a JSON file the generator wrote, `--emit-specs`) while the classes are code:

```js
const { symbols } = dlopen('libgeom.so', {
  Point_len: { args: ['Point *'], returns: 'f64' },
  Point_new: { args: ['f64', 'f64'], returns: 'Point *' },
  origin: { type: 'Point' }, // a global `Point origin;`
}, { Point });               // the third argument: name -> class
```

| Given to | As |
| -------- | -- |
| `dlopen(path, symbols, types)` | the third argument |
| `linkSymbols(symbols, types)` | the second argument |
| `cc({ source, symbols, types })` | the option |
| `CFunction({ ptr, args, returns, types })`, `JSCallback(fn, { args, returns, types })`, one entry of a symbol table | the property `types`; it is looked up before the table's |

A name matches the class of that key after `const`, `volatile` and
`struct`/`union`/`class` are dropped: `"const struct Point *"` is `Point`. A
qualified name (`"geo::Shape *"`) matches its own key, else its last segment
(`Shape`). Exactly one `*` makes a pointer to the class, and means what the
constructor in the same place means ([In a spec](#in-a-spec)). `{ type: "Point" }`
without a star is a variable: the memory itself as an instance. A name that is
not a key, a pointer to a pointer (`"Point **"`) and `"Point *"` as the `type`
of a variable (a variable that holds a pointer) stay plain pointers.

## Type checking

```js
symbols.stat('.', new Glob()); // TypeError: argument 2 must be a Stat, not a Glob
```

| Argument | Accepted for a declared class `C` |
| -------- | --------------------------------- |
| an instance of `C` or of a subclass | yes |
| an instance of another class | `TypeError` naming both |
| a plain `ArrayBuffer` or a view | yes, if at least `C.size` bytes, else `RangeError` |
| `null`, `undefined` | NULL |
| a number or bigint | the address |

The check is `instanceof C`: there is no layout comparison, and a `struct` is
not a `union` of the same fields.

## Callbacks

The same types work in a [`JSCallback`](js-callback.md): an argument of class
`C` reaches the function as an instance over the pointer, and a return of
class `C` takes an instance (or `null`) and gives its address.

## Errors

| Thrown | When |
| ------ | ---- |
| `TypeError` | a class without a static `size`; an instance of an unrelated class; an object that is no buffer; a write to a class-typed variable |
| `RangeError` | a buffer shorter than `C.size` |
