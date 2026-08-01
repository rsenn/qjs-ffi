#ifndef QJSFFI_OPAQUE_CALL_H
#define QJSFFI_OPAQUE_CALL_H

#include <quickjs.h>
#include <list.h>

typedef struct {
  struct list_head link;
  JSContext* ctx;
  JSValue func, this;
  int index;
} OpaqueCall;

int64_t opaque_call(void* arg);
OpaqueCall* opaque_new(JSContext*, JSValueConst);
void opaque_free(JSContext*, OpaqueCall*);

#endif /* defined(QJSFFI_OPAQUE_CALL_H) */
