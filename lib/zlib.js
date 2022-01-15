import { dlopen, define, dlerror, dlclose, dlsym, call, errno, RTLD_NOW, pointerSize } from 'ffi';

const libz = dlopen('libz.so.1', RTLD_NOW);

export const Z_NO_FLUSH = 0;
export const Z_PARTIAL_FLUSH = 1;
export const Z_SYNC_FLUSH = 2;
export const Z_FULL_FLUSH = 3;
export const Z_FINISH = 4;
export const Z_BLOCK = 5;
export const Z_TREES = 6;
export const Z_OK = 0;
export const Z_STREAM_END = 1;
export const Z_NEED_DICT = 2;
export const Z_ERRNO = -1;
export const Z_STREAM_ERROR = -2;
export const Z_DATA_ERROR = -3;
export const Z_MEM_ERROR = -4;
export const Z_BUF_ERROR = -5;
export const Z_VERSION_ERROR = -6;
export const Z_NO_COMPRESSION = 0;
export const Z_BEST_SPEED = 1;
export const Z_BEST_COMPRESSION = 9;
export const Z_DEFAULT_COMPRESSION = -1;
export const Z_FILTERED = 1;
export const Z_HUFFMAN_ONLY = 2;
export const Z_RLE = 3;
export const Z_FIXED = 4;
export const Z_DEFAULT_STRATEGY = 0;
export const Z_BINARY = 0;
export const Z_TEXT = 1;
export const Z_ASCII = Z_TEXT;
export const Z_UNKNOWN = 2;
export const Z_DEFLATED = 8;
export const Z_NULL = 0;

const PointerArray = pointerSize == 8 ? BigInt64Array : Uint32Array;

export class z_stream extends ArrayBuffer {
  constructor(obj = {}) {
    super(14 * pointerSize);
    Object.assign(this, obj);
  }
  get [Symbol.toStringTag]() {
    return `[z_stream_s @ ${this} ]`;
  }

  /* 0: Bytef* next_in */
  set next_in(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, 0)[0] = BigInt(value);
  }
  get next_in() {
    return '0x' + new PointerArray(this, 0)[0].toString(16);
  }

  /* 8: uInt (unsigned int) avail_in */
  set avail_in(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new Int32Array(this, pointerSize * 1)[0] = value;
  }
  get avail_in() {
    return new Int32Array(this, pointerSize * 1)[0];
  }

  /* 16: uLong (unsigned long) total_in */
  set total_in(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, pointerSize * 2)[0] = BigInt(value);
  }
  get total_in() {
    return new PointerArray(this, pointerSize * 2)[0];
  }

  /* 24: Bytef* next_out */
  set next_out(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, pointerSize * 3)[0] = BigInt(value);
  }
  get next_out() {
    return '0x' + new PointerArray(this, pointerSize * 3)[0].toString(16);
  }

  /* 32: uInt (unsigned int) avail_out */
  set avail_out(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new Int32Array(this, pointerSize * 4)[0] = value;
  }
  get avail_out() {
    return new Int32Array(this, pointerSize * 4)[0];
  }

  /* 40: uLong (unsigned long) total_out */
  set total_out(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, pointerSize * 5)[0] = BigInt(value);
  }
  get total_out() {
    return new PointerArray(this, pointerSize * 5)[0];
  }

  /* 48: char* msg */
  set msg(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, pointerSize * 6)[0] = BigInt(value);
  }
  get msg() {
    return new PointerArray(this, pointerSize * 6)[0];
  }

  /* 56: struct internal_state* state */
  set state(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, pointerSize * 7)[0] = BigInt(value);
  }
  get state() {
    return new PointerArray(this, pointerSize * 7)[0];
  }

  /* 64: alloc_func (voidpf (*)(voidpf, uInt, uInt)) zalloc */
  set zalloc(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, pointerSize * 8)[0] = BigInt(value);
  }
  get zalloc() {
    return '0x' + new PointerArray(this, pointerSize * 8)[0].toString(16);
  }

  /* 72: free_func (void (*)(voidpf, voidpf)) zfree */
  set zfree(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, pointerSize * 9)[0] = BigInt(value);
  }
  get zfree() {
    return '0x' + new PointerArray(this, pointerSize * 9)[0].toString(16);
  }

  /* pointerSize * 10: voidpf (void *) opaque */
  set opaque(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, pointerSize * 10)[0] = BigInt(value);
  }
  get opaque() {
    return '0x' + new PointerArray(this, pointerSize * 10)[0].toString(16);
  }

  /* pointerSize * 11: int data_type */
  set data_type(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new Int32Array(this, pointerSize * 11)[0] = value;
  }
  get data_type() {
    return new Int32Array(this, pointerSize * 11)[0];
  }

  /* 12: uLong (unsigned long) adler */
  set adler(value) {
    if(typeof value == 'object' && value != null && value instanceof ArrayBuffer) value = toPointer(value);
    new PointerArray(this, pointerSize * 12)[0] = BigInt(value);
  }
  get adler() {
    return new PointerArray(this, pointerSize * 12)[0];
  }

  static from(address) {
    let ret = toArrayBuffer(address, 104);
    return Object.setPrototypeOf(ret, z_stream_s.prototype);
  }

  toString() {
    const { next_in, avail_in, total_in, next_out, avail_out, total_out, msg, state, zalloc, zfree, opaque, data_type, adler } = this;
    return `z_stream_s {\n\t.next_in = ${next_in},\n\t.avail_in = ${avail_in},\n\t.total_in = ${total_in},\n\t.next_out = ${next_out},\n\t.avail_out = ${avail_out},\n\t.total_out = ${total_out},\n\t.msg = ${msg},\n\t.state = ${state},\n\t.zalloc = ${zalloc.toString(16)},\n\t.zfree = ${zfree.toString(16)},\n\t.opaque = ${opaque.toString(16)},\n\t.data_type = ${data_type},\n\t.adler = ${adler}\n}`;
  }
}

