/**********************************************************************
 *                                                                    *
 * ffi.c                                                              *
 *                                                                    *
 * Copyright (c) 2020 Fred Weigel                                     *
 * Fred Weigel                                                        *
 *                                                                    *
 * Permission is hereby granted, free of charge, to any person        *
 * obtaining a copy of this software and associated documentation     *
 * files (the "Software"), to deal in the Software without            *
 * restriction, including without limitation the rights to use,       *
 * copy, modify, merge, publish, distribute, sublicense, and/or sell  *
 * copies of the Software, and to permit persons to whom the          *
 * Software is furnished to do so, subject to the following           *
 * conditions:                                                        *
 *                                                                    *
 * The above copyright notice and this permission notice shall be     *
 * included in all copies or substantial portions of the Software.    *
 *                                                                    *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,    *
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES    *
 * OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND           *
 * NONINFRINGEMENT.  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT       *
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,       *
 * WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING       *
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR      *
 * OTHER DEALINGS IN THE SOFTWARE.                                    *
 *                                                                    *
 ********************************************************************* */

#define _GNU_SOURCE
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <ffi.h>
#include <dlfcn.h>

#include <quickjs.h>
#include <cutils.h>

#include "js-helpers.h"

#define countof(x) (sizeof(x) / sizeof((x)[0]))

struct function_s {
  struct function_s* next;
  char* name;
  void* fp;
  int nargs;
  ffi_cif cif;
  ffi_type** args;
  struct ffi_type_s* rtype;
};

#define TYPE_INTEGRAL 0
#define TYPE_FLOAT 1
#define TYPE_POINTER 2

struct ffi_type_s {
  struct ffi_type_s* next;
  char* name;
  ffi_type* type;
};

union argument_s {
  long long ll;
  long double ld;
  float f;
  double d;
  void* p;
};
typedef union argument_s argument;

struct typed_argument_s {
  argument arg;
  int type;
};
typedef struct typed_argument_s typed_argument;

#include "js-callback.h"
#include "c-function.h"
#include "ffi-type.h"

/* FFI types */
static struct ffi_type_s* ffi_type_head = NULL;

static void
fatal(const char* msg) {
  fprintf(stderr, "%s\n", msg);
  exit(2);
}

static void
warn(const char* msg) {
  fprintf(stderr, "%s\n", msg);
}

/* Find type by name */
static ffi_type*
find_ffi_type(const char* name) {
  struct ffi_type_s* p = NULL;

  if(name == NULL)
    return NULL;

  for(p = ffi_type_head; p; p = p->next)
    if(strcmp(p->name, name) == 0)
      return p->type;

  return NULL;
}

/* Find type by name */
static struct ffi_type_s*
find_type(const char* name) {
  struct ffi_type_s* p = NULL;

  if(name == NULL)
    return NULL;

  for(p = ffi_type_head; p; p = p->next)
    if(strcmp(p->name, name) == 0)
      return p;

  return NULL;
}

/* Add new ffi_type to named types */
static void
define_ffi_type(const char* name, ffi_type* t) {
  struct ffi_type_s* p = NULL;

  /* ignore if already defined */
  if(find_ffi_type(name) != NULL)
    return;

  if(!(p = malloc(sizeof(struct ffi_type_s))))
    fatal("define_ffi_type: no memory");

  p->name = strdup(name);
  p->next = ffi_type_head;
  ffi_type_head = p;
  p->type = t;
}

