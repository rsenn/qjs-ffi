# Miscellaneous

## `JSContext()`

```js
const ctx = JSContext();
```

Returns the address of the running `JSContext *` as a pointer value. With it a
script can call functions of the QuickJS C API, which take the context as their
first argument, through `dlsym()` and [`CFunction`](c-function.md): a limited
form of introspection of the interpreter itself.

```js
import { JSContext, dlsym, CFunction, RTLD_DEFAULT } from 'ffi';

const JS_GetRuntime = CFunction({ ptr: dlsym(RTLD_DEFAULT, 'JS_GetRuntime'), args: ['pointer'], returns: 'pointer' });

const rt = JS_GetRuntime(JSContext());
```

The function must be exported by the program or library that holds QuickJS.
A wrong call takes the interpreter down with it.

## `debug()`

A hook for debugging the module itself: it does nothing and returns `null`,
but is a place for a breakpoint. With `ffi.so` built with `-g`:

```sh
$ gdb qjsm
(gdb) set args script.js
(gdb) b js_debug
Make breakpoint pending on future shared library load? (y or [n]) y
(gdb) run
```

The breakpoint is hit on the first call of `debug()` in the script.
