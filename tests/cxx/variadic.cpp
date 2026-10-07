#include "variadic.hpp"
#include <cstdarg>
#include <cstring>

namespace va {
int sum(int n, ...) {
  va_list ap;
  int s = 0;

  va_start(ap, n);
  for(int i = 0; i < n; i++)
    s += va_arg(ap, int);
  va_end(ap);
  return s;
}

Acc::Acc() : total(0) {}

int Acc::add(int n, ...) {
  va_list ap;

  va_start(ap, n);
  for(int i = 0; i < n; i++)
    total += va_arg(ap, int);
  va_end(ap);
  return total;
}

int Acc::add(const char* label) {
  total += (int)strlen(label);
  return total;
}
}
