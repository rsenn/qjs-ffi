import { tests, eq, assert } from './tinytest.js';
import { dlopen, linkSymbols, cc } from 'ffi';

function throws(fn, type) {
  try {
    fn();
  } catch(e) {
    assert(!type || e instanceof type, 'expected ' + type.name + ', got ' + e);
    return e;
  }
  throw new Error('expected to throw');
}

await tests({
  'a value is a plain read-only data property, no library needed'() {
    const { symbols } = dlopen(null, {
      FOO_MAX: { value: 4096 },
      FOO_NAME: { value: 'foo' },
      FOO_ON: { value: true },
      abs: { args: ['i32'], returns: 'i32' },
    });

    eq(4096, symbols.FOO_MAX);
    eq('foo', symbols.FOO_NAME);
    eq(true, symbols.FOO_ON);
    eq(5, symbols.abs(-5));
    eq(true, Object.keys(symbols).includes('FOO_MAX'));

    const d = Object.getOwnPropertyDescriptor(symbols, 'FOO_MAX');

    assert(!d.writable && !d.configurable && d.enumerable && !d.get);
  },

  'type checks the value: range, and 64-bit gives a bigint'() {
    const { symbols: s } = dlopen(null, {
      A: { value: 255, type: 'u8' },
      B: { value: 0xffffffffffffffffn, type: 'u64' },
      C: { value: -5, type: 'i64' },
      D: { value: 0.1, type: 'f32' },
      E: { value: 1, type: 'bool' },
    });

    eq(255, s.A);
    eq(0xffffffffffffffffn, s.B);
    eq(-5n, s.C);
    eq(Math.fround(0.1), s.D);
    eq(true, s.E);

    throws(() => dlopen(null, { X: { value: 300, type: 'u8' } }), RangeError);
    throws(() => dlopen(null, { X: { value: -1, type: 'u32' } }), RangeError);
    throws(() => dlopen(null, { X: { value: 1.5, type: 'i32' } }), RangeError);
    throws(() => dlopen(null, { X: { value: 2n ** 64n, type: 'u64' } }), RangeError);
    throws(() => dlopen(null, { X: { value: 1, type: 'cstring' } }), TypeError);
    throws(() => dlopen(null, { X: { value: 1, type: 'nope' } }), TypeError);
  },

  'value mixed with a function or variable key is a TypeError'() {
    throws(() => dlopen(null, { X: { value: 1, args: [] } }), TypeError);
    throws(() => dlopen(null, { X: { value: 1, address: true } }), TypeError);
    throws(() => dlopen(null, { X: { value: 1, enum: { A: 1 } } }), TypeError);
    throws(() => dlopen(null, { X: { value: {} } }), TypeError);
  },

  'linkSymbols and cc take constants too'() {
    eq(7, linkSymbols({ K: { value: 7 } }).symbols.K);

    const { symbols } = cc({
      source: new Uint8Array([...'int f(void){return 1;}'].map(c => c.charCodeAt(0)).concat(0)),
      symbols: { f: { returns: 'i32' }, N: { value: 3 } },
    });

    eq(1, symbols.f());
    eq(3, symbols.N);
  },

  'an enum maps name to value, and value back to the first name'() {
    const { symbols } = dlopen(null, {
      Color: { enum: { RED: 0, GREEN: 1, BLUE: 4, BLEU: 4 }, type: 'u32' },
      Big: { enum: { A: 1n, B: 0x8000000000000000n }, type: 'u64' },
      Dflt: { enum: { NEG: -1 } },
    });
    const { Color } = symbols;

    eq('RED,GREEN,BLUE,BLEU', Object.keys(Color).join());
    eq(4, Color.BLUE);
    eq(4, Color.BLEU);
    eq('BLUE', Color[4]);
    eq('GREEN', Color[1]);
    eq(0x8000000000000000n, symbols.Big.B);
    eq('B', symbols.Big[0x8000000000000000n]);
    eq(-1, symbols.Dflt.NEG);
    eq('NEG', symbols.Dflt[-1]);
    assert(Object.isFrozen(Color) || !Object.isExtensible(Color));
  },

  'enum values are range checked, flags must be disjoint'() {
    throws(() => dlopen(null, { E: { enum: { A: 256 }, type: 'u8' } }), RangeError);
    throws(() => dlopen(null, { E: { enum: { A: 'x' } } }), TypeError);
    throws(() => dlopen(null, { E: { enum: 5 } }), TypeError);

    const { symbols } = dlopen(null, { F: { enum: { A: 1, B: 2, C: 4, NONE: 0 }, type: 'u8', flags: true } });

    eq(2, symbols.F.B);
    throws(() => dlopen(null, { F: { enum: { A: 3, B: 2 }, type: 'u8', flags: true } }), RangeError);
    dlopen(null, { F: { enum: { A: 3, B: 2 }, type: 'u8' } });
  },
});
