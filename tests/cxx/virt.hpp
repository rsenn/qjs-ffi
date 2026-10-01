#pragma once

class Animal {
public:
  Animal();
  virtual ~Animal();
  virtual int legs() const;
  virtual int legs(int extra) const;
  virtual const char* sound() const = 0;
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

Animal* make_animal(int kind);
int dog_dtors();
