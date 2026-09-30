#!/usr/bin/env qjsm
/* gen-bindings.js -- generate qjs-ffi JS bindings from a C source file's AST.
 *
 * Runs in two phases joined by an intermediate JSON format (the "IR"):
 *
 *   1. clang -> IR:  `clang -Xclang -ast-dump=json -fsyntax-only` output is
 *      tokenized with json.JsonParser and condensed on the fly to just the
 *      nodes needed here (the condensed AST is cached, see --cache-dir), then
 *      the top-level, externally visible functions, enums, structs/unions and
 *      variables are extracted into an IR shaped like describeObject() /
 *      describeClass() output (qjs-modules lib/describe-*.js): `methods` holds
 *      kind:"function" entries with `arity`, `params` ("name: type") and
 *      `returnType`, `fields` holds variables, `enums`/`structs` the compound
 *      types.
 *   2. IR -> JS:     the IR alone (no clang) is turned into a JS module.
 *
 * The JS module emitted is either:
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
 *   qjsm gen-bindings.js [options] --from-ir=<ir.json>
 *
 * Several sources are merged into one output, with a function or enum
 * constant declared in more than one of them emitted once.
 *
 * Options:
 *   --api=cfunction|define   which qjs-ffi API to target (default: cfunction)
 *   --follow-includes        also bind functions from every header under a
 *                            source's own directory that it (transitively)
 *                            includes, e.g. SDL.h -> SDL_video.h, SDL_render.h
 *   --ffitype                write types as FFIType.i32 instead of "i32" (cfunction
 *                            API only); imports FFIType from 'ffi'
 *   --exclude=<name>         do not bind this function (repeatable), e.g. one
 *                            the shared library does not actually export
 *   -I<dir>                  extra clang include dir (repeatable)
 *   -D<name[=val]>           extra clang macro define (repeatable)
 *   --library=<path>         dlopen() this shared library instead of
 *                            assuming the symbols are already loaded
 *                            (RTLD_DEFAULT)
 *   --clang=<path>           clang binary to invoke (default: "clang")
 *   --emit-ir=<file>         write the intermediate JSON and stop (no JS output)
 *   --from-ir=<file>         generate from this IR instead of running clang
 *   --cache-dir=<dir>        condensed-AST cache directory (default: .tmp/gen-bindings)
 *   --no-cache               ignore and do not write the condensed-AST cache
 *   -o, --output=<path>      write generated JS here instead of stdout
 *   -h, --help               show this help
 */
import * as std from 'std';
import * as os from 'os';
import { JsonParser } from 'json';

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
      ' [options] <source.c>... | --from-ir=<ir.json>\n' +
      '  --api=cfunction|define   which qjs-ffi API to target (default: cfunction)\n' +
      '  --follow-includes        also bind headers included from under each source\'s directory\n' +
      '  --ffitype                write types as FFIType.i32 instead of "i32" (cfunction API only)\n' +
      '  --exclude=<name>         do not bind this function (repeatable)\n' +
      '  -I<dir>                  extra clang include dir (repeatable)\n' +
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

