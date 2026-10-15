#include "cxxwrap.hpp"
#include <cstdlib>
#include <cstring>

extern "C" void free_name(char* s) {
  free(s);
}

namespace cw {
int divmod(int a, int b, int* quotient, int* remainder) {
  if(b == 0) return 1;
  *quotient = a / b;
  *remainder = a % b;
  return 0;
}
void bounds(int a, int b, int* lo, int* hi) {
  *lo = a < b ? a : b;
  *hi = a < b ? b : a;
}
static int live = 0;
char* dup_name(int id) {
  live++;
  return strdup(id ? "second" : "first");
}
Stats::Stats() : sum(10) {}
int Stats::mean(int count, double* out) const {
  if(count == 0) return 2;
  *out = double(sum) / count;
  return 0;
}
int Stats::count(int a) { return a + 1; }
int Stats::count(int a, int b, int* out) { *out = a * b; return 0; }
void Stats::pair(int a, int* first, int* second) { *first = a; *second = a * 2; }
char* Stats::label() const { return strdup("stats"); }
}
