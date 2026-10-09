import { tests, eq, assert } from './tinytest.js';
import * as nffi from 'node/ffi.js';
import { CFunction } from 'ffi';

const { dlopen, DynamicLibrary } = nffi;

function assertThrows(fn, type) {
  try {
    fn();
  } catch(e) {
    assert(!type || e instanceof type, 'expected ' + type.name + ', got ' + e);
    return e;
  }
  throw new Error('expected to throw');
}

const dispose = Symbol.dispose || Symbol.for('Symbol.dispose');
const libc = () => new DynamicLibrary(null);

await tests({
  'dlopen(path, definitions) returns { lib, functions } with Node signatures'() {
    const { lib, functions } = dlopen(null, { abs: { arguments: ['int32'], return: 'int32' }, labs: { arguments: ['int64'], return: 'int64' } });

    assert(lib instanceof DynamicLibrary, 'lib');
    eq(5, functions.abs(-5));
    eq(7n, functions.labs(-7n));
    eq('bigint', typeof functions.abs.pointer);
    lib.close();
  },

  'the result of dlopen() and the library close with `using`'() {
    const result = dlopen(null, { abs: { arguments: ['int32'], return: 'int32' } });

    eq('function', typeof result[dispose]);
    result[dispose]();
    assertThrows(() => result.lib.getSymbol('abs'), Error);
    result.lib.close(); // twice is fine
  },

  'type names: 8, 16 and 32-bit are numbers, bool is a u8, float32 and float64'() {
    const lib = libc();
    const f = lib.getFunctions({
      toupper: { arguments: ['int32'], return: 'int32' },
      sqrt: { arguments: ['float64'], return: 'float64' },
      sqrtf: { arguments: ['float32'], return: 'float32' },
      isalpha: { arguments: ['u8'], return: 'bool' },
    });

    eq(65, f.toupper(97));
    eq(3, f.sqrt(9));
    eq(2, f.sqrtf(4));
    eq('number', typeof f.isalpha(65));
  },

  'pointers are bigints, 0n for NULL; strings are UTF-8 for the call, a pointer result is an address'() {
    const lib = libc();
    const { strlen, strdup, free, getenv } = lib.getFunctions({
      strlen: { arguments: ['string'], return: 'uint64' },
      strdup: { arguments: ['string'], return: 'pointer' },
      free: { arguments: ['pointer'], return: 'void' },
      getenv: { arguments: ['string'], return: 'string' },
    });

    eq(2n, strlen('é'));

    const p = strdup('hello');

    eq('bigint', typeof p);
    eq('hello', nffi.toString(p));
    free(p);
    eq(0n, getenv('NO_SUCH_VARIABLE_xyz'));
    eq(null, nffi.toString(0n));
  },

  'buffer, arraybuffer and typed arrays are passed as their memory'() {
    const lib = libc();
    const { memset } = lib.getFunctions({ memset: { arguments: ['buffer', 'int32', 'uint64'], return: 'pointer' } });
    const bytes = new Uint8Array(4);
    const ab = new ArrayBuffer(4);

    memset(bytes, 7, 3n);
    eq('7,7,7,0', bytes.join());
    memset(ab, 9, 4n);
    eq('9,9,9,9', [...new Uint8Array(ab)].join());
  },

  'getInt*/setInt* and the 64-bit and float forms'() {
    const mem = new Uint8Array(32);
    const p = nffi.getRawPointer(mem);

    eq('bigint', typeof p);
    nffi.setInt32(p, 0, -2);
    nffi.setUint16(p, 4, 65535);
    nffi.setInt64(p, 8, -3n);
    nffi.setFloat64(p, 16, 2.5);
    nffi.setFloat32(p, 24, 1.5);
    eq(-2, nffi.getInt32(p));
    eq(65535, nffi.getUint16(p, 4));
    eq(-3n, nffi.getInt64(p, 8));
    eq(2.5, nffi.getFloat64(p, 16));
    eq(1.5, nffi.getFloat32(p, 24));
    eq(0xfe, nffi.getUint8(p));
  },

  'toArrayBuffer(pointer, length) copies, and a false copy is a view of the memory'() {
    const mem = new Uint8Array([1, 2, 3, 4]);
    const p = nffi.getRawPointer(mem);
    const copy = nffi.toArrayBuffer(p, 4);
    const view = nffi.toArrayBuffer(p, 4, false);

    mem[0] = 9;
    eq(1, new Uint8Array(copy)[0]);
    eq(9, new Uint8Array(view)[0]);
    eq('9,2,3', nffi.toBuffer(p, 3).join());
    eq(0, nffi.toArrayBuffer(p, 0).byteLength);
  },

  'exportString, exportBuffer, exportArrayBuffer and exportArrayBufferView copy into memory'() {
    const mem = new Uint8Array(16).fill(0xff);
    const p = nffi.getRawPointer(mem);

    nffi.exportString('hi', p, 3);
    eq('104,105,0,255', mem.subarray(0, 4).join());
    nffi.exportBuffer(new Uint8Array([1, 2]), p + 4n, 2);
    nffi.exportArrayBuffer(new Uint8Array([3]).buffer, p + 6n, 1);
    nffi.exportArrayBufferView(new Uint16Array([0x0504]), p + 7n, 2);
    eq('1,2,3,4,5', mem.subarray(4, 9).join());
    assertThrows(() => nffi.exportString('toolong', p, 4), RangeError);
    assertThrows(() => nffi.exportBuffer(new Uint8Array(5), p, 4), RangeError);
    assertThrows(() => nffi.exportString('x', p, 4, 'latin1'), TypeError);
  },

  'registerCallback gives a bigint pointer that C can call; unregisterCallback closes it'() {
    const lib = libc();
    const { qsort } = lib.getFunctions({ qsort: { arguments: ['buffer', 'uint64', 'uint64', 'function'], return: 'void' } });
    const calls = [];
    const compare = lib.registerCallback({ arguments: ['pointer', 'pointer'], return: 'int32' }, (a, b) => {
      calls.push(typeof a);
      return nffi.getInt32(a) - nffi.getInt32(b);
    });
    const data = new Int32Array([3, 1, 2]);

    eq('bigint', typeof compare);
    qsort(data, 3n, 4n, compare);
    eq('1,2,3', data.join());
    assert(calls.length > 0 && calls.every(t => t === 'bigint'), 'pointer arguments are bigints');

    lib.refCallback(compare);
    lib.unrefCallback(compare);
    lib.unregisterCallback(compare);
    lib.unregisterCallback(compare); // twice is fine
  },

  'registerCallback(fn) is a void callback with no arguments'() {
    const lib = libc();
    let called = 0;
    const p = lib.registerCallback(() => called++);

    assert(typeof p === 'bigint' && p !== 0n, 'a pointer');
    CFunction({ ptr: p, args: [], returns: 'void' })();
    CFunction({ ptr: p, args: [], returns: 'void' })();
    eq(2, called);
    lib.unregisterCallback(p);
  },

  'getSymbol and getSymbols are bigint addresses, dlsym of a library or a handle'() {
    const lib = libc();
    const abs = lib.getSymbol('abs');

    eq('bigint', typeof abs);
    eq(abs, nffi.dlsym(lib, 'abs'));
    eq('abs', Object.keys(lib.getSymbols()).join());
    assertThrows(() => lib.getSymbol('no_such_symbol_xyz'), Error);
  },

  'errors: a library that does not open, an unknown type, a closed library'() {
    assertThrows(() => new DynamicLibrary('/no/such/library.so'), Error);
    assertThrows(() => libc().getFunction('abs', { arguments: ['nope'], return: 'int32' }), TypeError);

    const lib = libc();

    lib.close();
    assertThrows(() => lib.getFunction('abs', {}), Error);
  },

  'suffix and the default export'() {
    eq('so', nffi.suffix);
    eq(nffi.dlopen, nffi.default.dlopen);
  },
});
