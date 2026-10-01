import * as std from 'std';
import { realpath } from 'os';
import { CFunction, JSCallback, dlopen, dlsym, RTLD_DEFAULT, RTLD_NOW } from 'ffi';
import { tests, eq, assert } from './tinytest.js';
const __ce = console.error; console.error = (...a) => __ce.apply(console, a.map(x => (x && x.message !== undefined ? 'ERR ' + x.message : String(x)))); // TEMP-DEBUG

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';

function sh(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();
  p.close();
  return out;
}

function assertThrows(fn, type) {
  try {
    fn();
  } catch(e) {
    assert(e instanceof type, 'expected ' + type.name + ', got ' + e);
    return e;
  }
  throw new Error('expected to throw');
}

sh('mkdir -p ' + tmp);
sh('cc -shared -fPIC -o ' + tmp + 'libbyvalue.so ' + root + 'tests/cxx/byvalue.c');

const lib = dlopen(realpath(tmp + 'libbyvalue.so')[0], RTLD_NOW);
assert(lib != null, 'dlopen failed');

const fn = (name, args, returns) => CFunction({ ptr: dlsym(lib, name), args, returns });
const libc = (name, args, returns) => CFunction({ ptr: dlsym(RTLD_DEFAULT, name), args, returns });

const VEC3 = ['f32', 'f32', 'f32'];
const MIX = ['i32', 'f64'];
const BIG = ['i64', 'i64', 'i64', 'i64', 'i64'];
const SEG = [VEC3, VEC3];
const PACKED = ['i8', 'u8', 'i16'];

const vec3 = (x, y, z) => new Float32Array([x, y, z]).buffer;

