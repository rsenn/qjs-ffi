#pragma once

class Animal {
public:
  Animal();
  virtual ~Animal();
  virtual int legs() const;
  virtual int legs(int extra) const;
  virtual const char* sound() const = 0;
  virtual int inline_only() const { return 1; } /* no exported symbol */
  int describe() const;
  static int alive();
};

class Dog : public Animal {
public:
  Dog();
  ~Dog() override;
  int legs() const override;
  int legs(int extra) const override;
  const char* sound() const override;
};

/* No destructor of its own: it inherits the virtual one. */
class Bird : public Animal {
public:
  Bird();
  int legs() const override;
  const char* sound() const override;
};

/* Three levels; name() overrides without `virtual` or `override`. */
class Puppy : public Dog {
public:
  Puppy();
  const char* sound() const;
  int inline_only() const override { return 5; }
};

/* Only overloaded virtuals and a protected destructor: nothing the probe can
 * name or call to make clang lay the vtable out. */
class Guarded {
public:
  Guarded();
  virtual int f(int) const;
  virtual int f(double) const;
protected:
  ~Guarded();
};

class Guarded2 : public Guarded {
public:
  int f(int) const override;
  int f(double) const override;
  static void destroy(Guarded2*);
};

/* Cannot be derived from, so it cannot be probed: it keeps its own symbols. */
class Sealed final {
public:
  Sealed();
  virtual int v(int) const;
  virtual int v(double) const;
};

Animal* make_animal(int kind);
Guarded* make_guarded();
int dog_dtors();
