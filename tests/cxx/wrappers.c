#include "wrappers.h"
#include <stdlib.h>
#include <string.h>

struct thing { int value; };

static long live, names;

int thing_make(int value, thing **out) {
  *out = thing_new(value);
  return value < 0 ? 1 : 0;
}

thing *thing_new(int value) {
  thing *t = malloc(sizeof *t);

  t->value = value;
  live++;
  return t;
}

int thing_value(thing *t) { return t->value; }

int thing_free(thing *t) {
  free(t);
  live--;
  return 0;
}

long things_live(void) { return live; }

unsigned char *thing_name(int id) { return (unsigned char *)(id ? "second" : "first"); }

char *name_alloc(int id) {
  names++;
  return strdup(id ? "second" : "first");
}

void name_free(char *name) {
  free(name);
  names--;
}

long names_live(void) { return names; }

char *name_libc(int id) { return strdup(id ? "second" : "first"); }

void minmax(int a, int b, int *lo, int *hi) {
  *lo = a < b ? a : b;
  *hi = a < b ? b : a;
}

int divmod(int a, int b, int *quotient, int *remainder) {
  if(b == 0) return 1;
  *quotient = a / b;
  *remainder = a % b;
  return 0;
}

int half(double x, double *out) {
  *out = x / 2;
  return 0;
}

int label(int id, const char **name) {
  *name = id ? "second" : "first";
  return 0;
}
