import * as std from 'std';
import * as os from 'os';
import { tests, eq, assert } from './tinytest.js';
import { dlopen, dlsym, ptr, read, toArrayBuffer, toBuffer, toPointer, CString, CFunction, JSCallback, RTLD_DEFAULT, RTLD_NEXT } from 'ffi';

const bytes = str => new Uint8Array(Array.from(str, c => c.charCodeAt(0))).buffer;

const libc = name => dlsym(RTLD_DEFAULT, name);

await tests({
  'a pointer is a Number: ptr(), dlsym(), JSCallback.ptr and a malloc() result'() {
    const malloc = CFunction({ ptr: libc('malloc'), args: ['u64'], returns: 'pointer' });
    const free = CFunction({ ptr: libc('free'), args: ['pointer'], returns: 'void' });
    const cb = new JSCallback(() => 0, { returns: 'i32' });
    const p = malloc(16);

    eq('number', typeof ptr(new Uint8Array(4)));
    eq('number', typeof libc('abs'));
    eq('number', typeof cb.ptr);
    eq('number', typeof p);
    assert(Number.isSafeInteger(p) && p > 0xffffffff, 'expected a user-space address above 2^32, got ' + p);
    free(p);
    cb.close();
  },

  'ptr() and read take a JSCallback as its function pointer, a closed one is a TypeError'() {
    const cb = new JSCallback(() => 0, { returns: 'i32' });

    eq(Number(cb.ptr), ptr(cb));
    eq(Number(cb.ptr) + 4, ptr(cb, 4));
    eq(read.u8(cb.ptr, 1), read.u8(cb, 1));
    cb.close();

    for(const f of [() => ptr(cb), () => read.u8(cb)]) {
      let e;
      try { f(); } catch(x) { e = x; }
      assert(e instanceof TypeError, 'expected TypeError for a closed JSCallback, got ' + e);
    }
  },

  'a pointer argument follows bun: only null, undefined, a Number, a BigInt, a view or a JSCallback'() {
    const id = CFunction({ ptr: libc('labs'), args: ['pointer'], returns: 'pointer' });
    const rejected = [true, false, '', 'abc', '0x1000', {}, [], [5], () => 1, Symbol('s'), new Number(7), { valueOf: () => 9 }];

    for(const v of rejected) {
      let e;
      try { id(v); } catch(x) { e = x; }
      assert(e instanceof TypeError, 'expected TypeError for ' + String(typeof v === 'symbol' ? 'Symbol' : JSON.stringify(v) || typeof v) + ', got ' + e);
    }

    eq(null, id(undefined));
    eq(null, id(null));
    eq(null, id(0));
  },

  'a Number is truncated; NaN, an infinity and anything outside int64 are the address 2^63, as in bun'() {
    const id = CFunction({ ptr: libc('labs'), args: ['pointer'], returns: 'pointer' });

    eq(1, id(1.5));
    eq(1, id(-1.5));
    eq(9007199254740991, id(9007199254740991));

    for(const v of [NaN, Infinity, -Infinity, 1e300, 2 ** 63, 2 ** 64])
      eq('9223372036854775808n', id(v) + 'n');
  },

  'a BigInt is taken modulo 2^64'() {
    const id = CFunction({ ptr: libc('labs'), args: ['pointer'], returns: 'pointer' });

    eq(5, id(5n));
    eq(5, id(2n ** 64n + 5n));
    eq(5, id(2n ** 70n + 5n));
    eq(null, id(2n ** 64n));
  },

  'ptr() and read() refuse what is not a pointer'() {
    for(const f of [() => ptr('abc'), () => ptr({}), () => ptr(true), () => read.u8('0x1000')]) {
      let e;
      try { f(); } catch(x) { e = x; }
      assert(e instanceof TypeError, 'expected TypeError, got ' + e);
    }
  },

  'the legacy toArrayBuffer(string address, size, false) still reads an address'() {
    const buf = new Uint8Array([1, 2, 3, 4]);

    eq('1,2,3', new Uint8Array(toArrayBuffer(toPointer(buf.buffer), 3, false)).join());
  },

  'a bad offset or pointer throws at once and leaves no exception behind'() {
    const buf = new Uint8Array(8);
    const sym = Symbol('s');
    const cases = [
      () => ptr(buf, sym),
      () => toPointer(buf.buffer, sym),
      () => read.u8(ptr(buf), sym),
      () => CString(ptr(buf), sym),
      () => CString(ptr(buf), 0, sym),
      () => toArrayBuffer(ptr(buf), sym),
      () => toArrayBuffer(ptr(buf), 0, sym),
      () => ptr(sym),
      () => toPointer(sym),
    ];

    for(const f of cases) {
      let e;
      try { f(); } catch(x) { e = x; }
      assert(e instanceof TypeError || e instanceof RangeError, 'expected a TypeError (or RangeError) for ' + f + ', got ' + e);
    }

    // After all that, a good call must work, and the script must end clean:
    // a leaked pending exception would be reported when the script exits.
    eq(8, ptr(buf, 8) - ptr(buf));
  },

  'a failed conversion leaves no pending exception when the script ends'() {
    const dir = scriptArgs[0].replace(/[^/]*$/, '');
    const child = dir + '../.tmp/test-pointer-helpers.child.js';

    os.mkdir(dir + '../.tmp');

    const f = std.open(child, 'w');
    f.puts(`import { ptr, read, CString, toArrayBuffer, toPointer } from 'ffi';
const buf = new Uint8Array(8), sym = Symbol('s');
for(const f of [() => ptr(buf, sym), () => ptr('x'), () => read.u8(ptr(buf), sym), () => CString({}), () => toArrayBuffer(ptr(buf), sym), () => toPointer(buf.buffer, sym)])
  try { f(); } catch(e) {}
console.log('clean');
`);
    f.close();

    const p = std.popen('qjsm ' + child + ' 2>&1', 'r');
    const out = p.readAsString();
    p.close();
    eq('clean\n', out);
  },

  'pointer arithmetic works without BigInt'() {
    const buf = new Uint8Array(32);

    eq(8, ptr(buf, 8) - ptr(buf));
    eq(ptr(buf) + 16, ptr(buf, 16));
    eq(7, read.u8(ptr(buf) + 3, 4) + 7);
  },

  'read.ptr: a Number up to 2^53 - 1, an exact unsigned BigInt above'() {
    const cell = new BigUint64Array([0x7fffffffffffn, (1n << 53n) - 1n, 1n << 53n, (1n << 53n) + 1n, 0x7fffffffffffffffn, 0xffffffffffffffffn, 0n]);
    const at = i => read.ptr(ptr(cell), i * 8);

    eq(140737488355327, at(0));
    eq(9007199254740991, at(1));
    eq('number', typeof at(1));
    eq('9007199254740992n', at(2) + 'n');
    eq('bigint', typeof at(2));
    eq('9007199254740993n', at(3) + 'n');
    eq('9223372036854775807n', at(4) + 'n');
    eq('18446744073709551615n', at(5) + 'n');
    eq(null, at(6));
  },

  'a pointer comes back through a call as a Number, a large one as a BigInt'() {
    const id = CFunction({ ptr: libc('labs'), args: ['pointer'], returns: 'pointer' });

    eq(1234, id(1234));
    eq(9007199254740991, id(9007199254740991));
    eq('9007199254740992n', id(1n << 53n) + 'n');
    eq('9223372036854775807n', id(0x7fffffffffffffffn) + 'n');
  },

  'a BigInt or a Number is taken as a pointer, including one of 2^63 and more'() {
    // dlsym(RTLD_NEXT, ...) is dlsym((void*)-1, ...): the same handle as a BigInt
    eq(dlsym(RTLD_NEXT, 'abs'), dlsym(0xffffffffffffffffn, 'abs'));
    eq(libc('abs'), dlsym(RTLD_DEFAULT, 'abs'));
    eq(BigInt(ptr(new Uint8Array(1))) > 0n, true);
  },

  'ptr() returns the same address as toPointer()'() {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    eq(toPointer(buf), '0x' + BigInt(ptr(buf)).toString(16));
  },

  'ptr()/toBuffer() round-trip preserves bytes'() {
    const src = new Uint8Array([1, 2, 3, 4, 5, 250]);
    const back = new Uint8Array(toBuffer(ptr(src.buffer), 0, src.length).slice(0));
    eq(src.join(), back.join());
  },

  'toBuffer(ptr, 0, len) honours len'() {
    const src = new Uint8Array([9, 8, 7, 6]);
    eq(2, toBuffer(ptr(src.buffer), 0, 2).byteLength);
  },

  'CString reads a NUL-terminated string'() {
    const buf = bytes('hello\0world');

    eq('hello', CString(ptr(buf)));
    eq('string', typeof CString(ptr(buf)));
  },

  'CString is a string with or without new'() {
    const buf = bytes('abc\0');

    eq('abc', new CString(ptr(buf)));
    eq('string', typeof new CString(ptr(buf)));
  },

  'CString honours byteOffset and byteLength'() {
    const buf = bytes('hello world\0');

    eq('wor', CString(ptr(buf), 6, 3));
    eq('world', CString(ptr(buf), 6));
    eq('', CString(ptr(buf), 6, 0));
  },

  'CString of NULL, nothing or a view'() {
    const buf = bytes('abc\0');

    eq('', CString(null));
    eq('', CString(0));
    eq('', CString());
    eq('abc', CString(buf));
    eq('abc', CString(new Uint8Array(buf)));
    eq('abc', CString(BigInt(ptr(buf))));
  },

  'CString copies: it stays valid after the memory changes'() {
    const view = new Uint8Array(bytes('abc\0'));
    const s = CString(ptr(view));

    view[0] = 122;
    eq('abc', s);
  },

  'CString throws RangeError for a negative byteLength'() {
    let e;
    try { CString(ptr(bytes('abc\0')), 0, -1); } catch(x) { e = x; }
    assert(e instanceof RangeError, 'expected RangeError, got ' + e);
  },

  'CString wraps a pointer returned from native code'() {
    const lib = dlopen(null, { strdup: { args: ['cstring'], returns: 'ptr' } });

    eq('from libc', CString(lib.symbols.strdup('from libc')));
    lib.close();
  },
});
