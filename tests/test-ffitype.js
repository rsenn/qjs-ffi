import * as std from 'std';
import { tests, eq, assert } from './tinytest.js';
import * as ffi from 'ffi';
import { FFIType, CFunction, JSCallback, dlopen, linkSymbols, dlsym, RTLD_DEFAULT } from 'ffi';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';

function sh(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();
  p.close();
  return out;
}

function assertThrows(fn) {
  try {
    fn();
  } catch(e) {
    return e;
  }
  throw new Error('expected to throw');
}

function libc(name) {
  const p = dlsym(RTLD_DEFAULT, name);
  assert(p != null, 'dlsym(' + name + ') failed');
  return p;
}

/* bun:ffi's FFIType: every member is a number. */
const IDS = {
  char: 0, i8: 1, int8_t: 1, u8: 2, uint8_t: 2, i16: 3, int16_t: 3, u16: 4, uint16_t: 4,
  i32: 5, int32_t: 5, int: 5, c_int: 5, u32: 6, uint32_t: 6, c_uint: 6,
  i64: 7, int64_t: 7, isize: 7, u64: 8, uint64_t: 8, usize: 8,
  f64: 9, double: 9, f32: 10, float: 10, bool: 11,
  ptr: 12, pointer: 12, 'void*': 12, 'char*': 12, void: 13, cstring: 14,
  i64_fast: 15, u64_fast: 16, function: 17, callback: 17, fn: 17,
  napi_env: 18, napi_value: 19, buffer: 20, buffer_length: 21, buffer_bytelength: 21,
};

