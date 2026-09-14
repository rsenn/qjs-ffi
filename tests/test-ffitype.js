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
});
