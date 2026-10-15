# Generated bindings against hand-written bindings

Could a binding made by [`qjs-ffi-genbindings`](gen-bindings.md) replace the
hand-written native module for the same library? This page assesses every
library bound in the qjs-* projects: what a generated binding would cover, what
it would not, how its API would differ, and what stands in the way.

*   [Summary](#summary)
*   [Method](#method)
*   [What a generated binding is](#what-a-generated-binding-is)
*   [General disadvantages](#general-disadvantages)
*   [Library by library](#library-by-library)
*   [Problems found in the generator](#problems-found-in-the-generator)
*   [Recommended strategy](#recommended-strategy)
*   [Not assessed](#not-assessed)

## Summary

No hand-written binding can be replaced by a generated one **as it is**.
The two make different things: a generated module is a 1:1 mirror of the C
declarations (every function, as `CFunction`, with the C names and C
conventions); a hand-written module is an API designed for JavaScript (classes,
exceptions, iterators, Promises, typed arrays, shared conventions between
modules, a lifetime tied to the garbage collector). The generated module is a
good *foundation* for several of them.

| Verdict | Meaning | Libraries |
| ------- | ------- | --------- |
| **A** thin wrapper suffices | the generated module plus a short JS layer (tens of lines) could take over | libmagic, bcrypt, libsamplerate, rubberband, soundtouch, portmidi |
| **B** generated as the backend | the C surface is fully covered, but the JS API (classes, conventions) stays hand-written or becomes a sizeable JS layer | libarchive, sqlite, postgresql, mysql, libserialport, wasm3, libyaml, GLFW, aubio, libsndfile |
| **C** not feasible today | blocked by what the generator or `qjs-ffi` cannot express | libwebsockets, nanovg, Dear ImGui, OpenCV, STK, PortAudio (real-time callbacks) |

Verdicts are judgements. What they rest on is marked in the tables: **run**
means a generated module was loaded and called, **gen** means it was generated
and its declarations and the skipped-function list were read, **read** means
only the hand-written API was read.

## Method

Done on 2026-10-14/15, on x86_64 Linux, with the distribution's headers and
shared libraries (the sonames used: libsqlite3.so.0, libarchive.so.13, libglfw.so.3,
libopencv_*.so.406, libmagic.so.1, libpq.so.5, libyaml-0.so.2, libsndfile.so.1,
libportaudio.so.2, libportmidi.so.0, libsamplerate.so.0, librubberband.so.2,
libaubio.so.5, libSoundTouch.so.1, libstk.so, libmysqlclient.so.21) and the bundled
sources of libwebsockets, nanovg, Dear ImGui, wasm3, libserialport and libbcrypt.

1.  For each library: `qjs-ffi-genbindings --structs --jsdoc [--follow-includes]
    --library=<soname> <header>` (C++ with `--c++`). Time, size, number of
    `CFunction`s, number of skipped functions and the skip reasons were noted.
2.  Does the module load? A generated module resolves **every** symbol when it
    is imported. When the import failed on a missing symbol, that symbol was
    added to `--exclude` and the import repeated until it loaded
    ([the count](#general-disadvantages) is a measure of header-versus-library
    drift).
3.  The exported API of each hand-written module was dumped with
    `qjs-ffi-describe.sh --flat <module>` (classes, members, constants).
4.  Smoke tests of generated modules: sqlite (open, exec, prepare, step, column,
    finalize, close), libmagic (open, load, file, close), GLFW (version string,
    `glfwInit`).
5.  The signatures were classified: callbacks (`function` arguments),
    out-parameters (`T **`), pointer and `cstring` returns, skipped functions.

The numbers are for this machine and these library versions. Everything can be
repeated with the commands on this page.

## What a generated binding is

*   One `CFunction` per C function, named exactly as in C (`sqlite3_open`), one
    constant per enum value and per literal `#define` (`SQLITE_OK`,
    `GLFW_PRESS`, `MAGIC_MIME`), optional buffer classes for structs and unions
    (`--structs`), classes for C++ classes (`--c++`).
*   Plain JavaScript importing `ffi`; it works unchanged under qjsm, and with
    `--target=bun|deno|node` under those runtimes. The generator and clang are
    needed only to make it.
*   Load cost is small: the 1.1 MB module for libwebsockets loads in 0.03 s
    and 12 MB resident, the hand-written `lws` in 0.00 s and 8.6 MB;
    sqlite 0.01 s and 7.4 MB against 6.3 MB.

Measured on sqlite and libmagic, what a call looks like:

```js
// generated sqlite
const pdb = new BigUint64Array(1);
s.sqlite3_open(':memory:', pdb);              // out-parameter by hand
const db = pdb[0];
s.sqlite3_exec(db, 'create table t(a,b)', null, null, null);   // returns 0, not an exception
s.sqlite3_column_text(st, 1);                 // 102663029014792: a pointer, not a string
s.sqlite3_finalize(st); s.sqlite3_close(db);  // by hand, nothing frees it on GC
```

```js
// hand-written sqlite: one class, results as rows, errors as exceptions
const db = new SQLite3(':memory:');
db.exec('create table t(a,b)');
for(const row of db.execute('select * from t')) ...   // fetchRow / fetchAssoc / numRows
```

A C function returning `const char *` comes back as a string when its return
type is `char *`/`const char *` (`magic_file` returned `application/x-pie-executable`),
but not when it returns `unsigned char *` (`sqlite3_column_text`): there it is a
number the caller must pass to `toString()`.

## General disadvantages

These apply to every library, and each is a reason a generated module does not
obsolete a hand-written one.

1.  **No JavaScript idiom.** Errors are return codes (`rc != 0`), out-values are
    typed-array out-parameters, handles are numbers or `BigInt`, enumerations are
    plain constants. No exceptions, iterators, Promises, `Symbol.dispose`,
    `for...of`, `toJSON`, `toString`.
2.  **No lifetime management.** A C handle (`sqlite3 *`, `struct archive *`) is not
    freed by the garbage collector. The hand-written modules put a finalizer on a
    class; a generated C binding has none (`--finalize` exists for C++ objects made
    with `new`, not for `xxx_open()`/`xxx_close()` pairs). A missed `close` leaks.
3.  **A struct pointer is only a number** unless `--structs` wraps it, and those
    classes are plain `ArrayBuffer` copies of the layout: there is no
    getter on a nested pointer that returns a live object of the right class.
4.  **Callbacks run through `JSCallback`.** It works for synchronous callbacks
    (`sqlite3_exec`, GLFW's setters), but its `threadsafe` option is accepted and
    ignored (`TODO.md` §1 of this project): a callback invoked from another
    thread (PortAudio, libwebsockets service threads, libuv-style pools)
    cannot be made safe. The hand-written modules post to the QuickJS loop.
    The generated module also does not keep the callback alive: the caller must.
5.  **All symbols are resolved at import.** A header declares more than the
    library on the machine defines (compile-time options, other platforms,
    other vendors). sqlite3.h: 13 symbols had to be excluded before the module
    would load (`sqlite3_win32_set_directory`, `sqlite3_mutex_held`,
    `sqlite3_stmt_scanstatus`, ...); the MariaDB `mysql.h` against the MySQL
    `libmysqlclient.so.21` left more than 80 symbols unresolved, so it never
    loads. The hand-written modules are compiled against one header and one
    library and cannot drift.
6.  **A shared library is required.** `dlopen()` needs a `.so`/`.dll`. Libraries
    vendored and linked statically into the module (`third_party/` bcrypt,
    wasm3, libserialport; nanovg; the bundled libwebsockets) have none to open.
    A `qjsm` with closed, statically linked builtins (musl-static, cosmopolitan,
    some Windows and WASI builds; see the `remote-targets` knowledge) may have no
    `dlopen()` at all. A native module needs neither.
7.  **Inline and header-only code has no symbol.** A function that is `static
    inline`, a macro, a C++ template or an inline member leaves nothing for
    `dlsym()`. Only what the library exports can be called.
8.  **No semantics from the header.** Who owns a returned pointer, which argument
    is the length of which buffer, which `char *` is binary, which return value
    needs `free()`: the header does not say, and neither does the generated
    module. The hand-written modules encode the answers.
9.  **Header and library must agree, and the bindings must be regenerated** per
    library version; there is no stable JS API of the module itself, it changes
    with the C header (`lib/bindings/*.js` in this project are already out of date,
    `TODO.md` §2.4).
10. **Size and noise.** One module exposes the whole header: 790 exports for sqlite,
    a 1.1 MB file for libwebsockets, 354 KB for Dear ImGui. Most of it is never used.

Advantages that go the other way: complete C coverage (nothing forgotten, nothing
renamed), no C to write or to debug (no `JSValue` ownership bugs), a regenerate
instead of a port when the library grows, and a binding that also runs under
bun, deno and node.

## Library by library

### qjs-modules

| Library | Hand-written API | Generated (this machine) | Verdict |
| ------- | ---------------- | ------------------------ | ------- |
| **libmagic** | class `Magic`, 14 methods (`file`, `buffer`, `descriptor`, `load`, `check`, `compile`, `list`, `getflags`/`setflags`, `getparam`/`setparam`, `error`, `errno`, `version`), 44 constants (`Magic.MIME`, ...) | 18 functions, loads, **run**: `magic_open`, `magic_load`, `magic_file` → `application/x-pie-executable`; flags such as `MAGIC_MIME_TYPE` present as constants | **A**. Same surface. The wrapper would be a `Magic` class holding the handle, a finalizer (`magic_close`) and turning `magic_error()` into exceptions |
| **bcrypt** | `hash`, `genSalt`, `compare`, `HASHSIZE`, `SALTSIZE` | 3 functions (`bcrypt_gensalt`, `bcrypt_hashpw`, `bcrypt_checkpw`), **gen** | **A** in API terms (the wrapper allocates the `BCRYPT_HASHSIZE` output buffer and returns a string), but libbcrypt is vendored statically: no `.so` to `dlopen()` |
| **libarchive** | `Archive` (21 members: `open`, `next`, `read`, `write`, `extract`, `seek`, `skip`, `filters`, `format`, `compression`, `fileCount`, ...), `ArchiveEntry` (30 properties: `pathname`, `size`, `mtime`, `mode`, `uid`/`gid`, `filetype`, `symlink`, ...), `ArchiveMatch` (`include`, `exclude`) | 421 functions (`archive.h` + `archive_entry.h`), loads, 7 take callbacks (the open/read/write/close client callbacks), **gen** | **B**. Complete coverage, but `ArchiveEntry` as a property bag, iteration with `next()` and reading from a JS stream or buffer are the value of the hand-written module. `qjs-ffi` already ships `lib/bindings/libarchive.js` as a low-level companion |
| **sqlite** | `SQLite3` (34 members), `SQLite3Result` (`fetchRow`, `fetchAssoc`, `fetchField(s)`, `numRows`, `numFields`, `eof`, `reset`), `SQLite3Error`; constants `OPEN_*`, `INTEGER`/`FLOAT`/`TEXT`/`BLOB`/`NULL`, `RESULT_OBJECT`/`RESULT_STRING` | 278 functions, 790 exports with structs; loads only after excluding 13; 44 take callbacks, 21 out-parameters; **run**: open, exec, prepare, step, column, finalize, close all work | **B**. The pointer-returning `sqlite3_column_text`, manual finalization and return codes make the raw module unpleasant; the hand-written one shares its shape with `pgsql` and `mysql` (see next rows) |
| **postgresql** | `PGconn` (31 members: `execute`, `query`, `escapeString`/`escapeLiteral`/`escapeIdentifier`/`escapeBytea`, `connect`, `fd`, `nonblocking`, `insertId`, ...), `PGresult` (the same fetch methods as sqlite), `PGerror`; constants `RESULT_OBJECT`/`RESULT_STRING`/`RESULT_TBLNAM` | 165 functions, 235 exports, loads without exclusions, **gen** | **B** |
| **mysql** | `MySQL`, `MySQLResult`, `MySQLError` (same API shape as the two above) | header from MariaDB (`/usr/include/mariadb/mysql.h`), library `libmysqlclient.so.21` (Oracle MySQL): more than 80 declared symbols missing, the module never loads | **B**, and blocked here by the header/library mismatch |
| *common to the three databases* | one uniform API: `execute()`, `fetchRow()`/`fetchAssoc()`, `numRows()`, `escapeString()`, `RESULT_OBJECT`/`RESULT_STRING`, the same three error classes. A script can switch the database by changing one `import` | three unrelated C APIs (`sqlite3_*`, `PQ*`, `mysql_*`) with different handles, error models and result access | the point of the hand-written trio is the **shared API**. The generator cannot make that; a generated module is only the backend of the JS layer |
| **libserialport** | Web Serial API: `Serial.getPorts()`, `Serial.requestPort()`, `SerialPort` (15 members: `open`, `close`, `read`, `write`, `drain`, `flush`, `getSignals`, `setSignals`, `getInfo`, ...) | 79 functions, loads (static copy of the library, no `.so` given), **gen** | **B**. The hand-written API follows a W3C interface so code written for browsers and Node runs unchanged. The C API (`sp_*`) is the backend |
| **wasm3** | the W3C WebAssembly JS API: `Module`, `Instance`, `validate`, `Memory` (`buffer`, `grow`), `Table`, `Global`, `RuntimeError`/`CompileError`/`LinkError`; `backend` = `"wasm3"` | 75 functions (`m3_*`), 5 take callbacks, 37 return `cstring`, **gen** | **B**. Same reasoning: the point is the standard API on top of a runtime that does not have one. Linked statically |
| **libyaml** | `write()` | 48 functions (the event-based parser and emitter, structs by pointer), loads, **gen** | **B**. libyaml hands out events; turning events into JS values and back is the hand-written work, and a generated binding does none of it |

The pure-JavaScript-semantics native modules (`deep`, `inspect`, `json`, `bjson`, `blob`,
`list`, `predicate`, `queue`, `repeater`, `stream`, `sockets`, `mmap`, `xml`, `lexer`, ...)
wrap no external library and are out of scope.

### qjs-lws

| Library | Hand-written API | Generated | Verdict |
| ------- | ---------------- | --------- | ------- |
| **libwebsockets** | `LWSContext`, `LWSVhost`, `LWSSocket`, `LWSSockAddr46`, `LWSSPA`, `X509Certificate`, 20 functions, 246 constants, plus JavaScript modules in `lib/` (for example `fetch()`) on top | with `--follow-includes`: 1175 functions, 264 classes, 1.1 MB, 4.2 s; 150 out-parameters, 62 callbacks. **Does not load**: `lws_xos` is both a struct and a function, and the module defines both ([problem 1](#problems-found-in-the-generator)). 2 functions skipped (a union by value) | **C**. libwebsockets is driven by one protocol callback with a reason code, per-connection user data and "writable" scheduling, called from its own service loop. That needs the QuickJS event loop integration, per-session memory the hand-written module owns and callbacks that may not run on a foreign thread. Not expressible with `JSCallback` |

### qjs-glfw, qjs-nanovg, qjs-imgui

| Library | Hand-written API | Generated | Verdict |
| ------- | ---------------- | --------- | ------- |
| **GLFW** | 9 classes (`Window` with 51 members, `Monitor`, `VideoMode`, `GammaRamp`, `Position`, `Size`, `Scale`, `WorkArea`, `Image`), 30 functions, 218 constants; callbacks as `Window` properties | 116 functions + 295 constants, 21 take callbacks, loads without exclusions, **run**: `glfwGetVersionString()` → `3.3.10 X11 GLX EGL OSMesa clock_gettime evdev shared`, `glfwInit()` → 1 | **B**. Everything is reachable; the `Window` class (with its callbacks as properties, `userPointer`, getters that return `{width, height}` instead of two out-parameters) is what a user wants. Callbacks run on the thread that calls `glfwPollEvents`, so `JSCallback` is workable here |
| **nanovg** | 20 functions, 51 constants (colors and paints as JS values) | 87 functions, **17 skipped**: all of `nvgRGB`, `nvgRGBA`, `nvgHSL`, ... (return `NVGcolor` by value: "a member is an anonymous struct or union") and `nvgFillColor`, `nvgStrokeColor`, `nvgFillPaint`, `nvgLinearGradient`, `nvgBoxGradient`, `nvgRadialGradient`, `nvgImagePattern` (`NVGpaint` by value: "size 76 where libffi computes 80") | **C**. The skipped functions are the core of the API: colours and fills cannot be set. The static library is also built into the module |
| **Dear ImGui** | 308 functions (the `ImGui::` widgets), 2 values | `--c++`: 595 functions, 35 classes, 354 KB, 32 skipped (`ImVec2`/`ImVec4` by value in several calls: "unrecognized C type", `operator[]`, `operator new`) | **C**. Immediate-mode code calls `ImGui::Button("x")` and leaves the rest to defaults; a C++ default argument has no symbol, so a generated `Button` would need every argument (not tested). `ImVec2` by value is not bound, varargs (`Text(fmt, ...)`) are skipped, and the renderer backends (`imgui_impl_*`) are separate sources |

### qjs-opencv

| Library | Hand-written API | Generated | Verdict |
| ------- | ---------------- | --------- | ------- |
| **OpenCV** | 344 functions (`GaussianBlur`, `resize`, `Canny`, `HoughLines`, feature detectors, background subtractors, ...), 44 classes (`Mat`, `Point`, `Rect`, `Size`, `KeyPoint`, `FileStorage`, typed vectors such as `PointVector`), 850 constants | `core/mat.hpp` alone: 325 functions, 19 classes, 13 s, 137 functions skipped plus 25 operators; `imgproc.hpp`: 69 skipped, **and `cv::GaussianBlur` and `cv::resize` are among them** (`parameter ksize: unrecognized C type "cv::Size_<int>"`); `getGaussianKernel` returns `Mat` by value ("unrecognized C type") | **C**. OpenCV's API is built on templates (`Size_<int>`, `Point_<T>`, `Rect_<T>`), `InputArray`/`OutputArray` proxies that convert implicitly from `Mat`, `vector`, scalar and `Matx`, overloads, default arguments, operator overloading and inline members. None of those has a symbol or a C ABI form a generic FFI can call |

### qjs-sound

| Library | Hand-written API | Generated | Verdict |
| ------- | ---------------- | --------- | ------- |
| **libsamplerate** | `SampleRateConverter` + 5 `SRC_*` constants | 20 functions, loads, 1 callback (`src_callback_new`), **gen** | **A**. Convert `Float32Array`s through `src_process`; the class holds the `SRC_STATE *` |
| **rubberband** | one factory function + 27 constants | 31 functions (C API `rubberband-c.h`), loads, **gen** | **A** |
| **SoundTouch** | one class function, 9 values | `--c++`: 19 functions, 2 classes, 4.1 s, **gen**. The distribution also has the C API `libSoundTouchDll` | **A** (C++ methods through `--c++`) |
| **portmidi** | 9 functions + 33 constants | 21 functions, loads with the right soname (`libportmidi.so.0`), 2 callbacks, **gen** | **A**. Polling API; no foreign-thread callback is needed |
| **libsndfile** | one function (a file/handle class) + 78 constants | 40 functions, loads, **gen**. `SF_INFO` is a struct filled in by `sf_open`; `sf_command` is variadic | **B**. Reading into `Float32Array`s and the `SF_INFO` handling are what the wrapper does. Variadic functions are bound (`test-gen-bindings-variadic.js`) but each call must list the types |
| **aubio** | `AubioOnset` (18 members), `AubioNotes`, `AubioPitch`: only the detectors used | 295 functions with `--follow-includes` (the umbrella header `aubio.h` has none itself and yields "no bindable functions found" without it) | **B**. The generated module has far more than the three classes, and little of the object-style `new_aubio_onset`/`del_aubio_onset` lifetime is automatic |
| **PortAudio** | 10 functions + 39 constants (a wrapper around the stream callback) | 36 functions, loads, **gen** | **C** for streaming: `Pa_OpenStream` takes a callback that runs on the real-time audio thread. Calling QuickJS from there is unsafe and `JSCallback` `threadsafe` is not implemented. Blocking read/write streams (`Pa_ReadStream`/`Pa_WriteStream`) would work |
| **STK** | 61 functions, 11 classes (own synthesis voices such as `Tr909BassDrum`, `RtWvOut`) | `--c++`: 37 functions, 6 classes from three headers in 20.9 s, 11 skipped (`std::string`, operators). STK is mostly header-only, so most of its classes have no exported symbol | **C**. Header-only C++ code cannot be called by symbol, and the hand-written voices are not STK classes |
| **labsound**, **sndobj** | 18 classes (labsound), 11 functions (sndobj) | not generated (no installed library or headers on this machine) | not assessed |
| **qjs-rgfw** | a single-header library (`RGFW.h`) compiled into the module | not generated (header not installed) | **C** by construction: a single-header library has no shared library and its functions are `static`/inline |

## Problems found in the generator

These are what stood between the generator and the hand-written modules. They are
facts from the runs above; the project `TODO.md` is the place for the work.

1.  **Fixed 2026-10-15: the class is renamed `_t`.** **Struct tag and function with the same name break `--structs`.** libwebsockets
    has `struct lws_xos` and `lws_xos()`; the module declares `export class
    lws_xos` and `export const lws_xos` and fails with `invalid redefinition of
    global identifier`. The two live in different C namespaces, so this is
    common (`stat`, `timeval`-style names). The generator needs a rule (suffix the
    class, e.g. `lws_xos_t`/`struct_lws_xos`), and `--namespace` already refuses
    to write anything when stripping a prefix collides (`cv::EMD`).
2.  **Fixed 2026-10-15 for unions with one layout (all 17 nanovg functions bind).** **A struct by value with an anonymous union, or a layout libffi computes
    differently, makes the function unbindable.** nanovg: `NVGcolor` (an anonymous
    union of `float rgba[4]` and `struct{r,g,b,a}`) and `NVGpaint` (76 bytes against
    80). These are exactly the argument and return types of the common calls.
3.  **Fixed 2026-10-15 for the qjs target: a missing symbol is a throwing stub.** **Missing symbols abort the import.** One absent symbol (an `#ifdef`ed or
    other-platform declaration) makes the whole module unusable. Resolving lazily
    (on first call, or `sym ? CFunction : throwing stub`) or taking a
    `--check-symbols` list from the library would remove the manual `--exclude`
    loop (13 times for sqlite, impossible for the MariaDB header on a MySQL library).
4.  **C++ types the generator cannot name.** `cv::Size_<int>`, `ImVec2` and `UMat`
    returned by value, `std::string`. Template instantiations that are typedef'd
    (`typedef Size_<int> Size2i`) and small value classes are the most common
    arguments in real C++ APIs. Each unresolved type drops the whole function.
5.  **Default arguments are lost.** A C++ default argument has no symbol; the
    generated call needs every parameter. The AST has the default; the wrapper
    could be emitted with a `JS` default (`size = [0, 0]`).
6.  **Return type `unsigned char *`/`const unsigned char *` is a number.** Text APIs
    that use it (`sqlite3_column_text`, many `libxml2`/`libpq` functions) need a
    per-function `cstring` override (`--cstring=sqlite3_column_text`).
7.  **No handle finalization for C `open`/`close` pairs.** A `--handle=sqlite3:sqlite3_close`
    mapping (type, destructor) would let the generator attach a finalizer to
    handle-typed returns and out-parameters.
8.  **Ownership annotation.** A `--owned-return=<function>` / `--free=<function>` option
    (returned memory freed with `free`, or by a named destructor) would remove most of
    the leak risk in the C APIs that return heap strings.
9.  **Out-parameters.** `T **` and `int *` arguments are the general convention; an
    `--out=<function>:<arg>` option, or a heuristic by name (`out`, `pp`, `p*`), could
    have the wrapper allocate the cell and return the value, and `rc != 0` become an
    exception for functions marked as such.
10. **Cross-compiled targets without `dlopen`.** A static musl, cosmopolitan or
    closed-builtin qjsm has none; the answer there stays a native module. A mode that
    emits the symbol table for a statically linked `qjsm` (`--emit-specs` already
    writes the dlopen specs) could close that gap.
11. **The documentation says macros are not bound.** In these runs literal `#define`
    constants were: `SQLITE_OK`, `GLFW_PRESS`, `MAGIC_MIME`, `SFM_READ`,
    `LWS_CALLBACK_ESTABLISHED`. Expression macros were not (`paFloat32`, a cast
    expression). Update `gen-bindings.md` (Limitations) to say what is bound.

## Recommended strategy

1.  **Keep the hand-written modules.** For every library where the JS API is the
    value (databases, serial, wasm, archive, windowing, networking), the generated
    module cannot take its place.
2.  **Use the generated module as the backend of a JavaScript layer**, where the
    C surface is the part that goes stale: libmagic, libsamplerate, rubberband,
    SoundTouch, portmidi first. They are the smallest, the C API is simple and the
    callback and threading questions do not arise. Measure against the hand-written
    module's tests before removing any native code.
3.  **Close the generator gaps in the order of what they unblock:** the name
    collision (libwebsockets loads), lazy symbol resolution (sqlite, mysql), struct
    by value with unions/layout (nanovg), `unsigned char *` as string (sqlite),
    handle finalizers (almost every C library), then C++ value types and defaults
    (ImGui, OpenCV). After the first three, re-run this assessment: libwebsockets and
    nanovg would move from C to B.
4.  **Do not target** libwebsockets' service model, PortAudio's real-time callbacks,
    OpenCV's template API, or header-only libraries (STK, RGFW) with generation. They
    need either a thread-safe `JSCallback`, a hand-written layer or a C shim compiled
    with `cc()`.
5.  **Re-run this assessment** after generator changes. The counts here are the
    baseline: sqlite 13 exclusions, nanovg 17 skipped, OpenCV `GaussianBlur` and
    `resize` skipped, libwebsockets not loading.

    After the first three fixes (2026-10-15): sqlite imports with no exclusion
    (781 exports); nanovg binds all 87 functions (the by-value layout is checked
    against a compiled fixture, `tests/cxx/anonunion.c`, not the nanovg library);
    libwebsockets generates with `--structs` and has no duplicate export
    (`lws_xos_t`; the shared library is not installed here, so it was not
    loaded). The verdicts are unchanged until the generated modules are run
    against the real libraries.

To repeat a run:

```sh
qjs-ffi-genbindings --structs --jsdoc --library=libsqlite3.so.0 /usr/include/sqlite3.h -o sqlite.js
qjs-ffi-describe.sh --flat sqlite                       # the hand-written module
qjsm -e "import('./sqlite.js').then(m => console.log(Object.keys(m).length), e => console.log(e.message))"
```

## Not assessed

*   labsound and sndobj (no library or headers installed here), qjs-rgfw (header
    not installed).
*   Behaviour on other platforms (Windows, Android, WASI), where the availability of
    `dlopen()` and library sonames decides most of it.
*   Performance of calls (a `CFunction` call against a native method call). Only load
    time and resident size were measured.
*   The verdicts marked **gen**: loaded or generated, not exercised beyond the lists
    above.
