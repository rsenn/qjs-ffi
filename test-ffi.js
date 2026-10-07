import { ptr, toArrayBuffer, toString } from 'ffi';

function main() {
  const bytes = Uint8Array.from('BLAH\nTEST!\0', c => c.charCodeAt(0));
  const p = ptr(bytes);

  const view = toArrayBuffer(p, 4); // the C string at p + 4, not a copy
  const str = toString(p, 5);

  console.log({ bytes, p, view, str });
}

main();
