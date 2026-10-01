import * as std from 'std';
import { realpath } from 'os';
import { dlopen, ptr } from 'ffi';
import { tests, eq, assert } from './tinytest.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';
const ir = tmp + 'test-gen-structs.ir.json';

function sh(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();
  p.close();
  return out;
}

function write(path, text) {
  const f = std.open(path, 'w');
  f.puts(text);
  f.close();
}

sh('mkdir -p ' + tmp);
sh('cc -shared -fPIC -o ' + tmp + 'libstructs.so ' + root + 'tests/cxx/structs.c');
sh('qjsm ' + root + 'tools/gen-bindings.js --no-cache --emit-ir=' + ir + ' ' + root + 'tests/cxx/structs.h');
assert(std.loadFile(ir) !== null, 'no IR written for structs.h');

let generation = 0;

/* Generates a module from an IR file and imports it; each call gets its own
 * file since a module cannot be re-imported by URL. */
async function generated(irFile, ...args) {
  const name = 'test-gen-structs.gen' + generation++ + '.js';
  const out = sh(['qjsm', root + 'tools/gen-structs.js', ...args, '-o', tmp + name, irFile].join(' '));

  assert(std.loadFile(tmp + name) !== null, 'no module written, output was:\n' + out);
  return import('../.tmp/' + name);
}

const lib = dlopen(realpath(tmp + 'libstructs.so')[0], {
  sample_fill: { args: ['pointer'], returns: 'void' },
  sample_check: { args: ['pointer'], returns: 'i32' },
});

const { sample, sample_t, inner, number } = await generated(ir);

