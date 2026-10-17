import * as std from 'std';
import { realpath } from 'os';
import { tests, eq, assert } from './tinytest.js';
import { dlopen, dlsym, RTLD_NOW } from 'ffi';
import { CXXFunction } from '../lib/ffi/cxx.js';

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

const lib = dlopen(realpath(tmp + 'libcxxstring.so')[0], RTLD_NOW);
const fn = (name, args, returns) => CXXFunction({ ptr: dlsym(lib, name), args, returns });
const long = 'a string long enough to leave the inline buffer';

await tests({
  'a std::string by value in, a std::string out'() {
    eq('hello world', fn('sx_greet', ['std::string'], 'std::string')('world'));
  },

  'const std::string& arguments'() {
    eq('ab', fn('sx_join', ['const std::string&', 'const std::string &'], 'std::string')('a', 'b'));
    eq(5, fn('sx_length', ['const std::string&'], 'u64_fast')('hello'));
  },

  'UTF-8 and the empty string'() {
    eq('€ ünï', fn('sx_join', ['const std::string&', 'const std::string&'], 'std::string')('€ ', 'ünï'));
    eq('', fn('sx_join', ['const std::string&', 'const std::string&'], 'std::string')('', ''));
  },

  'a returned string, short and long'() {
    const repeat = fn('sx_repeat', ['i32'], 'std::string');

    eq('xxx', repeat(3));
    eq('x'.repeat(100), repeat(100));
    eq('', repeat(0));
  },

  'std::string& as an in/out argument: the callee grows it'() {
    const shout = fn('sx_shout', ['std::string&'], 'void');

    eq('hey!!!', shout('hey'));
    eq(long + '!!!', shout(long));
    eq('!!!', shout());
  },

  'std::string* as an output argument, null passes NULL'() {
    const fill = fn('sx_fill', ['std::string*'], 'void');

    eq(long, fill(''));
    eq(long, fill());
    eq(null, fill(null));
  },

  'the result first, then every output argument'() {
    const split = fn('sx_split', ['const std::string&', 'std::string*', 'std::string&'], 'i32');

    eq('1|key|value', split('key:value', '', '').join('|'));
    eq(null, split('key:value', null, '')[1]);
    eq('value', split('key:value', null, '')[2]);
    eq('0||', split('nocolon', '', '').join('|'));
  },

  'a returned reference or pointer is read, not freed'() {
    const name = fn('sx_name', [], 'const std::string&');

    eq('a static name that is long enough to live on the heap', name());
    eq('a static name that is long enough to live on the heap', name());
    eq(null, fn('sx_none', [], 'const std::string*')());
  },

  'std::string_view in and out'() {
    eq('ello', fn('sx_tail', ['std::string_view'], 'std::string_view')('hello'));
    eq('', fn('sx_tail', ['std::string_view'], 'std::string_view')('h'));
    eq(6, fn('sx_vlen', ['std::string_view'], 'u64_fast')('€llo')); // bytes, not characters
    eq(0, fn('sx_vlen', ['std::string_view'], 'u64_fast')(''));
  },

  'other types pass through to CFunction'() {
    eq(3, fn('sx_length', ['const std::string&'], 'u64_fast')('abc'));
  },

  'repeated calls do not crash on the heap'() {
    const join = fn('sx_join', ['const std::string&', 'const std::string&'], 'std::string');

    for(let i = 0; i < 1000; i++) join(long, long);
  },
});
