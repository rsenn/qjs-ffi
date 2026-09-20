import { tests, assert } from './tinytest.js';
import { define } from 'ffi';

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
});
