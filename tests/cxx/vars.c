#include "vars.h"

int counter = 5;
const double pi = 3.25;
char name_buf[16] = "hello";
float origin[2] = {1, 2};
int grid[3][2] = {{1, 2}, {3, 4}, {5, 6}};
int big[2000];
struct pt where_ = {3, 4};
const char* greeting = "hi";
void* handle = 0;
int tail[2] = {7, 8};

int bump(void) { return ++counter; }
struct pt pt_swap(struct pt p) { struct pt r = {p.y, p.x}; return r; }
