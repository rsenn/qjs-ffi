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

/* the generated module as text; the classes are not imported, since the
 * constructor-as-type form needs a qjs-ffi that accepts it. */
function gen(name, ...args) {
  const file = tmp + 'test-gen-bindings-classtypes.' + name + '.js';

  sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '-o', file, ...args].join(' '));
  return std.loadFile(file) || '';
}

sh('mkdir -p ' + tmp);

const structs = root + 'tests/cxx/structs.h';
const shapes = root + 'tests/cxx/shapes.hpp';

sh('cc -shared -fPIC -o ' + tmp + 'libclasstypes.so ' + root + 'tests/cxx/structs.c');

const lib = realpath(tmp + 'libclasstypes.so')[0];
const loaded = (gen('run', '--structs', '--class-types', '--library=' + lib, structs), await import('../.tmp/test-gen-bindings-classtypes.run.js'));

await tests({
  'the generated module loads and calls through its classes'() {
    const s = loaded.sample_new();

    assert(s instanceof loaded.sample, 'a returned pointer is not a sample');
    eq(loaded.sample.size, s.byteLength);
    loaded.sample_fill(s);
    eq(1, loaded.sample_check(s));
    loaded.sample_free(s);
  },

  'without --class-types a struct pointer stays "T *"'() {
    const js = gen('off', '--structs', structs);

    assert(/export class sample /.test(js), 'no class generated');
    assert(js.includes("args:['struct sample *'],returns:'void'"), 'type changed without the option');
  },

  'a struct pointer argument and return become the class'() {
    const js = gen('on', '--structs', '--class-types', structs);

    assert(js.includes("args:[sample],returns:'void'"), 'sample_fill: ' + js.split('\n').filter(l => /sample_fill/.test(l)));
    assert(js.includes('args:[],returns:sample'), 'sample_new');
    assert(js.indexOf('export class sample ') < js.indexOf('export const sample_fill'), 'class comes after its use');
  },

  'every class used as a type has static size'() {
    const js = gen('size', '--structs', '--class-types', structs);

    assert(/^sample\.size = \d+;$/m.test(js), 'sample.size');
  },

  'a C++ class is the type of this and of a reference parameter'() {
    const js = gen('cxx', '--structs', '--class-types', '--c++', shapes);

    assert(js.includes("args:[geo_Shape,'i32','f64']"), 'this of a constructor');
    assert(js.includes('args:[geo_Shape,geo_Shape]'), 'a "Shape *" parameter, found by its short name');
    assert(/^geo_Shape\.size = 24;$/m.test(js), 'geo_Shape.size');
  },

});
