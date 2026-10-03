#ifndef VARS_H
#define VARS_H

struct pt { float x, y; };

extern int counter;
extern const double pi;
extern char name_buf[16];
extern float origin[2];
extern int grid[3][2];
extern int big[2000];
extern struct pt where_;
extern const char* greeting;
extern void* handle;
extern int tail[];
static const int N = 5;

int bump(void);
int log_it(const char* fmt, ...);
struct pt pt_swap(struct pt p);

#endif
