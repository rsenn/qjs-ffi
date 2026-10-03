import { mapCType } from './types.js';
import { isFfiType, arrayDims } from './ffi-types.js';

/* the most elements an array type has (ARRAY_MAX_ELEMENTS in ffi-type.c). */
const MAX_ELEMENTS = 1 << 20;

/* the spec type for one IR type, or { reason } if it has none.
 *
 *   "i32", "cstring", "T *"  as they are
 *   "unsigned char"          a C spelling, through mapCType()
 *   "struct pt"              the member types in ir.byValue
 *   "int[3][2]"              nested { array, length } of the element type
 */
function specType(ir, type) {
  const array = arrayDims(type);

  if(array) {
    if(array.dims.includes(null)) return { reason: type + ': an array of unknown size' };

    const element = specType(ir, array.elem);

    if(element.reason) return element;

    let t = element.type;

    for(const n of [...array.dims].reverse()) {
      if(n < 1 || n > MAX_ELEMENTS) return { reason: type + ': an array type has 1 to ' + MAX_ELEMENTS + ' elements, not ' + n };
      t = { array: t, length: n };
    }

    return { type: t };
  }

  const struct = /^struct (\w+)$/.exec(type);

  if(struct) return ir.byValue && ir.byValue[struct[1]] ? { type: ir.byValue[struct[1]] } : { reason: type + ' is not laid out, it cannot be passed or held by value' };

  if(isFfiType(type.trim())) return { type };

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
    else symbols[fn.name] = { args: types.slice(0, -1).map(t => t.type), returns: types[types.length - 1].type, ...(fn.variadic ? { variadic: true } : {}) };
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
