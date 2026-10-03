#ifndef QJSFFI_FFI_WRITE_H
#define QJSFFI_FFI_WRITE_H

#include <quickjs.h>

/* write: direct memory writes, no DataView or ArrayBuffer; the mirror of
 * `read`.
 *
 * ```js
 * write.i32(ptr, 8, 42);        // 4 bytes at ptr + 8
 * write.u8(ptr, 0xff);          // offset 0: (ptr, value)
 * write.cstring(ptr, 0, "hi");  // 3 bytes: 'h', 'i', NUL; returns 2
 * write.bytes(ptr, 16, bytes);  // copies a buffer; returns its length
 * ```
 *
 *   number|bigint|buffer  ptr         address, or an ArrayBuffer/view
 *   number                byteOffset  default 0, may be negative;
 *                                     need not be aligned
 *   number|bigint         value       an integer wraps to the width,
 *                                     as for an argument; a ptr takes
 *                                     anything a pointer argument takes
 *
 *   returns  undefined; bytes and cstring give the byte count written
 *            (the NUL of cstring is not counted)
 *   throws   TypeError for a NULL or bad pointer, a bad value or source
 *
 * writes are little-endian and unchecked: writing past the memory crashes
 * the process. spliced into the export list like `read`:
 * JS_OBJECT_DEF("write", js_ffiwrite_funcs, FFI_WRITE_COUNT, ...).
 */

#define FFI_WRITE_COUNT 14

extern const JSCFunctionListEntry js_ffiwrite_funcs[FFI_WRITE_COUNT];

#endif /* defined(QJSFFI_FFI_WRITE_H) */
