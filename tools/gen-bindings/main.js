import * as std from 'std';
import { usage, parseArgs } from './args.js';
import { sourceFilter, runClangAstDump } from './clang.js';
import { collectIR, newIR, linkPrototypeChains, mergeIR } from './ir.js';
import { bindable } from './emit/common.js';
import { generateCFunction, generateDefine } from './emit/functions.js';

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
    ir = JSON.parse(text);
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

      const isSourceFile = sourceFilter(opts, source);
      const found = collectIR(root, isSourceFile, i + ':');

      if(!found.methods.length && !found.classes.length) std.err.puts('gen-bindings.js: warning: no bindable functions found in ' + source + '\n');
      mergeIR(ir, found);
    });

    linkPrototypeChains(ir);
  }

  const out = opts.emitIr ? JSON.stringify(ir, null, 2) + '\n' : opts.api === 'cfunction' ? generateCFunction(ir, opts) : generateDefine(ir, opts);
  const dest = opts.emitIr || opts.output;

  if(dest) {
    const f = std.open(dest, 'w');
    f.puts(out);
    f.close();
  } else {
    std.puts(out);
  }

  if(ir.skipped.length)
    std.err.puts('gen-bindings.js: skipped ' + ir.skipped.length + ' unsupported function(s)' + (opts.emitIr ? ', see "skipped" in the IR' : ', see comment at end of output') + '\n');
}
