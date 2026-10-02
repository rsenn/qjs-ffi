#ifndef QJSFFI_FFI_READ_H
#define QJSFFI_FFI_READ_H

#include <quickjs.h>

/* read: direct memory reads, no DataView or ArrayBuffer (bun:ffi's read).
 *
 * ```js
 * read.u8(ptr, byteOffset);
 * read.i64(ptr); // a bigint
 * ```
 *
 *   number|bigint|buffer  ptr         address, or an ArrayBuffer/view
 *   number                byteOffset  default 0, may be negative;
 *                                     need not be aligned
 *
 *   returns  by member: i8..i32, u8..u32, f32, f64 a Number; i64, u64
 *            a bigint; ptr a pointer as ptr() gives; intptr the
 *            pointer-sized integer as a Number
 *   throws   TypeError for a NULL or bad pointer
 *
 * spliced into the export list like FFIType:
 * JS_OBJECT_DEF("read", js_ffiread_funcs, FFI_READ_COUNT, ...).
 */

#define FFI_READ_COUNT 12

extern const JSCFunctionListEntry js_ffiread_funcs[FFI_READ_COUNT];

#endif /* defined(QJSFFI_FFI_READ_H) */
