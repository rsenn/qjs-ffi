#ifndef ANONUNION_H
#define ANONUNION_H

/* a union of alternatives with the same layout; nanovg's NVGcolor */
typedef struct {
  union {
    float rgba[4];
    struct { float r, g, b, a; };
  };
} color;

/* 76 bytes; 4-byte aligned only when the union is known to be floats */
typedef struct {
  float xform[6];
  float extent[2];
  float radius, feather;
  color inner, outer;
  int image;
} paint;

/* alternatives that differ: int or float in the same eightbyte */
typedef struct { union { int i; float f; }; int n; } mixed;

color color_make(float r, float g, float b, float a);
float color_sum(color c);
color color_lerp(color a, color b, float t);
paint paint_make(color inner, color outer, int image);
float paint_sum(paint p);
mixed mixed_make(int i);

/* the same name as a struct, in the other C namespace */
struct clash { int a, b; };
int clash(struct clash *c);

/* declared, not defined: its symbol is missing from the library */
int absent_function(int x);

#endif
