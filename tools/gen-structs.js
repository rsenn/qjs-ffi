#!/usr/bin/env qjsm
/* gen-structs.js -- generate JS struct wrappers from gen-bindings.js's
 * intermediate format (IR).
 *
 * Every struct, union and (C++) class of the IR becomes a class extending
 * ArrayBuffer, with a getter and a setter for each member at the byte offset
 * the IR gives, going through a DataView:
 *
 *   export class filter_ops extends ArrayBuffer {
 *     get size() { return __dv(this).getBigUint64(8, true); }
 *     set size(v) { __dv(this).setBigUint64(8, BigInt(v), true); }
 *     ...
 *   }
 *
 *   new filter_ops()            a zeroed buffer of the struct's size
 *   new filter_ops(buf)         a copy of the bytes of an ArrayBuffer/view
 *   filter_ops.at(ptr)          a view of C memory (not copied, not owned)
 *   s.ptr                       its address, to pass to a C function
 *
 * Members: integers and floats as Number (64-bit integers as BigInt, like the
 * ffi module's i64/u64); pointers as null, Number or BigInt (a setter also
 * takes a wrapper, an ArrayBuffer or a view); a pointer to a struct, union or
 * class of known size as null or a live wrapper of that struct over the
 * pointed-to memory (ffi's toArrayBuffer, not copied); bitfields, read and written
 * through their storage unit; arrays of scalars as live typed-array views;
 * nested structs as views onto the same memory; anything else as a Uint8Array
 * over its bytes. A member with an unknown offset is left out. Everything is
 * little-endian, like the rest of this project.
 *
 * Usage:
 *   qjsm gen-bindings.js --emit-ir=structs.json header.h
 *   qjsm gen-structs.js [options] <ir.json>...
 *
 * An IR is either gen-bindings.js's (`structs` and `classes` are used) or a
 * plain array of struct entries. Several IRs are merged, the first
 * declaration of a name winning.
 *
 * Options:
 *   --struct=<name>   only generate this struct and what it needs (repeatable)
 *   --format=js|c     JS module (default), or a C header: the structs, unions
 *                     and classes (fields only) as C definitions, followed by
 *                     _Static_asserts of their sizes and member offsets
 *   -o, --output=<path>   write the module here instead of stdout
 *   -h, --help        show this help
 */
import * as std from 'std';

function usage() {
  std.err.puts(
    'Usage: qjsm gen-structs.js [options] <ir.json>...\n' +
      '  --struct=<name>       only this struct and the ones it nests (repeatable)\n' +
      '  --format=js|c         JS module (default) or C header with the same layout\n' +
      '  -o, --output=<path>   write the module here instead of stdout\n' +
      '  -h, --help            show this help\n',
  );
}

function parseArgs(argv) {
  const opts = { files: [], structs: [], output: null, format: 'js' };

  for(let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if(a === '-h' || a === '--help') {
      usage();
      std.exit(0);
    } else if(a.startsWith('--struct=')) {
      opts.structs.push(a.slice('--struct='.length));
    } else if(a.startsWith('--format=')) {
      opts.format = a.slice('--format='.length);
      if(opts.format !== 'js' && opts.format !== 'c') throw new Error('unknown format: ' + opts.format);
    } else if(a === '-o' || a === '--output') {
      opts.output = argv[++i];
    } else if(a.startsWith('--output=')) {
      opts.output = a.slice('--output='.length);
    } else if(a.startsWith('-')) {
      throw new Error('unknown option: ' + a);
    } else {
      opts.files.push(a);
    }
  }

  if(!opts.files.length) throw new Error('missing <ir.json> argument');
  return opts;
}

/* --- the IR ---------------------------------------------------------------- */

/* { structs: [entry, ...], typedefs: [...] } of the merged IR files. */
function loadIR(files) {
  const structs = new Map();
  const typedefs = new Map();
  const enums = new Map();

  for(const file of files) {
    const text = std.loadFile(file);
    if(text === null) throw new Error('cannot read ' + file);

    const ir = JSON.parse(text);
    const entries = Array.isArray(ir) ? ir : [...(ir.structs || []), ...(ir.classes || [])];

    for(const e of entries) if(!structs.has(e.name)) structs.set(e.name, e);
    for(const t of Array.isArray(ir) ? [] : ir.typedefs || []) if(!typedefs.has(t.name)) typedefs.set(t.name, t);
    for(const en of Array.isArray(ir) ? [] : ir.enums || []) if(!enums.has(en.name)) enums.set(en.name, en);
  }

  return { structs, typedefs, enums };
}

/* --- member types ---------------------------------------------------------- */