/**
 * @function zlibVersion
 *
 * @return   {String}
 */
define('zlibVersion', dlsym(libz, 'zlibVersion'), null, 'char *');
export function zlibVersion() {
  return call('zlibVersion');
}

/**
 * @function deflate
 *
 * @param    {Number}        strm
 * @param    {Number}        flush
 *
 * @return   {Number}
 */
define('deflate', dlsym(libz, 'deflate'), null, 'int', 'void *', 'int');
export function deflate(strm, flush) {
  return call('deflate', strm, flush);
}

/**
 * @function deflateEnd
 *
 * @param    {Number}        strm
 *
 * @return   {Number}
 */
define('deflateEnd', dlsym(libz, 'deflateEnd'), null, 'int', 'void *');
export function deflateEnd(strm) {
  return call('deflateEnd', strm);
}

/**
 * @function inflate
 *
 * @param    {Number}        strm
 * @param    {Number}        flush
 *
 * @return   {Number}
 */
define('inflate', dlsym(libz, 'inflate'), null, 'int', 'void *', 'int');
export function inflate(strm, flush) {
  return call('inflate', strm, flush);
}

/**
 * @function inflateEnd
 *
 * @param    {Number}        strm
 *
 * @return   {Number}
 */
define('inflateEnd', dlsym(libz, 'inflateEnd'), null, 'int', 'void *');
export function inflateEnd(strm) {
  return call('inflateEnd', strm);
}

/**
 * @function deflateSetDictionary
 *
 * @param    {Number}        strm
 * @param    {Number}        dictionary
 * @param    {Number}        dictLength
 *
 * @return   {Number}
 */
define('deflateSetDictionary', dlsym(libz, 'deflateSetDictionary'), null, 'int', 'void *', 'long', 'unsigned int');
export function deflateSetDictionary(strm, dictionary, dictLength) {
  return call('deflateSetDictionary', strm, dictionary, dictLength);
}

/**
 * @function deflateGetDictionary
 *
 * @param    {Number}        strm
 * @param    {Number}        dictionary
 * @param    {Number}        dictLength
 *
 * @return   {Number}
 */
define('deflateGetDictionary', dlsym(libz, 'deflateGetDictionary'), null, 'int', 'void *', 'long', 'long');
export function deflateGetDictionary(strm, dictionary, dictLength) {
  return call('deflateGetDictionary', strm, dictionary, dictLength);
}

