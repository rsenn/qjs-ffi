import * as std from 'std';
import { realpath, remove } from 'os';
import { tests, eq, assert } from './tinytest.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const tmp = root + '.tmp/';

function sh(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();
  p.close();
  return out;
}

function genIR(...args) {
  const file = tmp + 'test-gen-bindings-cxx.ir.json';
  const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--emit-ir=' + file, ...args].join(' '));
  const text = std.loadFile(file);

  assert(text !== null, 'no IR written, output was:\n' + out);
  return JSON.parse(text);
}

const find = (list, name) => list.find(x => x.name === name);

// tinytest's eq() is ===, which never holds for arrays/objects.
const same = (a, b) => eq(JSON.stringify(a), JSON.stringify(b));

sh('mkdir -p ' + tmp);
sh('clang++ -shared -fPIC -std=c++17 -o ' + tmp + 'libshapes.so ' + root + 'tests/cxx/shapes.cpp');

const exported = new Set(
  sh('nm -D --defined-only ' + tmp + 'libshapes.so')
    .split('\n')
    .map(l => l.trim().split(/\s+/)[2])
    .filter(Boolean),
);

const ir = genIR('--std=c++17', root + 'tests/cxx/shapes.hpp');
const shape = find(ir.classes, 'geo::Shape');
const base = find(ir.classes, 'geo::Base');

let generation = 0;

/* Generates a module for the fixture, imports it and runs fn(module); each
 * call gets its own file since a module cannot be re-imported by URL. */
async function withGenerated(args, fn) {
  const name = 'test-gen-bindings-cxx.gen' + generation++ + '.js';
  const lib = realpath(tmp + 'libshapes.so')[0];
  const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', ...args, '--library=' + lib, '-o', tmp + name, root + 'tests/cxx/shapes.hpp'].join(' '));

  assert(std.loadFile(tmp + name) !== null, 'no module written, output was:\n' + out);
  return fn(await import('../.tmp/' + name));
}

