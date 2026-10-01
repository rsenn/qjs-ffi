#pragma once
namespace ty {
typedef unsigned char byte_t;
using word_t = unsigned short;
typedef struct { int a; char b; } pair_t;
using cb_t = int (*)(int);

struct Rec {
  char tag;
  double d;
  int arr[3];
  Rec *next;
  byte_t bytes[5];
  pair_t pair;
  unsigned flag : 3;
};

class Widget {
public:
  using id_t = long;
  int pub;
private:
  int priv;
public:
  char tail;
  id_t id;
  int &ref;
};
}