/**
 * @function deflateCopy
 *
 * @param    {Number}        dest
 * @param    {Number}        source
 *
 * @return   {Number}
 */
define('deflateCopy', dlsym(libz, 'deflateCopy'), null, 'int', 'void *', 'void *');
export function deflateCopy(dest, source) {
  return call('deflateCopy', dest, source);
}

/**
 * @function deflateReset
 *
 * @param    {Number}        strm
 *
 * @return   {Number}
 */
define('deflateReset', dlsym(libz, 'deflateReset'), null, 'int', 'void *');
export function deflateReset(strm) {
  return call('deflateReset', strm);
}

/**
 * @function deflateParams
 *
 * @param    {Number}        strm
 * @param    {Number}        level
 * @param    {Number}        strategy
 *
 * @return   {Number}
 */
define('deflateParams', dlsym(libz, 'deflateParams'), null, 'int', 'void *', 'int', 'int');
export function deflateParams(strm, level, strategy) {
  return call('deflateParams', strm, level, strategy);
}

/**
 * @function deflateTune
 *
 * @param    {Number}        strm
 * @param    {Number}        good_length
 * @param    {Number}        max_lazy
 * @param    {Number}        nice_length
 * @param    {Number}        max_chain
 *
 * @return   {Number}
 */
define('deflateTune', dlsym(libz, 'deflateTune'), null, 'int', 'void *', 'int', 'int', 'int', 'int');
export function deflateTune(strm, good_length, max_lazy, nice_length, max_chain) {
  return call('deflateTune', strm, good_length, max_lazy, nice_length, max_chain);
}

/**
 * @function deflatePending
 *
 * @param    {Number}        strm
 * @param    {Number}        pending
 * @param    {Number}        bits
 *
 * @return   {Number}
 */
define('deflatePending', dlsym(libz, 'deflatePending'), null, 'int', 'void *', 'unsigned long', 'long');
export function deflatePending(strm, pending, bits) {
  return call('deflatePending', strm, pending, bits);
}

/**
 * @function deflatePrime
 *
 * @param    {Number}        strm
 * @param    {Number}        bits
 * @param    {Number}        value
 *
 * @return   {Number}
 */
define('deflatePrime', dlsym(libz, 'deflatePrime'), null, 'int', 'void *', 'int', 'int');
export function deflatePrime(strm, bits, value) {
  return call('deflatePrime', strm, bits, value);
}

/**
 * @function deflateSetHeader
 *
 * @param    {Number}        strm
 * @param    {Number}        head
 *
 * @return   {Number}
 */
define('deflateSetHeader', dlsym(libz, 'deflateSetHeader'), null, 'int', 'void *', 'void *');
export function deflateSetHeader(strm, head) {
  return call('deflateSetHeader', strm, head);
}

/**
 * @function inflateSetDictionary
 *
 * @param    {Number}        strm
 * @param    {Number}        dictionary
 * @param    {Number}        dictLength
 *
 * @return   {Number}
 */
define('inflateSetDictionary', dlsym(libz, 'inflateSetDictionary'), null, 'int', 'void *', 'long', 'unsigned int');
export function inflateSetDictionary(strm, dictionary, dictLength) {
  return call('inflateSetDictionary', strm, dictionary, dictLength);
}

/**
 * @function inflateGetDictionary
 *
 * @param    {Number}        strm
 * @param    {Number}        dictionary
 * @param    {Number}        dictLength
 *
 * @return   {Number}
 */
define('inflateGetDictionary', dlsym(libz, 'inflateGetDictionary'), null, 'int', 'void *', 'long', 'long');
export function inflateGetDictionary(strm, dictionary, dictLength) {
  return call('inflateGetDictionary', strm, dictionary, dictLength);
}

/**
 * @function inflateSync
 *
 * @param    {Number}        strm
 *
 * @return   {Number}
 */
define('inflateSync', dlsym(libz, 'inflateSync'), null, 'int', 'void *');
export function inflateSync(strm) {
  return call('inflateSync', strm);
}

/**
 * @function inflateCopy
 *
 * @param    {Number}        dest
 * @param    {Number}        source
 *
 * @return   {Number}
 */
define('inflateCopy', dlsym(libz, 'inflateCopy'), null, 'int', 'void *', 'void *');
export function inflateCopy(dest, source) {
  return call('inflateCopy', dest, source);
}

