import { jsLiteral, flattenName } from './emit/common.js';
import { DESCRIBE_HELPERS } from './emit/describe.js';
import * as std from 'std';

/* --- the IR ---------------------------------------------------------------- */

/* { structs: [entry, ...], typedefs: [...] } of the merged IR files. */
export function loadIR(files) {
  return mergeIRs(
    files.map(file => {
      const text = std.loadFile(file);
      if(text === null) throw new Error('cannot read ' + file);

      return JSON.parse(text);
    }),
  );
}

/* The same for already parsed IRs: gen-bindings.js's own, or plain arrays of
 * struct entries. The first declaration of a name wins. */
export function mergeIRs(irs) {
  const structs = new Map();
  const typedefs = new Map();
  const enums = new Map();

  for(const ir of irs) {
    const entries = Array.isArray(ir) ? ir : [...(ir.structs || []), ...(ir.classes || [])];

    for(const e of entries) if(!structs.has(e.name)) structs.set(e.name, e);
    for(const t of Array.isArray(ir) ? [] : ir.typedefs || []) if(!typedefs.has(t.name)) typedefs.set(t.name, t);
    for(const en of Array.isArray(ir) ? [] : ir.enums || []) if(!enums.has(en.name)) enums.set(en.name, en);
  }

  return { structs, typedefs, enums };
}

/* --- member types ---------------------------------------------------------- */

/* Byte size of each ffi type name. */
export const SIZES = { bool: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, f32: 4, f64: 8, pointer: 8 };

/* C type spellings -> ffi type name, for an IR whose members have no `ffi`. */
const C_TYPES = {
  _Bool: 'bool',
  bool: 'bool',
  char: 'i8',
  'signed char': 'i8',
  'unsigned char': 'u8',
  short: 'i16',
  'unsigned short': 'u16',
  int: 'i32',
  signed: 'i32',
  unsigned: 'u32',
  'unsigned int': 'u32',
  long: 'i64',
  'unsigned long': 'u64',
  'long long': 'i64',
  'unsigned long long': 'u64',
  float: 'f32',
  double: 'f64',
  size_t: 'u64',
  ssize_t: 'i64',
  ptrdiff_t: 'i64',
  intptr_t: 'i64',
  uintptr_t: 'u64',
  off_t: 'i64',
  time_t: 'i64',
};

for(const bits of [8, 16, 32, 64]) {
  C_TYPES['int' + bits + '_t'] = 'i' + bits;
  C_TYPES['uint' + bits + '_t'] = 'u' + bits;
}

