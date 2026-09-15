#include "js-helpers.h"
#include <cutils.h>
#include <alloca.h>

int
js_toptr(JSContext* ctx, void* pptr, JSValueConst value) {
  int64_t addr;

  if(JS_IsNull(value))
    addr = 0;
  else if(JS_ToInt64Ext(ctx, &addr, value)) {
    JS_ThrowTypeError(ctx, "value must be null, Number, BigInt or something convertible");
    return 1;
  }

  if(pptr)
    *(void**)pptr = (void*)(intptr_t)addr;

  return 0;
}

int
js_offsetlength(JSContext* ctx, ofs_len* out, int argc, JSValueConst argv[]) {
  ofs_len ol = {0, INT64_MAX};
  int i = 0;

  if(i < argc && !js_index(ctx, &ol.ofs, argv[i]))
    if(++i < argc && !js_index(ctx, &ol.len, argv[i]))
      i++;

  if(out)
    *out = ol;

  return i;
}

int
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

int
js_buf_arguments(JSContext* ctx, ptr_len* pbuf, int argc, JSValueConst argv[]) {
  int i = 1;

  if((pbuf->ptr = js_ptrlen(ctx, &pbuf->len, argv[0]))) {
    ofs_len ol;

    if((i += js_offsetlength(ctx, &ol, argc - i, argv + i)) > 0) {
      ol = offset_length_wrap(ol, pbuf->len);
      offset_length_apply(ol, pbuf);
    }
  } else if(argc > 1 && !js_ptr(ctx, &pbuf->ptr, argv[0])) {
    int64_t n;

    if(js_index(ctx, &n, argv[1]))
      return 0;

    pbuf->len = n;
  } else {
    return 0;
  }

  return i;
}

int64_t
js_array_length(JSContext* ctx, JSValueConst obj) {
  int64_t len = -1;
  JSValue val = JS_GetPropertyStr(ctx, obj, "length");
  JS_ToInt64(ctx, &len, val);
  JS_FreeValue(ctx, val);
  return len;
}
