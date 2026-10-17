/* test-cxx-string.js -- a demo of lib/ffi/cxx/string.js: a std::string
 * that JS owns and C++ functions work on in place.
 *
 * The C++ side is tests/cxx/cxxstring.cpp:
 *
 *   void   sx_shout(std::string& s)   appends "!!!"
 *   void   sx_fill(std::string* s)    assigns a long text, ignores NULL
 *   size_t sx_length(const std::string& s)
 *   int    sx_split(const std::string& in, std::string* head, std::string& tail)
 */
import * as std from 'std';
import { realpath } from 'os';
import { tests, eq, assert } from './tinytest.js';
import { dlopen, dlsym, RTLD_NOW } from 'ffi';
import { CXXFunction } from '../lib/ffi/cxx.js';
import { string } from '../lib/ffi/cxx/string.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';

function sh(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();
  p.close();
  return out;
}

sh('mkdir -p ' + tmp);
sh('clang++ -shared -fPIC -std=c++17 -Wno-return-type-c-linkage -o ' + tmp + 'libcxxstring.so ' + root + 'tests/cxx/cxxstring.cpp');

// 1. open the library and declare the C++ functions with their C++ types
const lib = dlopen(realpath(tmp + 'libcxxstring.so')[0], RTLD_NOW);
const fn = (name, args, returns) => CXXFunction({ ptr: dlsym(lib, name), args, returns });

const shout = fn('sx_shout', ['std::string&'], 'void');
const fill = fn('sx_fill', ['std::string*'], 'void');
const length = fn('sx_length', ['const std::string&'], 'u64_fast');
const split = fn('sx_split', ['const std::string&', 'std::string*', 'std::string&'], 'i32');

await tests({
  'make a string, read it, change it'() {
    const s = new string('hello');

    eq('hello', s.value);
    eq(5, s.length);

    s.value = 'a much longer text than the 15 bytes a short string keeps inline';
    eq(64, s.length);

    s.value = ''; // shrinking and emptying work too
    eq('', s.value);
    s.delete();
  },

  'C++ changes it in place, and the changes stay'() {
    const s = new string('hey');

    shout(s); // sx_shout(std::string&) appends "!!!" ...
    shout(s); // ... every call to the same object
    eq('hey!!!!!!', s.value);

    fill(s); // an output argument: the callee assigns a long string
    eq(47, s.length);
    s.delete();
  },

  'a plain JS string is still copied in, nothing is kept'() {
    eq(5, length('hello'));
    eq(5, length(new string('hello'))); // a string object is passed without a copy
  },

  'several strings in one call'() {
    const head = new string();
    const tail = new string();

    eq(1, split('key:value', head, tail)); // only the status comes back; the strings were filled in place
    eq('key', head.value);
    eq('value', tail.value);

    // mix: a string object for the tail, a JS string for the head -> [status, head]
    eq('1,key', split('key:value', '', tail).join());
    eq('value', tail.value);
    head.delete();
    tail.delete();
  },

  'delete() frees it; a deleted string cannot be used'() {
    const s = new string('x');

    s.delete();
    s.delete(); // twice is fine

    let threw = false;

    try {
      s.value;
    } catch(e) {
      threw = e instanceof TypeError;
    }

    assert(threw, 'reading a deleted string throws TypeError');
  },

  'the dispose method frees it, as `using s = new string()` does where the engine has it'() {
    const s = new string('scoped');

    s[Symbol.dispose || Symbol.for('Symbol.dispose')]();

    let threw = false;

    try {
      s.value;
    } catch(e) {
      threw = true;
    }

    assert(threw, 'disposed');
  },

  'many strings come and go'() {
    for(let i = 0; i < 2000; i++) {
      const s = new string('x'.repeat(i % 100));

      shout(s);
      assert(s.length === (i % 100) + 3, 'length ' + i);
      s.delete();
    }
  },
});
