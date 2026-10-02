#ifndef QJSFFI_C_STRING_H
#define QJSFFI_C_STRING_H

#include <quickjs.h>

/* CString: a C string at a pointer, decoded on demand.
 *
 *   const s = new CString(ptr[, byteOffset[, byteLength]]);
 *   s.ptr, s.length (bytes), s.toString()
 *
 * Without byteLength the string ends at the first NUL byte.
 */

/* `defaults`, if an object, also gets CString (the module's default export). */
int js_cstring_init(JSContext*, JSModuleDef*, JSValueConst defaults);

#endif /* defined(QJSFFI_C_STRING_H) */
