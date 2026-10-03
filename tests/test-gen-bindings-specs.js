import * as std from 'std';
import { realpath } from 'os';
import { dlopen } from 'ffi';
import { tests, eq, assert } from './tinytest.js';
import { irToSpecs } from '../tools/gen-bindings/specs.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';

function sh(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();
  p.close();
  return out;
}

sh('mkdir -p ' + tmp);
sh('cc -shared -fPIC -o ' + tmp + 'libvars.so ' + root + 'tests/cxx/vars.c');
sh('cc -shared -fPIC -o ' + tmp + 'libbyvalue.so ' + root + 'tests/cxx/byvalue.c');

const gen = (name, lib, ...args) => {
  const file = tmp + 'test-gen-bindings-specs.' + name + '.json';

  sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--library=' + realpath(tmp + lib)[0], '--emit-specs=' + file, ...args].join(' '));
  return JSON.parse(std.loadFile(file));
};

const vars = gen('vars', 'libvars.so', root + 'tests/cxx/vars.h');
const byvalue = gen('byvalue', 'libbyvalue.so', root + 'tests/cxx/byvalue.h');
const genJS = (what, header) => {
  const file = tmp + 'test-gen-bindings-specs.' + what + '.js';

  sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--library=' + realpath(tmp + 'libvars.so')[0], '--emit-' + what + '=' + file, '--js', header].join(' '));
  return file;
};

genJS('specs', root + 'tests/cxx/vars.h');
genJS('ir', root + 'tests/cxx/vars.h');
const specsModule = await import('../.tmp/test-gen-bindings-specs.specs.js');
const irModule = await import('../.tmp/test-gen-bindings-specs.ir.js');
const names = list => list.map(o => o.name).sort().join();

