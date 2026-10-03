import { tests, eq, assert, assertStrictEquals, fail } from './tinytest.js';
import { CFunction, JSCallback, FFIType, dlopen, dlsym, ptr, RTLD_DEFAULT } from 'ffi';

function assertThrows(fn, msg) {
  try {
    fn();
  } catch(e) {
    return e;
  }
  throw new Error('expected to throw: ' + (msg || fn));
}

function libc(name) {
  const p = dlsym(RTLD_DEFAULT, name);
  assert(p != null, 'dlsym(' + name + ') failed');
  return p;
}

await tests({
  'new CFunction(...) is the same as CFunction(...)'() {
    const abs = new CFunction({ ptr: libc('abs'), args: ['i32'], returns: 'i32' });

    eq('function', typeof abs);
    eq(4, abs(-4));
    eq(1, abs.length);
  },

  'a JSCallback is passed as its function pointer'() {
    const cb = new JSCallback(() => 7, { returns: 'i32' });
    const id = CFunction({ ptr: libc('labs'), args: ['pointer'], returns: 'u64_fast' });
    const call = CFunction({ ptr: cb.ptr, returns: 'i32' });

    eq(Number(cb.ptr), id(cb));
    eq(Number(cb.ptr), id(cb.ptr));
    eq(7, call());
    cb.close();
  },

  'a JSCallback as a "function" or "T *" argument too, a closed one throws TypeError'() {
    const cb = new JSCallback(() => 0, { returns: 'i32' });

    for(const type of ['function', 'ptr', 'void *']) {
      const id = CFunction({ ptr: libc('labs'), args: [type], returns: 'u64_fast' });
      eq(Number(cb.ptr), id(cb));
    }

    cb.close();
    assert(assertThrows(() => CFunction({ ptr: libc('labs'), args: ['function'], returns: 'u64_fast' })(cb)) instanceof TypeError);
  },

  'a callback sorts with qsort when passed itself, not its .ptr'() {
    const qsort = CFunction({ ptr: libc('qsort'), args: ['pointer', 'u64', 'u64', 'pointer'], returns: 'void' });
    const cmp = new JSCallback((a, b) => 0, { args: ['pointer', 'pointer'], returns: 'i32' });
    const numbers = new Int32Array([3, 1, 2]);

    qsort(numbers, numbers.length, 4n, cmp);
    eq(true, cmp.called > 0);
    cmp.close();
  },

  'buffer_length is the byte length of the view passed for it'() {
    const memchr = CFunction({ ptr: libc('memchr'), args: ['buffer', 'i32', 'buffer_length'], returns: 'pointer' });
    const buf = Uint8Array.from('abcdef', c => c.charCodeAt(0));
    const sub = buf.subarray(2, 4);

    eq(3, memchr.length);
    eq(3, memchr(buf, 100, buf) - ptr(buf));
    eq(0, memchr(sub, 99, sub) - ptr(sub));
    eq(null, memchr(sub, 101, sub));
    eq(null, memchr(buf, 100, buf.subarray(0, 2)));
    eq(3, memchr(buf, 100, new DataView(buf.buffer)) - ptr(buf));
  },

  'buffer_length by number, by alias and as buffer_bytelength'() {
    for(const type of [FFIType.buffer_length, 21, 'buffer_bytelength']) {
      const memchr = CFunction({ ptr: libc('memchr'), args: ['buffer', 'i32', type], returns: 'pointer' });
      const buf = Uint8Array.from('abc', c => c.charCodeAt(0));

      eq(1, memchr(buf, 98, buf) - ptr(buf));
    }
  },

  'buffer_length needs a view; a number or nothing is a TypeError'() {
    const memchr = CFunction({ ptr: libc('memchr'), args: ['buffer', 'i32', 'buffer_length'], returns: 'pointer' });
    const buf = new Uint8Array(4);

    assert(assertThrows(() => memchr(buf, 0, 4)) instanceof TypeError);
    assert(assertThrows(() => memchr(buf, 0)) instanceof TypeError);
    assert(assertThrows(() => memchr(buf, 0, 'abcd')) instanceof TypeError);
  },

  'buffer_length is argument-only: not a return, not in a struct, not in a JSCallback'() {
    assert(assertThrows(() => CFunction({ ptr: libc('strlen'), args: ['buffer'], returns: 'buffer_length' })) instanceof TypeError);
    assert(assertThrows(() => CFunction({ ptr: libc('abs'), args: [['i32', 'buffer_length']], returns: 'void' })) instanceof TypeError);
    assert(assertThrows(() => new JSCallback(() => 0, { args: ['buffer_length'] })) instanceof TypeError);
  },

  'a DataView is passed as a buffer (it was NULL once) and gives ptr()'() {
    const strlen = CFunction({ ptr: libc('strlen'), args: ['buffer'], returns: 'u64' });
    const bytes = Uint8Array.from('hi\0', c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);

    eq(2n, strlen(view));
    eq(ptr(bytes), ptr(view));
    eq(ptr(bytes) + 1, ptr(new DataView(bytes.buffer, 1)));
  },


  'throws when options is not an object'() {
    const e = assertThrows(() => CFunction(123));
    assert(e instanceof TypeError, 'expected TypeError, got ' + e);
  },

  'throws when ptr is missing or invalid'() {
    const e1 = assertThrows(() => CFunction({ args: [], returns: 'i32' }));
    assert(e1 instanceof TypeError, 'expected TypeError, got ' + e1);

    const e2 = assertThrows(() => CFunction({ ptr: 0, args: [], returns: 'i32' }));
    assert(e2 instanceof TypeError, 'expected TypeError, got ' + e2);
  },

  'returns a plain callable JS function, not a named-registry lookup'() {
    const fn = CFunction({ ptr: libc('getpid'), args: [], returns: 'i32' });
    eq('function', typeof fn);
    assert(fn.length === 0 || typeof fn.length === 'number', 'should look like a normal function');
  },

  'length is the declared argument count, a struct counting as one argument'() {
    const f = (args, returns = 'void') => CFunction({ ptr: libc('abs'), args, returns });

    eq(0, f([]).length);
    eq(1, f(['i32'], 'i32').length);
    eq(3, f(['cstring', 'cstring', 'u64'], 'i32').length);
    eq(2, f([['i32', 'i32'], 'f64'], 'i32').length);

    const d = Object.getOwnPropertyDescriptor(f(['i32']), 'length');

    assert(d && d.writable === false && d.enumerable === false && d.configurable === true, 'length is a function-style property: ' + JSON.stringify(d));
  },

  /* --- Real libc functions: CFunction's actual purpose (wrap an
   * already-resolved pointer with no dlopen()/symbol map involved). --- */

  'wraps a 0-arg libc function (getpid) and returns a stable value'() {
    const getpid = CFunction({ ptr: libc('getpid'), args: [], returns: 'i32' });
    const a = getpid();
    const b = getpid();
    assert(a > 0, 'pid should be positive, got ' + a);
    eq(a, b);
  },

  'wraps abs() (i32 -> i32)'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['i32'], returns: 'i32' });
    eq(5, abs(-5));
    eq(0, abs(0));
    eq(2000000000, abs(-2000000000));
  },

  'wraps toupper() (i32 -> i32) from ctype.h'() {
    const toupper = CFunction({ ptr: libc('toupper'), args: ['i32'], returns: 'i32' });
    eq('A'.charCodeAt(0), toupper('a'.charCodeAt(0)));
    eq('Z'.charCodeAt(0), toupper('z'.charCodeAt(0)));
  },

  'wraps sqrt() (f64 -> f64) from libm'() {
    const sqrt = CFunction({ ptr: libc('sqrt'), args: ['f64'], returns: 'f64' });
    eq(4, sqrt(16));
    eq(1.5, sqrt(2.25));
  },

  'wraps strlen() (cstring -> u64)'() {
    const strlen = CFunction({ ptr: libc('strlen'), args: ['cstring'], returns: 'u64' });
    eq(5, Number(strlen('hello')));
    eq(0, Number(strlen('')));
  },

  'wraps strcmp() (cstring, cstring -> i32)'() {
    const strcmp = CFunction({ ptr: libc('strcmp'), args: ['cstring', 'cstring'], returns: 'i32' });
    eq(0, strcmp('abc', 'abc'));
    assert(strcmp('abc', 'abd') < 0, 'expected "abc" < "abd"');
    assert(strcmp('abd', 'abc') > 0, 'expected "abd" > "abc"');
  },

  'wraps strdup() (cstring -> cstring) and round-trips the string'() {
    const strdup = CFunction({ ptr: libc('strdup'), args: ['cstring'], returns: 'cstring' });
    eq('hello, world', strdup('hello, world'));
  },

  'two CFunctions for different symbols work independently (no shared registry)'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['i32'], returns: 'i32' });
    const toupper = CFunction({ ptr: libc('toupper'), args: ['i32'], returns: 'i32' });

    // Interleave calls to prove neither wrapper depends on a name lookup that
    // could resolve to the other's binding.
    eq(5, abs(-5));
    eq('A'.charCodeAt(0), toupper('a'.charCodeAt(0)));
    eq(3, abs(-3));
    eq('B'.charCodeAt(0), toupper('b'.charCodeAt(0)));
  },

  /* --- Per-type argument/return marshaling, using a JSCallback as the
   * native target: CFunction supplies the real native call, JSCallback's
   * own trampoline supplies the real native callee, so this round-trips
   * through both this file's and js-callback.c's independent marshaling
   * code without needing an exotic libc function per type. ---
   *
   * Each JSCallback must be kept in a `const` for as long as the CFunction
   * wrapping its .ptr might still be called -- .ptr alone doesn't keep the
   * underlying ffi_closure alive (see tests/test-js-callback.js).
   */

  'marshals signed/unsigned 8/16/32-bit arguments through to a JSCallback'() {
    let seen;
    const cbI8 = new JSCallback(v => { seen = v; }, { args: ['i8'] });
    CFunction({ ptr: cbI8.ptr, args: ['i8'], returns: 'void' })(-100);
    eq(-100, seen);
    cbI8.close();

    const cbU8 = new JSCallback(v => { seen = v; }, { args: ['u8'] });
    CFunction({ ptr: cbU8.ptr, args: ['u8'], returns: 'void' })(200);
    eq(200, seen);
    cbU8.close();

    const cbI32 = new JSCallback(v => { seen = v; }, { args: ['i32'] });
    CFunction({ ptr: cbI32.ptr, args: ['i32'], returns: 'void' })(-2000000000);
    eq(-2000000000, seen);
    cbI32.close();

    const cbU32 = new JSCallback(v => { seen = v; }, { args: ['u32'] });
    CFunction({ ptr: cbU32.ptr, args: ['u32'], returns: 'void' })(3000000000);
    eq(3000000000, seen);
    cbU32.close();
  },

  'marshals 64-bit arguments (BigInt) through to a JSCallback'() {
    let seen;
    const cbI64 = new JSCallback(v => { seen = v; }, { args: ['i64'] });
    CFunction({ ptr: cbI64.ptr, args: ['i64'], returns: 'void' })(5000000000n);
    eq('bigint', typeof seen);
    eq(5000000000, Number(seen));
    cbI64.close();

    const cbU64 = new JSCallback(v => { seen = v; }, { args: ['u64'] });
    CFunction({ ptr: cbU64.ptr, args: ['u64'], returns: 'void' })(4000000000n);
    eq(4000000000, Number(seen));
    cbU64.close();
  },

  'marshals float/double arguments through to a JSCallback'() {
    let seen;
    const cbF32 = new JSCallback(v => { seen = v; }, { args: ['f32'] });
    CFunction({ ptr: cbF32.ptr, args: ['f32'], returns: 'void' })(2.5);
    eq(2.5, seen);
    cbF32.close();

    const cbF64 = new JSCallback(v => { seen = v; }, { args: ['f64'] });
    CFunction({ ptr: cbF64.ptr, args: ['f64'], returns: 'void' })(-3.140625);
    eq(-3.140625, seen);
    cbF64.close();
  },

  'marshals pointer and cstring arguments through to a JSCallback'() {
    let seen;
    const cbPtr = new JSCallback(v => { seen = v; }, { args: ['pointer'] });
    CFunction({ ptr: cbPtr.ptr, args: ['pointer'], returns: 'void' })(0x1234);
    eq(0x1234, seen);
    cbPtr.close();

    const cbStr = new JSCallback(v => { seen = v; }, { args: ['cstring'] });
    CFunction({ ptr: cbStr.ptr, args: ['cstring'], returns: 'void' })('hello');
    eq('hello', seen);
    cbStr.close();
  },

  'return values round-trip through a JSCallback for each type'() {
    const cases = [
      [() => -5, 'i8', -5],
      [() => 200, 'u8', 200],
      [() => -30000, 'i16', -30000],
      [() => 60000, 'u16', 60000],
      [() => -2000000000, 'i32', -2000000000],
      [() => 3000000000, 'u32', 3000000000],
      [() => 2.5, 'f32', 2.5],
      [() => -3.140625, 'f64', -3.140625],
      [() => 0xabcdef, 'pointer', 0xabcdef],
    ];

    for(const [body, type, expected] of cases) {
      const cb = new JSCallback(body, { returns: type });
      const fn = CFunction({ ptr: cb.ptr, args: [], returns: type });
      eq(expected, fn());
      cb.close();
    }
  },

  'i64/u64 returns come back as BigInt'() {
    const cb = new JSCallback(() => 5000000000n, { returns: 'i64' });
    const fn = CFunction({ ptr: cb.ptr, args: [], returns: 'i64' });
    const rc = fn();
    eq('bigint', typeof rc);
    eq(5000000000, Number(rc));
    cb.close();
  },

  'bool arguments and return values'() {
    let seen;
    const cbArg = new JSCallback(v => { seen = v; }, { args: ['bool'] });
    CFunction({ ptr: cbArg.ptr, args: ['bool'], returns: 'void' })(true);
    eq(true, seen);
    CFunction({ ptr: cbArg.ptr, args: ['bool'], returns: 'void' })(false);
    eq(false, seen);
    cbArg.close();

    const cbRet = new JSCallback(() => true, { returns: 'bool' });
    const fn = CFunction({ ptr: cbRet.ptr, args: [], returns: 'bool' });
    eq(true, fn());
    cbRet.close();
  },

  'close() frees the function: a later call is a TypeError, close() is idempotent'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['i32'], returns: 'i32' });

    eq(4, abs(-4));
    eq(undefined, abs.close());
    assert(assertThrows(() => abs(-4)) instanceof TypeError);
    eq(undefined, abs.close());
    eq('function', typeof abs);
    eq(1, abs.length);
  },

  'a CFunction still has Function.prototype, and close() rejects other objects'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['i32'], returns: 'i32' });

    assert(abs instanceof Function);
    eq(4, abs.call(null, -4));
    eq(4, abs.bind(null)(-4));
    assert(assertThrows(() => abs.close.call({})) instanceof TypeError);
    abs.close();
  },

  'close() is also on the functions of dlopen()'() {
    const lib = dlopen(null, { abs: { args: ['i32'], returns: 'i32' } });

    eq(4, lib.symbols.abs(-4));
    lib.symbols.abs.close();
    assert(assertThrows(() => lib.symbols.abs(-4)) instanceof TypeError);
    lib.close();
  },

  'a bigint converts for any integer kind, as a number does, and leaves nothing pending'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['i32'], returns: 'i32' });
    const toupper = CFunction({ ptr: libc('toupper'), args: ['u8'], returns: 'i32' });
    const labs = CFunction({ ptr: libc('labs'), args: ['i64'], returns: 'i64' });

    eq(2, abs(2n));
    eq(-2147483648, abs(2 ** 31));
    eq(65, toupper(97n));
    eq(5n, labs(-5n));
    eq(5n, labs(-5));
    eq(3, abs(-3)); // an exception left pending would surface here
  },

  'null, undefined, booleans and objects convert as numbers do'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['i32'], returns: 'i32' });

    eq(0, abs(null));
    eq(0, abs(undefined));
    eq(1, abs(true));
    eq(1, abs(-1.9));
    eq(0, abs({}));
  },

  'a string or a Symbol for a number is a TypeError that names the argument and the type'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['i32'], returns: 'i32' });
    const sqrt = CFunction({ ptr: libc('sqrt'), args: ['f64'], returns: 'f64' });
    const e = assertThrows(() => abs('7'));

    assert(e instanceof TypeError && /argument 1 to 'i32'/.test(e.message), String(e));
    assert(assertThrows(() => abs(Symbol('x'))) instanceof TypeError);
    assert(/'f64'/.test(assertThrows(() => sqrt('4')).message));
    eq(4, abs(-4)); // the function still works, nothing is pending
  },

  'a valueOf that throws is the exception of the call'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['i32'], returns: 'i32' });
    const e = assertThrows(() => abs({ valueOf() { throw new RangeError('boom'); } }));

    assert(e instanceof RangeError && e.message === 'boom', String(e));
  },

  'args must be an array, and at most 32 arguments: a TypeError'() {
    assert(assertThrows(() => CFunction({ ptr: libc('abs'), args: 'i32', returns: 'i32' })) instanceof TypeError);
    assert(assertThrows(() => CFunction({ ptr: libc('abs'), args: { length: 1, 0: 'i32' }, returns: 'i32' })) instanceof TypeError);
    assert(assertThrows(() => CFunction({ ptr: libc('abs'), args: Array(33).fill('i32'), returns: 'i32' })) instanceof TypeError);
    eq(32, CFunction({ ptr: libc('abs'), args: Array(32).fill('i32'), returns: 'i32' }).length);
    eq(0, CFunction({ ptr: libc('abs'), returns: 'i32' }).length);
  },
});
