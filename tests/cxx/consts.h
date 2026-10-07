/* consts.h: #defines and enums for the gen-bindings constants tests. */
#ifndef CONSTS_H
#define CONSTS_H

#define LEN_MAX 4096
#define LEN_HALF (LEN_MAX / 2)
#define FLAG_A (1 << 0)
#define FLAG_B (1 << 1)
#define FLAG_BOTH (FLAG_A | FLAG_B)
#define NAME "consts"
#define NAME2 "con" /* adjacent */ "sts"
#define RATIO 0.25
#define MASK 0xffffffffffffffffULL
#define NEG (-LEN_MAX)
#define LETTER 'a'
#define SQUARE(x) ((x) * (x))
#define CAST ((unsigned) 3)
#define _HIDDEN 1
#define EMPTY
#define LONG_LINE 1 + \
  2

enum color { RED, GREEN, BLUE = 4 };

enum { ANON_A = 10, ANON_B = 20 };

enum big { HUGE_ONE = 0x80000000 };

int consts_len(const char* s);

#endif
