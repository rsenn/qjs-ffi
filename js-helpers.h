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

/* An (offset, length) pair; either may be negative until range_wrap(). */
typedef struct {
  int64_t ofs, len;
} OffsetLength;

/* Resolve negative RANGE.ofs (from the end of a SIZE-byte buffer) and negative
 * RANGE.len (from the end of what remains after the offset), like slice(). */
static inline OffsetLength
range_wrap(OffsetLength range, size_t size) {
  int64_t offset = WRAP(range.ofs, size);

  size -= offset;

  return (OffsetLength){
      offset,
      WRAP(range.len, size),
  };
}

/* A pointer to bytes and how many there are. */
typedef struct {
  uint8_t* data;
  size_t size;
} ByteSpan;

/* All int-returning helpers below return 0 on success and -1 on failure. A
 * js_to_* helper leaves an exception pending on failure; a js_try_* helper
 * never does, so it can be used as a silent probe. */
int js_to_index(JSContext*, int64_t*, JSValueConst value);
int js_to_address(JSContext*, void** out, JSValueConst);
int js_to_pointer(JSContext*, void** out, JSValueConst);
JSValue js_new_pointer(JSContext*, void*);
int js_try_get_bytes(JSContext*, ByteSpan* out, JSValueConst);
int js_try_get_length(JSContext*, JSValueConst, int64_t*);
int js_parse_range(JSContext*, OffsetLength*, int, JSValueConst[]);
int js_parse_span_args(JSContext*, ByteSpan*, int, JSValueConst[]);
JSValue js_function_prototype(JSContext*);

#endif /* defined(QJSFFI_JS_HELPERS_H) */