/* Define standard types. */
static void
define_types(void) {

  /* Standard ffi types */

  define_ffi_type("void", &ffi_type_void);
  define_ffi_type("sint8", &ffi_type_sint8);
  define_ffi_type("sint16", &ffi_type_sint16);
  define_ffi_type("sint32", &ffi_type_sint32);
  define_ffi_type("sint64", &ffi_type_sint64);
  define_ffi_type("uint8", &ffi_type_uint8);
  define_ffi_type("uint16", &ffi_type_uint16);
  define_ffi_type("uint32", &ffi_type_uint32);
  define_ffi_type("uint64", &ffi_type_uint64);
  define_ffi_type("float", &ffi_type_float);
  define_ffi_type("double", &ffi_type_double);
  define_ffi_type("schar", &ffi_type_schar);
  define_ffi_type("uchar", &ffi_type_uchar);
  define_ffi_type("sshort", &ffi_type_sshort);
  define_ffi_type("ushort", &ffi_type_ushort);
  define_ffi_type("sint", &ffi_type_sint);
  define_ffi_type("uint", &ffi_type_uint);
  define_ffi_type("slong", &ffi_type_slong);
  define_ffi_type("ulong", &ffi_type_ulong);
  define_ffi_type("longdouble", &ffi_type_longdouble);
  define_ffi_type("pointer", &ffi_type_pointer);

  /* Closer to C types. Could do these dynamically (YAGNI,
   * we support minimal number of platforms - 64 bit Linux
   * and 64 bit Windows, so any variation will be handled via
   * preprocessor)
   */
  define_ffi_type("int", &ffi_type_sint);
  define_ffi_type("long", &ffi_type_slong);
  define_ffi_type("short", &ffi_type_sshort);
  define_ffi_type("char", &ffi_type_schar);
  define_ffi_type("size_t", &ffi_type_uint);
  define_ffi_type("unsigned char", &ffi_type_uchar);
  define_ffi_type("unsigned int", &ffi_type_uint);
  define_ffi_type("unsigned long", &ffi_type_ulong);
  define_ffi_type("void *", &ffi_type_pointer);
  define_ffi_type("char *", &ffi_type_pointer);

  /* Extra types with more semantics. For now, the semantics are
   * automatic in fficall, but we can use a name in ffidefine to
   * show the intention. string is for JavaScript strings. buffer
   * is for JavaScript ArrayBuffers.
   */
  define_ffi_type("string", &ffi_type_pointer);
  define_ffi_type("buffer", &ffi_type_pointer);

  define_ffi_type("callback", &ffi_type_pointer);
  define_ffi_type("opaque*", &ffi_type_pointer);
}

/* Defined functions */
static struct function_s* function_list = NULL;

static int
dummy_() {
  warn("dummy function in ffi");
  return 0;
}

/* Build function ffi */
static BOOL
define_function(const char* name, void* fp, const char* abi, const char* rtype, const char** args) {

  struct function_s* f = NULL;
  int i = 0;
  char* s = NULL;

  /* We need a name */

  if(name == NULL) {
    warn("define_function: no name");
    return FALSE;
  }

  /* If function is already defined, just return */

  for(f = function_list; f; f = f->next)
    if(strcmp(f->name, name) == 0)
      return TRUE;

  if(!(f = malloc(sizeof(struct function_s))))
    fatal("define_function: no memory for function_s");

  f->name = NULL;
  f->args = NULL;

  if(!(f->name = strdup(name)))
    fatal("define_function: no memory for name");

  /* If fp is not supplied, a dummy function will be used. This is
   * probably not something you want, but is useful when
   * prototyping.
   */
  if(!(f->fp = fp))
    f->fp = dummy_;

  /* If abi is not supplied, use "default" */

  if(abi == NULL)
    abi = "default";

  /* Number of arguments (nargs). */

  for(f->nargs = 0; args && args[f->nargs]; ++f->nargs)
    ;

  /* Initialize argument types */

  f->args = NULL;

  if(f->nargs) {
    if(args == NULL) {
      warn("define_function: no args");
      goto error;
    }

    ;
    if(!(f->args = malloc(f->nargs * sizeof(ffi_type*))))
      fatal("define_function: cannot alloc args");
  }

  /* Return type. Default to "void" */

  if(rtype == NULL)
    rtype = "void";

  /* Read each argument type. Record each type in f->args[]. */

  for(i = 0; i < f->nargs; ++i) {
    s = (char*)args[i];

    if((f->args[i] = find_ffi_type(s)) == NULL) {
      warn("define_function: no such type");
      goto error;
    }
  }

  /* Record return type */

  ;
  if(!(f->rtype = find_type(rtype))) {
    warn("define_function: no such return type");
    goto error;
  }

  /* Prepare cif. Add prepared function to function list and return TRUE. */
  if(ffi_prep_cif(&(f->cif), ffi_resolve_abi(abi), f->nargs, f->rtype->type, f->args) == FFI_OK) {
    f->next = function_list;
    function_list = f;
    return TRUE;
  }
  warn("define_function: ffi_prep_cif failed");

  /* On failure, return memory. */

error:
  free(f->args);
  free(f->name);
  free(f);
  return FALSE;
}

