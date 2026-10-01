#ifndef BYVALUE_H
#define BYVALUE_H

typedef struct { float x, y, z; } vec3;
typedef struct { int i; double d; } mix;
typedef struct { long v[5]; } big;
typedef struct { vec3 a, b; } seg;
typedef struct { char tag; unsigned flags : 3; unsigned mode : 5; short n; } packed;

vec3 vec3_add(vec3 a, vec3 b);
float vec3_dot(vec3 a, vec3 b);
mix mix_make(int i, double d);
double mix_sum(mix m);
big big_make(long start);
long big_sum(big b);
seg seg_make(vec3 a, vec3 b);
float seg_len2(seg s);
/* Not representable: libffi would align the double, the compiler does not. */
typedef struct __attribute__((packed)) { char a; double b; } pk;
typedef union { int i; float f; } un;
/* A small struct is classified by its members, which an anonymous one hides. */
typedef struct { struct { int a; } in; } wrapped;
/* A large one is passed in memory whatever it holds, so it can be bound. */
typedef struct { struct { long a, b; } in; long c; } wide;

pk pk_make(char a, double b);
un un_make(int i);
wrapped wrapped_make(int a);
wide wide_make(long a, long b, long c);
long wide_sum(wide w);
packed packed_make(char tag, int flags, int mode, short n);
int packed_n(packed p);
long calls_made(void);

#endif