const normalize = t =>
  t
    .replace(/\b(const|volatile|restrict)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/* The ffi type name of a scalar, or null. `ffi` is what gen-bindings.js
 * resolved (typedefs included); without it the C spelling is looked up, then
 * the typedefs of the IR. */
export function scalarOf(ffi, type, typedefs, depth = 0) {
  if(ffi in SIZES) return ffi;
  if(ffi === 'cstring' || ffi === 'function' || ffi === 'ptr') return 'pointer';

  const t = normalize(type || '');

  if(/\*$/.test(t) || /\(\s*\*/.test(t)) return 'pointer';
  if(/^enum\b/.test(t)) return 'i32';
  if(t in C_TYPES) return C_TYPES[t];

  const alias = typedefs.get(t);
  if(alias && depth < 8) return scalarOf(alias.type, alias.cType, typedefs, depth + 1);

  return null;
}

/* The typed array that views an array of `ffi` elements. */
const ARRAYS = { bool: 'Uint8Array', i8: 'Int8Array', u8: 'Uint8Array', i16: 'Int16Array', u16: 'Uint16Array', i32: 'Int32Array', u32: 'Uint32Array', i64: 'BigInt64Array', u64: 'BigUint64Array', f32: 'Float32Array', f64: 'Float64Array', pointer: 'BigUint64Array' };

/* DataView accessor names and, for integers, whether the value is signed. */
const DV = { bool: 'Uint8', i8: 'Int8', u8: 'Uint8', i16: 'Int16', u16: 'Uint16', i32: 'Int32', u32: 'Uint32', i64: 'BigInt64', u64: 'BigUint64', f32: 'Float32', f64: 'Float64', pointer: 'BigUint64' };

/* Members that would hide something ArrayBuffer or the wrapper has. */
const RESERVED = new Set(['constructor', 'ptr', 'byteLength', 'maxByteLength', 'resizable', 'resize', 'slice', 'transfer', 'transferToFixedLength', 'detached', 'toString', 'valueOf', '__proto__']);

/* `T[3]`, `T[2][4]` -> { elem: "T", count: 12 } */
export function arrayOf(type) {
  const m = /^(.*?)\s*((?:\[\d+\])+)$/.exec(type);

  return m && { elem: m[1], count: [...m[2].matchAll(/\[(\d+)\]/g)].reduce((n, d) => n * Number(d[1]), 1) };
}

/* The record `type` names (a struct/union/class keyword is optional, a
 * typedef of the record is followed), or undefined. */
export function recordOf(type, ir) {
  const t = normalize(type).replace(/^(struct|union|class)\s+/, '');

  if(ir.structs.has(t)) return t;

  const alias = ir.typedefs.get(t);
  return alias && alias.record && ir.structs.has(alias.record) ? alias.record : undefined;
}

/* The sized record a member of type "<struct|union|class> *" points to, or
 * undefined. */
function pointeeOf(type, ir) {
  const m = /^([^*()[\]]+?)\s*\*$/.exec(normalize(type));
  const rec = m && recordOf(m[1], ir);

  return rec && ir.structs.get(rec).size !== null && ir.structs.get(rec).size !== undefined ? rec : undefined;
}

/* --- code generation ------------------------------------------------------- */

export const PRELUDE = `
const __dvs = new WeakMap();

function __dv(o) {
  let d = __dvs.get(o);
  if(!d) __dvs.set(o, (d = new DataView(o)));
  return d;
}

function __ptrOut(v) {
  return v === 0n ? null : v <= 0xffffffffn ? Number(v) : v;
}

function __ptrIn(v) {
  return v === null || v === undefined ? 0n : typeof v === "object" ? BigInt(v.ptr !== undefined ? v.ptr : __ptr(v)) : BigInt(v);
}

const __index = /^(0|[1-9]\\d*)$/;

function __ptrArray(a, wrap) {
  const at = i => {
    const p = a[i];
    return p === 0n ? null : wrap ? wrap(p) : __ptrOut(p);
  };

  return new Proxy(a, {
    get(t, k) {
      if(typeof k === "string" && __index.test(k)) return Number(k) < t.length ? at(Number(k)) : undefined;
      if(k === Symbol.iterator) return function*() { for(let i = 0; i < t.length; i++) yield at(i); };

      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, k, v) {
      if(typeof k === "string" && __index.test(k)) {
        if(Number(k) >= t.length) return false;
        t[k] = __ptrIn(v);
        return true;
      }
      return Reflect.set(t, k, v, t);
    },
  });
}

function __bytes(v) {
  return ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v);
}

function __view(cls, p, size, owner) {
  const b = toArrayBuffer(BigInt(p), size, false);

  Object.setPrototypeOf(b, cls.prototype);
  if(owner) Object.defineProperty(b, "__owner", { value: owner });
  return b;
}
`;

/* Statements of an accessor body on one line. */
function oneLine(src) {
  return src.replace(/\n\s*/g, ' ');
}

/* The JS type a member of scalar type `scalar` reads as (for --jsdoc). */
function scalarType(scalar) {
  switch(scalar) {
    case 'bool': return 'boolean';
    case 'i64':
    case 'u64': return 'bigint';
    case 'pointer': return 'number|bigint|null';
  }

  return 'number';
}

/* Getter and setter source of one member and the JS `type` it reads as, or
 * { skipped: reason }. */
function accessors(f, ir) {
  const hasType = f.size !== null && f.size !== undefined;
  const scalar = scalarOf(f.ffi, f.type, ir.typedefs);
  const arr = arrayOf(f.type);
  const at = f.offset;

  if(at === null || at === undefined) return { skipped: 'offset unknown' };

  if(f.bits !== undefined) {
    if(!scalar || scalar === 'pointer' || scalar.startsWith('f') || !hasType || f.bitOffset === null) return { skipped: 'bitfield of unknown storage' };

    return { ...bitfield(f, scalar, at), type: scalar === 'bool' ? 'boolean' : f.size === 8 && f.bits > 32 ? 'bigint' : 'number' };
  }

  const pointee = scalar === 'pointer' && hasType && f.size === SIZES.pointer && f.bits === undefined && pointeeOf(f.type, ir);

  if(pointee) {
    return {
      get: 'const p = __dv(this).getBigUint64(' + at + ', true);\n    return p === 0n ? null : ' + identOf(pointee) + '.at(p);',
      set: scalarAccessors('pointer', at).set,
      type: identOf(pointee) + '|null',
    };
  }

  if(scalar && hasType && f.size === SIZES[scalar]) return { ...scalarAccessors(scalar, at), type: scalarType(scalar) };

  if(arr && hasType) {
    const elem = scalarOf(null, arr.elem, ir.typedefs);

    if(elem && arr.count * SIZES[elem] === f.size && at % SIZES[elem] === 0) {
      const view = 'new ' + ARRAYS[elem] + '(this, ' + at + ', ' + arr.count + ')';

      if(elem === 'pointer') {
        const target = pointeeOf(arr.elem, ir);

        return {
          get: 'return __ptrArray(' + view + ', ' + (target ? identOf(target) + '.at' : 'null') + ');',
          set: 'const a = ' + view + ';\n    for(let i = 0; i < a.length && i < v.length; i++) a[i] = __ptrIn(v[i]);',
          type: 'Array<' + (target ? identOf(target) + '|' : '') + 'number|bigint|null>',
        };
      }

      return { get: 'return ' + view + ';', set: view + '.set(v);', type: ARRAYS[elem] };
    }
  }

  const rec = recordOf(f.type, ir);

  if(rec && hasType) {
    const target = identOf(rec);

    return { get: 'return ' + target + '.at(__ptr(this, ' + at + '), this);', set: 'new Uint8Array(this, ' + at + ', ' + f.size + ').set(__bytes(v));', type: target };
  }

  if(!hasType) return { skipped: 'size unknown' };

  return { get: 'return new Uint8Array(this, ' + at + ', ' + f.size + ');', set: 'new Uint8Array(this, ' + at + ', ' + f.size + ').set(__bytes(v));', type: 'Uint8Array' };
}

function scalarAccessors(scalar, at) {
  const t = DV[scalar];
  const le = SIZES[scalar] > 1 ? ', true' : '';
  const read = '__dv(this).get' + t + '(' + at + le + ')';
  const write = v => '__dv(this).set' + t + '(' + at + ', ' + v + le + ');';

  switch (scalar) {
    case 'bool':
      return { get: 'return ' + read + ' !== 0;', set: write('v ? 1 : 0') };
    case 'pointer':
      return { get: 'return __ptrOut(' + read + ');', set: write('__ptrIn(v)') };
    case 'i64':
    case 'u64':
      return { get: 'return ' + read + ';', set: write('BigInt(v)') };
  }

  return { get: 'return ' + read + ';', set: write('v') };
}

/* A bitfield is read and written through its storage unit (offset/size of the
 * IR), `bitOffset` bits up. */
function bitfield(f, scalar, at) {
  const unit = f.size;
  const signed = scalar.startsWith('i');
  const big = unit === 8;
  const t = 'Uint' + 8 * unit;
  const le = unit > 1 ? ', true' : '';
  const u = '__dv(this).get' + (big ? 'BigUint64' : t) + '(' + at + le + ')';
  const store = v => '__dv(this).set' + (big ? 'BigUint64' : t) + '(' + at + ', ' + v + le + ');';

  if(!big) {
    const mask = f.bits === 32 ? 0xffffffff : 2 ** f.bits - 1;
    const m = (mask * 2 ** f.bitOffset) >>> 0;
    const value = signed ? '(' + u + ' << ' + (32 - f.bitOffset - f.bits) + ') >> ' + (32 - f.bits) : '(' + u + ' >>> ' + f.bitOffset + ') & 0x' + mask.toString(16);

    return {
      get: 'return ' + (scalar === 'bool' ? '(' + value + ') !== 0' : value) + ';',
      set: store('((' + u + ' & ~0x' + m.toString(16) + ') | ((v << ' + f.bitOffset + ') & 0x' + m.toString(16) + ')) >>> 0'),
    };
  }

  const mask = (1n << BigInt(f.bits)) - 1n;
  const raw = '(' + u + ' >> ' + f.bitOffset + 'n) & 0x' + mask.toString(16) + 'n';
  const value = signed ? 'BigInt.asIntN(' + f.bits + ', ' + raw + ')' : raw;

  return {
    get: 'return ' + (f.bits <= 32 ? 'Number(' + value + ')' : value) + ';',
    set: store('(' + u + ' & ~(0x' + mask.toString(16) + 'n << ' + f.bitOffset + 'n)) | ((BigInt(v) & 0x' + mask.toString(16) + 'n) << ' + f.bitOffset + 'n)'),
  };
}

const RESERVED_WORDS = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'enum', 'await', 'implements', 'package', 'protected', 'interface', 'private', 'public', 'null', 'true', 'false', 'ArrayBuffer', 'DataView']);

