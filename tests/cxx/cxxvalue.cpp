#include "cxxvalue.hpp"

Vec2::Vec2() : x(0), y(0) {}
Vec2::Vec2(float a, float b) : x(a), y(b) {}
Owner::Owner(const Owner& o) : id(o.id) {}
Owner::~Owner() {}

namespace gx {
Vec2 add(Vec2 a, Vec2 b) { return Vec2(a.x + b.x, a.y + b.y); }
float dot(Vec2 a, const Vec2& b) { return a.x * b.x + a.y * b.y; }
int area(Size s) { return s.width * s.height; }
Size_<float> half(Size_<float> s) { return Size_<float>{s.width / 2, s.height / 2}; }
Size grow(Size s, int by) { return Size{s.width + by, s.height + by}; }
int owner_id(Owner o) { return o.id; }
Vec<float, 3> scale3(Vec<float, 3> a, float k) { return Vec<float, 3>{{a.v[0] * k, a.v[1] * k, a.v[2] * k}}; }
int volume(Box<int> b) { return b.size.width * b.size.height * b.depth; }
int dsum(Derived2 d) { return d.a * 10 + d.b; }
}
