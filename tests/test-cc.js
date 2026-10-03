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
  const { cc, read } = ffi;

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

    'cc honours include (string and array)'() {
      const dir = tmp + 'cc-include-' + os.getpid() + '/';
      os.mkdir(dir);
      const f = std.open(dir + 'answer.h', 'w');
      f.puts('#define ANSWER 42\n');
      f.close();
      try {
        const source = bytesOf('#include <answer.h>\nint answer(void) { return ANSWER; }');
        const symbols = { answer: { args: [], returns: 'i32' } };
        eq(42, cc({ source, include: dir, symbols }).symbols.answer());
        eq(42, cc({ source, include: ['/nonexistent', dir], symbols }).symbols.answer());
        assert(assertThrows(() => cc({ source, include: 42, symbols })) instanceof TypeError);
        assert(assertThrows(() => cc({ source, symbols })) instanceof InternalError);
      } finally {
        os.remove(dir + 'answer.h');
        os.remove(dir);
      }
    },

    'cc exposes variables: read, write, live'() {
      const source = bytesOf(`
        int counter = 5;
        unsigned char u8 = 200;
        long long i64 = -5;
        unsigned long long big = 1ULL << 60;
        float f = 1.5f;
        double d = 2.25;
        _Bool flag = 1;
        const char* name = "bob";
        void* p = 0;
        int get(void) { return counter; }
        void set(int v) { counter = v; }
      `);
      const { symbols: s } = cc({
        source,
        symbols: {
          counter: { type: 'i32' },
          u8: { type: 'u8' },
          i64: { type: 'i64' },
          big: { type: 'u64' },
          f: { type: 'f32' },
          d: { type: 'f64' },
          flag: { type: 'bool' },
          name: { type: 'cstring' },
          p: { type: 'pointer' },
          get: { args: [], returns: 'i32' },
          set: { args: ['i32'], returns: 'void' },
        },
      });

      eq(5, s.counter);
      eq(200, s.u8);
      eq(-5n, s.i64);
      eq(1n << 60n, s.big);
      eq(1.5, s.f);
      eq(2.25, s.d);
      eq(true, s.flag);
      eq('bob', s.name);
      eq(null, s.p);

      s.counter = 7;
      eq(7, s.counter);
      eq(7, s.get());
      s.set(9);
      eq(9, s.counter);

      s.u8 = 255;
      eq(255, s.u8);
      s.i64 = -(1n << 40n);
      eq(-(1n << 40n), s.i64);
      s.f = 0.5;
      eq(0.5, s.f);
      s.d = -1e100;
      eq(-1e100, s.d);
      s.flag = false;
      eq(false, s.flag);
      s.p = 4096;
      eq(4096, Number(s.p));

      eq('counter,u8,i64,big,f,d,flag,name,p,get,set', Object.keys(s).join());
      eq(true, Object.getOwnPropertyDescriptor(s, 'counter').enumerable);
      eq('function', typeof Object.getOwnPropertyDescriptor(s, 'counter').get);
    },

    'cc variables: readonly, cstring and void are not assignable'() {
      const source = bytesOf('const double pi = 3.25; const char* name = "bob"; int x;');
      const { symbols: s } = cc({ source, symbols: { pi: { type: 'f64', readonly: true }, name: { type: 'cstring' } } });

      assert(assertThrows(() => (s.pi = 3)) instanceof TypeError);
      eq(3.25, s.pi);
      assert(assertThrows(() => (s.name = 'x')) instanceof TypeError);
      eq('bob', s.name);
      assert(assertThrows(() => cc({ source, symbols: { x: { type: 'void' } } })) instanceof TypeError);
    },

    'cc variables: a struct or array is a view of the C memory'() {
      const source = bytesOf(`
        struct { float x; float y; } origin = { 1, 2 };
        int arr[3] = { 1, 2, 3 };
        float sum(void) { return origin.x + origin.y; }
        int third(void) { return arr[2]; }
      `);
      const { symbols: s } = cc({
        source,
        symbols: {
          origin: { type: ['f32', 'f32'] },
          arr: { type: ['i32', 'i32', 'i32'] },
          sum: { args: [], returns: 'f32' },
          third: { args: [], returns: 'i32' },
        },
      });

      assert(s.origin instanceof ArrayBuffer);
      eq(8, s.origin.byteLength);
      eq('1,2', [...new Float32Array(s.origin)].join());

      new Float32Array(s.origin)[1] = 5; // written through the view, seen by C
      eq(6, s.sum());
      eq('1,5', [...new Float32Array(s.origin)].join());

      eq('1,2,3', [...new Int32Array(s.arr)].join());
      new Int32Array(s.arr)[2] = 30;
      eq(30, s.third());

      assert(assertThrows(() => (s.origin = new ArrayBuffer(8))) instanceof TypeError);
    },

    'an array type { array, length } is a struct of that many elements: a variable view, any size up to 2^20'() {
      const source = bytesOf(`
        char buf[4096] = "hello";
        int grid[3][2] = { { 1, 2 }, { 3, 4 }, { 5, 6 } };
        int total(void) { int t = 0; for(int i = 0; i < 6; i++) t += ((int*)grid)[i]; return t; }
      `);
      const { symbols: s } = cc({
        source,
        symbols: {
          buf: { type: { array: 'i8', length: 4096 } },
          grid: { type: { array: { array: 'i32', length: 2 }, length: 3 } },
          total: { args: [], returns: 'i32' },
        },
      });

      eq(4096, s.buf.byteLength);
      eq('hello', String.fromCharCode(...new Uint8Array(s.buf).subarray(0, 5)));
      eq('1,2,3,4,5,6', [...new Int32Array(s.grid)].join());
      new Int32Array(s.grid)[5] = 60;
      eq(75, s.total());
    },

    'an array type is also an argument, passed by value, and a return'() {
      const source = bytesOf(`
        struct S { int a[3]; };
        int sum(struct S s) { return s.a[0] + s.a[1] + s.a[2]; }
        struct S make(int x) { struct S s = { { x, x + 1, x + 2 } }; return s; }
      `);
      const three = { array: 'i32', length: 3 };
      const { symbols: s } = cc({ source, symbols: { sum: { args: [three], returns: 'i32' }, make: { args: ['i32'], returns: three } } });

      eq(6, s.sum(new Int32Array([1, 2, 3]).buffer));
      eq('5,6,7', [...new Int32Array(s.make(5))].join());
    },

    'an array type with no length, a length out of range, or a bad element throws'() {
      const source = bytesOf('int x;');
      const bad = type => assertThrows(() => cc({ source, symbols: { x: { type } } }));

      assert(bad({ array: 'i32' }) instanceof RangeError);
      assert(bad({ array: 'i32', length: 0 }) instanceof RangeError);
      assert(bad({ array: 'i32', length: 2 ** 20 + 1 }) instanceof RangeError);
      assert(bad({ array: 'void', length: 2 }) instanceof TypeError);
      assert(bad({ array: 'nope', length: 2 }) instanceof TypeError);
      eq(2 ** 20 * 4, cc({ source: bytesOf('int big[1 << 20];'), symbols: { big: { type: { array: 'i32', length: 2 ** 20 } } } }).symbols.big.byteLength);
    },

    'cc variables: address: true is the address, as dlsym()'() {
      const source = bytesOf('int counter = 5;');
      const { symbols: s } = cc({ source, symbols: { counter: { type: 'i32', address: true } } });

      eq(5, read.i32(s.counter, 0));
      assert(assertThrows(() => (s.counter = 1)) instanceof TypeError);
    },

    'cc throws for a variable that is not there, and for type mixed with args'() {
      const source = bytesOf('int x;');
      assert(assertThrows(() => cc({ source, symbols: { y: { type: 'i32' } } })) instanceof TypeError);
      assert(assertThrows(() => cc({ source, symbols: { x: { type: 'i32', args: [] } } })) instanceof TypeError);
      assert(assertThrows(() => cc({ source, symbols: { x: { type: 'i32', returns: 'i32' } } })) instanceof TypeError);
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
