#include "js-helpers.h"
#include "js-callback.h"
#include <cutils.h>

/* narrows `span` to the window `range` describes: data advances by the
 * offset, size shrinks to what remains (at most len).
 * `range` is already wrapped and its offset lies inside `span`. */
static void
span_slice(ByteSpan* span, OffsetLength range) {
  span->data += range.ofs;
  int64_t remain = span->size - range.ofs;
  span->size = MIN(remain, range.len);
}

/* drops the exception a failed conversion left behind: the js_to_*
 * helpers report failure by their return value only. */
static void
clear_exception(JSContext* ctx) {
  if(JS_HasException(ctx))
    JS_FreeValue(ctx, JS_GetException(ctx));
}

/* converts `value` to an int64 offset or index.
 *
 *   int64_t*  out  receives the result; may be NULL; untouched on failure
 *
 *   returns  0, or -1 if `value` does not convert (a Symbol, a valueOf()
 *            that throws); never throws
 */
int
js_to_index(JSContext* ctx, int64_t* out, JSValueConst value) {
  int64_t ofs = 0;

  if(JS_ToInt64Ext(ctx, &ofs, value)) {
    clear_exception(ctx);
    return -1;
  }

  if(out)
    *out = ofs;

  return 0;
}

/* converts `value` to a raw address, the way bun:ffi takes a pointer.
 *
 *   null, undefined  NULL
 *   Number           truncated; NaN, infinities and values outside int64
 *                    give 0x8000000000000000, as bun does
 *   BigInt           modulo 2^64: -1n and 2n**64n-1n are one address
 *   anything else    failure: boolean, string, Symbol, any object
 *
 *   void**  out  receives the address; may be NULL to only validate
 *
 *   returns  0, or -1 with out untouched; never throws, the caller
 *            throws with js_throw_pointer_error()
 */
int
js_to_address(JSContext* ctx, void** out, JSValueConst value) {
  int64_t addr = 0;

  if(JS_IsNull(value) || JS_IsUndefined(value)) {
    addr = 0;
  } else if(JS_IsBigInt(ctx, value)) {
    if(JS_ToInt64Ext(ctx, &addr, value)) {
      clear_exception(ctx);
      return -1;
    }
  } else if(JS_IsNumber(value)) {
    double d;

    if(JS_ToFloat64(ctx, &d, value)) {
      clear_exception(ctx);
      return -1;
    }

    addr = d >= -9223372036854775808.0 && d < 9223372036854775808.0 ? (int64_t)d : INT64_MIN;
  } else {
    return -1;
  }

  if(out)
    *out = (void*)(intptr_t)addr;

  return 0;
}

/* converts `value` to an address like js_to_address(), and also takes
 * memory and callbacks.
 *
 *   ArrayBuffer, TypedArray, DataView  its data
 *   JSCallback                         its function pointer; closed fails
 *   anything else                      as js_to_address()
 *
 *   void**  out  receives the address; may be NULL to only validate
 *
 *   returns  0, or -1 with out untouched; never throws
 */
int
js_to_pointer(JSContext* ctx, void** out, JSValueConst value) {
  JSCallback* cl;
  ByteSpan span;
  void* p;

  if(JS_IsNull(value) || JS_IsUndefined(value)) {
    p = NULL;
  } else if((cl = js_callback_data(value))) {
    if(!cl->code)
      return -1;

    p = cl->code;
  } else if(!js_try_get_bytes(ctx, &span, value))
    p = span.data;
  else if(js_to_address(ctx, &p, value))
    return -1;

  if(out)
    *out = p;

  return 0;
}

/* throws the TypeError that says why js_to_pointer() refused `value`.
 *
 *   a closed JSCallback  "JSCallback is closed"
 *   a string             "cannot convert a string to a pointer; ..."
 *   anything else        "cannot convert argument to a pointer"
 *
 *   returns  JS_EXCEPTION, for the caller to return
 */
JSValue
js_throw_pointer_error(JSContext* ctx, JSValueConst value) {
  JSCallback* cl = js_callback_data(value);

  if(cl && !cl->code)
    return JS_ThrowTypeError(ctx, "JSCallback is closed");

  if(JS_IsString(value))
    return JS_ThrowTypeError(ctx, "cannot convert a string to a pointer; encode it as a buffer");

  return JS_ThrowTypeError(ctx, "cannot convert argument to a pointer");
}

/* the JS value for a native pointer, as bun:ffi hands it out.
 *
 *   NULL            null
 *   up to 2^53 - 1  a Number, exact (user-space addresses on 64-bit
 *                   Linux and Windows are below 2^47)
 *   above           an unsigned BigInt
 */
JSValue
js_new_pointer(JSContext* ctx, void* ptr) {
  uintptr_t addr = (uintptr_t)ptr;

  if(!addr)
    return JS_NULL;

  if(addr <= (uintptr_t)9007199254740991ULL)
    return JS_NewInt64(ctx, (int64_t)addr);

  return JS_NewBigUint64(ctx, addr);
}

/* the bytes of a DataView, which JS_GetTypedArrayBuffer() does not know:
 * its `buffer` from `byteOffset` for `byteLength`. never throws. */
