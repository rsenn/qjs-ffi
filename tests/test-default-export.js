import { tests, eq, assert } from './tinytest.js';
import * as ns from 'ffi';
import ffi, { dlopen, FFIType, read, CFunction, CString, JSCallback } from 'ffi';

await tests({
  'the default export is an object holding the other exports, as the same values'() {
    assert(ffi !== null && typeof ffi === 'object', 'default is not an object');
    assert(ffi.dlopen === dlopen && ffi.FFIType === FFIType && ffi.read === read, 'named and default differ');
    assert(ffi.CFunction === CFunction && ffi.CString === CString && ffi.JSCallback === JSCallback, 'classes differ');
  },

  'every named export is in the default object, which has no default of its own'() {
    const named = Object.keys(ns).filter(k => k !== 'default');

    eq(named.slice().sort().join(), Object.keys(ffi).sort().join());
    eq(undefined, ffi.default);
  },

  'the default export works as the module'() {
    const { symbols } = ffi.dlopen(null, { abs: { args: ['i32'], returns: 'i32' } });
    eq(4, symbols.abs(-4));
  },
});
