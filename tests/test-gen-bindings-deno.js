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
sh('cc -shared -fPIC -o ' + tmp + 'libgendeno.so ' + root + 'tests/cxx/structs.c');
sh('cc -shared -fPIC -o ' + tmp + 'libgendenovars.so ' + root + 'tests/cxx/vars.c');
sh('cc -shared -fPIC -o ' + tmp + 'libgendenobyvalue.so ' + root + 'tests/cxx/byvalue.c');
sh('c++ -shared -fPIC -o ' + tmp + 'libgendenoshapes.so ' + root + 'tests/cxx/shapes.cpp');

const haveDeno = sh('command -v deno').trim() !== '';
const lib = realpath(tmp + 'libgendeno.so')[0];
const vars = realpath(tmp + 'libgendenovars.so')[0];
const byvalue = realpath(tmp + 'libgendenobyvalue.so')[0];
const shapes = realpath(tmp + 'libgendenoshapes.so')[0];

/* the module generated for `target`, as an absolute path. */
function gen(name, target, library, header, ...args) {
  const file = realpath(tmp)[0] + '/test-gen-bindings-deno.' + name + '.' + target + '.mjs';

  sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--structs', '--target=' + target, '--library=' + library, '-o', file, ...args, root + 'tests/cxx/' + header].join(' '));
  return file;
}

/* the same probe under qjsm (target qjs, with --class-types so a returned
 * pointer is the class, as under deno) and deno (target deno): one JSON line. */
function probe(name, header, library, body, ...args) {
  const run = (target, runner) => {
    const mod = gen(name, target, library, header, ...(target === 'qjs' ? ['--class-types'] : []), ...args);
    const file = mod.replace(/\.mjs$/, '.probe.mjs');

    write(file, 'import * as m from ' + JSON.stringify(mod) + ';\n' + body + '\n');
    return sh(runner + ' ' + file).trim();
  };

  return { qjs: run('qjs', 'qjsm'), deno: haveDeno ? run('deno', 'deno run --allow-ffi --allow-read') : null };
}

await tests({
  'a struct fills, reads and converts the same under deno as under qjsm'() {
    const r = probe(
      'sample',
      'structs.h',
      lib,
      `const s = new m.sample(); m.sample_fill(s);
console.log(JSON.stringify({ i8: s.i8, u8: s.u8, i16: s.i16, u16: s.u16, i32: s.i32, u32: s.u32, i64: String(s.i64), u64: String(s.u64), f: s.f, d: s.d, flag: s.flag, ptr: s.ptr_, color: s.color, ua: s.ua, sb: s.sb, big: String(s.big), arr: s.arr.join(), t0: s.text[0], mat3: s.mat[3], ina: s.in.a, inb: s.in.b, len: String(s.len), slice: s.slice_, check: m.sample_check(s) }));`,
    );

    assert(r.qjs.startsWith('{'), 'qjsm output: ' + r.qjs);
    if(haveDeno) eq(r.qjs, r.deno);
  },

  'a returned struct pointer is the class, and passes back as an argument'() {
    const r = probe('new', 'structs.h', lib, `const s = m.sample_new(); console.log(JSON.stringify([s instanceof m.sample, s instanceof ArrayBuffer, s.byteLength])); m.sample_free(s);`);

    assert(r.qjs.startsWith('[true,true,'), 'qjsm output: ' + r.qjs);
    if(haveDeno) eq(r.qjs, r.deno);
  },

  'extern variables read and write through the module'() {
    const r = probe('vars', 'vars.h', vars, `m.counter.value = 41; console.log(JSON.stringify([m.bump(), m.counter.value, m.pi.value]));`);

    assert(r.qjs.startsWith('['), 'qjsm output: ' + r.qjs);
    if(haveDeno) eq(r.qjs, r.deno);
  },

  'a C++ class constructs, calls a virtual method and deletes the same under deno'() {
    const r = probe('shapes', 'shapes.hpp', shapes, `const s = new m.geo_Shape(3, 2.5); console.log(JSON.stringify([s.area(), s instanceof m.geo_Base, s.constructor.name])); s.delete();`, '--c++');

    assert(r.qjs.startsWith('['), 'qjsm output: ' + r.qjs);
    if(haveDeno) eq(r.qjs, r.deno);
  },

  'a struct passes and returns by value, small and large, the same under deno'() {
    const r = probe(
      'byvalue',
      'byvalue.h',
      byvalue,
      `const v = (x, y, z) => { const a = new m.vec3(); a.x = x; a.y = y; a.z = z; return a; };
const r = m.vec3_add(v(1, 2, 3), v(4, 5, 6));
const w = m.wide_make(1n, 2n, 3n);
console.log(JSON.stringify([r instanceof m.vec3, r.x, r.y, r.z, m.vec3_dot(v(1, 2, 3), v(4, 5, 6)), m.mix_sum(m.mix_make(3, 1.5)), String(m.big_sum(m.big_make(10n))), String(m.wide_sum(w)), m.seg_len2(m.seg_make(v(0, 0, 0), v(3, 4, 0)))]));`,
    );

    assert(r.qjs.startsWith('[true,5,7,9,'), 'qjsm output: ' + r.qjs);
    if(haveDeno) eq(r.qjs, r.deno);
  },

  'variadics are skipped for deno, with the reason; by-value functions are kept'() {
    const file = gen('skip', 'deno', vars, 'vars.h');
    const js = std.loadFile(file);

    assert(!js.includes("from 'ffi'") && !js.includes('bun:ffi'), 'imports a module');
    assert(js.includes('Deno.dlopen'), 'no Deno.dlopen');
    assert(/log_it: a variadic function is not supported by deno/.test(js), 'no skip note for log_it');
    assert(/export const pt_swap = /.test(js), 'pt_swap is missing');
  },

  '--target=deno needs --library and refuses --finalize and --class-types'() {
    const run = (...a) => sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--target=deno', ...a, root + 'tests/cxx/vars.h'].join(' '));

    assert(/needs --library/.test(run()), 'no --library message');
    assert(/--finalize/.test(run('--library=x.so', '--finalize')), 'no --finalize message');
    assert(/--class-types/.test(run('--library=x.so', '--class-types')), 'no --class-types message');
    assert(/--target must be/.test(run('--target=nope')), 'no target message');
  },
});
