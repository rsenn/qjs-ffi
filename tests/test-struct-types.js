import * as std from 'std';
import { realpath } from 'os';
import { dlopen, linkSymbols, dlsym, RTLD_DEFAULT, JSCallback, ptr, cc } from 'ffi';
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
write(tmp + 'structtypes.c', `
#include <stdlib.h>
typedef struct { double x, y; } Point;
typedef struct { int a; } Other;
Point origin = { 1.5, 2.5 };
double Point_len2(Point* p) { return p->x * p->x + p->y * p->y; }
int Other_get(Other* o) { return o ? o->a : -1; }
Point* Point_make(double x, double y) { Point* p = malloc(sizeof *p); p->x = x; p->y = y; return p; }
Point* Point_null(void) { return 0; }
void Point_free(Point* p) { free(p); }
double Point_apply(Point* (*f)(void), int unused) { Point* p = f(); double r = p ? p->x : -1; return r; }
double Point_call(double (*f)(Point*), Point* p) { return f(p); }
`);
eq('', sh('cc -shared -fPIC -o ' + tmp + 'libstructtypes.so ' + tmp + 'structtypes.c').trim());

class Point extends ArrayBuffer {
  static size = 16;
  constructor() { super(Point.size); }
  get x() { return new Float64Array(this)[0]; }
  set x(v) { new Float64Array(this)[0] = v; }
  get y() { return new Float64Array(this)[1]; }
  set y(v) { new Float64Array(this)[1] = v; }
}

class Other extends ArrayBuffer {
  static size = 4;
}

class Dot extends Point {}

const { symbols: s } = dlopen(realpath(tmp + 'libstructtypes.so')[0], {
  Point_len2: { args: [Point], returns: 'f64' },
  Other_get: { args: [Other], returns: 'i32' },
  Point_make: { args: ['f64', 'f64'], returns: Point },
  Point_null: { args: [], returns: Point },
  Point_free: { args: ['pointer'], returns: 'void' },
  Point_call: { args: ['function', Point], returns: 'f64' },
  origin: { type: Point },
});

const libpath = realpath(tmp + 'libstructtypes.so')[0];
const named = dlopen(
  libpath,
  {
    Point_len2: { args: ['Point *'], returns: 'f64' },
    Point_make: { args: ['f64', 'f64'], returns: 'Point *' },
    Point_null: { args: [], returns: 'struct Point *' },
    Point_free: { args: ['Point *'], returns: 'void' },
    Other_get: { args: ['const Other *'], returns: 'i32' },
    origin: { type: 'Point' },
  },
  { Point, Other },
).symbols;

