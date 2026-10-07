import { dlopen, errno, JSContext, ptr, toArrayBuffer, toString } from 'ffi';
/* test.js
 *
 * A walk through the API on libc, printing what each call gives.
 * The legacy define()/call() interface is in legacy.js (tests/test-legacy.js).
 */
console.log('Hello World');

/* dlopen(null, ...) looks the symbols up in the process, which has libc */
const { symbols: libc, close } = dlopen(null, {
  malloc: { args: ['u64'], returns: 'pointer' },
  free: { args: ['pointer'], returns: 'void' },
  strlen: { args: ['cstring'], returns: 'u64' },
  strdup: { args: ['cstring'], returns: 'pointer' },
  strcpy: { args: ['pointer', 'cstring'], returns: 'pointer' },
  strtoul: { args: ['cstring', 'pointer', 'i32'], returns: 'u64' },
});

/* a missing library is an error, not a null handle */
try {
  dlopen('libnope.so', { x: { args: [], returns: 'void' } });
} catch(e) {
  console.log('dlopen =', e.name, e.message);
}

/* p = malloc(10); display pointer, free(p) */
let p = libc.malloc(10);
console.log(p);
libc.free(p);

/* n = strlen("hello"); which should result in 5n */
console.log(libc.strlen('hello'), 'should be 5n');

/* p = strdup("dup this"), converted back to a string: dup this 8n */
p = libc.strdup('dup this');
console.log(toString(p), libc.strlen(toString(p)));

/* p points to "dup this": 9 bytes with the NUL; slice(0) copies them */
let b = toArrayBuffer(p, 0, 9).slice(0);
console.log(new Uint8Array(b));
libc.free(p);

/* write through a pointer into an ArrayBuffer: q is 4 bytes into b */
b = new ArrayBuffer(32);
const q = ptr(b, 4);
console.log(q, 'should be ' + (ptr(b) + 4));
libc.strcpy(q, 'this pointer');
console.log(toString(q), libc.strlen(toString(q)));

/* 64-bit results are bigint, and errno() is read right after the call */
console.log(libc.strtoul('1234', null, 0), 'should be 1234n');
libc.strtoul('1234567890123456789012345678901234567890', null, 0);
console.log(errno(), 'should be 34 (ERANGE)');

console.log('jscontext =', JSContext());
close();