/* The class name of a struct: "ns::Name" -> "ns_Name" (see --namespace). */
export function identOf(name) {
  const id = flattenName(name).replace(/[^A-Za-z0-9_$]/g, '_');

  return RESERVED_WORDS.has(id) || /^[0-9]/.test(id) ? '_' + id : id;
}

/* `cxx`, for a C++ class bound with methods (see emit/classes.js), is
 * { ctor, members, doc }: the class then extends its base or __CxxObject,
 * which supply the constructor, at() and ptr; `ctor` (an optional named-
 * parameter constructor, first so describeClass() finds it) opens the class
 * body, `members` (method source) follows the field accessors, `doc` precedes
 * the declaration. */
function classCode(e, ir, base, cxx, opts = {}) {
  const id = identOf(e.name);
  const size = e.size === null || e.size === undefined ? null : e.size;
  const seen = new Set();
  const props = [];
  let body = '';

  if(cxx) body += cxx.ctor;
  else {
    body += '  constructor(init' + (size === null ? '' : ' = ' + size) + ') { ';
    if(size === null) body += "if(init === undefined) throw new TypeError('" + id + ": size unknown, pass a byte length'); ";
    body += "super(typeof init === 'number' ? init : init.byteLength); if(typeof init !== 'number') new Uint8Array(this).set(__bytes(init)); }\n";
    body += '  static at(p, owner, size' + (size === null ? '' : ' = ' + size) + ') { return __view(' + id + ', p, size, owner); }\n';
    if(!base) body += '  get ptr() { return __ptr(this); }\n';
  }

  for(const f of e.fields) {
    if(!f.name || seen.has(f.name) || f.static) continue;
    seen.add(f.name);

    const name = RESERVED.has(f.name) ? f.name + '_' : f.name;
    const a = accessors(f, ir);

    if(a.skipped) {
      body += '  // ' + f.name + ': ' + a.skipped + '\n';
      continue;
    }

    props.push(' * @property {' + a.type + '} ' + name + ' - ' + f.type + (f.bits !== undefined ? ', ' + f.bits + ' bits' : '') + ', offset ' + f.offset + '\n');
    body += '  get ' + name + '() { ' + oneLine(a.get) + ' }\n';
    body += '  set ' + name + '(v) { ' + oneLine(a.set) + ' }\n';
  }

  if(cxx) body += cxx.members;

  let out = '\n/* ' + e.type + ' ' + e.name + (size === null ? ', size unknown' : ', ' + size + ' bytes') + (e.line ? ' (line ' + e.line + ')' : '') + ' */\n';

  if(cxx) out += opts.jsdoc ? cxx.doc.replace(/ \*\/\n$/, props.join('') + ' */\n') : cxx.doc;
  else if(opts.jsdoc) out += '/**\n * ' + e.type + ' ' + e.name + (size === null ? '' : ', ' + size + ' bytes') + '\n * @extends {' + (base ? identOf(base.name) : 'ArrayBuffer') + '}\n * @param {number|ArrayBuffer|ArrayBufferView} ' + (size === null ? 'init' : '[init=' + size + ']') + ' - a byte length, or bytes to copy\n' + props.join('') + ' */\n';

  out += 'export class ' + id + ' extends ' + (base ? identOf(base.name) : cxx ? '__CxxObject' : 'ArrayBuffer') + ' {\n' + body + '}\n';

  if(opts.describe && !cxx) out += '__sig(' + id + ', ' + jsLiteral([{ params: ['init: number'], arity: 1 }, { params: ['init: ArrayBuffer|ArrayBufferView'], arity: 1 }]) + ');\n__sig(' + id + '.at, ' + jsLiteral([{ params: ['p: pointer', 'owner: object', 'size: number'], returnType: id, arity: 3 }]) + ');\n';
  return out;
}