/**
 * @function inflateReset
 *
 * @param    {Number}        strm
 *
 * @return   {Number}
 */
define('inflateReset', dlsym(libz, 'inflateReset'), null, 'int', 'void *');
export function inflateReset(strm) {
  return call('inflateReset', strm);
}

/**
 * @function inflateReset2
 *
 * @param    {Number}        strm
 * @param    {Number}        windowBits
 *
 * @return   {Number}
 */
define('inflateReset2', dlsym(libz, 'inflateReset2'), null, 'int', 'void *', 'int');
export function inflateReset2(strm, windowBits) {
  return call('inflateReset2', strm, windowBits);
}

/**
 * @function inflatePrime
 *
 * @param    {Number}        strm
 * @param    {Number}        bits
 * @param    {Number}        value
 *
 * @return   {Number}
 */
define('inflatePrime', dlsym(libz, 'inflatePrime'), null, 'int', 'void *', 'int', 'int');
export function inflatePrime(strm, bits, value) {
  return call('inflatePrime', strm, bits, value);
}

/**
 * @function inflateMark
 *
 * @param    {Number}        strm
 *
 * @return   {Number}
 */
define('inflateMark', dlsym(libz, 'inflateMark'), null, 'long', 'void *');
export function inflateMark(strm) {
  return call('inflateMark', strm);
}

/**
 * @function inflateGetHeader
 *
 * @param    {Number}        strm
 * @param    {Number}        head
 *
 * @return   {Number}
 */
define('inflateGetHeader', dlsym(libz, 'inflateGetHeader'), null, 'int', 'void *', 'void *');
export function inflateGetHeader(strm, head) {
  return call('inflateGetHeader', strm, head);
}

/**
 * @function inflateBack
 *
 * @param    {Number}        strm
 * @param    {Number}        in
 * @param    {Number}        in_desc
 * @param    {Number}        out
 * @param    {Number}        out_desc
 *
 * @return   {Number}
 */
define('inflateBack', dlsym(libz, 'inflateBack'), null, 'int', 'void *', 'void *', 'long', 'void *', 'long');
export function inputflateBack(strm, input, input_desc, out, out_desc) {
  return call('inflateBack', strm, input, input_desc, out, out_desc);
}

/**
 * @function inflateBackEnd
 *
 * @param    {Number}        strm
 *
 * @return   {Number}
 */
define('inflateBackEnd', dlsym(libz, 'inflateBackEnd'), null, 'int', 'void *');
export function inflateBackEnd(strm) {
  return call('inflateBackEnd', strm);
}

/**
 * @function compress
 *
 * @param    {Number}        dest
 * @param    {Number}        destLen
 * @param    {Number}        source
 * @param    {Number}        sourceLen
 *
 * @return   {Number}
 */
define('compress', dlsym(libz, 'compress'), null, 'int', 'long', 'long', 'long', 'unsigned long');
export function compress(dest, destLen, source, sourceLen) {
  return call('compress', dest, destLen, source, sourceLen);
}

/**
 * @function compress2
 *
 * @param    {Number}        dest
 * @param    {Number}        destLen
 * @param    {Number}        source
 * @param    {Number}        sourceLen
 * @param    {Number}        level
 *
 * @return   {Number}
 */
define('compress2', dlsym(libz, 'compress2'), null, 'int', 'long', 'long', 'long', 'unsigned long', 'int');
export function compress2(dest, destLen, source, sourceLen, level) {
  return call('compress2', dest, destLen, source, sourceLen, level);
}

/**
 * @function uncompress
 *
 * @param    {Number}        dest
 * @param    {Number}        destLen
 * @param    {Number}        source
 * @param    {Number}        sourceLen
 *
 * @return   {Number}
 */
define('uncompress', dlsym(libz, 'uncompress'), null, 'int', 'long', 'long', 'long', 'unsigned long');
export function uncompress(dest, destLen, source, sourceLen) {
  return call('uncompress', dest, destLen, source, sourceLen);
}

/**
 * @function uncompress2
 *
 * @param    {Number}        dest
 * @param    {Number}        destLen
 * @param    {Number}        source
 * @param    {Number}        sourceLen
 *
 * @return   {Number}
 */
