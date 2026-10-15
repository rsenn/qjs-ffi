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
sh('clang++ -shared -fPIC -std=c++17 -o ' + tmp + 'libdefaults.so ' + root + 'tests/cxx/defaults.cpp');

const library = realpath(tmp + 'libdefaults.so')[0];
const name = 'test-gen-bindings-defaults.gen.js';
const ir = tmp + 'test-gen-bindings-defaults.ir.json';
const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--structs', '--library=' + library, '-o', tmp + name, root + 'tests/cxx/defaults.hpp'].join(' '));

sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--emit-ir=' + ir, root + 'tests/cxx/defaults.hpp'].join(' '));

assert(std.loadFile(tmp + name) !== null, 'no module written, output was:\n' + out);

const m = await import('../.tmp/' + name);
const defaults = fn => JSON.stringify((JSON.parse(std.loadFile(ir)).methods.find(x => x.name === fn) || {}).defaults);

await tests({
  'the IR keeps the literal defaults of the last arguments'() {
    eq('[3,-1]', defaults('df::mix'));
    eq('[1.5,true]', defaults('df::scaled'));
    eq('[4,"x",8]', defaults('df::tag'));
    eq(undefined, defaults('df::call'));
  },

  'a call leaves out the arguments that have a default'() {
    eq(1 + 30 - 100, m.df_mix(1));
    eq(1 + 50 - 100, m.df_mix(1, 5));
    eq(1 + 50 + 700, m.df_mix(1, 5, 7));
    eq(2 * 1.5 + 1, m.df_scaled(2));
    eq(2 * 3 + 0, m.df_scaled(2, 3, false));
  },

  'enum, string and shift defaults'() {
    eq(1 + 40 + 100 + 8000, m.df_tag(1));
    eq(1 + 10 + 200 + 8000, m.df_tag(1, 1, 'ab'));
  },

  'an argument without a literal default is still required'() {
    let err;

    try {
      m.df_call(1);
    } catch(e) {
      err = e;
    }

    assert(err instanceof TypeError, 'df_call(1) throws a TypeError');
    eq(11, m.df_call(1, 10));
  },

  'constructors and methods take defaults too'() {
    const a = new m.df_Acc();

    eq(5, a.total);
    eq(6, a.add());
    eq(16, a.add(10));
    a.delete();
    eq(9, new m.df_Acc(9).total);
  },

  '--describe and --jsdoc show the defaults'() {
    const file = tmp + 'test-gen-bindings-defaults.doc.gen.js';

    sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--describe', '--jsdoc', '--library=' + library, '-o', file, root + 'tests/cxx/defaults.hpp'].join(' '));

    const text = std.loadFile(file);

    assert(text.includes('@param {number} [b=3] - i32'), 'jsdoc marks b');
    assert(text.includes('@param {number} [c=-1] - i32'), 'jsdoc marks c');
    assert(text.includes('"defaults":[3,-1]') || text.includes('defaults:[3,-1]'), 'the signature lists the defaults');
  },
});
