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

function write(path, text) {
  const f = std.open(path, 'w');
  f.puts(text);
  f.close();
}

sh('mkdir -p ' + tmp);
sh('cc -shared -fPIC -o ' + tmp + 'libgenbun.so ' + root + 'tests/cxx/structs.c');
sh('cc -shared -fPIC -o ' + tmp + 'libgenbunvars.so ' + root + 'tests/cxx/vars.c');
sh('c++ -shared -fPIC -o ' + tmp + 'libgenbunshapes.so ' + root + 'tests/cxx/shapes.cpp');

const haveBun = sh('command -v bun').trim() !== '';
const lib = realpath(tmp + 'libgenbun.so')[0];
const vars = realpath(tmp + 'libgenbunvars.so')[0];
const shapes = realpath(tmp + 'libgenbunshapes.so')[0];

/* the module generated for `target`, as an absolute path. */
function gen(name, target, library, header, ...args) {
  const file = realpath(tmp)[0] + '/test-gen-bindings-bun.' + name + '.' + target + '.mjs';

  sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--structs', '--target=' + target, '--library=' + library, '-o', file, ...args, root + 'tests/cxx/' + header].join(' '));
  return file;
}

/* the same probe under qjsm (target qjs, with --class-types so a returned
 * pointer is the class, as under bun) and bun (target bun): one JSON line. */
function probe(name, header, library, body, ...args) {
  const run = (target, runner) => {
    const mod = gen(name, target, library, header, ...(target === 'qjs' ? ['--class-types'] : []), ...args);
    const file = mod.replace(/\.mjs$/, '.probe.mjs');

    write(file, 'import * as m from ' + JSON.stringify(mod) + ';\n' + body + '\n');
    return sh(runner + ' ' + file).trim();
  };

  return { qjs: run('qjs', 'qjsm'), bun: haveBun ? run('bun', 'bun') : null };
}

await tests({
  'a struct fills, reads and converts the same under bun as under qjsm'() {
    const r = probe(
      'sample',
      'structs.h',
      lib,
      `const s = new m.sample(); m.sample_fill(s);
console.log(JSON.stringify({ i8: s.i8, u8: s.u8, i16: s.i16, u16: s.u16, i32: s.i32, u32: s.u32, i64: String(s.i64), u64: String(s.u64), f: s.f, d: s.d, flag: s.flag, ptr: s.ptr_, color: s.color, ua: s.ua, sb: s.sb, big: String(s.big), arr: s.arr.join(), t0: s.text[0], mat3: s.mat[3], ina: s.in.a, inb: s.in.b, len: String(s.len), slice: s.slice_, check: m.sample_check(s) }));`,
    );

    assert(r.qjs.startsWith('{'), 'qjsm output: ' + r.qjs);
    if(haveBun) eq(r.qjs, r.bun);
  },

  'a returned struct pointer is the class, and passes back as an argument'() {
    const r = probe('new', 'structs.h', lib, `const s = m.sample_new(); console.log(JSON.stringify([s instanceof m.sample, s instanceof ArrayBuffer, s.byteLength])); m.sample_free(s);`);

    assert(r.qjs.startsWith('[true,true,'), 'qjsm output: ' + r.qjs);
    if(haveBun) eq(r.qjs, r.bun);
  },

  'extern variables read and write through the module'() {
    const r = probe('vars', 'vars.h', vars, `m.counter.value = 41; console.log(JSON.stringify([m.bump(), m.counter.value, m.pi.value]));`);

    assert(r.qjs.startsWith('['), 'qjsm output: ' + r.qjs);
    if(haveBun) eq(r.qjs, r.bun);
  },

  'a C++ class constructs, calls a virtual method and deletes the same under bun'() {
    const r = probe('shapes', 'shapes.hpp', shapes, `const s = new m.geo_Shape(3, 2.5); console.log(JSON.stringify([s.area(), s instanceof m.geo_Base, s.constructor.name])); s.delete();`, '--c++');

    assert(r.qjs.startsWith('['), 'qjsm output: ' + r.qjs);
    if(haveBun) eq(r.qjs, r.bun);
  },

  'by-value functions and variadics are skipped for bun, with the reason'() {
    const file = gen('skip', 'bun', vars, 'vars.h');
    const js = std.loadFile(file);

    assert(js.includes("from 'bun:ffi'"), 'no bun:ffi import');
    assert(!js.includes("from 'ffi'"), 'still imports ffi');
    assert(/pt_swap: a struct passed or returned by value is not supported by bun:ffi/.test(js), 'no skip note for pt_swap');
    assert(/log_it: a variadic function is not supported by bun:ffi/.test(js), 'no skip note for log_it');
  },

  '--target=bun needs --library and refuses --finalize and --class-types'() {
    const run = (...a) => sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--target=bun', ...a, root + 'tests/cxx/vars.h'].join(' '));

    assert(/needs --library/.test(run()), 'no --library message');
    assert(/--finalize/.test(run('--library=x.so', '--finalize')), 'no --finalize message');
    assert(/--class-types/.test(run('--library=x.so', '--class-types')), 'no --class-types message');
    assert(/--target must be/.test(run('--target=nope')), 'no target message');
  },
});