define('uncompress2', dlsym(libz, 'uncompress2'), null, 'int', 'long', 'long', 'long', 'long');
export function uncompress2(dest, destLen, source, sourceLen) {
  return call('uncompress2', dest, destLen, source, sourceLen);
}

/**       
 * @function gzdopen         
 * 
 * @param    {Number}        fd
 * @param    {String}        mode
 */
define('gzdopen', dlsym(libz, 'gzdopen'), null, 'void *', 'int', 'char *');
export function gzdopen(fd, mode) {
  return call('gzdopen', fd, mode);
}


/**
 * @function gzbuffer
 *
 * @param    {Number}        file
 * @param    {Number}        size
 *
 * @return   {Number}
 */
define('gzbuffer', dlsym(libz, 'gzbuffer'), null, 'int', 'void *', 'unsigned int');
export function gzbuffer(file, size) {
  return call('gzbuffer', file, size);
}

/**
 * @function gzsetparams
 *
 * @param    {Number}        file
 * @param    {Number}        level
 * @param    {Number}        strategy
 *
 * @return   {Number}
 */
define('gzsetparams', dlsym(libz, 'gzsetparams'), null, 'int', 'void *', 'int', 'int');
export function gzsetparams(file, level, strategy) {
  return call('gzsetparams', file, level, strategy);
}

/**
 * @function gzread
 *
 * @param    {Number}        file
 * @param    {Number}        buf
 * @param    {Number}        len
 *
 * @return   {Number}
 */
define('gzread', dlsym(libz, 'gzread'), null, 'int', 'void *', 'void *', 'unsigned int');
export function gzread(file, buf, len) {
  return call('gzread', file, buf, len);
}

/**
 * @function gzwrite
 *
 * @param    {Number}        file
 * @param    {Number}        buf
 * @param    {Number}        len
 *
 * @return   {Number}
 */
define('gzwrite', dlsym(libz, 'gzwrite'), null, 'int', 'void *', 'void *', 'unsigned int');
export function gzwrite(file, buf, len) {
  return call('gzwrite', file, buf, len);
}

/**
 * @function gzprintf
 *
 * @param    {Number}        file
 * @param    {String}        format
 *
 * @return   {Number}
 */
define('gzprintf', dlsym(libz, 'gzprintf'), null, 'int', 'void *', 'char *');
export function gzprintf(file, format) {
  return call('gzprintf', file, format);
}

/**
 * @function gzputs
 *
 * @param    {Number}        file
 * @param    {String}        s
 *
 * @return   {Number}
 */
define('gzputs', dlsym(libz, 'gzputs'), null, 'int', 'void *', 'char *');
export function gzputs(file, s) {
  return call('gzputs', file, s);
}

/**
 * @function gzgets
 *
 * @param    {Number}        file
 * @param    {String}        buf
 * @param    {Number}        len
 *
 * @return   {String}
 */
define('gzgets', dlsym(libz, 'gzgets'), null, 'char *', 'void *', 'char *', 'int');
export function gzgets(file, buf, len) {
  return call('gzgets', file, buf, len);
}

/**
 * @function gzputc
 *
 * @param    {Number}        file
 * @param    {Number}        c
 *
 * @return   {Number}
 */
define('gzputc', dlsym(libz, 'gzputc'), null, 'int', 'void *', 'int');
export function gzputc(file, c) {
  return call('gzputc', file, c);
}

/**
 * @function gzgetc
 *
 * @param    {Number}        file
 *
 * @return   {Number}
 */
define('gzgetc', dlsym(libz, 'gzgetc'), null, 'int', 'void *');
export function gzgetc(file) {
  return call('gzgetc', file);
}

/**
 * @function gzungetc
 *
 * @param    {Number}        c
 * @param    {Number}        file
 *
 * @return   {Number}
 */
define('gzungetc', dlsym(libz, 'gzungetc'), null, 'int', 'int', 'void *');
export function gzungetc(c, file) {
  return call('gzungetc', c, file);
}

/**
 * @function gzflush
 *
 * @param    {Number}        file
 * @param    {Number}        flush
 *
 * @return   {Number}
 */
