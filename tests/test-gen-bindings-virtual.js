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
sh('clang++ -shared -fPIC -std=c++17 -o ' + tmp + 'libvirt.so ' + root + 'tests/cxx/virt.cpp');

const lib = realpath(tmp + 'libvirt.so')[0];
const gen = (name, ...flags) => sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', ...flags, '--library=' + lib, '-o', tmp + name, root + 'tests/cxx/virt.hpp'].join(' '));

const out = gen('test-gen-bindings-virtual.gen.js');

assert(std.loadFile(tmp + 'test-gen-bindings-virtual.gen.js') !== null, 'no module written, output was:\n' + out);

const m = await import('../.tmp/test-gen-bindings-virtual.gen.js');
const wrap = kind => m.Animal.at(m.make_animal(kind));

await tests({
  'the IR gives each virtual method, an overrider the AST does not flag included, its vtable slot'() {
    const file = tmp + 'test-gen-bindings-virtual.ir.json';

    sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--emit-ir=' + file, root + 'tests/cxx/virt.hpp'].join(' '));

    const ir = JSON.parse(std.loadFile(file));
    const cls = n => ir.classes.find(c => c.name === n);
    const slot = (c, name, arity) => cls(c).methods.find(x => x.name === name && x.arity === arity).vtableSlot;

    eq(slot('Animal', 'legs', 0), slot('Dog', 'legs', 0));
    eq(slot('Animal', 'legs', 1), slot('Dog', 'legs', 1));
    eq(slot('Animal', 'legs', 0), slot('Bird', 'legs', 0));
    assert(slot('Animal', 'legs', 0) !== slot('Animal', 'legs', 1), 'the two overloads have two slots');
    assert(slot('Animal', 'sound', 0) !== undefined, 'a pure virtual has a slot');
    assert(cls('Animal').methods.find(x => x.name === 'describe').vtableSlot === undefined, 'a plain method has none');
    assert(cls('Animal').methods.find(x => x.name === 'alive').vtableSlot === undefined, 'a static one neither');
    assert(cls('Bird').destructor && cls('Bird').destructor.vtableSlot !== undefined, 'the implicit destructor is reached through the vtable');
  },

  'a method called on an object wrapped by its base class runs the override'() {
    const dog = wrap(1);
    const bird = wrap(2);

    eq(4, dog.legs());
    eq(2, bird.legs());
    eq(7, dog.legs(3));
    eq(103, bird.legs(3));
  },

  'a pure virtual method is callable'() {
    eq('woof', wrap(1).sound());
    eq('tweet', wrap(2).sound());
  },

  'a native method that calls a virtual one gets the override too'() {
    eq(4, wrap(1).describe());
    eq(2, wrap(2).describe());
  },

  'an object made in JS dispatches the same way'() {
    const alive = m.Animal.alive();
    const d = new m.Dog();

    try {
      eq(4, d.legs());
      eq('woof', d.sound());
      eq(4, d.describe());
      eq(alive + 1, m.Animal.alive());
    } finally {
      d.delete();
    }
  },

  'delete() through the base class runs the derived destructor'() {
    const before = m.dog_dtors();
    const alive = m.Animal.alive();
    const a = wrap(1);

    eq(alive + 1, m.Animal.alive());
    a.delete();
    eq(before + 1, m.dog_dtors());
    eq(alive, m.Animal.alive());
  },

  'a class that inherits its virtual destructor is destroyed through the vtable'() {
    const alive = m.Animal.alive();
    const b = wrap(2);

    eq(alive + 1, m.Animal.alive());
    b.delete();
    eq(alive, m.Animal.alive());
  },

  'a deleted object cannot be called'() {
    const a = wrap(1);

    a.delete();

    let threw = null;

    try {
      a.legs();
    } catch(e) {
      threw = e;
    }

    assert(threw !== null, 'a deleted object must not be callable');
  },

  '--api=define keeps binding by symbol: no vtable call is generated'() {
    const text = gen('test-gen-bindings-virtual.define.js', '--api=define') && std.loadFile(tmp + 'test-gen-bindings-virtual.define.js');

    assert(text !== null && !text.includes('__virtual('), 'define must not use __virtual');
  },
});
