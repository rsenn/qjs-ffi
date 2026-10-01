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
  void: { cf: 'void', def: 'void' },
  _Bool: { cf: 'bool', def: 'uint8' },
  bool: { cf: 'bool', def: 'uint8' },
  char: { cf: 'i8', def: 'char' },
  'signed char': { cf: 'i8', def: 'schar' },
  'unsigned char': { cf: 'u8', def: 'uchar' },
  short: { cf: 'i16', def: 'sshort' },
  'short int': { cf: 'i16', def: 'sshort' },
  'signed short': { cf: 'i16', def: 'sshort' },
  'signed short int': { cf: 'i16', def: 'sshort' },
  'unsigned short': { cf: 'u16', def: 'ushort' },
  'unsigned short int': { cf: 'u16', def: 'ushort' },
  int: { cf: 'i32', def: 'sint32' },
  signed: { cf: 'i32', def: 'sint32' },
  'signed int': { cf: 'i32', def: 'sint32' },
  unsigned: { cf: 'u32', def: 'uint32' },
  'unsigned int': { cf: 'u32', def: 'uint32' },
  long: { cf: 'i64', def: 'sint64' },
  'long int': { cf: 'i64', def: 'sint64' },
  'signed long': { cf: 'i64', def: 'sint64' },
  'signed long int': { cf: 'i64', def: 'sint64' },
  'unsigned long': { cf: 'u64', def: 'uint64' },
  'unsigned long int': { cf: 'u64', def: 'uint64' },
  'long long': { cf: 'i64', def: 'sint64' },
  'long long int': { cf: 'i64', def: 'sint64' },
  'signed long long': { cf: 'i64', def: 'sint64' },
  'signed long long int': { cf: 'i64', def: 'sint64' },
  'unsigned long long': { cf: 'u64', def: 'uint64' },
  'unsigned long long int': { cf: 'u64', def: 'uint64' },
  float: { cf: 'f32', def: 'float' },
  double: { cf: 'f64', def: 'double' },
  'long double': { cf: 'f64', def: 'longdouble' }, // f64 is lossy for long double

  // clang gives functions it recognizes as library builtins (strlen,
  // malloc, ...) synthetic return types spelled with these glibc-internal
  // names instead of the user-visible typedef (e.g. "__size_t" instead of
  // "size_t") -- and unlike ParmVarDecl, a FunctionDecl's own return type
  // never carries a desugaredQualType to resolve this the general way.
  // Fixed 64-bit-Linux-only set, consistent with the rest of this project.
  __int8_t: { cf: 'i8', def: 'schar' },
  __uint8_t: { cf: 'u8', def: 'uchar' },
  __int16_t: { cf: 'i16', def: 'sshort' },
  __uint16_t: { cf: 'u16', def: 'ushort' },
  __int32_t: { cf: 'i32', def: 'sint32' },
  __uint32_t: { cf: 'u32', def: 'uint32' },
  __int64_t: { cf: 'i64', def: 'sint64' },
  __uint64_t: { cf: 'u64', def: 'uint64' },
  __size_t: { cf: 'u64', def: 'uint64' },
  __ssize_t: { cf: 'i64', def: 'sint64' },
  __off_t: { cf: 'i64', def: 'sint64' },
  __off64_t: { cf: 'i64', def: 'sint64' },
  __time_t: { cf: 'i64', def: 'sint64' },
  __clock_t: { cf: 'i64', def: 'sint64' },
  __pid_t: { cf: 'i32', def: 'sint32' },
  __uid_t: { cf: 'u32', def: 'uint32' },
  __gid_t: { cf: 'u32', def: 'uint32' },
  __mode_t: { cf: 'u32', def: 'uint32' },
  __socklen_t: { cf: 'u32', def: 'uint32' },
  __intptr_t: { cf: 'i64', def: 'sint64' },
  __uintptr_t: { cf: 'u64', def: 'uint64' },
};

/* Byte size of each FFIType name; `long double` (mapped to f64, lossy) is
 * the exception, see sizeOfC(). */
const FFI_SIZES = { bool: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, i64_fast: 8, u64_fast: 8, f32: 4, f64: 8, pointer: 8, ptr: 8, function: 8, cstring: 8 };

/* Byte size of the C type `cType`, whose mapCType() result is `m`, from the
 * type alone (scalars, pointers, arrays of those), or null. Only a fallback
 * for what the layout probe could not size. */
export function sizeOfC(m, cType, typedefs, enumIndex) {
  const array = /^(.*?)\s*((?:\[\d+\])+)$/.exec(cType);

  if(array) {
    const elem = sizeOfC(mapCType(array[1], typedefs, enumIndex), array[1], typedefs, enumIndex);
    const count = [...array[2].matchAll(/\[(\d+)\]/g)].reduce((n, d) => n * Number(d[1]), 1);

    return elem === null ? null : elem * count;
  }

  if(!m.supported) return null;
  if(m.def === 'longdouble') return 16;
  return m.cf in FFI_SIZES ? FFI_SIZES[m.cf] : m.cf.endsWith('*') ? 8 : null;
}

