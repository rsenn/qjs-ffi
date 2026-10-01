#include "shapes.hpp"

static int live = 0;

namespace geo {
Base::Base() : id(0), hidden(0) {}
Base::~Base() {}
Shape::Shape(int w, double h) : priv((int)h), width(w) { live++; }
Shape::Shape(const Shape &other) : Base(other), priv(other.priv), width(other.width) { live++; }
Shape::~Shape() { live--; }
double Shape::area() const { return (double)width * priv; }
void Shape::scale(double f) { width = (int)(width * f); }
void Shape::setKind(Kind) {}
int Shape::count() { return live; }
void Shape::secret() {}
int free_fn(int a) { return a; }
}
extern "C" int c_fn(int a) { return a; }
