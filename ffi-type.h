#ifndef QJSFFI_FFI_TYPE_H
#define QJSFFI_FFI_TYPE_H

#include <ffi.h>
#include <quickjs.h>

#define FFI_MAX_ARGS 32

/* marshaling kinds, one per bun:ffi FFIType; a static table, not a
 * mutable registry. */
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

/* X(name, libffi type, kind, id): the one list that the FFIType export,
 * the name lookup in ffi_resolve_type() and FFI_TYPE_COUNT come from.
 * besides the short names it has bun:ffi's C aliases ("int", "double"). */
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

/* FFIType members that are only a name and a number: aliases that are
 * not valid identifiers ("c_int", "char*"), and napi_env and napi_value,
 * which mean nothing outside Node-API. in a signature they are unknown
 * names, so an argument of that type becomes "i32". */
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

/* FFIType: type name -> number, as in bun:ffi.
 *
 * ```js
 * FFIType.i32; // 5
 * // a type is written as the name ("i32") or the number (FFIType.i32)
 * ```
 *
 * spliced into the export list:
 * JS_OBJECT_DEF("FFIType", js_ffitype_funcs, FFI_TYPE_COUNT, ...). */
extern const JSCFunctionListEntry js_ffitype_funcs[FFI_TYPE_COUNT];

/* true if `name` ends in '*' (trailing blanks ignored): a plain pointer,
 * whatever it points to.
 *
 * ```c
 * ffi_is_pointer_name("int *");          // 1
 * ffi_is_pointer_name("struct foo **");  // 1
 * ffi_is_pointer_name("char");           // 0
 * ```
 */
int ffi_is_pointer_name(const char* name);

/* the type a number stands for (bun's FFIType values: 5 is i32, 12 a
 * pointer), or NULL when it is no type or not implemented (napi_env,
 * napi_value); *kind is then untouched. */
ffi_type* ffi_resolve_type_id(int id, int* kind);

/* looks up a type name; NULL if unknown, *kind then untouched.
 * a name for which ffi_is_pointer_name() holds is K_POINTER, unless an
 * exact table entry says otherwise. */
ffi_type* ffi_resolve_type(const char* name, int* kind);

/* converts a native slot to a JS value, per kind: a JSCallback argument
 * or an ffi_call() return slot.
 * little-endian: libffi widens small integer returns, and the value of
 * the declared width is at the slot's start. */
JSValue ffi_native_to_js(JSContext* ctx, int kind, const void* p);

/* maps an ABI name to its libffi constant; NULL or an unknown name gives
 * FFI_DEFAULT_ABI. */
int ffi_resolve_abi(const char* name);

/* a parsed `{ args, returns }`, shared by CFunction and JSCallback.
 * `aggregates` owns the ffi_types made for struct types (K_STRUCT);
 * arg_types and ret_type point into them. */
typedef struct FFISignature {
  int argc;
  ffi_type** arg_types;
  int* arg_kind;
  ffi_type* ret_type;
  int ret_kind;
  ffi_type** aggregates;
  int aggregate_count;
} FFISignature;

/* resolves a type that is a name or a number only (no struct or array),
 * as an argument of a variadic call is.
 *
 *   JSValueConst  value  "i32", "cstring", "T *", or FFIType.i32
 *   int*          kind   receives the kind
 *
 *   returns  the ffi_type, or NULL for an unknown name, a struct, void or
 *            buffer_length; never throws
 */
ffi_type* ffi_resolve_scalar(JSContext* ctx, JSValueConst value, int* kind);

/* parses options.args and options.returns into `sig`.
 *
 * ```js
 * { args: ["i32", ["f32", "f32"]], returns: "void" }
 * // an i32, then a struct of two floats passed by value
 * ```
 *
 *   FFISignature*  sig      filled in; release with ffi_sig_free()
 *   JSValueConst   options  any value; a non-object gives no arguments
 *                           and a void return
 *
 *   returns  0, or -1 with an exception pending (out of memory, an invalid
 *            or unknown type, a bad `args`)
 *
 * an unknown type name is a TypeError ("unknown type: x", "unknown return
 * type: x"), as is `args` that is not an array or has more than 32 entries.
 * a struct type lists every scalar member in memory order, array members
 * once per element: libffi works the layout out from that. */
int ffi_sig_parse(JSContext* ctx, FFISignature* sig, JSValueConst options);

/* true if the signature passes or returns a struct by value. */
int ffi_sig_has_struct(const FFISignature* sig);

/* releases the arrays; safe to call twice, they are cleared. */
void ffi_sig_free(JSRuntime* rt, FFISignature* sig);

#endif /* defined(QJSFFI_FFI_TYPE_H) */
