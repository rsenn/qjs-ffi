#ifndef QJSFFI_C_STRING_H
#define QJSFFI_C_STRING_H

#include <quickjs.h>

/* CString: the C string at a pointer, as a JavaScript string (bun:ffi's).
 *
 *   const s = CString(ptr[, byteOffset[, byteLength]]);   // or new CString(...)
 *
 * NULL gives "". Without byteLength the string ends at the first NUL byte.
 */

/* `defaults`, if an object, also gets CString (the module's default export). */
int js_cstring_init(JSContext*, JSModuleDef*, JSValueConst defaults);

#endif /* defined(QJSFFI_C_STRING_H) */
