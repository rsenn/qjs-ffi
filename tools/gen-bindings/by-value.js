import { SIZES, arrayOf, bunLike } from './ffi-types.js';
import { scalarOf, recordOf, mergeIRs, identOf } from './emit/structs.js';
import { hidesSize } from './emit/common.js';

/* Structs passed or returned by value. CFunction takes such a type as an array
 * of the struct's members' types in memory order (a nested struct a nested
 * array, an array member its element repeated), and libffi derives the layout
 * and the register classes from that alone. So a list that does not reproduce
 * the real layout is silently wrong, which is why elementsOf() lays the list
 * out the way libffi does and gives up unless every member lands on the offset
 * the IR has and the size matches. 64-bit little-endian, like the rest of the
 * project.
 */

const alignUp = (n, a) => Math.ceil(n / a) * a;

/* The libffi size and alignment of an element: a type name or a nested list. */
function infoOf(el) {
  if(typeof el === 'string') return { size: SIZES[el], align: SIZES[el] };

  let at = 0;
  let align = 1;

  for(const e of el) {
    const i = infoOf(e);

    at = alignUp(at, i.align) + i.size;
    align = Math.max(align, i.align);
  }

  return { size: alignUp(at, align), align };
}

const MAX_DEPTH = 8;

/* Past this size a struct is passed and returned in memory, whatever its
 * members are (x86-64 SysV, aarch64 and win64 alike), so only its size and the
 * offsets matter. */
const MEMORY_CLASS = 16;

/* Integer elements covering the bytes [from, to), each aligned where it sits. */
function pieces(from, to) {
  const out = [];

  for(let b = from; b < to; ) {
    const n = [8, 4, 2, 1].find(n => b % n === 0 && b + n <= to);

    out.push({ off: b, size: n, elems: ['u' + 8 * n] });
    b += n;
  }

  return out;
}

/* The element list of struct entry `rec`, or { reason }; `opaque` says some
 * member (an anonymous struct or a union, which the IR does not describe) is
 * only covered by integer pieces, so the list is good for a struct of
 * MEMORY_CLASS bytes or more only. */
function elementsOf(rec, index, memo, depth = 0) {
  if(memo.has(rec.name)) return memo.get(rec.name);

  const fail = reason => ({ reason });
  const result = (() => {
    if(depth >= MAX_DEPTH) return fail('nested more than ' + MAX_DEPTH + ' deep');
    if(rec.type !== 'struct') return fail(rec.type + ' is not supported');
    if(rec.size === null || rec.size === undefined) return fail('size unknown');

    const spans = [];
    const bitBytes = new Set();
    let opaque = false;

    for(const f of rec.fields) {
      if(f.static) continue;
      if(f.offset === null || f.offset === undefined) return fail('member ' + f.name + ': offset unknown');

      if(f.bits !== undefined) {
        const start = f.offset * 8 + f.bitOffset;

        for(let b = Math.floor(start / 8); b <= Math.floor((start + f.bits - 1) / 8); b++) bitBytes.add(b);
        continue;
      }

      if(f.size === null || f.size === undefined) return fail('member ' + f.name + ': size unknown');

      const arr = arrayOf(f.type);
      const elemType = arr ? arr.elem : f.type;
      const count = arr ? arr.count : 1;
      const nested = recordOf(elemType, index);
      const nestedRec = nested && index.structs.get(nested);
      let el;

      if(nestedRec && nestedRec.type === 'struct') {
        const r = elementsOf(nestedRec, index, memo, depth + 1);

        if(r.reason) return fail('member ' + f.name + ': ' + r.reason);
        if(r.opaque) opaque = true;
        el = r.elements;
      } else if((nestedRec && nestedRec.type === 'union') || /^(struct|union)\b/.test(elemType.trim())) {
        opaque = true;
        spans.push(...pieces(f.offset, f.offset + f.size).map(p => ({ ...p, name: f.name })));
        continue;
      } else {
        el = scalarOf(arr ? null : f.ffi, elemType, index.typedefs);
        if(!(el in SIZES)) return fail('member ' + f.name + ' has type ' + f.type);
      }

      if(infoOf(el).size * count !== f.size) return fail('member ' + f.name + ': size ' + f.size + ' is not ' + count + ' of its element');

      spans.push({ off: f.offset, size: f.size, name: f.name, elems: Array.from({ length: count }, () => el) });
    }

    spans.sort((a, b) => a.off - b.off);

    for(let i = 1; i < spans.length; i++) if(spans[i].off < spans[i - 1].off + spans[i - 1].size) return fail('members overlap');
    for(const s of spans) for(let b = s.off; b < s.off + s.size; b++) if(bitBytes.has(b)) return fail('a bitfield shares bytes with member ' + s.name);

    const items = [...spans];

    for(let b = 0; b < rec.size; ) {
      if(!bitBytes.has(b)) {
        b++;
        continue;
      }

      let end = b;

      while(bitBytes.has(end)) end++;

      items.push(...pieces(b, end).map(p => ({ ...p, name: 'a bitfield' })));
      b = end;
    }

    items.sort((a, b) => a.off - b.off);

    const elements = [];
    let at = 0;
    let align = 1;

    for(const it of items) {
      for(const [i, el] of it.elems.entries()) {
        const info = infoOf(el);
        const placed = alignUp(at, info.align);

        if(placed !== (i === 0 ? it.off : at)) return fail('libffi would put ' + it.name + ' at ' + placed + ', not ' + it.off);

        elements.push(el);
        at = placed + info.size;
        align = Math.max(align, info.align);
      }
    }

    if(alignUp(at, align) !== rec.size) return fail('size ' + rec.size + ' where libffi computes ' + alignUp(at, align));

    return { elements, opaque };
  })();

  memo.set(rec.name, result);
  return result;
}

