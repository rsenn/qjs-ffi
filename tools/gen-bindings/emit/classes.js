import { safeIdent, flattenName, paramTypes, paramNames, widest, jsLiteral, memberAccess, cfType, wrapReturn, legacyType } from './common.js';
import { sigCode } from './describe.js';
import { jsDoc } from './jsdoc.js';
import { classesCode as structClasses, mergeIRs } from '../structs.js';

/* Runtime support for the generated C++ classes, emitted verbatim after
 * VIEW_HELPERS. A class's `__info` is { size, ctors, dtor, zeroInit }; ctors
 * and methods are overload lists of { n: arity, t: param types, f: lazily
 * bound function }, picked by arity and then by argument type. Functions are
 * bound on first call because an inline member often has no exported symbol.
 */
const CLASS_HELPERS = `
const __deleted = new WeakSet();

function __lazy(f) {
  let v;
  return () => (v === undefined ? (v = f()) : v);
}

function __accepts(t, v) {
  if(t.endsWith("*")) t = "pointer";
  else if(t.startsWith("struct ")) return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
  switch(t) {
    case "bool": return typeof v === "boolean" || typeof v === "number";
    case "i8": case "u8": case "i16": case "u16": case "i32": case "u32": case "i64": case "u64": case "i64_fast": case "u64_fast":
      return typeof v === "bigint" || (typeof v === "number" && Number.isInteger(v));
    case "f32": case "f64": return typeof v === "number";
    case "cstring": return v === null || typeof v === "string";
    case "pointer": case "ptr": case "function": return v === null || ["object", "function", "number", "bigint"].includes(typeof v);
  }
  return true;
}

function __invoke(list, self, args) {
  if(__deleted.has(self)) throw new Error("object was deleted");

  const same = list.filter(e => e.n === args.length);
  const m = same.length === 1 ? same[0] : same.find(e => e.t.every((t, i) => __accepts(t, args[i])));
  if(!m) throw new TypeError("no overload takes " + args.length + " argument(s) like these");

  return self === undefined ? m.f()(...args) : m.f()(self, ...args);
}

/* A call through slot \`slot\` of the vtable the object's first word points to,
 * so what the object's real class overrides runs, whatever class wraps it. */
function __virtual(slot, spec) {
  const cache = new Map();

  return (self, ...args) => {
    const vptr = __rd.u64(self, 0);

    if(vptr === 0n) throw new Error("object has no vtable");

    const fp = __rd.u64(vptr + BigInt(8 * slot), 0);
    let f = cache.get(fp);

    if(!f) cache.set(fp, (f = CFunction({ ptr: fp, ...spec })));
    return f(self, ...args);
  };
}
`;

/* The root class of the generated ones. An object made with \`new\` owns
 * ArrayBuffer memory, and only delete() runs its destructor. */
const CXX_OBJECT = `
class __CxxObject extends ArrayBuffer {
  constructor(...args) {
    const info = new.target.__info;

    if(!info.ctors && !info.zeroInit) throw new TypeError(new.target.name + " cannot be constructed");

    super(info.size);
    if(info.ctors) __invoke(info.ctors, this, args);
  }

  get ptr() { return __ptr(this); }

  static at(p, owner) { return __view(this, p, this.__info.size, owner); }

  static from(p) { return this.at(p); }

  delete() {
    if(__deleted.has(this)) return;

    const dtor = this.constructor.__info.dtor;
    if(dtor) dtor()(this);
    __deleted.add(this);
  }
}
`;

/* --finalize: an object made with \`new\` is also destroyed when it is garbage
 * collected. A FinalizationRegistry callback gets what was registered, not
 * the object, whose memory would be gone, so the object lives in calloc'd
 * memory the wrapper only views, and the callback runs the destructor on a
 * view of its own (unless delete() did) and frees it. delete() keeps the memory
 * until then, so a field read after it stays valid. Callbacks run on a later
 * turn of the event loop, not inside the collection. */
const CXX_OBJECT_FINALIZED = `
const __calloc = CFunction({ ptr: dlsym(RTLD_DEFAULT, "calloc"), args: ["u64", "u64"], returns: "pointer" });
const __free = CFunction({ ptr: dlsym(RTLD_DEFAULT, "free"), args: ["pointer"], returns: "void" });
const __owned = new WeakMap();

const __finalizer = new FinalizationRegistry(h => {
  try {
    if(!h.destroyed) {
      h.destroyed = true;
      if(h.dtor) h.dtor()(toArrayBuffer(BigInt(h.ptr), 0, h.size));
    }
  } finally {
    __free(h.ptr);
  }
});

class __CxxObject extends ArrayBuffer {
  constructor(...args) {
    const info = new.target.__info;

    if(!info.ctors && !info.zeroInit) throw new TypeError(new.target.name + " cannot be constructed");

    const p = __calloc(1, info.size);

    if(p === null) throw new Error("out of memory");

    const self = __view(new.target, p, info.size);

    try {
      if(info.ctors) __invoke(info.ctors, self, args);
    } catch(e) {
      __free(p);
      throw e;
    }

    const h = { ptr: p, size: info.size, dtor: info.dtor, destroyed: false };

    __owned.set(self, h);
    __finalizer.register(self, h);
    return self;
  }

  get ptr() { return __ptr(this); }

  static at(p, owner) { return __view(this, p, this.__info.size, owner); }

  static from(p) { return this.at(p); }

  delete() {
    if(__deleted.has(this)) return;

    const dtor = this.constructor.__info.dtor;
    if(dtor) dtor()(this);
    __deleted.add(this);

    const h = __owned.get(this);
    if(h) h.destroyed = true;
  }
}
`;