define('gzflush', dlsym(libz, 'gzflush'), null, 'int', 'void *', 'int');
export function gzflush(file, flush) {
  return call('gzflush', file, flush);
}

/**
 * @function gzrewind
 *
 * @param    {Number}        file
 *
 * @return   {Number}
 */
define('gzrewind', dlsym(libz, 'gzrewind'), null, 'int', 'void *');
export function gzrewind(file) {
  return call('gzrewind', file);
}

/**
 * @function gzeof
 *
 * @param    {Number}        file
 *
 * @return   {Number}
 */
define('gzeof', dlsym(libz, 'gzeof'), null, 'int', 'void *');
export function gzeof(file) {
  return call('gzeof', file);
}

/**
 * @function gzdirect
 *
 * @param    {Number}        file
 *
 * @return   {Number}
 */
define('gzdirect', dlsym(libz, 'gzdirect'), null, 'int', 'void *');
export function gzdirect(file) {
  return call('gzdirect', file);
}

/**
 * @function gzclose
 *
 * @param    {Number}        file
 *
 * @return   {Number}
 */
define('gzclose', dlsym(libz, 'gzclose'), null, 'int', 'void *');
export function gzclose(file) {
  return call('gzclose', file);
}

/**
 * @function gzclose_r
 *
 * @param    {Number}        file
 *
 * @return   {Number}
 */
define('gzclose_r', dlsym(libz, 'gzclose_r'), null, 'int', 'void *');
export function gzclose_r(file) {
  return call('gzclose_r', file);
}

/**
 * @function gzclose_w
 *
 * @param    {Number}        file
 *
 * @return   {Number}
 */
define('gzclose_w', dlsym(libz, 'gzclose_w'), null, 'int', 'void *');
export function gzclose_w(file) {
  return call('gzclose_w', file);
}

/**
 * @function gzerror
 *
 * @param    {Number}        file
 * @param    {Number}        errnum
 *
 * @return   {String}
 */
define('gzerror', dlsym(libz, 'gzerror'), null, 'char *', 'void *', 'long');
export function gzerror(file, errnum) {
  return call('gzerror', file, errnum);
}

/**
 * @function gzclearerr
 *
 * @param    {Number}        file
 */
define('gzclearerr', dlsym(libz, 'gzclearerr'), null, 'void', 'void *');
export function gzclearerr(file) {
  call('gzclearerr', file);
}

/**
 * @function deflateInit_
 *
 * @param    {Number}        strm
 * @param    {Number}        level
 * @param    {String}        version
 * @param    {Number}        stream_size
 *
 * @return   {Number}
 */
define('deflateInit_', dlsym(libz, 'deflateInit_'), null, 'int', 'void *', 'int', 'char *', 'int');
export function deflateInit(strm, level = Z_DEFAULT_STRATEGY, version = zlibVersion(), stream_size = 112) {
  return call('deflateInit_', strm, level, version, stream_size);
}

/**
 * @function inflateInit_
 *
 * @param    {Number}        strm
 * @param    {String}        version
 * @param    {Number}        stream_size
 *
 * @return   {Number}
 */
define('inflateInit_', dlsym(libz, 'inflateInit_'), null, 'int', 'void *', 'char *', 'int');
export function inflateInit(strm, version = zlibVersion(), stream_size = 112) {
  return call('inflateInit_', strm, version, stream_size);
}

/**
 * @function deflateInit2_
 *
 * @param    {Number}        strm
 * @param    {Number}        level
 * @param    {Number}        method
 * @param    {Number}        windowBits
 * @param    {Number}        memLevel
 * @param    {Number}        strategy
 * @param    {String}        version
 * @param    {Number}        stream_size
 *
 * @return   {Number}
 */
define('deflateInit2_', dlsym(libz, 'deflateInit2_'), null, 'int', 'void *', 'int', 'int', 'int', 'int', 'int', 'char *', 'int');
export function deflateInit2(strm, level, method, windowBits, memLevel, strategy, version = zlibVersion(), stream_size = 112) {
  return call('deflateInit2_', strm, level, method, windowBits, memLevel, strategy, version, stream_size);
}

/**
 * @function inflateInit2_
 *
 * @param    {Number}        strm
 * @param    {Number}        windowBits
 * @param    {String}        version
 * @param    {Number}        stream_size
 *
 * @return   {Number}
 */
