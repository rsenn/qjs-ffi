/* probe.mjs: one script for bun and for qjsm, printing one line per case.
 * tests/test-bun-diff.js runs both and compares the lines. */
import { dlopen, CFunction, JSCallback, ptr, read, toArrayBuffer, CString, FFIType, linkSymbols, suffix } from 'bun:ffi';

const out = [];

/* what a value looks like, without addresses and error texts. */
function show(v) {
  if(typeof v == 'bigint') return v + 'n';
  if(typeof v == 'object' && v !== null) return v instanceof Error ? 'Error:' + v.constructor.name : Object.prototype.toString.call(v);
  return typeof v == 'function' ? 'function' : String(v);
}

const t = (name, fn) => {
  try {
    out.push(name + ': ' + show(fn()));
  } catch(e) {
    out.push(name + ': THROWS ' + e.constructor.name);
  }
};

const libc = dlopen('libc.so.6', {
  abs: { args: ['i32'], returns: 'i32' },
  labs: { args: ['i64'], returns: 'i64' },
  llabs: { args: ['i64'], returns: 'i64_fast' },
  strlen: { args: ['cstring'], returns: 'u64' },
  strdup: { args: ['cstring'], returns: 'cstring' },
  atof: { args: ['cstring'], returns: 'f64' },
  toupper: { args: ['i32'], returns: 'i32' },
  isalpha: { args: ['i32'], returns: 'bool' },
  getenv: { args: ['cstring'], returns: 'ptr' },
  malloc: { args: ['usize'], returns: 'ptr' },
  calloc: { args: ['usize', 'usize'], returns: 'ptr' },
  strtoul: { args: ['cstring', 'ptr', 'i32'], returns: 'u64_fast' },
  memset: { args: ['ptr', 'i32', 'usize'], returns: 'ptr' },
  qsort: { args: ['ptr', 'usize', 'usize', 'function'], returns: 'void' },
});
const f = libc.symbols;
const libm = dlopen('libm.so.6', { sqrtf: { args: ['f32'], returns: 'f32' } }).symbols;

t('arg i32 from number', () => f.abs(-5));
t('arg i32 wraps 2**31', () => f.abs(2 ** 31));
t('arg i32 from bigint', () => f.abs(-2n));
t('arg i32 from string', () => f.abs('7'));
t('arg i32 from null', () => f.abs(null));
t('arg i32 from undefined', () => f.abs());
t('arg i32 from true', () => f.abs(true));
t('arg i32 from float', () => f.abs(-1.9));
t('arg i32 from object', () => f.abs({}));
t('arg i32 from Symbol', () => f.abs(Symbol('x')));
t('arg i64 from number', () => f.labs(-5));
t('arg i64 from bigint', () => f.labs(-5n));
t('arg i64 2**53', () => f.labs(-(2 ** 53)));
t('arg f32', () => libm.sqrtf(9));
t('arg cstring utf8 length', () => f.strlen('héllo'));
t('return cstring', () => f.strdup('abc'));
t('return f64', () => f.atof('2.5'));
t('return bool', () => f.isalpha(65));
t('return bool false', () => f.isalpha(48));
t('return NULL ptr', () => f.getenv('NO_SUCH_VARIABLE_XYZ'));
t('return ptr type', () => typeof f.calloc(1, 16));
t('return u64_fast big', () => f.strtoul('18446744073709551615', null, 10));
t('return u64_fast small', () => f.strtoul('5', null, 10));
t('return i64_fast safe', () => f.llabs(-9007199254740991));
t('return i64_fast 2**53', () => f.llabs(-(2 ** 53)));

const p = f.calloc(1, 16);
t('toArrayBuffer length', () => toArrayBuffer(p, 0, 4).byteLength);
t('toArrayBuffer offset', () => new Uint8Array(toArrayBuffer(ptr(new Uint8Array([1, 2, 3, 4])), 1, 2)).join());
t('toArrayBuffer negative length', () => toArrayBuffer(p, 0, -1));
t('toArrayBuffer zero length', () => toArrayBuffer(p, 0, 0));
t('toArrayBuffer null', () => toArrayBuffer(null, 0, 4));
t('read.i32', () => read.i32(ptr(new Int32Array([-7])), 0));
t('read.u8 negative offset', () => read.u8(ptr(new Uint8Array([1, 2, 3])) + 2, -1));
t('read.i8 null', () => read.i8(0, 0));
t('read.u64 type', () => typeof read.u64(ptr(new BigUint64Array([5n])), 0));
t('read.ptr type', () => typeof read.ptr(ptr(new BigUint64Array([5n])), 0));
t('ptr of a view', () => typeof ptr(new Uint8Array(4)));
t('ptr offset', () => { const b = new Uint8Array(8); return ptr(b, 2) - ptr(b); });
t('CString null', () => String(new CString(null)));
t('CString text', () => String(new CString(ptr(new Uint8Array([104, 105, 0])))));
t('CString length 0', () => String(new CString(p, 0, 0)));
t('CString negative length', () => String(new CString(p, 0, -1)));
t('CString typeof', () => typeof new CString(ptr(new Uint8Array([104, 105, 0]))));
t('FFIType.i32', () => FFIType.i32);
t('FFIType.int', () => FFIType.int);
t('FFIType "5"', () => FFIType['5']);
t('FFIType.cstring', () => FFIType.cstring);
t('FFIType.usize', () => FFIType.usize);
t('suffix', () => suffix);

