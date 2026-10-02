#include "virt.hpp"

static int alive_count;
static int dog_dtor_count;

Animal::Animal() { alive_count++; }
Animal::~Animal() { alive_count--; }
int Animal::legs() const { return 0; }
int Animal::legs(int extra) const { return 100 + extra; }
int Animal::describe() const { return legs(); }
int Animal::alive() { return alive_count; }

Dog::Dog() {}
Dog::~Dog() { dog_dtor_count++; }
int Dog::legs() const { return 4; }
int Dog::legs(int extra) const { return 4 + extra; }
const char* Dog::sound() const { return "woof"; }

Bird::Bird() {}
int Bird::legs() const { return 2; }
const char* Bird::sound() const { return "tweet"; }

Puppy::Puppy() {}
const char* Puppy::sound() const { return "yip"; }

Guarded::Guarded() {}
Guarded::~Guarded() {}
int Guarded::f(int) const { return 1; }
int Guarded::f(double) const { return 2; }
int Guarded2::f(int) const { return 11; }
int Guarded2::f(double) const { return 22; }
void Guarded2::destroy(Guarded2* p) { delete p; }

Sealed::Sealed() {}
int Sealed::v(int) const { return 1; }
int Sealed::v(double) const { return 2; }

Animal*
make_animal(int kind) {
  return kind == 1 ? static_cast<Animal*>(new Dog) : kind == 3 ? static_cast<Animal*>(new Puppy) : static_cast<Animal*>(new Bird);
}

Guarded*
make_guarded() {
  return new Guarded2;
}

int
dog_dtors() {
  return dog_dtor_count;
}
