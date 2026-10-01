#pragma once
namespace a {
struct P { int x; };
class Q { public: Q(); int get() const; };
int g(int v);
}
namespace b {
int f(int v);
namespace c {
int h(int v);
}
}
