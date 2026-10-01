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

Animal*
make_animal(int kind) {
  return kind == 1 ? static_cast<Animal*>(new Dog) : static_cast<Animal*>(new Bird);
}

int
dog_dtors() {
  return dog_dtor_count;
}