/* Members the generated class defines itself, so a C++ member of the same
 * name is exported with a leading underscore. */
const CLASS_RESERVED_MEMBERS = new Set(['constructor', 'ptr', 'from', 'at', 'delete', 'byteLength', 'maxByteLength', 'resizable', 'resize', 'slice', 'transfer', 'transferToFixedLength', 'detached', 'toString', 'valueOf']);

/* One CFunction()/__bind() expression for a constructor, method or
 * destructor symbol; `thisType` ("ns::Class *"), if given, is the type of the
 * implicit `this` pointer prepended to the parameters. With a vtable `slot`
 * (--api=cfunction) the call goes through the object's vtable instead, to
 * whatever overrides the method in the object's real class. */
function classFn(symbol, entry, thisType, opts, slot) {
  const cf = [...(thisType ? [thisType] : []), ...paramTypes(entry)];
  const def = cf.map(legacyType);
  const virtual = slot !== undefined && opts.api !== 'define';

  if(opts.api === 'define') return '__bind(' + jsLiteral(symbol) + ',' + jsLiteral(legacyType(entry.returns || 'void')) + def.map(t => ',' + jsLiteral(t)).join('') + ')';

  const types = 'args:[' + cf.map(t => cfType(t, opts)).join(',') + '],returns:' + cfType(entry.returns || 'void', opts);

  return wrapReturn(entry.returns, virtual ? '__virtual(' + slot + ',{' + types + '})' : 'CFunction({ptr:__sym(' + jsLiteral(symbol) + '),' + types + '})', opts);
}

/* `const NAME = [ { n, t, f }, ... ];`, one element per overload. */
function overloadList(name, entries, thisType, opts) {
  return 'const ' + name + ' = [\n' + entries.map(e => '  {n:' + e.args.length + ',t:' + jsLiteral(paramTypes(e)) + ',f:__lazy(()=>' + classFn(e.mangledName, e, thisType, opts, e.vtableSlot) + ')},\n').join('') + '];\n';
}

/* With every class listed after the class it extends. A class extends its
 * first base only when that base is bound too and sits at offset 0 (a
 * polymorphic class puts its vptr there, so a non-polymorphic base does
 * not); other bases are left out, as the `this` adjustment for them is not
 * supported.
 */
function orderClasses(classes) {
  const byName = new Map(classes.map(c => [c.name, c]));
  const baseOf = c => {
    const b = c.bases[0] && c.bases[0].access === 'public' && !c.bases[0].virtual && byName.get(c.bases[0].name);
    return b && !(c.polymorphic && !b.polymorphic) ? b : null;
  };
  const sorted = [];
  const visit = c => {
    if(sorted.includes(c)) return;
    const b = baseOf(c);
    if(b) visit(b);
    sorted.push(c);
  };

  classes.forEach(visit);
  return { sorted, baseOf };
}

/* The C++ classes of the IR as JS classes extending each other like their C++
 * counterparts (single inheritance). `new Class(...)` allocates `size` bytes
 * and runs the complete-object constructor; `.delete()` runs the destructor
 * and drops the storage; `Class.from(ptr)` wraps an existing object without
 * owning it. Virtual methods are bound to the class's own symbol, i.e. called
 * non-virtually.
 *
 * With --structs the plain structs and unions of `ir` are emitted too, as
 * ArrayBuffer classes (see classesCode() in ../structs.js, which emits both
 * kinds in dependency order).
 */