/* We assume little-endian, which means that assigning into "long long"
 * is sufficient to produce data that can be pointed to for char to
 * long long (and unsigned). So, we map all types into 3 types here.
 * 0 for integral, 1 for float, 2 for pointer.
 *
 * For big-endian (or other endian) this will have to be suitably
 * adjusted. Only call_function() is affected.
 */

/* Call function previously defined
 *
 * Note that varargs are not yet supported. A custom function needs
 * to be built. But, we don't yet support deleting a defined function,
 * so varargs are not usable. Also, pass by structure is not supported.
 *
 * These restrictions could be lifted, but YAGNI. FIXME - we can call
 * a vararg, passing the parameter list itself. This would allow most
 * vprintf() etc (passing va_list ap). Structures should be passed by
 * value by defining the size of the structure, and passing a pointer
 * to the value. Structure return should work the same. For return,
 * the caller should supply a suitable area of memory. This should be
 * passed in as the rp parameter. Structures need definition
 * (define_structure(name, size)).
 *
 * All return values are captured into long double -- this must be
 * cast into the actual return.
 */
static BOOL
call_function(const char* name, typed_argument* args, JSContext* ctx, JSValue* rp) {
  struct function_s* f = NULL;
  int i = 0;
  void** ptrs = NULL;
  void** pointer_list = NULL;
  int pl = 0;
  argument* arguments = NULL;
  argument rc;
  JSValue r = JS_UNDEFINED;
  BOOL rv = FALSE;

  if(name == NULL) {
    warn("call_function: no name");
    goto error;
  }
  for(f = function_list; f; f = f->next)
    if(strcmp(f->name, name) == 0)
      break;
  if(f == NULL) {
    warn("call_function: no such function");
    goto error;
  }

  if(f->nargs) {
    ptrs = malloc(f->nargs * sizeof(void*));
    if(ptrs == NULL)
      fatal("call_function: no memory for ptrs");
    pointer_list = malloc(f->nargs * sizeof(void*));
    if(pointer_list == NULL)
      fatal("call_function: no memory for pointer_list");
    arguments = malloc(f->nargs * sizeof(argument));
    if(arguments == NULL)
      fatal("call_function: no memory for arguments");
    if(args == NULL) {
      warn("call_function: nargs >= 1 but no args");
      goto error;
    }
  }

  /* initialize arguments, pointer_list and ptrs */

  pl = 0;

  for(i = 0; i < f->nargs; ++i) {
    arguments[i].p = NULL;
    pointer_list[i] = NULL;
    ptrs[i] = &(arguments[i]);
  }

  for(i = 0; i < f->nargs; ++i) {
    switch(args[i].type) {

      case TYPE_INTEGRAL:
        if(f->args[i] == &ffi_type_float)
          arguments[i].f = (float)args[i].arg.ll;

        else if(f->args[i] == &ffi_type_double)
          arguments[i].d = (double)args[i].arg.ll;

        else if(f->args[i] == &ffi_type_longdouble)
          arguments[i].ld = (long double)args[i].arg.ll;

        else if(f->args[i] == &ffi_type_pointer) {
          pointer_list[pl++] = (void*)(ptrdiff_t)args[i].arg.ll;
          ptrs[i] = &(pointer_list[pl - 1]);

        } else
          /* This absorbs all ffi_type integral */
          arguments[i].ll = (long long)args[i].arg.ll;
        break;

      case TYPE_FLOAT:
        if(f->args[i] == &ffi_type_float)
          arguments[i].f = (float)args[i].arg.ld;

        else if(f->args[i] == &ffi_type_double)
          arguments[i].d = (double)args[i].arg.ld;

        else if(f->args[i] == &ffi_type_longdouble)
          arguments[i].ld = (long double)args[i].arg.ld;

        else if(f->args[i] == &ffi_type_pointer) {
          ptrdiff_t t = (ptrdiff_t)args[i].arg.ld;
          pointer_list[pl++] = (void*)t;
          ptrs[i] = &(pointer_list[pl - 1]);

        } else
          arguments[i].ll = (long long)args[i].arg.ld;

        break;

      case TYPE_POINTER:
        pointer_list[pl++] = args[i].arg.p;
        ptrs[i] = &(pointer_list[pl - 1]);
        break;

      default: warn("call_function: error, unknown typed parameter"); goto error;
    }
  }

  /* call the function */

  ffi_call(&(f->cif), f->fp, &rc, ptrs);

  /* result - simple conversion to float
   *
   * Underlying code assumes that everything is compatible with
   * long double -- but classic JavaScript uses double. This gives
   * us 53 (or 52) bits for integer results -- pray that all
   * pointers fit in 52 bits. This is a reasonable assumption in
   * 2020.
   */
  if(f->rtype->type == &ffi_type_void)
    r = JS_NewFloat64(ctx, 0);
  else if(f->rtype->type == &ffi_type_float)
    r = JS_NewFloat64(ctx, rc.f);
  else if(f->rtype->type == &ffi_type_double)
    r = JS_NewFloat64(ctx, rc.d);
  else if(f->rtype->type == &ffi_type_longdouble)
    r = JS_NewFloat64(ctx, rc.ld);
  else if(f->rtype->type == &ffi_type_pointer) {
    if(!strcmp(f->rtype->name, "string") || !strcmp(f->rtype->name, "char *"))
      r = rc.p ? JS_NewString(ctx, rc.p) : JS_NULL;
    else
      r = JS_NewFloat64(ctx, (long double)(ptrdiff_t)rc.p);
  } else
    r = JS_NewFloat64(ctx, rc.ll);

  if(rp)
    *rp = r;
  rv = TRUE;

error:
  if(ptrs)
    free(ptrs);
  if(pointer_list)
    free(pointer_list);
  if(arguments)
    free(arguments);
  return rv;
}

