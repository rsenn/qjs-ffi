#!/usr/bin/env qjsm
/* describe.js -- list what a module, an object or a class exports or
 * has, using describeClass()/describeObject() (copied from qjs-modules
 * lib/, defined below).
 *
 * It runs unchanged under QuickJS (qjsm or qjs), Node.js, Bun and Deno, so the
 * same dump can be made of the same API in each of them and compared; see
 * describe.sh, which starts the runtime of your choice.
 *
 * Usage:
 *   describe.js [--json] [--js] [--class] <module> [export...]
 *   describe.js [--json] [--js] [--class] --global [name...]
 *
 * <module> is a file (a path, or anything with a .js, .mjs, .ts, .so or .node
 * extension) or a specifier the runtime can import: 'node:fs', 'bun:ffi', or
 * 'ffi' for a QuickJS module on QUICKJS_MODULE_PATH. Without export names every
 * export is described; a name may be a dotted path ('read.u8', 'default.ptr').
 *
 * --global describes properties of globalThis instead of a module's exports
 * ('Bun', 'process.versions', 'Buffer'); without names, globalThis itself.
 *
 * --class describes a function as a class unless it is plain: its prototype
 * inherits straight from Object.prototype and has no member but `constructor`.
 * That is what a native constructor (Buffer, Map) needs where the source does
 * not start with `class`. A function whose prototype has members of its own
 * is shown as a class without the flag.
 *
 * --json prints the raw describe results instead of the summary.
 *
 * --js prints a skeleton of the module as JavaScript: the classes, functions
 * and objects with empty bodies, `export function f(a, b) {}`.
 *
 * --probe only tries to load <module>: no output, status 0 if it loads, 1 if
 * not (describe.sh uses it to find the runtimes that have a module).
 *
 * With --describe, a generated binding's functions and classes also carry their
 * C types (Symbol.for('describe')), which are shown; otherwise only the
 * parameter names JavaScript knows. Importing a binding loads the shared
 * libraries it binds, so they have to be found (QUICKJS_MODULE_PATH for 'ffi').
 */
const SIG = Symbol.for('describe');

/* --- describeClass / describeObject ---------------------------------------- */