/* Sets `opts.structClasses`, struct name -> class identifier, for the structs
 * with a class in the output (--structs): a function returning one of them by
 * value then returns that class, otherwise the bare ArrayBuffer. */
export function prepareByValue(ir, opts) {
  opts.structClasses = new Map(opts.structs ? ir.structs.filter(s => s.type === 'struct' && s.size != null).map(s => [s.name, identOf(s.name)]) : []);
}

/* For bun:ffi, which passes no struct by value and has no varargs: moves
 * every function and method that takes or returns a struct, or is
 * variadic, to ir.skipped. For target `deno` only the variadic ones move. */
export function dropForBun(ir, target) {
  const byValue = e => [e.returns, ...e.args.map(a => a.slice(a.indexOf(': ') + 2))].some(t => t && t.startsWith('struct ') && !t.endsWith('*'));
  const keep = (list, label) =>
    list.filter(e => {
      const rt = target === 'deno' ? 'deno' : target === 'node' ? 'node:ffi' : 'bun:ffi';
      const reason = target !== 'deno' && byValue(e) ? 'a struct passed or returned by value is not supported by ' + rt : e.variadic ? 'a variadic function is not supported by ' + rt : null;

      if(reason) ir.skipped.push({ name: label(e), reason });
      return !reason;
    });

  ir.methods = keep(ir.methods, e => e.name);

  for(const c of ir.classes || []) {
    c.methods = keep(c.methods, e => c.name + '::' + e.name);
    c.constructors = keep(c.constructors, e => c.name + '::' + e.name);
  }
}

/* Sets `opts.classMap` with --class-types or --target=bun: { idents, aliases }, the
 * record name -> class identifier of every struct, union and bound C++ class
 * that has a generated class, and typedef name -> record name. cfType() then
 * writes the identifier for a "T *" of such a record.
 *
 * ```js
 * // `typedef struct pt pt_t;`, `struct pt` has the class `pt`
 * // "pt *" and "pt_t *" are both the constructor `pt`
 * ```
 *
 *   object  ir       the IR; its structs and typedefs
 *   object  opts     gets `classMap` (unset without either)
 *   array   classes  the bound C++ classes (bindable().classes) */
export function prepareClassTypes(ir, opts, classes) {
  if(!opts.classTypes && !bunLike(opts)) return;

  const idents = new Map();
  const aliases = new Map();

  for(const s of opts.structs ? ir.structs : []) if(s.size != null) idents.set(s.name, identOf(s.name));
  for(const c of classes) if(c.size != null && !hidesSize(c)) idents.set(c.name, identOf(c.name));
  for(const t of ir.typedefs || []) if(t.record && idents.has(t.record)) aliases.set(t.name, t.record);

  // clang spells a reference parameter inside a namespace unqualified:
  // "Shape *" for geo::Shape, so a short name that is unique is an alias
  const shorts = new Map();

  for(const name of idents.keys()) {
    const short = name.slice(name.lastIndexOf('::') + 2);

    shorts.set(short, shorts.has(short) ? null : name);
  }

  for(const [short, name] of shorts) if(name && !idents.has(short) && !aliases.has(short)) aliases.set(short, name);

  opts.classMap = { idents, aliases };
}

/* Settles the struct types functions have by value (see mapCType()): each is
 * either a plain C struct whose layout elementsOf() can reproduce, which then
 * is `struct NAME` in the entry's types, with its element list in
 * `ir.byValue[NAME]`, or the function is moved to `ir.skipped` with the
 * reason it would have had without by-value support.
 */
export function resolveByValue(ir, opts) {
  const index = mergeIRs([{ structs: ir.structs, classes: [], typedefs: ir.typedefs || [], enums: [] }]);
  const memo = new Map();

  ir.byValue = ir.byValue || {};

  /* The reason the entry cannot be bound, or null once its types are settled. */
  const settle = entry => {
    if(!entry.byValue) return null;

    for(const b of entry.byValue) {
      const where = b.at < 0 ? 'return type' : 'parameter ' + entry.args[b.at].slice(0, entry.args[b.at].indexOf(': '));
      const name = recordOf(b.name, index);
      const rec = name && index.structs.get(name);

      if(!rec) return where + ': ' + b.reason;

      const r = elementsOf(rec, index, memo);

      if(r.reason) return where + ': struct ' + name + ' passed by value: ' + r.reason;
      if(r.opaque && rec.size <= MEMORY_CLASS) return where + ': struct ' + name + ' passed by value: a member is an anonymous struct or union, whose layout matters up to ' + MEMORY_CLASS + ' bytes';

      ir.byValue[name] = r.elements;

      if(b.at < 0) entry.returns = 'struct ' + name;
      else entry.args[b.at] = entry.args[b.at].slice(0, entry.args[b.at].indexOf(': ') + 2) + 'struct ' + name;
    }

    delete entry.byValue;
    return null;
  };

  const keep = (list, label) =>
    list.filter(entry => {
      const reason = settle(entry);

      if(reason) ir.skipped.push({ name: label(entry), reason });
      return !reason;
    });

  ir.methods = keep(ir.methods, e => e.name);

  for(const c of ir.classes || []) {
    c.methods = keep(c.methods, e => c.name + '::' + e.name);
    c.constructors = keep(c.constructors, e => c.name + '::' + e.name);
  }
}
