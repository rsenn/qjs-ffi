#ifndef QJSFFI_JS_HELPERS_H
#define QJSFFI_JS_HELPERS_H

#include <stddef.h>
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

int js_toptr(JSContext*, void*, JSValueConst);
int js_offsetlength(JSContext*, ofs_len*, int, JSValueConst[]);
int js_buf(JSContext*, ptr_len*, JSValueConst);
int js_buf_arguments(JSContext*, ptr_len*, int, JSValueConst[]);
int64_t js_array_length(JSContext*, JSValueConst);

static inline ofs_len
offset_length_wrap(ofs_len ol, size_t size) {
  int64_t offset = WRAP(ol.ofs, size);

  size -= offset;

  return (ofs_len){
      offset,
      WRAP(ol.len, size),
  };
}

static inline void
offset_length_apply(ofs_len ol, ptr_len* buf) {
  buf->ptr += ol.ofs;
  int64_t remain = buf->len - ol.ofs;
  buf->len = MIN(remain, ol.len);
}

static inline int
js_index(JSContext* ctx, int64_t* pval, JSValueConst value) {
  int64_t ofs = 0;

  if(JS_ToInt64Ext(ctx, &ofs, value))
    return -1;

  if(pval)
    *pval = ofs;

  return 0;
}

static inline JSValue
js_newptr(JSContext* ctx, void* ptr) {
  intptr_t addr = (intptr_t)ptr;

  if(!addr)
    return JS_NULL;

  if((int64_t)addr == (int32_t)addr)
    return JS_NewInt32(ctx, addr);

  return JS_NewBigInt64(ctx, addr);
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

static inline int
js_ptr(JSContext* ctx, void* pptr, JSValueConst value) {
  void* p;

  if(!(p = js_ptrlen(ctx, NULL, value)))
    if(js_toptr(ctx, &p, value))
      return 1;

  if(pptr)
    *(void**)pptr = p;

  return 0;
}

/* Function.prototype, fetched the same way qjs-lws's js_function_prototype()
 * does (js-utils.c:9-15): a throwaway JS_NewCFunction exists only to read
 * its [[Prototype]] off of.
 */
static inline JSValue
js_function_prototype(JSContext* ctx) {
  JSValue fn = JS_NewCFunction(ctx, NULL, "", 0);
  JSValue proto = JS_GetPrototype(ctx, fn);
  JS_FreeValue(ctx, fn);
  return proto;
}

#endif /* defined(QJSFFI_JS_HELPERS_H) */
