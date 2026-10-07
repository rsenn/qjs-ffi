#pragma once

namespace va {
/* sum of the n ints that follow */
int sum(int n, ...);

class Acc {
public:
  Acc();
  int total;
  int add(int n, ...);
  int add(const char* label);
};
}
