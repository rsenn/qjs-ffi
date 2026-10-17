#pragma once

/* C++ types passed by value: a class that is trivially copyable, and the
 * instantiations of a class template */
struct Vec2 {
  float x, y;
  Vec2();
  Vec2(float a, float b);
};

/* not trivially copyable: passed by reference behind the scenes, never bound */
struct Owner {
  int id;
  Owner(const Owner& o);
  ~Owner();
};

template<typename T> struct Size_ {
  T width, height;
};

template<typename T, int N> struct Vec {
  T v[N];
};

template<typename T> struct Box { Size_<T> size; T depth; };

/* a trivially copyable class with a base is laid out base first */
struct Base2 { int a; };
struct Derived2 : Base2 { int b; };

typedef Size_<int> Size;

namespace gx {
Vec2 add(Vec2 a, Vec2 b);
float dot(Vec2 a, const Vec2& b);
int area(Size s);
Size_<float> half(Size_<float> s);
Size grow(Size s, int by);
int owner_id(Owner o);
Vec<float, 3> scale3(Vec<float, 3> a, float k);
int volume(Box<int> b);
int dsum(Derived2 d);
}
