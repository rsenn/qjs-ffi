# qjs-ffi documentation

The pages follow the layout of the bun:ffi documentation
([FFI](https://bun.com/docs/runtime/ffi),
[C compiler](https://bun.com/docs/runtime/c-compiler)), with one page per topic.
Start with the [overview](ffi.md).

## Start here

| Page | |
| ---- | - |
| [README](../README.md) | what qjs-ffi is, installation and a first example |
| [Foreign function interface](ffi.md) | usage, every import, memory management, differences from bun:ffi |

## Reference

| Page | Covers |
| ---- | ------ |
| [Libraries and symbols](dlopen.md) | `dlopen()`, `linkSymbols()`, `dlsym()`, `dlclose()`, `dlerror()`, `errno()`, `suffix`, `RTLD_*` |
| [Types and ABI](types.md) | `FFIType`, type names and aliases, structs by value, ABI names |
| [CFunction](c-function.md) | a native function pointer as a JavaScript function |
| [JSCallback](js-callback.md) | a JavaScript function as a native function pointer |
| [Pointers and memory](pointers.md) | `ptr()`, `toPointer()`, `toArrayBuffer()`, `toBuffer()`, `read`, `write`, `CString`, `toString()`, `pointerSize` |
| [C compiler](c-compiler.md) | `cc()`: compile and run C from JavaScript |
| [Miscellaneous](misc.md) | `JSContext()`, `debug()` |

## Tools

| Page | Covers |
| ---- | ------ |
| [Generating bindings](gen-bindings.md) | `tools/gen-bindings.js` and `tools/gen-structs.js`: bindings for C and C++ headers |

## Legacy

| Page | Covers |
| ---- | ------ |
| [Legacy API](legacy.md) | `define()` and `call()`, the module `legacy.js` |

## Internals

Design notes for contributors; not user documentation.

| Page | Covers |
| ---- | ------ |
| [Virtual dispatch](internals/cxx-virtual-dispatch.md) | plan for calling C++ virtual methods through the vtable |
| [TODO](../TODO.md) | the bun:ffi conformance plan and open work |

## Layout

```
README.md                     overview, installation (-> getting-started)
doc/
  README.md                   this index
  ffi.md                      overview of the module, every import
  dlopen.md                   libraries and symbols
  types.md                    types, structs by value, ABI
  c-function.md  js-callback.md
  pointers.md                 ptr, toArrayBuffer, read, CString, toString
  c-compiler.md               cc()
  misc.md                     JSContext, debug
  gen-bindings.md             the binding generators
  legacy.md                   define / call (legacy.js)
  internals/                  design notes
examples/                     bindings to real libraries
tests/                        runnable examples, one suite per feature
```
