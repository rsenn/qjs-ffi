import { CallClosure, debug, dlopen, dlerror, dlclose, dlsym, define, call, toString, toArrayBuffer, toPointer, errno, JSContext, RTLD_LAZY, RTLD_NOW, RTLD_GLOBAL, RTLD_LOCAL, RTLD_NODELETE, RTLD_NOLOAD, RTLD_DEEPBIND, RTLD_DEFAULT, RTLD_NEXT, pointerSize, } from 'ffi';

function main() {
  let ab = toArrayBuffer('BLAH\nTEST!\0');
  let ptr = toPointer(ab);

  let ab2 = toArrayBuffer(ptr, 4, false);
  console.log('ptr', ptr);
  let str = toString(ptr, 0);

  console.log({ ab, ptr, ab2, str });
}

main();