await tests({
  'a function is { args, returns } with bare types'() {
    eq('{"args":[],"returns":"i32"}', JSON.stringify(vars.symbols.bump));
    eq('{"args":["cstring"],"returns":"i32","variadic":true}', JSON.stringify(vars.symbols.log_it));
    eq('{"args":[["f32","f32"]],"returns":["f32","f32"]}', JSON.stringify(vars.symbols.pt_swap));
  },

  'a variable is { type }, readonly when const, an array as nested element types'() {
    eq('{"type":"i32"}', JSON.stringify(vars.symbols.counter));
    eq('{"type":"f64","readonly":true}', JSON.stringify(vars.symbols.pi));
    eq('{"type":{"array":"f32","length":2}}', JSON.stringify(vars.symbols.origin));
    eq('{"type":{"array":{"array":"i32","length":2},"length":3}}', JSON.stringify(vars.symbols.grid));
    eq('{"type":{"array":"i8","length":16}}', JSON.stringify(vars.symbols.name_buf));
    eq('{"type":{"array":"i32","length":2000}}', JSON.stringify(vars.symbols.big));
    eq('{"type":"cstring"}', JSON.stringify(vars.symbols.greeting));
    eq('{"type":"void *"}', JSON.stringify(vars.symbols.handle));
  },

  'a constant with a value is not a symbol'() {
    eq('{"N":5}', JSON.stringify(vars.constants));
    assert(!('N' in vars.symbols), 'N has no symbol');
  },

  'what has no spec is omitted with the reason'() {
    eq('tail', names(vars.omitted));
    assert(/unknown size/.test(vars.omitted.find(o => o.name === 'tail').reason));
  },

  'the library is carried over'() {
    assert(vars.library.endsWith('libvars.so'), vars.library);
  },

  'the specs bind with dlopen() and work'() {
    const { symbols: s } = dlopen(vars.library, vars.symbols);

    eq(5, s.counter);
    eq(6, s.bump());
    eq(6, s.counter);
    s.counter = 9;
    eq(10, s.bump());
    eq(3.25, s.pi);
    eq('hello', String.fromCharCode(...new Uint8Array(s.name_buf).subarray(0, 5)));
    eq('1,2', [...new Float32Array(s.origin)].join());
    eq('1,2,3,4,5,6', [...new Int32Array(s.grid)].join());
    eq(8000, s.big.byteLength);
    eq('3,4', [...new Float32Array(s.where_)].join());
    eq('hi', s.greeting);
    eq(5, s.log_it('%d-%s', 'i32', 1234, 'cstring', ''));
    eq(null, s.handle);
    eq('2,1', [...new Float32Array(s.pt_swap(new Float32Array([1, 2]).buffer))].join());
  },

  'every function of the by-value fixture that the IR kept is bound'() {
    const { symbols: s } = dlopen(byvalue.library, byvalue.symbols);

    eq(Object.keys(byvalue.symbols).join(), Object.keys(s).join());
    assert('vec3_add' in s && 'wide_sum' in s && 'packed_make' in s, Object.keys(s).join());
    eq('1,2,3', [...new Float32Array(s.vec3_add(new Float32Array([1, 2, 3]).buffer, new Float32Array([0, 0, 0]).buffer))].join());
    eq(14, s.vec3_dot(new Float32Array([1, 2, 3]).buffer, new Float32Array([1, 2, 3]).buffer));
    assert(!('pk_make' in s) && !('un_make' in s), 'pk and un are omitted');
    assert(byvalue.omitted.some(o => o.name === 'pk_make'), 'pk_make is listed');
  },

  'a struct that is not laid out is omitted, never left as an unknown type'() {
    const ir = { skipped: [], methods: [{ name: 'f', kind: 'function', args: ['p: struct nope'], returns: 'void' }], fields: [], byValue: {} };
    const specs = irToSpecs(ir);

    eq('{}', JSON.stringify(specs.symbols));
    eq('f', names(specs.omitted));
    assert(/not laid out/.test(specs.omitted[0].reason), specs.omitted[0].reason);
  },

  'C++ functions and classes are omitted, an extern "C" function is not'() {
    const specs = gen('shapes', 'libvars.so', '--std=c++17', root + 'tests/cxx/shapes.hpp');

    eq('c_fn', Object.keys(specs.symbols).join());
    assert(specs.omitted.some(o => o.name === 'geo::Shape' && /C\+\+ class/.test(o.reason)), 'a class is listed');
    assert(specs.omitted.some(o => o.name === 'geo::add' && /C\+\+ linkage/.test(o.reason)), 'a function is listed');
  },

  '--js writes the specs as a module that holds the same data, empty arrays included'() {
    eq(JSON.stringify(vars), JSON.stringify(specsModule.default));
    eq('[]', JSON.stringify(specsModule.default.symbols.bump.args));
  },

  '--js writes the IR as a module that holds the same data'() {
    const file = tmp + 'test-gen-bindings-specs.ir.json';

    sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--emit-ir=' + file, root + 'tests/cxx/vars.h'].join(' '));
    eq(JSON.stringify(JSON.parse(std.loadFile(file))), JSON.stringify(irModule.default));
  },

  '--from-ir converts an IR file to the same specs, from JSON or from JS'() {
    const direct = std.loadFile(tmp + 'test-gen-bindings-specs.vars.json');

    for(const ir of [tmp + 'test-gen-bindings-specs.ir.json', tmp + 'test-gen-bindings-specs.ir.js']) {
      const out = tmp + 'test-gen-bindings-specs.from-ir.json';

      sh(['qjsm', root + 'tools/gen-bindings.js', '--from-ir=' + ir, '--library=' + realpath(tmp + 'libvars.so')[0], '--emit-specs=' + out].join(' '));
      eq(direct, std.loadFile(out), ir);
    }
  },

  'the IR is version 2: no defTypes, getters, setters or prototypeChain anywhere'() {
    const ir = JSON.parse(std.loadFile(tmp + 'test-gen-bindings-specs.ir.json'));
    const gone = ['defTypes', 'getters', 'setters', 'prototypeChain', 'name', 'type'];
    const walk = (v, top) => (v && typeof v == 'object' ? Object.entries(v).some(([k, x]) => (!top && ['defTypes', 'getters', 'setters', 'prototypeChain'].includes(k)) || (top && gone.includes(k)) || walk(x, false)) : false);

    eq(2, ir.version);
    eq('version,methods,fields,enums,structs,classes,typedefs,skipped,source,byValue', Object.keys(ir).join());
    assert(ir.methods.length > 0 && !walk(ir, true), 'a key that was removed is back');
  },

  '--from-ir refuses an IR of another version, and says how to make a new one'() {
    const old = tmp + 'test-gen-bindings-specs.v1.json';
    const ir = JSON.parse(std.loadFile(tmp + 'test-gen-bindings-specs.ir.json'));
    const f = std.open(old, 'w');

    ir.version = 1;
    f.puts(JSON.stringify(ir));
    f.close();

    const out = sh('qjsm ' + root + 'tools/gen-bindings.js --from-ir=' + old + ' --emit-specs=/dev/null');

    assert(/IR version 1, this is version 2; make it again with --emit-ir/.test(out), out);
  },

  '--from-ir with a file that is no IR says so'() {
    const bad = tmp + 'test-gen-bindings-specs.bad.js';
    const f = std.open(bad, 'w');

    f.puts('export default {;\n');
    f.close();
    assert(/cannot parse/.test(sh('qjsm ' + root + 'tools/gen-bindings.js --from-ir=' + bad + ' --emit-specs=/dev/null')));
  },

  '--js and --json need --emit-ir or --emit-specs'() {
    assert(/need --emit-ir/.test(sh('qjsm ' + root + 'tools/gen-bindings.js --js ' + root + 'tests/cxx/vars.h')));
    assert(/need --emit-ir/.test(sh('qjsm ' + root + 'tools/gen-bindings.js --json ' + root + 'tests/cxx/vars.h')));
    assert(/cannot be combined/.test(sh('qjsm ' + root + 'tools/gen-bindings.js --emit-specs --js --json ' + root + 'tests/cxx/vars.h')));
  },

  'a bare --emit-specs writes a JS module to stdout, --json forces JSON'() {
    const lib = realpath(tmp + 'libvars.so')[0];
    const run = (...a) => {
      const p = std.popen(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--library=' + lib, ...a, root + 'tests/cxx/vars.h', '2>/dev/null'].join(' '), 'r');
      const text = p.readAsString();

      p.close();
      return text;
    };
    const out = run('--emit-specs');
    const json = run('--emit-specs', '--json');

    assert(out.startsWith('export default {'), out.slice(0, 40));
    eq(JSON.stringify(vars), JSON.stringify(JSON.parse(json)));
    eq(JSON.stringify(vars), JSON.stringify(specsModule.default));
    assert(out.includes("bump: { args: [], returns: 'i32' }"), 'the module is the same data as --js writes');
  },

  '--emit-specs= needs a file name'() {
    assert(/needs a file name/.test(sh('qjsm ' + root + 'tools/gen-bindings.js --emit-specs= ' + root + 'tests/cxx/vars.h')));
  },

  '--emit-ir and --emit-specs cannot be combined'() {
    assert(/cannot be combined/.test(sh('qjsm ' + root + 'tools/gen-bindings.js --emit-ir=x --emit-specs=y ' + root + 'tests/cxx/vars.h')));
  },
});
