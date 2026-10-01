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

export function usage() {
  std.err.puts(
    'Usage: ' +
      invocationName() +
      ' [options] <source.c>... | --from-ir=<ir.json>\n' +
      '  --api=cfunction|define   which qjs-ffi API to target (default: cfunction)\n' +
      "  --follow-includes        also bind headers included from under each source's directory\n" +
      '  --ffitype                write types as FFIType.i32 instead of "i32" (cfunction API only)\n' +
      '  --structs                also wrap structs/unions as ArrayBuffer classes, and extern variables\n' +
      '  --describe               name parameters in signatures, attach types as fn[Symbol.for("describe")]\n' +
      '  --jsdoc                  JSDoc comments with parameter and return types on functions, methods, classes\n' +
      '  --exclude=<name>         do not bind this function(repeatable)\n' +
      '  --c++                    parse every source as C++ (implied by .cc/.cpp/.cxx/.hh/.hpp/.hxx)\n' +
      '  --std=<std>              C++ standard for clang, e.g. c++17 (C++ sources only)\n' +
      '  -I<dir>                 extra clang include dir (repeatable)\n' +
      '  -D<name[=val]>           extra clang macro define (repeatable)\n' +
      '  --library=<path>         dlopen() this shared library instead of RTLD_DEFAULT\n' +
      '  --clang=<path>           clang binary to invoke (default: clang)\n' +
      '  --emit-ir=<file>         write the intermediate JSON and stop\n' +
      '  --from-ir=<file>         generate from this IR instead of running clang\n' +
      '  --cache-dir=<dir>        condensed-AST cache directory (default: .tmp/gen-bindings)\n' +
      '  --no-cache               ignore and do not write the condensed-AST cache\n' +
      '  -o, --output=<path>      write generated JS here instead of stdout\n' +
      '  -h, --help               show this help\n',
  );
}

export function parseArgs(argv) {
  const opts = {
    api: 'cfunction',
    includes: [],
    defines: [],
    library: null,
    clang: 'clang',
    output: null,
    sources: [],
    followIncludes: false,
    excludes: [],
    ffiType: false,
    structs: false,
    describe: false,
    jsdoc: false,
    cxx: false,
    std: null,
    emitIr: null,
    fromIr: null,
    cacheDir: '.tmp/gen-bindings',
    cache: true,
  };

  for(let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if(a === '-h' || a === '--help') {
      usage();
      std.exit(0);
    } else if(a.startsWith('--api=')) {
      opts.api = a.slice('--api='.length);
    } else if(a.startsWith('--exclude=')) {
      opts.excludes.push(a.slice('--exclude='.length));
    } else if(a === '--ffitype') {
      opts.ffiType = true;
    } else if(a === '--structs') {
      opts.structs = true;
    } else if(a === '--describe') {
      opts.describe = true;
    } else if(a === '--jsdoc') {
      opts.jsdoc = true;
    } else if(a === '--c++') {
      opts.cxx = true;
    } else if(a.startsWith('--std=')) {
      opts.std = a.slice('--std='.length);
    } else if(a === '--follow-includes') {
      opts.followIncludes = true;
    } else if(a.startsWith('-I')) {
      opts.includes.push(a.slice(2) || argv[++i]);
    } else if(a.startsWith('--include=')) {
      opts.includes.push(a.slice('--include='.length));
    } else if(a.startsWith('-D')) {
      opts.defines.push(a.slice(2) || argv[++i]);
    } else if(a.startsWith('--define=')) {
      opts.defines.push(a.slice('--define='.length));
    } else if(a.startsWith('--library=')) {
      opts.library = a.slice('--library='.length);
    } else if(a.startsWith('--emit-ir=')) {
      opts.emitIr = a.slice('--emit-ir='.length);
    } else if(a.startsWith('--from-ir=')) {
      opts.fromIr = a.slice('--from-ir='.length);
    } else if(a.startsWith('--cache-dir=')) {
      opts.cacheDir = a.slice('--cache-dir='.length);
    } else if(a === '--no-cache') {
      opts.cache = false;
    } else if(a.startsWith('--clang=')) {
      opts.clang = a.slice('--clang='.length);
    } else if(a === '-o' || a === '--output') {
      opts.output = argv[++i];
    } else if(a.startsWith('--output=')) {
      opts.output = a.slice('--output='.length);
    } else if(a.startsWith('-')) {
      throw new Error('unknown option: ' + a);
    } else {
      opts.sources.push(a);
    }
  }

  if(opts.api !== 'cfunction' && opts.api !== 'define') throw new Error('--api must be "cfunction" or "define", got: ' + opts.api);
  if(opts.ffiType && opts.api !== 'cfunction') throw new Error('--ffitype only applies to --api=cfunction');
  if(opts.fromIr && opts.sources.length) throw new Error('--from-ir takes no <source.c> arguments');
  if(opts.fromIr && opts.emitIr) throw new Error('--from-ir and --emit-ir cannot be combined');
  if(!opts.fromIr && !opts.sources.length) throw new Error('missing <source.c> argument');

  return opts;
}

/* --- clang invocation --------------------------------------------------- */