/* Byte size of each ffi type name. */
const SIZES = { bool: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, i64: 8, u64: 8, f32: 4, f64: 8, pointer: 8 };

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
function scalarOf(ffi, type, typedefs, depth = 0) {
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
function arrayOf(type) {
  const m = /^(.*?)\s*((?:\[\d+\])+)$/.exec(type);

  return m && { elem: m[1], count: [...m[2].matchAll(/\[(\d+)\]/g)].reduce((n, d) => n * Number(d[1]), 1) };
}

/* The record `type` names (a struct/union/class keyword is optional, a
 * typedef of the record is followed), or undefined. */
function recordOf(type, ir) {
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

const PRELUDE = `
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

/* Getter and setter source of one member, or { skipped: reason }. */
function accessors(f, ir) {
  const hasType = f.size !== null && f.size !== undefined;
  const scalar = scalarOf(f.ffi, f.type, ir.typedefs);
  const arr = arrayOf(f.type);
  const at = f.offset;

  if(at === null || at === undefined) return { skipped: 'offset unknown' };

  if(f.bits !== undefined) {
    if(!scalar || scalar === 'pointer' || scalar.startsWith('f') || !hasType || f.bitOffset === null) return { skipped: 'bitfield of unknown storage' };

    return bitfield(f, scalar, at);
  }

  const pointee = scalar === 'pointer' && hasType && f.size === SIZES.pointer && f.bits === undefined && pointeeOf(f.type, ir);

  if(pointee) {
    return {
      get: 'const p = __dv(this).getBigUint64(' + at + ', true);\n    return p === 0n ? null : ' + identOf(pointee) + '.at(p);',
      set: scalarAccessors('pointer', at).set,
    };
  }

  if(scalar && hasType && f.size === SIZES[scalar]) return scalarAccessors(scalar, at);

  if(arr && hasType) {
    const elem = scalarOf(null, arr.elem, ir.typedefs);

    if(elem && elem !== 'bool' && arr.count * SIZES[elem] === f.size && at % SIZES[elem] === 0) {
      const view = 'new ' + ARRAYS[elem] + '(this, ' + at + ', ' + arr.count + ')';

      return { get: 'return ' + view + ';', set: view + '.set(v);' };
    }
  }

  const rec = recordOf(f.type, ir);

  if(rec && hasType) {
    const target = identOf(rec);

    return { get: 'return ' + target + '.at(__ptr(this, ' + at + '), this);', set: 'new Uint8Array(this, ' + at + ', ' + f.size + ').set(__bytes(v));' };
  }

  if(!hasType) return { skipped: 'size unknown' };

  return { get: 'return new Uint8Array(this, ' + at + ', ' + f.size + ');', set: 'new Uint8Array(this, ' + at + ', ' + f.size + ').set(__bytes(v));' };
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

/* The class name of a struct: "ns::Name" -> "ns_Name". */
function identOf(name) {
  const id = name.replace(/::/g, '_').replace(/[^A-Za-z0-9_$]/g, '_');

  return RESERVED_WORDS.has(id) || /^[0-9]/.test(id) ? '_' + id : id;
}

function classCode(e, ir, base) {
  const id = identOf(e.name);
  const size = e.size === null || e.size === undefined ? null : e.size;
  const seen = new Set();
  let out = '';

  out += '\n/* ' + e.type + ' ' + e.name + (size === null ? ', size unknown' : ', ' + size + ' bytes') + (e.line ? ' (line ' + e.line + ')' : '') + ' */\n';
  out += 'export class ' + id + ' extends ' + (base ? identOf(base.name) : 'ArrayBuffer') + ' {\n';
  out += '  constructor(init' + (size === null ? '' : ' = ' + size) + ') {\n';
  if(size === null) out += '    if(init === undefined) throw new TypeError("' + id + ': size unknown, pass a byte length");\n';
  out += '    super(typeof init === "number" ? init : init.byteLength);\n';
  out += '    if(typeof init !== "number") new Uint8Array(this).set(__bytes(init));\n';
  out += '  }\n\n';
  out += '  static at(p, owner, size' + (size === null ? '' : ' = ' + size) + ') {\n    return __view(' + id + ', p, size, owner);\n  }\n';
  if(!base) out += '\n  get ptr() {\n    return __ptr(this);\n  }\n';

  for(const f of e.fields) {
    if(!f.name || seen.has(f.name) || f.static) continue;
    seen.add(f.name);

    const name = RESERVED.has(f.name) ? f.name + '_' : f.name;
    const a = accessors(f, ir);

    if(a.skipped) {
      out += '\n  // ' + f.name + ': ' + a.skipped + '\n';
      continue;
    }

    out += '\n  get ' + name + '() {\n    ' + a.get + '\n  }\n';
    out += '  set ' + name + '(v) {\n    ' + a.set + '\n  }\n';
  }

  out += '}\n';
  return out;
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
      const rec = f.bits === undefined && f.offset !== null && (recordOf(f.type, ir) || pointeeOf(f.type, ir));
      if(rec && rec !== e.name) visit(ir.structs.get(rec));
    }

    order.push(e);
  };

  for(const e of ir.structs.values()) if(!wanted.length || wanted.includes(e.name)) visit(e);
  return { order, baseOf };
}

function generate(ir, opts) {
  const { order, baseOf } = plan(ir, opts.structs);
  const names = new Set(order.map(e => identOf(e.name)));
  let out = '/* Auto-generated by qjsm gen-structs.js from ' + opts.files.join(', ') + ' -- do not edit by hand. */\n';

  out += "import { ptr as __ptr, toArrayBuffer } from 'ffi';\n" + PRELUDE;

  for(const e of order) out += classCode(e, ir, baseOf(e));

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
function generateC(ir, opts) {
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

function main() {
  let opts;

  try {
    opts = parseArgs(scriptArgs.slice(1));
  } catch(e) {
    std.err.puts('gen-structs.js: ' + e.message + '\n');
    usage();
    std.exit(1);
  }

  let out;

  try {
    const ir = loadIR(opts.files);

    out = opts.format === 'c' ? generateC(ir, opts) : generate(ir, opts);
  } catch(e) {
    std.err.puts('gen-structs.js: ' + e.message + '\n');
    std.exit(1);
  }

  if(opts.output) {
    const f = std.open(opts.output, 'w');
    f.puts(out);
    f.close();
  } else {
    std.puts(out);
  }
}

main();
