#!/usr/bin/env qjsm
/* gen-bindings.js -- generate qjs-ffi JS bindings from a C source file's AST.
 *
 * Runs `clang -Xclang -ast-dump=json -fsyntax-only` to get a real C AST
 * (rather than hand-rolling a C parser), walks it for top-level, externally
 * visible function declarations, and emits either:
 *
 *   --api=cfunction (default) -- one `CFunction({ ptr, args, returns })`
 *                                 per function (see doc/c-function.md)
 *   --api=define              -- one `define()`+`call()` pair per function,
 *                                 wrapped in a plain JS function (legacy API)
 *
 * Usage:
 *   qjsm gen-bindings.js [options] <source.c>
 *
 * Options:
 *   --api=cfunction|define   which qjs-ffi API to target (default: cfunction)
 *   -I<dir>                  extra clang include dir (repeatable)
 *   -D<name[=val]>           extra clang macro define (repeatable)
 *   --library=<path>         dlopen() this shared library instead of
 *                            assuming the symbols are already loaded
 *                            (RTLD_DEFAULT)
 *   --clang=<path>           clang binary to invoke (default: "clang")
 *   -o, --output=<path>      write generated JS here instead of stdout
 *   -h, --help               show this help
 */
import * as std from 'std';

/* How this script is invoked, for use in the usage banner and the
 * generated file's "regenerate with:" comment. Installed (via
 * CMakeLists.txt) as bin/qjs-ffi-genbindings with this shebang, so
 * scriptArgs[0] is that binary's path when run that way, or a relative
 * "tools/gen-bindings.js"-style path under `qjsm`.
 */
