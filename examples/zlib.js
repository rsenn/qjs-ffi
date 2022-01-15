import { strerror, err, out, exit, open } from 'std';
import { read, signal, ttySetRaw, write } from 'os';
import { errno, toString, toArrayBuffer, toPointer, pointerSize } from 'ffi';
import * as zlib from '../lib/zlib.js';

function main(...args) {
  let strm = new zlib.z_stream();
  let ok = zlib.deflateInit(strm);

  console.log('zlib.deflateInit', strm, ok);

  let fd = os.open('out.gz', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644);

  let gzd = zlib.gzdopen(fd, 'w');

  zlib.gzputs(gzd, 'Line #1\n');
  zlib.gzputs(gzd, 'Line #2\n');

  zlib.gzclose(gzd);
  os.close(fd);
}

main(...scriptArgs.slice(1));
