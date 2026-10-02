# Virtual method dispatch through the vtable

Status: **implemented** in `tools/gen-bindings/` (`vtable.js`, `clang.js`,
`ir.js`, `emit/classes.js`). Scope: the C++ classes that
`tools/gen-bindings.js` emits (see `classesCode()` and
[TODO.md](../../TODO.md), "C++ gaps" item 1). Tests:
`tests/test-gen-bindings-virtual.js` on `tests/cxx/virt.{hpp,cpp}`.

## 1. Problem

Binding a method's own symbol makes every call a non-virtual
(`Class::method()`-qualified) call:

```js
const s = new geo_Shape(3, 2.0);
geo_Base.from(s.ptr).area();   // would call Base::area, not Shape::area
```

C++ would call `Shape::area` here. Any wrapper whose static type is a base
class (`at()`/`from()` on a pointer returned by a factory, or an inherited
method) would run the wrong code, and `.delete()` through a base wrapper the
wrong destructor. A **pure virtual** has no symbol at all, and a virtual that is
inline or never instantiated has no exported symbol, so binding it fails with
"symbol not found". Calling through the vtable fixes all three.

## 2. ABI facts (Itanium, x86-64 Linux)

Checked against `tests/cxx/shapes.{hpp,cpp}` compiled with `clang++ -std=c++17`
(a small C++ program that `dlsym`s the symbols and reads the vptr):

| Fact | Evidence |
| --- | --- |
| The vptr is the first 8 bytes of a polymorphic object (offset 0) | `*(void***)&shape` is the vptr |
| `vptr == &_ZTV<class> + 16` (skips offset-to-top and RTTI) | printed `vptr - _ZTV = 16` |
| `vptr[n]` is the n-th virtual slot; a destructor takes **two** consecutive slots, `[complete]` then `[deleting]` | `Shape`: `vptr[0]` = `D1`, `vptr[1]` = `D0`, `vptr[2]` = `area` |
| A slot holds the **final overrider's** function | `vptr[2]` of a `Shape` is `Shape::area`, and calling it on the object returned `6` |
| A pure virtual's slot holds `__cxa_pure_virtual` | `Base`'s `vptr[2]` equals `dlsym("__cxa_pure_virtual")` |
| A subclass's slots start with the base's, so a base-class index is valid for every subclass | `PC : C : B : A`: `f`, `g(int)`, `g(double)` keep their indices |

clang's JSON AST does **not** reliably say which methods are virtual: an
overrider carries only an `OverrideAttr` child and no `"virtual": true`, and one
written without `virtual`/`override` has no marker at all. So the slot numbers
come from the compiler's own vtable dump, not from the AST.

## 3. Where the slot index comes from

