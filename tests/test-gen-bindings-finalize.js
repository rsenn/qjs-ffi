import * as std from 'std';
import * as os from 'os';
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

function generate(name, ...flags) {
  const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', ...flags, '--library=' + lib, '-o', tmp + name, root + 'tests/cxx/virt.hpp'].join(' '));

  assert(std.loadFile(tmp + name) !== null, 'no module written, output was:\n' + out);
  return import('../.tmp/' + name);
}

const plain = await generate('test-gen-bindings-finalize.plain.js');
const fin = await generate('test-gen-bindings-finalize.fin.js', '--finalize');

/* A finalization callback runs on a later turn of the event loop, not inside
 * the collection. */
async function settle() {
  for(let i = 0; i < 2; i++) {
    std.gc();
    await new Promise(r => os.setTimeout(r, 0));
  }
}

const drop = (m, n, cls = 'Dog') => {
  for(let i = 0; i < n; i++) new m[cls]();
};

await tests({
  'without --finalize a dropped object is not destroyed: only delete() does that'() {
    const alive = plain.Animal.alive();

    drop(plain, 3);

    return settle().then(() => eq(alive + 3, plain.Animal.alive()));
  },

  'with --finalize a dropped object is destroyed when collected, through the derived destructor'() {
    const alive = fin.Animal.alive();
    const dtors = fin.dog_dtors();

    drop(fin, 4);
    eq(alive + 4, fin.Animal.alive());

    return settle().then(() => {
      eq(alive, fin.Animal.alive());
      eq(dtors + 4, fin.dog_dtors());
    });
  },

  'a class that inherits its virtual destructor is destroyed too'() {
    const alive = fin.Animal.alive();

    drop(fin, 3, 'Bird');
    eq(alive + 3, fin.Animal.alive());

    return settle().then(() => eq(alive, fin.Animal.alive()));
  },

  'an object that is still referenced is left alone'() {
    const alive = fin.Animal.alive();
    const keep = new fin.Dog();

    return settle().then(() => {
      eq(alive + 1, fin.Animal.alive());
      eq(4, keep.legs());
      keep.delete();
    });
  },

  'delete() destroys at once and the collector does not destroy it again'() {
    const alive = fin.Animal.alive();
    const dtors = fin.dog_dtors();
    const d = new fin.Dog();

    d.delete();
    eq(dtors + 1, fin.dog_dtors());
    eq(alive, fin.Animal.alive());

    return settle().then(() => eq(dtors + 1, fin.dog_dtors()));
  },

  'a deleted object stays safe to touch until it is collected'() {
    const d = new fin.Dog();

    d.delete();
    eq(true, d instanceof ArrayBuffer && d.byteLength > 0);
    assert(d.ptr !== undefined, 'the address is still readable');

    let threw = null;

    try {
      d.legs();
    } catch(e) {
      threw = e;
    }

    assert(threw !== null, 'calling a deleted object throws');
  },

  'at() never finalizes: it wraps memory it does not own'() {
    const alive = fin.Animal.alive();
    const dtors = fin.dog_dtors();

    for(let i = 0; i < 3; i++) fin.Animal.at(fin.make_animal(1));

    return settle().then(() => {
      eq(alive + 3, fin.Animal.alive());
      eq(dtors, fin.dog_dtors());
    });
  },

  'an object of a JS subclass is finalized as its C++ class'() {
    class Pup extends fin.Dog {}

    const alive = fin.Animal.alive();
    const dtors = fin.dog_dtors();
    const p = new Pup();

    assert(p instanceof Pup && p instanceof fin.Dog && p instanceof ArrayBuffer, 'the prototype chain is kept');
    eq(4, p.legs());

    for(let i = 0; i < 2; i++) new Pup();

    return settle().then(() => {
      // p itself is still in scope
      eq(alive + 1, fin.Animal.alive());
      eq(dtors + 2, fin.dog_dtors());
      p.delete();
    });
  },

  'a constructor that fails leaves nothing behind'() {
    const alive = fin.Animal.alive();

    for(let i = 0; i < 3; i++) {
      let threw = null;

      try {
        new fin.Dog(1, 2, 3);
      } catch(e) {
        threw = e;
      }

      assert(threw instanceof TypeError, 'no overload takes three arguments');
    }

    return settle().then(() => eq(alive, fin.Animal.alive()));
  },

  '--finalize with --api=define is refused'() {
    const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--api=define', '--finalize', root + 'tests/cxx/virt.hpp'].join(' '));

    assert(/--finalize needs --api=cfunction/.test(out), out);
  },
});
