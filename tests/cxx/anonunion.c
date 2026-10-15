#include "anonunion.h"

color color_make(float r, float g, float b, float a) {
  color c;
  c.r = r; c.g = g; c.b = b; c.a = a;
  return c;
}

float color_sum(color c) { return c.rgba[0] + c.rgba[1] + c.rgba[2] + c.rgba[3]; }

color color_lerp(color a, color b, float t) {
  color c;
  for(int i = 0; i < 4; i++) c.rgba[i] = a.rgba[i] + (b.rgba[i] - a.rgba[i]) * t;
  return c;
}

paint paint_make(color inner, color outer, int image) {
  paint p = { {1, 2, 3, 4, 5, 6}, {7, 8}, 9, 10, inner, outer, image };
  return p;
}

float paint_sum(paint p) {
  float s = 0;
  for(int i = 0; i < 6; i++) s += p.xform[i];
  s += p.extent[0] + p.extent[1] + p.radius + p.feather + color_sum(p.inner) + color_sum(p.outer);
  return s + p.image;
}

mixed mixed_make(int i) { mixed m = { { i }, 7 }; return m; }

int clash(struct clash *c) { return c->a + c->b; }
