import { tests, eq, assert } from './tinytest.js';
import { dlsym, RTLD_DEFAULT } from 'ffi';
import { define, call } from '../lib/ffi/legacy.js';

function assertThrows(fn, msg) {
  try {
    fn();
  } catch(e) {
    return e;
  }
  throw new Error('expected to throw: ' + (msg || fn));
}

const libc = name => dlsym(RTLD_DEFAULT, name);

await tests({
  'define() with a null function pointer throws TypeError'() {
    const e = assertThrows(() => define('x', null, null, 'void'));
    assert(e instanceof TypeError, 'expected TypeError, got ' + e);
  },

  'define() takes any type name ending in * as a pointer'() {
    assert(define('my_malloc', libc('malloc'), null, 'struct buf *', 'uint64'), 'define(malloc) failed');
    assert(define('my_free', libc('free'), null, 'void', 'struct buf *'), 'define(free) failed');

    const p = call('my_malloc', 16);

    assert(p !== null && (typeof p === 'number' || typeof p === 'bigint'), 'expected a pointer, got ' + typeof p);
    eq(0, call('my_free', p));
  },

  'define() of a name already defined keeps the first and returns true'() {
    assert(define('l_abs', libc('abs'), null, 'int', 'int'));
    assert(define('l_abs', libc('labs'), null, 'long', 'long'));
    eq(5, call('l_abs', -5));
  },

  'define() with an unknown or unsupported type returns false'() {
    assert(!define('l_bad1', libc('abs'), null, 'int', 'no_such_type'));
    assert(!define('l_bad2', libc('abs'), null, 'no_such_type', 'int'));
    assert(!define('l_bad3', libc('abs'), null, 'longdouble'));
  },

  'call() of an undefined function throws'() {
    assertThrows(() => call('l_not_defined'));
  },

  'results are numbers: ints, negative ints, doubles, void as 0'() {
    define('l_labs', libc('labs'), null, 'long', 'long');
    define('l_pow', libc('pow'), null, 'double', 'double', 'double');
    define('l_srand', libc('srand'), null, 'void', 'uint');

    eq(1024, call('l_pow', 2, 10));
    eq(9007199254740991, call('l_labs', -9007199254740991));
    eq(0, call('l_srand', 1));
    eq('number', typeof call('l_labs', -3));
  },

  'a string argument is copied and NUL-terminated, in UTF-8'() {
    define('l_strlen', libc('strlen'), null, 'size_t', 'char *');
    eq(5, call('l_strlen', 'hello'));
    eq(6, call('l_strlen', 'héllo'));
    eq(0, call('l_strlen', ''));
  },

  'a "char *" return is a string, NULL is null'() {
    define('l_strdup', libc('strdup'), null, 'char *', 'char *');
    define('l_getenv', libc('getenv'), null, 'string', 'string');

    eq('abc', call('l_strdup', 'abc'));
    eq(null, call('l_getenv', 'QJS_FFI_SURELY_NOT_SET_12345'));
  },

  'an ArrayBuffer is passed by address and can be written'() {
    define('l_strcpy', libc('strcpy'), null, 'void *', 'void *', 'char *');

    const buf = new Uint8Array(8);
    call('l_strcpy', buf.buffer, 'abc');
    eq('97,98,99,0', Array.from(buf.subarray(0, 4)).join());
  },

  'true and false are 1 and 0, null is NULL'() {
    define('l_abs2', libc('abs'), null, 'int', 'int');

    eq(1, call('l_abs2', true));
    eq(0, call('l_abs2', false));
    eq(0, call('l_abs2', null));
  },
});
