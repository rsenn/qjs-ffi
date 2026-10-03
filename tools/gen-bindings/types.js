import { FFI_SIZES, arrayOf } from './ffi-types.js';
import { collectTypedefs, collectEnumIndex } from './ir.js';
import { bindable } from './emit/common.js';

export function normalizeType(s) {
  return s
    .replace(/\b(const|volatile|restrict)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Splits a FunctionDecl's own "ret (params...)" qualType into
 * { returnType }, matching the trailing ")" back to its own "(" by paren
 * depth so nested parens in parameter types (e.g. function pointers) don't
 * throw off the split. Parameter types themselves come from the node's own
 * ParmVarDecl children, not from re-parsing this string.
 */
export function splitFunctionType(qualType) {
  // A method's type carries trailing qualifiers: "double () const noexcept".
  let s = qualType.trim().replace(/\s*\b(noexcept|throw)\s*\([^()]*\)$/, '');
  let qualifiers = '';

  for(let m; (m = /\s*(\b(const|volatile|noexcept)|&&?)$/.exec(s)); ) {
    qualifiers = m[0] + qualifiers;
    s = s.slice(0, m.index);
  }

  if(!s.endsWith(')')) return null;

  let depth = 0;
  for(let i = s.length - 1; i >= 0; i--) {
    if(s[i] === ')') depth++;
    else if(s[i] === '(') {
      depth--;
      if(depth === 0) return { returnType: s.slice(0, i).trim(), isConst: /\bconst\b/.test(qualifiers) };
    }
  }
  return null;
}

const BASE_TYPES = {
  void: { cf: 'void' },
  _Bool: { cf: 'bool' },
  bool: { cf: 'bool' },
  char: { cf: 'i8' },
  'signed char': { cf: 'i8' },
  'unsigned char': { cf: 'u8' },
  short: { cf: 'i16' },
  'short int': { cf: 'i16' },
  'signed short': { cf: 'i16' },
  'signed short int': { cf: 'i16' },
  'unsigned short': { cf: 'u16' },
  'unsigned short int': { cf: 'u16' },
  int: { cf: 'i32' },
  signed: { cf: 'i32' },
  'signed int': { cf: 'i32' },
  unsigned: { cf: 'u32' },
  'unsigned int': { cf: 'u32' },
  long: { cf: 'i64' },
  'long int': { cf: 'i64' },
  'signed long': { cf: 'i64' },
  'signed long int': { cf: 'i64' },
  'unsigned long': { cf: 'u64' },
  'unsigned long int': { cf: 'u64' },
  'long long': { cf: 'i64' },
  'long long int': { cf: 'i64' },
  'signed long long': { cf: 'i64' },
  'signed long long int': { cf: 'i64' },
  'unsigned long long': { cf: 'u64' },
  'unsigned long long int': { cf: 'u64' },
  float: { cf: 'f32' },
  double: { cf: 'f64' },
  'long double': { cf: 'f64', size: 16 }, // f64 is lossy for long double

  // clang gives functions it recognizes as library builtins (strlen,
  // malloc, ...) synthetic return types spelled with these glibc-internal
  // names instead of the user-visible typedef (e.g. "__size_t" instead of
  // "size_t") -- and unlike ParmVarDecl, a FunctionDecl's own return type
  // never carries a desugaredQualType to resolve this the general way.
  // Fixed 64-bit-Linux-only set, consistent with the rest of this project.
  __int8_t: { cf: 'i8' },
  __uint8_t: { cf: 'u8' },
  __int16_t: { cf: 'i16' },
  __uint16_t: { cf: 'u16' },
  __int32_t: { cf: 'i32' },
  __uint32_t: { cf: 'u32' },
  __int64_t: { cf: 'i64' },
  __uint64_t: { cf: 'u64' },
  __size_t: { cf: 'u64' },
  __ssize_t: { cf: 'i64' },
  __off_t: { cf: 'i64' },
  __off64_t: { cf: 'i64' },
  __time_t: { cf: 'i64' },
  __clock_t: { cf: 'i64' },
  __pid_t: { cf: 'i32' },
  __uid_t: { cf: 'u32' },
  __gid_t: { cf: 'u32' },
  __mode_t: { cf: 'u32' },
  __socklen_t: { cf: 'u32' },
  __intptr_t: { cf: 'i64' },
  __uintptr_t: { cf: 'u64' },
};

/* Byte size of the C type `cType`, whose mapCType() result is `m`, from the
 * type alone (scalars, pointers, arrays of those), or null. Only a fallback
 * for what the layout probe could not size. */
export function sizeOfC(m, cType, typedefs, enumIndex) {
  const array = arrayOf(cType);

  if(array) {
    const elem = sizeOfC(mapCType(array.elem, typedefs, enumIndex), array.elem, typedefs, enumIndex);

    return elem === null ? null : elem * array.count;
  }

  if(!m.supported) return null;
  if(m.size) return m.size;
  return m.cf in FFI_SIZES ? FFI_SIZES[m.cf] : m.cf.endsWith('*') ? 8 : null;
}

/* The "T *" spelling the ffi module reads as a pointer type: the stars of
 * `t` (a normalized pointer type) joined, one space before them. */
function pointerName(t) {
  const m = /^(.*?)((?:\s*\*)+)$/.exec(t);

  return m[1].trim() + ' ' + m[2].replace(/\s+/g, '');
}

/* maps one C type (a return type, or one parameter) to an FFIType name.
 *
 * ```js
 * mapCType("unsigned char", {})  // { cf: "u8", supported: true }
 * mapCType("const char *", {})   // { cf: "cstring", supported: true }
 * mapCType("int[3]", {})         // { supported: false, reason: "..." }
 * ```
 *
 *   string  qualTypeRaw  the C type as clang spells it
 *   object  typedefs     name -> type, from collectTypedefs(): resolves
 *                        a typedef name that is still unresolved (clang
 *                        does not desugar a FunctionDecl's own type)
 *   object  enumIndex    from collectEnumIndex(): an enum type carries
 *                        its `enumId`, which finds the enums a signature
 *                        reaches
 *   number  depth        typedef recursion guard
 *   bool    byValue      a struct, or a name this cannot place, becomes
 *                        the provisional `struct NAME` with
 *                        `byValue: { name, reason }`; by-value.js settles
 *                        it once every record is known
 *
 *   returns  { cf, supported, reason?, enumId?, byValue?, size? }
 *
 * `cf` is the FFIType name; a pointer or reference is "T *", as any name
 * ending in '*' is a pointer to the ffi module. `size` is set where the
 * FFI type is narrower than the C one (long double: 16 bytes). unions,
 * arrays and varargs have no mapping. */
export function mapCType(qualTypeRaw, typedefs, enumIndex, depth, byValue) {
  const t = normalizeType(qualTypeRaw);

  if(/\(\s*\*\s*\)\s*\(/.test(t)) return { cf: 'function', supported: true };
  if(/\[[^\]]*\]/.test(t)) return { supported: false, reason: 'array types are not supported' };

  if(/&&?$/.test(t)) {
    const typed = normalizeType(t.replace(/\s*&&?$/, '')) + ' *';
    return { cf: typed, supported: true };
  }

  const ptrMatch = t.match(/^(.*?)\s*(\*+)$/);
  if(ptrMatch) {
    const base = normalizeType(ptrMatch[1]);
    const stars = ptrMatch[2];
    if(stars === '*' && base === 'char') return { cf: 'cstring', supported: true };
    const typed = pointerName(t);
    return { cf: typed, supported: true };
  }

  const enumMatch = t.match(/^enum\s+(\S+)$/);
  if(enumMatch) return { cf: 'i32', supported: true, enumId: enumIndex && enumIndex.tagToId[enumMatch[1]] };
  if(/^enum\b/.test(t)) return { cf: 'i32', supported: true };
  if(/^union\b/.test(t)) return { supported: false, reason: 'union passed by value is not supported' };
  if(/^struct\b/.test(t)) return byValue ? provisionalStruct(t.replace(/^struct\s+/, ''), 'struct passed by value is not supported') : { supported: false, reason: 'struct/union passed by value is not supported' };

  const known = BASE_TYPES[t];
  if(known) return { cf: known.cf, supported: true, ...(known.size ? { size: known.size } : {}) };

  if(enumIndex && Object.prototype.hasOwnProperty.call(enumIndex.typedefToEnumId, t)) return { cf: 'i32', supported: true, enumId: enumIndex.typedefToEnumId[t] };

  // C++ spells enum types without the "enum" keyword, by qualified name.
  if(enumIndex && Object.prototype.hasOwnProperty.call(enumIndex.tagToId, t)) return { cf: 'i32', supported: true, enumId: enumIndex.tagToId[t] };

  // Depth-guarded in case a typedef ever resolves back to its own name (seen
  // with clang's `typedef enum { ... } Name;` idiom, where the anonymous
  // enum's synthesized tag is also spelled `Name`) -- falls through to the
  // "unrecognized" error below rather than looping.
  if(typedefs && Object.prototype.hasOwnProperty.call(typedefs, t) && (depth || 0) < 8) return mapCType(typedefs[t], typedefs, enumIndex, (depth || 0) + 1, byValue);

  const reason = 'unrecognized C type "' + qualTypeRaw + '"';

  return byValue ? provisionalStruct(t, reason) : { supported: false, reason };
}

function provisionalStruct(name, reason) {
  return { cf: 'struct ' + name, supported: true, byValue: { name, reason } };
}
