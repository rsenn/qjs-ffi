/* node-ffi.js: the API of Node's `node:ffi` on top of this module's.
 *
 * ```js
 * import { dlopen, getInt32 } from 'node-ffi.js';
 *
 * const { lib, functions } = dlopen('libm.so.6', {
 *   cos: { arguments: ['float64'], return: 'float64' },
 * });
 *
 * functions.cos(0); // 1
 * lib.close();
 * ```
 *
 * a separate module because the two APIs clash: Node's
 * toArrayBuffer(pointer, length[, copy]) is not bun's
 * toArrayBuffer(ptr, byteOffset, byteLength). where Node differs from
 * `ffi` this module follows Node:
 *
 *   pointers      always a bigint, 0n for NULL (`ffi` has Number | null)
 *   64-bit ints   a bigint to and from C
 *   bool, char    bool is a u8 number, char an i8
 *   string        an argument is UTF-8 for the call; a return is the
 *                 address, as for every pointer
 *   toBuffer      a Uint8Array: QuickJS has no Buffer
 *
 * not here: getCurrentEventLoop() and the permission flags. a callback
 * may throw, and nothing stops it, as nothing checks the thread.
 */
import * as ffi from 'ffi';

const dispose = Symbol.dispose || Symbol.for('Symbol.dispose');

export const suffix = ffi.suffix;

/* node type name -> the ffi type of an argument. */
const ARGUMENTS = {
  void: 'void', char: 'i8', int8: 'i8', i8: 'i8', uint8: 'u8', u8: 'u8', bool: 'u8',
  int16: 'i16', i16: 'i16', uint16: 'u16', u16: 'u16', int32: 'i32', i32: 'i32', uint32: 'u32', u32: 'u32',
  int64: 'i64', i64: 'i64', uint64: 'u64', u64: 'u64',
  float32: 'f32', f32: 'f32', float: 'f32', float64: 'f64', f64: 'f64', double: 'f64',
  pointer: 'pointer', ptr: 'pointer', string: 'cstring', str: 'cstring',
  buffer: 'pointer', arraybuffer: 'pointer', function: 'pointer',
};

/* the same for a return and a callback's arguments: text is an address. */
const RETURNS = { ...ARGUMENTS, string: 'pointer', str: 'pointer' };

const POINTER_TYPES = new Set(['pointer', 'ptr', 'string', 'str', 'buffer', 'arraybuffer', 'function']);

const address = p => (p === null || p === undefined ? 0n : BigInt(p));

function typeOf(table, name) {
  const t = table[name];

  if(t === undefined) throw new TypeError(`unknown type: ${name}`);

  return t;
}

/* a node signature { arguments, return } as an ffi spec. */
function convert(signature = {}, table = ARGUMENTS) {
  return {
    args: (signature.arguments || []).map(t => typeOf(table, t)),
    returns: typeOf(RETURNS, signature.return || 'void'),
  };
}

export class DynamicLibrary {
  #handle;
  #symbols = {};
  #functions = {};
  #callbacks = new Map();

