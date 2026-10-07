#ifndef QJSFFI_JS_HELPERS_H
#define QJSFFI_JS_HELPERS_H

#include <quickjs.h>
#include <stddef.h>

#ifndef MIN
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#endif
#ifndef MAX
#define MAX(a, b) ((a) >= (b) ? (a) : (b))
#endif
#ifndef CLAMP
#define CLAMP(val, min, max) MAX(MIN((val), (max)), (min))
#endif
#ifndef WRAP
#define WRAP(index, size) ((index) < 0 ? ((index) + (size)) : (index))
#endif

/* an (offset, length) pair; either may be negative until range_wrap(). */
typedef struct {
  int64_t ofs, len;
} OffsetLength;

/* resolves negative values of `range` against a buffer of `size` bytes,
 * like slice() does.
 *
 * ```c
 * range_wrap((OffsetLength){-4, -1}, 10);  // {6, 3}
 * ```
 *
 * a negative offset counts from the end of the buffer, a negative
 * length from the end of what remains after the offset. */
static inline OffsetLength
range_wrap(OffsetLength range, size_t size) {
  int64_t offset = WRAP(range.ofs, size);

  size -= offset;

  return (OffsetLength){
      offset,
      WRAP(range.len, size),
  };
}

/* a pointer to bytes and how many there are. */
typedef struct {
  uint8_t* data;
  size_t size;
} ByteSpan;

/* conversion helpers: each returns 0 on success, -1 on failure.
 * on failure no exception is pending and the output is untouched; the
 * caller decides whether to throw, and with what message.
 *
 *   js_to_*   convert a JS value
 *   js_try_*  probe it
 *
 * js_throw_pointer_error() is the TypeError for a refused pointer. */
int js_to_index(JSContext*, int64_t*, JSValueConst value);
int js_to_address(JSContext*, void** out, JSValueConst);
int js_to_pointer(JSContext*, void** out, JSValueConst);
JSValue js_throw_pointer_error(JSContext*, JSValueConst value);
JSValue js_new_pointer(JSContext*, void*);
int js_try_get_bytes(JSContext*, ByteSpan* out, JSValueConst);
int js_try_get_length(JSContext*, JSValueConst, int64_t*);
int js_parse_range(JSContext*, OffsetLength*, int, JSValueConst[]);
int js_parse_span_args(JSContext*, ByteSpan*, int, JSValueConst[]);
JSValue js_function_prototype(JSContext*);

/* a class that is a type in a signature: a constructor whose prototype
 * inherits from ArrayBuffer.prototype (ArrayBuffer itself is not one), or
 * any constructor with a static integer `size` >= 0.
 *
 * ```js
 * class Point extends ArrayBuffer { static size = 16; }
 * class Raw { static size = 8; constructor() { return Reflect.construct(ArrayBuffer, [8], new.target); } }
 * ```
 *
 *   returns  1 for such a function, else 0; never throws */
int js_is_buffer_class(JSContext*, JSValueConst fn);

/* converts argument `index` (from 1) declared as the class `cls` to the
 * address of its bytes.
 *
 *   JSValueConst  cls    the class; `size` is its static size
 *   JSValueConst  v      null/undefined is NULL; a number or bigint an
 *                        address; an instance of cls or of a subclass; a
 *                        plain ArrayBuffer or view of at least `size` bytes
 *
 *   returns  0, or -1 with an exception pending: a TypeError for an
 *            instance of an unrelated class (argument 2 must be a stat,
 *            not a glob_t) or anything else, a RangeError for a buffer
 *            shorter than `size` */
int js_struct_arg(JSContext*, JSValueConst cls, size_t size, JSValueConst v, int index, void** out);

/* a new non-owning ArrayBuffer of `size` bytes over `ptr`, whose prototype
 * is cls.prototype; null for NULL. the memory is C's: nothing is freed. */
JSValue js_struct_view(JSContext*, JSValueConst cls, size_t size, void* ptr);

#endif /* defined(QJSFFI_JS_HELPERS_H) */
