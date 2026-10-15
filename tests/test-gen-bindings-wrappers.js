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
sh('cc -shared -fPIC -o ' + tmp + 'libwrappers.so ' + root + 'tests/cxx/wrappers.c');

const header = root + 'tests/cxx/wrappers.h';
const library = realpath(tmp + 'libwrappers.so')[0];
const name = 'test-gen-bindings-wrappers.gen.js';
const flags = ['--cstring=thing_name', '--handle=thing:thing_free', '--out=thing_make:out', '--out=minmax:lo', '--out=minmax:hi', '--out=divmod:quotient', '--out=divmod:remainder', '--out=half:out', '--out=label:name', '--owned-return=name_alloc:name_free', '--owned-return=name_libc'];
const gen = (...args) => sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--library=' + library, ...args, header].join(' '));
const out = gen(...flags, '-o', tmp + name);

assert(std.loadFile(tmp + name) !== null, 'no module written, output was:\n' + out);

const m = await import('../.tmp/' + name);
const tick = () => new Promise(resolve => os.setTimeout(resolve, 20));

await tests({
  '--cstring: an unsigned char * return is a string'() {
    eq('first', m.thing_name(0));
    eq('second', m.thing_name(1));
  },

  '--out: the wrapper makes the cells and returns what C stored'() {
    eq('3,5', m.minmax(5, 3).join());
    eq('3,2', m.divmod(17, 5).join());
    eq(2.5, m.half(5));
    eq('second', m.label(1));
    eq(2, m.minmax.length, 'the out parameters are not parameters');
  },

  '--out: a nonzero status return throws, with the code'() {
    try {
      m.divmod(1, 0);
    } catch(e) {
      eq(1, e.code);
      assert(/divmod failed: 1/.test(e.message), e.message);
      return;
    }

    throw new Error('expected to throw');
  },

  '--owned-return: the string is copied and the memory freed (by name, and by libc free)'() {
    eq('first', m.name_alloc(0));
    eq(0n, m.names_live());
    eq('second', m.name_libc(1));
  },

  '--handle: an out-parameter and a return become closable objects'() {
    const a = m.thing_make(7);
    const b = m.thing_new(8);

    eq(2n, m.things_live());
    eq(7, m.thing_value(a));
    eq(8, m.thing_value(b));
    assert(!a.closed, 'open');
    eq(0, a.close());
    assert(a.closed, 'closed');
    eq(undefined, a.close(), 'closing twice does nothing');
    eq(1n, m.things_live());
    m.thing_free(b);
    assert(b.closed, 'the destructor function closes the object');
    eq(0n, m.things_live());
  },

  '--handle: a failing status still closes the object the C function made'() {
    try {
      m.thing_make(-1);
    } catch(e) {
      eq(0n, m.things_live());
      return;
    }

    throw new Error('expected to throw');
  },

  '--handle: the garbage collector closes an object nobody closed'() {
    (() => m.thing_new(1))();
    eq(1n, m.things_live());

    return (async () => {
      for(let i = 0; i < 20 && m.things_live() !== 0n; i++) {
        std.gc();
        await tick();
      }

      eq(0n, m.things_live());
    })();
  },

  'the wrappers work with --describe and --jsdoc'() {
    const file = tmp + 'test-gen-bindings-wrappers.describe.js';
    const text = gen(...flags, '--describe', '--jsdoc', '-o', file);

    return import('../.tmp/test-gen-bindings-wrappers.describe.js').then(d => {
      eq('3,5', d.minmax(5, 3).join());
      eq('a: i32,b: i32', d.minmax[Symbol.for('describe')][0].params.join());
    });
  },

  'unknown names and unusable parameters are reported and nothing is written'() {
    const file = tmp + 'test-gen-bindings-wrappers.bad.js';
    const bad = (...args) => {
      sh('rm -f ' + file);
      const msg = gen(...args, '-o', file);

      assert(std.loadFile(file) === null, 'nothing is written: ' + args);
      return msg;
    };

    assert(/--out=nope: no such function/.test(bad('--out=nope:x')), '--out=nope');
    assert(/no function "no_close" to close it with/.test(bad('--handle=thing:no_close')), '--handle');
    assert(/half: --out parameter x is "f64", not a pointer/.test(bad('--out=half:x')), 'not a pointer');
    assert(/thing_value: --out needs a void or integer status return|has no cell type/.test(bad('--out=thing_value:t')), 'no cell type');
    assert(/need --target=qjs/.test(bad('--target=deno', '--out=half:out')), 'target');
  },

  '--out-auto: a handle out-parameter and an out* or pp* parameter, nothing else'() {
    const auto = 'test-gen-bindings-wrappers.auto.gen.js';

    gen('--handle=thing:thing_free', '--out-auto', '-o', tmp + auto);

    return import('../.tmp/' + auto).then(a => {
      const t = a.thing_make(7);

      eq(7, a.thing_value(t));
      a.thing_free(t);
      eq(2.5, a.half(5));
      eq(4, a.minmax.length, 'lo and hi are not named like out-parameters');
      eq(4, a.divmod.length);
    });
  },

  '--out-auto needs --target=qjs'() {
    assert(/need --target=qjs/.test(gen('--target=bun', '--out-auto', '-o', tmp + 'x.js')), 'refused');
  },
});
