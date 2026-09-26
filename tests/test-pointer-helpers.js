import { tests, eq, assert } from './tinytest.js';
import { dlopen, ptr, toBuffer, toPointer, CString } from 'ffi';

const bytes = str => new Uint8Array(Array.from(str, c => c.charCodeAt(0))).buffer;

await tests({
  'ptr() returns the same address as toPointer()'() {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    eq(toPointer(buf), '0x' + BigInt(ptr(buf)).toString(16));
  },

  'ptr()/toBuffer() round-trip preserves bytes'() {
    const src = new Uint8Array([1, 2, 3, 4, 5, 250]);
    const back = new Uint8Array(toBuffer(ptr(src.buffer), src.length));
    eq(src.join(), back.join());
  },

  'toBuffer(ptr, len) honours len'() {
    const src = new Uint8Array([9, 8, 7, 6]);
    eq(2, toBuffer(ptr(src.buffer), 2).byteLength);
  },

  'CString reads a NUL-terminated string'() {
    const buf = bytes('hello\0world');
    const s = new CString(ptr(buf));
    eq('hello', s.toString());
    eq(5, s.length);
  },

  'CString honours byteOffset and byteLength'() {
    const buf = bytes('hello world\0');
    const s = new CString(ptr(buf), 6, 3);
    eq('wor', s.toString());
    eq(3, s.length);
  },

  'CString.ptr is the pointer it wraps'() {
    const buf = bytes('abc\0');
    eq(Number(ptr(buf)), Number(new CString(ptr(buf)).ptr));
  },

  'CString wraps a pointer returned from native code'() {
    const lib = dlopen(null, { strdup: { args: ['cstring'], returns: 'ptr' } });
    const s = new CString(lib.symbols.strdup('from libc'));
    eq('from libc', s.toString());
    eq(9, s.length);
    lib.close();
  },
});
