#pragma once

namespace df {
enum Mode { Fast = 1, Slow = 4 };

/* a + b*10 + c*100, with defaults for b and c */
int mix(int a, int b = 3, int c = -1);
/* a * scale, add 1 when up; the last three are defaults of several kinds */
double scaled(double a, double scale = 1.5, bool up = true);
/* the default is an enum constant, a string and a shift */
int tag(int a, Mode m = Slow, const char* s = "x", int shift = 1 << 3);
/* no literal default: a call, so the parameter stays required */
int call(int a, int b = mix(1));

class Acc {
public:
  Acc(int start = 5);
  int total;
  int add(int n = 1);
};
}