/* `Name.size/align/fields`, the layout the IR gives (opts.layout). */
function layoutCode(e) {
  const id = identOf(e.name);
  const fields = {};

  e.fields.forEach((f, i) => {
    if(f.static) return;

    const x = { type: f.ffi };
    if(f.bits === undefined && f.offset != null) x.offset = f.offset;
    if(f.bits !== undefined) {
      x.bits = f.bits;
      if(f.offset != null) x.bitOffset = f.offset * 8 + f.bitOffset;
    }
    fields[f.name || '__anon' + i] = x;
  });

  return id + '.size = ' + e.size + ';\n' + id + '.align = ' + e.align + ';\n' + id + '.fields = ' + jsLiteral(fields) + ';\n';
}

/* The structs to emit, each after the one it extends. A struct extends its
 * first base when that is in the IR, public, non-virtual and at offset 0 (a
 * polymorphic class puts its vptr there, a non-polymorphic base does not). */
function plan(ir, wanted) {
  const baseOf = e => {
    const b = e.bases && e.bases[0] && e.bases[0].access === 'public' && !e.bases[0].virtual && ir.structs.get(e.bases[0].name);

    return b && !(e.polymorphic && !b.polymorphic) ? b : null;
  };
  const picked = new Set();
  const order = [];
  const visit = e => {
    if(picked.has(e.name)) return;
    picked.add(e.name);

    const b = baseOf(e);
    if(b) visit(b);

    for(const f of e.fields) {
      const arr = arrayOf(f.type);
      const rec = f.bits === undefined && f.offset !== null && (recordOf(f.type, ir) || pointeeOf(arr ? arr.elem : f.type, ir));
      if(rec && rec !== e.name && ir.structs.has(rec)) visit(ir.structs.get(rec));
    }

    order.push(e);
  };

  for(const e of ir.structs.values()) if(!wanted.length || wanted.includes(e.name)) visit(e);
  return { order, baseOf };
}

