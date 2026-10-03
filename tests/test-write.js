import { tests, eq, assert } from './tinytest.js';
import { read, write, ptr, toArrayBuffer } from 'ffi';

function assertThrows(fn, type) {
  try {
    fn();
  } catch(e) {
    assert(!type || e instanceof type, 'expected ' + type.name + ', got ' + e);
    return e;
  }
  throw new Error('expected to throw');
}

const bytes = mem => [...mem].join();

await tests({
  'write.<int> stores the width, little-endian, and read gives it back'() {
    const mem = new Uint8Array(16);
    const p = ptr(mem);

    write.u8(p, 0, 0xab);
    write.i16(p, 1, -2);
    write.u32(p, 4, 0x12345678);
    eq(0xab, mem[0]);
    eq('254,255', bytes(mem.subarray(1, 3)));
    eq('120,86,52,18', bytes(mem.subarray(4, 8)));
    eq(-2, read.i16(p, 1));
    eq(0x12345678, read.u32(p, 4));
  },

  '64-bit values take a bigint or a number'() {
    const mem = new Uint8Array(16);
    const p = ptr(mem);

    write.i64(p, 0, -5n);
    write.u64(p, 8, 2n ** 64n - 1n);
    eq(-5n, read.i64(p, 0));
    eq(2n ** 64n - 1n, read.u64(p, 8));
    write.i64(p, 0, 7);
    eq(7n, read.i64(p, 0));
  },

  'an integer wraps to the width'() {
    const mem = new Uint8Array(8);
    const p = ptr(mem);

    write.u8(p, 0, 256 + 3);
    write.i8(p, 1, 200);
    write.u16(p, 2, -1);
    eq(3, mem[0]);
    eq(-56, read.i8(p, 1));
    eq(65535, read.u16(p, 2));
  },

  'floats: f32 rounds to single precision'() {
    const mem = new Uint8Array(16);
    const p = ptr(mem);

    write.f32(p, 0, 1.5);
    write.f64(p, 8, -2.25);
    eq(1.5, read.f32(p, 0));
    eq(-2.25, read.f64(p, 8));
    write.f32(p, 0, 0.1);
    assert(read.f32(p, 0) !== 0.1 && Math.abs(read.f32(p, 0) - 0.1) < 1e-7, 'single precision');
  },

  'ptr and intptr: a pointer argument is anything a pointer argument takes'() {
    const mem = new Uint8Array(32);
    const target = new Uint8Array(4);
    const p = ptr(mem);

    write.ptr(p, 0, ptr(target));
    write.ptr(p, 8, null);
    write.ptr(p, 16, 4096n);
    write.intptr(p, 24, -1);
    eq(ptr(target), read.ptr(p, 0));
    eq(null, read.ptr(p, 8));
    eq(4096, read.ptr(p, 16));
    eq(-1, read.intptr(p, 24));
  },

  'the offset is optional: (ptr, value) writes at 0, and a negative offset counts back'() {
    const mem = new Uint8Array(8);
    const p = ptr(mem);

    write.u8(p, 9);
    eq(9, mem[0]);
    write.u8(p + 8, -1, 7);
    eq(7, mem[7]);
  },

  'a buffer or a view as the pointer'() {
    const mem = new Uint8Array(8);

    write.u16(mem, 2, 0x0102);
    eq('0,0,2,1,0,0,0,0', bytes(mem));
    write.u8(mem.buffer, 7, 5);
    eq(5, mem[7]);
  },

  'write.bytes copies a buffer or a view and returns the count; a length limits it'() {
    const mem = new Uint8Array(8);
    const p = ptr(mem);

    eq(3, write.bytes(p, 1, new Uint8Array([1, 2, 3])));
    eq('0,1,2,3,0,0,0,0', bytes(mem));
    eq(2, write.bytes(p, 4, new Uint16Array([0x0201, 0x0403]).buffer, 2));
    eq('0,1,2,3,1,2,0,0', bytes(mem));
    eq(2, write.bytes(p, 6, new DataView(new Uint8Array([8, 9, 10]).buffer, 0, 2)));
    eq('0,1,2,3,1,2,8,9', bytes(mem));
  },

  'write.cstring writes UTF-8 and a NUL, and returns the bytes without the NUL'() {
    const mem = new Uint8Array(8).fill(0xff);
    const p = ptr(mem);

    eq(2, write.cstring(p, 0, 'hi'));
    eq('104,105,0,255', bytes(mem.subarray(0, 4)));
    eq(2, write.cstring(p, 4, 'é'));
    eq('195,169,0', bytes(mem.subarray(4, 7)));
  },

  'errors: NULL, a missing value, a bad value, a bad source'() {
    const mem = new Uint8Array(8);
    const p = ptr(mem);

    assertThrows(() => write.u8(null, 0, 1), TypeError);
    assertThrows(() => write.u8(0, 0, 1), TypeError);
    assertThrows(() => write.u8(p), TypeError);
    assertThrows(() => write.u8(), TypeError);
    assertThrows(() => write.u8('x', 0, 1), TypeError);
    assertThrows(() => write.u8(p, Symbol('x'), 1), TypeError);
    assertThrows(() => write.u8(p, 0, Symbol('x')), TypeError);
    assertThrows(() => write.bytes(p, 0, 'abc'), TypeError);
    assertThrows(() => write.bytes(p, 0, new Uint8Array(1), -1), TypeError);
    assertThrows(() => write.cstring(p, 0, 42), TypeError);
    assertThrows(() => write.ptr(p, 0, 'abc'), TypeError);
    eq('0,0,0,0,0,0,0,0', bytes(mem));
  },

  'writes reach memory that a toArrayBuffer view shows'() {
    const mem = new Uint8Array(4);
    const view = new Uint8Array(toArrayBuffer(ptr(mem), 0, 4));

    write.u32(ptr(mem), 0, 0x04030201);
    eq('1,2,3,4', bytes(view));
  },

  'write has one function per kind'() {
    eq('bytes,cstring,f32,f64,i16,i32,i64,i8,intptr,ptr,u16,u32,u64,u8', Object.getOwnPropertyNames(write).sort().join());
  },
});