await tests({
  'every mangledName in the IR is exported by the compiled library'() {
    const names = [];

    for(const c of ir.classes) {
      // A pure virtual has no definition, so no symbol: it is only callable through the vtable.
      names.push(...c.constructors.map(m => m.mangledName), ...c.methods.filter(m => !m.pure).map(m => m.mangledName));
      if(c.destructor) names.push(c.destructor.mangledName);
      names.push(...c.fields.filter(f => f.static && f.value === undefined).map(f => f.mangledName));
    }

    assert(names.length >= 8, 'too few symbols checked: ' + names.length);
    for(const n of names) assert(exported.has(n), n + ' is not exported');
  },

  'classes are found by qualified name, templates and std are not'() {
    same(['geo::Base', 'geo::Shape'], ir.classes.map(c => c.name).sort());
  },

  'only public members are listed'() {
    same(['area', 'scale', 'setKind', 'count'], shape.methods.map(m => m.name));
    same(['width', 'MAX'], shape.fields.map(f => f.name));
    same(['id'], base.fields.map(f => f.name));
  },

  'private and protected fields still count for field offsets'() {
    eq(24, shape.size);
    eq(20, find(shape.fields, 'width').offset);
    eq(8, find(base.fields, 'id').offset);
  },

  'method flags: static, const, virtual, pure, this not in params'() {
    const area = find(shape.methods, 'area');
    eq(true, area.const);
    eq(false, area.static);
    same([], area.args);
    eq(undefined, area.arity);
    eq(true, find(shape.methods, 'count').static);
    eq(true, find(base.methods, 'area').pure);
    eq(true, base.abstract);
    eq(true, base.polymorphic);
  },

  'constructors keep each overload (none for an abstract class); references become typed pointers'() {
    same(['w: i32', 'h: f64'], shape.constructors[0].args);
    same(['other: Shape *'], shape.constructors[1].args);
    eq('_ZN3geo5ShapeC1Eid', shape.constructors[0].mangledName);
    eq(undefined, shape.constructors[0].returns);
    eq(0, base.constructors.length);
  },

  'destructor and bases are recorded'() {
    same({ mangledName: '_ZN3geo4BaseD1Ev', virtual: true, vtableSlot: 0 }, base.destructor);
    same([{ name: 'geo::Base', access: 'public' }], shape.bases);
  },

  'enum-typed parameters resolve through the qualified enum name'() {
    const setKind = find(shape.methods, 'setKind');
    same(['k: i32'], setKind.args);
    eq(1, setKind.enums.length);
  },

  'plain structs stay in structs, nested ones are qualified'() {
    same(['geo::Point', 'geo::Shape::Inner'], ir.structs.map(s => s.name));
  },

  'C++ free functions are listed by qualified name with their mangledName, overloads separately'() {
    same(['geo::free_fn', 'geo::add', 'geo::add', 'c_fn'], ir.methods.map(m => m.name));
    same(['_ZN3geo7free_fnEi', '_ZN3geo3addEii', '_ZN3geo3addEdd', undefined], ir.methods.map(m => m.mangledName));
    same([], ir.skipped);
  },

  'a .h header needs --c++'() {
    const h = tmp + 'test-gen-bindings-cxx.h';
    const f = std.open(h, 'w');
    f.puts('class K { public: int get() const; int v; };\n');
    f.close();

    eq(0, genIR(h).classes.length);
    same(['K'], genIR('--c++', h).classes.map(c => c.name));
  },

  'JS generation from a C++ IR does not break'() {
    genIR('--std=c++17', root + 'tests/cxx/shapes.hpp');
    const file = tmp + 'test-gen-bindings-cxx.ir.json';
    const out = sh('qjsm ' + root + 'tools/gen-bindings.js --from-ir=' + file + ' --structs');

    assert(/export const c_fn = /.test(out), out);
    assert(/export class geo_Point extends ArrayBuffer/.test(out), out);
  },

  'structs and classes have the filter-struct.json shape'() {
    for(const e of [...ir.structs, ...ir.classes]) {
      assert(['struct', 'union', 'class'].includes(e.type), e.name + ': type is the tag, got ' + e.type);
      eq(undefined, e.kind);
      same(['name', 'type', 'size', 'align', 'line'], Object.keys(e).slice(0, 5));
      assert(Array.isArray(e.methods) && Array.isArray(e.fields), e.name + ' lacks a member list');
      eq(undefined, e.getters);
      eq(undefined, e.setters);
      eq(undefined, e.prototypeChain);
    }
    same([], find(ir.structs, 'geo::Point').methods);
  },

  'every field has a byte offset and a byte size'() {
    const point = find(ir.structs, 'geo::Point');

    same([{ offset: 0, size: 4 }, { offset: 4, size: 4 }], point.fields.map(f => ({ offset: f.offset, size: f.size })));
    eq(4, find(shape.fields, 'width').size);
    eq(4, find(base.fields, 'id').size);
  },

  'field sizes cover arrays, pointers, nested structs and references; bitfields have bits instead'() {
    const types = genIR('--std=c++17', root + 'tests/cxx/types.hpp');
    const rec = find(types.structs, 'ty::Rec');
    const size = n => find(rec.fields, n).size;
    const widget = find(types.structs, 'ty::Widget');

    same([1, 8, 12, 8, 5, 8], ['tag', 'd', 'arr', 'next', 'bytes', 'pair'].map(size));
    same([0, 8, 16, 32, 40, 48], ['tag', 'd', 'arr', 'next', 'bytes', 'pair'].map(n => find(rec.fields, n).offset));

    const flag = find(rec.fields, 'flag');
    eq(3, flag.bits);
    eq(4, flag.size);
    eq(56, flag.offset);
    eq(0, flag.bitOffset);

    eq(8, find(widget.fields, 'ref').size);
    eq(undefined, find(widget.fields, 'priv'));
    eq(32, widget.size);
  },

  'C++ typedef and using aliases are parsed, qualified, with size'() {
    const types = genIR('--std=c++17', root + 'tests/cxx/types.hpp');
    const byName = Object.fromEntries(types.typedefs.map(t => [t.name, t]));

    same(['ty::Widget::id_t', 'ty::byte_t', 'ty::cb_t', 'ty::pair_t', 'ty::word_t'], Object.keys(byName).sort());
    same({ name: 'ty::byte_t', kind: 'typedef', type: 'u8', cType: 'unsigned char', size: 1 }, byName['ty::byte_t']);
    same({ name: 'ty::word_t', kind: 'using', type: 'u16', cType: 'unsigned short', size: 2 }, byName['ty::word_t']);
    eq('function', byName['ty::cb_t'].type);
    eq(8, byName['ty::cb_t'].size);
    eq('i64', byName['ty::Widget::id_t'].type);
    eq('using', byName['ty::Widget::id_t'].kind);
  },

  'a typedef of an anonymous C++ struct names the struct it creates'() {
    const types = genIR('--std=c++17', root + 'tests/cxx/types.hpp');
    const alias = find(types.typedefs, 'ty::pair_t');

    eq('ty::pair_t', alias.record);
    eq(8, alias.size);
    same(['ty::pair_t'], find(types.structs, 'ty::pair_t').typedefs);
    same([4, 1], find(types.structs, 'ty::pair_t').fields.map(f => f.size));
  },

  'C typedefs: struct, function pointer, enum, pointer; flexible array has no size'() {
    const types = genIR(root + 'tests/cxx/types.h');
    const byName = Object.fromEntries(types.typedefs.map(t => [t.name, t]));

    eq('point', byName.point_t.record);
    eq(8, byName.point_t.size);
    eq('function', byName.cmp_t.type);
    eq('i32', byName.color_t.type);
    eq('point_t *', byName.point_ptr.type);
    eq(8, byName.point_ptr.size);

    const tail = find(types.structs, 'tail');
    eq(4, find(tail.fields, 'n').size);
    eq(undefined, find(tail.fields, 'data').size);
  },

  'fields keep the C type as written next to the ffi mapping'() {
    const rec = find(genIR('--std=c++17', root + 'tests/cxx/types.hpp').structs, 'ty::Rec');

    same(['char', 'i8'], [find(rec.fields, 'tag').type, find(rec.fields, 'tag').ffi]);
    same(['int[3]', 'int[3]'], [find(rec.fields, 'arr').type, find(rec.fields, 'arr').ffi]);
    same(['Rec *', 'Rec *'], [find(rec.fields, 'next').type, find(rec.fields, 'next').ffi]);
  },

  'structs and unions carry their declaration line'() {
    const layout = genIR(root + 'tests/cxx/layout.h');

    eq(5, find(layout.structs, 'holder').line);
    eq(15, find(layout.structs, 'num').line);
    eq('union', find(layout.structs, 'num').type);
  },

  'a member of incomplete type leaves the rest of the layout null, like filter_in'() {
    const holder = find(genIR(root + 'tests/cxx/layout.h').structs, 'holder');
    const at = n => find(holder.fields, n);

    eq(null, holder.size);
    eq(null, holder.align);
    same([0, 8], [at('name').offset, at('n').offset]);
    same([null, null, null], [at('part').offset, at('buf').offset, at('len').offset]);
    same([8, 16, 8], [at('name').size, at('buf').size, at('len').size]);
    eq(null, at('part').size);
  },

  'bitfields share a storage unit: offset/size of the unit, bitOffset inside it'() {
    const holder = find(genIR(root + 'tests/cxx/layout.h').structs, 'holder');
    const row = n => {
      const f = find(holder.fields, n);
      return [f.offset, f.size, f.bits, f.bitOffset];
    };

    same([12, 4, 1, 0], row('a'));
    same([12, 4, 2, 1], row('b'));
    same([12, 4, 5, 3], row('c'));
    same([12, 2, 4, 8], row('s'));
  },

  'a union lists every member at offset 0'() {
    const num = find(genIR(root + 'tests/cxx/layout.h').structs, 'num');

    same([0, 0, 0], num.fields.map(f => f.offset));
    same([4, 8, 8], num.fields.map(f => f.size));
    eq(8, num.size);
  },

  'sizes and typedefs survive the AST cache'() {
    const cache = tmp + 'test-gen-bindings-cxx.cache';
    sh('rm -rf ' + cache);

    const run = () => {
      const file = tmp + 'test-gen-bindings-cxx.cached.ir.json';
      sh(['qjsm', root + 'tools/gen-bindings.js', '--cache-dir=' + cache, '--std=c++17', '--emit-ir=' + file, root + 'tests/cxx/types.hpp'].join(' '));
      return JSON.parse(std.loadFile(file));
    };
    const cold = run();
    const warm = run();

    assert(sh('ls ' + cache).includes('.ast.json'), 'no cache file was written');
    eq(8, find(find(warm.structs, 'ty::Rec').fields, 'next').size);
    same(cold.typedefs, warm.typedefs);
  },

  'generated classes construct, call, read and write fields, and destroy'() {
    return withGenerated(['--std=c++17'], async m => {
      const before = m.geo_Shape.count();
      const s = new m.geo_Shape(3, 2.0);

      try {
        eq(before + 1, m.geo_Shape.count());
        eq(3, s.width);
        eq(6, s.area());

        s.scale(2);
        eq(6, s.width);

        s.width = 5;
        eq(5, s.width);

        s.id = 7;
        eq(7, s.id);
        assert(s instanceof m.geo_Base, 'geo_Shape should extend geo_Base');
        eq(10, m.geo_Shape.MAX);
      } finally {
        s.delete();
      }

      eq(before, m.geo_Shape.count());
    });
  },

  'a constructor overload is picked by arity, and a wrapped object is passed as a reference'() {
    return withGenerated(['--std=c++17'], async m => {
      const a = new m.geo_Shape(4, 3.0);
      const b = new m.geo_Shape(a);

      try {
        eq(4, b.width);
        eq(12, b.area());
        eq(2, m.geo_Shape.count());
      } finally {
        a.delete();
        b.delete();
      }

      eq(0, m.geo_Shape.count());
    });
  },

  'from() wraps an existing object without owning it'() {
    return withGenerated(['--std=c++17'], async m => {
      const a = new m.geo_Shape(4, 3.0);

      try {
        const view = m.geo_Shape.from(a.ptr);
        eq(4, view.width);
        view.width = 9;
        eq(9, a.width);
      } finally {
        a.delete();
      }
    });
  },

  'misuse throws: abstract class, deleted object, no matching overload'() {
    return withGenerated(['--std=c++17'], async m => {
      let threw = null;

      try {
        new m.geo_Base();
      } catch(e) {
        threw = e;
      }
      assert(threw instanceof TypeError, 'abstract class must not be constructible');

      const s = new m.geo_Shape(1, 1.0);
      threw = null;
      try {
        s.scale();
      } catch(e) {
        threw = e;
      }
      assert(threw instanceof TypeError, 'scale() without argument must not match');

      s.delete();
      threw = null;
      try {
        s.area();
      } catch(e) {
        threw = e;
      }
      assert(threw !== null, 'a deleted object must not be callable');
    });
  },

  'C++ free functions are callable, overloads picked by argument type'() {
    return withGenerated(['--std=c++17'], m => {
      eq(7, m.geo_free_fn(7));
      eq(5, m.geo_add(2, 3));
      eq(4, m.geo_add(1.5, 2));
      eq(9, m.c_fn(9));
    });
  },

  '--describe: describeClass()/describeObject() report parameter names, C types and overloads'() {
    return withGenerated(['--std=c++17', '--describe'], async m => {
      const { describeClass } = await import('../../qjs-modules/lib/describe-class.js');
      const { describeObject } = await import('../../qjs-modules/lib/describe-object.js');
      const shape = describeClass(m.geo_Shape);
      const method = name => shape.prototypeChain[0].methods.find(f => f.name === name);

      same(['w', 'h'], shape.constructorParams);
      same([['w: i32', 'h: f64'], ['other: Shape *']], shape.constructorSignatures.map(s => s.params).sort((a, b) => b.length - a.length));
      same(['f'], method('scale').params);
      same(['f: f64'], method('scale').signatures[0].params);
      eq('void', method('scale').signatures[0].returnType);
      same([], shape.staticChain[0].methods.find(f => f.name === 'count').params);

      const add = describeObject(m.geo_add).methods;
      const fn = describeObject(m.c_fn);

      assert(add === undefined || add.length === 0, 'a function has no members of its own');
      same(['a', 'b'], describeClass(m.geo_add).constructorParams);
      same([['a: i32', 'b: i32'], ['a: f64', 'b: f64']], m.geo_add[Symbol.for('describe')].map(s => s.params));
      same(['a'], describeClass(m.c_fn).constructorParams);
      eq('i32', m.c_fn[Symbol.for('describe')][0].returnType);
      eq('c_fn', fn.name);
    });
  },

  '--structs: plain structs and C++ instances are ArrayBuffers, at() is a live view, layout is on the class'() {
    return withGenerated(['--std=c++17', '--structs'], async m => {
      const p = new m.geo_Point();

      p.x = 3;
      p.y = 4;
      assert(p instanceof ArrayBuffer, 'a struct is an ArrayBuffer');
      eq(8, p.byteLength);
      eq(4, m.geo_Point.at(p.ptr).y);
      eq(8, m.geo_Point.size);
      eq(4, m.geo_Point.fields.y.offset);

      const s = new m.geo_Shape(3, 2.0);

      try {
        assert(s instanceof ArrayBuffer && s instanceof m.geo_Base, 'a class instance is an ArrayBuffer and its base');
        eq(24, s.byteLength);

        const v = m.geo_Shape.at(s.ptr);

        eq(3, v.width);
        v.width = 9;
        eq(9, s.width);
        eq(18, s.area());
      } finally {
        s.delete();
      }
    });
  },

  '--structs --describe: struct wrappers report constructor signatures, at() and the layout'() {
    return withGenerated(['--std=c++17', '--structs', '--describe'], async m => {
      const { describeClass } = await import('../../qjs-modules/lib/describe-class.js');
      const d = describeClass(m.geo_Point);

      same(['init'], d.constructorParams);
      same([['init: number'], ['init: ArrayBuffer|ArrayBufferView']], d.constructorSignatures.map(s => s.params));
      same(['p: pointer', 'owner: object', 'size: number'], m.geo_Point.at[Symbol.for('describe')][0].params);
      eq('geo_Point', m.geo_Point.at[Symbol.for('describe')][0].returnType);
      eq('i32', m.geo_Point.fields.y.type);
      eq(4, m.geo_Point.fields.y.offset);
    });
  },

  '--structs --jsdoc: every struct and class block lists its members with JS type, C type and offset'() {
    const name = 'test-gen-bindings-cxx.structdoc.js';
    const lib = realpath(tmp + 'libshapes.so')[0];
    const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--structs', '--jsdoc', '--library=' + lib, '-o', tmp + name, root + 'tests/cxx/shapes.hpp'].join(' '));
    const text = std.loadFile(tmp + name);

    assert(text !== null, 'no module written, output was:\n' + out);

    const block = before => text.slice(text.lastIndexOf('/**', text.indexOf(before)), text.indexOf(before));
    const point = block('export class geo_Point ');
    const shape = block('export class geo_Shape ');

    assert(point.includes('@extends {ArrayBuffer}') && point.includes('@param {number|ArrayBuffer|ArrayBufferView} [init=8]'), 'struct class header');
    assert(point.includes('@property {number} x - int, offset 0') && point.includes('@property {number} y - int, offset 4'), 'struct members');
    assert(shape.includes('@extends {geo_Base}') && shape.includes('@property {number} width - int, offset 20'), 'class members join the C++ class block');
    assert(!sh('qjsm ' + root + 'tools/gen-bindings.js --no-cache --std=c++17 --structs --library=' + lib + ' ' + root + 'tests/cxx/shapes.hpp').includes('@property'), 'no --jsdoc, no member docs');
  },

  '--namespace is repeatable and every listed namespace is dropped from the names'() {
    const names = (...ns) => {
      const text = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--structs', ...ns.map(n => '--namespace=' + n), root + 'tests/cxx/namespaces.hpp'].join(' '));

      return { text, exports: [...text.matchAll(/^export (?:class|function|const) (\w+)/gm)].map(m => m[1]).filter(n => !/^__/.test(n)) };
    };

    const none = names().exports;

    for(const n of ['a_P', 'a_Q', 'a_g', 'b_f', 'b_c_h']) assert(none.includes(n), n + ' without --namespace: ' + none);

    const one = names('a').exports;

    for(const n of ['P', 'Q', 'g', 'b_f', 'b_c_h']) assert(one.includes(n), n + ' with a: ' + one);
    assert(!one.includes('a_P'), 'a_ is gone');

    const both = names('a', 'b');

    for(const n of ['P', 'Q', 'g', 'f', 'c_h']) assert(both.exports.includes(n), n + ' with a and b: ' + both.exports);
    assert(both.text.includes('--namespace=a --namespace=b'), 'the regenerate line lists both');

    const nested = names('b', 'c').exports;

    assert(nested.includes('h') && nested.includes('f') && nested.includes('a_g'), 'b::c::h is h with b and c: ' + nested);
  },

  '--namespace aborts, writing nothing, when dropping it makes two exports one'() {
    const out = tmp + 'test-gen-bindings-cxx.collide.js';
    const gen = (...flags) => {
      remove(out);
      return sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--structs', ...flags, '-o', out, root + 'tests/cxx/collide.hpp'].join(' '));
    };

    gen();
    assert(/export function a_run|export const a_run/.test(std.loadFile(out)), 'a_run without --namespace');

    gen('--namespace=a');
    assert(/export const run /.test(std.loadFile(out)) && /export const b_run /.test(std.loadFile(out)), 'only a is dropped, no clash');

    const msg = gen('--namespace=a', '--namespace=b');

    assert(std.loadFile(out) === null, 'nothing is written on a collision');
    assert(/"run" would be exported by: function a::run; function b::run/.test(msg), msg);
    assert(/"Item" would be exported by: (struct a::Item; class b::Item|class b::Item; struct a::Item)/.test(msg), msg);
    assert(/name collision, nothing written/.test(msg), msg);

    remove(out);
    sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--namespace=a', '--namespace=b', '--emit-ir=' + out, root + 'tests/cxx/collide.hpp'].join(' '));
    assert(std.loadFile(out) !== null, 'the IR does not depend on names, so --emit-ir is not blocked');
  },

  '--jsdoc: classes, methods and functions get typed @param/@returns blocks, overloads under @overload'() {
    const name = 'test-gen-bindings-cxx.jsdoc.js';
    const lib = realpath(tmp + 'libshapes.so')[0];
    const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--std=c++17', '--jsdoc', '--library=' + lib, '-o', tmp + name, root + 'tests/cxx/shapes.hpp'].join(' '));
    const text = std.loadFile(tmp + name);

    assert(text !== null, 'no module written, output was:\n' + out);

    const block = (before) => text.slice(text.lastIndexOf('/**', text.indexOf(before)), text.indexOf(before));

    assert(block('export class geo_Shape ').includes('@extends {geo_Base}'), 'class lacks @extends');
    assert(block('export class geo_Shape ').includes('@param {geo_Shape|object|number|bigint|null} other - Shape *'), 'constructor pointer param');
    assert(block('  scale(').includes('@param {number} f - f64') && block('  scale(').includes('@returns {void}'), 'method params/returns');
    assert(block('  static count(').includes('geo::Shape::count (static)') && block('  static count(').includes('@returns {number} - i32'), 'static method doc');
    eq(2, block('export const geo_add').split('@overload').length - 1);
    assert(block('export const c_fn').includes('@param {number} a - i32'), 'plain C function params');
    assert(!sh('qjsm ' + root + 'tools/gen-bindings.js --no-cache --std=c++17 --library=' + lib + ' ' + root + 'tests/cxx/shapes.hpp').includes('/**'), 'no --jsdoc, no doc blocks');
  },

  '--describe: the named wrappers still dispatch overloads, extra arguments and from()'() {
    return withGenerated(['--std=c++17', '--describe'], async m => {
      const a = new m.geo_Shape(4, 3.0);
      const b = new m.geo_Shape(a);
      const c = m.geo_Shape.from(a.ptr);

      try {
        eq(12, b.area());
        eq(4, c.width);
        eq(2, m.geo_Shape.count());
      } finally {
        a.delete();
        b.delete();
      }

      eq(5, m.geo_add(2, 3));
      eq(4, m.geo_add(1.5, 2));
      eq(9, m.c_fn(9));
    });
  },
});

