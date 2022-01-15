import { strerror, err, out, exit, open } from 'std';
import { read, signal, ttySetRaw, write } from 'os';
import { errno, toString, toArrayBuffer, toPointer, pointerSize } from 'ffi';
import * as zlib from '../lib/zlib.js';

function main(...args) {
  let strm = new zlib.z_stream();
  let ok = zlib.deflateInit(strm);

  console.log('zlib.deflateInit', strm, ok);
}

main(...scriptArgs.slice(1));
