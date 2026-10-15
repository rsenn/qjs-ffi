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
sh('clang++ -shared -fPIC -std=c++17 -o ' + tmp + 'libcxxwrap.so ' + root + 'tests/cxx/cxxwrap.cpp');

const library = realpath(tmp + 'libcxxwrap.so')[0];
const name = 'test-gen-bindings-cxxwrap.gen.js';
const header = root + 'tests/cxx/cxxwrap.hpp';
const gen = (...args) => sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--library=' + library, ...args, header].join(' '));
const flags = ['--out=cw::divmod:quotient', '--out=cw::divmod:remainder', '--out=cw::bounds:lo', '--out=cw::bounds:hi', '--out=cw::Stats::mean:out', '--out=cw::Stats::count:out', '--out=cw::Stats::pair:first', '--out=cw::Stats::pair:second', '--owned-return=cw::dup_name:free_name', '--owned-return=cw::Stats::label'];
const out = gen(...flags, '-o', tmp + name);

assert(std.loadFile(tmp + name) !== null, 'no module written, output was:\n' + out);

const m = await import('../.tmp/' + name);

await tests({
  'a C++ free function: out-parameters become the result, a status throws'() {
    eq('3,2', m.cw_divmod(17, 5).join());
    eq('2,9', m.cw_bounds(9, 2).join());

    try {
      m.cw_divmod(1, 0);
    } catch(e) {
      eq(1, e.code);
      assert(/cw::divmod failed: 1/.test(e.message), e.message);
      return;
    }

    throw new Error('expected to throw');
  },

  'a method: this stays, the out-parameter goes'() {
    const s = new m.cw_Stats();

    eq(5, s.mean(2));
    s.delete();
  },

  'overloads: only the one with the parameter is wrapped, and told apart by what is left'() {
    const s = new m.cw_Stats();

    eq(8, s.count(7));
    eq(42, s.count(7, 6));
    s.delete();
  },

  'a static method with two outs'() {
    eq('4,8', m.cw_Stats.pair(4).join());
  },

  'owned returns of a function (own destructor) and of a method (libc free)'() {
    eq('second', m.cw_dup_name(1));

    const s = new m.cw_Stats();

    eq('stats', s.label());
    s.delete();
  },

  'a name or a parameter that does not exist stops the run'() {
    const file = tmp + 'test-gen-bindings-cxxwrap.bad.gen.js';

    sh('rm -f ' + file);

    const msg = gen('--out=cw::Stats::mean:nope', '-o', file);

    assert(/no overload has the parameter/.test(msg), msg);
    assert(std.loadFile(file) === null, 'nothing written');
  },
});
