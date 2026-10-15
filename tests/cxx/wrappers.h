#ifndef WRAPPERS_H
#define WRAPPERS_H

/* an opaque handle with a make/free pair and a live counter */
typedef struct thing thing;

int thing_make(int value, thing **out);   /* 0 ok; value < 0 fails, *out is still set */
thing *thing_new(int value);
int thing_value(thing *t);
int thing_free(thing *t);
long things_live(void);

/* text */
unsigned char *thing_name(int id);        /* static string */
char *name_alloc(int id);                 /* malloc'd, freed by name_free */
void name_free(char *name);
long names_live(void);
char *name_libc(int id);                  /* malloc'd, freed by libc free */

/* out-parameters */
void minmax(int a, int b, int *lo, int *hi);
int divmod(int a, int b, int *quotient, int *remainder);   /* 1 when b == 0 */
int half(double x, double *out);
int label(int id, const char **name);

#endif
