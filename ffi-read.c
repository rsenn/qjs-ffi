#include "ffi-read.h"
#include "js-helpers.h"
#include <cutils.h>
#include <stdint.h>
#include <string.h>

enum {
  READ_PTR,
  READ_INTPTR,
  READ_I8,
  READ_I16,
  READ_I32,
  READ_I64,
  READ_U8,
  READ_U16,
  READ_U32,
  READ_U64,
  READ_F32,
  READ_F64,
};

#define LOAD(type, p) \
  ({ \
    type v_; \
    memcpy(&v_, (p), sizeof(v_)); \
    v_; \
  })

/* v = read.<kind>(ptr[, byteOffset]) */
static JSValue
js_ffiread(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[], int magic) {
  const uint8_t* p = NULL;
  int64_t ofs = 0;

  if(argc < 1 || js_to_pointer(ctx, (void**)&p, argv[0]))
    return JS_ThrowTypeError(ctx, "read: argument 1 must be a pointer");

  if(!p)
    return JS_ThrowTypeError(ctx, "read: pointer is NULL");

  if(argc > 1 && !JS_IsUndefined(argv[1]) && js_to_index(ctx, &ofs, argv[1]))
    return JS_EXCEPTION;

  p += ofs;

  switch(magic) {
    case READ_PTR: return js_new_pointer(ctx, LOAD(void*, p));
    case READ_INTPTR: return JS_NewInt64(ctx, LOAD(intptr_t, p));
    case READ_I8: return JS_NewInt32(ctx, LOAD(int8_t, p));
    case READ_I16: return JS_NewInt32(ctx, LOAD(int16_t, p));
    case READ_I32: return JS_NewInt32(ctx, LOAD(int32_t, p));
    case READ_I64: return JS_NewBigInt64(ctx, LOAD(int64_t, p));
    case READ_U8: return JS_NewUint32(ctx, LOAD(uint8_t, p));
    case READ_U16: return JS_NewUint32(ctx, LOAD(uint16_t, p));
    case READ_U32: return JS_NewUint32(ctx, LOAD(uint32_t, p));
    case READ_U64: return JS_NewBigUint64(ctx, LOAD(uint64_t, p));
    case READ_F32: return JS_NewFloat64(ctx, LOAD(float, p));
    case READ_F64: return JS_NewFloat64(ctx, LOAD(double, p));
  }

  return JS_UNDEFINED;
}

const JSCFunctionListEntry js_ffiread_funcs[FFI_READ_COUNT] = {
    JS_CFUNC_MAGIC_DEF("ptr", 2, js_ffiread, READ_PTR),
    JS_CFUNC_MAGIC_DEF("intptr", 2, js_ffiread, READ_INTPTR),
    JS_CFUNC_MAGIC_DEF("i8", 2, js_ffiread, READ_I8),
    JS_CFUNC_MAGIC_DEF("i16", 2, js_ffiread, READ_I16),
    JS_CFUNC_MAGIC_DEF("i32", 2, js_ffiread, READ_I32),
    JS_CFUNC_MAGIC_DEF("i64", 2, js_ffiread, READ_I64),
    JS_CFUNC_MAGIC_DEF("u8", 2, js_ffiread, READ_U8),
    JS_CFUNC_MAGIC_DEF("u16", 2, js_ffiread, READ_U16),
    JS_CFUNC_MAGIC_DEF("u32", 2, js_ffiread, READ_U32),
    JS_CFUNC_MAGIC_DEF("u64", 2, js_ffiread, READ_U64),
    JS_CFUNC_MAGIC_DEF("f32", 2, js_ffiread, READ_F32),
    JS_CFUNC_MAGIC_DEF("f64", 2, js_ffiread, READ_F64),
};
