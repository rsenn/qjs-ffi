import * as std from 'std';

/* How this script is invoked, for use in the usage banner and the
 * generated file's "regenerate with:" comment. Installed (via
 * CMakeLists.txt) as bin/qjs-ffi-genbindings with this shebang, so
 * scriptArgs[0] is that binary's path when run that way, or a relative
 * "tools/gen-bindings.js"-style path under `qjsm`.
 */
export function invocationName() {
  const s = (typeof scriptArgs !== 'undefined' && scriptArgs[0]) || 'gen-bindings.js';
  const base = s.replace(/.*\//, '');
  return base.endsWith('.js') ? 'qjsm ' + s : base;
}

/* every option, once: the parser and the help text are made from this.
 *
 *   names     the spellings, long ones first; -X takes its value
 *             attached (-Idir) or as the next argument (-I dir)
 *   arg       the value's name in the help; without it the option is a flag
 *   key       the opts property it sets
 *   list      the value is added to an array
 *   set       what a flag stores (default true)
 *   def       the default of `key` (false, null with `arg`, [] a list)
 *   next      --name may take the next argument as its value
 *   optional  --name alone is allowed and stores true
 *   help      one line for --help
 */
const OPTIONS = [
  { names: ['--follow-includes'], key: 'followIncludes', help: "also bind headers included from under each source's directory" },
  { names: ['--ffitype'], key: 'ffiType', help: 'write types as FFIType.i32 instead of "i32"' },
  { names: ['--structs'], key: 'structs', help: 'also wrap structs/unions as ArrayBuffer classes, and extern variables' },
  { names: ['--class-types'], key: 'classTypes', help: 'with --structs and C++ classes: pass the generated class as the type of a "T *" argument or return, not "T *" (needs a qjs-ffi that takes a constructor as a type)' },
  { names: ['--target'], arg: '<runtime>', key: 'target', def: 'qjs', help: 'the runtime the module is for: qjs (default) bun (bun:ffi), deno (Deno.dlopen) or node (node:ffi, Node 26); all need --library' },
  { names: ['--describe'], key: 'describe', help: 'name parameters in signatures, attach types as fn[Symbol.for("describe")]' },
  { names: ['--finalize'], key: 'finalize', help: 'also destroy C++ objects made with new when they are garbage collected' },
  { names: ['--jsdoc'], key: 'jsdoc', help: 'JSDoc comments with parameter and return types on functions, methods, classes' },
  { names: ['--exclude'], arg: '<name>', key: 'excludes', list: true, help: 'do not bind this function (repeatable)' },
  { names: ['--c++'], key: 'cxx', help: 'parse every source as C++ (implied by .cc/.cpp/.cxx/.hh/.hpp/.hxx)' },
  { names: ['--std'], arg: '<std>', key: 'std', help: 'C++ standard for clang, e.g. c++17 (C++ sources only)' },
  { names: ['--namespace'], arg: '<name>', key: 'namespaces', list: true, help: 'drop the C++ namespace prefix from names (stk::Foo -> Foo, not stk_Foo), repeatable' },
  { names: ['-I', '--include'], arg: '<dir>', key: 'includes', list: true, help: 'extra clang include dir (repeatable)' },
  { names: ['-D', '--define'], arg: '<name[=val]>', key: 'defines', list: true, help: 'extra clang macro define (repeatable)' },
  { names: ['--library'], arg: '<path>', key: 'library', help: 'dlopen() this shared library instead of RTLD_DEFAULT' },
  { names: ['--clang'], arg: '<path>', key: 'clang', def: 'clang', help: 'clang binary to invoke (default: clang)' },
  { names: ['--emit-ir'], arg: '<file>', key: 'emitIr', help: 'write the intermediate JSON and stop' },
  { names: ['--emit-specs'], arg: '<file>', key: 'emitSpecs', optional: true, help: 'write the dlopen() symbol specs and stop; without a file to stdout, as a JS module unless --json' },
  { names: ['--js'], key: 'js', help: 'write --emit-ir/--emit-specs output as a JS module (export default)' },
  { names: ['--json'], key: 'json', help: 'write it as JSON (the default, except for a bare --emit-specs)' },
  { names: ['--from-ir'], arg: '<file>', key: 'fromIr', help: 'generate from this IR (JSON, or JS from --js) instead of running clang' },
  { names: ['--cache-dir'], arg: '<dir>', key: 'cacheDir', def: '.tmp/gen-bindings', help: 'condensed-AST cache directory (default: .tmp/gen-bindings)' },
  { names: ['--no-cache'], key: 'cache', set: false, def: true, help: 'ignore and do not write the condensed-AST cache' },
  { names: ['--no-auto-include'], key: 'autoInclude', set: false, def: true, help: 'do not add -I for a header clang could not find (it is only a warning)' },
  { names: ['-o', '--output'], arg: '<path>', key: 'output', next: true, help: 'write generated JS here instead of stdout' },
  { names: ['-h', '--help'], key: 'help', help: 'show this help' },
];

/* the spelling of an option in the help: --std=<std>, -I<dir>, --js. */
const spell = (o, n) => (o.arg ? (n.startsWith('--') ? (o.optional ? n + '[=' + o.arg + ']' : n + '=' + o.arg) : n + ' ' + o.arg) : n);

/* the help text, one line per option. */
export function usage() {
  const rows = OPTIONS.map(o => [o.names.map(n => spell(o, n)).join(', '), o.help]);
  const width = Math.max(...rows.map(r => r[0].length));

  std.err.puts('Usage: ' + invocationName() + ' [options] <source.c>... | --from-ir=<ir.json>\n' + rows.map(([flags, help]) => '  ' + flags.padEnd(width + 2) + help + '\n').join(''));
}

/* the option `arg` spells, with its value, or null. `next` gives the
 * following argument for an option that takes it. */
function matchOption(arg, next) {
  for(const o of OPTIONS) {
    for(const n of o.names) {
      if(!o.arg) {
        if(arg === n) return { o };
      } else if(n.startsWith('--')) {
        if(arg.startsWith(n + '=')) return { o, value: arg.slice(n.length + 1) };
        if(arg === n && o.optional) return { o, value: true };
        if(arg === n && o.next) return { o, value: next() };
      } else if(arg.startsWith(n)) {
        return { o, value: arg.length > n.length ? arg.slice(n.length) : next() };
      }
    }
  }

  return null;
}

export function parseArgs(argv) {
  const opts = {};

  for(const o of OPTIONS) opts[o.key] = 'def' in o ? o.def : o.list ? [] : o.arg ? null : false;

  opts.sources = [];

  for(let i = 0; i < argv.length; i++) {
    const m = matchOption(argv[i], () => argv[++i]);

    if(m) {
      if(m.o.key === 'help') {
        usage();
        std.exit(0);
      }

      if(m.o.key === 'emitSpecs' && m.value === '') throw new Error('--emit-specs= needs a file name');

      if(m.o.list) opts[m.o.key].push(m.value);
      else opts[m.o.key] = m.o.arg ? m.value : 'set' in m.o ? m.o.set : true;
    } else if(argv[i].startsWith('-')) {
      throw new Error('unknown option: ' + argv[i]);
    } else {
      opts.sources.push(argv[i]);
    }
  }

  if(opts.fromIr && opts.sources.length) throw new Error('--from-ir takes no <source.c> arguments');
  if(opts.fromIr && opts.emitIr) throw new Error('--from-ir and --emit-ir cannot be combined');
  if((opts.js || opts.json) && !opts.emitIr && !opts.emitSpecs) throw new Error('--js and --json need --emit-ir or --emit-specs');
  if(opts.js && opts.json) throw new Error('--js and --json cannot be combined');
  if(opts.emitIr && opts.emitSpecs) throw new Error('--emit-ir and --emit-specs cannot be combined');
  if(!['qjs', 'bun', 'deno', 'node'].includes(opts.target)) throw new Error('--target must be qjs, bun, deno or node, not ' + opts.target);
  if(opts.target !== 'qjs' && !opts.emitIr && !opts.emitSpecs) {
    const rt = { bun: 'bun:ffi', deno: 'Deno.dlopen', node: 'node:ffi' }[opts.target];

    if(!opts.library) throw new Error('--target=' + opts.target + ' needs --library=<path>: ' + rt + ' has no RTLD_DEFAULT');
    if(opts.finalize) throw new Error('--finalize needs calloc() and free() from libc, which ' + rt + ' cannot look up');
    if(opts.classTypes) throw new Error('--class-types needs a constructor as a type, which ' + rt + ' does not take');
  }
  if(!opts.fromIr && !opts.sources.length) throw new Error('missing <source.c> argument');

  return opts;
}
