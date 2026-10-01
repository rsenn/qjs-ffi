import { tests, eq, assert } from './tinytest.js';
import { FFIType, CFunction, JSCallback, dlsym, RTLD_DEFAULT } from 'ffi';

function libc(name) {
  const p = dlsym(RTLD_DEFAULT, name);
  assert(p != null, 'dlsym(' + name + ') failed');
  return p;
}

const NAMES = [
  'void', 'bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'i64', 'u64',
  'i64_fast', 'u64_fast', 'f32', 'f64', 'pointer', 'ptr', 'function', 'cstring',
];

await tests({
  'FFIType exposes the full name vocabulary, each mapped to itself'() {
    for(const name of NAMES)
      eq(name, FFIType[name]);
  },

  'FFIType has no extra names beyond the documented vocabulary'() {
    eq(NAMES.length, Object.keys(FFIType).length);
  },

  'FFIType.* is interchangeable with the equivalent string in CFunction'() {
    const abs = CFunction({ ptr: libc('abs'), args: [FFIType.i32], returns: FFIType.i32 });
    eq(5, abs(-5));
  },

  'FFIType.cstring/u64 work for CFunction args/returns'() {
    const strlen = CFunction({ ptr: libc('strlen'), args: [FFIType.cstring], returns: FFIType.u64 });
    eq(5n, strlen('hello'));
  },

  'FFIType.* is interchangeable with the equivalent string in JSCallback'() {
    let seen;
    const cb = new JSCallback(v => { seen = v; return v * 2; }, { args: [FFIType.i32], returns: FFIType.i32 });
    const call = CFunction({ ptr: cb.ptr, args: [FFIType.i32], returns: FFIType.i32 });

    eq(14, call(7));
    eq(7, seen);
    cb.close();
  },

  'any type name ending in * is a pointer, as argument and as return'() {
    for(const t of ['void *', 'int *', 'struct foo **', 'char*', 'unsigned long * ', 'ns::Widget *']) {
      const malloc = CFunction({ ptr: libc('malloc'), args: ['u64'], returns: t });
      const free = CFunction({ ptr: libc('free'), args: [t], returns: 'void' });
      const p = malloc(16n);

      assert(p !== null && (typeof p === 'number' || typeof p === 'bigint'), t + ': malloc should return a pointer, got ' + typeof p);
      free(p);
    }
  },

  'a "char *" is a plain pointer, not a cstring'() {
    const strdup = CFunction({ ptr: libc('strdup'), args: ['cstring'], returns: 'char *' });
    const strlen = CFunction({ ptr: libc('strlen'), args: ['char *'], returns: 'u64' });
    const free = CFunction({ ptr: libc('free'), args: ['const char *'], returns: 'void' });
    const p = strdup('hello');

    try {
      assert(typeof p !== 'string', 'a "char *" return must stay a pointer, got a ' + typeof p);
      eq(5n, strlen(p));
    } finally {
      free(p);
    }
  },

  'a pointer-typed argument takes an ArrayBuffer'() {
    const strlen = CFunction({ ptr: libc('strlen'), args: ['const struct foo *'], returns: 'u64' });

    eq(3n, strlen(new Uint8Array([97, 98, 99, 0]).buffer));
  },

  'a name that neither ends in * nor is known still falls back to i32'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['no such type'], returns: 'i32' });

    eq(5, abs(-5));
  },

  'JSCallback accepts typed pointer arguments'() {
    let seen;
    const cb = new JSCallback(p => { seen = p; }, { args: ['int *'], returns: 'void' });
    const call = CFunction({ ptr: cb.ptr, args: ['int *'], returns: 'void' });

    call(new Int32Array([1]).buffer);
    assert(typeof seen === 'number' || typeof seen === 'bigint', 'callback should receive a pointer, got ' + typeof seen);
    cb.close();
  },
});
