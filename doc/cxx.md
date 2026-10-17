# CXXFunction (proof of concept)

`CXXFunction` is `CFunction` for a C++ signature with `std::string` and
`std::string_view`, in JavaScript only (`lib/ffi/cxx.js`). It supports libstdc++
(the `__cxx11` ABI) on x86-64 Linux.

```js
import { dlopen, dlsym, RTLD_NOW } from 'ffi';
import { CXXFunction } from 'ffi/cxx.js';

const join = CXXFunction({ ptr: dlsym(lib, 'join'), args: ['const std::string&', 'std::string_view'], returns: 'std::string' });

join('a', 'b'); // "ab"
```

`CXXFunction({ ptr, args, returns, ...rest })` takes what `CFunction` takes; `rest` goes to it. Only the
types below are special, any other type is a `CFunction` type.

| `args` type | JS value in | out |
| ----------- | ----------- | --- |
| `std::string`, `const std::string&`, `const std::string*` | a string | |
| `std::string&`, `std::string*` | a string, `undefined` for empty; `null` for a `*` passes NULL | the string after the call |
| `std::string_view` | a string | |

| `returns` type | JS value out |
| -------------- | ------------ |
| `std::string`, `std::string_view` | a string |
| `const std::string&`, `std::string&`, `const std::string*`, `std::string*` | a string, copied; `null` for NULL |

A call returns the result first, then every output argument in order: one value comes as itself, several as
an array (`[status, head, tail]`). Strings are UTF-8 and the length is in bytes.

## An owned string

`string` (`lib/ffi/cxx/string.js`) is a `std::string` that JS owns. `CXXFunction` passes its buffer as it is for
`std::string&`, `std::string*` and `const std::string&`, so the callee changes it in place and the changes stay;
such an argument is not returned as an output.

```js
import { string } from 'ffi/cxx/string.js';

const s = new string('hey');
shout(s);        // std::string& shout: appends "!!!"
s.value;         // "hey!!!"
s.length;        // 6, in bytes
s.value = '';    // assigning replaces the contents
s.delete();      // also s[Symbol.dispose](); a string nobody deleted is freed when collected
```

`tests/test-cxx-string.js` is a commented demo.

## How

A `std::string` is 32 bytes: the data pointer, the length, then a union of the capacity and an inline buffer.
The Itanium ABI passes it by pointer and returns it through a hidden pointer, the first argument.

*   An argument is built in a buffer of ours, with its data from `operator new` (so the callee can grow it) and a
    capacity of at least 15, which libstdc++ relies on. It is freed after the call.
*   A returned `std::string` is built by the callee in a buffer we pass first (`x8` on aarch64, not supported),
    read, then freed.
*   A `std::string_view` is two words, passed by value as the struct `['u64', 'pointer']`.

## Not yet

libc++ and the old ABI, aarch64, `std::vector` and other types, bun/deno/node. See `tests/test-cxx.js` and
`tests/cxx/cxxstring.cpp`.