export function generate(ir, opts) {
  let out = '/* Auto-generated by qjsm gen-structs.js from ' + opts.files.join(', ') + ' -- do not edit by hand. */\n';

  out += "import { ptr as __ptr, toArrayBuffer } from 'ffi';\n" + PRELUDE + (opts.describe ? DESCRIBE_HELPERS : '');
  return out + classesCode(ir, opts);
}

/* The classes of `ir` (just `opts.structs` and what they need, if given),
 * each after the one it extends, followed by the typedef names as aliases.
 * `opts.cxx(entry)` returns { pre, members, doc, post } for an entry that is a
 * C++ class bound with methods (see classCode()); `pre`/`post` surround its
 * declaration. `opts.layout` adds size/align/fields to the other classes.
 * `opts.describe` also does, and sets Symbol.for("describe") signatures on
 * their constructor and at() (needs __sig(), see emit/describe.js);
 * `opts.jsdoc` documents every class and its members. */
export function classesCode(ir, opts) {
  const { order, baseOf } = plan(ir, opts.structs || []);
  const names = new Set(order.map(e => identOf(e.name)));
  let out = '';

  for(const e of order) {
    const cxx = opts.cxx ? opts.cxx(e) : null;

    out += (cxx ? cxx.pre : '') + classCode(e, ir, baseOf(e), cxx, opts) + (cxx ? cxx.post : (opts.layout || opts.describe) && e.size != null ? layoutCode(e) : '');
  }

  const aliases = new Set();
  const alias = (name, target) => {
    if(names.has(identOf(name)) || aliases.has(name) || !names.has(identOf(target))) return;
    aliases.add(name);
    out += 'export const ' + identOf(name) + ' = ' + identOf(target) + ';\n';
  };

  const pending = [];
  for(const e of order) for(const a of e.typedefs || []) pending.push([a, e.name]);
  for(const t of ir.typedefs.values()) if(t.record) pending.push([t.name, t.record]);

  if(pending.length) out += '\n';
  for(const [a, target] of pending) alias(a, target);

  return out;
}

