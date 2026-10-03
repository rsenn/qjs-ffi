import { tests, eq, assert } from './tinytest.js';
import * as ffi from 'ffi';

const { dlopen, ptr, CFunction, dlsym, RTLD_DEFAULT } = ffi;

const bytesOf = str => Uint8Array.from(str, c => c.charCodeAt(0));

function assertThrows(fn, type) {
  try {
    fn();
  } catch(e) {
    assert(!type || e instanceof type, 'expected ' + type.name + ', got ' + e);
    return e;
  }
  throw new Error('expected to throw');
}

const { symbols: libc } = dlopen(null, {
  snprintf: { args: ['pointer', 'u64', 'cstring'], returns: 'i32', variadic: true },
  strlen: { args: ['cstring'], returns: 'u64' },
});

function format(fmt, ...rest) {
  const buf = new Uint8Array(128);
  const n = libc.snprintf(buf, 128n, fmt, ...rest);

  return [n, String.fromCharCode(...buf.subarray(0, n))];
}

await tests({
  'a variadic call passes (type, value) pairs after the fixed arguments'() {
    const [n, text] = format('%d %s', 'i32', 42, 'cstring', 'hi');

    eq('42 hi', text);
    eq(5, n);
  },

  'doubles go through the vector registers: %f needs the call to say how many'() {
    eq('2.50 -1.25', format('%.2f %.2f', 'f64', 2.5, 'f64', -1.25)[1]);
    eq('1.5 7', format('%.1f %d', 'f64', 1.5, 'i32', 7)[1]);
  },

  'default promotions: f32 is passed as a double, i8, i16 and bool as an int'() {
    eq('0.5', format('%.1f', 'f32', 0.5)[1]);
    eq('A', format('%c', 'i8', 65)[1]);
    eq('-3 65535 1', format('%d %d %d', 'i16', -3, 'u16', 65535, 'bool', true)[1]);
  },

  '64-bit and unsigned values, a pointer, and FFIType numbers as the type'() {
    eq('-9007199254740993 18446744073709551615', format('%lld %llu', 'i64', -9007199254740993n, 'u64', 2n ** 64n - 1n)[1]);
    eq('4294967295', format('%u', 'u32', 4294967295)[1]);
    eq('7', format('%d', ffi.FFIType.i32, 7)[1]);
    assert(/^0x[0-9a-f]+$/.test(format('%p', 'pointer', ptr(new Uint8Array(1)))[1]), 'a %p result');
  },

  'with no variadic arguments it is a plain call'() {
    eq('plain', format('plain')[1]);
  },

  'the fixed arguments still convert as declared'() {
    const buf = new Uint8Array(16);

    eq(3, libc.snprintf(buf, 16, 'abc'));
    eq('abc', String.fromCharCode(...buf.subarray(0, 3)));
  },

  'errors: an unpaired argument, an unknown type, a struct or void type, too many'() {
    assertThrows(() => libc.snprintf(new Uint8Array(8), 8n, '%d', 'i32'), TypeError);
    assertThrows(() => libc.snprintf(new Uint8Array(8), 8n, '%d', 'nope', 1), TypeError);
    assertThrows(() => libc.snprintf(new Uint8Array(8), 8n, '%d', 'void', 1), TypeError);
    assertThrows(() => libc.snprintf(new Uint8Array(8), 8n, '%d', ['i32', 'i32'], 1), TypeError);
    assertThrows(() => libc.snprintf(new Uint8Array(8), 8n, '%d', 'buffer_length', 1), TypeError);
    assertThrows(() => libc.snprintf(new Uint8Array(8), 8n, 'x', ...Array(40).fill(['i32', 1]).flat()), RangeError);
  },

  'a variadic CFunction made by hand, and length is the fixed count'() {
    const snprintf = CFunction({ ptr: dlsym(RTLD_DEFAULT, 'snprintf'), args: ['pointer', 'u64', 'cstring'], returns: 'i32', variadic: true });
    const buf = new Uint8Array(16);

    eq(2, snprintf(buf, 16, '%d', 'i32', 42));
    eq(3, snprintf.length);
  },

  'a function that is not variadic ignores extra arguments, as before'() {
    const strlen = libc.strlen;

    eq(3n, strlen('abc', 'i32', 1));
  },

  'variadic functions compiled by cc() receive their arguments'() {
    if(typeof ffi.cc != 'function') return;

    const { symbols } = ffi.cc({
      source: bytesOf(`
        #include <stdarg.h>
        double sum(int n, ...) {
          va_list ap;
          double t = 0;
          va_start(ap, n);
          for(int i = 0; i < n; i++) t += va_arg(ap, double);
          va_end(ap);
          return t;
        }
        long count_ints(int n, ...) {
          va_list ap;
          long t = 0;
          va_start(ap, n);
          for(int i = 0; i < n; i++) t += va_arg(ap, int);
          va_end(ap);
          return t;
        }
      `),
      symbols: { sum: { args: ['i32'], returns: 'f64', variadic: true }, count_ints: { args: ['i32'], returns: 'i64_fast', variadic: true } },
    });

    eq(7, symbols.sum(3, 'f64', 1.5, 'f64', 2, 'f32', 3.5));
    eq(60, symbols.count_ints(3, 'i32', 10, 'i32', 20, 'i32', 30));
  },
});
