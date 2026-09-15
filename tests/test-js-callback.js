import { tests, eq, assert, assertStrictEquals, fail } from './tinytest.js';
import { JSCallback, define, call, dlsym, toArrayBuffer, RTLD_DEFAULT } from 'ffi';

function assertThrows(fn, msg) {
  try {
    fn();
  } catch(e) {
    return e;
  }
  throw new Error('expected to throw: ' + (msg || fn));
}

/* Builds an ffi.c-style prototype for cbPtr (a JSCallback's .ptr) and returns
 * a function that invokes it via the legacy call() path. This exercises the
 * real ffi_call() -> ffi_closure trampoline -> JS boundary for arbitrary
 * declared types, entirely from JS, without needing a native test fixture.
 */
let probeCounter = 0;
function defineProbe(cbPtr, rtype, argtypes) {
  const name = 'probe' + probeCounter++;
  assert(define(name, cbPtr, null, rtype, ...argtypes), 'define() failed for ' + name);
  return (...args) => call(name, ...args);
}

await tests({
  'constructor requires a function'() {
    const e = assertThrows(() => new JSCallback(123));
    assert(e instanceof TypeError, 'expected TypeError, got ' + e);
  },

  'constructor works with no options (defaults to no args, void return)'() {
    let called = false;
    const cb = new JSCallback(() => {
      called = true;
    });
    const probe = defineProbe(cb.ptr, 'void', []);
    probe();
    assert(called, 'callback body did not run');
    cb.close();
  },

  'ptr is non-zero while open, and null after close()'() {
    const cb = new JSCallback(() => 0, { returns: 'i32' });
    assert((typeof cb.ptr === 'number' || typeof cb.ptr === 'bigint') && cb.ptr !== 0, 'ptr should be a non-zero address');
    cb.close();
    eq(null, cb.ptr);
  },

  'close() is idempotent'() {
    const cb = new JSCallback(() => 0, { returns: 'i32' });
    cb.close();
    cb.close(); // must not throw
    eq(null, cb.ptr);
  },

  'funcObj returns the exact function passed to the constructor'() {
    const fn = () => 0;
    const cb = new JSCallback(fn, { returns: 'i32' });
    assertStrictEquals(fn, cb.funcObj);
    cb.close();
  },

  'called counts invocations'() {
    const cb = new JSCallback(() => 0, { returns: 'i32' });
    const probe = defineProbe(cb.ptr, 'sint32', []);
    eq(0, cb.called);
    probe();
    eq(1, cb.called);
    probe();
    probe();
    eq(3, cb.called);
    cb.close();
  },

  'toString includes the callback pointer'() {
    const cb = new JSCallback(() => 0, { returns: 'i32' });
    assert(/^#JSCallback \(0x[0-9a-f]+\)\(\*0x[0-9a-f]+\)$/.test(cb.toString()), 'unexpected toString(): ' + cb.toString());
    cb.close();
  },

  'list includes live instances'() {
    const before = JSCallback.list.length;
    const cb = new JSCallback(() => 0, { returns: 'i32' });
    const list = JSCallback.list;
    eq(before + 1, list.length);
    assert(
      list.some(c => c.ptr === cb.ptr),
      'new instance not found in JSCallback.list',
    );
    cb.close();
  },

  'exceptions thrown inside the callback are captured, not propagated'() {
    const cb = new JSCallback(() => {
      throw new Error('boom');
    }, { returns: 'i32' });
    const probe = defineProbe(cb.ptr, 'sint32', []);

    const rc = probe(); // must not throw across the native boundary
    eq(0, rc);
    assert(cb.exception && cb.exception.message === 'boom', 'exception not captured: ' + cb.exception);
    cb.close();
  },

  /* --- Argument marshaling: for each declared arg type, verify the JS
   * function actually receives the real value the native caller passed in
   * (the bug this class replaces always called with zero arguments). --- */

  'marshals signed 8/16/32-bit integer arguments'() {
    let seen;
    const cb8 = new JSCallback(v => { seen = v; }, { args: ['i8'] });
    defineProbe(cb8.ptr, 'void', ['sint8'])(-100);
    eq(-100, seen);
    cb8.close();

    const cb16 = new JSCallback(v => { seen = v; }, { args: ['i16'] });
    defineProbe(cb16.ptr, 'void', ['sint16'])(-30000);
    eq(-30000, seen);
    cb16.close();

    const cb32 = new JSCallback(v => { seen = v; }, { args: ['i32'] });
    defineProbe(cb32.ptr, 'void', ['sint32'])(-2000000000);
    eq(-2000000000, seen);
    cb32.close();
  },

  'marshals unsigned 8/16/32-bit integer arguments'() {
    let seen;
    const cb8 = new JSCallback(v => { seen = v; }, { args: ['u8'] });
    defineProbe(cb8.ptr, 'void', ['uint8'])(200);
    eq(200, seen);
    cb8.close();

    const cb16 = new JSCallback(v => { seen = v; }, { args: ['u16'] });
    defineProbe(cb16.ptr, 'void', ['uint16'])(60000);
    eq(60000, seen);
    cb16.close();

    const cb32 = new JSCallback(v => { seen = v; }, { args: ['u32'] });
    defineProbe(cb32.ptr, 'void', ['uint32'])(3000000000);
    eq(3000000000, seen);
    cb32.close();
  },

  'marshals bool arguments'() {
    let seen;
    const cb = new JSCallback(v => { seen = v; }, { args: ['bool'] });
    const probe = defineProbe(cb.ptr, 'void', ['uint8']);

    probe(1);
    eq(true, seen);
    probe(0);
    eq(false, seen);
    cb.close();
  },

  'marshals 64-bit integer arguments as safe-range values'() {
    let seen;
    const cbI64 = new JSCallback(v => { seen = v; }, { args: ['i64'] });
    defineProbe(cbI64.ptr, 'void', ['sint64'])(5000000000);
    eq(5000000000, Number(seen));
    cbI64.close();

    const cbU64 = new JSCallback(v => { seen = v; }, { args: ['u64'] });
    defineProbe(cbU64.ptr, 'void', ['uint64'])(4000000000);
    eq(4000000000, Number(seen));
    cbU64.close();
  },

  'marshals i64/u64 as BigInt, i64_fast/u64_fast as plain number'() {
    let seen;
    const cbSlow = new JSCallback(v => { seen = v; }, { args: ['i64'] });
    defineProbe(cbSlow.ptr, 'void', ['sint64'])(42);
    eq('bigint', typeof seen);
    cbSlow.close();

    const cbFast = new JSCallback(v => { seen = v; }, { args: ['i64_fast'] });
    defineProbe(cbFast.ptr, 'void', ['sint64'])(42);
    eq('number', typeof seen);
    cbFast.close();
  },

  'marshals float and double arguments'() {
    let seen;
    const cbF32 = new JSCallback(v => { seen = v; }, { args: ['f32'] });
    defineProbe(cbF32.ptr, 'void', ['float'])(2.5);
    eq(2.5, seen);
    cbF32.close();

    const cbF64 = new JSCallback(v => { seen = v; }, { args: ['f64'] });
    defineProbe(cbF64.ptr, 'void', ['double'])(-3.140625);
    eq(-3.140625, seen);
    cbF64.close();
  },

  'marshals pointer arguments as numeric addresses'() {
    let seen;
    const cb = new JSCallback(v => { seen = v; }, { args: ['pointer'] });
    defineProbe(cb.ptr, 'void', ['pointer'])(0x1234);
    eq(0x1234, seen);
    cb.close();
  },

  'marshals cstring arguments as JS strings'() {
    let seen;
    const cb = new JSCallback(v => { seen = v; }, { args: ['cstring'] });
    defineProbe(cb.ptr, 'void', ['char *'])('hello');
    eq('hello', seen);
    cb.close();
  },

  /* --- Return value marshaling: what the native caller reads back. --- */

  'return values are written back for each integer/float/pointer type'() {
    // Each JSCallback must be kept alive (a reachable reference held) for as
    // long as native code might call through .ptr -- the object owns the
    // ffi_closure, and .ptr alone doesn't keep it alive. Losing the
    // reference (e.g. `new JSCallback(...).ptr` as an inline expression)
    // frees the closure out from under the native caller.
    const cases = [
      [() => -5, 'i8', -5, 'sint8'],
      [() => 200, 'u8', 200, 'uint8'],
      [() => -30000, 'i16', -30000, 'sint16'],
      [() => 60000, 'u16', 60000, 'uint16'],
      [() => -2000000000, 'i32', -2000000000, 'sint32'],
      [() => 3000000000, 'u32', 3000000000, 'uint32'],
      [() => 5000000000, 'i64', 5000000000, 'sint64'],
      [() => 2.5, 'f32', 2.5, 'float'],
      [() => -3.140625, 'f64', -3.140625, 'double'],
      [() => 0xabcdef, 'pointer', 0xabcdef, 'pointer'],
    ];

    for(const [fn, returns, expected, outerRtype] of cases) {
      const cb = new JSCallback(fn, { returns });
      eq(expected, defineProbe(cb.ptr, outerRtype, [])());
      cb.close();
    }
  },

  /* --- End-to-end proof against a real native caller (not our own probe
   * harness): libc's qsort() invokes the comparator with real int32*
   * arguments it owns, laid out in a buffer it is actively sorting. --- */

  'a JSCallback used as a real libc qsort() comparator sorts correctly'() {
    const qsort = dlsym(RTLD_DEFAULT, 'qsort');
    assert(qsort != null, 'dlsym(qsort) failed');
    assert(define('qsort', qsort, null, 'void', 'pointer', 'size_t', 'size_t', 'pointer'), 'define(qsort) failed');

    const n = 5;
    const buf = new ArrayBuffer(n * 4);
    const view = new Int32Array(buf);
    view.set([5, 3, 4, 1, 2]);

    // Real comparator: dereference the two int32* addresses libc actually
    // passes in (proves the trampoline marshals real native args, not the
    // always-zero-args call the old CallClosure made).
    const cmp = new JSCallback(
      (pa, pb) => {
        const a = new Int32Array(toArrayBuffer(pa, 4, false))[0];
        const b = new Int32Array(toArrayBuffer(pb, 4, false))[0];
        return a - b;
      },
      { args: ['pointer', 'pointer'], returns: 'i32' },
    );

    call('qsort', buf, n, 4, cmp);

    const after = Array.from(view);
    assert(cmp.called > 0, 'comparator was never invoked');
    eq('1,2,3,4,5', after.join(','));
    cmp.close();
  },
});
