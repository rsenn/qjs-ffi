#ifndef QJSFFI_FFI_TYPE_H
#define QJSFFI_FFI_TYPE_H

#include <quickjs.h>

/* FFIType: name -> name property table, meant to be spliced into a
 * JSCFunctionListEntry list via JS_OBJECT_DEF("FFIType", js_ffitype_funcs,
 * FFI_TYPE_COUNT, ...), so `FFIType.i32` and `"i32"` are interchangeable
 * wherever a CFunction/JSCallback `args`/`returns` type is expected.
 * Matches the vocabulary independently duplicated in js-callback.c and
 * c-function.c's own `type_table`s (see the comment there) -- kept here as
 * a third, equally independent copy rather than a shared header,
 * consistent with how those two already avoid depending on ffi.c's
 * mutable, string-keyed type registry.
 */
#define FFI_TYPE_COUNT 18

extern const JSCFunctionListEntry js_ffitype_funcs[FFI_TYPE_COUNT];

#endif /* defined(QJSFFI_FFI_TYPE_H) */
