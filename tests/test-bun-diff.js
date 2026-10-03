import * as std from 'std';
import { tests, eq, assert } from './tinytest.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const dir = root + 'tests/bun-diff/';

function run(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();

  p.close();
  return out;
}

/* { case name: result }, from "name: result" lines, in order. */
function cases(text) {
  return new Map(text.split('\n').filter(l => /^[^:]+: /.test(l) || /^[^:]+:$/.test(l)).map(l => [l.slice(0, l.indexOf(': ') >= 0 ? l.indexOf(': ') : l.length - 1), l.slice(l.indexOf(': ') + 2)]));
}

const bun = run('command -v bun').trim();

if(!bun) {
  console.log('bun is not installed, skipping the comparison');
  await tests({ 'bun is not installed, nothing to compare'() {} });
} else {
  const theirs = cases(run(bun + ' ' + dir + 'probe.mjs'));
  const ours = cases(run('qjsm -I ' + root + 'ffi-hooks.js ' + dir + 'probe.mjs'));
  const known = new Map(std.loadFile(dir + 'known-differences.txt').split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(' | ')));
  const differing = [...theirs.keys()].filter(k => theirs.get(k) !== ours.get(k));

  await tests({
    'both runs gave the same cases'() {
      assert(theirs.size > 50, 'bun gave ' + theirs.size + ' cases');
      eq([...theirs.keys()].join('|'), [...ours.keys()].join('|'));
    },

    'every difference from bun:ffi is a known one'() {
      const unexpected = differing.filter(k => !known.has(k)).map(k => k + ': bun gives "' + theirs.get(k) + '", we give "' + ours.get(k) + '"');

      assert(unexpected.length === 0, 'new differences:\n  ' + unexpected.join('\n  '));
    },

    'every known difference still differs: drop the entry once it is fixed'() {
      const stale = [...known.keys()].filter(k => !differing.includes(k));

      assert(stale.length === 0, 'no longer different: ' + stale.join(', '));
    },
  });
}