define('inflateInit2_', dlsym(libz, 'inflateInit2_'), null, 'int', 'void *', 'int', 'char *', 'int');
export function inflateInit2(strm, windowBits, version = zlibVersion(), stream_size = 112) {
  return call('inflateInit2_', strm, windowBits, version, stream_size);
}

/**
 * @function inflateBackInit_
 *
 * @param    {Number}        strm
 * @param    {Number}        windowBits
 * @param    {Number}        window
 * @param    {String}        version
 * @param    {Number}        stream_size
 *
 * @return   {Number}
 */
define('inflateBackInit_', dlsym(libz, 'inflateBackInit_'), null, 'int', 'void *', 'int', 'unsigned long', 'char *', 'int');
export function inflateBackInit(strm, windowBits, window, version = zlibVersion(), stream_size = 112) {
  return call('inflateBackInit_', strm, windowBits, window, version, stream_size);
}

/**
 * @function gzgetc_
 *
 * @param    {Number}        file
 *
 * @return   {Number}
 */
define('gzgetc_', dlsym(libz, 'gzgetc_'), null, 'int', 'void *');
export function gzgetc_(file) {
  return call('gzgetc_', file);
}

/**
 * @function zError
 *
 * @param    {Number}        arg1
 *
 * @return   {String}
 */
define('zError', dlsym(libz, 'zError'), null, 'char *', 'int');
export function zError(arg1) {
  return call('zError', arg1);
}

/**
 * @function inflateSyncPoint
 *
 * @param    {Number}        arg1
 *
 * @return   {Number}
 */
define('inflateSyncPoint', dlsym(libz, 'inflateSyncPoint'), null, 'int', 'void *');
export function inflateSyncPoint(arg1) {
  return call('inflateSyncPoint', arg1);
}

/**
 * @function get_crc_table
 *
 * @return   {Number}
 */
define('get_crc_table', dlsym(libz, 'get_crc_table'), null, 'void *');
export function get_crc_table() {
  return call('get_crc_table');
}

/**
 * @function inflateUndermine
 *
 * @param    {Number}        arg1
 * @param    {Number}        arg2
 *
 * @return   {Number}
 */
define('inflateUndermine', dlsym(libz, 'inflateUndermine'), null, 'int', 'void *', 'int');
export function inflateUndermine(arg1, arg2) {
  return call('inflateUndermine', arg1, arg2);
}

/**
 * @function inflateValidate
 *
 * @param    {Number}        arg1
 * @param    {Number}        arg2
 *
 * @return   {Number}
 */
define('inflateValidate', dlsym(libz, 'inflateValidate'), null, 'int', 'void *', 'int');
export function inflateValidate(arg1, arg2) {
  return call('inflateValidate', arg1, arg2);
}

/**
 * @function inflateCodesUsed
 *
 * @param    {Number}        arg1
 *
 * @return   {Number}
 */
define('inflateCodesUsed', dlsym(libz, 'inflateCodesUsed'), null, 'unsigned long', 'void *');
export function inflateCodesUsed(arg1) {
  return call('inflateCodesUsed', arg1);
}

/**
 * @function inflateResetKeep
 *
 * @param    {Number}        arg1
 *
 * @return   {Number}
 */
define('inflateResetKeep', dlsym(libz, 'inflateResetKeep'), null, 'int', 'void *');
export function inflateResetKeep(arg1) {
  return call('inflateResetKeep', arg1);
}

/**
 * @function deflateResetKeep
 *
 * @param    {Number}        arg1
 *
 * @return   {Number}
 */
define('deflateResetKeep', dlsym(libz, 'deflateResetKeep'), null, 'int', 'void *');
export function deflateResetKeep(arg1) {
  return call('deflateResetKeep', arg1);
}

/**
 * @function gzvprintf
 *
 * @param    {Number}        file
 * @param    {String}        format
 * @param    {Number}        va
 *
 * @return   {Number}
 */
define('gzvprintf', dlsym(libz, 'gzvprintf'), null, 'int', 'void *', 'char *', 'long');
export function gzvprintf(file, format, va) {
  return call('gzvprintf', file, format, va);
}
