/* the FFIType names the ffi module knows (ffi-type.c) and their byte sizes:
 * the one table the generator works from. a pointer type is also any name
 * ending in '*'. */
export const FFI_SIZES = { bool: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, i64_fast: 8, u64_fast: 8, f32: 4, f64: 8, pointer: 8, ptr: 8, function: 8, cstring: 8 };

/* every FFIType name, "void" included. */
export const FFI_NAMES = new Set(['void', ...Object.keys(FFI_SIZES)]);

/* the scalars a struct member is, once scalarOf() has settled it. */
export const SIZES = Object.fromEntries(['bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64', 'f32', 'f64', 'pointer'].map(n => [n, FFI_SIZES[n]]));

/* true for an FFIType name or a "T *" pointer type. */
export function isFfiType(name) {
  return FFI_NAMES.has(name) || name.endsWith('*');
}

/* splits the array spelling of a C type.
 *
 * ```js
 * arrayDims("int[3][2]")  // { elem: "int", dims: [3, 2] }
 * arrayDims("int[]")      // { elem: "int", dims: [null] }
 * arrayDims("int")        // null
 * ```
 */
export function arrayDims(type) {
  const m = /^(.*?)\s*((?:\[\d*\])+)$/.exec(type);

  return m && { elem: m[1], dims: [...m[2].matchAll(/\[(\d*)\]/g)].map(d => (d[1] === '' ? null : Number(d[1]))) };
}

/* `T[3]`, `T[2][4]` -> { elem: "T", count: 12 }; null if a size is missing. */
export function arrayOf(type) {
  const a = arrayDims(type);

  return a && a.dims.every(d => d !== null) ? { elem: a.elem, count: a.dims.reduce((n, d) => n * d, 1) } : null;
}
