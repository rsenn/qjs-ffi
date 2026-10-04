import { safeIdent, jsLiteral } from './common.js';
import { PRELUDE } from './structs.js';
import { FFI_SIZES } from '../ffi-types.js';

/* Support code for extern variables (and static class members), emitted
 * verbatim into the generated module after PRELUDE, whose __ptrOut() it uses.
 * Field access is little-endian, like the rest of this project (64-bit
 * Linux). */
const VARIABLE_HELPERS = `
const __sizes = ${JSON.stringify(FFI_SIZES)};

/* A type spelled "T *" is a pointer, whatever T is. */
function __sz(type) {
  return __sizes[type.endsWith("*") ? "pointer" : type];
}

function __read(p, type, off) {
  if(type.endsWith("*")) type = "pointer";
  switch(type) {
    case "bool": return __rd.u8(p, off) !== 0;
    case "i8": case "u8": case "i16": case "u16": case "i32": case "u32": case "i64": case "u64": case "f32": case "f64": return __rd[type](p, off);
    case "i64_fast": return Number(__rd.i64(p, off));
    case "u64_fast": return Number(__rd.u64(p, off));
    case "pointer": case "ptr": case "function": return __ptrOut(__rd.u64(p, off));
    case "cstring": { const q = __ptrOut(__rd.u64(p, off)); return q === null ? null : __cstr(q); }
  }
}

function __write(p, type, off, v) {
  if(type.endsWith("*")) type = "pointer";
  switch(type) {
    case "bool": return __wr.u8(p, off, v ? 1 : 0);
    case "i8": case "u8": case "i16": case "u16": case "i32": case "u32": case "i64": case "u64": case "f32": case "f64": return __wr[type](p, off, v);
    case "i64_fast": return __wr.i64(p, off, BigInt(v));
    case "u64_fast": return __wr.u64(p, off, BigInt(v));
    case "pointer": case "ptr": case "function": return __wr.u64(p, off, __ptrIn(v));
  }
  throw new TypeError("cannot write a " + type + " field");
}

function __variable(name, type) {
  const v = { get ptr() { return __sym(name); } };
  if(__sz(type) !== undefined) {
    Object.defineProperty(v, "value", { enumerable: true, get: () => __read(__sym(name), type, 0), set: x => __write(__sym(name), type, 0, x) });
  }
  return v;
}
`;

/* The support code every generated module with struct, class or variable
 * wrappers starts with (after its imports): PRELUDE from structs.js, the
 * variable accessors and the struct-return helper. */
export function runtimeCode() {
  return PRELUDE + VARIABLE_HELPERS + RET_HELPER;
}

/* CFunction returns a struct as a bare ArrayBuffer; this makes it the class. */
const RET_HELPER = `
function __ret(cls, f) {
  return (...args) => Object.setPrototypeOf(f(...args), cls.prototype);
}
`;

/* The extern variables that are not already a known constant (see
 * constantsCode()). */
const externVariables = ir => ir.fields.filter(f => !(f.const && f.value !== undefined));

/* Whether the module needs runtimeCode(): it has C++ classes, or --structs has
 * a struct, union or extern variable to wrap. */
export function needsRuntime(ir, opts, classes) {
  return classes.length > 0 || (opts.structs && (ir.structs.some(s => s.size != null) || externVariables(ir).length > 0));
}

/* With --structs: an accessor for every extern variable. The structs and
 * unions themselves are classes, see classesCode() in classes.js. */
export function variablesCode(ir, opts) {
  if(!opts.structs) return '';

  const variables = externVariables(ir);

  if(!variables.length) return '';

  return '\n// extern variables\n' + variables.map(v => 'export const ' + safeIdent(v.name) + ' = __variable(' + jsLiteral(v.name) + ',' + jsLiteral(v.type) + ');\n').join('');
}