function parseArgs(argv) {
  const opts = { api: 'cfunction', includes: [], defines: [], library: null, clang: 'clang', output: null, sources: [], followIncludes: false, excludes: [], ffiType: false, emitIr: null, fromIr: null, cacheDir: '.tmp/gen-bindings', cache: true };

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

function shquote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/* --- streaming AST condenser ---------------------------------------------- */

/* clang's JSON AST is megabytes per header (cairo.h: ~3.7MB), nearly all of
 * it source ranges, function bodies and attributes irrelevant here. It is
 * read token by token from clang's stdout with json.JsonParser and only the
 * needed nodes/keys are ever materialized; everything else is consumed and
 * dropped. Which children a node keeps is decided the moment its "kind" key
 * arrives (clang always writes "id", then "kind", before anything else).
 */
const TOP_KINDS = new Set(['FunctionDecl', 'VarDecl', 'EnumDecl', 'RecordDecl', 'TypedefDecl']);
const DROP_KEYS = new Set(['range', 'referencedDecl', 'previousDecl', 'parentDeclContext', 'valueCategory', 'isUsed', 'isReferenced']);
const LOC_KEYS = new Set(['file', 'line', 'spellingLoc', 'expansionLoc']);
const EXPR_KEYS = new Set(['kind', 'value', 'opcode', 'inner']);
const EXPR_KIND = /(Expr|Literal|Operator)$/;

/* 'skip': drop the node; 'shallow': keep only id/kind/name/loc (still needed
 * for clang's "current file" tracking); 'leaf': keep its keys but not its
 * children; 'expr': constant-expression node, keep EXPR_KEYS only; 'full':
 * keep, and recurse with this same policy for its children.
 */
function nodePolicy(parent, kind) {
  switch (parent) {
    case 'TranslationUnitDecl': return TOP_KINDS.has(kind) ? 'full' : 'shallow';
    case 'FunctionDecl': return kind === 'ParmVarDecl' ? 'leaf' : 'skip';
    case 'EnumDecl': return kind === 'EnumConstantDecl' ? 'full' : 'skip';
    case 'RecordDecl': return kind === 'FieldDecl' || kind === 'RecordDecl' || kind === 'EnumDecl' || kind === 'AlignedAttr' ? 'full' : kind === 'PackedAttr' ? 'leaf' : 'skip';
    case 'TypedefDecl': return kind === 'ElaboratedType' ? 'leaf' : 'skip';
    case 'VarDecl':
    case 'EnumConstantDecl':
    case 'FieldDecl':
    case 'AlignedAttr':
      return EXPR_KIND.test(kind) ? 'expr' : 'skip';
  }
  return EXPR_KIND.test(parent) && EXPR_KIND.test(kind) ? 'expr' : 'skip';
}

class AstCondenser {
  constructor(parser) {
    this.p = parser;
  }

  next() {
    const t = this.p.parse();
    if(t === 'NEED_DATA') throw new Error('unexpected end of clang AST JSON');
    return t;
  }

  scalar(t) {
    switch (t) {
      case 'STRING': return this.p.token;
      case 'NUMBER': return Number(this.p.token);
      case 'TRUE': return true;
      case 'FALSE': return false;
      case 'NULL': return null;
    }
    throw new Error('unexpected clang AST JSON token ' + t);
  }

  /* Consumes the rest of a value whose first token `t` was already read. */
  skip(t) {
    if(t !== 'OBJECT' && t !== 'ARRAY') return;
    for(let depth = 1; depth > 0; ) {
      const u = this.next();
      if(u === 'OBJECT' || u === 'ARRAY') depth++;
      else if(u === 'OBJECT_END' || u === 'ARRAY_END') depth--;
    }
  }

  /* Reads any value, keeping only `keys` (or every key if null) of each
   * object; `t` is the value's first token. */
  plain(t, keys) {
    if(t === 'OBJECT') {
      const o = {};
      for(let u; (u = this.next()) !== 'OBJECT_END'; ) {
        const key = this.p.token;
        const v = this.next();
        if(keys && !keys.has(key)) this.skip(v);
        else o[key] = this.plain(v, keys);
      }
      return o;
    }
    if(t === 'ARRAY') {
      const a = [];
      for(let u; (u = this.next()) !== 'ARRAY_END'; ) a.push(this.plain(u, keys));
      return a;
    }
    return this.scalar(t);
  }

  /* Reads one node object (its opening "{" already consumed); returns null
   * if `nodePolicy(parent, kind)` says to drop it. */
  node(parent) {
    const o = {};
    let kind, policy = 'full';

    for(let u; (u = this.next()) !== 'OBJECT_END'; ) {
      const key = this.p.token;
      const v = this.next();

      if(kind === undefined) {
        o[key] = this.scalar(v);
        if(key === 'kind') {
          kind = o.kind;
          policy = parent === null ? 'full' : nodePolicy(parent, kind);
          if(policy === 'skip') {
            this.skip('OBJECT');
            return null;
          }
        }
      } else if(policy === 'expr') {
        if(EXPR_KEYS.has(key) && key !== 'inner') o[key] = this.plain(v, null);
        else if(key === 'inner') o.inner = this.inner(kind, v);
        else this.skip(v);
      } else if(key === 'loc') {
        if(parent === 'TranslationUnitDecl' || parent === null) o.loc = this.plain(v, LOC_KEYS);
        else this.skip(v);
      } else if(key === 'inner') {
        if(policy === 'full') o.inner = this.inner(kind, v);
        else this.skip(v);
      } else if(DROP_KEYS.has(key) || (policy === 'shallow' && key !== 'name')) {
        this.skip(v);
      } else {
        o[key] = this.plain(v, null);
      }
    }
    return o;
  }

  inner(parent, t) {
    if(t !== 'ARRAY') throw new Error('clang AST: "inner" is not an array');
    const a = [];
    for(let u; (u = this.next()) !== 'ARRAY_END'; ) {
      const n = this.node(parent);
      if(n) a.push(n);
    }
    return a;
  }

  root() {
    if(this.next() !== 'OBJECT') throw new Error('clang AST: root is not an object');
    return this.node(null);
  }
}

/* Every distinct file a top-level node came from, for cache invalidation. */
function astFiles(root) {
  const files = new Set();
  for(const node of root.inner || []) if(node.loc && node.loc.file !== undefined && !node.loc.file.startsWith('<')) files.add(node.loc.file);
  return [...files];
}

function fnv1a(s) {
  let h = 0x811c9dc5;
  for(let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function mtime(path) {
  const [st, err] = os.stat(path);
  return err ? -1 : st.mtime;
}

/* Bump when AstCondenser's output changes, so stale caches are not reused. */
const AST_CACHE_VERSION = 1;

function cachePath(opts, source, cmd) {
  return opts.cacheDir.replace(/\/*$/, '/') + source.replace(/.*\//, '') + '.' + fnv1a(AST_CACHE_VERSION + '\0' + cmd + '\0' + source) + '.ast.json';
}

function mkdirs(dir) {
  let path = '';
  for(const part of dir.split('/')) {
    path += part + '/';
    if(part && part !== '.') os.mkdir(path, 0o755);
  }
}

/* Loads the condensed AST from the cache if no file it was built from is
 * newer than it, else null. */
function readAstCache(file) {
  const cached = std.loadFile(file);
  if(cached === null) return null;

  const stamp = mtime(file);
  let root;
  try {
    root = JSON.parse(cached);
  } catch(e) {
    return null;
  }
  return root.files.every(f => mtime(f) >= 0 && mtime(f) <= stamp) ? root.ast : null;
}

function runClangAstDump(opts, source) {
  const parts = [opts.clang, '-Xclang', '-ast-dump=json', '-fsyntax-only'];

  for(const inc of opts.includes) parts.push('-I' + inc);
  for(const def of opts.defines) parts.push('-D' + def);
  parts.push(source);

  const cmd = parts.map(shquote).join(' ');
  const cache = cachePath(opts, source, cmd);

  if(opts.cache) {
    const hit = readAstCache(cache);
    if(hit) return hit;
  }

  // Handed to JsonParser as one string: fed from a pull function it calls
  // back once per byte, ~10x slower (see BUGS: jsonparser-pull-reads-one-byte).
  const f = std.popen(cmd + ' 2>/dev/null', 'r');
  const text = f.readAsString();
  let ast = null, error = null;

  f.close();

  try {
    ast = new AstCondenser(new JsonParser(text, source)).root();
  } catch(e) {
    error = e;
  }

  if(!ast || !ast.inner) {
    // Re-run to surface clang's diagnostics for the error message.
    const ef = std.popen(cmd + ' 2>&1 1>/dev/null', 'r');
    const errText = ef.readAsString();
    ef.close();
    throw new Error((error ? 'failed to parse clang AST JSON output: ' + error.message + '; ' : 'clang produced no output; ') + 'stderr was:\n' + errText);
  }

  if(opts.cache) {
    mkdirs(opts.cacheDir);
    const out = std.open(cache, 'w');
    if(out) {
      out.puts(JSON.stringify({ files: astFiles(ast), ast }));
      out.close();
    }
  }

  return ast;
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
function collectIR(root, isSourceFile, idPrefix) {
  const ir = newIR();
  const seen = new Set();
  const typedefs = collectTypedefs(root);
  const enumIndex = collectEnumIndex(root);
  const recordTypedefs = collectRecordTypedefs(root);
  const enumIds = new Set();
  let currentFile = null;

  function addEnum(id) {
    const e = id !== undefined && enumIndex.enumsById[id];
    if(!e || enumIds.has(id)) return;
    enumIds.add(id);
    ir.enums.push({ id: idPrefix + id, name: e.name, kind: 'enum', fields: e.constants.map(c => ({ name: c.name, type: 'number', value: c.value })) });
  }

  function typeName(m, qualType) {
    return m.supported ? m.cf : normalizeType(qualType);
  }

  for(const node of root.inner || []) {
    if(node.loc && node.loc.file !== undefined) currentFile = node.loc.file;

    if(!isSourceFile(currentFile)) continue;
    if(node.isImplicit) continue;

    if(node.kind === 'EnumDecl' && node.inner) addEnum(node.id);
    else if(node.kind === 'RecordDecl') collectStruct(node);
    else if(node.kind === 'VarDecl') collectVariable(node);
    else if(node.kind === 'FunctionDecl') collectFunction(node);
  }

  function collectStruct(node) {
    if(!node.completeDefinition) return;

    const aliases = recordTypedefs[node.id] || [];
    const name = node.name || aliases[0];
    if(!name || seen.has('struct ' + name)) return;
    seen.add('struct ' + name);

    const fields = [];
    let packed = false;

    for(const child of node.inner || []) {
      if(child.kind === 'PackedAttr') packed = true;
      if(child.kind !== 'FieldDecl') continue;

      const qualType = (child.type && (child.type.desugaredQualType || child.type.qualType)) || '';
      const m = mapCType(qualType, typedefs, enumIndex);
      const field = { name: child.name || '', type: typeName(m, child.type.qualType), cType: child.type.qualType };

      if(child.isBitfield) field.bits = Number(((child.inner || []).find(x => 'value' in x) || {}).value);
      fields.push(field);
      addEnum(m.enumId);
    }

    const s = { name, kind: node.tagUsed || 'struct', fields };
    if(node.name && aliases.length) s.typedefs = aliases;
    if(packed) s.packed = true;
    ir.structs.push(s);
  }

  function collectVariable(node) {
    if(seen.has('var ' + node.name)) return;

    const qualType = (node.type && (node.type.desugaredQualType || node.type.qualType)) || '';
    const isConst = isConstType(qualType);
    const value = node.inner && node.inner.length ? constValue(node.inner[0]) : undefined;

    // A static variable is only worth exporting as a compile-time constant.
    if(node.storageClass === 'static' && (!isConst || value === undefined)) return;

    seen.add('var ' + node.name);
    const m = mapCType(qualType, typedefs, enumIndex);
    const field = { name: node.name, type: typeName(m, node.type.qualType), cType: node.type.qualType };

    if(isConst) field.const = true;
    if(value !== undefined) field.value = value;
    ir.fields.push(field);
    addEnum(m.enumId);
  }

  function collectFunction(node) {
    if(node.storageClass === 'static') return;
    if(seen.has(node.name)) return;

    if(node.variadic) {
      ir.skipped.push({ name: node.name, reason: 'variadic functions are not supported' });
      return;
    }

    const split = splitFunctionType(node.type.qualType);
    if(!split) {
      ir.skipped.push({ name: node.name, reason: 'could not parse function type "' + node.type.qualType + '"' });
      return;
    }

    const retMap = mapCType(split.returnType, typedefs, enumIndex);
    if(!retMap.supported) {
      ir.skipped.push({ name: node.name, reason: 'return type: ' + retMap.reason });
      return;
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
      ir.skipped.push({ name: node.name, reason: badParam });
      return;
    }

    seen.add(node.name);

    const used = [retMap, ...params.map(p => p.type)].map(m => m.enumId).filter(id => id !== undefined);
    for(const id of used) addEnum(id);

    ir.methods.push({
      name: node.name,
      kind: 'function',
      arity: params.length,
      params: params.map(p => p.name + ': ' + p.type.cf),
      returnType: retMap.cf,
      defTypes: { returnType: retMap.def, params: params.map(p => p.type.def) },
      enums: [...new Set(used)].map(id => idPrefix + id),
    });
  }

  return ir;
}

/* --- intermediate format (IR) --------------------------------------------- */

/* Shaped like describeObject() output (qjs-modules lib/describe-object.js):
 *   methods   kind:"function" entries: `arity`, `params` ("name: type" in
 *             TypeScript style, type being an FFIType name), `returnType`;
 *             plus `defTypes` (legacy define() type names) and `enums` (ids
 *             of the enums the signature uses)
 *   fields    exported variables/constants: { name, type, value?, const? }
 *   enums     { id, name, kind:"enum", fields:[{ name, type:"number", value }] }
 *   structs   describeClass-like: { name, kind:"struct"|"union", fields:[{
 *             name, type, cType, bits? }], packed?, typedefs? }
 *   skipped   { name, reason } for declarations that could not be bound
 * `source` records how the IR was produced, for the generated file's header.
 * Reserved for later: `classes` (C++, see TODO.md).
 */
function newIR() {
  return { name: 'bindings', type: 'object', version: 1, methods: [], fields: [], getters: [], setters: [], enums: [], structs: [], skipped: [], prototypeChain: [] };
}

/* Merges `from` into `into`, keeping the first declaration of a name (a
 * variable declared without a value is upgraded by a later one with it). */
function mergeIR(into, from) {
  const byName = (list, key) => new Set(list.map(x => x[key]));
  const add = (list, items, key) => {
    const have = byName(list, key);
    for(const item of items) if(!have.has(item[key])) (have.add(item[key]), list.push(item));
  };

  for(const f of from.fields) {
    const have = into.fields.find(x => x.name === f.name);
    if(have && have.value === undefined && f.value !== undefined) have.value = f.value;
  }

  add(into.methods, from.methods, 'name');
  add(into.fields, from.fields, 'name');
  add(into.enums, from.enums, 'id');
  add(into.structs, from.structs, 'name');
  add(into.skipped, from.skipped, 'name');
  return into;
}

function isConstType(qualType) {
  const t = qualType.trim();
  return /(^|[\s*])const$/.test(t) || (!t.includes('*') && /^const\b/.test(t));
}

/* Evaluates the literal initializer of a constant variable, or undefined if
 * it is anything but a (possibly negated) number/character/string literal. */
function constValue(node) {
  switch (node.kind) {
    case 'IntegerLiteral':
    case 'FloatingLiteral':
    case 'CharacterLiteral':
    case 'ConstantExpr': {
      const n = Number(node.value);
      return node.value !== undefined && Number.isFinite(n) ? n : node.inner ? constValue(node.inner[0]) : undefined;
    }
    case 'StringLiteral':
      try {
        return JSON.parse(node.value);
      } catch(e) {
        return undefined;
      }
    case 'ImplicitCastExpr':
    case 'ParenExpr':
      return node.inner ? constValue(node.inner[0]) : undefined;
    case 'UnaryOperator': {
      const v = node.inner ? constValue(node.inner[0]) : undefined;
      return typeof v !== 'number' ? undefined : node.opcode === '-' ? -v : node.opcode === '+' ? v : undefined;
    }
  }
  return undefined;
}

/* record node id -> every typedef name wrapping it (`typedef struct {..} T;`) */
function collectRecordTypedefs(root) {
  const names = {};

  for(const node of root.inner || []) {
    if(node.kind !== 'TypedefDecl') continue;

    const elaborated = (node.inner || []).find(c => c.kind === 'ElaboratedType');
    const owned = elaborated && elaborated.ownedTagDecl;

    if(owned && owned.kind === 'RecordDecl') (names[owned.id] = names[owned.id] || []).push(node.name);
  }

  return names;
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
    (opts.ffiType ? ' --ffitype' : '') +
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

/* The functions to bind, and the enums reachable from their signatures in
 * order of first use (an enum only declared, never used, is not emitted). */
function bindable(ir, opts) {
  const functions = ir.methods.filter(m => m.kind === 'function' && !opts.excludes.includes(m.name));
  const enumsById = new Map(ir.enums.map(e => [e.id, e]));
  const enums = [...new Set(functions.flatMap(fn => fn.enums))].map(id => enumsById.get(id)).filter(Boolean);

  return { functions, enums };
}

/* Emits `export const NAME = value;` for every constant variable whose value
 * is known at generation time (an `extern` one has none, only a symbol). */
function constantsCode(fields) {
  const known = fields.filter(f => f.const && f.value !== undefined);
  if(!known.length) return '';

  return '\n// constants\n' + known.map(f => 'export const ' + safeIdent(f.name) + ' = ' + JSON.stringify(f.value) + ';\n').join('');
}

function paramTypes(fn) {
  return fn.params.map(p => p.slice(p.indexOf(': ') + 2));
}

/* Emits `export const NAME = value;` for every enum reachable from a
 * bindable function's signature (see bindable()), one group per
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
    const fresh = e.fields.filter(c => !emitted.has(c.name));
    if(!fresh.length) continue;

    out += '\n// enum ' + (e.name || '(anonymous)') + '\n';
    for(const c of fresh) {
      emitted.add(c.name);
      out += 'export const ' + safeIdent(c.name) + ' = ' + c.value + ';\n';
    }
  }

  return out;
}

/* The names of the FFIType members (ffi-type.c), i.e. the type strings
 * mapCType() may put in `.cf`. */
const FFI_TYPE_NAMES = new Set(['void', 'bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64', 'i64_fast', 'u64_fast', 'f32', 'f64', 'pointer', 'ptr', 'function', 'cstring']);

function cfType(name, opts) {
  return opts.ffiType && FFI_TYPE_NAMES.has(name) ? 'FFIType.' + name : JSON.stringify(name);
}

function generateCFunction(ir, opts) {
  const { functions, enums } = bindable(ir, opts);
  const lib = opts.library ? '__lib' : 'RTLD_DEFAULT';
  const imports = ['CFunction', opts.ffiType ? 'FFIType' : null, 'dlsym', opts.library ? 'dlopen' : null, opts.library ? 'RTLD_NOW' : 'RTLD_DEFAULT'].filter(Boolean);

  let out = header(opts);
  out += "import { " + imports.join(', ') + " } from 'ffi';\n\n";

  if(opts.library) out += 'const __lib = dlopen(' + JSON.stringify(opts.library) + ', RTLD_NOW);\n' + 'if (__lib == null) throw new Error("gen-bindings: dlopen(' + opts.library + ') failed");\n\n';

  out += 'function __sym(name) {\n' + '  const p = dlsym(' + lib + ', name);\n' + '  if (p == null) throw new Error("gen-bindings: symbol not found: " + name);\n' + '  return p;\n' + '}\n';
  out += enumConstantsCode(enums);
  out += constantsCode(ir.fields);
  out += '\n';

  for(const fn of functions) {
    const args = paramTypes(fn).map(t => cfType(t, opts));
    const ident = safeIdent(fn.name);
    out += 'export const ' + ident + ' = CFunction({ ptr: __sym(' + JSON.stringify(fn.name) + '), args: [' + args.join(', ') + '], returns: ' + cfType(fn.returnType, opts) + ' });\n';
    if(ident !== fn.name) out += '// note: "' + fn.name + '" is a reserved word, exported above as "' + ident + '"\n';
  }

  out += skippedComment(ir.skipped);
  return out;
}

function generateDefine(ir, opts) {
  const { functions, enums } = bindable(ir, opts);
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
  out += constantsCode(ir.fields);
  out += '\n';

  for(const fn of functions) {
    const args = fn.defTypes.params.map(t => JSON.stringify(t));
    const ident = safeIdent(fn.name);
    out += 'export const ' + ident + ' = __bind(' + JSON.stringify(fn.name) + ', ' + JSON.stringify(fn.defTypes.returnType) + (args.length ? ', ' + args.join(', ') : '') + ');\n';
    if(ident !== fn.name) out += '// note: "' + fn.name + '" is a reserved word, exported above as "' + ident + '"\n';
  }

  out += skippedComment(ir.skipped);
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

  let ir;

  if(opts.fromIr) {
    const text = std.loadFile(opts.fromIr);
    if(text === null) {
      std.err.puts('gen-bindings.js: cannot read ' + opts.fromIr + '\n');
      std.exit(1);
    }
    ir = JSON.parse(text);
    Object.assign(opts, ir.source);
    opts.sources = ir.source.files;
  } else {
    ir = newIR();
    ir.source = { files: opts.sources, includes: opts.includes, defines: opts.defines, followIncludes: opts.followIncludes };

    opts.sources.forEach((source, i) => {
      let root;
      try {
        root = runClangAstDump(opts, source);
      } catch(e) {
        std.err.puts('gen-bindings.js: ' + e.message + '\n');
        std.exit(1);
      }

      const dir = source.replace(/[^/]*$/, '');
      const isSourceFile = f => f === source || (opts.followIncludes && dir !== '' && f !== null && f.startsWith(dir));
      const found = collectIR(root, isSourceFile, i + ':');

      if(!found.methods.length) std.err.puts('gen-bindings.js: warning: no bindable functions found in ' + source + '\n');
      mergeIR(ir, found);
    });
  }

  const out = opts.emitIr ? JSON.stringify(ir, null, 2) + '\n' : opts.api === 'cfunction' ? generateCFunction(ir, opts) : generateDefine(ir, opts);
  const dest = opts.emitIr || opts.output;

  if(dest) {
    const f = std.open(dest, 'w');
    f.puts(out);
    f.close();
  } else {
    std.out.puts(out);
  }

  if(ir.skipped.length) std.err.puts('gen-bindings.js: skipped ' + ir.skipped.length + ' unsupported function(s)' + (opts.emitIr ? ', see "skipped" in the IR' : ', see comment at end of output') + '\n');
}

main();
