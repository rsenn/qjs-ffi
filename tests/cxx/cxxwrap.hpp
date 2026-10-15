#pragma once

/* a C function frees what the C++ one returns */
extern "C" void free_name(char* s);

namespace cw {
/* out-parameters of a free function: 0 ok, 1 when b == 0 */
int divmod(int a, int b, int* quotient, int* remainder);
void bounds(int a, int b, int* lo, int* hi);
/* an owned string */
char* dup_name(int id);

class Stats {
public:
  Stats();
  int sum;
  /* method with an out-parameter and a status return */
  int mean(int count, double* out) const;
  /* overloads: only the second has `out` */
  int count(int a);
  int count(int a, int b, int* out);
  static void pair(int a, int* first, int* second);
  char* label() const;
};
}
