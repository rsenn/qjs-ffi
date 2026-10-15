import { paramTypes, paramNames, bindable } from './common.js';
import { mapCType } from '../types.js';

/* Per-function wrappers around a CFunction, for what a C signature cannot
 * say. All four are chosen by function name on the command line:
 *
 *   --cstring=<fn>             the return `unsigned char *` is a string
 *   --handle=<type>:<dtor>     a `type *` is an object that calls dtor() when
 *                              it is closed or garbage collected
 *   --out=<fn>:<arg>           `arg` is an out-parameter: the wrapper makes
 *                              the cell and returns what the C function stored
 *   --owned-return=<fn>[:dtor] the returned `char *` is copied, then freed
 *                              with dtor() (default: libc free)
 *
 * qjs target only, free C functions only (not C++ methods). */

/* the type behind one star: "sqlite3 **" -> "sqlite3 *", "int *" -> "int". */
const pointee = t => t.replace(/\s*\*$/, '').trim();

/* "const struct sqlite3 *" -> "sqlite3", or null when `t` is not `NAME *`. */
function handleName(t) {
  const m = /^(?:const\s+)?(?:struct\s+)?([A-Za-z_]\w*)\s*\*$/.exec(t.trim());

  return m && m[1];
}

/* the read of out cell `__o<k>` (8 bytes) of ffi type `cf`, as JS source. */
function readCell(cf, k) {
  const cell = '__o' + k;
  const view = { bool: 'Uint8', i8: 'Int8', u8: 'Uint8', i16: 'Int16', u16: 'Uint16', i32: 'Int32', u32: 'Uint32', i64: 'BigInt64', i64_fast: 'BigInt64', u64: 'BigUint64', u64_fast: 'BigUint64', f32: 'Float32', f64: 'Float64' }[cf];

  if(cf === 'bool') return '__rdcell(' + cell + ', "Uint8") != 0';
  if(view) return '__rdcell(' + cell + ', "' + view + '")';
  return (cf === 'cstring' ? '__cstrcell' : '__ptrcell') + '(' + cell + ')';
}

const INTEGER = new Set(['i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64', 'i64_fast', 'u64_fast']);

/* What to wrap function `fn` with, or null when it needs nothing:
 * { args, outs: [{ index, name, cf, handle }], handleReturn, owned, status }
 * or { error }. `typedefs` is name -> C type, for the out-parameters. */
function planOf(fn, opts, typedefs) {
  const types = paramTypes(fn);
  const names = paramNames(fn);
  const wanted = opts.outMap.get(fn.name) || [];
  const rawNames = fn.args.map(p => p.slice(0, p.indexOf(': ')));
  const plan = { args: [], outs: [], handleReturn: null, owned: null, status: false };

  for(const w of wanted) if(!rawNames.includes(w)) return { error: fn.name + ' has no parameter "' + w + '" (--out): ' + rawNames.join(', ') };

  types.forEach((t, i) => {
    if(wanted.includes(rawNames[i])) {
      if(!t.endsWith('*')) return void (plan.error = plan.error || fn.name + ': --out parameter ' + rawNames[i] + ' is "' + t + '", not a pointer');

      const inner = pointee(t);
      const h = handleName(inner);
      const handle = h && opts.handleMap.has(h) ? h : null;
      const m = inner.endsWith('*') ? { cf: handle ? 'pointer' : mapCType(inner, typedefs).cf } : mapCType(inner, typedefs);

      if(!m.cf || m.cf.startsWith('struct ') || m.cf === 'void') return void (plan.error = plan.error || fn.name + ': --out parameter ' + rawNames[i] + ' points to "' + inner + '", which has no cell type');

      plan.outs.push({ index: i, name: names[i], cf: m.cf, handle });
      plan.args.push({ out: plan.outs.length - 1 });
      return;
    }

    const h = handleName(t);

    plan.args.push(h && opts.handleMap.has(h) ? { handle: h, name: names[i] } : { name: names[i] });
  });

  if(plan.error) return { error: plan.error };

  const rh = handleName(fn.returns);

  if(rh && opts.handleMap.has(rh) && fn.returns.endsWith('*')) plan.handleReturn = rh;

  if(opts.ownedMap.has(fn.name)) {
    if(plan.handleReturn || plan.outs.length) return { error: fn.name + ': --owned-return cannot combine with --handle returns or --out' };
    if(!/^(?:const\s+)?(?:unsigned\s+|signed\s+)?char\s*\*$/.test(fn.returns) && fn.returns !== 'cstring') return { error: fn.name + ': --owned-return needs a char * return, not "' + fn.returns + '"' };

    plan.owned = opts.ownedMap.get(fn.name) || 'free';
  }

  if(plan.outs.length) {
    if(fn.returns === 'void') plan.status = false;
    else if(INTEGER.has(fn.returns)) plan.status = true;
    else return { error: fn.name + ': --out needs a void or integer status return, not "' + fn.returns + '"' };
  }

  const used = plan.outs.length || plan.handleReturn || plan.owned || plan.args.some(a => a.handle);

  return used || opts.destructors.has(fn.name) ? plan : null;
}

/* The wrapper plans of every function of `ir` that has one, as a Map
 * name -> plan, and the errors found: [{ message }]. */