function invocationName() {
  const s = (typeof scriptArgs !== 'undefined' && scriptArgs[0]) || 'gen-bindings.js';
  const base = s.replace(/.*\//, '');
  return base.endsWith('.js') ? 'qjsm ' + s : base;
}

function usage() {
  std.err.puts(
    'Usage: ' +
      invocationName() +
      ' [options] <source.c>\n' +
      '  --api=cfunction|define   which qjs-ffi API to target (default: cfunction)\n' +
      '  -I<dir>                  extra clang include dir (repeatable)\n' +
      '  -D<name[=val]>           extra clang macro define (repeatable)\n' +
      '  --library=<path>         dlopen() this shared library instead of RTLD_DEFAULT\n' +
      '  --clang=<path>           clang binary to invoke (default: clang)\n' +
      '  -o, --output=<path>      write generated JS here instead of stdout\n' +
      '  -h, --help               show this help\n',
  );
}

function parseArgs(argv) {
  const opts = { api: 'cfunction', includes: [], defines: [], library: null, clang: 'clang', output: null, source: null };

  for(let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if(a === '-h' || a === '--help') {
      usage();
      std.exit(0);
    } else if(a.startsWith('--api=')) {
      opts.api = a.slice('--api='.length);
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
    } else if(a.startsWith('--clang=')) {
      opts.clang = a.slice('--clang='.length);
    } else if(a === '-o' || a === '--output') {
      opts.output = argv[++i];
    } else if(a.startsWith('--output=')) {
      opts.output = a.slice('--output='.length);
    } else if(a.startsWith('-')) {
      throw new Error('unknown option: ' + a);
    } else {
      opts.source = a;
    }
  }

  if(opts.api !== 'cfunction' && opts.api !== 'define') throw new Error('--api must be "cfunction" or "define", got: ' + opts.api);
  if(!opts.source) throw new Error('missing <source.c> argument');

  return opts;
}

/* --- clang invocation --------------------------------------------------- */

function shquote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function runClangAstDump(opts) {
  const parts = [opts.clang, '-Xclang', '-ast-dump=json', '-fsyntax-only'];

  for(const inc of opts.includes) parts.push('-I' + inc);
  for(const def of opts.defines) parts.push('-D' + def);
  parts.push(opts.source);

  const cmd = parts.map(shquote).join(' ');
  const f = std.popen(cmd + ' 2>/dev/null', 'r');
  const text = f.readAsString();
  f.close();

  if(!text.trim()) {
    // Re-run to surface clang's diagnostics for the error message.
    const ef = std.popen(cmd + ' 2>&1 1>/dev/null', 'r');
    const errText = ef.readAsString();
    ef.close();
    throw new Error('clang produced no output; stderr was:\n' + errText);
  }

  try {
    return JSON.parse(text);
  } catch(e) {
    throw new Error('failed to parse clang AST JSON output: ' + e.message);
  }
}

/* --- AST traversal ------------------------------------------------------ */

function normalizeType(s) {
  return s
    .replace(/\b(const|volatile|restrict)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Splits a FunctionDecl's own "ret (params...)" qualType into
 * { returnType }, matching the trailing ")" back to its own "(" by paren
 * depth so nested parens in parameter types (e.g. function pointers) don't
 * throw off the split. Parameter types themselves come from the node's own
 * ParmVarDecl children, not from re-parsing this string.
 */
function splitFunctionType(qualType) {
  const s = qualType.trim();
  if(!s.endsWith(')')) return null;

  let depth = 0;
  for(let i = s.length - 1; i >= 0; i--) {
    if(s[i] === ')') depth++;
    else if(s[i] === '(') {
      depth--;
      if(depth === 0) return { returnType: s.slice(0, i).trim() };
    }
  }
  return null;
}

const BASE_TYPES = {
  void: { cf: 'void', def: 'void' },
  _Bool: { cf: 'bool', def: 'uint8' },
  bool: { cf: 'bool', def: 'uint8' },
  char: { cf: 'i8', def: 'char' },
  'signed char': { cf: 'i8', def: 'schar' },
  'unsigned char': { cf: 'u8', def: 'uchar' },
  short: { cf: 'i16', def: 'sshort' },
  'short int': { cf: 'i16', def: 'sshort' },
  'signed short': { cf: 'i16', def: 'sshort' },
  'signed short int': { cf: 'i16', def: 'sshort' },
  'unsigned short': { cf: 'u16', def: 'ushort' },
  'unsigned short int': { cf: 'u16', def: 'ushort' },
  int: { cf: 'i32', def: 'sint32' },
  signed: { cf: 'i32', def: 'sint32' },
  'signed int': { cf: 'i32', def: 'sint32' },
  unsigned: { cf: 'u32', def: 'uint32' },
  'unsigned int': { cf: 'u32', def: 'uint32' },
  long: { cf: 'i64', def: 'sint64' },
  'long int': { cf: 'i64', def: 'sint64' },
  'signed long': { cf: 'i64', def: 'sint64' },
  'signed long int': { cf: 'i64', def: 'sint64' },
  'unsigned long': { cf: 'u64', def: 'uint64' },
  'unsigned long int': { cf: 'u64', def: 'uint64' },
  'long long': { cf: 'i64', def: 'sint64' },
  'long long int': { cf: 'i64', def: 'sint64' },
  'signed long long': { cf: 'i64', def: 'sint64' },
  'signed long long int': { cf: 'i64', def: 'sint64' },
  'unsigned long long': { cf: 'u64', def: 'uint64' },
  'unsigned long long int': { cf: 'u64', def: 'uint64' },
  float: { cf: 'f32', def: 'float' },
  double: { cf: 'f64', def: 'double' },
  'long double': { cf: 'f64', def: 'longdouble' }, // f64 is lossy for long double

  // clang gives functions it recognizes as library builtins (strlen,
  // malloc, ...) synthetic return types spelled with these glibc-internal
  // names instead of the user-visible typedef (e.g. "__size_t" instead of
  // "size_t") -- and unlike ParmVarDecl, a FunctionDecl's own return type
  // never carries a desugaredQualType to resolve this the general way.
  // Fixed 64-bit-Linux-only set, consistent with the rest of this project.
  __int8_t: { cf: 'i8', def: 'schar' },
  __uint8_t: { cf: 'u8', def: 'uchar' },
  __int16_t: { cf: 'i16', def: 'sshort' },
  __uint16_t: { cf: 'u16', def: 'ushort' },
  __int32_t: { cf: 'i32', def: 'sint32' },
  __uint32_t: { cf: 'u32', def: 'uint32' },
  __int64_t: { cf: 'i64', def: 'sint64' },
  __uint64_t: { cf: 'u64', def: 'uint64' },
  __size_t: { cf: 'u64', def: 'uint64' },
  __ssize_t: { cf: 'i64', def: 'sint64' },
  __off_t: { cf: 'i64', def: 'sint64' },
  __off64_t: { cf: 'i64', def: 'sint64' },
  __time_t: { cf: 'i64', def: 'sint64' },
  __clock_t: { cf: 'i64', def: 'sint64' },
  __pid_t: { cf: 'i32', def: 'sint32' },
  __uid_t: { cf: 'u32', def: 'uint32' },
  __gid_t: { cf: 'u32', def: 'uint32' },
  __mode_t: { cf: 'u32', def: 'uint32' },
  __socklen_t: { cf: 'u32', def: 'uint32' },
  __intptr_t: { cf: 'i64', def: 'sint64' },
  __uintptr_t: { cf: 'u64', def: 'uint64' },
};

/* Maps one C type string (a return type or a single parameter's type) to
 * { cf, def, supported, reason }: `cf` is the bun-style FFIType name used
 * for CFunction/JSCallback, `def` is the legacy ffi.c type name used for
 * define()/call(). Only scalar and single-level-pointer types are
 * supported -- struct/union-by-value, arrays and varargs need libffi
 * struct/array support this module doesn't have (see TODO.md).
 */
function mapCType(qualTypeRaw) {
  const t = normalizeType(qualTypeRaw);

  if(/\(\s*\*\s*\)\s*\(/.test(t)) return { cf: 'function', def: 'callback', supported: true };
  if(/\[[^\]]*\]/.test(t)) return { supported: false, reason: 'array types are not supported' };

  const ptrMatch = t.match(/^(.*?)\s*(\*+)$/);
  if(ptrMatch) {
    const base = normalizeType(ptrMatch[1]);
    const stars = ptrMatch[2];
    if(stars === '*' && base === 'char') return { cf: 'cstring', def: 'char *', supported: true };
    return { cf: 'pointer', def: 'pointer', supported: true };
  }

  if(/^enum\b/.test(t)) return { cf: 'i32', def: 'sint32', supported: true };
  if(/^(struct|union)\b/.test(t)) return { supported: false, reason: 'struct/union passed by value is not supported' };

  const known = BASE_TYPES[t];
  if(known) return { cf: known.cf, def: known.def, supported: true };

  return { supported: false, reason: 'unrecognized C type "' + qualTypeRaw + '"' };
}

/* Walks the translation unit's top-level declarations, tracking the
 * "current file" the way clang's own -ast-dump=json does: a node's
 * loc.file is only present when it differs from the previous node's, so a
 * node without one belongs to whatever file was last seen (see the sample
 * dump this was validated against -- system-header typedefs pulled in via
 * #include get their own file, then it switches back once real nodes from
 * `sourceFile` start).
 */
function collectFunctions(root, sourceFile) {
  const functions = [];
  const skipped = [];
  const seen = new Set();
  let currentFile = null;

  for(const node of root.inner || []) {
    if(node.loc && node.loc.file !== undefined) currentFile = node.loc.file;

    if(node.kind !== 'FunctionDecl') continue;
    if(currentFile !== sourceFile) continue;
    if(node.storageClass === 'static') continue;
    if(node.isImplicit) continue;
    if(seen.has(node.name)) continue;

    if(node.variadic) {
      skipped.push({ name: node.name, reason: 'variadic functions are not supported' });
      continue;
    }

    const split = splitFunctionType(node.type.qualType);
    if(!split) {
      skipped.push({ name: node.name, reason: 'could not parse function type "' + node.type.qualType + '"' });
      continue;
    }

    const retMap = mapCType(split.returnType);
    if(!retMap.supported) {
      skipped.push({ name: node.name, reason: 'return type: ' + retMap.reason });
      continue;
    }

    const params = [];
    let badParam = null;

    for(const child of node.inner || []) {
      if(child.kind !== 'ParmVarDecl') continue;

      const qualType = (child.type && (child.type.desugaredQualType || child.type.qualType)) || '';
      const pm = mapCType(qualType);

      if(!pm.supported) {
        badParam = 'parameter ' + (child.name || '#' + params.length) + ' (' + qualType + '): ' + pm.reason;
        break;
      }

      params.push({ name: child.name || 'a' + params.length, type: pm });
    }

    if(badParam) {
      skipped.push({ name: node.name, reason: badParam });
      continue;
    }

    seen.add(node.name);
    functions.push({ name: node.name, returnType: retMap, params });
  }

  return { functions, skipped };
}

/* --- code generation ----------------------------------------------------- */

const RESERVED = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'let', 'static', 'enum', 'await', 'implements', 'package', 'protected', 'interface', 'private', 'public', 'null', 'true', 'false',
]);

function safeIdent(name) {
  return RESERVED.has(name) || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? '_' + name : name;
}

function header(opts) {
  const argv = [opts.clang, '-Xclang', '-ast-dump=json', '-fsyntax-only', ...opts.includes.map(i => '-I' + i), ...opts.defines.map(d => '-D' + d), opts.source];

  return (
    '/* Auto-generated by ' +
    invocationName() +
    ' from ' +
    opts.source +
    ' -- do not edit by hand.\n' +
    ' * Regenerate with:\n' +
    ' *   ' +
    invocationName() +
    ' --api=' +
    opts.api +
    (opts.library ? ' --library=' + opts.library : '') +
    ' ' +
    opts.includes.map(i => '-I' + i).join(' ') +
    ' ' +
    opts.source +
    '\n' +
    ' * (clang invocation used to build the AST: ' +
    argv.join(' ') +
    ')\n' +
    ' */\n'
  );
}

function skippedComment(skipped) {
  if(!skipped.length) return '';
  return '\n// Skipped (unsupported):\n' + skipped.map(s => '//   - ' + s.name + ': ' + s.reason).join('\n') + '\n';
}

function generateCFunction(functions, skipped, opts) {
  const lib = opts.library ? '__lib' : 'RTLD_DEFAULT';
  const imports = ['CFunction', 'dlsym', opts.library ? 'dlopen' : null, opts.library ? 'RTLD_NOW' : 'RTLD_DEFAULT'].filter(Boolean);

  let out = header(opts);
  out += "import { " + imports.join(', ') + " } from 'ffi';\n\n";

  if(opts.library) out += 'const __lib = dlopen(' + JSON.stringify(opts.library) + ', RTLD_NOW);\n' + 'if (__lib == null) throw new Error("gen-bindings: dlopen(' + opts.library + ') failed");\n\n';

  out += 'function __sym(name) {\n' + '  const p = dlsym(' + lib + ', name);\n' + '  if (p == null) throw new Error("gen-bindings: symbol not found: " + name);\n' + '  return p;\n' + '}\n\n';

  for(const fn of functions) {
    const args = fn.params.map(p => JSON.stringify(p.type.cf));
    const ident = safeIdent(fn.name);
    out += 'export const ' + ident + ' = CFunction({ ptr: __sym(' + JSON.stringify(fn.name) + '), args: [' + args.join(', ') + '], returns: ' + JSON.stringify(fn.returnType.cf) + ' });\n';
    if(ident !== fn.name) out += '// note: "' + fn.name + '" is a reserved word, exported above as "' + ident + '"\n';
  }

  out += skippedComment(skipped);
  return out;
}

function generateDefine(functions, skipped, opts) {
  const lib = opts.library ? '__lib' : 'RTLD_DEFAULT';
  const imports = ['dlsym', 'define', 'call', opts.library ? 'dlopen' : null, opts.library ? 'RTLD_NOW' : 'RTLD_DEFAULT'].filter(Boolean);

  let out = header(opts);
  out += "import { " + imports.join(', ') + " } from 'ffi';\n\n";

  if(opts.library) out += 'const __lib = dlopen(' + JSON.stringify(opts.library) + ', RTLD_NOW);\n' + 'if (__lib == null) throw new Error("gen-bindings: dlopen(' + opts.library + ') failed");\n\n';

  out +=
    'function __bind(name, rtype, ...argtypes) {\n' +
    '  const p = dlsym(' +
    lib +
    ', name);\n' +
    '  if (p == null) throw new Error("gen-bindings: symbol not found: " + name);\n' +
    '  if (!define(name, p, null, rtype, ...argtypes))\n' +
    '    throw new Error("gen-bindings: define() failed for " + name);\n' +
    '  return (...args) => call(name, ...args);\n' +
    '}\n\n';

  for(const fn of functions) {
    const args = fn.params.map(p => JSON.stringify(p.type.def));
    const ident = safeIdent(fn.name);
    out += 'export const ' + ident + ' = __bind(' + JSON.stringify(fn.name) + ', ' + JSON.stringify(fn.returnType.def) + (args.length ? ', ' + args.join(', ') : '') + ');\n';
    if(ident !== fn.name) out += '// note: "' + fn.name + '" is a reserved word, exported above as "' + ident + '"\n';
  }

  out += skippedComment(skipped);
  return out;
}

/* --- main ----------------------------------------------------------------- */

function main() {
  let opts;
  try {
    opts = parseArgs(scriptArgs.slice(1));
  } catch(e) {
    std.err.puts('gen-bindings.js: ' + e.message + '\n');
    usage();
    std.exit(1);
  }

  let root;
  try {
    root = runClangAstDump(opts);
  } catch(e) {
    std.err.puts('gen-bindings.js: ' + e.message + '\n');
    std.exit(1);
  }

  const { functions, skipped } = collectFunctions(root, opts.source);

  if(!functions.length) std.err.puts('gen-bindings.js: warning: no bindable functions found in ' + opts.source + '\n');

  const out = opts.api === 'cfunction' ? generateCFunction(functions, skipped, opts) : generateDefine(functions, skipped, opts);

  if(opts.output) {
    const f = std.open(opts.output, 'w');
    f.puts(out);
    f.close();
  } else {
    std.out.puts(out);
  }

  if(skipped.length) std.err.puts('gen-bindings.js: skipped ' + skipped.length + ' unsupported function(s), see comment at end of output\n');
}

main();
