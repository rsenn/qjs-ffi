#!/usr/bin/env qjsm
/* describe-module.js -- list what a JS binding module exports, using
 * describeClass()/describeObject() (describe/, copied from qjs-modules lib/).
 * The module is one gen-bindings.js wrote or one from lib/; with --describe
 * its functions and classes also carry their C types (Symbol.for('describe'),
 * merged by those two as `signatures`/`constructorSignatures`), which are
 * shown here, otherwise only the parameter names JavaScript knows.
 *
 * Usage:
 *   qjsm describe-module.js [--json] <module.js> [export...]
 *
 * Without export names every export is described. --json prints the raw
 * describe results instead of the summary. Importing the module loads the
 * shared libraries it binds, so QUICKJS_MODULE_PATH has to find 'ffi' and the
 * libraries have to be there. See describe-module.sh.
 */
import * as std from 'std';
import { realpath } from 'os';
import { describeClass } from './describe/describe-class.js';
import { describeObject } from './describe/describe-object.js';

function usage() {
  std.err.puts('Usage: qjsm describe-module.js [--json] <module.js> [export...]\n' + '  --json   print the raw describeClass()/describeObject() results\n');
}

const SIG = Symbol.for('describe');

const isClass = v => typeof v === 'function' && /^class\s/.test(Function.prototype.toString.call(v));

function describeAny(v) {
  if(isClass(v)) return { kind: 'class', ...describeClass(v) };
  if(typeof v === 'function') return { kind: 'function', ...describeObject(v), arity: v.length, native: /\[native code\]/.test(Function.prototype.toString.call(v)), signatures: v[SIG] };
  if(v !== null && typeof v === 'object') return { kind: 'object', ...describeObject(v) };

  return { kind: 'value', type: v === null ? 'null' : typeof v, value: v };
}

function short(v) {
  const s = typeof v === 'bigint' ? v + 'n' : typeof v === 'string' ? JSON.stringify(v) : typeof v === 'object' && v !== null ? JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x + 'n' : x)) : String(v);

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

async function main() {
  const args = scriptArgs.slice(1);
  const json = args.includes('--json');
  const [file, ...names] = args.filter(a => a !== '--json');

  if(!file || file === '-h' || file === '--help') {
    usage();
    std.exit(file ? 0 : 1);
  }

  const [path, err] = realpath(file);

  if(err) {
    std.err.puts('describe-module.js: cannot find ' + file + '\n');
    std.exit(1);
  }

  let mod;

  try {
    mod = await import(path);
  } catch(e) {
    std.err.puts('describe-module.js: cannot load ' + file + ': ' + (e && e.message) + '\n');
    std.exit(1);
  }

  const all = Object.keys(mod);
  const unknown = names.filter(n => !all.includes(n));

  if(unknown.length) {
    std.err.puts('describe-module.js: no such export: ' + unknown.join(', ') + '\n');
    std.exit(1);
  }

  const described = Object.fromEntries((names.length ? names : all).map(n => [n, describeAny(mod[n])]));

  if(json) {
    console.log(JSON.stringify(described, (k, v) => (typeof v === 'bigint' ? v + 'n' : v), 2));
    return;
  }

  const count = kind => Object.values(described).filter(d => d.kind === kind).length;

  console.log(file + ': ' + Object.keys(described).length + ' exports (' + ['class', 'function', 'object', 'value'].map(k => count(k) + ' ' + k).join(', ') + ')');

  for(const [name, d] of Object.entries(described)) for(const l of show(name, d)) console.log(l);
}

main();