await tests({
  'libc div() returns a struct of two ints in one register'() {
    const r = libc('div', ['i32', 'i32'], ['i32', 'i32'])(17, 5);

    assert(r instanceof ArrayBuffer, 'a struct comes back as an ArrayBuffer');
    eq(8, r.byteLength);
    eq('3,2', [...new Int32Array(r)].join());
  },

  'libc ldiv() returns two longs in two registers'() {
    const r = libc('ldiv', ['i64', 'i64'], ['i64', 'i64'])(100, 7);

    eq(16, r.byteLength);
    eq('14,2', [...new BigInt64Array(r)].join());
  },

  'a struct of floats is passed and returned in vector registers'() {
    const add = fn('vec3_add', [VEC3, VEC3], VEC3);
    const r = add(vec3(1, 2, 3), vec3(10, 20, 30));

    eq(12, r.byteLength);
    eq('11,22,33', [...new Float32Array(r)].join());
    eq(32, fn('vec3_dot', [VEC3, VEC3], 'f32')(vec3(1, 2, 3), vec3(2, 3, 8)));
  },

  'a struct mixing an int and a double'() {
    const m = fn('mix_make', ['i32', 'f64'], MIX)(7, 0.5);
    const dv = new DataView(m);

    eq(16, m.byteLength);
    eq(7, dv.getInt32(0, true));
    eq(0.5, dv.getFloat64(8, true));
    eq(7.5, fn('mix_sum', [MIX], 'f64')(m));
  },

  'a struct too big for registers goes through memory, both ways'() {
    const b = fn('big_make', ['i64'], BIG)(10);

    eq(40, b.byteLength);
    eq('10,11,12,13,14', [...new BigInt64Array(b)].join());
    eq(60, fn('big_sum', [BIG], 'i64')(b));
  },

  'a nested struct is an array inside the array'() {
    const make = fn('seg_make', [VEC3, VEC3], SEG);
    const s = make(vec3(0, 0, 0), vec3(1, 2, 2));

    eq(24, s.byteLength);
    eq('0,0,0,1,2,2', [...new Float32Array(s)].join());
    eq(9, fn('seg_len2', [SEG], 'f32')(s));
  },

  'a struct whose bitfields share one byte: the elements must match the real layout'() {
    const p = fn('packed_make', ['i8', 'i32', 'i32', 'i16'], PACKED)(65, 5, 17, 1234);
    const dv = new DataView(p);

    eq(4, p.byteLength);
    eq(65, dv.getInt8(0));
    eq(5 | (17 << 3), dv.getUint8(1));
    eq(1234, dv.getInt16(2, true));
    eq(1234, fn('packed_n', [PACKED], 'i32')(p));
  },

  'a TypedArray view is accepted as the argument, at its own offset'() {
    const whole = new Float32Array([9, 9, 9, 1, 2, 3]);
    const view = new Float32Array(whole.buffer, 12, 3);

    eq(14, fn('vec3_dot', [VEC3, VEC3], 'f32')(view, view));
  },

  'the result is a new buffer each call, not shared memory'() {
    const add = fn('vec3_add', [VEC3, VEC3], VEC3);
    const a = add(vec3(1, 1, 1), vec3(1, 1, 1));
    const b = add(vec3(5, 5, 5), vec3(5, 5, 5));

    eq(2, new Float32Array(a)[0]);
    eq(10, new Float32Array(b)[0]);
  },

  'an argument that is too small or not a buffer throws a TypeError'() {
    const dot = fn('vec3_dot', [VEC3, VEC3], 'f32');
    const before = fn('calls_made', [], 'i64')();

    assertThrows(() => dot(new ArrayBuffer(8), vec3(1, 2, 3)), TypeError);
    assertThrows(() => dot(vec3(1, 2, 3), 1234), TypeError);
    assertThrows(() => dot(vec3(1, 2, 3)), TypeError);
    eq(before, fn('calls_made', [], 'i64')());
  },

  'an invalid struct type throws when the CFunction is made'() {
    const ptr = dlsym(lib, 'vec3_dot');

    assertThrows(() => CFunction({ ptr, args: [[]], returns: 'f32' }), RangeError);
    assertThrows(() => CFunction({ ptr, args: [['void']], returns: 'f32' }), TypeError);
    assertThrows(() => CFunction({ ptr, args: [['nonsense']], returns: 'f32' }), TypeError);
    assertThrows(() => CFunction({ ptr, args: [], returns: [[[[[[[[[['i32']]]]]]]]]] }), RangeError);
  },

  'a JSCallback cannot take or return a struct'() {
    assertThrows(() => new JSCallback(() => {}, { args: [VEC3], returns: 'void' }), TypeError);
    assertThrows(() => new JSCallback(() => vec3(0, 0, 0), { args: [], returns: VEC3 }), TypeError);
  },

  'gen-bindings: structs by value are bound, what libffi would lay out differently is skipped with the reason'() {
    const file = tmp + 'test-struct-by-value.ir.json';

    sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--emit-ir=' + file, root + 'tests/cxx/byvalue.h'].join(' '));

    const ir = JSON.parse(std.loadFile(file));
    const reason = name => (ir.skipped.find(s => s.name === name) || {}).reason;

    eq('f32,f32,f32', ir.byValue.vec3.join());
    eq('i32,f64', ir.byValue.mix.join());
    eq('f32,f32,f32|f32,f32,f32', ir.byValue.seg.map(e => e.join()).join('|'));
    eq('i8,u8,i16', ir.byValue.packed.join());
    eq('u64,u64,i64', ir.byValue.wide.join());
    assert(ir.methods.some(m => m.name === 'vec3_add' && m.returnType === 'struct vec3'), 'vec3_add is bound');

    assert(/libffi would put b at 8, not 1/.test(reason('pk_make')), reason('pk_make'));
    assert(/union is not supported/.test(reason('un_make')), reason('un_make'));
    assert(/anonymous struct or union/.test(reason('wrapped_make')), reason('wrapped_make'));
  },

  'gen-bindings: a generated module returns the struct classes and takes them as arguments'() {
    const name = 'test-struct-by-value.gen.js';
    const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--structs', '--describe', '--jsdoc', '--library=' + realpath(tmp + 'libbyvalue.so')[0], '-o', tmp + name, root + 'tests/cxx/byvalue.h'].join(' '));

    assert(std.loadFile(tmp + name) !== null, 'no module written, output was:\n' + out);

    return import('../.tmp/' + name).then(m => {
      const v = (x, y, z) => Object.assign(new m.vec3(), { x, y, z });
      const r = m.vec3_add(v(1, 2, 3), v(10, 20, 30));

      assert(r instanceof m.vec3 && r instanceof ArrayBuffer, 'the result is a vec3');
      eq('11,22,33', [r.x, r.y, r.z].join());
      eq(32, m.vec3_dot(v(1, 2, 3), v(2, 3, 8)));

      const b = m.big_make(10);

      assert(b instanceof m.big, 'the result is a big');
      eq('60', String(m.big_sum(b)));

      const w = m.wide_make(1, 2, 3);

      assert(w instanceof m.wide, 'the result is a wide');
      eq('6', String(m.wide_sum(w)));

      const p = m.packed_make(65, 5, 17, 1234);

      eq('65,5,17,1234', [p.tag, p.flags, p.mode, p.n].join());
      eq(9, m.seg_len2(m.seg_make(v(0, 0, 0), v(1, 2, 2))));
      assert(!('pk_make' in m) && !('un_make' in m), 'skipped functions are not exported');
    });
  },

  'gen-bindings: with --api=define a struct by value is skipped, define() has no struct type'() {
    const file = tmp + 'test-struct-by-value.define.ir.json';

    sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--api=define', '--emit-ir=' + file, root + 'tests/cxx/byvalue.h'].join(' '));

    const ir = JSON.parse(std.loadFile(file));

    assert(!ir.methods.some(m => m.name === 'vec3_add'), 'vec3_add must not be bound');
    assert(ir.skipped.some(s => s.name === 'vec3_add' && /needs --api=cfunction/.test(s.reason)), JSON.stringify(ir.skipped.slice(0, 2)));
    assert(ir.methods.some(m => m.name === 'calls_made'), 'plain functions stay');
  },

  'many calls with big structs do not leak or crash'() {
    const make = fn('big_make', ['i64'], BIG);
    const sum = fn('big_sum', [BIG], 'i64');
    let total = 0n;

    for(let i = 0; i < 2000; i++) total += sum(make(i));
    eq(String(5n * 1999n * 2000n / 2n + 10n * 2000n), String(total));
    std.gc();
  },
});
