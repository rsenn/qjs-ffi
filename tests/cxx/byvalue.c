#include "byvalue.h"

static long calls;

vec3
vec3_add(vec3 a, vec3 b) {
  calls++;
  return (vec3){a.x + b.x, a.y + b.y, a.z + b.z};
}

float
vec3_dot(vec3 a, vec3 b) {
  calls++;
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

mix
mix_make(int i, double d) {
  calls++;
  return (mix){i, d};
}

double
mix_sum(mix m) {
  calls++;
  return m.i + m.d;
}

big
big_make(long start) {
  big b;

  calls++;
  for(int i = 0; i < 5; i++)
    b.v[i] = start + i;

  return b;
}

long
big_sum(big b) {
  long s = 0;

  calls++;
  for(int i = 0; i < 5; i++)
    s += b.v[i];

  return s;
}

seg
seg_make(vec3 a, vec3 b) {
  calls++;
  return (seg){a, b};
}

float
seg_len2(seg s) {
  float x = s.b.x - s.a.x, y = s.b.y - s.a.y, z = s.b.z - s.a.z;

  calls++;
  return x * x + y * y + z * z;
}

packed
packed_make(char tag, int flags, int mode, short n) {
  packed p = {tag, flags, mode, n};

  calls++;
  return p;
}

int
packed_n(packed p) {
  calls++;
  return p.n;
}

pk
pk_make(char a, double b) {
  calls++;
  return (pk){a, b};
}

un
un_make(int i) {
  calls++;
  return (un){.i = i};
}

wrapped
wrapped_make(int a) {
  calls++;
  return (wrapped){{a}};
}

wide
wide_make(long a, long b, long c) {
  calls++;
  return (wide){{a, b}, c};
}

long
wide_sum(wide w) {
  calls++;
  return w.in.a + w.in.b + w.c;
}

long
calls_made(void) {
  return calls;
}