/* --- C output -------------------------------------------------------------- */

/* The C declaration of member `name` of type `type`. */
function declOf(type, name) {
  const t = type.trim();
  const arr = /^(.*?)\s*((?:\[\d+\])+)$/.exec(t);

  if(arr) return arr[1] + ' ' + name + arr[2];
  if(/\(\s*\*/.test(t)) return t.replace(/\(\s*\*\s*\)/, '(*' + name + ')');
  return t + (t.endsWith('*') ? '' : ' ') + name;
}

function cStruct(e) {
  const kw = e.type === 'union' ? 'union' : 'struct';
  const seen = new Set();
  let out = kw + ' ' + e.name + ' {\n';

  for(const f of e.fields) {
    if(!f.name || seen.has(f.name) || f.static) continue;
    seen.add(f.name);
    out += '  ' + declOf(f.type, f.name) + (f.bits !== undefined ? ' : ' + f.bits : '') + ';\n';
  }

  return out + '};\n';
}

/* A C header with the structs, unions and classes (fields only) of the IR;
 * _Static_asserts pin the size and every member offset to what the IR says,
 * so a layout the compiler would choose differently fails to compile. */
export function generateC(ir, opts) {
  const { order } = plan(ir, opts.structs);
  const complete = order.filter(e => e.size !== null && e.size !== undefined);
  const used = new Set();
  let out = '/* Auto-generated by qjsm gen-structs.js from ' + opts.files.join(', ') + ' -- do not edit by hand. */\n';

  out += '#ifndef GEN_STRUCTS_H\n#define GEN_STRUCTS_H\n\n#include <stddef.h>\n#include <stdint.h>\n';

  for(const e of complete) for(const f of e.fields) for(const m of f.type.matchAll(/\benum\s+(\w+)/g)) used.add(m[1]);

  for(const en of ir.enums.values()) {
    if(!used.has(en.name)) continue;
    out += '\nenum ' + en.name + ' {\n' + en.fields.map(m => '  ' + m.name + ' = ' + m.value).join(',\n') + '\n};\n';
  }

  for(const e of order) out += '\n' + (complete.includes(e) ? cStruct(e) : (e.type === 'union' ? 'union ' : 'struct ') + e.name + ';\n');

  const typedefs = new Set();
  const names = new Set(order.map(e => e.name));
  const pending = [];

  for(const e of order) for(const a of e.typedefs || []) pending.push([a, e]);
  for(const t of ir.typedefs.values()) if(t.record && names.has(t.record)) pending.push([t.name, ir.structs.get(t.record)]);

  if(pending.length) out += '\n';
  for(const [a, e] of pending) {
    if(typedefs.has(a) || names.has(a)) continue;
    typedefs.add(a);
    out += 'typedef ' + (e.type === 'union' ? 'union ' : 'struct ') + e.name + ' ' + a + ';\n';
  }

  out += '\n';

  for(const e of complete) {
    const kw = e.type === 'union' ? 'union ' : 'struct ';
    const seen = new Set();

    out += '_Static_assert(sizeof(' + kw + e.name + ') == ' + e.size + ', "' + e.name + ' size");\n';

    for(const f of e.fields) {
      if(!f.name || seen.has(f.name) || f.static || f.bits !== undefined || f.offset === null || f.offset === undefined) continue;
      seen.add(f.name);
      out += '_Static_assert(offsetof(' + kw + e.name + ', ' + f.name + ') == ' + f.offset + ', "' + e.name + '.' + f.name + ' offset");\n';
    }
  }

  return out + '\n#endif\n';
}
