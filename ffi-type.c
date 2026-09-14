#include "ffi-type.h"

#define T(n) JS_PROP_STRING_DEF(n, n, JS_PROP_C_W_E)

const JSCFunctionListEntry js_ffitype_funcs[FFI_TYPE_COUNT] = {
    T("void"),
    T("bool"),
    T("i8"),
    T("u8"),
    T("i16"),
    T("u16"),
    T("i32"),
    T("u32"),
    T("i64"),
    T("u64"),
    T("i64_fast"),
    T("u64_fast"),
    T("f32"),
    T("f64"),
    T("pointer"),
    T("ptr"),
    T("function"),
    T("cstring"),
};

#undef T
