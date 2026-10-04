import * as std from 'std';
import { usage, parseArgs } from './args.js';
import { sourceFilter, runClangAstDump } from './clang.js';
import { collectIR, newIR, mergeIR } from './ir.js';
import { resolveByValue } from './by-value.js';
import { nameCollisions } from './names.js';
import { bindable, setNamespaces } from './emit/common.js';
import { generateCFunction } from './emit/functions.js';
import { irToSpecs } from './specs.js';
import { toSource } from './source.js';

export function main() {
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

    try {
      // the JS form (--emit-ir --js) is `export default <literal>;`
      ir = /^\s*export default /.test(text) ? std.evalScript('(' + text.replace(/^\s*export default /, '').replace(/;\s*$/, '') + ')') : JSON.parse(text);
    } catch(e) {
      std.err.puts('gen-bindings.js: cannot parse ' + opts.fromIr + ': ' + e.message + '\n');
      std.exit(1);
    }

    if(ir.version !== newIR().version) {
      std.err.puts('gen-bindings.js: ' + opts.fromIr + ' is IR version ' + ir.version + ', this is version ' + newIR().version + '; make it again with --emit-ir\n');
      std.exit(1);
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
        std.err.puts('gen-bindings.js: ' + e.message + '\n');
        std.exit(1);
      }

      if(root.clangErrors) {
        const e = root.clangErrors;

        std.err.puts('gen-bindings.js: warning: clang reported ' + e.count + ' error(s) in ' + source + ', what it could not parse is missing or wrong: ' + e.first + '\n');
        if(e.missing.length) std.err.puts('gen-bindings.js: warning: not found: ' + e.missing.join(', ') + '; add the directory that has it with -I<dir>\n');
      }

      const isSourceFile = sourceFilter(opts, source);
      const found = collectIR(root, isSourceFile, i + ':');

      if(!found.methods.length && !found.classes.length) std.err.puts('gen-bindings.js: warning: no bindable functions found in ' + source + '\n');
      mergeIR(ir, found);
    });

    resolveByValue(ir, opts);
  }

  setNamespaces(opts.namespaces);

  const clashes = opts.emitIr || opts.emitSpecs ? [] : nameCollisions(ir, opts);

  if(clashes.length) {
    for(const c of clashes) std.err.puts('gen-bindings.js: after dropping ' + opts.namespaces.map(n => n + '::').join(', ') + ', "' + c.ident + '" would be exported by: ' + c.entities.join('; ') + '\n');
    std.err.puts('gen-bindings.js: name collision, nothing written; drop fewer --namespace values\n');
    std.exit(1);
  }

  const specs = opts.emitSpecs ? irToSpecs(ir, { library: opts.library }) : null;
  const data = opts.emitIr ? ir : specs;
  const out = data ? (opts.js || (opts.emitSpecs === true && !opts.json) ? toSource(data) : JSON.stringify(data, null, 2) + '\n') : generateCFunction(ir, opts);
  const dest = opts.emitIr || (typeof opts.emitSpecs == 'string' && opts.emitSpecs) || opts.output;

  if(dest) {
    const f = std.open(dest, 'w');
    f.puts(out);
    f.close();
  } else {
    std.puts(out);
  }

  if(ir.skipped.length)
    std.err.puts('gen-bindings.js: skipped ' + ir.skipped.length + ' unsupported function(s)' + (opts.emitIr ? ', see "skipped" in the IR' : specs ? ', see "omitted" in the specs' : ', see comment at end of output') + '\n');
}
