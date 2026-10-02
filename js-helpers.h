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

#endif /* defined(QJSFFI_JS_HELPERS_H) */
