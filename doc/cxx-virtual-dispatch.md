# Plan: virtual method dispatch through the vtable

Status: **plan, nothing implemented.** Scope: the C++ classes that
`tools/gen-bindings.js` emits (see `classesCode()` and
[TODO.md](../TODO.md), "C++ gaps" item 1).

## 1. Problem

A generated method binds the **declaring class's own symbol**, so every call
is a non-virtual (`Class::method()`-qualified) call:

```js
const s = new geo_Shape(3, 2.0);
geo_Base.from(s.ptr).area();   // calls Base::area, not Shape::area
```

C++ would call `Shape::area` here. Any wrapper whose static type is a base
class (`from()` on a pointer returned by a factory, or an inherited method)
runs the wrong code, and `.delete()` through a base wrapper runs the wrong
destructor.

Two more consequences of binding symbols:

- a **pure virtual** method has no symbol, so it is not bound at all today;
- a virtual method that is inline or never instantiated has no exported
  symbol, so the call fails with "symbol not found".

Dispatching through the vtable fixes all three.

## 2. ABI facts (Itanium, x86-64 Linux)

Checked against `tests/cxx/shapes.{hpp,cpp}` compiled with `clang++ -std=c++17` (a small C++ program that `dlsym`s the symbols and reads the
vptr), not recalled from the spec:

| Fact | Evidence |
| --- | --- |
| The vptr is the first 8 bytes of a polymorphic object (offset 0) | `*(void***)&shape` is the vptr |
| `vptr == &_ZTV<class> + 16` (skips offset-to-top and RTTI) | printed `vptr - _ZTV = 16` |
| `vptr[n]` is the n-th virtual slot; the declaration-order rule puts a destructor in **two** consecutive slots, `[complete]` then `[deleting]` | `Shape`: `vptr[0]` = `D1`, `vptr[1]` = `D0`, `vptr[2]` = `area` |
| A slot holds the **final overrider's** function | `vptr[2]` of a `Shape` is `Shape::area`, and calling it on the object returned `6` |
| A pure virtual's slot holds `__cxa_pure_virtual` | `Base`'s `vptr[2]` equals `dlsym("__cxa_pure_virtual")` |
| A subclass's slots start with the base's, so a base-class index is valid for every subclass | `PC : C : B : A`: `f`, `g(int)`, `g(double)` keep their indices |

clang's JSON AST does **not** reliably say which methods are virtual: the
overrider `Shape::area` carries only an `OverrideAttr` child and no
`"virtual": true` key (that is why the IR currently has no `virtual` on it).
An override written without `virtual`/`override` has no marker at all (not
checked: the probe below makes it moot).

## 3. Where the slot index comes from

Two options; **recommended: the clang probe.**

| | A. Compute from the AST | B. Ask clang (probe) |
| --- | --- | --- |
| Source of truth | our reimplementation of the Itanium layout rules | clang's own `-fdump-vtable-layouts` |
| Needs override matching (name + params + const + covariant returns) | yes | no, clang already resolved it |
| Handles overrides without `virtual`/`override` | only via that matching | yes |
| Extra clang run | no | yes, only when a polymorphic class exists |
| Breaks on | typedef/qualified-type spelling mismatches | `final` classes (cannot be derived from) |

### 3.1 The probe

For every complete class with `definitionData.isPolymorphic` (already kept by
`AstCondenser`), append to a probe translation unit:

```cpp
#include "/abs/path/to/source.hpp"
struct __gb_probe0 : ns::Class { virtual void __gb_key(); };
void __gb_probe0::__gb_key() {}
```

and compile it with `clang++ -Xclang -fdump-vtable-layouts -c -o /dev/null`
(same `-I`/`-D`/`-x c++`/`-std=` as the AST run, see `langArgs()`).

- The out-of-line `__gb_key` is the **key function**, so clang emits the
  vtable and dumps it. Verified for a concrete class, an abstract class and an
  abstract class with a non-virtual protected destructor. A `delete p` probe
  was tried first and is **not** enough: with a non-virtual destructor no
  vtable is needed and nothing is dumped. `sizeof` alone dumps nothing either.
