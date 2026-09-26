import { pointerSize, toPointer, toArrayBuffer } from 'ffi';
import { zlibVersion, deflateInit_, deflateInit2_, inflateInit_, inflateInit2_, inflateBackInit_ } from './zlib.js';

/* Hand-written companion to the generated zlib.js: the generator emits no
 * #define constants, struct layouts or function-like macros. */
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
    return `z_stream_s {\n\t.next_in = ${next_in},\n\t.avail_in = ${avail_in},\n\t.total_in = ${total_in},\n\t.next_out = ${next_out},\n\t.avail_out = ${avail_out},\n\t.total_out = ${total_out},\n\t.msg = ${msg},\n\t.state = ${state},\n\t.zalloc = ${zalloc.toString(
      16,
    )},\n\t.zfree = ${zfree.toString(16)},\n\t.opaque = ${opaque.toString(16)},\n\t.data_type = ${data_type},\n\t.adler = ${adler}\n}`;
  }
}

/* zlib.h defines these as macros around the *_ functions, passing the
 * library version and sizeof(z_stream), so the generator cannot bind them. */
export function deflateInit(strm, level = Z_DEFAULT_STRATEGY, version = zlibVersion(), stream_size = 112) {
  return deflateInit_(strm, level, version, stream_size);
}

export function inflateInit(strm, version = zlibVersion(), stream_size = 112) {
  return inflateInit_(strm, version, stream_size);
}

export function deflateInit2(strm, level, method, windowBits, memLevel, strategy, version = zlibVersion(), stream_size = 112) {
  return deflateInit2_(strm, level, method, windowBits, memLevel, strategy, version, stream_size);
}

export function inflateInit2(strm, windowBits, version = zlibVersion(), stream_size = 112) {
  return inflateInit2_(strm, windowBits, version, stream_size);
}

export function inflateBackInit(strm, windowBits, window, version = zlibVersion(), stream_size = 112) {
  return inflateBackInit_(strm, windowBits, window, version, stream_size);
}
