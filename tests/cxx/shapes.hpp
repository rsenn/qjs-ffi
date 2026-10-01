#pragma once
namespace geo {
struct Point { int x, y; };
enum Kind { Circle, Square };
class Base {
public:
  Base();
  virtual ~Base();
  virtual double area() const = 0;
  int id;
protected:
  int hidden;
};
class Shape : public Base {
  int priv;
public:
  Shape(int w, double h);
  Shape(const Shape &other);
  ~Shape();
  double area() const override;
  void scale(double f);
  void setKind(Kind k);
  static int count();
  int width;
  static const int MAX = 10;
  struct Inner { char c; };
private:
  void secret();
};
int free_fn(int a);
}
extern "C" { int c_fn(int a); }
template <class T> struct Box { T v; T get() const { return v; } };