/* debug() */
static JSValue
js_debug(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  return JS_NULL;
}

/* errno() */
static JSValue
js_errno(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  return JS_NewInt32(ctx, errno);
}

static JSValue js_dlopen_symbols(JSContext*, JSValueConst path_val, JSValueConst symbol_specs);

/* h = dlopen(name, flags)
 * { symbols, close() } = dlopen(name, symbolSpecs) -- bun-shaped overload,
 * picked when argv[1] is an object rather than a number (TODO.md Phase 2).
 */
static JSValue
js_dlopen(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  const char* s;
  uint32_t n;

  if(argc > 1 && JS_IsObject(argv[1]))
    return js_dlopen_symbols(ctx, argv[0], argv[1]);

  if(JS_IsNull(argv[0]))
    s = NULL;
  else if(!(s = JS_ToCString(ctx, argv[0])))
    return JS_EXCEPTION;

  if(JS_ToUint32(ctx, &n, argv[1]))
    return JS_EXCEPTION;

  void* res = dlopen(s, n);

  if(s)
    JS_FreeCString(ctx, s);

  if(res == NULL)
    return JS_NULL;

  return js_newptr(ctx, res);
}

/* s = dlerror() */
static JSValue
js_dlerror(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  char* res = dlerror();

  return res ? JS_NewString(ctx, res) : JS_NULL;
}