await tests({
  'types: a "T *" in args and returns names a class of the third argument'() {
    const p = named.Point_make(5, 12);

    assert(p instanceof Point, 'returns "Point *" is not a Point');
    eq(169, named.Point_len2(p));
    eq(null, named.Point_null());
    named.Point_free(p);
  },

  'types: the check is the same: an unrelated instance is a TypeError, const is ignored'() {
    let e;

    try { named.Point_len2(new Other()); } catch(x) { e = x; }

    assert(e instanceof TypeError && /Point/.test(e.message) && /Other/.test(e.message), 'got: ' + e);
    eq(-1, named.Other_get(null));
  },

  'types: a variable of a bare class name is the variable memory'() {
    assert(named.origin instanceof Point, 'not a Point');
    eq(1.5, named.origin.x);
  },

  'types: a name not in the object, and a pointer to a pointer, stay plain pointers'() {
    const { symbols: u } = dlopen(libpath, { Point_len2: { args: ['Nope *'], returns: 'f64' }, Point_free: { args: ['Point **'], returns: 'void' } }, { Point });
    const p = new Point();

    new Float64Array(p).set([3, 4]);
    eq(25, u.Point_len2(p));
    assert(u.Point_len2.length === 1, 'the function exists');
  },

  'types: linkSymbols takes the object as its second argument'() {
    const { symbols: l } = linkSymbols({ Point_len2: { ptr: dlsym(RTLD_DEFAULT, 'strlen') && named.Point_len2.ptr, args: ['Point *'], returns: 'f64' } }, { Point });
    const p = new Point();

    new Float64Array(p).set([6, 8]);
    eq(100, l.Point_len2(p));
  },

  'types: a spec can carry its own types, which win'() {
    const { symbols: o } = dlopen(libpath, { Point_make: { args: ['f64', 'f64'], returns: 'Point *', types: { Point: Dot } } }, { Point });

    assert(o.Point_make(1, 2) instanceof Dot, 'the spec-level Dot was not used');
  },

  'types: cc() takes it as an option'() {
    const { symbols: c } = cc({ source: new Uint8Array([...'int ident(void* p) { return p != 0; }'].map(c => c.charCodeAt(0))), symbols: { ident: { args: ['Point *'], returns: 'i32' } }, types: { Point } });

    eq(1, c.ident(new Point()));
    eq(0, c.ident(null));
  },

  'a class is a type in args and returns'() {
    const p = new Point();

    p.x = 3;
    p.y = 4;
    eq(25, s.Point_len2(p));
  },

  'a subclass instance is accepted where its base is declared'() {
    const d = new Dot();

    d.x = 6;
    d.y = 8;
    eq(100, s.Point_len2(d));
  },

  'an instance of an unrelated class is a TypeError naming both'() {
    let e;

    try { s.Point_len2(new Other()); } catch(x) { e = x; }

    assert(e instanceof TypeError, 'not a TypeError: ' + e);
    assert(/Point/.test(e.message) && /Other/.test(e.message), e.message);
  },

  'a plain buffer of enough bytes, a view and null are accepted'() {
    const b = new ArrayBuffer(16);

    new Float64Array(b).set([3, 4]);
    eq(25, s.Point_len2(b));
    eq(25, s.Point_len2(new Float64Array(b)));
    eq(-1, s.Other_get(null));
  },

  'a buffer shorter than the class is a RangeError'() {
    let e;

    try { s.Point_len2(new ArrayBuffer(8)); } catch(x) { e = x; }

    assert(e instanceof RangeError, 'not a RangeError: ' + e);
  },

  'returns: a class gives an instance over the C memory, null for NULL'() {
    const p = s.Point_make(5, 12);

    assert(p instanceof Point, 'not a Point');
    assert(p instanceof ArrayBuffer, 'not an ArrayBuffer');
    eq(16, p.byteLength);
    eq(5, p.x);
    eq(12, p.y);
    p.x = 9;
    eq(9, new Float64Array(p)[0]);
    eq(null, s.Point_null());
    s.Point_free(p);
  },

  'a variable of a class type is the variable memory itself'() {
    assert(s.origin instanceof Point, 'not a Point');
    eq(1.5, s.origin.x);
    s.origin.y = 7;
    eq(7, s.origin.y);
    eq(1.5 * 1.5 + 49, s.Point_len2(s.origin));
  },

  'a class without a static size is a TypeError when the spec is parsed'() {
    class NoSize extends ArrayBuffer {}
    let e;

    try { dlopen(null, { abs: { args: [NoSize], returns: 'i32' } }); } catch(x) { e = x; }

    assert(e instanceof TypeError && /size/.test(e.message), 'got: ' + e);
  },

  'a class need not inherit ArrayBuffer: a static size and buffer instances are enough'() {
    class Raw {
      static size = 16;
      constructor() { return Reflect.construct(ArrayBuffer, [Raw.size], new.target); }
      get x() { return new Float64Array(this)[0]; }
      set x(v) { new Float64Array(this)[0] = v; }
      get slice() { return 'a field, not ArrayBuffer.prototype.slice'; }
    }
    const { symbols: r } = dlopen(libpath, {
      Point_len2: { args: [Raw], returns: 'f64' },
      Point_make: { args: ['f64', 'f64'], returns: Raw },
      Point_free: { args: ['pointer'], returns: 'void' },
      origin: { type: Raw },
    });
    const p = new Raw();

    assert(!(p instanceof ArrayBuffer), 'it should not be an ArrayBuffer by prototype');
    eq(undefined, p.byteLength);
    p.x = 3;
    new Float64Array(p)[1] = 4;
    eq(25, r.Point_len2(p));
    eq('a field, not ArrayBuffer.prototype.slice', p.slice);

    const q = r.Point_make(5, 12);

    assert(q instanceof Raw, 'a returned pointer is not a Raw');
    eq(5, q.x);
    eq(1.5, r.origin.x);
    r.Point_free(q);

    let e;

    try { r.Point_len2(new Point()); } catch(x) { e = x; }

    assert(e instanceof TypeError && /Raw/.test(e.message), 'a Point where a Raw is declared: ' + e);
  },

  'ArrayBuffer itself and a plain function are not class types'() {
    for(const t of [ArrayBuffer, function f() {}, class A {}]) {
      let e;

      try { dlopen(null, { abs: { args: [t], returns: 'i32' } }); } catch(x) { e = x; }

      assert(e instanceof TypeError, 'accepted ' + t);
    }
  },

  'a callback receives a class instance over the argument'() {
    let seen;
    const cb = new JSCallback(p => { seen = p; return p.x * 2; }, { args: [Point], returns: 'f64' });
    const p = new Point();

    p.x = 21;
    eq(42, s.Point_call(cb.ptr, p));
    assert(seen instanceof Point, 'the callback got a ' + seen);
    cb.close();
  },

  'gc with the classes dropped does not crash'() {
    for(let i = 0; i < 100; i++) s.Point_free(s.Point_make(i, i));
    std.gc();
  },
});
