#include "ffi-write.h"
#include "js-helpers.h"
#include <cutils.h>
#include <stdint.h>
#include <string.h>

enum {
  WRITE_PTR,
  WRITE_INTPTR,
  WRITE_I8,
  WRITE_I16,
  WRITE_I32,
  WRITE_I64,
  WRITE_U8,
  WRITE_U16,
  WRITE_U32,
  WRITE_U64,
  WRITE_F32,
  WRITE_F64,
  WRITE_BYTES,
  WRITE_CSTRING,
};

#define STORE(type, p, v) \
  do { \
    type v_ = (type)(v); \
    memcpy((p), &v_, sizeof(v_)); \
  } while(0)

/* write.<kind>(ptr[, byteOffset], value): stores one value of the kind
 * `magic` names (WRITE_*). see ffi-write.h. */
static JSValue
js_ffiwrite(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[], int magic) {
  uint8_t* p = NULL;
  int64_t ofs = 0, i = 0;
  double d = 0;
  JSValueConst value;

  if(argc < 2 || js_to_pointer(ctx, (void**)&p, argv[0]))
    return JS_ThrowTypeError(ctx, "write: argument 1 must be a pointer, and a value is needed");

  if(!p)
    return JS_ThrowTypeError(ctx, "write: pointer is NULL");

  if(argc > 2) {
    if(!JS_IsUndefined(argv[1]) && js_to_index(ctx, &ofs, argv[1]))
      return JS_ThrowTypeError(ctx, "write: argument 2 must be BigInt | Number");

    value = argv[2];
  } else {
    value = argv[1];
  }

  p += ofs;

  switch(magic) {
    case WRITE_PTR: {
      void* q;

      if(js_to_pointer(ctx, &q, value))
        return js_throw_pointer_error(ctx, value);

      STORE(void*, p, q);
      return JS_UNDEFINED;
    }

    case WRITE_F32:
    case WRITE_F64:
      if(JS_ToFloat64(ctx, &d, value))
        return JS_EXCEPTION;

      if(magic == WRITE_F32)
        STORE(float, p, d);
      else
        STORE(double, p, d);

      return JS_UNDEFINED;

    case WRITE_BYTES: {
      ByteSpan src;
      int64_t n;

      if(js_try_get_bytes(ctx, &src, value))
        return JS_ThrowTypeError(
            ctx, "write.bytes: the source must be an ArrayBuffer, TypedArray or DataView");

      n = src.size;

      if(argc > 3 && !JS_IsUndefined(argv[3])) {
        if(js_to_index(ctx, &n, argv[3]) || n < 0)
          return JS_ThrowTypeError(
              ctx, "write.bytes: byteLength must be a non-negative BigInt | Number");

        n = MIN(n, (int64_t)src.size);
      }

      memcpy(p, src.data, n);
      return JS_NewInt64(ctx, n);
    }

    case WRITE_CSTRING: {
      size_t n;
      const char* s;

      if(!JS_IsString(value))
        return JS_ThrowTypeError(ctx, "write.cstring: the value must be a string");

      if(!(s = JS_ToCStringLen(ctx, &n, value)))
        return JS_EXCEPTION;

      memcpy(p, s, n);
      p[n] = 0;
      JS_FreeCString(ctx, s);
      return JS_NewInt64(ctx, n);
    }
  }

  /* the integer kinds: a Number or a BigInt, wrapped to the width */
  if(JS_ToInt64Ext(ctx, &i, value))
    return JS_EXCEPTION;

  switch(magic) {
    case WRITE_INTPTR: STORE(intptr_t, p, i); break;
    case WRITE_I8: STORE(int8_t, p, i); break;
    case WRITE_I16: STORE(int16_t, p, i); break;
    case WRITE_I32: STORE(int32_t, p, i); break;
    case WRITE_I64: STORE(int64_t, p, i); break;
    case WRITE_U8: STORE(uint8_t, p, i); break;
    case WRITE_U16: STORE(uint16_t, p, i); break;
    case WRITE_U32: STORE(uint32_t, p, i); break;
    case WRITE_U64: STORE(uint64_t, p, i); break;
  }

  return JS_UNDEFINED;
}

const JSCFunctionListEntry js_ffiwrite_funcs[FFI_WRITE_COUNT] = {
    JS_CFUNC_MAGIC_DEF("ptr", 3, js_ffiwrite, WRITE_PTR),
    JS_CFUNC_MAGIC_DEF("intptr", 3, js_ffiwrite, WRITE_INTPTR),
    JS_CFUNC_MAGIC_DEF("i8", 3, js_ffiwrite, WRITE_I8),
    JS_CFUNC_MAGIC_DEF("i16", 3, js_ffiwrite, WRITE_I16),
    JS_CFUNC_MAGIC_DEF("i32", 3, js_ffiwrite, WRITE_I32),
    JS_CFUNC_MAGIC_DEF("i64", 3, js_ffiwrite, WRITE_I64),
    JS_CFUNC_MAGIC_DEF("u8", 3, js_ffiwrite, WRITE_U8),
    JS_CFUNC_MAGIC_DEF("u16", 3, js_ffiwrite, WRITE_U16),
    JS_CFUNC_MAGIC_DEF("u32", 3, js_ffiwrite, WRITE_U32),
    JS_CFUNC_MAGIC_DEF("u64", 3, js_ffiwrite, WRITE_U64),
    JS_CFUNC_MAGIC_DEF("f32", 3, js_ffiwrite, WRITE_F32),
    JS_CFUNC_MAGIC_DEF("f64", 3, js_ffiwrite, WRITE_F64),
    JS_CFUNC_MAGIC_DEF("bytes", 3, js_ffiwrite, WRITE_BYTES),
    JS_CFUNC_MAGIC_DEF("cstring", 3, js_ffiwrite, WRITE_CSTRING),
};
