#include "c-string.h"
#include "js-helpers.h"
#include <cutils.h>
#include <string.h>

#define countof(x) (sizeof(x) / sizeof((x)[0]))

typedef struct {
  const char* ptr;
  size_t len;
} CStringData;

static JSClassID js_cstring_class_id;

static void
js_cstring_finalizer(JSRuntime* rt, JSValue val) {
  CStringData* cs;

  if((cs = JS_GetOpaque(val, js_cstring_class_id)))
    js_free_rt(rt, cs);
}

static JSClassDef js_cstring_class = {
    .class_name = "CString",
    .finalizer = js_cstring_finalizer,
};

static size_t
js_cstring_length(const CStringData* cs) {
  return cs->len != SIZE_MAX ? cs->len : cs->ptr ? strlen(cs->ptr) : 0;
}

/* s = new CString(ptr[, byteOffset[, byteLength]]) */
static JSValue
js_cstring_constructor(JSContext* ctx, JSValueConst new_target, int argc, JSValueConst argv[]) {
  CStringData* cs;
  uint8_t* p = NULL;
  int64_t ofs = 0, len = -1;
  JSValue proto, obj;

  if(argc < 1 || js_ptr(ctx, &p, argv[0]))
    return JS_ThrowTypeError(ctx, "CString: argument 1 must be a pointer");

  if(argc > 1 && js_index(ctx, &ofs, argv[1]))
    return JS_EXCEPTION;

  if(argc > 2 && js_index(ctx, &len, argv[2]))
    return JS_EXCEPTION;

  proto = JS_GetPropertyStr(ctx, new_target, "prototype");
  obj = JS_NewObjectProtoClass(ctx, proto, js_cstring_class_id);
  JS_FreeValue(ctx, proto);

  if(JS_IsException(obj))
    return obj;

  if(!(cs = js_malloc(ctx, sizeof(CStringData)))) {
    JS_FreeValue(ctx, obj);
    return JS_EXCEPTION;
  }

  cs->ptr = (const char*)(p + ofs);
  cs->len = len < 0 ? SIZE_MAX : (size_t)len;
  JS_SetOpaque(obj, cs);
  return obj;
}

static JSValue
js_cstring_get(JSContext* ctx, JSValueConst this_val, int magic) {
  CStringData* cs;

  if(!(cs = JS_GetOpaque2(ctx, this_val, js_cstring_class_id)))
    return JS_EXCEPTION;

  switch(magic) {
    case 0: return js_newptr(ctx, (void*)cs->ptr);
    case 1: return JS_NewInt64(ctx, js_cstring_length(cs));
  }

  return JS_UNDEFINED;
}

static JSValue
js_cstring_tostring(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  CStringData* cs;

  if(!(cs = JS_GetOpaque2(ctx, this_val, js_cstring_class_id)))
    return JS_EXCEPTION;

  return cs->ptr ? JS_NewStringLen(ctx, cs->ptr, js_cstring_length(cs)) : JS_NULL;
}

static const JSCFunctionListEntry js_cstring_proto_funcs[] = {
    JS_CGETSET_MAGIC_DEF("ptr", js_cstring_get, 0, 0),
    JS_CGETSET_MAGIC_DEF("length", js_cstring_get, 0, 1),
    JS_CFUNC_DEF("toString", 0, js_cstring_tostring),
};

int
js_cstring_init(JSContext* ctx, JSModuleDef* m, JSValueConst defaults) {
  JS_NewClassID(&js_cstring_class_id);
  JS_NewClass(JS_GetRuntime(ctx), js_cstring_class_id, &js_cstring_class);

  JSValue proto = JS_NewObject(ctx);
  JS_SetPropertyFunctionList(ctx, proto, js_cstring_proto_funcs, countof(js_cstring_proto_funcs));

  JSValue ctor = JS_NewCFunction2(ctx, js_cstring_constructor, "CString", 1, JS_CFUNC_constructor, 0);
  JS_SetConstructor(ctx, ctor, proto);
  JS_SetClassProto(ctx, js_cstring_class_id, proto);

  if(JS_IsObject(defaults))
    JS_SetPropertyStr(ctx, defaults, "CString", JS_DupValue(ctx, ctor));

  if(m)
    JS_SetModuleExport(ctx, m, "CString", ctor);
  else
    JS_FreeValue(ctx, ctor);

  return 0;
}
