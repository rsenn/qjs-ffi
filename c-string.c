#include "c-string.h"
#include "js-helpers.h"
#include <cutils.h>
#include <string.h>

/* CString(ptr[, byteOffset[, byteLength]]), also with `new` as in bun:ffi.
 * returns a string, not an object: the bytes decoded as UTF-8. */
static JSValue
js_cstring_call(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  uint8_t* p = NULL;
  int64_t ofs = 0, len = -1;

  if(argc > 0 && js_to_pointer(ctx, (void**)&p, argv[0]))
    return JS_ThrowTypeError(ctx, "CString: argument 1 must be a pointer");

  if(argc > 1 && !JS_IsUndefined(argv[1]) && js_to_index(ctx, &ofs, argv[1]))
    return JS_ThrowTypeError(ctx, "CString: argument 2 must be BigInt | Number");

  if(argc > 2 && !JS_IsUndefined(argv[2])) {
    if(js_to_index(ctx, &len, argv[2]))
      return JS_ThrowTypeError(ctx, "CString: argument 3 must be BigInt | Number");

    if(len < 0)
      return JS_ThrowRangeError(ctx, "CString: byteLength must not be negative");
  }

  if(!p)
    return JS_NewString(ctx, "");

  p += ofs;
  return JS_NewStringLen(ctx, (const char*)p, len < 0 ? strlen((const char*)p) : (size_t)len);
}

int
js_cstring_init(JSContext* ctx, JSModuleDef* m, JSValueConst defaults) {
  JSValue fn = JS_NewCFunction2(ctx, js_cstring_call, "CString", 3, JS_CFUNC_constructor_or_func, 0);

  if(JS_IsObject(defaults))
    JS_SetPropertyStr(ctx, defaults, "CString", JS_DupValue(ctx, fn));

  if(m)
    JS_SetModuleExport(ctx, m, "CString", fn);
  else
    JS_FreeValue(ctx, fn);

  return 0;
}