/* n = dlclose(h) */
static JSValue
js_dlclose(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  void* ptr;

  if(js_toptr(ctx, &ptr, argv[0]))
    return JS_EXCEPTION;

  if(ptr == NULL)
    return JS_ThrowTypeError(ctx, "argument 1 must be a non-NULL pointer");

  return JS_NewInt32(ctx, dlclose(ptr));
}

/* p = dlsym(h, name) */
static JSValue
js_dlsym(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  void* ptr;
  const char* s;

  if(js_toptr(ctx, &ptr, argv[0]))
    return JS_EXCEPTION;

  if(!(s = JS_ToCString(ctx, argv[1])))
    return JS_EXCEPTION;

  void* res = dlsym(ptr, s);

  if(s)
    JS_FreeCString(ctx, s);

  if(res == NULL)
    return JS_NULL;

  return js_newptr(ctx, res);
}

/* n = dlopen(path, symbolSpecs).close() -- frees the dlopen() handle, passed
 * through js_function_cclosure()'s `opaque` (see js-helpers.c/.h) rather
 * than boxed into a func_data JSValue. */
static JSValue
js_dlopen_symbols_close(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[], int magic, JSValueConst data[]) {
  void* ptr;
  JSValue ret = JS_UNDEFINED;

  if(JS_IsUndefined(data[0]))
    return JS_NewInt32(ctx, 0);

  if(!js_toptr(ctx, &ptr, data[0]))
    ret = JS_NewInt32(ctx, dlclose(ptr));

  JS_FreeValue(ctx, data[0]);
  data[0] = JS_UNDEFINED;
  return ret;
}

/* { symbols, close() } = dlopen(path, symbolSpecs) -- bun-shaped overload,
 * dispatched to from js_dlopen() when argv[1] is an object rather than a
 * flags number (TODO.md Phase 2). Opens the library, dlsym()s each key in
 * symbolSpecs, and wraps each as a CFunction (see doc/c-function.md) --
 * no name-keyed registry, no strcmp scan at call time.
 */
static JSValue
js_dlopen_symbols(JSContext* ctx, JSValueConst path_val, JSValueConst symbol_specs) {
  const char* path = NULL;
  uint32_t i, len = 0;

  if(JS_IsNull(path_val))
    path = NULL;
  else if(!(path = JS_ToCString(ctx, path_val)))
    return JS_EXCEPTION;

  void* handle = dlopen(path, RTLD_NOW);

  if(path)
    JS_FreeCString(ctx, path);

  if(!handle)
    return JS_ThrowTypeError(ctx, "dlopen: %s", dlerror());

  JSPropertyEnum* tab = NULL;

  if(JS_GetOwnPropertyNames(ctx, &tab, &len, symbol_specs, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY)) {
    dlclose(handle);
    return JS_EXCEPTION;
  }

  JSValue symbols = JS_NewObject(ctx);

  for(i = 0; i < len; i++) {
    const char* name = JS_AtomToCString(ctx, tab[i].atom);
    void* fp;

    if(!name)
      goto fail;

    if(!(fp = dlsym(handle, name))) {
      JS_ThrowTypeError(ctx, "dlopen: symbol not found: %s", name);
      JS_FreeCString(ctx, name);
      goto fail;
    }

    JSValue spec = JS_GetPropertyStr(ctx, symbol_specs, name);
    JS_FreeCString(ctx, name);

    if(JS_IsException(spec))
      goto fail;

    JSValue fn = js_cfunction_create(ctx, fp, spec);
    JS_FreeValue(ctx, spec);

    if(JS_IsException(fn))
      goto fail;

    /* JS_DefinePropertyValue() does not consume `prop` -- the shape's own
     * property table dups its own atom reference internally (see
     * add_shape_property() in quickjs.c) -- so this atom is still ours to
     * free right here, same as every other path out of this loop body. */
    JS_DefinePropertyValue(ctx, symbols, tab[i].atom, fn, JS_PROP_C_W_E);
    JS_FreeAtom(ctx, tab[i].atom);
  }

  js_free(ctx, tab);

  JSValue close_data = js_newptr(ctx, handle);
  JSValue close_fn = JS_NewCFunctionData(ctx, js_dlopen_symbols_close, 0, 0, 1, &close_data);
  JS_FreeValue(ctx, close_data);

  JSValue result = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, result, "symbols", symbols);
  JS_SetPropertyStr(ctx, result, "close", close_fn);
  return result;

