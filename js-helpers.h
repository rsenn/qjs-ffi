#ifndef QJSFFI_JS_HELPERS_H
#define QJSFFI_JS_HELPERS_H

#include <quickjs.h>

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

typedef struct {
  int64_t ofs, len;
} ofs_len;

typedef struct buf {
  uint8_t* ptr;
  size_t len;
} ptr_len;

static inline ofs_len
offset_length_wrap(ofs_len ol, size_t size) {
  int64_t offset = WRAP(ol.ofs, size);

  size -= offset;

  return (ofs_len){
      offset,
      WRAP(ol.len, size),
  };
}

static inline ofs_len
offset_length_clamp(ofs_len ol, size_t size) {
  int64_t ofs = CLAMP(ol.ofs, 0, size);
  size -= ofs;
  return (ofs_len){ofs, CLAMP(ol.len, 0, size)};
}

static inline void
offset_length_apply(ofs_len ol, ptr_len* buf) {
  buf->ptr += ol.ofs;
  int64_t remain = buf->len - ol.ofs;
  buf->len = MIN(remain, ol.len);
}

static inline ptr_len
offset_length_buf(ofs_len ol, ptr_len buf) {
  return (ptr_len){buf.ptr + ol.ofs, ol.len};
}

static inline int
js_index(JSContext* ctx, JSValueConst value, int64_t* pval) {
  int64_t ofs = 0;

  if(JS_ToInt64Ext(ctx, &ofs, value))
    return -1;

  if(pval)
    *pval = ofs;

  return 0;
}

static inline int
js_offsetlength(JSContext* ctx, ofs_len* out, int argc, JSValueConst argv[]) {
  ofs_len ol = {0, INT64_MAX};
  int i = 0;

  if(i < argc && !js_index(ctx, argv[i], &ol.ofs))
    if(++i < argc && !js_index(ctx, argv[i], &ol.len))
      i++;

  if(out)
    *out = ol;

  return i;
}

static inline int
js_buf(JSContext* ctx, ptr_len* buf, JSValueConst obj) {
  size_t offset, bytes, bytes_per_element;
  JSValue buffer = JS_GetTypedArrayBuffer(ctx, obj, &offset, &bytes, &bytes_per_element);
  int ret = 0;

  if(JS_IsException(buffer)) {
    /* JS_GetTypedArrayBuffer threw; discard the exception so the caller can
     * treat this as a silent "not a typed array" probe. */
    JS_FreeValue(ctx, JS_GetException(ctx));
    buffer = JS_DupValue(ctx, obj);
    offset = 0;
    bytes = SIZE_MAX;
  }

  if((buf->ptr = JS_GetArrayBuffer(ctx, &buf->len, buffer)))
    offset_length_apply((ofs_len){offset, (int64_t)bytes < 0 ? INT64_MAX : (int64_t)bytes}, buf);

  JS_FreeValue(ctx, buffer);

  if(!buf->ptr)
    JS_FreeValue(ctx, JS_GetException(ctx));

  return buf->ptr ? 0 : -1;
}

static inline uint8_t*
js_ptrlen(JSContext* ctx, size_t* p_len, JSValueConst obj) {
  ptr_len buf;

  if(js_buf(ctx, &buf, obj))
    return 0;

  if(p_len)
    *p_len = buf.len;

  return buf.ptr;
}

static inline void*
js_ptr(JSContext* ctx, JSValueConst value) {
  int64_t n = (ptrdiff_t)js_ptrlen(ctx, NULL, value);

  if(!n)
    if(js_index(ctx, value, &n))
      return 0;

  return (void*)(ptrdiff_t)n;
}

static inline int
js_bufargv(JSContext* ctx, ptr_len* pbuf, int argc, JSValueConst argv[]) {
  int i = 1;

  if((pbuf->ptr = js_ptrlen(ctx, &pbuf->len, argv[0]))) {
    ofs_len ol;

    if((i += js_offsetlength(ctx, &ol, argc - i, argv + i)) > 0) {
      ol = offset_length_wrap(ol, pbuf->len);
      offset_length_apply(ol, pbuf);
    }
  } else if(argc > 1 && (pbuf->ptr = js_ptr(ctx, argv[0]))) {
    int64_t n;

    if(js_index(ctx, argv[1], &n))
      return 0;

    pbuf->len = n;
  } else {
    return 0;
  }

  return i;
}

#endif /* defined(QJSFFI_JS_HELPERS_H) */
