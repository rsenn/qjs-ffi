#ifndef QJSFFI_FFI_READ_H
#define QJSFFI_FFI_READ_H

#include <quickjs.h>

/* read: bun:ffi's direct memory reads, without a DataView or ArrayBuffer.
 *
 *   read.u8(ptr, byteOffset), read.i32(ptr, byteOffset), ...
 *
 * for ptr, intptr, i8, i16, i32, i64, u8, u16, u32, u64, f32 and f64 (i64/u64 give
 * a bigint, ptr a pointer as ptr() does, intptr the pointer-sized integer as a
 * Number). `ptr` is an address (Number/BigInt) or
 * an ArrayBuffer/view; byteOffset defaults to 0 and may be negative. The
 * read need not be aligned. A NULL pointer throws a TypeError.
 *
 * Meant to be spliced into the module's export list like FFIType:
 * JS_OBJECT_DEF("read", js_ffiread_funcs, FFI_READ_COUNT, ...).
 */

#define FFI_READ_COUNT 12

extern const JSCFunctionListEntry js_ffiread_funcs[FFI_READ_COUNT];

#endif /* defined(QJSFFI_FFI_READ_H) */
