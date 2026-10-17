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
sh('cc -shared -fPIC -o ' + tmp + 'libanonunion.so ' + root + 'tests/cxx/anonunion.c');

const header = root + 'tests/cxx/anonunion.h';
const library = realpath(tmp + 'libanonunion.so')[0];
const name = 'test-gen-bindings-names.gen.js';
const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--structs', '--library=' + library, '-o', tmp + name, header].join(' '));

assert(std.loadFile(tmp + name) !== null, 'no module written, output was:\n' + out);

const m = await import('../.tmp/' + name);
const floats = b => [...new Float32Array(b)].join();

await tests({
  'a struct and a function of the same name: the class gets _t'() {
    const text = std.loadFile(tmp + name);

    assert(text.includes('export class clash_t extends ArrayBuffer'), 'the class is clash_t');
    assert(text.includes("export const clash = "), 'the function keeps its name');
    eq(8, new m.clash_t().byteLength);
  },

  'a symbol the library lacks is a stub: the import works, the call throws'() {
    assert(typeof m.absent_function === 'function', 'absent_function is exported');

    try {
      m.absent_function(1);
    } catch(e) {
      assert(/symbol not found: absent_function/.test(e.message), e.message);
      return;
    }

    throw new Error('expected to throw');
  },

  'a union whose alternatives have one layout is passed and returned by value'() {
    const c = m.color_make(1, 2, 3, 4);

    eq('1,2,3,4', floats(c));
    eq(10, m.color_sum(c));
    eq('2,3,4,5', floats(m.color_lerp(c, m.color_make(3, 4, 5, 6), 0.5)));
  },

  'a struct holding such unions keeps the 4-byte alignment (76 bytes, not 80)'() {
    const p = m.paint_make(m.color_make(1, 2, 3, 4), m.color_make(10, 20, 30, 40), 5);

    eq(76, p.byteLength);
    eq(170, m.paint_sum(p));
  },

  'a union whose alternatives differ stays unbound, with the reason'() {
    assert(/anonymous struct or union/.test((out + std.loadFile(tmp + name)).split('\n').filter(l => l.includes('mixed_make')).join()), 'mixed_make is skipped');
    assert(m.mixed_make === undefined, 'mixed_make is not exported');
  },

  'bun, deno and node stub a missing symbol too'() {
    const full = realpath(tmp)[0];
    // a node with node:ffi (Node 26): the one on PATH, else the newest under nvm
    const node = ['node', ...sh('ls -d $HOME/.nvm/versions/node/v2[6-9]*/bin/node').split('\n').filter(Boolean).reverse()].find(n => /^OK/.test(sh(n + ' --no-warnings -e "import(\'node:ffi\').then(() => console.log(\'OK\'), () => {})"')));

    for(const [target, have, cmd] of [['bun', 'bun', 'bun'], ['deno', 'deno', 'deno run --allow-ffi --allow-read'], ['node', node ? 'true' : 'false', (node || 'node') + ' --no-warnings']]) {
      const file = full + '/test-gen-bindings-names.' + target + '.mjs';

      sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--target=' + target, '--library=' + library, '-o', file, header].join(' '));
      assert(std.loadFile(file) !== null, target + ': no module written');
      if(sh('command -v ' + have).trim() === '') continue;

      const probe = full + '/test-gen-bindings-names.' + target + '.probe.mjs';
      const f = std.open(probe, 'w');
      f.puts('import * as m from ' + JSON.stringify(file) + ';\ntry { m.absent_function(1); console.log("no throw"); } catch(e) { console.log(e.message); }\nconsole.log(typeof m.color_sum);\n');
      f.close();

      const r = sh(cmd + ' ' + probe);

      assert(/symbol not found: absent_function/.test(r), target + ': ' + r);
    }
  },
});
