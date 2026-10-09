import { writeFileSync, readFileSync } from 'fs';
import { usage, parseArgs } from './args.js';
import { sourceFilter, runClangAstDump } from './clang.js';
import { collectIR, newIR, mergeIR } from './ir.js';
import { resolveByValue } from './by-value.js';
import { nameCollisions } from './names.js';
import { bindable, setNamespaces } from './emit/common.js';
import { generateCFunction } from './emit/functions.js';
import { irToSpecs } from './specs.js';
import { toSource } from './source.js';
import { scanDefines, localIncludes } from './defines.js';

/* the #define constants of `file`, those of the headers it includes with
 * quotes first (only with --follow-includes, and only under its directory). */
function definesOf(file, opts, known, visited = new Set()) {
  const text = visited.has(file) ? null : readFileSync(file, 'utf-8');
  const dir = file.replace(/[^/]*$/, '');
  const out = [];

  visited.add(file);
  if(text === null) return out;

  if(opts.followIncludes)
    for(const inc of localIncludes(text)) out.push(...definesOf(dir + inc, opts, known, visited));

  return out.concat(scanDefines(text, known));
}

export function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch(e) {
    console.error('gen-bindings.js: ' + e.message);
    usage();
    process.exit(1);
  }

  let ir;

  if(opts.fromIr) {
    const text = readFileSync(opts.fromIr, 'utf-8');
    if(text === null) {
      console.error('gen-bindings.js: cannot read ' + opts.fromIr);
      process.exit(1);
    }

    try {
      // the JS form (--emit-ir --js) is `export default <literal>;`
      ir = /^\s*export default /.test(text) ? Function('return (' + text.replace(/^\s*export default /, '').replace(/;\s*$/, '') + ')')() : JSON.parse(text);
    } catch(e) {
      console.error('gen-bindings.js: cannot parse ' + opts.fromIr + ': ' + e.message);
      process.exit(1);
    }

    if(ir.version !== newIR().version) {
      console.error('gen-bindings.js: ' + opts.fromIr + ' is IR version ' + ir.version + ', this is version ' + newIR().version + '; make it again with --emit-ir');
      process.exit(1);
    }

    Object.assign(opts, ir.source);
    opts.sources = ir.source.files;
  } else {
    ir = newIR();
    ir.source = { files: opts.sources, includes: opts.includes, defines: opts.defines, followIncludes: opts.followIncludes, cxx: opts.cxx, std: opts.std };

    opts.sources.forEach((source, i) => {
      let root;
      try {
        root = runClangAstDump(opts, source);
      } catch(e) {
        console.error('gen-bindings.js: ' + e.message);
        process.exit(1);
      }

      if(root.clangErrors) {
        const e = root.clangErrors;

        console.error('gen-bindings.js: warning: clang reported ' + e.count + ' error(s) in ' + source + ', what it could not parse is missing or wrong: ' + e.first);
        if(e.missing.length) console.error('gen-bindings.js: warning: not found: ' + e.missing.join(', ') + '; add the directory that has it with -I<dir>');
      }

      const isSourceFile = sourceFilter(opts, source);
      const found = collectIR(root, isSourceFile, i + ':');

      if(!found.methods.length && !found.classes.length) console.error('gen-bindings.js: warning: no bindable functions found in ' + source);
      found.defines = definesOf(source, opts, {});
      mergeIR(ir, found);
    });

    resolveByValue(ir, opts);
  }

  setNamespaces(opts.namespaces);

  const clashes = opts.emitIr || opts.emitSpecs ? [] : nameCollisions(ir, opts);

  if(clashes.length) {
    for(const c of clashes) console.error('gen-bindings.js: after dropping ' + opts.namespaces.map(n => n + '::').join(', ') + ', "' + c.ident + '" would be exported by: ' + c.entities.join('; '));
    console.error('gen-bindings.js: name collision, nothing written; drop fewer --namespace values');
    process.exit(1);
  }

  const specs = opts.emitSpecs ? irToSpecs(ir, { library: opts.library }) : null;
  const data = opts.emitIr ? ir : specs;
  const out = data ? (opts.js || (opts.emitSpecs === true && !opts.json) ? toSource(data) : JSON.stringify(data, null, 2) + '\n') : generateCFunction(ir, opts);
  const dest = opts.emitIr || (typeof opts.emitSpecs == 'string' && opts.emitSpecs) || opts.output;

  if(dest) {
    writeFileSync(dest, out);
  } else {
    process.stdout.write(out);
  }

  if(ir.warnings && ir.warnings.length) console.error('gen-bindings.js: warning: ' + ir.warnings.length + ' virtual method(s) have no vtable slot and are bound to their own symbol' + (opts.emitIr ? ', see "warnings" in the IR' : ', see comment at end of output'));

  if(ir.skipped.length)
    console.error('gen-bindings.js: skipped ' + ir.skipped.length + ' unsupported function(s)' + (opts.emitIr ? ', see "skipped" in the IR' : specs ? ', see "omitted" in the specs' : ', see comment at end of output'));
}
