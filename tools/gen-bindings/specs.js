import { mapCType } from './types.js';

/* the type names the ffi module knows; the IR already uses them for
 * everything it could map (see mapCType()). */
const FFI_NAMES = new Set(['void', 'bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64', 'i64_fast', 'u64_fast', 'f32', 'f64', 'pointer', 'cstring', 'function']);

/* the most elements one level of a struct type may list (STRUCT_MAX_ELEMENTS
 * in ffi-type.c). */
const MAX_ELEMENTS = 1024;

/* the spec type for one IR type, or { reason } if it has none.
 *
 *   "i32", "cstring", "T *"  as they are
 *   "unsigned char"          a C spelling, through mapCType()
 *   "struct pt"              the member types in ir.byValue
 *   "int[3][2]"              nested arrays of the element type
 */
function specType(ir, type) {
  const array = /^(.*?)((?:\[\d*\])+)$/.exec(type);

  if(array) {
    const dims = [...array[2].matchAll(/\[(\d*)\]/g)].map(m => m[1]);

    if(dims.some(d => d === '')) return { reason: type + ': an array of unknown size' };

    const element = specType(ir, array[1].trim());

    if(element.reason) return element;

    let t = element.type;

    for(const n of dims.reverse().map(Number)) {
      if(n < 1 || n > MAX_ELEMENTS) return { reason: type + ': a struct type lists 1 to ' + MAX_ELEMENTS + ' elements, not ' + n };
      t = Array(n).fill(t);
    }

    return { type: t };
  }

  const struct = /^struct (\w+)$/.exec(type);

  if(struct) return ir.byValue && ir.byValue[struct[1]] ? { type: ir.byValue[struct[1]] } : { reason: type + ' is not laid out, it cannot be passed or held by value' };

  if(FFI_NAMES.has(type) || /\*\s*$/.test(type)) return { type };

  const m = mapCType(type, null, null);

  return m.supported ? { type: m.cf } : { reason: m.reason };
}

/* converts the IR into the symbol specs that dlopen() takes.
 *
 * ```js
 * irToSpecs(ir, { library: "libgeom.so" });
 * // { library: "libgeom.so",
 * //   symbols: { geom_abs: { args: ["i32"], returns: "i32" },
 * //              counter: { type: "i32" } },
 * //   constants: { N: 5 },
 * //   omitted: [{ name: "geo::Shape", reason: "a C++ class" }] }
 * ```
 *
 *   object  ir               from collectIR(), or read from --emit-ir
 *   object  options.library  the shared library; copied to the result
 *
 *   returns  { library, symbols, constants, omitted }
 *
 * `symbols` is { name: spec }: { args, returns } for a function, { type,
 * readonly? } for a variable. `constants` holds the values of constants
 * that have no symbol (`static const int N = 5`); they are JS constants.
 * `omitted` lists what has no spec, with the reason: the IR's `skipped`,
 * C++ functions and classes, and anything whose type has no spec form. */
export function irToSpecs(ir, options = {}) {
  const symbols = {};
  const constants = {};
  const omitted = [...ir.skipped];

  for(const fn of ir.methods) {
    if(fn.kind !== 'function') continue;

    if(fn.mangledName) {
      omitted.push({ name: fn.name, reason: 'C++ linkage: the symbol is ' + fn.mangledName });
      continue;
    }

    const types = [...fn.args.map(a => a.slice(a.indexOf(': ') + 2)), fn.returns || 'void'].map(t => specType(ir, t));
    const bad = types.find(t => t.reason);

    if(bad) omitted.push({ name: fn.name, reason: bad.reason });
    else symbols[fn.name] = { args: types.slice(0, -1).map(t => t.type), returns: types[types.length - 1].type };
  }

  for(const v of ir.fields) {
    if(v.value !== undefined) {
      constants[v.name] = v.value;
      continue;
    }

    const t = specType(ir, v.type);

    if(t.reason) omitted.push({ name: v.name, reason: t.reason });
    else symbols[v.name] = { type: t.type, ...(v.const ? { readonly: true } : {}) };
  }

  for(const c of ir.classes || []) omitted.push({ name: c.name, reason: 'a C++ class' });

  return { library: options.library || null, symbols, constants, omitted };
}
