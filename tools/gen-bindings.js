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
 * Also emits `export const NAME = value;` for every enum reachable from a
 * bound function's args/returns (enum-typed or enum-typedef-typed), so
 * callers get the same symbolic constants the C API uses.
 *
 * Usage:
 *   qjsm gen-bindings.js [options] <source.c>...
 *
 * Several sources are merged into one output, with a function or enum
 * constant declared in more than one of them emitted once.
 *
 * Options:
 *   --api=cfunction|define   which qjs-ffi API to target (default: cfunction)
 *   --follow-includes        also bind functions from every header under a
 *                            source's own directory that it (transitively)
 *                            includes, e.g. SDL.h -> SDL_video.h, SDL_render.h
 *   --exclude=<name>         do not bind this function (repeatable), e.g. one
 *                            the shared library does not actually export
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
      ' [options] <source.c>...\n' +
      '  --api=cfunction|define   which qjs-ffi API to target (default: cfunction)\n' +
      '  --follow-includes        also bind headers included from under each source\'s directory\n' +
      '  --exclude=<name>         do not bind this function (repeatable)\n' +
      '  -I<dir>                  extra clang include dir (repeatable)\n' +
      '  -D<name[=val]>           extra clang macro define (repeatable)\n' +
      '  --library=<path>         dlopen() this shared library instead of RTLD_DEFAULT\n' +
      '  --clang=<path>           clang binary to invoke (default: clang)\n' +
      '  -o, --output=<path>      write generated JS here instead of stdout\n' +
      '  -h, --help               show this help\n',
  );
}

