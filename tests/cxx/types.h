typedef struct point { int x, y; } point_t;
typedef int (*cmp_t)(const void *, const void *);
typedef enum { RED, GREEN } color_t;
typedef point_t *point_ptr;
struct tail { int n; char data[]; };
