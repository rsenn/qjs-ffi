import * as std from 'std';
import { dlopen } from 'ffi';
import { tests, eq, assert } from './tinytest.js';
import { scanDefines } from '../tools/gen-bindings/defines.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';

function sh(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();
  p.close();
  return out;
}

sh('mkdir -p ' + tmp);

const header = root + 'tests/cxx/consts.h';
const gen = (...args) => sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', ...args, header].join(' '));
const specsFile = tmp + 'test-gen-bindings-consts.specs.json';

gen('--emit-specs=' + specsFile);

const specs = JSON.parse(std.loadFile(specsFile));
const byName = Object.fromEntries(scanDefines(std.loadFile(header)).map(d => [d.name, d]));

await tests({
  'scanDefines evaluates literals, other defines and operators'() {
    eq(4096, byName.LEN_MAX.value);
    eq(2048, byName.LEN_HALF.value);
    eq(3, byName.FLAG_BOTH.value);
    eq('consts', byName.NAME.value);
    eq('consts', byName.NAME2.value);
    eq(0.25, byName.RATIO.value);
    eq(-4096, byName.NEG.value);
    eq(97, byName.LETTER.value);
    eq(3, byName.LONG_LINE.value);
  },

  'scanDefines leaves out macros with arguments, guards, casts and _names'() {
    for(const n of ['SQUARE', 'CONSTS_H', 'CAST', '_HIDDEN', 'EMPTY']) assert(!(n in byName), n);
  },

  'a 64-bit value is kept exact as decimal text'() {
    eq('18446744073709551615', byName.MASK.value);
    assert(byName.MASK.big);
  },

  'the specs hold { value } for a #define, an anonymous enum constant'() {
    eq('{"value":4096}', JSON.stringify(specs.symbols.LEN_MAX));
    eq('{"value":"consts"}', JSON.stringify(specs.symbols.NAME));
    eq('{"value":10}', JSON.stringify(specs.symbols.ANON_A));
    assert(!('constants' in specs), 'the constants key is gone');
  },

  'a tagged enum is an { enum, type } entry'() {
    eq('{"enum":{"RED":0,"GREEN":1,"BLUE":4},"type":"i32"}', JSON.stringify(specs.symbols.color));
    eq('u32', specs.symbols.big.type);
  },

  'a #define needing a bigint is omitted with the reason'() {
    assert(!('MASK' in specs.symbols));
    assert(specs.omitted.some(o => o.name === 'MASK' && /bigint/.test(o.reason)));
  },

  'the specs go straight into dlopen as constants'() {
    const { symbols } = dlopen(null, Object.fromEntries(Object.entries(specs.symbols).filter(([, s]) => 'value' in s || 'enum' in s)));

    eq(4096, symbols.LEN_MAX);
    eq(4, symbols.color.BLUE);
    eq('BLUE', symbols.color[4]);
    eq(0x80000000, symbols.big.HUGE_ONE);
  },

  'the module exports the defines and every enum constant, used or not'() {
    const out = tmp + 'test-gen-bindings-consts.mjs';

    gen('--output=' + out);

    const text = std.loadFile(out);

    assert(/export const LEN_MAX = 4096;/.test(text), 'LEN_MAX');
    assert(/export const NAME = 'consts';/.test(text), 'NAME');
    assert(/export const MASK = 18446744073709551615n;/.test(text), 'MASK');
    assert(/export const BLUE = 4;/.test(text), 'BLUE');
    assert(/export const ANON_B = 20;/.test(text), 'ANON_B');
    assert(!/SQUARE|_HIDDEN/.test(text.replace(/\/\/.*$/gm, '')), 'macros with arguments');
  },
});
