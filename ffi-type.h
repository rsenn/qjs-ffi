#ifndef QJSFFI_FFI_TYPE_H
#define QJSFFI_FFI_TYPE_H

#include <quickjs.h>
#include <ffi.h>

#define FFI_MAX_ARGS 32

/* Marshaling kinds, matching bun:ffi's FFIType vocabulary. Deliberately
 * independent of ffi.c's mutable, string-keyed type registry.
 */
enum {
  K_VOID = 0,
  K_BOOL,
  K_I8,
  K_U8,
  K_I16,
  K_U16,
  K_I32,
  K_U32,
  K_I64,
  K_U64,
  K_I64_FAST,
  K_U64_FAST,
  K_F32,
  K_F64,
  K_POINTER,
  K_CSTRING,
  K_STRUCT,
};

/* X(name, libffi type, kind): the single source for the FFIType export, the
 * name lookup in ffi_resolve_type() and FFI_TYPE_COUNT. Besides the short
 * names, it carries bun:ffi's C-style aliases ("int", "uint8_t", "double" ...).
 */
#define FFI_TYPE_LIST(X) \
  X("void", ffi_type_void, K_VOID) \
  X("bool", ffi_type_uint8, K_BOOL) \
  X("i8", ffi_type_sint8, K_I8) \
  X("u8", ffi_type_uint8, K_U8) \
  X("i16", ffi_type_sint16, K_I16) \
  X("u16", ffi_type_uint16, K_U16) \
  X("i32", ffi_type_sint32, K_I32) \
  X("u32", ffi_type_uint32, K_U32) \
  X("i64", ffi_type_sint64, K_I64) \
  X("u64", ffi_type_uint64, K_U64) \
  X("i64_fast", ffi_type_sint64, K_I64_FAST) \
  X("u64_fast", ffi_type_uint64, K_U64_FAST) \
  X("f32", ffi_type_float, K_F32) \
  X("f64", ffi_type_double, K_F64) \
  X("pointer", ffi_type_pointer, K_POINTER) \
  X("ptr", ffi_type_pointer, K_POINTER) \
  X("function", ffi_type_pointer, K_POINTER) \
  X("cstring", ffi_type_pointer, K_CSTRING) \
  X("int8_t", ffi_type_sint8, K_I8) \
  X("int16_t", ffi_type_sint16, K_I16) \
  X("int32_t", ffi_type_sint32, K_I32) \
  X("int", ffi_type_sint32, K_I32) \
  X("int64_t", ffi_type_sint64, K_I64) \
  X("isize", ffi_type_sint64, K_I64) \
  X("uint8_t", ffi_type_uint8, K_U8) \
  X("uint16_t", ffi_type_uint16, K_U16) \
  X("uint32_t", ffi_type_uint32, K_U32) \
  X("uint64_t", ffi_type_uint64, K_U64) \
  X("usize", ffi_type_uint64, K_U64) \
  X("float", ffi_type_float, K_F32) \
  X("double", ffi_type_double, K_F64) \
  X("char", ffi_type_sint8, K_I8) \
  X("buffer", ffi_type_pointer, K_POINTER) \
  X("fn", ffi_type_pointer, K_POINTER) \
  X("callback", ffi_type_pointer, K_POINTER)

#define FFI_TYPE_COUNT_ONE(name, type, kind) +1
#define FFI_TYPE_COUNT (0 FFI_TYPE_LIST(FFI_TYPE_COUNT_ONE))

/* FFIType: name -> name property table, meant to be spliced into a
 * JSCFunctionListEntry list via JS_OBJECT_DEF("FFIType", js_ffitype_funcs,
 * FFI_TYPE_COUNT, ...), so `FFIType.i32` and `"i32"` are interchangeable
 * wherever a CFunction/JSCallback `args`/`returns` type is expected.
 */
extern const JSCFunctionListEntry js_ffitype_funcs[FFI_TYPE_COUNT];

/* Non-zero if `name` ends in '*' (ignoring trailing blanks): "int *",
 * "struct foo **", "char*". Any such name is a plain pointer, whatever it
 * points to; the text before the '*' is documentation only.
 */
int ffi_is_pointer_name(const char* name);

/* Looks up a type name; a name for which ffi_is_pointer_name() holds is
 * K_POINTER unless an exact table entry says otherwise. Returns NULL (leaving
 * *kind untouched) if unknown.
 */
ffi_type* ffi_resolve_type(const char* name, int* kind);

/* Native slot -> JSValue per kind: a JSCallback argument, or an ffi_call()
 * return slot. Small integer returns are widened by libffi, which on
 * little-endian leaves the declared-width value at the slot's start.
 */
JSValue ffi_native_to_js(JSContext* ctx, int kind, const void* p);

/* Maps an ABI name to its libffi constant; NULL or unknown names give
 * FFI_DEFAULT_ABI.
 */
int ffi_resolve_abi(const char* name);

/* Parsed `{ args, returns }` options, shared by CFunction and JSCallback.
 * `aggregates` owns the ffi_types built for struct types (K_STRUCT), which
 * arg_types/ret_type point into.
 */
typedef struct FFISignature {
  int argc;
  ffi_type** arg_types;
  int* arg_kind;
  ffi_type* ret_type;
  int ret_kind;
  ffi_type** aggregates;
  int aggregate_count;
} FFISignature;

/* Fills *sig from options.args / options.returns; `options` may be any value
 * (non-objects yield a no-argument, void-returning signature). Unknown type
 * names fall back to i32 for args and void for the return. A type given as an
 * array is a struct passed or returned by value: its elements, in order, are
 * type names or (for a nested struct) arrays, and libffi works out the layout,
 * so they must list every scalar member, array members repeated per element.
 * Returns 0, or -1 with an exception pending (out of memory, or an invalid
 * struct type). Release with ffi_sig_free().
 */
int ffi_sig_parse(JSContext* ctx, FFISignature* sig, JSValueConst options);

/* Non-zero if the signature passes or returns a struct by value. */
int ffi_sig_has_struct(const FFISignature* sig);

/* Safe to call twice: the arrays are cleared on release. */
void ffi_sig_free(JSRuntime* rt, FFISignature* sig);

#endif /* defined(QJSFFI_FFI_TYPE_H) */
