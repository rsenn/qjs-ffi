#include "structs.h"
#include <stdlib.h>
#include <string.h>

static const char hello[] = "hello";
static struct inner shared = {7, 'k'};

void
sample_fill(struct sample *s) {
  memset(s, 0, sizeof(*s));
  s->i8 = -8;
  s->u8 = 200;
  s->i16 = -1600;
  s->u16 = 60000;
  s->i32 = -123456;
  s->u32 = 4000000000u;
  s->i64 = -(1LL << 40);
  s->u64 = 0xfedcba9876543210ull;
  s->f = 1.5f;
  s->d = -2.25;
  s->flag = 1;
  s->ptr = (void *)0x1234;
  s->name = hello;
  s->color = GREEN;
  s->ua = 5;
  s->sb = -7;
  s->big = 0x123456789aull;
  s->arr[0] = 1, s->arr[1] = 2, s->arr[2] = 3, s->arr[3] = 4;
  strcpy(s->text, "abcdefg");
  s->mat[0][0] = 1, s->mat[0][1] = 2, s->mat[1][0] = 3, s->mat[1][1] = 4;
  s->in.a = -3;
  s->in.b = 'x';
  s->pair[0].a = 1, s->pair[0].b = 'a';
  s->pair[1].a = 2, s->pair[1].b = 'b';
  s->len = sizeof(*s);
  s->slice = 99;
  s->flags[0] = 1, s->flags[2] = 1, s->flags[3] = 1;
  s->cols[0] = GREEN, s->cols[1] = RED;
  s->ptrs[0] = &shared;
  s->names[0] = (char *)hello;
}

/* The values the JS test writes through the generated setters. */
int
sample_check(const struct sample *s) {
  if(s->i8 != -100) return 1;
  if(s->u8 != 250) return 2;
  if(s->i16 != -30000) return 3;
  if(s->u16 != 65000) return 4;
  if(s->i32 != -2000000000) return 5;
  if(s->u32 != 4294967295u) return 6;
  if(s->i64 != -9000000000000000000LL) return 7;
  if(s->u64 != 18000000000000000000ull) return 8;
  if(s->f != 0.25f) return 9;
  if(s->d != 1e100) return 10;
  if(s->flag != 0) return 11;
  if(s->ptr != (void *)0xdeadbeefull) return 12;
  if(s->color != RED) return 14;
  if(s->ua != 6) return 15;
  if(s->sb != -16) return 16;
  if(s->big != 0xffffffffffull) return 17;
  if(s->arr[0] != 10 || s->arr[3] != 40) return 18;
  if(strcmp(s->text, "xyz")) return 19;
  if(s->mat[1][1] != 8.5) return 20;
  if(s->in.a != 77 || s->in.b != 'q') return 21;
  if(s->pair[1].a != 5 || s->pair[1].b != 'z') return 22;
  if(s->len != 12345) return 23;
  if(s->slice != 7) return 24;
  if(s->flags[0] || !s->flags[1] || s->flags[2] || s->flags[3]) return 25;
  if(s->cols[0] != RED || s->cols[1] != GREEN) return 26;
  if(!s->ptrs[1] || s->ptrs[1]->a != 55 || s->ptrs[1]->b != 'p') return 27;
  if(s->names[1] != (char *)0x4321) return 28;
  return 0;
}

struct sample *
sample_new(void) {
  return calloc(1, sizeof(struct sample));
}

void
sample_free(struct sample *s) {
  free(s);
}