clang lays a class's vtable out, and prints it with `-Xclang
-fdump-vtable-layouts`, only once code needs it. `runLayoutDump()` (`clang.js`)
already compiles a probe translation unit for the record layouts; for every
polymorphic class it adds code that makes clang lay the vtable out, and the
compile then goes to LLVM IR (`-S -emit-llvm -o /dev/null`) instead of
`-fsyntax-only`, only if there is such a class. The dump goes to stdout, with
the layouts.

Each polymorphic class gets, tried in this order of need:

1. `p->~C()` in a function, when the destructor is public: lays the vtable out
   if the destructor is virtual (declared so or inherited).
2. `auto m = &C::f;` for a method the AST flags `virtual` or pure whose name is
   not overloaded.
3. A **key-function probe**, only when neither of those can work (overloaded
   virtuals only, and a destructor that is not virtual or not public):

   ```cpp
   typedef class ns::C __gbc0;
   struct __gbk0 : __gbc0 { virtual void __gb_key(); };
   void __gbk0::__gb_key() {}
   ```

   The out-of-line `__gb_key` is the class's key function, so clang emits the
   whole vtable. This works for abstract classes and protected destructors. A
   **`final`** class cannot be derived from, and the error would lose the whole
   dump, so it gets no key probe (the AST condenser keeps `FinalAttr` for this)
   and keeps binding its own symbols.

`parseVtableIndices()` (`vtable.js`) reads the `VTable indices for 'C'` blocks
that 1 and 2 give: the methods the class itself declares, overriders included,
each with its index relative to the vptr. `parseVtableBlocks()` reads the
`Vtable for '__gbkN'` block of 3, which lists every slot, inherited ones too, as
`<row> | <return type> <Qualifier::name>(<params>)[ const]`; the index is **row
- 2** (rows 0 and 1 are offset-to-top and RTTI), and rows naming another class
are ignored when the methods are matched.

The result is `layouts[...].vtableIndices`, cached with the AST
(`AST_CACHE_VERSION`).

### 3.1 Matching entries to methods

`assignVtableSlots()` gives a method of the class `vtableSlot` when its entry is
found by name, number of parameters and constness. Overloads of one arity (a
`f(int)` and an `f(double)`) are told apart by their parameter types: the
entry's, normalized, against the AST's `ParmVarDecl` types (as written, and with
typedefs resolved). A method without exactly one match keeps its own symbol:
a wrong slot would call the wrong function. The complete-object destructor entry
becomes `destructor.vtableSlot`.

### 3.2 IR

`vtableSlot: n` (`vptr[n]`) on each virtual method, whether the AST flags it or
not; `destructor.vtableSlot` (the `[complete]` slot). `virtual` and `pure` stay
as the AST has them. A class without a vtable dump (final, or a failed probe)
has none, and binds as before.

## 4. Generated JS

With `--api=cfunction`, a virtual method's overload entry calls through
`__virtual(slot, spec)` instead of a `CFunction` on its symbol:

```js
function __virtual(slot, spec) {
  const cache = new Map();

  return (self, ...args) => {
    const vptr = new DataView(self).getBigUint64(0, true);
    // fp = vptr[slot]
    // cache.get(fp) or a new CFunction({ ptr: fp, ...spec }); f(self, ...args)
  };
}
```

- **Cost.** One small `toArrayBuffer` view per call and a cached `CFunction` per
  distinct overrider. A native fast path (`CFunction({ vtableIndex })` in
  `ffi.c`, reading `this->vptr[index]` per call) would remove the view; it is
  not done, and only worth it if a benchmark shows the JS path matters.
- **No symbol needed.** A virtual method is never `dlsym`ed, so pure, inline
  and uninstantiated virtuals work, and an abstract class's methods are
  callable on instances of its subclasses.
- **Destructor.** `.delete()` calls `vptr[destructor.vtableSlot]` when there is
  one, so deleting through a base wrapper runs the derived destructor. The
  `[deleting]` slot (`+ 1`) is never used: it would also free the memory, which
  an owned `ArrayBuffer` must not do.
- **`--api=define`** keeps binding by symbol (`define()` registers by name, so
  a call target found at run time has none); no `__virtual()` is generated.
- **Single inheritance.** Slots of a primary base share `this`, so no
  adjustment is needed. A secondary base's slots point at `this`-adjusting
  thunks and need the subobject pointer: part of multiple inheritance, still out
  of scope.
- **Objects without a vptr.** `new` already refuses to zero-fill a polymorphic
  class. `at(ptr)` on memory that is not a live object reads a garbage vptr;
  that is not guarded. A zero vptr throws.
- **Explicitly qualified calls** (`Base::f()` from a subclass) are the old
  behavior and are not exposed; if wanted, as
  `Class.prototype.f.nonVirtual` rather than the default.

## 5. Tests

`tests/test-gen-bindings-virtual.js`, with `tests/cxx/virt.{hpp,cpp}`:

| Test | Asserts |
| --- | --- |
| IR slots | an overrider has its base's slot, overloads have two, a plain or static method none, the implicit destructor of `Bird` has one |
| override through a base wrapper, a pure virtual, a native caller, an object made in JS | `Animal.at(make_animal(1)).legs() === 4`, `Bird` gives `2` |
| three levels, an override without `virtual`/`override` | `Puppy::sound()` through `Animal` |
| inline virtual | `inline_only()` works, with no exported symbol |
| overloads of one arity, protected destructor | `Guarded::f(int)` / `f(double)`, found by the key-function probe |
| `final` class | no probe, own symbols, the other classes unaffected |
| non-virtual stays static | `describe()` is bound to its symbol, `legs()` is not |
| destructors | deleting through `Animal` runs `Dog`'s; `Bird`'s inherited one runs; a deleted object cannot be called |
| `--api=define` | no `__virtual(` in the output |

## 6. Open

- A second `clang` run is not needed: the probes ride on the layout dump, which
  runs once per source and is cached; only the compile goes from
  `-fsyntax-only` to code generation when a polymorphic class exists.
- The per-call JS cost (4) and a native fast path are undecided.
- A virtual method that cannot be matched keeps its symbol silently. A warning
  in `ir.skipped`, or an error, would make it visible.
