#!/usr/bin/env qjsm
/* gen-structs.js -- generate JS struct wrappers from gen-bindings.js's
 * intermediate format (IR).
 *
 * Every struct, union and (C++) class of the IR becomes a class extending
 * ArrayBuffer, with a getter and a setter for each member at the byte offset
 * the IR gives, read with ffi's read() and written with ffi's write():
 *
 *   export class filter_ops extends ArrayBuffer {
 *     get size() { return __rd.u64(this, 8); }
 *     set size(v) { __wr.u64(this, 8, BigInt(v)); }
 *     ...
 *   }
 *
 *   new filter_ops()            a zeroed buffer of the struct's size
 *   new filter_ops(buf)         a copy of the bytes of an ArrayBuffer/view
 *   filter_ops.at(ptr)          a view of C memory (not copied, not owned)
 *   s.ptr                       its address, to pass to a C function
 *
 * Members: integers and floats as Number (64-bit integers as BigInt, like the
 * ffi module's i64/u64); pointers as null, Number or BigInt (a setter also
 * takes a wrapper, an ArrayBuffer or a view); a pointer to a struct, union or
 * class of known size as null or a live wrapper of that struct over the
 * pointed-to memory (ffi's toArrayBuffer, not copied); bitfields, read and written
 * through their storage unit; arrays of scalars (bool included, as 0/1) as live
 * typed-array views; arrays of pointers as a Proxy over a BigUint64Array whose
 * numeric indices give what a pointer member gives (null, Number/BigInt or a
 * struct wrapper) and take what its setter takes;
 * nested structs as views onto the same memory; anything else as a Uint8Array
 * over its bytes. A member with an unknown offset is left out. Everything is
 * little-endian, like the rest of this project.
 *
 * Usage:
 *   qjsm gen-bindings.js --emit-ir=structs.json header.h
 *   qjsm gen-structs.js [options] <ir.json>...
 *
 * An IR is either gen-bindings.js's (`structs` and `classes` are used) or a
 * plain array of struct entries. Several IRs are merged, the first
 * declaration of a name winning.
 *
 * Options:
 *   --struct=<name>   only generate this struct and what it needs (repeatable)
 *   --describe        also set Name.size/align/fields and
 *                     Symbol.for('describe') signatures on the constructor
 *                     and at() (for describeClass(), qjs-modules)
 *   --jsdoc           a JSDoc block per class: @extends, the constructor
 *                     @param and a @property per member (JS type, C type, offset)
 *   --format=js|c     JS module (default), or a C header: the structs, unions
 *                     and classes (fields only) as C definitions, followed by
 *                     _Static_asserts of their sizes and member offsets
 *   -o, --output=<path>   write the module here instead of stdout
 *   -h, --help        show this help
 */
import * as std from 'std';
import { loadIR, generate, generateC } from './gen-bindings/emit/structs.js';

function usage() {
  std.err.puts(
    'Usage: qjsm gen-structs.js [options] <ir.json>...\n' +
      '  --struct=<name>       only this struct and the ones it nests (repeatable)\n' +
      '  --format=js|c         JS module (default) or C header with the same layout\n' +
      '  --describe            layout and Symbol.for("describe") signatures on each class (JS only)\n' +
      '  --jsdoc               JSDoc block with member types on each class (JS only)\n' +
      '  -o, --output=<path>   write the module here instead of stdout\n' +
      '  -h, --help            show this help\n',
  );
}

function parseArgs(argv) {
  const opts = { files: [], structs: [], output: null, format: 'js' };

  for(let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if(a === '-h' || a === '--help') {
      usage();
      std.exit(0);
    } else if(a.startsWith('--struct=')) {
      opts.structs.push(a.slice('--struct='.length));
    } else if(a === '--describe') {
      opts.describe = true;
    } else if(a === '--jsdoc') {
      opts.jsdoc = true;
    } else if(a.startsWith('--format=')) {
      opts.format = a.slice('--format='.length);
      if(opts.format !== 'js' && opts.format !== 'c') throw new Error('unknown format: ' + opts.format);
    } else if(a === '-o' || a === '--output') {
      opts.output = argv[++i];
    } else if(a.startsWith('--output=')) {
      opts.output = a.slice('--output='.length);
    } else if(a.startsWith('-')) {
      throw new Error('unknown option: ' + a);
    } else {
      opts.files.push(a);
    }
  }

  if(!opts.files.length) throw new Error('missing <ir.json> argument');
  return opts;
}

function main() {
  let opts;

  try {
    opts = parseArgs(scriptArgs.slice(1));
  } catch(e) {
    std.err.puts('gen-structs.js: ' + e.message + '\n');
    usage();
    std.exit(1);
  }

  let out;

  try {
    const ir = loadIR(opts.files);

    out = opts.format === 'c' ? generateC(ir, opts) : generate(ir, opts);
  } catch(e) {
    std.err.puts('gen-structs.js: ' + e.message + '\n');
    std.exit(1);
  }

  if(opts.output) {
    const f = std.open(opts.output, 'w');
    f.puts(out);
    f.close();
  } else {
    std.puts(out);
  }
}

main();

