#include <stddef.h>
#include <stdint.h>

enum color { RED, GREEN = 5 };

struct inner {
  short a;
  char b;
};

typedef struct sample {
  int8_t i8;
  uint8_t u8;
  int16_t i16;
  uint16_t u16;
  int32_t i32;
  uint32_t u32;
  int64_t i64;
  uint64_t u64;
  float f;
  double d;
  _Bool flag;
  void *ptr;
  const char *name;
  enum color color;
  unsigned ua : 3;
  int sb : 5;
  unsigned long long big : 40;
  int arr[4];
  char text[8];
  double mat[2][2];
  struct inner in;
  struct inner pair[2];
  size_t len;
  int slice;
} sample_t;

union number {
  int32_t i;
  float f;
  unsigned char bytes[4];
};

/* Sets every member of *s to a known value. */
void sample_fill(struct sample *s);
/* 0 if *s holds the values sample_expect() lists, else the 1-based index of the first member that differs. */
int sample_check(const struct sample *s);
struct sample *sample_new(void);
void sample_free(struct sample *s);