await tests({
  'a zeroed buffer of the struct size, aliased by its typedef'() {
    const s = new sample();

    eq(216, s.byteLength);
    eq(sample, sample_t);
    eq(4, new inner().byteLength);
    eq(4, new number().byteLength);
  },

  'getters read what C wrote'() {
    const s = new sample();

    lib.symbols.sample_fill(s.ptr);
    eq(-8, s.i8);
    eq(200, s.u8);
    eq(-1600, s.i16);
    eq(60000, s.u16);
    eq(-123456, s.i32);
    eq(4000000000, s.u32);
    eq(-(1n << 40n), s.i64);
    eq(0xfedcba9876543210n, s.u64);
    eq(1.5, s.f);
    eq(-2.25, s.d);
    eq(true, s.flag);
    eq(0x1234, s.ptr_);
    eq(5, s.color);
    eq(5, s.ua);
    eq(-7, s.sb);
    eq(0x123456789an, s.big);
    eq('1,2,3,4', s.arr.join());
    eq(97, s.text[0]);
    eq(4, s.mat[3]);
    eq(-3, s.in.a);
    eq(120, s.in.b);
    eq(2, new DataView(s.pair.buffer, s.pair.byteOffset).getInt16(4, true));
    eq(216n, s.len);
    eq(99, s.slice_);
  },

  'bool and enum arrays are typed-array views'() {
    const s = new sample();

    lib.symbols.sample_fill(s.ptr);
    assert(s.flags instanceof Uint8Array, 'flags is not a Uint8Array');
    eq('1,0,1,1', s.flags.join());
    assert(s.cols instanceof Int32Array, 'cols is not an Int32Array');
    eq('5,0', s.cols.join());
  },

  'a pointer array is a Proxy: null slots, struct wrappers, plain pointers'() {
    const s = new sample();

    lib.symbols.sample_fill(s.ptr);
    eq(2, s.ptrs.length);
    assert(s.ptrs[0] instanceof inner, 'ptrs[0] is not an inner');
    eq(7, s.ptrs[0].a);
    eq(107, s.ptrs[0].b);
    eq(null, s.ptrs[1]);
    eq(undefined, s.ptrs[2]);
    assert(s.names[0] !== null && typeof s.names[0] !== 'object', 'names[0] is not a plain pointer');
    eq(null, s.names[1]);
    eq('true,false', [...s.ptrs].map(p => p instanceof inner).join());
  },

  'a pointer array slot set to a wrapper reads back as a live wrapper'() {
    const s = new sample();
    const p = new inner();

    s.ptrs[1] = p;
    p.a = 56;
    assert(s.ptrs[1] instanceof inner, 'not an inner');
    eq(56, s.ptrs[1].a);
  },

  'setters write what C reads'() {
    const s = new sample();

    s.i8 = -100;
    s.u8 = 250;
    s.i16 = -30000;
    s.u16 = 65000;
    s.i32 = -2000000000;
    s.u32 = 4294967295;
    s.i64 = -9000000000000000000n;
    s.u64 = 18000000000000000000n;
    s.f = 0.25;
    s.d = 1e100;
    s.flag = false;
    s.ptr_ = 0xdeadbeef;
    s.color = 0;
    s.ua = 6;
    s.sb = -16;
    s.big = 0xffffffffffn;
    s.arr.set([10, 20, 30, 40]);
    new Uint8Array(s.text.buffer, s.text.byteOffset, 4).set([120, 121, 122, 0]);
    s.mat[3] = 8.5;
    s.in = (() => {
      const i = new inner();
      i.a = 77;
      i.b = 113;
      return i;
    })();
    new DataView(s.pair.buffer, s.pair.byteOffset).setInt16(4, 5, true);
    s.pair[6] = 122;
    s.len = 12345;
    s.slice_ = 7;
    s.flags.set([0, 1, 0, 0]);
    s.cols.set([0, 5]);

    const p = new inner();

    p.a = 55;
    p.b = 112;
    s.ptrs[1] = p;
    s.names[1] = 0x4321;

    eq(0, lib.symbols.sample_check(s.ptr));
  },

  'a pointer to a struct member is a live wrapper, null is null'() {
    const irFile = tmp + 'test-gen-structs.ptr.json';

    write(
      irFile,
      JSON.stringify([
        { name: 'B', type: 'struct', size: 8, fields: [{ name: 'v', type: 'unsigned long long', ffi: 'u64', offset: 0, size: 8 }] },
        { name: 'A', type: 'struct', size: 8, fields: [{ name: 'b', type: 'struct B *', offset: 0, size: 8 }] },
      ]),
    );

    return generated(irFile).then(({ A, B }) => {
      const b = new B();
      const a = new A();

      b.v = 42n;
      eq(null, a.b);

      a.b = b;
      assert(a.b instanceof B, 'not a B');
      eq(8, a.b.byteLength);
      eq(42n, a.b.v);

      a.b.v = 7n;
      eq(7n, b.v);
    });
  },

  '--format=c compiles and its asserts hold for the compiled layout'() {
    const h = tmp + 'test-gen-structs.gen.h';
    const out = sh('qjsm ' + root + 'tools/gen-structs.js --format=c -o ' + h + ' ' + ir);

    write(tmp + 'test-gen-structs.c', '#include "test-gen-structs.gen.h"\nint main(void) { return 0; }\n');
    eq('', out + sh('cc -std=c11 -Wall -Werror -c -o ' + tmp + 'test-gen-structs.o ' + tmp + 'test-gen-structs.c'));
  },

  '--struct limits the output to the struct and what it needs'() {
    const h = tmp + 'test-gen-structs.one.h';

    sh('qjsm ' + root + 'tools/gen-structs.js --format=c --struct=inner -o ' + h + ' ' + ir);

    const text = std.loadFile(h);

    assert(text.includes('struct inner {'), 'inner missing');
    assert(!text.includes('struct sample {'), 'sample should be left out');
  },

  '--describe and --jsdoc: layout and signatures on the class, member docs in its block'() {
    const name = 'test-gen-structs.doc.js';

    sh(['qjsm', root + 'tools/gen-structs.js', '--describe', '--jsdoc', '-o', tmp + name, ir].join(' '));

    const text = std.loadFile(tmp + name);

    assert(text !== null, 'no module written');
    assert(text.includes('@property {number} i32 - int32_t, offset 8') && text.includes('@property {bigint} u64 - uint64_t, offset 24'), 'member docs');
    assert(text.includes('@property {Int32Array} arr - int[4], offset 88'), 'array member doc');
    assert(text.includes("__sig(sample, [{params:['init: number'],arity:1}"), 'constructor signature');
    assert(text.includes('sample.size = 216;'), 'layout');

    sh(['qjsm', root + 'tools/gen-structs.js', '-o', tmp + 'test-gen-structs.plain.js', ir].join(' '));
    assert(!std.loadFile(tmp + 'test-gen-structs.plain.js').includes('@property'), 'plain output has no docs');
  },
});
