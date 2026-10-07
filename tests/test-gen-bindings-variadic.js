import * as std from 'std';
import { realpath } from 'os';
import { tests, eq, assert } from './tinytest.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';

function sh(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();
  p.close();
  return out;
}

sh('mkdir -p ' + tmp);
sh('c++ -shared -fPIC -o ' + tmp + 'libvariadic.so ' + root + 'tests/cxx/variadic.cpp');

const lib = realpath(tmp + 'libvariadic.so')[0];
const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--c++', '--namespace=va', '--library=' + lib, '-o', tmp + 'test-gen-bindings-variadic.gen.js', root + 'tests/cxx/variadic.hpp'].join(' '));
const js = std.loadFile(tmp + 'test-gen-bindings-variadic.gen.js');

assert(js !== null, 'no module written, output was:\n' + out);

const m = await import('../.tmp/test-gen-bindings-variadic.gen.js');

await tests({
  'a variadic C++ function and method are bound, not skipped'() {
    assert(!/variadic/.test((js.split('// Skipped')[1] || '')), 'a variadic function is in the skipped list');
    assert(js.includes('variadic:true'), 'no variadic:true in the output');
  },

  'a C++ function takes (type, value) pairs after the fixed arguments'() {
    eq(0, m.sum(0));
    eq(6, m.sum(3, 'i32', 1, 'i32', 2, 'i32', 3));
  },

  'a method takes them too, and the other overload is still picked by its arguments'() {
    const a = new m.Acc();

    eq(3, a.add(2, 'i32', 1, 'i32', 2));
    eq(8, a.add('hello'));
    eq(15, a.add(1, 'i32', 7));
    assert(a.total === 15, 'total is ' + a.total);
    a.delete();
  },
});