export function paramNames(fn) {
  const src = Function.prototype.toString.call(fn);
  const match = /^class[\s{]/.test(src) ? src.match(/\bconstructor\s*\(([^)]*)\)/) : src.match(/^[^(]*\(([^)]*)\)/);
  if(!match) return [];
  return match[1]
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => p.replace(/=.*$/, '').replace(/\{.*$/, '{...}').replace(/\[.*$/, '[...]').trim());
}

export function describeFunction(fn, key) {
  const src = Function.prototype.toString.call(fn);
  const signatures = fn[SIG];

  return {
    name: key,
    kind: /^class\s/.test(src) ? 'class' : /^async\s*(function\s*)?\*/.test(src) ? 'async-generator' : /^(function\s*)?\*/.test(src) ? 'generator' : /^async\s/.test(src) ? 'async' : 'function',
    params: paramNames(fn),
    arity: fn.length,
    ...(signatures && { signatures }),
  };
}

function symbolName(sym) {
  for(const key of Object.getOwnPropertyNames(Symbol)) if(Symbol[key] === sym) return `Symbol.${key}`;

  return sym.toString();
}

export function describeMembers(o) {
  const skip = typeof o === 'function' ? ['constructor', 'prototype', 'length', 'name'] : ['constructor'];
  const members = { methods: [], getters: [], setters: [], fields: [] };

  function process(key, label) {
    const desc = Object.getOwnPropertyDescriptor(o, key);
    if(desc.get || desc.set) {
      if(desc.get) members.getters.push(label);
      if(desc.set) members.setters.push(label);
    } else if(typeof desc.value === 'function') {
      members.methods.push(describeFunction(desc.value, label));
    } else {
      members.fields.push({ name: label, type: typeof desc.value, value: desc.value });
    }
  }

  for(const key of Object.getOwnPropertyNames(o)) {
    if(skip.includes(key)) continue;
    process(key, key);
  }
  for(const sym of Object.getOwnPropertySymbols(o)) process(sym, symbolName(sym));

  return members;
}

export function describeClass(Ctor, opts = {}) {
  if(typeof Ctor !== 'function') throw new TypeError('describeClass expects a class/constructor function');

  const result = {
    name: Ctor.name || '(anonymous)',
    constructorParams: paramNames(Ctor),
    ...(Ctor[SIG] && { constructorSignatures: Ctor[SIG] }),
    staticChain: [],
    prototypeChain: [],
  };

  let sctor = Ctor;
  let sdepth = 0;
  while(sctor && sctor !== Function.prototype && sdepth < 20) {
    result.staticChain.push({
      level: sdepth,
      constructorName: sctor.name || '(anonymous)',
      ...describeMembers(sctor),
    });
    sctor = Object.getPrototypeOf(sctor);
    sdepth++;
  }

  let proto = Ctor.prototype;
  let depth = 0;
  while(proto && proto !== Object.prototype && depth < 20) {
    result.prototypeChain.push({
      level: depth,
      constructorName: proto.constructor?.name || '(anonymous)',
      ...describeMembers(proto),
    });
    proto = Object.getPrototypeOf(proto);
    depth++;
  }

  if(opts.instance) result.instanceFields = describeMembers(opts.instance).fields;

  return result;
}

export function describeObject(obj, opts = {}) {
  if(obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) throw new TypeError('describeObject expects an object or function');

  const result = {
    name: (typeof obj === 'function' ? obj.name : obj.constructor?.name) || '(anonymous)',
    type: typeof obj,
    ...describeMembers(obj),
    prototypeChain: [],
  };

  if(typeof obj === 'function') result.constructorParams = paramNames(obj);

  let proto = Object.getPrototypeOf(obj), depth = 0;

  while(proto && proto !== Object.prototype && proto !== Function.prototype && depth < 20) {
    result.prototypeChain.push({
      level: depth,
      constructorName: proto.constructor?.name || '(anonymous)',
      ...describeMembers(proto),
    });
    proto = Object.getPrototypeOf(proto);
    depth++;
  }

  return result;
}

/* --- the runtime ----------------------------------------------------------- */

const runtime = typeof Deno !== 'undefined' ? 'deno' : typeof Bun !== 'undefined' ? 'bun' : typeof scriptArgs !== 'undefined' ? 'quickjs' : typeof process !== 'undefined' && process.versions && process.versions.node ? 'node' : 'unknown';

function argv() {
  switch(runtime) {
    case 'deno': return Deno.args;
    case 'quickjs': return scriptArgs.slice(1);
    default: return process.argv.slice(2);
  }
}

/* Where an uncaught problem ends up, and with which status: exit() only for a
 * failure, so that output still being written is not cut off. */
async function exit(code) {
  switch(runtime) {
    case 'deno': Deno.exit(code); break;
    case 'quickjs': (await import('std')).exit(code); break;
    default: process.exitCode = code;
  }
}

/* qjs has no console.error. */
async function eprint(text) {
  if(typeof console.error === 'function') console.error(text);
  else (await import('std')).err.puts(text + '\n');
}

async function fail(message) {
  await eprint('describe.js: ' + message);
  return exit(1);
}

async function cwd() {
  switch(runtime) {
    case 'deno': return Deno.cwd();
    case 'quickjs': return (await import('os')).getcwd()[0];
    default: return process.cwd();
  }
}

const isPath = s => /^\.{0,2}\//.test(s) || (/\.(m?js|cjs|m?ts|so|dll|node)$/.test(s) && !/^[a-z][a-z0-9+.-]*:/i.test(s));

/* Loads the module `target`. A path is made absolute first (a relative
 * specifier would be taken relative to this script). A native addon that
 * `import` refuses is loaded the way `require` would. */
export async function load(target) {
  if(!isPath(target)) return import(target);

  const dir = await cwd();
  const path = target.startsWith('/') ? target : dir.replace(/\/$/, '') + '/' + target.replace(/^\.\//, '');

  if(runtime === 'quickjs') {
    const [real, err] = (await import('os')).realpath(path);
    if(err) throw new Error('cannot find ' + target);
    return import(real);
  }

  try {
    return await import('file://' + path);
  } catch(e) {
    if(!/\.(so|node)$/.test(path) || !process.dlopen) throw e;

    const m = { exports: {} };
    process.dlopen(m, path);
    return m.exports;
  }
}

/* --- describing ------------------------------------------------------------ */

/* A class by its source, or a function whose prototype holds members: a
 * native constructor and an old-style `function Foo() {}` with methods on
 * Foo.prototype are classes too. */
function isClass(v) {
  if(typeof v !== 'function') return false;
  if(/^class[\s{]/.test(Function.prototype.toString.call(v))) return true;

  const p = v.prototype;
  return p !== null && typeof p === 'object' && Object.getOwnPropertyNames(p).length > 1;
}

/* { variant: 'async' } and so on for an async or generator function; {} for a plain one. */
function variantOf(v) {
  const kind = describeFunction(v, '').kind;

  return kind === 'function' || kind === 'class' ? {} : { variant: kind };
}

/* a function with nothing on its prototype: { constructor } and no parent. */
function isPlain(v) {
  const p = v.prototype;
  return p === undefined || p === null || (Object.getPrototypeOf(p) === Object.prototype && Object.getOwnPropertyNames(p).join(',') === 'constructor');
}

export function describeAny(v, asClass) {
  if(typeof v === 'function' && (isClass(v) || (asClass && !isPlain(v)))) return { kind: 'class', ...describeClass(v) };
  if(typeof v === 'function') return { kind: 'function', ...describeObject(v), ...variantOf(v), arity: v.length, native: /\[native code\]/.test(Function.prototype.toString.call(v)), signatures: v[SIG] };
  if(v !== null && typeof v === 'object') return { kind: 'object', ...describeObject(v) };

  return { kind: 'value', type: v === null ? 'null' : typeof v, value: v };
}

const replacer = (k, x) => (typeof x === 'bigint' ? x + 'n' : x);
const EMPTY_OMIT = new Set(['constructorParams', 'fields', 'getters', 'methods', 'prototypeChain', 'setters']);
const jsonReplacer = (k, x) => (Array.isArray(x) && x.length === 0 && EMPTY_OMIT.has(k) ? undefined : replacer(k, x));

function short(v) {
  let s;

  try {
    s = typeof v === 'bigint' ? v + 'n' : typeof v === 'string' ? JSON.stringify(v) : typeof v === 'object' && v !== null ? JSON.stringify(v, replacer) : String(v);
  } catch(e) {
    s = '[' + (v && v.constructor && v.constructor.name) + ']';
  }

  if(s === undefined) s = String(v);
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
}

/* `name(p: type, ...): returns`, one line per overload when the signatures are
 * known, else `name(a, b)` from the JavaScript parameters. A native function
 * (a CFunction) has no parameter names, only the count its length gives. */
function signature(name, params, signatures, native, arity) {
  if(!signatures) return [name + '(' + (native && !params.length ? (arity === 1 ? '1 arg' : arity + ' args') : params.join(', ')) + ')'];

  return signatures.map(s => name + '(' + s.params.join(', ') + ')' + (s.returnType ? ': ' + s.returnType : ''));
}

function members(level, prefix = '') {
  const out = [];

  for(const m of level.methods) for(const l of signature(m.name, m.params, m.signatures, false)) out.push(prefix + l);

  const accessors = [...new Set([...level.getters, ...level.setters])];

  for(const a of accessors) out.push(prefix + a + ' (' + [level.getters.includes(a) ? 'get' : '', level.setters.includes(a) ? 'set' : ''].filter(Boolean).join('/') + ')');
  for(const f of level.fields) if(!f.name.startsWith('__') && f.name !== 'Symbol(describe)') out.push(prefix + f.name + ': ' + f.type + ' = ' + short(f.value));

  return out;
}

/* --- JavaScript skeleton (--js) -------------------------------------------- */

const IDENT = /^[A-Za-z_$][\w$]*$/;
const RESERVED = /^(break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|this|throw|true|try|typeof|var|void|while|with|yield|let|static|await|async)$/;
const quoteStr = v => "'" + v.replace(/[\\'\n\r]/g, c => (c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\' + c)) + "'";

/* a member name as it stands in a class or object body: `name`, `[Symbol.iterator]` or `'a-b'`. */
const keyOf = name => (IDENT.test(name) ? name : /^Symbol\./.test(name) ? '[' + name + ']' : quoteStr(name));

/* the parameter list `a, b`: names JavaScript knows, else `arg0..arg<arity-1>`; a name that is not an identifier (`{...}`) becomes `arg<i>`. */
function paramList(params, arity = 0, signatures) {
  const names = signatures && signatures.length ? signatures[0].params : params;
  const list = names.length ? names : Array.from({ length: arity }, (_, i) => 'arg' + i);

  return list.map((n, i) => (IDENT.test(n) ? n : 'arg' + i)).join(', ');
}

/* a field's value as a literal: 42, 'text', 10n, null; `{}` for any object. */
function literal(f) {
  switch(f.type) {
    case 'string': return quoteStr(f.value);
    case 'bigint': return f.value + 'n';
    case 'number': return Number.isFinite(f.value) ? String(f.value) : Number.isNaN(f.value) ? 'NaN' : f.value > 0 ? 'Infinity' : '-Infinity';
    case 'boolean': return String(f.value);
    case 'undefined': return 'undefined';
    case 'symbol': return 'Symbol()';
    default: return f.value === null ? 'null' : '{}';
  }
}

/* one function or method: `async *name(a, b) {}`; `static` prefixes it in a class body. */
function methodLine(m, prefix) {
  const mark = { async: 'async ', generator: '*', 'async-generator': 'async *' }[m.kind] || '';

  return prefix + mark + keyOf(m.name) + '(' + paramList(m.params, m.arity, m.signatures) + ') {}';
}

/* the members of one level (a prototype or a static object), as lines of a class (`;` ends a field) or of an object (`,` does). */
function memberLines(level, indent, { inClass, isStatic }) {
  const out = [];
  const end = inClass ? ';' : ',';
  const pre = indent + (isStatic ? 'static ' : '');

  for(const f of level.fields) {
    if(f.name.startsWith('__') || f.name === 'Symbol(describe)') continue;
    out.push(pre + keyOf(f.name) + (inClass ? ' = ' : ': ') + literal(f) + end);
  }

  for(const m of level.methods) {
    if(m.kind === 'class') out.push(pre + keyOf(m.name) + (inClass ? ' = ' : ': ') + 'class {}' + end);
    else out.push(methodLine(m, pre) + (inClass ? '' : ','));
  }

  for(const a of new Set([...level.getters, ...level.setters])) {
    if(level.getters.includes(a)) out.push(pre + 'get ' + keyOf(a) + '() {}' + (inClass ? '' : ','));
    if(level.setters.includes(a)) out.push(pre + 'set ' + keyOf(a) + '(value) {}' + (inClass ? '' : ','));
  }

  return out;
}

/* the skeleton of one export, as `export ...` lines; `default` uses `export default`, and a reserved word such as `in` becomes `const _in = ...; export { _in as in };`. */
function skeletonOf(name, d) {
  const last = name.split('.').pop();
  const dflt = last === 'default';
  const reserved = !dflt && RESERVED.test(last);
  const id = reserved ? '_' + last : last;
  const ex = dflt ? 'export default ' : reserved ? '' : 'export ';
  const lines = skeletonBody(d, id, dflt, ex);

  return reserved ? [...lines, 'export { ' + id + ' as ' + last + ' };'] : lines;
}

function skeletonBody(d, id, dflt, ex) {

  switch(d.kind) {
    case 'value':
      return [ex + (dflt ? '' : 'const ' + id + ' = ') + literal(d) + ';'];

    case 'function': {
      const kw = { async: 'async function', generator: 'function*', 'async-generator': 'async function*' }[d.variant] || 'function';

      return [ex + kw + (dflt ? '' : ' ' + id) + '(' + paramList(d.constructorParams || [], d.arity, d.signatures) + ') {}'];
    }

    case 'object': {
      const body = memberLines(d, '  ', { inClass: false, isStatic: false });

      return [ex + (dflt ? '' : 'const ' + id + ' = ') + (body.length ? '{\n' + body.join('\n') + '\n}' : '{}') + ';'];
    }
  }

  const parent = d.prototypeChain[1] && d.prototypeChain[1].constructorName;
  const ctor = d.constructorSignatures ? paramList([], 0, d.constructorSignatures) : paramList(d.constructorParams, 0);
  const body = [
    '  constructor(' + ctor + ') {}',
    ...(d.staticChain[0] ? memberLines(d.staticChain[0], '  ', { inClass: true, isStatic: true }) : []),
    ...(d.prototypeChain[0] ? memberLines(d.prototypeChain[0], '  ', { inClass: true, isStatic: false }) : []),
  ];

  return [ex + 'class' + (dflt ? '' : ' ' + id) + (parent && IDENT.test(parent) ? ' extends ' + parent : '') + ' {\n' + body.join('\n') + '\n}'];
}

/* the whole module as JS source with empty bodies: `export function f(a, b) {}`, `export class X extends Y {...}`. */
export function skeleton(described) {
  return Object.entries(described).flatMap(([name, d]) => skeletonOf(name, d)).join('\n\n') + '\n';
}

function show(name, d) {
  switch(d.kind) {
    case 'value':
      return ['const ' + name + ': ' + d.type + ' = ' + short(d.value)];

    case 'function':
      return signature(name, d.constructorParams, d.signatures, d.native, d.arity).map(l => 'function ' + l);

    case 'object':
      return ['object ' + name + ' (' + d.methods.length + ' methods, ' + d.fields.length + ' fields)', ...members(d, '  ')];
  }

  const chain = [d.name, ...d.prototypeChain.slice(1).map(p => p.constructorName)].join(' > ');
  const ctors = d.constructorSignatures ? d.constructorSignatures.map(s => 'new ' + d.name + '(' + s.params.join(', ') + ')') : ['new ' + d.name + '(' + d.constructorParams.join(', ') + ')'];
  const own = d.prototypeChain[0] ? members(d.prototypeChain[0], '  ') : [];
  const statics = d.staticChain[0] ? members(d.staticChain[0], '  static ') : [];
  const inherited = d.prototypeChain.slice(1).map(p => '  inherited from ' + p.constructorName + ': ' + p.methods.length + ' methods, ' + new Set([...p.getters, ...p.setters]).size + ' accessors');

  return ['class ' + chain, ...ctors.map(c => '  ' + c), ...statics, ...own, ...inherited];
}

/* The value at a dotted path: a key of `root` itself wins over a path. */
export function lookup(root, path) {
  if(Object.prototype.hasOwnProperty.call(root, path) || path in Object(root)) return root[path];

  let v = root;

  for(const key of path.split('.')) {
    if(v === null || v === undefined) throw new Error('no such export: ' + path);
    v = v[key];
  }

  if(v === undefined) throw new Error('no such export: ' + path);
  return v;
}

function usage() {
  return eprint(
    'Usage: describe.js [--json] [--js] [--class] <module> [export...]\n' +
      '       describe.js [--json] [--js] [--class] --global [name...]\n' +
      '       describe.js --probe <module>   (exit status only)\n' +
      '  <module>   a file, or a specifier the runtime imports (node:fs, bun:ffi, ffi)\n' +
      '  export     a name or dotted path to describe; all exports by default\n' +
      '  --global   describe globalThis properties (Bun, process.versions, Buffer) instead\n' +
      '  --class    describe a function as a class unless its prototype is plain\n' +
      '  --json     print the raw describeClass()/describeObject() results\n' +
      '  --js       print a skeleton of the module as JavaScript, bodies empty\n',
  );
}

async function main() {
  const flags = new Set();
  const positional = [];

  for(const a of argv()) {
    if(/^--(json|js|class|global|probe)$/.test(a)) flags.add(a.slice(2));
    else if(a === '-h' || a === '--help') flags.add('help');
    else if(a.startsWith('--')) return fail('unknown option: ' + a);
    else positional.push(a);
  }

  const global = flags.has('global');
  const [target, ...names] = global ? [undefined, ...positional] : positional;

  if(flags.has('help') || (!global && !target)) {
    await usage();
    return exit(flags.has('help') ? 0 : 1);
  }

  let root, label, all;

  if(global) {
    root = globalThis;
    label = runtime + ' globalThis';
    all = names.length ? names : ['globalThis'];
  } else {
    try {
      root = await load(target);
    } catch(e) {
      return flags.has('probe') ? exit(1) : fail('cannot load ' + target + ': ' + (e && e.message));
    }

    if(flags.has('probe')) return;

    label = target;
    all = names.length ? names : Object.keys(root);
  }

  const described = {};

  for(const name of all) {
    let v;

    try {
      v = lookup(root, name);
    } catch(e) {
      return fail(e.message);
    }

    described[name] = describeAny(v, flags.has('class'));
  }

  if(flags.has('js')) {
    console.log(skeleton(described).trimEnd());
    return;
  }

  if(flags.has('json')) {
    console.log(JSON.stringify(described, jsonReplacer, 2));
    return;
  }

  const count = kind => Object.values(described).filter(d => d.kind === kind).length;

  console.log(label + ' [' + runtime + ']: ' + all.length + ' ' + (global ? 'entries' : 'exports') + ' (' + ['class', 'function', 'object', 'value'].map(k => count(k) + ' ' + k).join(', ') + ')');

  for(const [name, d] of Object.entries(described)) for(const l of show(name, d)) console.log(l);
}

/* main() runs only when this file is the script being started, not when it is
 * imported; qjsm reports import.meta.main false, so it compares file names. */
const script = typeof scriptArgs !== 'undefined' ? scriptArgs[0] : import.meta.main === undefined ? process.argv[1] : undefined;
const isMain = script !== undefined ? script.split(/[\\/]/).pop() === import.meta.url.split('/').pop() : import.meta.main;

/* runs the command line (bin/qjs-ffi-describe.js calls this). */
export const run = () => main().catch(e => fail(e && e.stack ? e.stack : String(e)));

if(isMain) run();
