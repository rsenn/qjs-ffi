import { closeSync, existsSync, mkdirSync, openSync, readSync, realpathSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { JsonParser } from 'json';
import { AstCondenser } from './condense.js';
import { walkDecls, collectRecordTypedefs } from './ir.js';
import { header } from './emit/common.js';
import { parseVtableIndices, parseVtableBlocks } from './vtable.js';

function shquote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/* Whether a declaration from file `f` is one to collect for `source`: the
 * source itself, or with --follow-includes any file under its directory. */
export function sourceFilter(opts, source) {
  const dir = source.replace(/[^/]*$/, '');

  return f => f === source || (opts.followIncludes && dir !== '' && f !== null && f.startsWith(dir));
}

/* A .h header is ambiguous, so it needs --c++ to be parsed as C++. */
export function isCxx(opts, source) {
  return opts.cxx || /\.(cc|cpp|cxx|c\+\+|hh|hpp|hxx|h\+\+)$/i.test(source);
}

/* clang's language selection for `source`; empty for plain C. */
export function langArgs(opts, source) {
  return isCxx(opts, source) ? ['-x', 'c++', ...(opts.std ? ['-std=' + opts.std] : [])] : [];
}

/* --- streaming AST condenser ---------------------------------------------- */

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
  try {
    return statSync(path).mtimeMs;
  } catch(e) {
    return -1;
  }
}

/* runs the shell command `cmd`; its output goes where `cmd` redirects it, and a failing exit status is not an error here. */
function shell(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
  } catch(e) {}
}

function rm(path) {
  try {
    unlinkSync(path);
  } catch(e) {}
}

/* Bump when AstCondenser's output changes, so stale caches are not reused. */
const AST_CACHE_VERSION = 8;

