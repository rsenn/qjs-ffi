import { safeIdent, jsLiteral } from './common.js';
import { preludeCode } from './structs.js';
import { FFI_SIZES, bunLike } from '../ffi-types.js';

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
export function runtimeCode(opts) {
  const bun = opts && bunLike(opts);

  return (bun ? BUN_HELPERS : '') + preludeCode(bun ? 'bun' : 'qjs') + VARIABLE_HELPERS + RET_HELPER;
}

/* bun:ffi has no write(), and its read() takes an address only, so the
 * generated module reads and writes memory through a DataView: over an
 * ArrayBuffer or view, or over the bytes at an address (toArrayBuffer()).
 * __rd.u32(p, off) and __wr.u32(p, off, v) then work as ffi's do. */
const BUN_HELPERS = `
const __acc = { i8: ["Int8", 1], u8: ["Uint8", 1], i16: ["Int16", 2], u16: ["Uint16", 2], i32: ["Int32", 4], u32: ["Uint32", 4], i64: ["BigInt64", 8], u64: ["BigUint64", 8], f32: ["Float32", 4], f64: ["Float64", 8] };

function __dview(p, off, n) {
  if(typeof p === "number" || typeof p === "bigint") return new DataView(toArrayBuffer(Number(p) + off, 0, n));
  return ArrayBuffer.isView(p) ? new DataView(p.buffer, p.byteOffset + off, n) : new DataView(p, off, n);
}

const __rd = {};
const __wr = {};

for(const [k, [t, n]] of Object.entries(__acc)) {
  __rd[k] = (p, off = 0) => __dview(p, off, n)["get" + t](0, true);
  __wr[k] = (p, off, v) => __dview(p, off, n)["set" + t](0, v, true);
}

const __cstr = p => new CString(p).toString();

/* a function returning a pointer to class cls, as an instance of it */
function __at(cls, f) {
  return (...args) => {
    const p = f(...args);

    return p === null ? null : cls.at(p);
  };
}
`;

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

/* --target=deno: bun:ffi's CFunction, toArrayBuffer, ptr and CString on
 * top of Deno.UnsafeFnPointer and Deno.UnsafePointerView, so the rest of
 * the module is the bun one. Pointers are Numbers (null for NULL), a
 * "cstring" argument is a string or null, a struct by value is an
 * ArrayBuffer. */
export function denoHelpers(opts) {
  return `const __P = Deno.UnsafePointer;
const __V = Deno.UnsafePointerView;
const __enc = new TextEncoder();

const __ptrIn_ = v => (v === null || v === undefined ? null : typeof v === "object" ? (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? __P.of(v) : v) : __P.create(BigInt(v)));
const __ptrOut_ = p => (p === null ? null : Number(__P.value(p)));
const __bytes_ = v => (v instanceof ArrayBuffer ? new Uint8Array(v) : v);

/* a CFunction type spec (name or struct member list) as { d: Deno type, in, out } */
function __type(t) {
  if(Array.isArray(t)) {
    const m = t.map(__type);

    return { d: { struct: m.map(x => x.d) }, in: __bytes_, out: u => (u.buffer.byteLength === u.length ? u.buffer : u.buffer.slice(u.byteOffset, u.byteOffset + u.length)) };
  }

  if(t === "cstring") return { d: "buffer", in: s => (s === null || s === undefined ? null : typeof s === "string" ? __enc.encode(s + "\\0") : __bytes_(s)), out: p => (p === null ? null : __V.getCString(p)) };
  if(t === "i64" || t === "i64_fast") return { d: "i64", out: BigInt };
  if(t === "u64" || t === "u64_fast") return { d: "u64", out: BigInt };
  if(t === "ptr" || t === "pointer" || t === "function" || t.endsWith("*")) return { d: "pointer", in: __ptrIn_, out: __ptrOut_ };

  return { d: t };
}

function CFunction({ ptr, args = [], returns = "void" }) {
  const a = args.map(__type);
  const r = __type(returns);
  const f = new Deno.UnsafeFnPointer(__P.create(BigInt(ptr)), { parameters: a.map(x => x.d), result: r.d });

  return (...v) => {
    for(let i = 0; i < a.length; i++) if(a[i].in) v[i] = a[i].in(v[i]);

    const x = f.call(...v);

    return r.out ? r.out(x) : x;
  };
}

const toArrayBuffer = (p, off = 0, n) => __V.getArrayBuffer(__P.create(BigInt(p) + BigInt(off)), n);
const __ptr = (v, off = 0) => Number(__P.value(__P.of(v))) + off;

class CString {
  constructor(p) { this.s = __V.getCString(__P.create(BigInt(p))); }
  toString() { return this.s; }
}
` + (opts.ffiType ? 'const FFIType = new Proxy({}, { get: (_, k) => k });\n' : '') + '\n';
}