/* The "T *" spelling the ffi module reads as a pointer type: the stars of
 * `t` (a normalized pointer type) joined, one space before them. */
function pointerName(t) {
  const m = /^(.*?)((?:\s*\*)+)$/.exec(t);

  return m[1].trim() + ' ' + m[2].replace(/\s+/g, '');
}

/* Maps one C type string (a return type or a single parameter's type) to
 * { cf, def, supported, reason, enumId }: `cf` is the bun-style FFIType
 * name used for CFunction/JSCallback, `def` is the legacy ffi.c type name
 * used for define()/call(); a pointer or reference is spelled "T *" in
 * both (any name ending in '*' is a pointer to the ffi module). Only scalar
 * and pointer types are supported -- struct/union-by-value, arrays and varargs need libffi
 * struct/array support this module doesn't have (see TODO.md).
 *
 * `typedefs` (name -> underlying type string, from collectTypedefs()) is
 * consulted when `t` is itself an unresolved typedef name -- needed for
 * return types, since a FunctionDecl's own qualType is never desugared by
 * clang (unlike ParmVarDecl's, which normally arrives pre-resolved via
 * desugaredQualType and hits BASE_TYPES/enum directly without this).
 *
 * `enumIndex` (from collectEnumIndex()) is consulted alongside `typedefs`
 * so a resolved enum type carries back which EnumDecl backs it (`enumId`),
 * letting collectFunctions() know which enums are actually reachable from a
 * bindable function's signature.
 */
/* `byValue`, for the parameters and return type of a function, makes a struct
 * (or a name this cannot place) a provisional `struct NAME` type with
 * `byValue: { name, reason }`: by-value.js decides later, once every record is
 * known, whether it is a plain C struct, and otherwise restores `reason`. */
export function mapCType(qualTypeRaw, typedefs, enumIndex, depth, byValue) {
  const t = normalizeType(qualTypeRaw);

  if(/\(\s*\*\s*\)\s*\(/.test(t)) return { cf: 'function', def: 'callback', supported: true };
  if(/\[[^\]]*\]/.test(t)) return { supported: false, reason: 'array types are not supported' };

  if(/&&?$/.test(t)) {
    const typed = normalizeType(t.replace(/\s*&&?$/, '')) + ' *';
    return { cf: typed, def: typed, supported: true };
  }

  const ptrMatch = t.match(/^(.*?)\s*(\*+)$/);
  if(ptrMatch) {
    const base = normalizeType(ptrMatch[1]);
    const stars = ptrMatch[2];
    if(stars === '*' && base === 'char') return { cf: 'cstring', def: 'char *', supported: true };
    const typed = pointerName(t);
    return { cf: typed, def: typed, supported: true };
  }

  const enumMatch = t.match(/^enum\s+(\S+)$/);
  if(enumMatch) return { cf: 'i32', def: 'sint32', supported: true, enumId: enumIndex && enumIndex.tagToId[enumMatch[1]] };
  if(/^enum\b/.test(t)) return { cf: 'i32', def: 'sint32', supported: true };
  if(/^union\b/.test(t)) return { supported: false, reason: 'union passed by value is not supported' };
  if(/^struct\b/.test(t)) return byValue ? provisionalStruct(t.replace(/^struct\s+/, ''), 'struct passed by value is not supported') : { supported: false, reason: 'struct/union passed by value is not supported' };

  const known = BASE_TYPES[t];
  if(known) return { cf: known.cf, def: known.def, supported: true };

  if(enumIndex && Object.prototype.hasOwnProperty.call(enumIndex.typedefToEnumId, t)) return { cf: 'i32', def: 'sint32', supported: true, enumId: enumIndex.typedefToEnumId[t] };

  // C++ spells enum types without the "enum" keyword, by qualified name.
  if(enumIndex && Object.prototype.hasOwnProperty.call(enumIndex.tagToId, t)) return { cf: 'i32', def: 'sint32', supported: true, enumId: enumIndex.tagToId[t] };

  // Depth-guarded in case a typedef ever resolves back to its own name (seen
  // with clang's `typedef enum { ... } Name;` idiom, where the anonymous
  // enum's synthesized tag is also spelled `Name`) -- falls through to the
  // "unrecognized" error below rather than looping.
  if(typedefs && Object.prototype.hasOwnProperty.call(typedefs, t) && (depth || 0) < 8) return mapCType(typedefs[t], typedefs, enumIndex, (depth || 0) + 1, byValue);

  const reason = 'unrecognized C type "' + qualTypeRaw + '"';

  return byValue ? provisionalStruct(t, reason) : { supported: false, reason };
}

function provisionalStruct(name, reason) {
  return { cf: 'struct ' + name, def: 'struct', supported: true, byValue: { name, reason } };
}