- The dump goes to **stdout**, like `-fdump-record-layouts-simple`, so
  `runLayoutDump()`'s `popen` handling carries over.
- The "Vtable for '__gb_probe0'" block lists every slot, including inherited
  ones, as `<row> | <return type> <Qualifier::name>(<params>)[ const]`. The
  index is **row − 2** (rows 0 and 1 are offset-to-top and RTTI):

  ```
  2 | void C::f()          -> vptr[0]
  3 | int A::g(int)        -> vptr[1]
  4 | void B::g(double)    -> vptr[2]
  5 | PC::~PC() [complete] -> vptr[3]
  7 | void B::h()          -> vptr[5]
  ```

  (output of the probe on a 3-level hierarchy; only the rows naming `C::`,
  the class being probed, are the probed class's own, the rest document the
  bases).
- Pure slots are tagged `[pure]`.
- A `final` class cannot be probed (`base 'F' is marked 'final'`). Its own
  methods need no vtable anyway (nothing can override them), so they keep
  binding their own symbol; only slots inherited from a base need the base's
  index, which comes from the base's probe.

The result is stored next to `layouts` as `ast.vtables`
(`{ "ns::Class": [{ index, text, pure }, ...] }`) and cached with the AST;
bump `AST_CACHE_VERSION`.

### 3.2 Matching rows to IR methods

A row names the final overrider as text; the IR has structured entries. For
each class, a row belongs to an IR method when the qualifier equals the class
and:

1. name and parameter count match and the method has the same `const`;
2. if that is still ambiguous (overloads), compare the normalized parameter
   list against `mapCType`'s input (`normalizeType()`; clang prints fully
   qualified types, the AST may spell them short, so also try the
   `desugaredQualType`).

A virtual method that cannot be matched keeps the static binding and gets an
entry in `ir.skipped`-style warnings, never a wrong slot.

### 3.3 IR changes

- method: `virtual: true` (set from the probe, replacing `child.virtual`) and
  `vtableIndex: n` (`vptr[n]`); `pure` stays.
- class: `destructor.vtableIndex` (the `[complete]` slot) when the destructor
  is virtual.