fail:
  for(; i < len; i++)
    JS_FreeAtom(ctx, tab[i].atom);

  js_free(ctx, tab);
  JS_FreeValue(ctx, symbols);
  dlclose(handle);
  return JS_EXCEPTION;
}

#define MAX_PARAMETERS 30

/* define(name, fp, abi, ret, p1,...pn) */
static JSValue
js_define(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  const char *name, *abi = NULL, *rtype = NULL;
  void* fp = 0;
  int nparams = 0;
  JSValue r = JS_EXCEPTION;

  if(!(name = JS_ToCString(ctx, argv[0])))
    goto error;

  if(js_toptr(ctx, &fp, argv[1]))
    goto error;

  if(fp == NULL) {
    JS_ThrowTypeError(ctx, "argument 2 must be a pointer that is not NULL");
    goto error;
  }

  if(JS_IsNull(argv[2]))
    abi = NULL;
  else if(!(abi = JS_ToCString(ctx, argv[2])))
    goto error;

  if(!(rtype = JS_ToCString(ctx, argv[3])))
    goto error;

  const char* params[MAX_PARAMETERS + 1];

  for(int i = 4; (i < argc) && (nparams < MAX_PARAMETERS); ++i)
    params[nparams++] = JS_ToCString(ctx, argv[i]);

  params[nparams] = NULL;

  r = define_function(name, fp, abi, rtype, params) ? JS_TRUE : JS_FALSE;

error:
  if(name)
    JS_FreeCString(ctx, name);
  if(rtype)
    JS_FreeCString(ctx, rtype);
  if(abi)
    JS_FreeCString(ctx, abi);
  for(int i = 0; i < nparams; ++i)
    JS_FreeCString(ctx, params[i]);

  return r;
}

/* For 2020-01-19 support */
static inline JS_BOOL
JS_IsInteger(JSValueConst v) {
  int tag = JS_VALUE_GET_TAG(v);
  return tag == JS_TAG_INT || tag == JS_TAG_BIG_INT;
}

/* r = call(name, p1,...pn) */
static JSValue
js_call(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  const char* name = NULL;
  JSValue r = JS_EXCEPTION;
  typed_argument args[MAX_PARAMETERS];
  const char* strings[MAX_PARAMETERS];
  int fl = 0;
  JSCallback* closure;

  if(!(name = JS_ToCString(ctx, argv[0])))
    goto error;

  for(int i = 0; i < MAX_PARAMETERS; ++i) {
    args[i].arg.ll = 0;
    args[i].type = TYPE_INTEGRAL;
  }

  for(int i = 1; (i < argc) && (i <= MAX_PARAMETERS); ++i) {
    if(JS_IsNull(argv[i])) {
      ;
    } else if(JS_IsBool(argv[i])) {
      args[i - 1].arg.ll = JS_ToBool(ctx, argv[i]);

      if(args[i - 1].arg.ll < 0)
        goto error;
    } else if(JS_IsInteger(argv[i]) || JS_IsBigInt(ctx, argv[i])) {
      int64_t v;

      if(JS_ToInt64Ext(ctx, &v, argv[i]))
        goto error;
      args[i - 1].arg.ll = v;
    } else if(JS_IsNumber(argv[i])) {
      double d;

      if(JS_ToFloat64(ctx, &d, argv[i]))
        goto error;

      args[i - 1].arg.ld = (long double)d;
      args[i - 1].type = TYPE_FLOAT;
    } else if(JS_IsString(argv[i])) {
      const char* s;

      if(!(s = JS_ToCString(ctx, argv[i])))
        goto error;

      strings[fl++] = s;
      args[i - 1].arg.ll = (ptrdiff_t)s;
    } else if((closure = js_callback_data(argv[i]))) {

      args[i - 1].arg.ll = (ptrdiff_t)closure->code;
      args[i - 1].type = TYPE_POINTER;
    } else {
      ptr_len buf;

      if(js_buf(ctx, &buf, argv[i]))
        goto error;

      args[i - 1].arg.ll = (ptrdiff_t)buf.ptr;
    }
  }

  if(!call_function(name, args, ctx, &r))
    r = JS_EXCEPTION;

error:
  if(name)
    JS_FreeCString(ctx, name);

  while(fl)
    JS_FreeCString(ctx, strings[--fl]);

  return r;
}

