import { tests, assert } from './tinytest.js';
import { define, call, dlsym, RTLD_DEFAULT } from 'ffi';

function assertThrows(fn, msg) {
  try {
    fn();
  } catch(e) {
    return e;
  }
  throw new Error('expected to throw: ' + (msg || fn));
}

await tests({
  'define() with a null function pointer throws TypeError'() {
    const e = assertThrows(() => define('x', null, null, 'void'));
    assert(e instanceof TypeError, 'expected TypeError, got ' + e);
  },

  'define() takes any type name ending in * as a pointer'() {
    assert(define('my_malloc', dlsym(RTLD_DEFAULT, 'malloc'), null, 'struct buf *', 'uint64'), 'define(malloc) failed');
    assert(define('my_free', dlsym(RTLD_DEFAULT, 'free'), null, 'void', 'struct buf *'), 'define(free) failed');

    const p = call('my_malloc', 16);

    assert(p !== null && (typeof p === 'number' || typeof p === 'bigint'), 'expected a pointer, got ' + typeof p);
    call('my_free', p);
  },
});
