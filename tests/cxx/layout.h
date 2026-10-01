#include <stddef.h>

struct incomplete;

struct holder {
  char *name;
  int n;
  unsigned a : 1, b : 2, c : 5;
  short s : 4;
  struct incomplete part;
  char buf[16];
  size_t len;
};

union num {
  int i;
  double d;
  unsigned char bytes[8];
};