/* s = toString(BUF[, ofs, len] or PTR[, len]) */
static JSValue
js_tostring(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  ptr_len buf;

  if(!js_buf_arguments(ctx, &buf, argc, argv)) {
    ofs_len ol = {0, INT64_MAX};

    if(!js_offsetlength(ctx, &ol, argc, argv))
      return JS_ThrowTypeError(ctx, "argument 1 must be ArrayBuffer|Number|string");

    buf.ptr = (void*)(ptrdiff_t)ol.ofs;
    buf.len = argc == 1 || ol.len == INT64_MAX ? SIZE_MAX : ol.len;
  }

  const char* str = (const char*)buf.ptr;

  return str ? (buf.len != SIZE_MAX && buf.len < INT64_MAX) ? JS_NewStringLen(ctx, str, buf.len) : JS_NewString(ctx, str) : JS_NULL;
}

static void
free_objptr(JSRuntime* rt, void* opaque, void* ptr) {
  if(opaque) {
    JSValue buf = JS_MKPTR(JS_TAG_OBJECT, opaque);
    JS_FreeValueRT(rt, buf);
  }
}

/* b = toArrayBuffer(ArrayBuffer|Number|string[, size]) */
static JSValue
js_toarraybuffer(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  ptr_len buf = {0, SIZE_MAX};
  void* opaque = 0;
  int copy = -1;

  if(argc > 0 && JS_IsBool(argv[argc - 1])) {
    copy = JS_ToBool(ctx, argv[argc - 1]);
    argc--;
  }

  if(!js_buf(ctx, &buf, argv[0])) {
    if(!copy)
      opaque = JS_VALUE_GET_PTR(JS_DupValue(ctx, argv[0]));
  } else if(copy == -1 && JS_IsString(argv[0])) {
    buf.ptr = (uint8_t*)JS_ToCStringLen(ctx, &buf.len, argv[0]);
    copy = TRUE;
  } else {
    if(js_ptr(ctx, &buf.ptr, argv[0]))
      return JS_EXCEPTION;
  }

  if(argc > 1) {
    int64_t len;

    if(js_index(ctx, &len, argv[1]))
      return JS_EXCEPTION;

    if(buf.len) {
      len = WRAP(len, buf.len);
      len = CLAMP(len, 0, buf.len);
    }

    buf.len = len;
  }

  return copy ? JS_NewArrayBufferCopy(ctx, buf.ptr, buf.len) : JS_NewArrayBuffer(ctx, buf.ptr, buf.len, &free_objptr, opaque, FALSE);
}

/* s = toPointer(ArrayBuffer[, offset])
 *
 * returns string 0xAABBCCDD which is the base of the ArrayBuffer
 * plus an optional offset. A negative offset can be used,
 * indicating an offset from the end of the buffer.
 */