function parseArgs(argv) {
  const opts = { api: 'cfunction', includes: [], defines: [], library: null, clang: 'clang', output: null, sources: [], followIncludes: false, excludes: [] };

  for(let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if(a === '-h' || a === '--help') {
      usage();
      std.exit(0);
    } else if(a.startsWith('--api=')) {
      opts.api = a.slice('--api='.length);
    } else if(a.startsWith('--exclude=')) {
      opts.excludes.push(a.slice('--exclude='.length));
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
  if(!opts.sources.length) throw new Error('missing <source.c> argument');

  return opts;
}

/* --- clang invocation --------------------------------------------------- */

function shquote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function runClangAstDump(opts, source) {
  const parts = [opts.clang, '-Xclang', '-ast-dump=json', '-fsyntax-only'];

  for(const inc of opts.includes) parts.push('-I' + inc);
  for(const def of opts.defines) parts.push('-D' + def);
  parts.push(source);

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
 * { cf, def, supported, reason, enumId }: `cf` is the bun-style FFIType
 * name used for CFunction/JSCallback, `def` is the legacy ffi.c type name
 * used for define()/call(). Only scalar and single-level-pointer types are
 * supported -- struct/union-by-value, arrays and varargs need libffi
 * struct/array support this module doesn't have (see TODO.md).
 *
 * `typedefs` (name -> underlying type string, from collectTypedefs()) is
 * consulted when `t` is itself an unresolved typedef name -- needed for
 * return types, since a FunctionDecl's own qualType is never desugared by
 * clang (unlike ParmVarDecl's, which normally arrives pre-resolved via
 * desugaredQualType and hits BASE_TYPES/enum directly without this).
 *
 * `enumIndex` (from collectEnumIndex()) is consulted alongside `typedefs`
 * so a resolved enum type carries back which EnumDecl backs it (`enumId`),
 * letting collectFunctions() know which enums are actually reachable from a
 * bindable function's signature.
 */
function mapCType(qualTypeRaw, typedefs, enumIndex, depth) {
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

  const enumMatch = t.match(/^enum\s+(\S+)$/);
  if(enumMatch) return { cf: 'i32', def: 'sint32', supported: true, enumId: enumIndex && enumIndex.tagToId[enumMatch[1]] };
  if(/^enum\b/.test(t)) return { cf: 'i32', def: 'sint32', supported: true };
  if(/^(struct|union)\b/.test(t)) return { supported: false, reason: 'struct/union passed by value is not supported' };

  const known = BASE_TYPES[t];
  if(known) return { cf: known.cf, def: known.def, supported: true };

  if(enumIndex && Object.prototype.hasOwnProperty.call(enumIndex.typedefToEnumId, t))
    return { cf: 'i32', def: 'sint32', supported: true, enumId: enumIndex.typedefToEnumId[t] };

  // Depth-guarded in case a typedef ever resolves back to its own name (seen
  // with clang's `typedef enum { ... } Name;` idiom, where the anonymous
  // enum's synthesized tag is also spelled `Name`) -- falls through to the
  // "unrecognized" error below rather than looping.
  if(typedefs && Object.prototype.hasOwnProperty.call(typedefs, t) && (depth || 0) < 8) return mapCType(typedefs[t], typedefs, enumIndex, (depth || 0) + 1);

  return { supported: false, reason: 'unrecognized C type "' + qualTypeRaw + '"' };
}

/* Builds a name -> underlying-type-string map from every top-level
 * TypedefDecl, for resolving a return type's typedef name in mapCType().
 * Prefers desugaredQualType (clang's fully-resolved canonical type, present
 * whenever it differs from qualType) over qualType, so most real-world
 * typedefs (FT_Error -> int, cairo_status_t -> enum _cairo_status) resolve
 * in a single lookup.
 */
function collectTypedefs(root) {
  const typedefs = {};

  for(const node of root.inner || []) {
    if(node.kind === 'TypedefDecl' && node.name && node.type && !Object.prototype.hasOwnProperty.call(typedefs, node.name))
      typedefs[node.name] = node.type.desugaredQualType || node.type.qualType;
  }

  return typedefs;
}

/* Resolves one EnumConstantDecl's value: the explicit initializer's
 * evaluated value (clang's ast-dump always gives this as a plain decimal
 * string, even for hex literals or `A | B`-style expressions), or the
 * previous constant's value + 1 for an implicit one -- same rule the C
 * standard uses.
 */
function enumConstants(enumDecl) {
  const constants = [];
  let next = 0;

  for(const c of enumDecl.inner || []) {
    if(c.kind !== 'EnumConstantDecl') continue;

    const init = (c.inner || []).find(x => 'value' in x);
    const value = init ? Number(init.value) : next;

    constants.push({ name: c.name, value });
    next = value + 1;
  }

  return constants;
}

/* Builds an index for resolving enum-typed return/parameter types back to
 * their full enumerator list:
 *   - enumsById: EnumDecl node id -> { name (tag, or null if anonymous),
 *     constants }, from every top-level EnumDecl that carries its full
 *     definition (a bare forward-reference node has no `inner`).
 *   - tagToId: enum tag name -> id, for the "enum TAG" spelling mapCType()
 *     sees directly (e.g. cairo_status_t's own qualType is "enum _cairo_status").
 *   - typedefToEnumId: typedef name -> id, for the `typedef enum { ... }
 *     Name;` idiom (named or anonymous tag), where mapCType() instead sees
 *     the bare typedef name. clang links a TypedefDecl to the EnumDecl it
 *     wraps via an intermediate ElaboratedType child's `ownedTagDecl.id`,
 *     which is the same id as that EnumDecl's own top-level definition.
 */
function collectEnumIndex(root) {
  const enumsById = {};
  const tagToId = {};
  const typedefToEnumId = {};

  for(const node of root.inner || []) {
    if(node.kind === 'EnumDecl' && node.inner) {
      enumsById[node.id] = { name: node.name || null, constants: enumConstants(node) };
      if(node.name) tagToId[node.name] = node.id;
    } else if(node.kind === 'TypedefDecl' && node.inner) {
      const elaborated = node.inner.find(c => c.kind === 'ElaboratedType');
      const owned = elaborated && elaborated.ownedTagDecl;

      if(owned && owned.kind === 'EnumDecl') typedefToEnumId[node.name] = owned.id;
    }
  }

  return { enumsById, tagToId, typedefToEnumId };
}

/* Walks the translation unit's top-level declarations, tracking the
 * "current file" the way clang's own -ast-dump=json does: a node's
 * loc.file is only present when it differs from the previous node's, so a
 * node without one belongs to whatever file was last seen (see the sample
 * dump this was validated against -- system-header typedefs pulled in via
 * #include get their own file, then it switches back once real nodes from
 * a file accepted by `isSourceFile` start).
 */
function collectFunctions(root, isSourceFile) {
  const functions = [];
  const skipped = [];
  const seen = new Set();
  const typedefs = collectTypedefs(root);
  const enumIndex = collectEnumIndex(root);
  const usedEnumIds = [];
  const seenEnumIds = new Set();
  let currentFile = null;

  function useEnum(enumId) {
    if(enumId !== undefined && !seenEnumIds.has(enumId)) {
      seenEnumIds.add(enumId);
      usedEnumIds.push(enumId);
    }
  }

  for(const node of root.inner || []) {
    if(node.loc && node.loc.file !== undefined) currentFile = node.loc.file;

    if(node.kind !== 'FunctionDecl') continue;
    if(!isSourceFile(currentFile)) continue;
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

    const retMap = mapCType(split.returnType, typedefs, enumIndex);
    if(!retMap.supported) {
      skipped.push({ name: node.name, reason: 'return type: ' + retMap.reason });
      continue;
    }

    const params = [];
    let badParam = null;

    for(const child of node.inner || []) {
      if(child.kind !== 'ParmVarDecl') continue;

      const qualType = (child.type && (child.type.desugaredQualType || child.type.qualType)) || '';
      const pm = mapCType(qualType, typedefs, enumIndex);

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
    useEnum(retMap.enumId);
    for(const p of params) useEnum(p.type.enumId);
  }

  const enums = usedEnumIds.map(id => enumIndex.enumsById[id]).filter(Boolean);

  return { functions, skipped, enums };
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
  const argv = [opts.clang, '-Xclang', '-ast-dump=json', '-fsyntax-only', ...opts.includes.map(i => '-I' + i), ...opts.defines.map(d => '-D' + d), '<source>'];

  return (
    '/* Auto-generated by ' +
    invocationName() +
    ' from ' +
    opts.sources.join(', ') +
    ' -- do not edit by hand.\n' +
    ' * Regenerate with:\n' +
    ' *   ' +
    invocationName() +
    ' --api=' +
    opts.api +
    (opts.library ? ' --library=' + opts.library : '') +
    (opts.followIncludes ? ' --follow-includes' : '') +
    opts.excludes.map(n => ' --exclude=' + n).join('') +
    ' ' +
    opts.includes.map(i => '-I' + i).join(' ') +
    ' ' +
    opts.sources.join(' ') +
    '\n' +
    ' * (clang invocation used to build the AST, once per source: ' +
    argv.join(' ') +
    ')\n' +
    ' */\n'
  );
}

function skippedComment(skipped) {
  if(!skipped.length) return '';
  return '\n// Skipped (unsupported):\n' + skipped.map(s => '//   - ' + s.name + ': ' + s.reason).join('\n') + '\n';
}

/* Emits `export const NAME = value;` for every enum reachable from a
 * bindable function's signature (see collectEnumIndex()), one group per
 * enum with a header comment naming its tag (or "(anonymous)"). A constant
 * already emitted by an earlier group is skipped rather than re-declared --
 * C forbids two enums from sharing a constant name at file scope, so this
 * is only a defensive backstop, not expected to ever trigger.
 */
function enumConstantsCode(enums) {
  if(!enums.length) return '';

  const emitted = new Set();
  let out = '';

  for(const e of enums) {
    const fresh = e.constants.filter(c => !emitted.has(c.name));
    if(!fresh.length) continue;

    out += '\n// enum ' + (e.name || '(anonymous)') + '\n';
    for(const c of fresh) {
      emitted.add(c.name);
      out += 'export const ' + safeIdent(c.name) + ' = ' + c.value + ';\n';
    }
  }

  return out;
}

function generateCFunction(functions, skipped, enums, opts) {
  const lib = opts.library ? '__lib' : 'RTLD_DEFAULT';
  const imports = ['CFunction', 'dlsym', opts.library ? 'dlopen' : null, opts.library ? 'RTLD_NOW' : 'RTLD_DEFAULT'].filter(Boolean);

  let out = header(opts);
  out += "import { " + imports.join(', ') + " } from 'ffi';\n\n";

  if(opts.library) out += 'const __lib = dlopen(' + JSON.stringify(opts.library) + ', RTLD_NOW);\n' + 'if (__lib == null) throw new Error("gen-bindings: dlopen(' + opts.library + ') failed");\n\n';

  out += 'function __sym(name) {\n' + '  const p = dlsym(' + lib + ', name);\n' + '  if (p == null) throw new Error("gen-bindings: symbol not found: " + name);\n' + '  return p;\n' + '}\n';
  out += enumConstantsCode(enums);
  out += '\n';

  for(const fn of functions) {
    const args = fn.params.map(p => JSON.stringify(p.type.cf));
    const ident = safeIdent(fn.name);
    out += 'export const ' + ident + ' = CFunction({ ptr: __sym(' + JSON.stringify(fn.name) + '), args: [' + args.join(', ') + '], returns: ' + JSON.stringify(fn.returnType.cf) + ' });\n';
    if(ident !== fn.name) out += '// note: "' + fn.name + '" is a reserved word, exported above as "' + ident + '"\n';
  }

  out += skippedComment(skipped);
  return out;
}

function generateDefine(functions, skipped, enums, opts) {
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
    '}\n';
  out += enumConstantsCode(enums);
  out += '\n';

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

  const functions = [];
  const skipped = [];
  const enums = [];
  const seenFunctions = new Set();
  const seenSkipped = new Set();

  for(const source of opts.sources) {
    let root;
    try {
      root = runClangAstDump(opts, source);
    } catch(e) {
      std.err.puts('gen-bindings.js: ' + e.message + '\n');
      std.exit(1);
    }

    const dir = source.replace(/[^/]*$/, '');
    const isSourceFile = f => f === source || (opts.followIncludes && dir !== '' && f !== null && f.startsWith(dir));
    const found = collectFunctions(root, isSourceFile);

    if(!found.functions.length) std.err.puts('gen-bindings.js: warning: no bindable functions found in ' + source + '\n');

    for(const fn of found.functions) if(!seenFunctions.has(fn.name) && !opts.excludes.includes(fn.name)) (seenFunctions.add(fn.name), functions.push(fn));
    for(const s of found.skipped) if(!seenSkipped.has(s.name)) (seenSkipped.add(s.name), skipped.push(s));
    enums.push(...found.enums);
  }

  const out = opts.api === 'cfunction' ? generateCFunction(functions, skipped, enums, opts) : generateDefine(functions, skipped, enums, opts);

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