static int
try_get_view_bytes(JSContext* ctx, ByteSpan* out, JSValueConst obj) {
  JSValue buffer, offset, length;
  uint32_t ofs = 0, len = 0;
  size_t size;
  uint8_t* data = NULL;

  if(!JS_IsObject(obj))
    return -1;

  buffer = JS_GetPropertyStr(ctx, obj, "buffer");
  offset = JS_GetPropertyStr(ctx, obj, "byteOffset");
  length = JS_GetPropertyStr(ctx, obj, "byteLength");

  if(JS_IsObject(buffer) && !JS_ToUint32(ctx, &ofs, offset) && !JS_ToUint32(ctx, &len, length) && (data = JS_GetArrayBuffer(ctx, &size, buffer)) && (size_t)ofs + len <= size) {
    out->data = data + ofs;
    out->size = len;
  } else {
    data = NULL;
  }

  JS_FreeValue(ctx, buffer);
  JS_FreeValue(ctx, offset);
  JS_FreeValue(ctx, length);

  if(!data)
    JS_FreeValue(ctx, JS_GetException(ctx));

  return data ? 0 : -1;
}

/* gets the bytes behind `obj`: an ArrayBuffer, a TypedArray or a
 * DataView (a view gives just its byteOffset/byteLength window).
 *
 *   returns  0, or -1 if `obj` is none of them; never throws
 */
int
js_try_get_bytes(JSContext* ctx, ByteSpan* out, JSValueConst obj) {
  size_t offset, bytes, bytes_per_element;
  JSValue buffer = JS_GetTypedArrayBuffer(ctx, obj, &offset, &bytes, &bytes_per_element);

  if(JS_IsException(buffer)) {
    /* not a typed array: drop the exception, try it as an ArrayBuffer */
    JS_FreeValue(ctx, JS_GetException(ctx));
    buffer = JS_DupValue(ctx, obj);
    offset = 0;
    bytes = SIZE_MAX;
  }

  if((out->data = JS_GetArrayBuffer(ctx, &out->size, buffer)))
    span_slice(out, (OffsetLength){offset, (int64_t)bytes < 0 ? INT64_MAX : (int64_t)bytes});

  JS_FreeValue(ctx, buffer);

  if(out->data)
    return 0;

  JS_FreeValue(ctx, JS_GetException(ctx));
  return try_get_view_bytes(ctx, out, obj);
}

/* stores `obj.length` in `out`.
 * returns 0, or -1 with out untouched if `obj` is not an object or has no
 * usable length; never throws. */