- A class that is polymorphic but whose probe failed: no indices, everything
  stays statically bound (today's behavior), noted in the generated file.

## 4. Generated JS

A virtual overload entry carries the slot instead of a lazy function:

```js
const __geo_Base_m_area = [
  { n: 0, t: [], v: 2, f: __virtual(2, target => CFunction({ ptr: target, args: ["pointer"], returns: "f64" })) },
];
```

`__virtual(index, make)` returns `(self, ...args)`:

1. read the vptr: `BigInt(read u64 at self)`;
2. read the target: `read u64 at vptr + 8 * index`;
3. look `target` up in a per-method `Map`; on a miss, `make(target)` builds the
   `CFunction` once;
4. call it with `self, ...args`.

Notes:

- **Cost.** Two small `toBuffer` views per call and a cached `CFunction` per
  distinct overrider. Acceptable first; see 4.1 for the native fast path.
- **`--api=define`.** `define()` registers by name, so `make(target)` uses a
  synthetic unique name (`mangledName + "@" + target`).
- **No symbol needed.** A virtual method is never `dlsym`ed, so pure, inline
  and uninstantiated virtuals all work; the `filter(m => !m.pure)` in
  `classesCode()` goes away, and an abstract class's JS methods become
  callable on instances of its subclasses.
- **Destructor.** `.delete()` calls `vptr[destructor.vtableIndex]` when the
  destructor is virtual, so `Base.from(derivedPtr).delete()` runs the derived
  destructor. A non-virtual destructor keeps the direct `D1` call (a
  `[deleting]` slot, `vptr[index + 1]`, would also free the memory, which an
  owned `ArrayBuffer` must not do: never use it).
- **Single inheritance.** Slots of a primary base share `this`, so no
  adjustment is needed. A secondary base's slots point at `this`-adjusting
  thunks and need the subobject pointer: part of multiple inheritance, still
  out of scope.
- **Objects without a vptr.** `new` already refuses to zero-fill a polymorphic
  class. `from(ptr)` on memory that is not a live object reads a garbage
  vptr; document it, do not guard it.
- **Explicitly qualified calls** (`Base::f()` from a subclass) are the old
  behavior. Not needed now; if wanted later, expose it as
  `Class.prototype.f.nonVirtual` rather than as the default.

### 4.1 Optional native fast path

`CFunction({ vtableIndex: 2, args: ["pointer", ...], returns })` in
`ffi.c`: reads `this->vptr[index]` on every call and reuses one prepared
`cif`. Removes the per-call views and the cache. Only worth it if a benchmark
shows the JS path matters; it is a change to the C module, so it needs its own
review.

## 5. Work items

| # | Step | Verify |
| --- | --- | --- |
| 1 | `runVtableDump()`: build the probe TU, run clang, parse `Vtable for` blocks into `ast.vtables`; bump `AST_CACHE_VERSION` | dump of `tests/cxx/shapes.hpp` gives `geo::Shape` `area` = 2 and both destructor slots |
| 2 | Match rows to methods (3.2); set `virtual`/`vtableIndex`/`destructor.vtableIndex` in `collectClass()` | IR test: indices equal `vptr[n]` found by the C++ program of section 2, and `Shape::area` is now `virtual: true` |
| 3 | `__virtual()` helper, `v:`/dispatch in `overloadList()`, drop the `!m.pure` filter, virtual `.delete()` | tests of section 6 |
| 4 | `--api=define` path with synthetic names | same tests with `--api=define` |
| 5 | Update `TODO.md` ("C++ gaps" item 1) and the `classesCode()` doc comment | read-through |

## 6. Tests

New fixture `tests/cxx/virtuals.{hpp,cpp}` (leave `shapes.*` alone: its sizes
and offsets are asserted):

```cpp
struct Animal {
  virtual ~Animal();                       // bumps a live counter
  virtual int legs() const;                // 4
  virtual const char *name() const = 0;    // pure
  virtual int add(int);  virtual int add(double);   // overloads
  int fixed() const;                       // non-virtual
  inline virtual int inline_only() const { return 1; }   // no exported symbol
};
struct Dog : Animal { int legs() const override; const char *name() const override; ... };
struct Bird : Animal { int legs() const override /* 2 */; ... };
struct Puppy : Dog { const char *name() const; /* override without keyword */ };
extern "C" Animal *make_dog(); extern "C" Animal *make_puppy(); extern "C" int live();
```

| Test | Asserts |
| --- | --- |
| override through a base wrapper | `Animal.from(make_dog()).legs() === 4`, `Bird` gives `2` |
| three levels, override without keyword | `Animal.from(make_puppy()).name() === "puppy"` |
| pure method on an abstract class | `Animal.from(p).name()` works |
| non-virtual stays static | `fixed()` returns the base's value for every subclass |
| overloaded virtuals | `add(1)` and `add(1.5)` reach the right slots |
| inline virtual | `inline_only()` works although `nm -D` does not list it |
| virtual destructor | deleting through `Animal.from(make_dog())` makes `live()` drop |
| indices match the compiler | IR `vtableIndex`es equal clang's `-fdump-vtable-layouts` of `virtuals.cpp` |

Run each new test at least 5 times, per
`.claude/rules/check-tests-for-flakiness.md`.

## 7. Open questions

- Is a second `clang` run acceptable for every C++ source with polymorphic
  classes? The cache makes it a one-off per source; a single probe TU holds
  all classes.
- Is the per-call JS cost acceptable, or should 4.1 be part of the first
  version?
- Should unmatched virtual methods be a hard error instead of a warning plus
  static binding?