t('CFunction length', () => f.abs.length);
t('CFunction name', () => f.abs.name);
t('CFunction ptr type', () => typeof f.abs.ptr);
t('CFunction has name and ptr', () => ['name', 'ptr'].every(k => Object.getOwnPropertyNames(f.abs).includes(k)));
t('CFunction close', () => typeof CFunction({ ptr: ptr(new Uint8Array(1)), args: [], returns: 'void' }).close);
t('unknown type in args', () => CFunction({ ptr: ptr(new Uint8Array(1)), args: ['nope'], returns: 'i32' }));
t('unknown type in returns', () => CFunction({ ptr: ptr(new Uint8Array(1)), args: [], returns: 'nope' }));
/* bun throws a plain Error here, we a TypeError: both are Errors. */
const isError = fn => { try { fn(); return 'no error'; } catch(e) { return e instanceof Error ? 'an Error' : 'not an Error'; } };
t('args not an array', () => isError(() => CFunction({ ptr: ptr(new Uint8Array(1)), args: 'i32', returns: 'i32' })));
t('args array-like', () => isError(() => CFunction({ ptr: ptr(new Uint8Array(1)), args: { length: 1, 0: 'i32' }, returns: 'i32' })));
t('33 arguments', () => CFunction({ ptr: ptr(new Uint8Array(1)), args: Array(33).fill('i32'), returns: 'i32' }));
t('ptr NULL', () => CFunction({ ptr: 0, args: [], returns: 'void' }));

t('dlopen missing library', () => dlopen('/no/such/library.so', { x: { args: [], returns: 'void' } }));
t('dlopen missing symbol', () => dlopen('libc.so.6', { no_such_symbol_xyz: { args: [], returns: 'void' } }));
t('dlopen close()', () => dlopen('libc.so.6', { abs: { args: ['i32'], returns: 'i32' } }).close());
t('dlopen keys', () => Object.keys(dlopen('libc.so.6', { abs: { args: ['i32'], returns: 'i32' } })).join());
t('dlopen empty symbols', () => dlopen('libc.so.6', {}));
t('linkSymbols', () => linkSymbols({ abs2: { ptr: f.abs.ptr || ptr(new Uint8Array(1)), args: ['i32'], returns: 'i32' } }) && 'ok');

const cb = new JSCallback((a, b) => a + b, { args: ['i32', 'i32'], returns: 'i32' });
t('JSCallback call', () => CFunction({ ptr: cb.ptr, args: ['i32', 'i32'], returns: 'i32' })(2, 3));
t('JSCallback ptr type', () => typeof cb.ptr);
t('JSCallback threadsafe', () => cb.threadsafe);
t('JSCallback threadsafe option', () => new JSCallback(() => 0, { args: [], returns: 'i32', threadsafe: true }).threadsafe);
t('JSCallback close()', () => cb.close());
t('JSCallback ptr after close', () => cb.ptr);
t('JSCallback unknown type', () => new JSCallback(() => 0, { args: ['nope'], returns: 'i32' }));
t('JSCallback not a function', () => new JSCallback(5, { args: [], returns: 'i32' }));

const thrower = new JSCallback(() => { throw new RangeError('boom'); }, { args: [], returns: 'i32' });
t('callback throws', () => CFunction({ ptr: thrower.ptr, args: [], returns: 'i32' })());
const bigint = new JSCallback(() => 5n, { args: [], returns: 'i32' });
t('callback returns bigint for i32', () => CFunction({ ptr: bigint.ptr, args: [], returns: 'i32' })());
t('qsort with a comparator', () => {
  const data = new Int32Array([3, 1, 2, 5, 4]);
  const compare = new JSCallback((a, b) => read.i32(a, 0) - read.i32(b, 0), { args: ['ptr', 'ptr'], returns: 'i32' });

  f.qsort(ptr(data), 5, 4, compare.ptr);
  return data.join();
});
t('qsort comparator throws', () => {
  const compare = new JSCallback(() => { throw new TypeError('x'); }, { args: ['ptr', 'ptr'], returns: 'i32' });

  f.qsort(ptr(new Int32Array([3, 1, 2])), 3, 4, compare.ptr);
});

console.log(out.join('\n'));
