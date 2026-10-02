#include "js-helpers.h"
#include <cutils.h>

/* Resolve negative RANGE.ofs (from the end of a SIZE-byte buffer) and negative
 * RANGE.len (from the end of what remains after the offset), like slice(). */
static OffsetLength
range_wrap(OffsetLength range, size_t size) {
  int64_t offset = WRAP(range.ofs, size);

  size -= offset;

  return (OffsetLength){
      offset,
      WRAP(range.len, size),
  };
}

/* Narrow SPAN in place to the window RANGE describes: advance data by ofs and
 * clamp size to what remains. RANGE must already be wrapped and ofs within
 * SPAN. */
static void
span_slice(ByteSpan* span, OffsetLength range) {
  span->data += range.ofs;
  int64_t remain = span->size - range.ofs;
  span->size = MIN(remain, range.len);
}

/* Convert VALUE to an int64 index/offset into *OUT (may be NULL). Returns 0
 * on success, -1 (exception pending) if the conversion fails. */
int
js_to_index(JSContext* ctx, int64_t* out, JSValueConst value) {
  int64_t ofs = 0;

  if(JS_ToInt64Ext(ctx, &ofs, value))
    return -1;

  if(out)
    *out = ofs;

  return 0;
}

/* Convert VALUE to a raw address and store it through OUT (a void**, may be
 * NULL to only validate). null maps to 0; anything else goes through
 * JS_ToInt64Ext, so Numbers and BigInts both work. Returns 0 on success, -1
 * (with a TypeError pending) if VALUE isn't convertible. */
int
js_to_address(JSContext* ctx, void** out, JSValueConst value) {
  int64_t addr;

  if(JS_IsNull(value))
    addr = 0;
  else if(JS_ToInt64Ext(ctx, &addr, value)) {
    JS_ThrowTypeError(ctx, "value must be null, Number, BigInt or something convertible");
    return -1;
  }

  if(out)
    *out = (void*)(intptr_t)addr;

  return 0;
}

/* Get an address from VALUE into *OUT (a void**, may be NULL):
 * the data of an ArrayBuffer/TypedArray if it is one,
 * else null/Number/BigInt viajs_to_address().
 * Returns 0 on success, -1 (TypeError pending) otherwise. */
int
js_to_pointer(JSContext* ctx, void** out, JSValueConst value) {
  ByteSpan span;
  void* p;

  if(!js_try_get_bytes(ctx, &span, value))
    p = span.data;
  else if(js_to_address(ctx, &p, value))
    return -1;

  if(out)
    *out = p;

  return 0;
}

/* A pointer as bun:ffi hands it out: null for NULL, a Number up to 2^53 - 1
 * (Number.MAX_SAFE_INTEGER, exact; every user-space address on 64-bit Linux
 * and Windows is below 2^47), else an exact unsigned BigInt. */
JSValue
js_new_pointer(JSContext* ctx, void* ptr) {
  uintptr_t addr = (uintptr_t)ptr;

  if(!addr)
    return JS_NULL;

  if(addr <= (uintptr_t)9007199254740991ULL)
    return JS_NewInt64(ctx, (int64_t)addr);

  return JS_NewBigUint64(ctx, addr);
}

/* Get the bytes behind OBJ into OUT: an ArrayBuffer, or a TypedArray (OUT is
 * then narrowed to that view's byteOffset/byteLength).
 * Returns 0 on success, -1 if OBJ is neither. Never leaves an exception
 * pending. */
int
js_try_get_bytes(JSContext* ctx, ByteSpan* out, JSValueConst obj) {
  size_t offset, bytes, bytes_per_element;
  JSValue buffer = JS_GetTypedArrayBuffer(ctx, obj, &offset, &bytes, &bytes_per_element);

  if(JS_IsException(buffer)) {
    /* JS_GetTypedArrayBuffer threw; discard the exception so the caller can
     * treat this as a silent "not a typed array" probe. */
    JS_FreeValue(ctx, JS_GetException(ctx));
    buffer = JS_DupValue(ctx, obj);
    offset = 0;
    bytes = SIZE_MAX;
  }

  if((out->data = JS_GetArrayBuffer(ctx, &out->size, buffer)))
    span_slice(out, (OffsetLength){offset, (int64_t)bytes < 0 ? INT64_MAX : (int64_t)bytes});

  JS_FreeValue(ctx, buffer);

  if(!out->data)
    JS_FreeValue(ctx, JS_GetException(ctx));

  return out->data ? 0 : -1;
}

/* Store OBJ.length in *OUT. Returns 0 on success, -1 (leaving *OUT alone) if
 * OBJ isn't an object or has no usable length. Never leaves an exception
 * pending. */
int
js_try_get_length(JSContext* ctx, JSValueConst obj, int64_t* out) {
  int64_t len;
  int ret = -1;

  if(JS_IsObject(obj)) {
    JSValue val = JS_GetPropertyStr(ctx, obj, "length");

    /* Callers don't propagate errors, so a pending exception would leak out
     * of an otherwise successful call. */
    if(JS_IsException(val) || JS_ToInt64(ctx, &len, val))
      JS_FreeValue(ctx, JS_GetException(ctx));
    else {
      *out = len;
      ret = 0;
    }

    JS_FreeValue(ctx, val);
  }

  return ret;
}

/* Parse an optional [offset[, length]] pair from the front of ARGV into OUT
 * (may be NULL), defaulting to {0, INT64_MAX} ("everything").
 * Cannot fail: it stops at the first argument that isn't convertible.
 * Returns how many arguments were consumed (0, 1 or 2).
 * Values may be negative; see range_wrap(). */
int
js_parse_range(JSContext* ctx, OffsetLength* out, int argc, JSValueConst argv[]) {
  OffsetLength range = {0, INT64_MAX};
  int i = 0;

  if(i < argc && !js_to_index(ctx, &range.ofs, argv[i]))
    if(++i < argc && !js_to_index(ctx, &range.len, argv[i]))
      i++;

  if(out)
    *out = range;

  return i;
}

/* Parse buffer-ish arguments into OUT, in one of two forms:
 *   BUFFER[, offset[, length]]   an ArrayBuffer/TypedArray, optionally sliced
 *                                (negative offset/length count from the end)
 *   POINTER, length              a raw address (Number/BigInt) and a size
 * Returns the number of arguments consumed, or 0 if ARGV matches neither form.
 */
int
js_parse_span_args(JSContext* ctx, ByteSpan* out, int argc, JSValueConst argv[]) {
  int i = 1;

  if(!js_try_get_bytes(ctx, out, argv[0])) {
    OffsetLength range;

    i += js_parse_range(ctx, &range, argc - i, argv + i);
    span_slice(out, range_wrap(range, out->size));
  } else if(argc > 1 && !js_to_pointer(ctx, (void**)&out->data, argv[0])) {
    int64_t n;

    if(js_to_index(ctx, &n, argv[1]))
      return 0;

    out->size = n;
    i = 2;
  } else {
    return 0;
  }

  return i;
}

/* Function.prototype, fetched the same way qjs-lws's js_function_prototype()
 * does (js-utils.c:9-15): a throwaway JS_NewCFunction exists only to read
 * its [[Prototype]] off of.
 */
JSValue
js_function_prototype(JSContext* ctx) {
  JSValue fn = JS_NewCFunction(ctx, NULL, "", 0);
  JSValue proto = JS_GetPrototype(ctx, fn);
  JS_FreeValue(ctx, fn);
  return proto;
}