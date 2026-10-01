#pragma once
namespace a {
int run(int v);
struct Item { int x; };
}
namespace b {
int run(int v);
class Item { public: Item(); int get() const; };
}
