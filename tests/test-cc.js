import * as std from 'std';
import * as os from 'os';
import * as ffi from 'ffi';
import { tests, eq, assert } from './tinytest.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';

function assertThrows(fn) {
  try {
    fn();
  } catch(e) {
    return e;
  }
  throw new Error('expected to throw');
}

const bytesOf = str => Uint8Array.from(str, c => c.charCodeAt(0));

// cc() only exists when the module was built with -DENABLE_TCC=ON.
if(typeof ffi.cc != 'function') {
  console.log('cc() not available (ENABLE_TCC=OFF), skipping');
  await tests({ 'cc skipped'() {} });
} else {
  const { cc } = ffi;

  await tests({
    'cc compiles and calls a function'() {
      const source = bytesOf('int add(int a, int b) { return a + b; }');
      const { symbols } = cc({ source, symbols: { add: { args: ['i32', 'i32'], returns: 'i32' } } });
      eq(5, symbols.add(2, 3));
    },

    'cc accepts bun:ffi C-style type names'() {
      const source = bytesOf('int hello(void) { return 42; }');
      eq(42, cc({ source, symbols: { hello: { args: [], returns: 'int' } } }).symbols.hello());
    },

    'cc returns only { symbols }'() {
      const source = bytesOf('int hello(void) { return 42; }');
      const r = cc({ source, symbols: { hello: { args: [], returns: 'i32' } } });
      eq('symbols', Object.keys(r).join());
      eq(42, r.symbols.hello());
    },

    'cc accepts source text in a view (ArrayBuffer, TypedArray, DataView)'() {
      const symbols = { f: { args: [], returns: 'i32' } };
      const bytes = bytesOf('int f(void) { return 7; }');

      eq(7, cc({ source: bytes, symbols }).symbols.f());
      eq(7, cc({ source: bytes.buffer, symbols }).symbols.f());
      eq(7, cc({ source: new DataView(bytes.buffer), symbols }).symbols.f());
      eq(7, cc({ source: new Uint8Array(bytes.buffer, 0, bytes.length), symbols }).symbols.f());
    },

    'cc honours a TypedArray view offset and length'() {
      const bytes = bytesOf('XXint f(void) { return 8; }YY');
      const source = new Uint8Array(bytes.buffer, 2, bytes.length - 4);
      eq(8, cc({ source, symbols: { f: { args: [], returns: 'i32' } } }).symbols.f());
    },

    'cc can use libc and doubles'() {
      const source = bytesOf(
        '#include <math.h>\n#include <string.h>\ndouble hyp(double a, double b) { return sqrt(a*a + b*b); }\n' +
          'unsigned long len(const char* s) { return strlen(s); }'
      );
      const { symbols } = cc({
        source,
        symbols: { hyp: { args: ['f64', 'f64'], returns: 'f64' }, len: { args: ['cstring'], returns: 'u64' } },
      });
      eq(5, symbols.hyp(3, 4));
      eq(5n, symbols.len('hello'));
    },

    'cc honours define'() {
      const source = bytesOf('int answer(void) { return ANSWER; }');
      eq(42, cc({ source, define: { ANSWER: '42' }, symbols: { answer: { args: [], returns: 'i32' } } }).symbols.answer());
    },

    'cc honours flags (string and array)'() {
      const source = bytesOf('int answer(void) { return ANSWER + OTHER; }');
      const symbols = { answer: { args: [], returns: 'i32' } };
      eq(3, cc({ source, flags: '-DANSWER=1 -DOTHER=2', symbols }).symbols.answer());
      eq(7, cc({ source, flags: ['-DANSWER=3', '-DOTHER=4'], symbols }).symbols.answer());
    },

    'cc honours library'() {
      const source = bytesOf('#include <math.h>\ndouble f(double x) { return pow(x, 2); }');
      eq(9, cc({ source, library: ['m'], symbols: { f: { args: ['f64'], returns: 'f64' } } }).symbols.f(3));
    },

    'cc throws InternalError with the compiler message on a syntax error'() {
      const source = bytesOf('int f( {');
      const e = assertThrows(() => cc({ source, symbols: { f: { args: [], returns: 'i32' } } }));
      assert(e instanceof InternalError && /error/.test(e.message), 'unexpected ' + e);
    },

    'cc throws TypeError for an unknown symbol'() {
      const source = bytesOf('int f(void) { return 1; }');
      const e = assertThrows(() => cc({ source, symbols: { g: { args: [], returns: 'i32' } } }));
      assert(e instanceof TypeError, 'expected TypeError, got ' + e);
    },

    'cc throws TypeError without source or symbols'() {
      assert(assertThrows(() => cc({ symbols: {} })) instanceof TypeError);
      assert(assertThrows(() => cc({ source: 'x.c' })) instanceof TypeError);
      assert(assertThrows(() => cc({ source: 42, symbols: {} })) instanceof TypeError);
      assert(assertThrows(() => cc()) instanceof TypeError);
    },
  });
}
