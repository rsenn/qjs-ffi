import { tests, eq, assert } from './tinytest.js';
import { read, ptr } from 'ffi';

function assertThrows(fn, type) {
  try {
    fn();
  } catch(e) {
    assert(!type || e instanceof type, 'expected ' + type.name + ', got ' + e);
    return e;
  }
  throw new Error('expected to throw');
}

// 16 bytes: 01 ff 02 80 | 78 56 34 12 | ff ff ff ff ff ff ff 7f
const mem = new Uint8Array([1, 0xff, 2, 0x80, 0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]);
const p = ptr(mem);

await tests({
  'read.u8/i8 are unsigned/signed'() {
    eq(255, read.u8(p, 1));
    eq(-1, read.i8(p, 1));
    eq(1, read.u8(p, 0));
  },

  'read.u16/i16'() {
    eq(0x8002, read.u16(p, 2));
    eq(-0x7ffe, read.i16(p, 2));
  },

  'read.u32/i32'() {
    eq(0x12345678, read.u32(p, 4));
    eq(-1, read.i32(p, 8));
    eq(0xffffffff, read.u32(p, 8));
  },

  'read.i64/u64 give a bigint'() {
    eq('9223372036854775807', String(read.i64(p, 8)));
    eq('9223372036854775807', String(read.u64(p, 8)));
    assert(typeof read.i64(p, 0) == 'bigint');
  },

  'read.f32/f64'() {
    const f = new Float64Array([1.5, -2.25]);
    eq(1.5, read.f64(ptr(f), 0));
    eq(-2.25, read.f64(ptr(f), 8));
    eq(0.5, read.f32(ptr(new Float32Array([0.5])), 0));
  },

  'read.ptr reads a pointer-sized address'() {
    const cell = new BigUint64Array([BigInt(p)]);
    eq(String(BigInt(p)), String(BigInt(read.ptr(ptr(cell), 0))));
    eq(null, read.ptr(ptr(new BigUint64Array([0n])), 0));
  },

  'byteOffset defaults to 0 and may be negative; reads need no alignment'() {
    eq(1, read.u8(p));
    eq(0x8002, read.u16(p, 2));
    eq(0x5678, read.u16(p, 4));
    eq(0x3456, read.u16(p, 5));
    eq(255, read.u8(ptr(mem, 2), -1));
  },

  'an ArrayBuffer or view works as the pointer'() {
    eq(2, read.u8(mem, 2));
    eq(0x12345678, read.u32(mem.buffer, 4));
  },

  'a NULL pointer, or a non-pointer, throws TypeError'() {
    assertThrows(() => read.u8(null, 0), TypeError);
    assertThrows(() => read.u8(0, 0), TypeError);
    assertThrows(() => read.u8(), TypeError);
  },
});
