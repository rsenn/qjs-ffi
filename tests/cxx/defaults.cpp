#include "defaults.hpp"
#include <cstring>

namespace df {
int mix(int a, int b, int c) { return a + b * 10 + c * 100; }
double scaled(double a, double scale, bool up) { return a * scale + (up ? 1 : 0); }
int tag(int a, Mode m, const char* s, int shift) { return a + m * 10 + (int)std::strlen(s) * 100 + shift * 1000; }
int call(int a, int b) { return a + b; }
Acc::Acc(int start) : total(start) {}
int Acc::add(int n) { return total += n; }
}
