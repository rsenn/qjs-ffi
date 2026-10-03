import * as std from 'std';
import { tests, eq, assert } from './tinytest.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';

function run(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();

  p.close();
  return out.trim();
}

function script(name, text) {
  run('mkdir -p ' + tmp);

  const f = std.open(tmp + name, 'w');

  f.puts(text);
  f.close();
  return tmp + name;
}

const hooks = root + 'ffi-hooks.js';

await tests({
  "with the hook 'node:ffi' is node-ffi.js: dlopen() gives { lib, functions }"() {
    const file = script('test-ffi-hooks.node.mjs', `
      import { dlopen, DynamicLibrary } from 'node:ffi';
      const r = dlopen(null, { abs: { arguments: ['int32'], return: 'int32' } });
      console.log(Object.keys(r).join(), typeof DynamicLibrary, r.functions.abs(-4));
    `);

    eq('lib,functions,close function 4', run('qjsm -I ' + hooks + ' ' + file));
  },

  "without the hook 'node:ffi' is the bun-style ffi"() {
    const file = script('test-ffi-hooks.plain.mjs', `
      import { dlopen } from 'node:ffi';
      console.log(Object.keys(dlopen(null, { abs: { args: ['i32'], returns: 'i32' } })).join());
    `);

    eq('close', run('qjsm ' + file));
  },

  "with the hook 'bun:ffi' is ffi"() {
    const file = script('test-ffi-hooks.bun.mjs', `
      import { dlopen, CFunction } from 'bun:ffi';
      const { symbols, close } = dlopen(null, { abs: { args: ['i32'], returns: 'i32' } });
      console.log(symbols.abs(-9), typeof CFunction);
    `);

    eq('9 function', run('qjsm -I ' + hooks + ' ' + file));
  },

  'other specifiers are untouched, dynamic imports included'() {
    const file = script('test-ffi-hooks.other.mjs', `
      import * as std from 'std';
      const ffi = await import('ffi');
      const node = await import('node:ffi');
      console.log(typeof ffi.dlopen, typeof node.DynamicLibrary, typeof std.puts);
    `);

    eq('function function function', run('qjsm -I ' + hooks + ' ' + file));
  },
});