export function wrapperPlans(ir, opts) {
  const { functions } = bindable(ir, opts);
  const typedefs = Object.fromEntries((ir.typedefs || []).map(t => [t.name, t.resolved || t.cType]));
  const byName = new Map(functions.map(f => [f.name, f]));
  const plans = new Map();
  const errors = [];

  for(const [type, dtor] of opts.handleMap) if(!byName.has(dtor)) errors.push('--handle=' + type + ':' + dtor + ': no function "' + dtor + '" to close it with');
  for(const [fn, dtor] of opts.ownedMap) {
    if(!byName.has(fn)) errors.push('--owned-return=' + fn + ': no such function');
    else if(dtor && !byName.has(dtor)) errors.push('--owned-return=' + fn + ':' + dtor + ': no function "' + dtor + '" to free with');
  }
  for(const fn of opts.outMap.keys()) if(!byName.has(fn)) errors.push('--out=' + fn + ': no such function');
  for(const fn of opts.cstrings) if(!byName.has(fn)) errors.push('--cstring=' + fn + ': no such function');

  for(const f of functions) {
    const plan = planOf(f, opts, typedefs);

    if(plan && plan.error) errors.push(plan.error);
    else if(plan) plans.set(f.name, plan);
  }

  return { plans, errors };
}

/* `fn` as the user calls it: the --out parameters are gone. */
export function publicFunction(fn, plan) {
  if(!plan || !plan.outs.length) return fn;

  const gone = new Set(plan.outs.map(o => o.index));

  return { ...fn, args: fn.args.filter((_, i) => !gone.has(i)) };
}

/* The expression of the wrapper for `fn`, an arrow function around `raw`
 * (the name of the CFunction constant). */
export function wrapperCode(fn, plan, raw, opts) {
  const params = plan.args.filter(a => a.out === undefined).map(a => a.name);
  const callArgs = plan.args.map(a => (a.out !== undefined ? '__o' + a.out : a.handle ? '__unh(' + a.name + ')' : a.name));
  const call = raw + '(' + callArgs.join(', ') + ')';
  const dtorOf = h => '__raw_' + opts.handleMap.get(h);
  let body = '';

  if(opts.destructors.has(fn.name) && !plan.outs.length) {
    // the destructor of a handle: closing the object is what frees it
    const first = plan.args[0];

    body = 'if(' + first.name + ' instanceof __Handle) return ' + first.name + '.close();\n    return ' + raw + '(' + callArgs.join(', ') + ');';
  } else if(plan.owned) {
    const free = plan.owned === 'free' ? '__libc_free' : '__raw_' + plan.owned;

    body = 'const p = ' + raw + '(' + callArgs.join(', ') + ');\n    if(p === null) return null;\n    try { return __cstr(p); } finally { ' + free + '(p); }';
  } else if(plan.outs.length) {
    const values = plan.outs.map((o, k) => {
      const v = readCell(o.cf, k);

      return o.handle ? '__handle(' + v + ', ' + dtorOf(o.handle) + ')' : v;
    });
    const result = values.length === 1 ? values[0] : '[' + values.join(', ') + ']';

    body = plan.outs.map((_, k) => 'const __o' + k + ' = new ArrayBuffer(8);\n    ').join('') + 'const rc = ' + call + ';\n    const out = ' + result + ';\n';
    if(plan.status) body += '    if(rc != 0) {\n      for(const v of [].concat(out)) if(v instanceof __Handle) v.close();\n      throw __failed(' + JSON.stringify(fn.name) + ', rc);\n    }\n';
    body += '    return out;';
  } else if(plan.handleReturn) {
    body = 'return __handle(' + call + ', ' + dtorOf(plan.handleReturn) + ');';
  } else {
    body = 'return ' + call + ';';
  }

  // the raw pointer type of an owned return is read here, not by the CFunction
  return '(' + params.join(', ') + ') => {\n    ' + body + '\n  }';
}

/* the support code of the wrappers; `plans` says which parts are used. */
export function wrapperHelpers(opts, plans) {
  const list = [...plans.values()];
  const anyOut = list.some(p => p.outs.length);
  const anyHandle = opts.handleMap.size > 0;
  const anyOwned = list.some(p => p.owned);
  let out = '\n';

  if(anyHandle) {
    out += `/* a closable object for a \`T *\`: close() calls the destructor once, and so
 * does the garbage collector (on a later turn of the event loop). */
const __hreg = new FinalizationRegistry(([destroy, p]) => {
  try { destroy(p); } catch(e) {}
});

class __Handle {
  #p;
  #destroy;

  constructor(p, destroy) {
    this.#p = p;
    this.#destroy = destroy;
    __hreg.register(this, [destroy, p], this);
  }

  get ptr() { return this.#p; }
  get closed() { return this.#p === null; }
  valueOf() { return this.#p; }

  close() {
    const p = this.#p;

    if(p === null) return undefined;
    this.#p = null;
    __hreg.unregister(this);
    return this.#destroy(p);
  }
}

const __handle = (p, destroy) => (p === null ? null : new __Handle(p, destroy));
const __unh = h => (h instanceof __Handle ? h.ptr : h);
`;
  }

  if(anyOut) {
    out += `
function __failed(name, rc) {
  return Object.assign(new Error(name + " failed: " + rc), { code: rc });
}

const __rdcell = (cell, type) => new DataView(cell)["get" + type](0, true);
const __ptrcell = cell => {
  const v = new DataView(cell).getBigUint64(0, true);

  return v === 0n ? null : Number(v);
};
const __cstrcell = cell => {
  const p = __ptrcell(cell);

  return p === null ? null : __cstr(p);
};
`;
  }

  if(anyOwned && list.some(p => p.owned === 'free')) out += '\nconst __libc_free = CFunction({ ptr: dlsym(RTLD_DEFAULT, "free"), args: ["void *"], returns: "void" });\n';

  return out;
}