  constructor(path) {
    this.path = path;
    this.#handle = ffi.dlopen(path, ffi.RTLD_NOW);

    if(this.#handle === null) throw new Error(ffi.dlerror() || `cannot open ${path}`);
  }

  get handle() {
    return this.#handle === null ? 0n : BigInt(this.#handle);
  }

  getSymbol(name) {
    const p = ffi.dlsym(this.#check(), name);

    if(p === null) throw new Error(`symbol not found: ${name}`);

    return (this.#symbols[name] = BigInt(p));
  }

  getSymbols() {
    return { ...this.#symbols };
  }

  getFunction(name, signature) {
    const address_ = this.getSymbol(name);
    const { args, returns } = convert(signature);
    const call = ffi.CFunction({ ptr: address_, args, returns });
    const pointerReturn = POINTER_TYPES.has((signature && signature.return) || 'void');
    const fn = pointerReturn ? (...a) => address(call(...a)) : call;

    Object.defineProperty(fn, 'pointer', { value: address_, enumerable: true });
    return (this.#functions[name] = fn);
  }

  getFunctions(definitions) {
    if(!definitions) return { ...this.#functions };

    const out = {};

    for(const name of Object.keys(definitions)) out[name] = this.getFunction(name, definitions[name]);

    return out;
  }

  registerCallback(signature, fn) {
    if(fn === undefined) [signature, fn] = [{}, signature];

    if(typeof fn != 'function') throw new TypeError('the callback must be a function');

    const { args, returns } = convert(signature);
    const arguments_ = signature.arguments || [];
    const wrapped = (...a) => fn(...a.map((v, i) => (POINTER_TYPES.has(arguments_[i]) ? address(v) : v)));
    const callback = new ffi.JSCallback(wrapped, { args: arguments_.map(t => typeOf(RETURNS, t)), returns });
    const pointer = BigInt(callback.ptr);

    this.#callbacks.set(pointer, { callback, strong: callback, weak: new WeakRef(callback) });
    return pointer;
  }

  unregisterCallback(pointer) {
    const entry = this.#callbacks.get(BigInt(pointer));

    if(!entry) return;

    const callback = entry.strong || entry.weak.deref();

    this.#callbacks.delete(BigInt(pointer));
    if(callback) callback.close();
  }

  /* a callback is held strongly from registerCallback() until
   * unrefCallback(); once collected it is gone, as in Node. */
  refCallback(pointer) {
    const entry = this.#callbacks.get(BigInt(pointer));

    if(entry && !entry.strong) entry.strong = entry.weak.deref();
  }

  unrefCallback(pointer) {
    const entry = this.#callbacks.get(BigInt(pointer));

    if(entry) entry.strong = null;
  }

  close() {
    if(this.#handle === null) return;

    for(const pointer of [...this.#callbacks.keys()]) this.unregisterCallback(pointer);

    ffi.dlclose(this.#handle);
    this.#handle = null;
  }

  [dispose]() {
    this.close();
  }

  #check() {
    if(this.#handle === null) throw new Error('the library is closed');

    return this.#handle;
  }
}

/* { lib, functions }: opens `path` and resolves the functions in
 * `definitions`; the result can be closed with `using`. */
export function dlopen(path, definitions) {
  const lib = new DynamicLibrary(path);
  const functions = definitions ? lib.getFunctions(definitions) : {};

  return { lib, functions, close: () => lib.close(), [dispose]: () => lib.close() };
}

export function dlclose(handle) {
  if(handle instanceof DynamicLibrary) handle.close();
  else ffi.dlclose(handle);
}

export function dlsym(handle, symbol) {
  if(handle instanceof DynamicLibrary) return handle.getSymbol(symbol);

  const p = ffi.dlsym(handle, symbol);

  if(p === null) throw new Error(`symbol not found: ${symbol}`);

  return BigInt(p);
}

/* getInt8(pointer[, offset]) ... getFloat64, and setInt8(pointer, offset,
 * value) ... setFloat64: ffi's read and write, under Node's names. */
export const getInt8 = (pointer, offset = 0) => ffi.read.i8(pointer, offset);
export const getUint8 = (pointer, offset = 0) => ffi.read.u8(pointer, offset);
export const getInt16 = (pointer, offset = 0) => ffi.read.i16(pointer, offset);
export const getUint16 = (pointer, offset = 0) => ffi.read.u16(pointer, offset);
export const getInt32 = (pointer, offset = 0) => ffi.read.i32(pointer, offset);
export const getUint32 = (pointer, offset = 0) => ffi.read.u32(pointer, offset);
export const getInt64 = (pointer, offset = 0) => ffi.read.i64(pointer, offset);
export const getUint64 = (pointer, offset = 0) => ffi.read.u64(pointer, offset);
export const getFloat32 = (pointer, offset = 0) => ffi.read.f32(pointer, offset);
export const getFloat64 = (pointer, offset = 0) => ffi.read.f64(pointer, offset);

export const setInt8 = (pointer, offset, value) => ffi.write.i8(pointer, offset, value);
export const setUint8 = (pointer, offset, value) => ffi.write.u8(pointer, offset, value);
export const setInt16 = (pointer, offset, value) => ffi.write.i16(pointer, offset, value);
export const setUint16 = (pointer, offset, value) => ffi.write.u16(pointer, offset, value);
export const setInt32 = (pointer, offset, value) => ffi.write.i32(pointer, offset, value);
export const setUint32 = (pointer, offset, value) => ffi.write.u32(pointer, offset, value);
export const setInt64 = (pointer, offset, value) => ffi.write.i64(pointer, offset, value);
export const setUint64 = (pointer, offset, value) => ffi.write.u64(pointer, offset, value);
export const setFloat32 = (pointer, offset, value) => ffi.write.f32(pointer, offset, value);
export const setFloat64 = (pointer, offset, value) => ffi.write.f64(pointer, offset, value);

/* the C string at `pointer`, or null for 0n. */
export function toString(pointer) {
  return pointer === 0n || pointer === null ? null : ffi.CString(pointer);
}

/* an ArrayBuffer of `length` bytes at `pointer`: a copy, or with
 * `copy` false a view of the memory itself. */
export function toArrayBuffer(pointer, length, copy = true) {
  const view = ffi.toArrayBuffer(pointer, 0, Number(length));

  return copy ? view.slice(0) : view;
}

export function toBuffer(pointer, length, copy = true) {
  return new Uint8Array(toArrayBuffer(pointer, length, copy));
}

/* the number of bytes `text` takes as UTF-8. */
function utf8Length(text) {
  let n = 0;

  for(const c of text) {
    const code = c.codePointAt(0);

    n += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }

  return n;
}

/* copies `text` and a NUL to `pointer`; `length` is the room there is. */
export function exportString(text, pointer, length, encoding = 'utf8') {
  if(!/^utf-?8$/i.test(encoding)) throw new TypeError(`unsupported encoding: ${encoding}`);

  if(utf8Length(text) + 1 > length) throw new RangeError('the string does not fit');

  ffi.write.cstring(pointer, 0, text);
}

/* copies the bytes of a buffer or view to `pointer`; `length` is the room. */
export function exportBuffer(buffer, pointer, length) {
  if(buffer.byteLength > length) throw new RangeError('the buffer does not fit');

  ffi.write.bytes(pointer, 0, buffer);
}

export const exportArrayBuffer = exportBuffer;
export const exportArrayBufferView = exportBuffer;

/* the address of a buffer, a typed array or a DataView, as a bigint. */
export function getRawPointer(source) {
  return BigInt(ffi.ptr(source));
}

export default {
  suffix, DynamicLibrary, dlopen, dlclose, dlsym, toString, toArrayBuffer, toBuffer,
  exportString, exportBuffer, exportArrayBuffer, exportArrayBufferView, getRawPointer,
  getInt8, getUint8, getInt16, getUint16, getInt32, getUint32, getInt64, getUint64, getFloat32, getFloat64,
  setInt8, setUint8, setInt16, setUint16, setInt32, setUint32, setInt64, setUint64, setFloat32, setFloat64,
};
