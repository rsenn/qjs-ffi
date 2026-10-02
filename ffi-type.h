#ifndef QJSFFI_FFI_TYPE_H
#define QJSFFI_FFI_TYPE_H

#include <ffi.h>
#include <quickjs.h>

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
  K_BUFFER_LENGTH, /* the byte length of the view passed for this argument */
};

/* X(name, libffi type, kind): the single source for the FFIType export, the
 * name lookup in ffi_resolve_type() and FFI_TYPE_COUNT. Besides the short
 * names, it carries bun:ffi's C-style aliases ("int", "uint8_t", "double" ...).
 */
#define FFI_TYPE_LIST(X) \
  X("void", ffi_type_void, K_VOID, 13) \
  X("bool", ffi_type_uint8, K_BOOL, 11) \
  X("i8", ffi_type_sint8, K_I8, 1) \
  X("u8", ffi_type_uint8, K_U8, 2) \
  X("i16", ffi_type_sint16, K_I16, 3) \
  X("u16", ffi_type_uint16, K_U16, 4) \
  X("i32", ffi_type_sint32, K_I32, 5) \
  X("u32", ffi_type_uint32, K_U32, 6) \
  X("i64", ffi_type_sint64, K_I64, 7) \
  X("u64", ffi_type_uint64, K_U64, 8) \
  X("i64_fast", ffi_type_sint64, K_I64_FAST, 15) \
  X("u64_fast", ffi_type_uint64, K_U64_FAST, 16) \
  X("f32", ffi_type_float, K_F32, 10) \
  X("f64", ffi_type_double, K_F64, 9) \
  X("pointer", ffi_type_pointer, K_POINTER, 12) \
  X("ptr", ffi_type_pointer, K_POINTER, 12) \
  X("function", ffi_type_pointer, K_POINTER, 17) \
  X("cstring", ffi_type_pointer, K_CSTRING, 14) \
  X("int8_t", ffi_type_sint8, K_I8, 1) \
  X("int16_t", ffi_type_sint16, K_I16, 3) \
  X("int32_t", ffi_type_sint32, K_I32, 5) \
  X("int", ffi_type_sint32, K_I32, 5) \
  X("int64_t", ffi_type_sint64, K_I64, 7) \
  X("isize", ffi_type_sint64, K_I64, 7) \
  X("uint8_t", ffi_type_uint8, K_U8, 2) \
  X("uint16_t", ffi_type_uint16, K_U16, 4) \
  X("uint32_t", ffi_type_uint32, K_U32, 6) \
  X("uint64_t", ffi_type_uint64, K_U64, 8) \
  X("usize", ffi_type_uint64, K_U64, 8) \
  X("float", ffi_type_float, K_F32, 10) \
  X("double", ffi_type_double, K_F64, 9) \
  X("char", ffi_type_sint8, K_I8, 0) \
  X("buffer", ffi_type_pointer, K_POINTER, 20) \
  X("fn", ffi_type_pointer, K_POINTER, 17) \
  X("callback", ffi_type_pointer, K_POINTER, 17) \
  X("buffer_length", ffi_type_uint64, K_BUFFER_LENGTH, 21) \
  X("buffer_bytelength", ffi_type_uint64, K_BUFFER_LENGTH, 21)

/* Names bun:ffi has that are FFIType members only: aliases of types above with
 * a name that is not a valid identifier, and napi_env and napi_value, which have
 * no meaning outside Node-API. In a signature they are unknown names like any
 * other (an argument becomes "i32").
 */
#define FFI_TYPE_EXTRA(X) \
  X("c_int", 5) \
  X("c_uint", 6) \
  X("char*", 12) \
  X("void*", 12) \
  X("napi_env", 18) \
  X("napi_value", 19)

/* bun's FFIType also maps each of the numbers 0 to 17 to itself ("5": 5). */
#define FFI_TYPE_INDEX(X) \
  X("0", 0) \
  X("1", 1) \
  X("2", 2) X("3", 3) X("4", 4) X("5", 5) X("6", 6) X("7", 7) X("8", 8) X("9", 9) X("10", 10) X("11", 11) X("12", 12) X("13", 13) X("14", 14) X("15", 15) X("16", 16) X("17", 17)

#define FFI_TYPE_COUNT_ONE(name, type, kind, id) +1
#define FFI_TYPE_COUNT_PAIR(name, id) +1
#define FFI_TYPE_COUNT (0 FFI_TYPE_LIST(FFI_TYPE_COUNT_ONE) FFI_TYPE_EXTRA(FFI_TYPE_COUNT_PAIR) FFI_TYPE_INDEX(FFI_TYPE_COUNT_PAIR))

/* FFIType: name -> number, as bun's: `FFIType.i32` is 5, and every member can
 * be written where a CFunction/JSCallback `args`/`returns` type is expected,
 * as the name ("i32") or as the number (FFIType.i32). Meant to be spliced into
 * a JSCFunctionListEntry list via JS_OBJECT_DEF("FFIType", js_ffitype_funcs,
 * FFI_TYPE_COUNT, ...).
 */
extern const JSCFunctionListEntry js_ffitype_funcs[FFI_TYPE_COUNT];

/* Non-zero if `name` ends in '*' (ignoring trailing blanks): "int *",
 * "struct foo **", "char*". Any such name is a plain pointer, whatever it
 * points to; the text before the '*' is documentation only.
 */
int ffi_is_pointer_name(const char* name);

/* The type a number stands for (bun's FFIType values: 5 is i32, 12 a pointer),
 * or NULL (leaving *kind untouched) for a number that is no type or that this
 * module does not implement (napi_env, napi_value). */
ffi_type* ffi_resolve_type_id(int id, int* kind);

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