await tests({
  'FFIType maps each name to bun:ffi\'s number'() {
    for(const [name, id] of Object.entries(IDS))
      eq(id, FFIType[name]);
  },

  'FFIType maps the numbers 0 to 17 to themselves'() {
    for(let i = 0; i <= 17; i++)
      eq(i, FFIType[i]);
  },

  'a signature takes the numbers as well as the names'() {
    const abs = CFunction({ ptr: libc('abs'), args: [5], returns: 5 });
    const strlen = CFunction({ ptr: libc('strlen'), args: [FFIType.cstring], returns: FFIType.u64 });
    const labs = CFunction({ ptr: libc('labs'), args: [FFIType.i64], returns: 7 });
    const sqrt = CFunction({ ptr: libc('sqrt'), args: [9], returns: FFIType.f64 });

    eq(5, abs(-5));
    eq(5n, strlen('hello'));
    eq(9n, labs(-9n));
    eq(3, sqrt(9));
  },

  'a JSCallback takes the numbers as well'() {
    const cb = new JSCallback((a, b) => a + b, { args: [FFIType.i32, 5], returns: FFIType.i32 });
    const call = CFunction({ ptr: cb.ptr, args: [5, 5], returns: 5 });

    eq(7, call(3, 4));
    cb.close();
  },

  'dlopen() and linkSymbols() take the numbers too'() {
    const { symbols } = dlopen(null, { abs: { args: [FFIType.i32], returns: 5 }, fabs: { args: [9], returns: FFIType.f64 } });
    const linked = linkSymbols({ labs: { args: [7], returns: FFIType.i64 } });

    eq(3, symbols.abs(-3));
    eq(2.5, symbols.fabs(-2.5));
    eq(8n, linked.symbols.labs(-8));
  },

  'cc() takes the numbers too'() {
    if(typeof ffi.cc != 'function') return; // built without ENABLE_TCC

    const source = Uint8Array.from('int twice(int v) { return 2 * v; }', c => c.charCodeAt(0));
    const { symbols } = ffi.cc({ source, symbols: { twice: { args: [FFIType.i32], returns: FFIType.i32 } } });

    eq(14, symbols.twice(7));
  },

  'a number that is no usable type is an unknown type: a TypeError, as in bun'() {
    for(const unknown of [FFIType.napi_env, FFIType.napi_value, 99, -1]) {
      const inArgs = assertThrows(() => CFunction({ ptr: libc('abs'), args: [unknown], returns: FFIType.i32 }));
      const inReturns = assertThrows(() => CFunction({ ptr: libc('abs'), args: [FFIType.i32], returns: unknown }));

      assert(inArgs instanceof TypeError && /unknown type: /.test(inArgs.message), String(inArgs));
      assert(inReturns instanceof TypeError && /unknown return type: /.test(inReturns.message), String(inReturns));
    }
  },

  'gen-bindings --ffitype writes FFIType members that bind and call'() {
    sh('mkdir -p ' + tmp);

    const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--ffitype', '-o', tmp + 'test-ffitype.gen.js', root + 'tests/cxx/libc-subset.h'].join(' '));

    assert(std.loadFile(tmp + 'test-ffitype.gen.js') !== null, 'no module written, output was:\n' + out);
    assert(/FFIType\.i32/.test(std.loadFile(tmp + 'test-ffitype.gen.js')), 'the module does not use FFIType');

    return import('../.tmp/test-ffitype.gen.js').then(m => {
      eq(5, m.abs(-5));
      eq(1.5, m.fabs(-1.5));
      eq(5n, m.strlen('hello'));
      eq(9n, m.labs(-9));
    });
  },

  'i64_fast is a Number while |v| <= 2^53 - 1, an exact BigInt beyond, as in bun'() {
    const strtol = CFunction({ ptr: libc('strtol'), args: ['cstring', 'pointer', 'i32'], returns: 'i64_fast' });
    const check = (text, kind) => eq(kind, typeof strtol(text, null, 10));

    for(const text of ['0', '-5', '9007199254740990', '9007199254740991', '-9007199254740991'])
      check(text, 'number');

    for(const text of ['9007199254740992', '-9007199254740992', '9007199254740993', '-9007199254740993', '9223372036854775807', '-9223372036854775808'])
      check(text, 'bigint');

    eq(9007199254740991, strtol('9007199254740991', null, 10));
    eq('-9007199254740993n', strtol('-9007199254740993', null, 10) + 'n');
    eq('9223372036854775807n', strtol('9223372036854775807', null, 10) + 'n');
  },

  'u64_fast is a Number up to 2^53 - 2 and an exact BigInt from 2^53 - 1, as in bun'() {
    const strtoul = CFunction({ ptr: libc('strtoul'), args: ['cstring', 'pointer', 'i32'], returns: 'u64_fast' });

    for(const text of ['0', '5', '4294967296', '9007199254740989', '9007199254740990'])
      eq('number', typeof strtoul(text, null, 10));

    for(const text of ['9007199254740991', '9007199254740992', '9007199254740993', '18446744073709551615'])
      eq('bigint', typeof strtoul(text, null, 10));

    eq(9007199254740990, strtoul('9007199254740990', null, 10));
    eq('9007199254740993n', strtoul('9007199254740993', null, 10) + 'n');
    eq('18446744073709551615n', strtoul('18446744073709551615', null, 10) + 'n');
  },

  'the _fast types take a Number or a BigInt as an argument and round-trip exactly'() {
    const labs = CFunction({ ptr: libc('labs'), args: ['i64_fast'], returns: 'i64_fast' });
    const llabs = CFunction({ ptr: libc('llabs'), args: ['i64'], returns: 'u64_fast' });

    eq(7, labs(-7));
    eq(7, labs(-7n));
    eq('9007199254740993n', labs(-(2n ** 53n + 1n)) + 'n');
    eq('9007199254740993n', llabs(2n ** 53n + 1n) + 'n');
  },

  'a JSCallback gets a _fast argument as a Number or, past the limit, a BigInt'() {
    let seen = [];
    const cb = new JSCallback((a, b) => { seen.push(typeof a, typeof b); return 0; }, { args: ['i64_fast', 'u64_fast'], returns: 'i32' });
    const call = CFunction({ ptr: cb.ptr, args: ['i64', 'u64'], returns: 'i32' });

    call(5, 6);
    call(2n ** 53n, 2n ** 53n - 1n);
    eq('number,number,bigint,bigint', seen.join());
    cb.close();
  },

  'C-style aliases behave like the short name they stand for'() {
    const abs = CFunction({ ptr: libc('abs'), args: ['int'], returns: 'int' });
    eq(5, abs(-5));
    const strlen = CFunction({ ptr: libc('strlen'), args: ['cstring'], returns: 'usize' });
    eq(5n, strlen('hello'));
    const toupper = CFunction({ ptr: libc('toupper'), args: ['int32_t'], returns: 'char' });
    eq(65, toupper(97));
    const fabs = CFunction({ ptr: libc('fabsf') || libc('abs'), args: ['float'], returns: 'float' });
    eq(1.5, fabs(-1.5));
  },

  'FFIType has no extra names beyond the documented vocabulary'() {
    eq(Object.keys(IDS).length + 18, Object.keys(FFIType).length);
  },

  'FFIType.* is interchangeable with the equivalent string in CFunction'() {
    const abs = CFunction({ ptr: libc('abs'), args: [FFIType.i32], returns: FFIType.i32 });
    eq(5, abs(-5));
  },

  'FFIType.cstring/u64 work for CFunction args/returns'() {
    const strlen = CFunction({ ptr: libc('strlen'), args: [FFIType.cstring], returns: FFIType.u64 });
    eq(5n, strlen('hello'));
  },

  'FFIType.* is interchangeable with the equivalent string in JSCallback'() {
    let seen;
    const cb = new JSCallback(v => { seen = v; return v * 2; }, { args: [FFIType.i32], returns: FFIType.i32 });
    const call = CFunction({ ptr: cb.ptr, args: [FFIType.i32], returns: FFIType.i32 });

    eq(14, call(7));
    eq(7, seen);
    cb.close();
  },

  'any type name ending in * is a pointer, as argument and as return'() {
    for(const t of ['void *', 'int *', 'struct foo **', 'char*', 'unsigned long * ', 'ns::Widget *']) {
      const malloc = CFunction({ ptr: libc('malloc'), args: ['u64'], returns: t });
      const free = CFunction({ ptr: libc('free'), args: [t], returns: 'void' });
      const p = malloc(16n);

      assert(p !== null && (typeof p === 'number' || typeof p === 'bigint'), t + ': malloc should return a pointer, got ' + typeof p);
      free(p);
    }
  },

  'a "char *" is a plain pointer, not a cstring'() {
    const strdup = CFunction({ ptr: libc('strdup'), args: ['cstring'], returns: 'char *' });
    const strlen = CFunction({ ptr: libc('strlen'), args: ['char *'], returns: 'u64' });
    const free = CFunction({ ptr: libc('free'), args: ['const char *'], returns: 'void' });
    const p = strdup('hello');

    try {
      assert(typeof p !== 'string', 'a "char *" return must stay a pointer, got a ' + typeof p);
      eq(5n, strlen(p));
    } finally {
      free(p);
    }
  },

  'a pointer-typed argument takes an ArrayBuffer'() {
    const strlen = CFunction({ ptr: libc('strlen'), args: ['const struct foo *'], returns: 'u64' });

    eq(3n, strlen(new Uint8Array([97, 98, 99, 0]).buffer));
  },

  'a name that neither ends in * nor is known is a TypeError that names it'() {
    const e = assertThrows(() => CFunction({ ptr: libc('abs'), args: ['no such type'], returns: 'i32' }));

    assert(e instanceof TypeError && /unknown type: no such type/.test(e.message), String(e));
    assert(/unknown return type: nope/.test(assertThrows(() => CFunction({ ptr: libc('abs'), returns: 'nope' })).message));
  },

  'JSCallback accepts typed pointer arguments'() {
    let seen;
    const cb = new JSCallback(p => { seen = p; }, { args: ['int *'], returns: 'void' });
    const call = CFunction({ ptr: cb.ptr, args: ['int *'], returns: 'void' });

    call(new Int32Array([1]).buffer);
    assert(typeof seen === 'number' || typeof seen === 'bigint', 'callback should receive a pointer, got ' + typeof seen);
    cb.close();
  },
});
