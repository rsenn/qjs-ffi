import { tests, eq, assert } from './tinytest.js';
import { linkSymbols, dlsym, RTLD_DEFAULT, suffix } from 'ffi';

function assertThrows(fn) {
  try {
    fn();
  } catch(e) {
    return e;
  }
  throw new Error('expected to throw');
}

await tests({
  'suffix is the platform library extension'() {
    assert(suffix === 'so' || suffix === 'dll', 'unexpected suffix ' + suffix);
  },

  'linkSymbols resolves libc symbols via RTLD_DEFAULT'() {
    const { symbols } = linkSymbols({
      abs: { args: ['i32'], returns: 'i32' },
      strlen: { args: ['cstring'], returns: 'u64' },
    });

    eq(5, symbols.abs(-5));
    eq(5n, symbols.strlen('hello'));
  },

  'linkSymbols honours a spec-supplied ptr'() {
    const { symbols } = linkSymbols({ myabs: { ptr: dlsym(RTLD_DEFAULT, 'abs'), args: ['i32'], returns: 'i32' } });
    eq(7, symbols.myabs(-7));
  },

  'linkSymbols throws TypeError for an unknown symbol'() {
    const e = assertThrows(() => linkSymbols({ thisSymbolDoesNotExist12345: { args: [], returns: 'void' } }));
    assert(e instanceof TypeError, 'expected TypeError, got ' + e);
  },

  'linkSymbols throws TypeError for a NULL ptr'() {
    const e = assertThrows(() => linkSymbols({ abs: { ptr: 0, args: ['i32'], returns: 'i32' } }));
    assert(e instanceof TypeError, 'expected TypeError, got ' + e);
  },

  'linkSymbols throws TypeError for a non-object argument'() {
    const e = assertThrows(() => linkSymbols(1));
    assert(e instanceof TypeError, 'expected TypeError, got ' + e);
  },
});
