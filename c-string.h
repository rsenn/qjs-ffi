#ifndef QJSFFI_C_STRING_H
#define QJSFFI_C_STRING_H

#include <quickjs.h>

/* CString: the C string at a pointer, as a JS string (bun:ffi's).
 *
 * ```js
 * CString(ptr);        // up to the first NUL byte, decoded as UTF-8
 * CString(ptr, 4, 3);  // 3 bytes, starting at byte 4
 * new CString(ptr);    // the same as CString(ptr)
 * ```
 *
 *   number|bigint|buffer  ptr         NULL gives ""
 *   number|bigint         byteOffset  default 0
 *   number|bigint         byteLength  default up to the first NUL byte
 *
 *   throws  TypeError for a bad ptr, byteOffset or byteLength;
 *           RangeError for a negative byteLength
 */

/* exports CString from the module.
 *
 *   JSModuleDef*  m         receives the export; may be NULL
 *   JSValueConst  defaults  if an object, also gets CString (the
 *                           default export)
 */
int js_cstring_init(JSContext*, JSModuleDef*, JSValueConst defaults);

#endif /* defined(QJSFFI_C_STRING_H) */