int
js_try_get_length(JSContext* ctx, JSValueConst obj, int64_t* out) {
  int64_t len;
  int ret = -1;

  if(JS_IsObject(obj)) {
    JSValue val = JS_GetPropertyStr(ctx, obj, "length");

    /* swallow the error: callers do not propagate it */
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

/* parses an optional `offset[, length]` from the front of `argv`.
 *
 *   ()        {0, INT64_MAX}: everything
 *   (4)       {4, INT64_MAX}
 *   (4, -1)   {4, -1}; negative counts from the end, see range_wrap()
 *
 *   OffsetLength*  out  receives the range; may be NULL
 *
 *   returns  how many arguments were used (0, 1 or 2); it stops at the
 *            first one that does not convert, so it cannot fail
 */
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

/* parses buffer-like arguments into a span, in one of two forms.
 *
 *   (buffer[, offset[, length]])  an ArrayBuffer/TypedArray, sliced;
 *                                 negative values count from the end
 *   (pointer, length)             a raw address and a size
 *
 *   returns  how many arguments were used, or 0 if neither form matches
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

/* Function.prototype of the context, read off a throwaway C function. */
JSValue
js_function_prototype(JSContext* ctx) {
  JSValue fn = JS_NewCFunction(ctx, NULL, "", 0);
  JSValue proto = JS_GetPrototype(ctx, fn);
  JS_FreeValue(ctx, fn);
  return proto;
}
/* ArrayBuffer.prototype of the context; a new reference. */
static JSValue
arraybuffer_prototype(JSContext* ctx) {
  JSValue global = JS_GetGlobalObject(ctx);
  JSValue ctor = JS_GetPropertyStr(ctx, global, "ArrayBuffer");
  JSValue proto = JS_IsObject(ctor) ? JS_GetPropertyStr(ctx, ctor, "prototype") : JS_UNDEFINED;

  JS_FreeValue(ctx, ctor);
  JS_FreeValue(ctx, global);
  return proto;
}

/* the parent of `obj` is `proto`. */
static int
parent_is(JSContext* ctx, JSValueConst obj, JSValueConst proto) {
  JSValue parent = JS_GetPrototype(ctx, obj);
  int same = JS_IsObject(parent) && JS_VALUE_GET_PTR(parent) == JS_VALUE_GET_PTR(proto);

  clear_exception(ctx);
  JS_FreeValue(ctx, parent);
  return same;
}

int
js_is_buffer_class(JSContext* ctx, JSValueConst fn) {
  JSValue base, proto, p;
  int found = 0;

  if(!JS_IsFunction(ctx, fn))
    return 0;

  proto = JS_GetPropertyStr(ctx, fn, "prototype");
  base = arraybuffer_prototype(ctx);

  /* walk up from fn.prototype: ArrayBuffer itself has no such ancestor */
  p = JS_DupValue(ctx, proto);

  for(int depth = 0; JS_IsObject(p) && JS_IsObject(base) && depth < 64 && !found; depth++) {
    JSValue next = JS_GetPrototype(ctx, p);

    clear_exception(ctx);
    found = JS_IsObject(next) && JS_VALUE_GET_PTR(next) == JS_VALUE_GET_PTR(base);
    JS_FreeValue(ctx, p);
    p = next;
  }

  JS_FreeValue(ctx, p);
  JS_FreeValue(ctx, base);

  /* any other constructor with a static integer `size` is one too, its
   * instances being buffers made with Reflect.construct(ArrayBuffer, ...) */
  if(!found && JS_IsObject(proto)) {
    JSValue size = JS_GetPropertyStr(ctx, fn, "size");
    int64_t n = -1;

    found = JS_IsNumber(size) && !JS_ToInt64(ctx, &n, size) && n >= 0;
    JS_FreeValue(ctx, size);
    clear_exception(ctx);
  }

  JS_FreeValue(ctx, proto);
  return found;
}

/* `v` is an ArrayBuffer itself, not a view of one. */
static int
is_arraybuffer(JSContext* ctx, JSValueConst v) {
  size_t n;
  int ok = JS_GetArrayBuffer(ctx, &n, v) != NULL;

  clear_exception(ctx);
  return ok;
}

/* the name of `v`'s constructor, or of the class `v` itself; "an object"
 * when it has none. refcount: JS_FreeCString() the result. */
static const char*
class_name(JSContext* ctx, JSValueConst v, int of_class) {
  JSValue ctor = of_class ? JS_DupValue(ctx, v) : JS_GetPropertyStr(ctx, v, "constructor");
  JSValue name = JS_IsObject(ctor) ? JS_GetPropertyStr(ctx, ctor, "name") : JS_UNDEFINED;
  const char* s = JS_IsString(name) ? JS_ToCString(ctx, name) : NULL;

  JS_FreeValue(ctx, name);
  JS_FreeValue(ctx, ctor);
  clear_exception(ctx);
  return s;
}

int
js_struct_arg(JSContext* ctx, JSValueConst cls, size_t size, JSValueConst v, int index, void** out) {
  ByteSpan buf;
  int inst;

  if(JS_IsNull(v) || JS_IsUndefined(v)) {
    *out = NULL;
    return 0;
  }

  if(!JS_IsObject(v)) {
    if(js_to_pointer(ctx, out, v)) {
      js_throw_pointer_error(ctx, v);
      return -1;
    }

    return 0;
  }

  if((inst = JS_IsInstanceOf(ctx, v, cls)) < 0)
    return -1;

  if(js_try_get_bytes(ctx, &buf, v)) {
    const char *want = class_name(ctx, cls, 1), *got = class_name(ctx, v, 0);

    JS_ThrowTypeError(ctx, "CFunction: argument %d must be a %s, not %s", index, want ? want : "class", got ? got : "an object");
    JS_FreeCString(ctx, want);
    JS_FreeCString(ctx, got);
    return -1;
  }

  /* an ArrayBuffer of another class is a TypeError; only the plain
   * ArrayBuffer (and a view) takes the place of any class */
  if(!inst && is_arraybuffer(ctx, v)) {
    JSValue base = arraybuffer_prototype(ctx);
    int plain = parent_is(ctx, v, base);

    JS_FreeValue(ctx, base);

    if(!plain) {
      const char *want = class_name(ctx, cls, 1), *got = class_name(ctx, v, 0);

      JS_ThrowTypeError(ctx, "CFunction: argument %d must be a %s, not a %s", index, want ? want : "class", got ? got : "object");
      JS_FreeCString(ctx, want);
      JS_FreeCString(ctx, got);
      return -1;
    }
  }

  if(buf.size < size) {
    const char* want = class_name(ctx, cls, 1);

    JS_ThrowRangeError(ctx, "CFunction: argument %d must be at least %zu bytes (a %s)", index, size, want ? want : "class");
    JS_FreeCString(ctx, want);
    return -1;
  }

  *out = buf.data;
  return 0;
}

JSValue
js_struct_view(JSContext* ctx, JSValueConst cls, size_t size, void* ptr) {
  JSValue ab, proto;

  if(!ptr)
    return JS_NULL;

  if(JS_IsException(ab = JS_NewArrayBuffer(ctx, ptr, size, NULL, NULL, FALSE)))
    return ab;

  proto = JS_GetPropertyStr(ctx, cls, "prototype");

  if(JS_IsException(proto) || JS_SetPrototype(ctx, ab, proto) < 0) {
    JS_FreeValue(ctx, proto);
    JS_FreeValue(ctx, ab);
    return JS_EXCEPTION;
  }

  JS_FreeValue(ctx, proto);
  return ab;
}