function cachePath(opts, source, cmd) {
  return opts.cacheDir.replace(/\/*$/, '/') + source.replace(/.*\//, '') + '.' + fnv1a(AST_CACHE_VERSION + '\0' + cmd + '\0' + source + '\0' + opts.followIncludes) + '.ast.json';
}

function mkdirs(dir) {
  try {
    if(dir) mkdirSync(dir, { recursive: true, mode: 0o755 });
  } catch(e) {}
}

/* Loads the condensed AST from the cache if no file it was built from is
 * newer than it, else null. */
function readAstCache(file) {
  const cached = readFileSync(file, 'utf-8');
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

/* Sizes and field offsets, which clang's JSON AST does not carry. clang only
 * dumps a record's layout once something needs it, so a probe translation
 * unit forces one per complete record with sizeof(). Returns
 * { "struct point": { size, align, offsets: [bit offset per FieldDecl],
 * fieldSizes: { field: bytes } } } (size/align in bytes), keyed by the
 * spelling clang prints for the type: the tag for a named record, else its
 * first typedef name; plus { "typedef <qualified name>": { size } } for every
 * typedef/using alias.
 *
 * A field's size is probed as the size of a record holding `char[sizeof(field)]`,
 * since the layout dump is the only thing clang prints numbers with. A
 * bitfield, flexible array or incomplete type simply gets no size.
 */
export function runLayoutDump(opts, source, ast) {
  const aliases = collectRecordTypedefs(ast);
  const types = [];
  const fieldProbes = [];
  const typedefNames = [];
  const vtableProbes = [];
  const keyProbes = []; /* class type spelling of probe __gbk<i> */

  /* `t` is the record's type spelling; its public, named, non-bitfield fields
   * get a size probe. */
  const addRecord = (node, t, probeFields) => {
    types.push(t);
    if(!probeFields) return;

    let access = node.kind === 'CXXRecordDecl' && node.tagUsed === 'class' ? 'private' : 'public';

    for(const child of node.inner || []) {
      if(child.kind === 'AccessSpecDecl') access = child.access;
      else if(child.kind === 'FieldDecl' && child.name && !child.isBitfield && access === 'public') fieldProbes.push({ type: t, field: child.name });
    }

    if(node.kind === 'CXXRecordDecl' && node.definitionData && node.definitionData.isPolymorphic) addVtableProbe(node, t);
  };

  /* clang lays a class's vtable out, and with -fdump-vtable-layouts prints
   * it, only once code needs it: a call of the destructor does when that is
   * virtual, taking the address of a virtual method does whatever the
   * destructor is. The AST flags only the methods declared `virtual`, so
   * those are the ones tried; an overloaded name would be ambiguous. When
   * neither works (overloads only, or a destructor that is not virtual or not
   * public), a probe class derived from it with an out-of-line virtual
   * function, its key function, makes clang emit its vtable, the whole of it,
   * dumped in the "Vtable for" form. A `final` class cannot be derived from
   * (an error that would lose the whole dump), so it keeps what it has. */
  const addVtableProbe = (node, t) => {
    const i = vtableProbes.length;
    const counts = {};
    const virtuals = [];
    let access = node.tagUsed === 'class' ? 'private' : 'public';
    let destructorOk = true;
    let destructorVirtual = false;

    for(const child of node.inner || []) {
      if(child.kind === 'AccessSpecDecl') access = child.access;
      else if(child.kind === 'CXXDestructorDecl') {
        if(access !== 'public') destructorOk = false;
        if(child.virtual) destructorVirtual = true;
      }
      else if(child.kind === 'CXXMethodDecl' && child.name && access === 'public' && child.storageClass !== 'static' && !child.name.startsWith('operator')) {
        counts[child.name] = (counts[child.name] || 0) + 1;
        if(child.virtual || child.pure) virtuals.push(child.name);
      }
    }

    const unique = virtuals.find(n => counts[n] === 1);
    const final = (node.inner || []).some(child => child.kind === 'FinalAttr');
    const key = !final && !unique && !(destructorOk && destructorVirtual);

    if(key) keyProbes[i] = t;

    vtableProbes.push(
      'typedef ' + t + ' __gbc' + i + ';\n' + (destructorOk ? 'void __gbd' + i + '(__gbc' + i + '* p) { p->~__gbc' + i + '(); }\n' : '') + (unique ? 'auto __gbm' + i + ' = &__gbc' + i + '::' + unique + ';\n' : '') + (key ? 'struct __gbk' + i + ' : __gbc' + i + ' { virtual void __gb_key(); };\nvoid __gbk' + i + '::__gb_key() {}\n' : ''),
    );
  };

  // Field and typedef sizes are only needed for what will be collected, and
  // system headers hold thousands of typedefs.
  const isSourceFile = sourceFilter(opts, source);
  let currentFile = null;

  for(const top of ast.inner || []) {
    if(top.loc && top.loc.file !== undefined) currentFile = top.loc.file;

    const wanted = isSourceFile(currentFile);

    walkDecls([top], (node, scope) => {
      if(node.kind === 'TypedefDecl' || node.kind === 'TypeAliasDecl') {
        if(wanted && node.name) typedefNames.push(scope + node.name);
        return;
      }

      if(node.kind === 'RecordDecl' && scope === '' && node === top) {
        if(!node.completeDefinition) return;

        const t = node.name ? (node.tagUsed || 'struct') + ' ' + node.name : (aliases[node.id] || [])[0];
        if(t) addRecord(node, t, wanted);
        return;
      }

      if(node.kind !== 'CXXRecordDecl' || node.isImplicit || !node.completeDefinition) return;

      const t = node.name ? (node.tagUsed || 'class') + ' ' + scope + node.name : (aliases[node.id] || [])[0];
      if(t) addRecord(node, t, wanted);
    });
  }

  const layouts = {};
  let real = null;

  try {
    real = realpathSync(source);
  } catch(e) {}

  if(!types.length && !typedefNames.length) return layouts;
  if(!real) return layouts;

  mkdirs(opts.cacheDir);
  const probe = opts.cacheDir.replace(/\/*$/, '/') + 'probe-' + fnv1a(real + Date.now()) + (isCxx(opts, source) ? '.cpp' : '.c');
  writeFileSync(
    probe,
    '#include "' +
      real +
      '"\n' +
      types.map((t, i) => 'enum { __probe' + i + ' = sizeof(' + t + ') };\n').join('') +
      fieldProbes.map((p, i) => 'struct __gb_f' + i + ' { char b[sizeof(((' + p.type + ' *)0)->' + p.field + ')]; };\nenum { __gb_fu' + i + ' = sizeof(struct __gb_f' + i + ') };\n').join('') +
      typedefNames.map((n, i) => 'struct __gb_t' + i + ' { char b[sizeof(' + n + ')]; };\nenum { __gb_tu' + i + ' = sizeof(struct __gb_t' + i + ') };\n').join('') +
      vtableProbes.join(''),
  );

  // Only code generation lays a vtable out, which costs more than parsing.
  const compile = vtableProbes.length ? ['-Xclang', '-fdump-vtable-layouts', '-S', '-emit-llvm', '-o', '/dev/null'] : ['-fsyntax-only'];
  const parts = [opts.clang, '-Xclang', '-fdump-record-layouts-simple', ...compile, ...langArgs(opts, source), ...opts.includes.map(i => '-I' + i), ...opts.defines.map(d => '-D' + d), probe];
  const dump = probe + '.out';

  shell(parts.map(shquote).join(' ') + ' 2>/dev/null >' + shquote(dump));

  const out = readFileSync(dump, 'utf-8') || '';

  rm(dump);
  rm(probe);

  for(const block of out.split('*** Dumping AST Record Layout').slice(1)) {
    const type = /^Type: (.*)$/m.exec(block);
    const size = /^\s*Size:(\d+)/m.exec(block);
    const align = /^\s*Alignment:(\d+)/m.exec(block);
    const offsets = /FieldOffsets: \[([^\]]*)\]/.exec(block);

    if(type && size && align) layouts[type[1]] = { size: size[1] / 8, align: align[1] / 8, offsets: offsets && offsets[1].trim() ? offsets[1].split(',').map(Number) : [] };
  }

  fieldProbes.forEach((p, i) => {
    const probe = layouts['struct __gb_f' + i];

    if(probe && layouts[p.type]) (layouts[p.type].fieldSizes = layouts[p.type].fieldSizes || {})[p.field] = probe.size;
    delete layouts['struct __gb_f' + i];
  });

  typedefNames.forEach((n, i) => {
    const probe = layouts['struct __gb_t' + i];

    if(probe) layouts['typedef ' + n] = { size: probe.size };
    delete layouts['struct __gb_t' + i];
  });

  for(const [name, entries] of parseVtableIndices(out)) {
    const key = Object.keys(layouts).find(k => k.endsWith(' ' + name) && /^(class|struct) /.test(k));

    if(key) layouts[key].vtableIndices = entries;
  }

  for(const [name, entries] of parseVtableBlocks(out)) {
    const i = /^__gbk(\d+)$/.exec(name);

    if(i && keyProbes[i[1]] && layouts[keyProbes[i[1]]]) layouts[keyProbes[i[1]]].vtableIndices = entries;
  }

  for(const name of Object.keys(layouts)) if(/^struct __gbk\d+$/.test(name)) delete layouts[name];

  return layouts;
}

/* The errors in clang's stderr: how many, the first, and every header it
 * could not find, or null when there is none. clang still dumps an AST
 * after an error, but what depended on it is wrong: an undefined XMLPUBFUN
 * makes `XMLPUBFUN void f(void)` a variable.
 *
 * ```js
 * { count: 1, first: "tree.h:17:10: fatal error: 'libxml/xmlversion.h' file not found", missing: ["libxml/xmlversion.h"] }
 * ```
 */
function parseDiagnostics(text) {
  const errors = [];
  const missing = [];

  for(const line of text.split('\n')) {
    if(!/\berror: /.test(line)) continue;

    const m = /'([^']+)' file not found/.exec(line);

    errors.push(line);
    if(m && !missing.includes(m[1])) missing.push(m[1]);
  }

  return errors.length ? { count: errors.length, first: errors[0], missing } : null;
}

/* The -I directories that would find the headers in `missing`: for each,
 * the nearest of the source's own directory and its parents that holds it
 * (/usr/include/libxml2 for libxml/tree.h wanting <libxml/xmlversion.h>).
 * Directories already in opts.includes are not offered again. */
function includeDirsFor(opts, source, missing) {
  const dirs = [];

  for(const inc of missing) {
    for(let dir = source.replace(/\/?[^/]*$/, ''); dir !== ''; dir = dir.replace(/\/?[^/]*$/, '')) {
      if(opts.includes.includes(dir)) continue;

      if(existsSync(dir + '/' + inc)) {
        if(!dirs.includes(dir)) dirs.push(dir);
        break;
      }
    }
  }

  return dirs;
}

/* The condensed AST of `source`. A header clang could not find is looked for
 * in the source's parent directories; the one that has it joins
 * opts.includes (so later sources, the layout probe and the IR see it) and
 * clang runs again, at most four times. */
export function runClangAstDump(opts, source) {
  for(let round = 0; ; round++) {
    const ast = runClangOnce(opts, source);
    const dirs = ast.clangErrors && opts.autoInclude && round < 4 ? includeDirsFor(opts, source, ast.clangErrors.missing) : [];

    if(!dirs.length) return ast;

    for(const dir of dirs) {
      console.error('gen-bindings.js: note: ' + source + ' needs ' + ast.clangErrors.missing.join(', ') + ', adding -I' + dir);
      opts.includes.push(dir);
    }
  }
}

function runClangOnce(opts, source) {
  const parts = [opts.clang, '-Xclang', '-ast-dump=json', '-fsyntax-only', ...langArgs(opts, source)];

  for(const inc of opts.includes) parts.push('-I' + inc);
  for(const def of opts.defines) parts.push('-D' + def);
  parts.push(source);

  const cmd = parts.map(shquote).join(' ');
  const cache = cachePath(opts, source, cmd);

  if(opts.cache) {
    const hit = readAstCache(cache);
    if(hit) return hit;
  }

  // clang's stdout and stderr go to files next to the cache; stdout is parsed from its file
  mkdirs(opts.cacheDir);

  const errFile = opts.cacheDir.replace(/\/*$/, '/') + 'clang-' + fnv1a(source + Date.now()) + '.err';
  const astFile = errFile.replace(/\.err$/, '.ast');

  shell(cmd + ' >' + shquote(astFile) + ' 2>' + shquote(errFile));

  let ast = null,
    error = null;
  const fd = openSync(astFile, 'r');

  try {
    ast = new AstCondenser(new JsonParser((buf, len) => readSync(fd, new Uint8Array(buf), 0, len, null), source)).root();
  } catch(e) {
    error = e;
  }

  closeSync(fd);
  rm(astFile);

  const errText = readFileSync(errFile, 'utf-8') || '';

  rm(errFile);

  if(!ast || !ast.inner) throw new Error((error ? 'failed to parse clang AST JSON output: ' + error.message + '; ' : 'clang produced no output; ') + 'stderr was:\n' + errText);

  const diagnostics = parseDiagnostics(errText);

  if(diagnostics) ast.clangErrors = diagnostics;

  ast.layouts = runLayoutDump(opts, source, ast);

  if(opts.cache) {
    try {
      writeFileSync(cache, JSON.stringify({ files: astFiles(ast), ast }));
    } catch(e) {}
  }

  return ast;
}

/* --- AST traversal ------------------------------------------------------ */
