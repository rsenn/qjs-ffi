import { tests, eq, assert } from './tinytest.js';
import { dlopen, dlsym, linkSymbols, read, RTLD_DEFAULT } from 'ffi';

function assertThrows(fn, msg) {
  try {
    fn();
  } catch(e) {
    return e;
  }
  throw new Error('expected to throw: ' + (msg || fn));
}

await tests({
  'legacy dlopen(path, flags) still works'() {
    const h = dlopen(null, 2);
    assert(h !== null, 'legacy dlopen should return a handle');
    assert(typeof h === 'number' || typeof h === 'bigint', 'handle should be a number or bigint address');
  },

  'dlopen(path, symbolSpecs) returns { symbols, close }'() {
    const lib = dlopen(null, { getpid: { args: [], returns: 'i32' } });
    eq('object', typeof lib);
    eq('object', typeof lib.symbols);
    eq('function', typeof lib.close);
    eq('function', typeof lib.symbols.getpid);
    lib.close();
  },

  'wrapped symbols are directly callable, no name lookup'() {
    const lib = dlopen(null, {
      abs: { args: ['i32'], returns: 'i32' },
      strlen: { args: ['cstring'], returns: 'u64' },
    });

    eq(5, lib.symbols.abs(-5));
    eq(5n, lib.symbols.strlen('hello'));
    lib.close();
  },

  'cstring args/returns round-trip through dlopen-built CFunction'() {
    const lib = dlopen(null, { strdup: { args: ['cstring'], returns: 'cstring' } });
    eq('hi there', lib.symbols.strdup('hi there'));
    lib.close();
  },

  'throws when a symbol is not found'() {
    const e = assertThrows(() => dlopen(null, { thisSymbolDoesNotExist12345: { args: [], returns: 'void' } }));
    assert(e instanceof TypeError, 'expected TypeError, got ' + e);
  },

  'throws when the library path does not exist'() {
    const e = assertThrows(() => dlopen('/no/such/library.so', { foo: { args: [], returns: 'void' } }));
    assert(e instanceof TypeError, 'expected TypeError, got ' + e);
  },

  'close() called twice is a no-op'() {
    const lib = dlopen(null, { getpid: { args: [], returns: 'i32' } });
    eq(0, lib.close());
    eq(0, lib.close());
  },

  'close() actually dlcloses -- a second dlopen(same path) still works after close'() {
    const lib1 = dlopen(null, { getpid: { args: [], returns: 'i32' } });
    lib1.close();

    const lib2 = dlopen(null, { getpid: { args: [], returns: 'i32' } });
    assert(lib2.symbols.getpid() > 0, 'pid should be positive');
    lib2.close();
  },

  'dlopen exposes a variable of the library (optind), live'() {
    const lib = dlopen(null, { optind: { type: 'i32' }, abs: { args: ['i32'], returns: 'i32' } });
    const was = lib.symbols.optind;

    eq(1, was);
    lib.symbols.optind = 3;
    eq(3, lib.symbols.optind);
    lib.symbols.optind = was;
    eq(5, lib.symbols.abs(-5));
    lib.close();
  },

  'linkSymbols exposes a variable too, with address: true as a pointer'() {
    const { symbols } = linkSymbols({ optind: { type: 'i32' }, optind_at: { type: 'i32', address: true, ptr: dlsym(RTLD_DEFAULT, 'optind') } });

    eq(symbols.optind, read.i32(symbols.optind_at, 0));
  },

  'dlopen: a variable spec with args throws, and an unknown variable is a TypeError'() {
    assertThrows(() => dlopen(null, { optind: { type: 'i32', args: [] } }));
    assert(assertThrows(() => dlopen(null, { no_such_variable_xyz: { type: 'i32' } })) instanceof TypeError);
  },
});