static JSValue
js_topointer(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  uint8_t* ptr = NULL;

  if(js_ptr(ctx, &ptr, argv[0]))
    return JS_EXCEPTION;

  if(argc > 1) {
    int64_t ofs = 0;

    if(!js_index(ctx, &ofs, argv[1]))
      ptr += ofs;
  }

  char str[64];
  snprintf(str, sizeof(str), ptr ? "%p" : "0", ptr);
  return JS_NewString(ctx, str);
}

/* p = JSContext() */
static JSValue
js_context(JSContext* ctx, JSValueConst this_val, int argc, JSValueConst argv[]) {
  return js_newptr(ctx, ctx);
}

static const JSCFunctionListEntry js_funcs[] = {
    JS_CFUNC_DEF("debug", 0, js_debug),
    JS_CFUNC_DEF("dlopen", 2, js_dlopen),
    JS_CFUNC_DEF("dlerror", 0, js_dlerror),
    JS_CFUNC_DEF("dlclose", 1, js_dlclose),
    JS_CFUNC_DEF("dlsym", 2, js_dlsym),
    JS_CFUNC_DEF("define", 4, js_define),
    JS_CFUNC_DEF("call", 1, js_call),
    JS_CFUNC_DEF("toString", 1, js_tostring),
    JS_CFUNC_DEF("toArrayBuffer", 2, js_toarraybuffer),
    JS_CFUNC_DEF("toPointer", 1, js_topointer),
    JS_CFUNC_DEF("errno", 0, js_errno),
    JS_CFUNC_DEF("JSContext", 0, js_context),
#ifdef RTLD_LAZY
    JS_PROP_INT32_DEF("RTLD_LAZY", RTLD_LAZY, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_NOW
    JS_PROP_INT32_DEF("RTLD_NOW", RTLD_NOW, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_GLOBAL
    JS_PROP_INT32_DEF("RTLD_GLOBAL", RTLD_GLOBAL, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_LOCAL
    JS_PROP_INT32_DEF("RTLD_LOCAL", RTLD_LOCAL, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_NODELETE
    JS_PROP_INT32_DEF("RTLD_NODELETE", RTLD_NODELETE, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_NOLOAD
    JS_PROP_INT32_DEF("RTLD_NOLOAD", RTLD_NOLOAD, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_DEEPBIND
    JS_PROP_INT32_DEF("RTLD_DEEPBIND", RTLD_DEEPBIND, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_DEFAULT
    JS_PROP_INT64_DEF("RTLD_DEFAULT", (ptrdiff_t)RTLD_DEFAULT, JS_PROP_CONFIGURABLE),
#endif
#ifdef RTLD_NEXT
    JS_PROP_INT64_DEF("RTLD_NEXT", (ptrdiff_t)RTLD_NEXT, JS_PROP_CONFIGURABLE),
#endif
    JS_PROP_INT32_DEF("pointerSize", sizeof(void*), JS_PROP_CONFIGURABLE),
    JS_OBJECT_DEF("FFIType", js_ffitype_funcs, FFI_TYPE_COUNT, JS_PROP_CONFIGURABLE),
};

static int
js_init(JSContext* ctx, JSModuleDef* m) {
  js_callback_init(ctx, m);
  js_cfunction_init(ctx, m);

  define_types();
  return JS_SetModuleExportList(ctx, m, js_funcs, countof(js_funcs));
}

#ifdef JS_SHARED_LIBRARY
#define JS_INIT_MODULE js_init_module
#else
#define JS_INIT_MODULE js_init_module_ffi
#endif

JSModuleDef*
JS_INIT_MODULE(JSContext* ctx, const char* module_name) {
  JSModuleDef* m;

  if(!(m = JS_NewCModule(ctx, module_name, js_init)))
    return NULL;

  JS_AddModuleExport(ctx, m, "JSCallback");
  JS_AddModuleExport(ctx, m, "CFunction");
  JS_AddModuleExportList(ctx, m, js_funcs, countof(js_funcs));
  return m;
}

/* ce: .mc; */
