import { tests, eq, assert, assertStrictEquals, fail } from './tinytest.js';
import { CFunction, JSCallback, dlsym, RTLD_DEFAULT } from 'ffi';

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
});
