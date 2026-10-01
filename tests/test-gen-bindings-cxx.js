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
    eq(0, area.arity);
    eq(true, find(shape.methods, 'count').static);
    eq(true, find(base.methods, 'area').pure);
    eq(true, base.abstract);
    eq(true, base.polymorphic);
  },

  'constructors keep each overload (none for an abstract class); references map to pointer'() {
    same(['w: i32', 'h: f64'], shape.constructors[0].params);
    same(['other: pointer'], shape.constructors[1].params);
    eq('_ZN3geo5ShapeC1Eid', shape.constructors[0].mangledName);
    eq(undefined, shape.constructors[0].returnType);
    eq(0, base.constructors.length);
  },

  'destructor and bases are recorded'() {
    same({ mangledName: '_ZN3geo4BaseD1Ev', virtual: true }, base.destructor);
    same([{ name: 'geo::Base', access: 'public' }], shape.bases);
  },

  'enum-typed parameters resolve through the qualified enum name'() {
    const setKind = find(shape.methods, 'setKind');
    same(['k: i32'], setKind.params);
    eq(1, setKind.enums.length);
  },

  'plain structs stay in structs, nested ones are qualified'() {
    same(['geo::Point', 'geo::Shape::Inner'], ir.structs.map(s => s.name));
  },

  'extern "C" functions are bound, other C++ free functions are skipped with a reason'() {
    same(['c_fn'], ir.methods.map(m => m.name));
    eq('geo::free_fn', ir.skipped[0].name);
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
    assert(/export const struct_geo_Point = /.test(out), out);
  },

  'structs and classes are describeObject()-shaped'() {
    for(const e of [...ir.structs, ...ir.classes]) {
      eq('object', e.type);
      same([], e.getters);
      same([], e.setters);
      assert(Array.isArray(e.methods) && Array.isArray(e.fields) && Array.isArray(e.prototypeChain), e.name + ' lacks a describeObject() member list');
    }
    same([], find(ir.structs, 'geo::Point').methods);
  },

  'a class lists its ancestors in prototypeChain, like describeObject'() {
    eq(1, shape.prototypeChain.length);
    eq(0, shape.prototypeChain[0].level);
    eq('geo::Base', shape.prototypeChain[0].constructorName);
    same(['id'], shape.prototypeChain[0].fields.map(f => f.name));
    same([], base.prototypeChain);
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
    eq(undefined, flag.size);
    eq(undefined, flag.offset);

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
    eq('pointer', byName.point_ptr.type);
    eq(8, byName.point_ptr.size);

    const tail = find(types.structs, 'tail');
    eq(4, find(tail.fields, 'n').size);
    eq(undefined, find(tail.fields, 'data').size);
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

  'the define API with --structs emits working classes too'() {
    return withGenerated(['--std=c++17', '--api=define', '--structs'], async m => {
      const s = new m.geo_Shape(3, 2.0);
      try {
        eq(6, s.area());
      } finally {
        s.delete();
      }
    });
  },
});

