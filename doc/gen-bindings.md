# Generating bindings

`tools/gen-bindings.js` reads a C or C++ header with clang and writes a
JavaScript module that binds it: one [`CFunction`](c-function.md) per function,
a constant per enum value, and, on request, a class per struct, union and C++
class. The module is plain JavaScript that imports `ffi`; the generator is only
needed to make it.

This page follows a run of the generator from the command line to the output,
one section per processing step, with a small C and a small C++ library as the
running examples. The listings come from real runs of the tool (paths
shortened, long bodies elided with `...`), and the usage examples ran against
the built libraries.

*   [Synopsis](#synopsis)
*   [The examples](#the-examples)
*   [Pipeline](#pipeline)
    1. [Command line](#1-command-line)
    2. [Running clang](#2-running-clang)
    3. [Layout probes](#3-layout-probes)
    4. [Collecting the IR](#4-collecting-the-ir)
    5. [Merging sources](#5-merging-sources)
    6. [Structs by value](#6-structs-by-value)
    7. [Names](#7-names)
    8. [Emitting JavaScript](#8-emitting-javascript)
*   [Structs and variables (`--structs`)](#structs-and-variables---structs)
*   [C++ classes](#c-classes)
*   [Output options](#output-options)
*   [The IR on its own](#the-ir-on-its-own)
*   [Using the result](#using-the-result)
*   [Limitations](#limitations)

## Synopsis

```
qjs-ffi-genbindings [options] <source>...
qjs-ffi-genbindings [options] --from-ir=<ir.json>
```

`qjs-ffi-genbindings` is the installed name of `qjsm tools/gen-bindings.js`;
both take the same options. Run from a checkout:

```sh
qjsm tools/gen-bindings.js --library=libcairo.so.2 /usr/include/cairo/cairo.h -o lib/cairo.js
```

The generator needs `clang` and `qjsm` with the `json` module of qjs-modules.
The generated module needs only `ffi`, and one with `read` (see
[Pointers and memory](pointers.md#read)).

| Option | Meaning |
| ------ | ------- |
| `<source>...` | headers or sources to bind. Several are merged into one module. |
| `--library=<path>` | `dlopen()` this shared library; without it the symbols are looked up in the running process (`RTLD_DEFAULT`). |
| `-o`, `--output=<path>` | write the module here instead of to standard output. |
| `-I<dir>`, `-D<name[=value]>` | passed on to clang; repeatable. `--include=` and `--define=` are the long forms. |
| `--follow-includes` | also bind headers that a source includes from under its own directory (`SDL.h` brings in `SDL_video.h`). |
| `--exclude=<name>` | do not bind this function or class; repeatable. |
| `--c++` | parse the sources as C++. Implied by `.cc`, `.cpp`, `.cxx`, `.hh`, `.hpp`, `.hxx`; a `.h` needs it. |
| `--std=<std>` | the C++ standard for clang, e.g. `c++17`. |
| `--namespace=<name>` | drop the C++ namespace prefix `name::` from the names; repeatable. |
| `--structs` | also wrap every struct and union as an `ArrayBuffer` class, and every extern variable. |
| `--finalize` | destroy a C++ object made with `new` when it is garbage collected, too. |
| `--api=cfunction\|define` | which API to target: `CFunction` (default) or the [legacy](legacy.md) `define()`/`call()`. |
| `--ffitype` | write types as `FFIType.i32` instead of `'i32'`. |
| `--describe` | give each function its parameter names, and describe its C types for `describeObject()`. |
| `--jsdoc` | a JSDoc comment on each function, method and class. |
| `--emit-ir=<file>` | write the intermediate JSON and stop. |
| `--from-ir=<file>` | generate from an IR instead of running clang. |
| `--clang=<path>` | the clang binary (default `clang`). |
| `--cache-dir=<dir>` | where the condensed AST is cached (default `.tmp/gen-bindings`). |
| `--no-cache` | do not read or write that cache. |
| `-h`, `--help` | the usage text. |

Companions in `tools/`: `gen-structs.js` (`qjs-ffi-genstructs`) makes the struct
classes, or a C header, from an IR on its own, and `describe-module.sh` lists
what a generated module exports. Both are covered
[below](#the-ir-on-its-own).

## The examples

A small C library, `geom.h`:

```c
#define GEOM_VERSION 3

typedef enum { GEOM_OK = 0, GEOM_BAD_ARG = -1, GEOM_OVERFLOW = 2 } geom_status;

typedef struct vec2 {
  float x, y;
} vec2;

typedef struct shape {
  int id;
  const char *name;
  vec2 origin;
  unsigned visible : 1;
} shape;

typedef int (*geom_visit_fn)(const shape *s, void *user);

extern int geom_count;

int geom_abs(int v);
double geom_length(vec2 v);
vec2 geom_add(vec2 a, vec2 b);
const char *geom_version(void);
geom_status geom_move(shape *s, double dx, double dy);
shape *geom_find(const char *name);
void geom_each(geom_visit_fn fn, void *user);
int geom_log(const char *fmt, ...);
```

and a C++ one, `shapes.hpp`:

```cpp
namespace geo {

class Shape {
public:
  Shape(double scale = 1.0);
  virtual ~Shape();
  virtual double area() const = 0;
  double scale() const;
  void setScale(double s);
  static int count();
  int id;
private:
  double s_;
};

class Circle : public Shape {
public:
  Circle(double radius);
  double area() const override;
  double radius;
};

double lerp(double a, double b, double t);

}
```

Both are built into shared libraries (`libgeom.so`, `libshapes.so`) and bound
with

```sh
qjs-ffi-genbindings --library=./libgeom.so --structs -o geom.js geom.h
qjs-ffi-genbindings --c++ --std=c++17 --namespace=geo --library=./libshapes.so -o shapes.js shapes.hpp
```

## Pipeline

```
 source ──► 1 command line ──► 2 clang AST ──► 3 layout probes
                                                    │
 JavaScript ◄── 8 emit ◄── 7 names ◄── 6 by value ◄─┤
                                         ▲          ▼
                                         └──── 4 collect ──► 5 merge ──► IR (JSON)
```

Steps 2 to 6 turn the sources into the *IR*, a JSON description of the C API;
steps 7 and 8 turn the IR into JavaScript without looking at clang or the
sources again. `--emit-ir` stops after step 6 and `--from-ir` starts at step 7,
see [The IR on its own](#the-ir-on-its-own).

### 1. Command line

`args.js` reads the options. It refuses an unknown option, `--api` other than
`cfunction` or `define`, `--ffitype` with `--api=define`, `--from-ir` together
with sources or with `--emit-ir`, and no source at all. `main.js` also refuses
`--finalize` with `--api=define`. A problem prints the message and the usage
text and exits with status 1. The generated file's header records the options
it was made with, so that it can say how to regenerate it:

```js
/* Auto-generated by qjs-ffi-genbindings from geom.h -- do not edit by hand.
 * Regenerate with:
 *   qjs-ffi-genbindings --api=cfunction --library=./libgeom.so --structs  geom.h
 * (clang invocation used to build the AST, once per source: clang -Xclang -ast-dump=json -fsyntax-only <source>)
 */
```

### 2. Running clang

For each source, `clang.js` runs

```sh
clang -Xclang -ast-dump=json -fsyntax-only [-x c++ -std=<std>] -I<dir>... -D<def>... <source>
```

and reads clang's JSON AST from the pipe. That AST is huge (megabytes for
`cairo.h`), almost all of it source ranges, function bodies and attributes the
generator never uses. So it is not parsed as one value: `json.JsonParser`
yields tokens and `condense.js` keeps only what is needed, deciding from a
node's `kind`, as soon as it arrives, which children survive:

*   at the top level: functions, variables, enums, records, typedefs, C++
    classes and namespaces (`std` and `__*` namespaces are dropped);
*   below a function: its parameters, nothing else;
*   below an enum: its constants; below a record: its fields, nested records and
    enums, alignment and packing attributes; below a class also its methods,
    constructors, destructor and access specifiers;
*   constant expressions are kept as `kind`/`value`/`opcode`/`inner` only.

The condensed AST is cached in `.tmp/gen-bindings/<name>.<hash>.ast.json`
(`--cache-dir`), the hash covering the clang command line, the source path and
the cache format. A later run reuses it as long as no file it was built from is
newer, which makes a repeat run take a fraction of a second. `--no-cache` turns
the cache off.

An unreadable source, or a parse that fails, ends the run with clang's own
diagnostics:

```
gen-bindings.js: failed to parse clang AST JSON output: unexpected end of clang AST JSON; stderr was:
clang: error: no such file or directory: 'nothere.h'
```

### 3. Layout probes

clang's AST has no sizes and no field offsets, and a binding needs both: to
read a struct member, to pass a struct by value, to find a virtual method in a
vtable. They only come from a record layout dump, and clang prints one only for
a record that code needs. So `runLayoutDump()` writes a *probe*, a translation
unit that includes the source and asks for the numbers, and compiles it with
`-Xclang -fdump-record-layouts-simple`:

```c
#include "/path/to/geom.h"
enum { __probe0 = sizeof(struct vec2) };
enum { __probe1 = sizeof(struct shape) };
struct __gb_f0 { char b[sizeof(((struct vec2 *)0)->x)]; };
enum { __gb_fu0 = sizeof(struct __gb_f0) };
...
```

The dump gives each record's size, alignment and the bit offset of each field.
A field's own size is read from the dump of a tiny struct holding
`char[sizeof(field)]`, and a typedef's from the same trick. For a polymorphic
C++ class the probe also calls the destructor and takes the address of a
virtual method, and the compile is then run with `-fdump-vtable-layouts -S
-emit-llvm`, which prints

```
VTable indices for 'geo::Shape' (3 entries).
   0 | geo::Shape::~Shape() [complete]
   1 | geo::Shape::~Shape() [deleting]
   2 | double geo::Shape::area() const
```

`vtable.js` parses these lines into slot numbers. They are stored with the
condensed AST, so the cache covers the probes too. A field with no size (a
bitfield, a flexible array, an incomplete type) simply has none.

### 4. Collecting the IR

`collectIR()` walks the declarations in the files it is to bind (the source, or
with `--follow-includes` anything under its directory), keeping track of
clang's "current file", and fills the IR. `static` functions are left out, and
`static` variables unless they are constants with a known value. `--emit-ir`
shows it:

```sh
qjs-ffi-genbindings --emit-ir=geom.ir.json geom.h
```

A function becomes an entry of `methods`, its C types mapped to `ffi` type
names:

```json
{ "name": "geom_abs", "kind": "function", "arity": 1,
  "params": ["v: i32"], "returnType": "i32",
  "defTypes": { "returnType": "sint32", "params": ["sint32"] }, "enums": [] }
{ "name": "geom_move", "kind": "function", "arity": 3,
  "params": ["s: shape *", "dx: f64", "dy: f64"], "returnType": "i32", "enums": ["0:0x5e1031dee5d0"], ... }
{ "name": "geom_find", "kind": "function", "arity": 1,
  "params": ["name: cstring"], "returnType": "shape *", ... }
```

`types.js` does the mapping, one C type at a time (`typedef`s are resolved
first, `const` and `volatile` dropped):

| C type | `ffi` type |
| ------ | ---------- |
| `int`, `unsigned`, `long`, `size_t`, `float`, `double`, `_Bool`, ... | `i32`, `u32`, `i64`, `u64`, `f32`, `f64`, `bool` |
| `char *` | `cstring` |
| `T *`, `T **`, `void *` | `"T *"`, `"T **"`, `"void *"`: a pointer, the text before `*` is documentation |
| `T &`, `T &&` (C++) | `"T *"` |
| function pointer | `function` |
| `enum E`, a typedef of an enum | `i32`, remembering which enum, see below |
| `struct S` by value | `struct S`, settled in [step 6](#6-structs-by-value) |
| array parameter `int a[4]` | `"int *"` |
| `union` by value, an unknown name | skipped |

Everything else the IR holds:

*   **`enums`**: every enum with its constants and their values. Only an enum
    that a bound function's signature uses is emitted later, in order of first
    use.
*   **`fields`**: variables, and constants with a known value:
    `{ "name": "geom_count", "type": "i32", "cType": "int" }`. A `const` variable
    with a literal initializer carries its `value` and becomes an `export const`.
    Preprocessor macros such as `GEOM_VERSION` are not in the AST and are not
    bound.
*   **`structs`** and **`classes`**: each struct, union and class with its size,
    alignment, and its fields, and each field with its type, byte `offset`, byte
    `size` and `ffi` type. A bitfield also has `bits` and `bitOffset` and the
    offset and size of its storage unit. The numbers come from the
    [probes](#3-layout-probes), or else from the type alone.

    ```json
    { "name": "shape", "type": "struct", "size": 32, "align": 8, "line": 12,
      "fields": [
        { "name": "id", "type": "int", "offset": 0, "size": 4, "ffi": "i32" },
        { "name": "name", "type": "const char *", "offset": 8, "size": 8, "ffi": "cstring" },
        { "name": "origin", "type": "vec2", "offset": 16, "size": 8, "ffi": "vec2" },
        { "name": "visible", "type": "unsigned int", "offset": 24, "size": 4, "bits": 1, "bitOffset": 0, "ffi": "u32" } ],
      "typedefs": ["shape"] }
    ```

*   **`typedefs`**: every `typedef` and `using` alias, with the type it stands
    for and the record it names.
*   **`skipped`**: what could not be bound and why. Variadic functions and
    operators are skipped here, an unknown type or a union by value by the
    mapping:

    ```json
    [{ "name": "geom_log", "reason": "variadic functions are not supported" }]
    ```

A C++ class is the same, plus its bases, its public constructors, methods and
destructor with their `mangledName` (what to `dlsym()`), and for each virtual
method and the destructor its `vtableSlot`:

```json
{ "name": "geo::Shape", "type": "class", "size": 24, "align": 8, "abstract": true, "polymorphic": true,
  "bases": [], "constructors": [],
  "fields": [{ "name": "id", "type": "int", "offset": 8, "size": 4, "ffi": "i32" }],
  "methods": [
    { "name": "area", "mangledName": "_ZNK3geo5Shape4areaEv", "virtual": true, "pure": true, "const": true,
      "arity": 0, "params": [], "returnType": "f64", "vtableSlot": 2 },
    { "name": "setScale", "mangledName": "_ZN3geo5Shape8setScaleEd", "arity": 1, "params": ["s: f64"], "returnType": "void" },
    { "name": "count", "mangledName": "_ZN3geo5Shape5countEv", "static": true, "arity": 0, "returnType": "i32", ... } ],
  "destructor": { "mangledName": "_ZN3geo5ShapeD1Ev", "virtual": true, "vtableSlot": 0 } }
```

Overloads are separate entries. A constructor carries the mangled name of the
complete-object constructor (`C1`); an abstract class has none, because the
compiler emits only the base-object one. Only public members are collected, and
a struct with no methods and no bases stays a plain `structs` entry even in C++.

### 5. Merging sources

With several sources, each one's IR is merged into one. The first declaration
of a name wins, so a function or enum in two headers is bound once, and a
variable declared without a value is upgraded by a later declaration with one.
Then `linkPrototypeChains()` fills each class's `prototypeChain`, one entry per
ancestor following the first base, as `describeObject()` does for a JavaScript
object.

A source with nothing to bind prints `warning: no bindable functions found in
<source>` and the run continues.

### 6. Structs by value

A function that takes or returns a struct by value (`vec2 geom_add(vec2, vec2)`)
is bound through a struct type that `CFunction` takes as an array of member
types ([Types and ABI](types.md#structs-by-value)). libffi works out the size,
the alignment and the registers from that list alone, so a list that does not
reproduce the compiler's layout is silently wrong. `by-value.js` therefore lays
the list out the way libffi does and compares it with the IR: every member must
land on the offset the IR has, and the size must match. If it does, the list
goes into `ir.byValue`:

```json
"byValue": { "vec2": ["f32", "f32"] }
```

and the function's types become `struct vec2`. If not, the function is skipped
with the reason it would have had without by-value support:

```c
struct __attribute__((packed)) pk { char c; int i; };
union u { int a; float b; };
int takes_packed(struct pk p);
int takes_union(union u v);
int takes_array(int a[4]);
```

```js
export const takes_array = CFunction({ptr:__sym('takes_array'),args:['int *'],returns:'i32'});

// Skipped (unsupported):
//   - takes_union: parameter v (union u): union passed by value is not supported
//   - takes_packed: parameter p: struct pk passed by value: libffi would put i at 4, not 1
```

Members the IR cannot describe (an anonymous struct or union) are covered by
integers of the right size. That is sound only for a struct of more than 16
bytes, which is passed in memory whatever it holds; a smaller one, whose members
decide which registers it travels in, is skipped. Unions and C++ classes by
value are never bound, and with `--api=define` every struct by value is
skipped.

### 7. Names

C++ names are qualified (`geo::Shape`) and become identifiers by replacing `::`
with `_` (`geo_Shape`). `--namespace=geo` drops that prefix instead
(`Shape`); with several `--namespace` options all are dropped, so with `a` and
`b`, `a::b::Foo` is `Foo`. Dropping what told two names apart can make them
collide, so `names.js` checks every name the module would export, and refuses to
write anything if two things would share one:

```
$ qjs-ffi-genbindings --c++ --namespace=a --namespace=b ns.hpp
gen-bindings.js: after dropping a::, b::, "size" would be exported by: function a::size; function b::size
gen-bindings.js: name collision, nothing written; drop fewer --namespace values
```

Only a clash that the stripping caused is reported. A function whose name is a JavaScript
reserved word is exported with an underscore in front (`delete` as `_delete`),
with a comment beside the export.

### 8. Emitting JavaScript

`emit/functions.js` writes the module, in this order: the header comment, the
`import` of what the module needs from `ffi`, the library, `__sym()`, the
enums, the support code (only if there are structs, classes or variables), the
struct types for by-value functions, the functions, and the list of skipped
declarations.

The `import` adds names as they are needed: `CFunction`, `dlsym`, `FFIType` with
`--ffitype`, `read as __rd`, `ptr as __ptr` and the others for struct and class
wrappers. With `--library` the module opens that library and resolves symbols in
it, without it in the process:

```js
import { CFunction, dlsym, dlopen, RTLD_NOW } from 'ffi';

const __lib = dlopen("libgeom.so", RTLD_NOW);
if (__lib == null) throw new Error("gen-bindings: dlopen(libgeom.so) failed");

function __sym(name) {
  const p = dlsym(__lib, name);
  if(p == null) throw new Error("gen-bindings: symbol not found: " + name);
  return p;
}
```

An enum constant used by a function signature is exported, with the
enum's name (or `(anonymous)`) as a comment:

```js
// enum (anonymous)
export const GEOM_OK = 0;
export const GEOM_BAD_ARG = -1;
export const GEOM_OVERFLOW = 2;
```

A function is a `CFunction`. The result for `geom.h` (without `--structs`):

```js
const __s_vec2 = ['f32','f32'];

export const geom_abs = CFunction({ptr:__sym('geom_abs'),args:['i32'],returns:'i32'});
export const geom_length = CFunction({ptr:__sym('geom_length'),args:[__s_vec2],returns:'f64'});
export const geom_add = CFunction({ptr:__sym('geom_add'),args:[__s_vec2,__s_vec2],returns:__s_vec2});
export const geom_version = CFunction({ptr:__sym('geom_version'),args:[],returns:'cstring'});
export const geom_move = CFunction({ptr:__sym('geom_move'),args:['shape *','f64','f64'],returns:'i32'});
export const geom_find = CFunction({ptr:__sym('geom_find'),args:['cstring'],returns:'shape *'});
export const geom_each = CFunction({ptr:__sym('geom_each'),args:['function','void *'],returns:'void'});

// Skipped (unsupported):
//   - geom_log: variadic functions are not supported
```

| C | JavaScript |
| - | ---------- |
| `int geom_abs(int)` | `geom_abs(-5)` is `5` |
| `const char *geom_version()` | a string: `'geom 3'` |
| `shape *geom_find(const char *)` | a pointer: `null`, a `number` or a `bigint` |
| `geom_status geom_move(shape *, double, double)` | pass a pointer, or a struct class; returns the status as a number |
| `void geom_each(geom_visit_fn, void *)` | pass a [`JSCallback`](js-callback.md)'s `.ptr` |
| `double geom_length(vec2)` | pass an `ArrayBuffer` of at least 8 bytes, or a `vec2` instance |
| `vec2 geom_add(vec2, vec2)` | returns an `ArrayBuffer` of 8 bytes (a `vec2` with `--structs`) |

The wrappers are used like any `CFunction`:

```js
import * as geom from './geom.js';
import { JSCallback } from 'ffi';

console.log(geom.geom_abs(-5)); // 5
console.log(geom.geom_version()); // geom 3

const seen = [];
const cb = new JSCallback((p, user) => { seen.push(geom.shape.at(p).id); return 0; }, { args: ['pointer', 'pointer'], returns: 'i32' });
geom.geom_each(cb.ptr, null);
console.log(seen.join()); // 1,2
cb.close();
```

## Structs and variables (`--structs`)

With `--structs` every struct and union of the sources gets a class, each
typedef name of it an alias, and every extern variable an accessor. The classes
extend `ArrayBuffer`, so an instance can be passed to a `pointer` parameter as it
is. For `vec2` and `shape` the generator writes

```js
/* struct vec2, 8 bytes (line 8) */
export class vec2 extends ArrayBuffer {
  constructor(init = 8) { super(typeof init === 'number' ? init : init.byteLength); if(typeof init !== 'number') new Uint8Array(this).set(__bytes(init)); }
  static at(p, owner, size = 8) { return __view(vec2, p, size, owner); }
  get ptr() { return __ptr(this); }
  get x() { return __rd.f32(this, 0); }
  set x(v) { __dv(this).setFloat32(0, v, true); }
  get y() { return __rd.f32(this, 4); }
  set y(v) { __dv(this).setFloat32(4, v, true); }
}
vec2.size = 8;
vec2.align = 4;
vec2.fields = {x:{type:'f32',offset:0},y:{type:'f32',offset:4}};

/* struct shape, 32 bytes (line 12) */
export class shape extends ArrayBuffer {
  constructor(init = 32) { ... }
  static at(p, owner, size = 32) { return __view(shape, p, size, owner); }
  get ptr() { return __ptr(this); }
  get id() { return __rd.i32(this, 0); }
  set id(v) { __dv(this).setInt32(0, v, true); }
  get name() { return __ptrOut(__rd.u64(this, 8)); }
  set name(v) { __dv(this).setBigUint64(8, __ptrIn(v), true); }
  get origin() { return vec2.at(__ptr(this, 16), this); }
  set origin(v) { new Uint8Array(this, 16, 8).set(__bytes(v)); }
  get visible() { return (__rd.u32(this, 24) >>> 0) & 0x1; }
  set visible(v) { __dv(this).setUint32(24, ((__rd.u32(this, 24) & ~0x1) | ((v << 0) & 0x1)) >>> 0, true); }
}
shape.size = 32;
shape.align = 8;
shape.fields = {id:{type:'i32',offset:0},name:{type:'cstring',offset:8},origin:{type:'vec2',offset:16},visible:{type:'u32',bits:1,bitOffset:192}};
```

*   A member is an accessor at the byte offset of the IR: it reads with
    [`read`](pointers.md#read) and writes through a `DataView`. 64-bit integers
    are `bigint`.
*   `new shape()` allocates zeroed memory of the struct's size; `new
    shape(bytes)` copies an `ArrayBuffer` or view. `shape.at(ptr)` makes a view
    of native memory (not copied, not owned), and `s.ptr` is the address.
*   A pointer member gives `null`, a `number` or a `bigint` and takes those, a
    class instance or a buffer. A pointer to a struct of a known class gives a
    live instance of that class (`null` for NULL). `const char *` is a plain
    pointer here: decode it with `new CString(s.name)`.
*   A bitfield is read and written through its storage unit, `bitOffset` bits up.
*   A nested struct is a view of the same memory (`s.origin` above), an array
    member a typed-array view, an array of pointers a `Proxy` over a
    `BigUint64Array`, and anything else a `Uint8Array` over its bytes.
*   `Name.size`, `Name.align` and `Name.fields` describe the layout.
*   A member with an unknown offset is left out. Members that would hide
    something an `ArrayBuffer` has (`byteLength`, `slice`, ...) get an
    underscore.

A function that returns a struct by value then returns an instance of its class
(`__ret(vec2, CFunction(...))`), and a class can be passed for such an
argument. An extern variable is wrapped in an accessor with the address and,
for a scalar or pointer, the value:

```js
export const geom_count = __variable('geom_count','i32');
```

Used on top of the library of the example:

```js
const a = new geom.vec2();
a.x = 3; a.y = 4;
console.log(geom.geom_length(a)); // 5
const sum = geom.geom_add(a, a);
console.log(sum instanceof geom.vec2, sum.x, sum.y); // true 6 8

const s = geom.shape.at(geom.geom_find('circle'));
console.log(s.id, new CString(s.name).toString(), s.origin.x, s.visible); // 1 circle 0 1
console.log(geom.geom_move(s, 2, 3), s.origin.x, s.origin.y); // 0 2 3
console.log(geom.geom_count.value); // 2  (geom_count.ptr is its address)
console.log(geom.GEOM_BAD_ARG, geom.shape.size); // -1 32
```

## C++ classes

A C++ source (`--c++`, or a `.cpp`/`.hpp` name) also gets classes, with or
without `--structs`. For `shapes.hpp` the generator writes, after the shared
support code, a lazily bound overload list per method and the class:

```js
const __Shape_m_area = [
  {n:0,t:[],f:__lazy(()=>__virtual(2,{args:['geo::Shape *'],returns:'f64'}))},
];
const __Shape_m_scale = [
  {n:0,t:[],f:__lazy(()=>CFunction({ptr:__sym('_ZNK3geo5Shape5scaleEv'),args:['geo::Shape *'],returns:'f64'}))},
];
const __Shape_m_setScale = [
  {n:1,t:['f64'],f:__lazy(()=>CFunction({ptr:__sym('_ZN3geo5Shape8setScaleEd'),args:['geo::Shape *','f64'],returns:'void'}))},
];
const __Shape_s_count = [
  {n:0,t:[],f:__lazy(()=>CFunction({ptr:__sym('_ZN3geo5Shape5countEv'),args:[],returns:'i32'}))},
];

/* class geo::Shape, 24 bytes (line 5) */
export class Shape extends __CxxObject {
  get id() { return __rd.i32(this, 8); }
  set id(v) { __dv(this).setInt32(8, v, true); }
  area(...args) { return __invoke(__Shape_m_area, this, args); }
  scale(...args) { return __invoke(__Shape_m_scale, this, args); }
  setScale(...args) { return __invoke(__Shape_m_setScale, this, args); }
  static count(...args) { return __invoke(__Shape_s_count, undefined, args); }
}
Shape.__info = { size: 24, ctors: null, dtor: __lazy(()=>__virtual(0,{args:['geo::Shape *'],returns:'void'})) };

const __Circle_ctor = [
  {n:1,t:['f64'],f:__lazy(()=>CFunction({ptr:__sym('_ZN3geo6CircleC1Ed'),args:['geo::Circle *','f64'],returns:'void'}))},
];
const __Circle_m_area = [
  {n:0,t:[],f:__lazy(()=>__virtual(2,{args:['geo::Circle *'],returns:'f64'}))},
];

/* class geo::Circle, 32 bytes (line 18) */
export class Circle extends Shape {
  get radius() { return __rd.f64(this, 24); }
  set radius(v) { __dv(this).setFloat64(24, v, true); }
  area(...args) { return __invoke(__Circle_m_area, this, args); }
}
Circle.__info = { size: 32, ctors: __Circle_ctor, dtor: __lazy(()=>__virtual(0,{args:['geo::Circle *'],returns:'void'})) };

// C++ functions
const __fn_lerp = [
  {n:3,t:['f64','f64','f64'],f:__lazy(()=>CFunction({ptr:__sym('_ZN3geo4lerpEddd'),args:['f64','f64','f64'],returns:'f64'}))},
];
export const lerp = (...args) => __invoke(__fn_lerp, undefined, args);
```

*   **Objects**: a class extends its first base class when that is bound, public,
    non-virtual and sits at offset 0 (a polymorphic class has its vptr there, a
    non-polymorphic base does not), else the common root `__CxxObject`, itself an
    `ArrayBuffer`. `new
    Circle(2)` allocates `size` bytes and runs the complete constructor (`C1`);
    `c.delete()` runs the destructor, after which any call on the object throws.
    `Shape.at(ptr)` (also `Shape.from(ptr)`) wraps an existing object without
    owning it, and `c.ptr` is its address. A class that is abstract or has no
    constructor symbol cannot be constructed: `TypeError: Shape cannot be
    constructed`.
*   **Calls**: a method takes the object as its first argument (`this`), a
    static method and a free function none. Everything is bound on first call,
    since an inline member often has no exported symbol. Overloads are told
    apart by the number of arguments and then by their types.
*   **Names**: the symbol is the mangled name the IR carries. A class keeps its
    qualified name (`geo_Shape`), or `Shape` with `--namespace=geo`.
*   **Virtual methods** are not called through their symbol but through the
    object's vtable, `__virtual(slot, spec)`: the slot is the number from the
    [layout probe](#3-layout-probes), read from the vtable that the object's
    first word points to. So an object wrapped as the base class runs the
    override of its real class, a pure virtual method is callable, and
    `delete()` through a base runs the derived destructor.
*   **Fields** are accessors, like those of a struct; static fields are class
    properties.

```js
import { Circle, Shape, lerp } from './shapes.js';

const c = new Circle(2);
console.log(c.radius, c.id, c.scale()); // 2 1 1
c.setScale(1.5);
console.log(c.area()); // 18   (Circle::area: 3 * 2 * 2 * 1.5)
console.log(Shape.count(), lerp(0, 10, 0.25)); // 1 2.5

const base = Shape.at(c.ptr); // the same object, wrapped as the base class
console.log(base.area()); // 18   still Circle::area, through the vtable
c.radius = 3;
console.log(base.area()); // 40.5

try { new Shape(); } catch(e) { console.log(e.message); } // Shape cannot be constructed
c.delete();
try { c.area(); } catch(e) { console.log(e.message); } // object was deleted
```

`--finalize` also destroys an object made with `new` when it is garbage
collected. The object then lives in memory from `calloc`, which the wrapper
only views, and a `FinalizationRegistry` runs the destructor (through the
vtable for a virtual one) and `free`s it. `delete()` still destroys at once. The
callback runs on a later turn of the event loop, not inside the collection, and
an object still alive at exit is not destroyed.

Not covered: multiple and virtual inheritance (the `this` adjustment needs base
offsets), default arguments, templates other than explicit instantiations,
exceptions across the boundary, operators, and by-value class parameters and
returns. See [TODO.md](../TODO.md) and the
[design note on virtual dispatch](internals/cxx-virtual-dispatch.md).

## Output options

`--ffitype` writes the types as members of `FFIType`:

```js
export const geom_abs = CFunction({ptr:__sym('geom_abs'),args:[FFIType.i32],returns:FFIType.i32});
```

`--describe` gives every function, method and constructor its parameter names
in its signature and attaches its C types and overloads as
`fn[Symbol.for('describe')]`, which `describeObject()` and `describeClass()`
(qjs-modules) report. A plain function becomes a named wrapper:

```js
const __f_geom_abs = CFunction({ptr:__sym('geom_abs'),args:['i32'],returns:'i32'});
export function geom_abs(v) { return __f_geom_abs(v); }
__sig(geom_abs, [{params:['v: i32'],returnType:'i32',arity:1}]);
```

`--jsdoc` puts a JSDoc block before every function, method and class: a
`@param` per parameter with its JavaScript type and C type, a `@returns`, and an
`@overload` group per overload. A pointer is `object|number|bigint|null`, plus
the class when it points to a bound one.

```js
/**
 * geom_move
 * @param {object|number|bigint|null} s - shape *
 * @param {number} dx - f64
 * @param {number} dy - f64
 * @returns {number} - i32
 */
export const geom_move = CFunction({ptr:__sym('geom_move'),args:['shape *','f64','f64'],returns:'i32'});
```

`--api=define` targets the [legacy API](legacy.md): every function is a
`define()` once and a closure around `call()`. It has no struct types, so a
function with a struct by value is skipped:

```js
export const geom_abs = __bind('geom_abs','sint32','sint32');
export const geom_find = __bind('geom_find','shape *','char *');

// Skipped (unsupported):
//   - geom_log: variadic functions are not supported
//   - geom_length: parameter v: struct passed by value needs --api=cfunction
//   - geom_add: return type: struct passed by value needs --api=cfunction
```

## The IR on its own

The two halves of the generator are separate runs. The IR is JSON, shaped like
the output of `describeObject()` (qjs-modules): `methods` and `fields` for the
functions and variables, `enums`, `structs`, `classes`, `typedefs`, `skipped`,
`byValue`, and `source`, which records how it was made (files, includes,
defines, language) for the header of the output.

```sh
qjs-ffi-genbindings --emit-ir=api.json geom.h          # clang -> IR
qjs-ffi-genbindings --from-ir=api.json -o geom.js      # IR -> JavaScript, no clang
```

`--from-ir` takes no sources and takes the options of the emitting phase
(`--api`, `--structs`, `--describe`, `--namespace`, ...) as before. The IR can
be edited or checked in between, and a binding can be regenerated on a machine
without clang.

`gen-structs.js` makes just the struct, union and class wrappers from an IR:

```sh
qjs-ffi-genstructs [--struct=<name>]... [--describe] [--jsdoc] [--format=js|c] [-o out] api.json...
```

`--format=js` is the same class code `--structs` emits. `--format=c` writes a C
header that defines the structs (fields only) and checks the layout the IR
claims with `_Static_assert`s, so that a layout that does not match the real
compiler fails to compile:

```c
struct vec2 {
  float x;
  float y;
};

struct shape {
  int id;
  const char *name;
  vec2 origin;
  unsigned int visible : 1;
};

_Static_assert(sizeof(struct vec2) == 8, "vec2 size");
_Static_assert(offsetof(struct vec2, x) == 0, "vec2.x offset");
_Static_assert(offsetof(struct vec2, y) == 4, "vec2.y offset");
_Static_assert(sizeof(struct shape) == 32, "shape size");
_Static_assert(offsetof(struct shape, id) == 0, "shape.id offset");
...
```

`describe-module.sh [--json] <module.js> [export...]` lists what a generated
module or one from `lib/` exports, with the C types when it was generated with
`--describe`. Importing the module loads its libraries, so
`QUICKJS_MODULE_PATH` must find the `ffi` module.

## Using the result

*   Run the module with `qjsm`, with `ffi` on `QUICKJS_MODULE_PATH`, and import
    it: `import * as cairo from './lib/cairo.js'`.
*   Ready-made bindings are in `lib/` (cairo, SDL2, freetype, libcurl, libusb,
    libarchive, zlib); `examples/` and `tests/test-cairo.js` use them. They are
    output of an earlier version of the generator, so regenerate them with a
    current `ffi` module before depending on newer features.
*   Installed, the tools live in `share/qjs-ffi/tools` and `bin/` has
    `qjs-ffi-genbindings` and `qjs-ffi-genstructs` wrappers: `qjsm` resolves a
    script's imports against the path it is run as, not a symlink's target.
*   A generated module imports `read`, so it needs an `ffi` with
    [`read`](pointers.md#read) and the pointer form of
    [`toArrayBuffer`](pointers.md#toarraybuffer).

## Limitations

*   Variadic functions, operators and arrays by value are skipped, as are unions
    and (for C++) classes by value.
*   A struct by value needs a layout libffi can reproduce: not a packed struct.
*   Preprocessor macros are not bound (they are not in the AST), only enums and
    `const` variables with a literal value.
*   Little-endian, 64-bit Linux layout rules only.
*   `--finalize` needs `--api=cfunction`. With `--api=define` a virtual method is
    called through its own symbol, not the vtable, and structs by value are
    skipped.
*   The tests: `tests/test-gen-bindings-cxx.js` checks every IR `mangledName`
    against `nm -D` of a compiled fixture and runs the module,
    `test-gen-bindings-virtual.js` and `-finalize.js` the vtable and finalizer
    paths, `test-gen-structs.js` and `test-struct-by-value.js` the structs.
