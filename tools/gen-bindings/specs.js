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

/* the narrowest of i32, u32, i64, u64 that holds every value of an enum. */
function enumType(values) {
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);

  if(lo >= -(2 ** 31) && hi < 2 ** 31) return 'i32';
  if(lo >= 0 && hi < 2 ** 32) return 'u32';
  return lo < 0 ? 'i64' : 'u64';
}

/* converts the IR into the symbol specs that dlopen() takes.
 *
 * ```js
 * irToSpecs(ir, { library: "libgeom.so" });
 * // { library: "libgeom.so",
 * //   symbols: { geom_abs: { args: ["i32"], returns: "i32" },
 * //              counter: { type: "i32" },
 * //              N: { value: 5 },
 * //              Color: { enum: { RED: 0, BLUE: 4 }, type: "i32" } },
 * //   omitted: [{ name: "geo::Shape", reason: "a C++ class" }] }
 * ```
 *
 *   object  ir               from collectIR(), or read from --emit-ir
 *   object  options.library  the shared library; copied to the result
 *
 *   returns  { library, symbols, types, omitted }
 *
 * `symbols` is { name: spec }: { args, returns } for a function, { type,
 * readonly? } for a variable, { value } for a constant that has no symbol
 * (`static const int N = 5`, a #define) and { enum, type } for an enum with
 * a tag; the constants of an anonymous enum are { value } each.
 * `types` names the structs and unions that have a size: a "struct pt *" in
 * the specs is a pointer typed by the class `pt` when dlopen() is given
 * `{ pt }` as its third argument (see doc/struct.md).
 * `omitted` lists what has no spec, with the reason: the IR's `skipped`,
 * C++ functions and classes, and anything whose type has no spec form. */
export function irToSpecs(ir, options = {}) {
  const symbols = {};
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
      symbols[v.name] = { value: v.value };
      continue;
    }

    const t = specType(ir, v.type);

    if(t.reason) omitted.push({ name: v.name, reason: t.reason });
    else symbols[v.name] = { type: t.type, ...(v.const ? { readonly: true } : {}) };
  }

  for(const e of ir.enums || []) {
    const values = e.fields.map(c => c.value);

    if(!e.name) {
      for(const c of e.fields) if(!(c.name in symbols)) symbols[c.name] = { value: c.value };
    } else if(e.name in symbols) omitted.push({ name: e.name, reason: 'enum: a symbol of that name exists' });
    else symbols[e.name] = { enum: Object.fromEntries(e.fields.map(c => [c.name, c.value])), type: enumType(values) };
  }

  for(const d of ir.defines || []) {
    if(d.name in symbols) omitted.push({ name: d.name, reason: '#define: a symbol of that name exists' });
    else if(d.big) omitted.push({ name: d.name, reason: '#define: ' + d.value + ' needs a bigint, which JSON has not' });
    else symbols[d.name] = { value: d.value };
  }

  for(const c of ir.classes || []) omitted.push({ name: c.name, reason: 'a C++ class' });

  const types = (ir.structs || []).filter(s => s.size != null).map(s => s.name);

  return { library: options.library || null, symbols, types, omitted };
}