export function classesCode(ir, classes, opts, cxxFunctions) {
  const plain = opts.structs ? ir.structs.filter(s => s.size != null) : [];

  if(!classes.length && !cxxFunctions.length && !plain.length) return '';

  let out = '';

  if(classes.length || cxxFunctions.length) out += CLASS_HELPERS + (opts.finalize && classes.length ? CXX_OBJECT_FINALIZED : CXX_OBJECT);
  if(classes.length || plain.length) out += '\n// classes and structs\n';

  const { baseOf } = orderClasses(classes);
  const known = new Set(classes.map(c => c.name));
  const byName = new Map(classes.map(c => [c.name, c]));
  const cxx = e => (byName.has(e.name) ? classPieces(byName.get(e.name)) : null);

  out += structClasses(mergeIRs([{ structs: plain, classes, typedefs: ir.typedefs || [], enums: ir.enums || [] }]), { cxx, layout: true, describe: opts.describe, jsdoc: opts.jsdoc });

  return out + cxxFunctionsCode(cxxFunctions, opts, known);

  function classPieces(c) {
    const id = safeIdent(flattenName(c.name));
    const prefix = '__' + id + '_';
    const base = baseOf(c);
    const thisType = c.name + ' *';
    const member = n => (CLASS_RESERVED_MEMBERS.has(n) ? '_' + n : n);
    const methods = c.methods.filter(m => !m.pure || m.vtableSlot !== undefined);
    const names = kind => [...new Set(methods.filter(m => !!m.static === (kind === 's')).map(m => m.name))];
    let body = '';
    let out = '';

    if(c.abstract && c.methods.some(m => m.pure && m.vtableSlot === undefined)) out += '// ' + c.name + ' is abstract: its pure virtual methods without a vtable slot have no symbol and are left to subclasses.\n';
    if(c.bases.length > (base ? 1 : 0)) out += '// ' + c.name + ': not extending ' + c.bases.slice(base ? 1 : 0).map(b => b.name).join(', ') + ' (only a single public, non-virtual base at offset 0 is supported).\n';

    if(c.constructors.length) out += overloadList(prefix + 'ctor', c.constructors, thisType, opts);

    const sigs = [];

    const ctor = opts.describe && c.constructors.length ? '  constructor(' + paramNames(widest(c.constructors)).join(', ') + ') { super(...arguments); }\n' : '';

    for(const kind of ['m', 's']) {
      for(const name of names(kind)) {
        const overloads = methods.filter(m => m.name === name && !!m.static === (kind === 's'));
        const list = prefix + kind + '_' + name;
        const self = kind === 's' ? 'undefined' : 'this';

        out += overloadList(list, overloads, kind === 'm' ? thisType : null, opts);

        if(opts.jsdoc) body += jsDoc([c.name + '::' + name + (kind === 's' ? ' (static)' : '')], overloads, known, '  ');

        if(opts.describe) {
          body += '  ' + (kind === 's' ? 'static ' : '') + member(name) + '(' + paramNames(widest(overloads)).join(', ') + ') { return __invoke(' + list + ', ' + self + ', [...arguments]); }\n';
          sigs.push(sigCode(id + (kind === 's' ? '' : '.prototype') + memberAccess(member(name)), overloads));
        } else body += '  ' + (kind === 's' ? 'static ' : '') + member(name) + '(...args) { return __invoke(' + list + ', ' + self + ', args); }\n';
      }
    }

    const doc = opts.jsdoc ? jsDoc(['C++ class ' + c.name + (c.abstract ? ' (abstract)' : ''), ...(base ? ['@extends {' + safeIdent(flattenName(base.name)) + '}'] : [])], c.constructors, known, '', false) : '';
    const pre = out;

    out = '';
    if(opts.describe && c.constructors.length) sigs.push(sigCode(id, c.constructors));
    out += sigs.join('');

    const dtor = c.destructor && (c.destructor.mangledName || c.destructor.vtableSlot !== undefined) ? '__lazy(()=>' + classFn(c.destructor.mangledName, { args: [] }, thisType, opts, c.destructor.vtableSlot) + ')' : 'null';
    const zeroInit = !c.constructors.length && !c.abstract && !c.polymorphic;
    out += id + '.__info = { size: ' + c.size + ', ctors: ' + (c.constructors.length ? prefix + 'ctor' : 'null') + ', dtor: ' + dtor + (zeroInit ? ', zeroInit: true' : '') + ' };\n';

    for(const f of c.fields) {
      if(f.static) {
        if(f.const && f.value !== undefined) out += 'Object.defineProperty(' + id + ', ' + jsLiteral(f.name) + ', { value: ' + jsLiteral(f.value) + ', enumerable: true });\n';
        else {
          const v = prefix + 'v_' + f.name;

          out += 'const ' + v + ' = __lazy(()=>__variable(' + jsLiteral(f.mangledName) + ',' + jsLiteral(f.ffi) + '));\n';
          out += 'Object.defineProperty(' + id + ', ' + jsLiteral(f.name) + ', { enumerable: true, get: () => ' + v + '().value, set: x => { ' + v + '().value = x; } });\n';
        }
      }
    }

    return { pre, ctor, members: body, doc, post: out };
  }
}

/* One `export const ns_fn = (...args) => ...` per qualified name, dispatching
 * its overloads like a class method does (see __invoke). */
function cxxFunctionsCode(functions, opts, known) {
  if(!functions.length) return '';

  const groups = new Map();
  for(const f of functions) groups.set(f.name, [...(groups.get(f.name) || []), f]);

  let out = '\n// C++ functions\n';

  for(const [name, list] of groups) {
    const id = safeIdent(flattenName(name));

    out += overloadList('__fn_' + id, list, null, opts);

    if(opts.jsdoc) out += jsDoc([name], list, known, '');
    if(opts.describe) out += 'export function ' + id + '(' + paramNames(widest(list)).join(', ') + ') { return __invoke(__fn_' + id + ', undefined, [...arguments]); }\n' + sigCode(id, list);
    else out += 'export const ' + id + ' = (...args) => __invoke(__fn_' + id + ', undefined, args);\n';
  }

  return out;
}
