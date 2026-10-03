import { tests, eq, assert } from './tinytest.js';
import { ptr, toArrayBuffer, toBuffer, dlsym, RTLD_DEFAULT, JSCallback, CFunction } from 'ffi';

function assertThrows(fn, type) {
  try {
    fn();
  } catch(e) {
    assert(!type || e instanceof type, 'expected ' + type.name + ', got ' + e);
    return e;
  }
  throw new Error('expected to throw');
}

const libc = name => dlsym(RTLD_DEFAULT, name);
const malloc = CFunction({ ptr: libc('malloc'), args: ['u64'], returns: 'ptr' });
const nul = new Uint8Array([0]);

await tests({
  'toArrayBuffer(ptr, off, len) is a view of the memory, not a copy'() {
    const src = new Uint8Array([1, 2, 3, 4, 5]);
    const ab = toArrayBuffer(ptr(src), 1, 3);

    eq(3, ab.byteLength);
    eq('2,3,4', new Uint8Array(ab).join());
    src[2] = 99;
    eq(99, new Uint8Array(ab)[1]);
  },

  'toArrayBuffer(ptr) without a length reads up to the NUL'() {
    const src = new Uint8Array([104, 105, 0, 7]);
    eq(2, toArrayBuffer(ptr(src)).byteLength);
    eq(1, toArrayBuffer(ptr(src), 1).byteLength);
    eq(0, toArrayBuffer(ptr(src), 2).byteLength);
  },

  'without a byteLength a negative byteOffset counts from the end of the C string'() {
    const src = new Uint8Array([104, 101, 108, 108, 111, 0, 120]);

    eq('108,111', new Uint8Array(toArrayBuffer(ptr(src), -2)).join());
    eq('104,101,108,108,111', new Uint8Array(toArrayBuffer(ptr(src), -5)).join());
    eq(1, toArrayBuffer(ptr(src), 4).byteLength);
  },

  'an explicit byteLength reads that much past any NUL; undefined is as if omitted'() {
    const src = new Uint8Array([104, 105, 0, 7, 8]);

    eq('104,105,0,7,8', new Uint8Array(toArrayBuffer(ptr(src), 0, 5)).join());
    eq(2, toArrayBuffer(ptr(src), 0, undefined).byteLength);
    eq('104,105,0', new Uint8Array(toArrayBuffer(ptr(src), undefined, 3)).join());
  },

  'toBuffer is the same function'() {
    const src = new Uint8Array([1, 2, 3]);
    eq('2,3', new Uint8Array(toBuffer(ptr(src), 1, 2)).join());
  },

  'a deallocator address as the 4th argument is accepted'() {
    const p = malloc(16n);
    let ab = toArrayBuffer(p, 0, 16, libc('free')); // free(bytes, <ignored>)

    eq(16, ab.byteLength);
    ab = null;
  },

  'deallocator gets (bytes, deallocatorContext) when the buffer is dropped'() {
    const mem = new Uint8Array([65, 66, 67, 0]);
    const src = new Uint8Array([90, 0]);
    // strcpy(bytes, context) writes the context string into the memory.
    let ab = toArrayBuffer(ptr(mem), 0, 4, ptr(src), libc('strcpy'));

    eq('65,66,67,0', new Uint8Array(ab).join());
    ab = null;
    eq('90,0,67,0', mem.join());
  },

  'a null context is allowed with a deallocator'() {
    const p = malloc(8n);
    let ab = toArrayBuffer(p, 0, 8, null, libc('free'));
    ab = null;
  },

  'a JSCallback or any other non-address deallocator is rejected'() {
    const cb = new JSCallback(() => {}, { args: ['ptr', 'ptr'], returns: 'void' });
    const src = new Uint8Array([1]);

    assertThrows(() => toArrayBuffer(ptr(src), 0, 1, cb), TypeError);
    assertThrows(() => toArrayBuffer(ptr(src), 0, 1, 'x'), TypeError);
    assertThrows(() => toArrayBuffer(ptr(src), 0, 1, null, {}), TypeError);
    cb.close();
  },

  'a NULL pointer, a length below 1 and a boolean argument throw'() {
    const src = new Uint8Array([1, 2]);

    assertThrows(() => toArrayBuffer(null, 0, 1), TypeError);
    assertThrows(() => toArrayBuffer(0, 0, 1), TypeError);
    assertThrows(() => toArrayBuffer(ptr(src), 0, -1), TypeError);
    assertThrows(() => toArrayBuffer(ptr(src), 0, 0), TypeError);
    assertThrows(() => toArrayBuffer(ptr(src), 0, 2, false), TypeError);
  },

  'an ArrayBuffer or string source keeps the (source, size, copy) form'() {
    eq(2, toArrayBuffer('hi').byteLength);

    const src = new Uint8Array([1, 2, 3]);
    eq(2, toArrayBuffer(src.buffer, 2, true).byteLength);
  },
});
