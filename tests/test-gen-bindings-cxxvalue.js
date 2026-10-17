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
sh('clang++ -shared -fPIC -std=c++17 -o ' + tmp + 'libcxxvalue.so ' + root + 'tests/cxx/cxxvalue.cpp');

const library = realpath(tmp + 'libcxxvalue.so')[0];
const name = 'test-gen-bindings-cxxvalue.gen.js';
const ir = tmp + 'test-gen-bindings-cxxvalue.ir.json';
const gen = ['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--structs'];

sh([...gen, '--library=' + library, '-o', tmp + name, root + 'tests/cxx/cxxvalue.hpp'].join(' '));
sh([...gen, '--emit-ir=' + ir, root + 'tests/cxx/cxxvalue.hpp'].join(' '));
assert(std.loadFile(tmp + name) !== null, 'no module written');

const m = await import('../.tmp/' + name);
const skipped = JSON.parse(std.loadFile(ir)).skipped.map(s => s.name);

await tests({
  'a trivially copyable class is passed and returned by value'() {
    const r = m.gx_add(new m.Vec2(1, 2), new m.Vec2(10, 20));

    eq('11,22', [...new Float32Array(r)].join());
    eq(1 * 3 + 2 * 4, m.gx_dot(new m.Vec2(1, 2), new m.Vec2(3, 4)));
  },

  'a class with a copy constructor or destructor stays unbound'() {
    assert(skipped.includes('gx::owner_id'), 'gx::owner_id is skipped: ' + skipped);
    assert(m.gx_owner_id === undefined, 'gx_owner_id is not exported');
  },

  'an instantiation of a class template is a struct, by value too'() {
    eq(12, m.gx_area(Int32Array.of(3, 4).buffer));
    eq('1,2', [...new Float32Array(m.gx_half(Float32Array.of(2, 4).buffer))].join());
    eq('5,6', [...new Int32Array(m.gx_grow(Int32Array.of(3, 4).buffer, 2))].join());
  },

  'the instantiations get a class with their fields'() {
    const s = new m.Size__int_();

    assert(s.byteLength === 8, 'Size_<int> is 8 bytes');
  },

  'a template instance with a non-type argument (Vec<float, 3>) is bound by value'() {
    eq('2,4,6', [...new Float32Array(m.gx_scale3(Float32Array.of(1, 2, 3).buffer, 2))].join());
  },

  'a template instance holding another instance (Box<int> has Size_<int>) is bound by value'() {
    eq(2 * 3 * 4, m.gx_volume(Int32Array.of(2, 3, 4).buffer));
  },

  'a trivially copyable class with a base is passed by value'() {
    eq(12, m.gx_dsum(Int32Array.of(1, 2).buffer));
  },
});
