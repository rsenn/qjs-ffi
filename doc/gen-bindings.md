# Generating bindings

`tools/gen-bindings.js` reads C headers with clang and writes a JavaScript module
with one CFunction per function, plus an export for every enum used:

```
$ qjsm tools/gen-bindings.js --library=libcairo.so.2 /usr/include/cairo/cairo.h -o lib/cairo.js
```

Useful options are `--follow-includes` to also bind the headers included by
the source, `--exclude=<name>` to skip a function, `-I` and `-D` for clang, and
`--api=define` to target the legacy API. Ready made bindings are in lib/.

With `--structs` the module also exports a class for every struct and union
(and each typedef name) and an accessor for every extern variable. The classes
extend `ArrayBuffer`, so an instance can be passed to a pointer parameter as it
is. Structs are mostly handled through their address:

```
	const m = new cairo.cairo_matrix_t();          // zero-filled, JS-owned memory
	cairo.cairo_matrix_init(m, 1, 0, 0, 1, 10, 20);
	console.log(m.x0, m.y0);                       // 10 20
	cairo.cairo_matrix_t.at(pointer)               // the same fields over native memory
	cairo.some_variable.value                      // extern variable (.ptr is its address)
```

A struct passed or returned by value (`vec3 f(vec3 a)`) is bound too: the struct
class is accepted as the argument, and a call returns an instance of it. This
needs `--api=cfunction` and an `ffi` module with struct support (see
[Types and ABI](types.md#structs-by-value)). A function stays skipped, with the reason in the output, when
the struct is a union, a C++ class, or its layout cannot be reproduced for libffi
(a packed struct, say).

The members are accessors that read with [`read`](pointers.md#read) and write
through a `DataView`; see the header of tools/gen-structs.js for how each kind
of member is read and written. A generated module needs an `ffi` that has `read`.
`Name.size`, `Name.align` and `Name.fields` (type and byte offset of each)
describe the layout. `tools/gen-structs.js` produces the same classes from an
IR (`--emit-ir`) on its own, and a C header with the layout checked by
`_Static_assert`s.

C++ classes are the same kind of class, extending a common `ArrayBuffer`
subclass: `new Shape(3, 2.0)` allocates the object and runs its constructor,
`s.delete()` runs the destructor (with `--finalize`, collecting an object that
was not deleted runs it too, on a later turn of the event loop), `Shape.at(ptr)` wraps an existing object, and
`s.ptr` is its address. Constants with a known value are plain exports,
whether or not `--structs` is given.

`tools/describe-module.sh <module.js> [export...]` lists what a generated module
or one from lib/ exports, with the C types when it was generated with
`--describe`; `--json` prints the raw results. It uses describeClass() and
describeObject(), kept in tools/describe/ as copies of qjs-modules' lib/.

The tools are in tools/ (gen-bindings.js, gen-structs.js, and the modules of
the former in tools/gen-bindings/). Installed, `qjs-ffi-genbindings` and
`qjs-ffi-genstructs` in bin/ start them from `share/qjs-ffi/tools`.

The generator runs in two phases joined by a JSON description of the C API
(functions, enums, structs, constants). `--emit-ir=api.json` stops after the
first phase and `--from-ir=api.json` generates the JavaScript without running
clang. The condensed clang AST is cached in `.tmp/gen-bindings/`, so a repeat
run takes a fraction of a second; `--no-cache` disables that.

```
	import * as cairo from "./lib/cairo.js";

	const surface = cairo.cairo_image_surface_create(cairo.CAIRO_FORMAT_ARGB32, 320, 240);
```

See examples/cairo.js and tests/test-cairo.js, which draws to PNG and SVG. The
plan for C++ virtual methods is in
[virtual dispatch](internals/cxx-virtual-dispatch.md).
