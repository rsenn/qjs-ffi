/* legacy.js -- the original define()/call() interface of the ffi module, on
 * top of CFunction.
 *
 *   import { define, call } from 'legacy.js';
 *
 *   define('strlen', dlsym(RTLD_DEFAULT, 'strlen'), null, 'int', 'char *');
 *   call('strlen', 'hello');   // 5
 *
 * define(name, functionPointer, abi, returnType, ...parameterTypes) registers
 * the function under `name` and returns true, or false (with a message on
 * stderr) if a type is unknown or unsupported. A name that is already
 * defined is left as it is and true is returned. call(name, ...args) calls it.
 *
 * Differences from the CFunction API are kept as they were:
 *   - every result is a number (a double): 64-bit integers and pointers lose
 *     precision above 2^53, a void function gives 0, a NULL pointer 0. Only a
 *     "string" or "char *" return type gives a string (null for NULL).
 *   - a JavaScript string passed for a pointer parameter is copied, with its
 *     terminating NUL, and the pointer is that of the copy; an ArrayBuffer or
 *     view is passed by address (so the callee can write to it); true and
 *     false are 1 and 0, null is NULL, and a JSCallback is its function
 *     pointer.
 *   - up to 30 parameters.
 *
 * The type names are the legacy ones, not those of FFIType: libffi's ("sint8",
 * "uint32", "double", "pointer", ...), C-like ones ("int", "long", "size_t",
 * "unsigned char", "char *", "void *") and "string", "buffer", "callback". Any
 * name ending in "*" is a pointer. "longdouble" has no CFunction type and is
 * refused. "size_t" is 64 bits wide (the old implementation made it 32).
 */
import { CFunction, JSCallback, toArrayBuffer } from 'ffi';

const MAX_PARAMETERS = 30;

/* legacy type name -> CFunction type; 64-bit integers go through the
 * `_fast` types, which are numbers like everything else here. */
const TYPES = {
  void: 'void',
  sint8: 'i8',
  schar: 'i8',
  char: 'i8',
  uint8: 'u8',
  uchar: 'u8',
  'unsigned char': 'u8',
  sint16: 'i16',
  sshort: 'i16',
  short: 'i16',
  uint16: 'u16',
  ushort: 'u16',
  sint32: 'i32',
  sint: 'i32',
  int: 'i32',
  uint32: 'u32',
  uint: 'u32',
  'unsigned int': 'u32',
  sint64: 'i64_fast',
  slong: 'i64_fast',
  long: 'i64_fast',
  uint64: 'u64_fast',
  ulong: 'u64_fast',
  'unsigned long': 'u64_fast',
  size_t: 'u64_fast',
  float: 'f32',
  double: 'f64',
  pointer: 'pointer',
  'void *': 'pointer',
  'char *': 'pointer',
  string: 'pointer',
  buffer: 'pointer',
  callback: 'pointer',
  'opaque*': 'pointer',
};

/* The CFunction type of a legacy type name, or undefined. */
function typeOf(name) {
  if(Object.prototype.hasOwnProperty.call(TYPES, name)) return TYPES[name];
  return /\*\s*$/.test(name) ? 'pointer' : undefined;
}

/* Return types that give a string. */
const isString = name => name === 'string' || name === 'char *';

const functions = new Map();

/* Registers a function; see the header. */
export function define(name, fp, abi, rtype, ...types) {
  name = String(name);

  if(fp === null || fp === undefined || fp === 0 || fp === 0n) throw new TypeError('argument 2 must be a pointer that is not NULL');

  if(functions.has(name)) return true;

  if(rtype === undefined || rtype === null) rtype = 'void';

  const args = [];

  for(const t of types.slice(0, MAX_PARAMETERS)) {
    const a = typeOf(String(t));

    if(a === undefined) {
      console.error('define_function: no such type');
      return false;
    }

    args.push(a);
  }

  const returns = isString(String(rtype)) ? 'cstring' : typeOf(String(rtype));

  if(returns === undefined) {
    console.error('define_function: no such return type');
    return false;
  }

  let fn;

  try {
    fn = CFunction({ ptr: fp, args, returns, ...(abi === null || abi === undefined ? {} : { abi: String(abi) }) });
  } catch(e) {
    console.error('define_function: ' + e.message);
    return false;
  }

  functions.set(name, { fn, pointers: args.map(a => a === 'pointer'), returns });
  return true;
}

/* A pointer argument as CFunction takes it. */
function pointerArg(v) {
  if(typeof v === 'string') return toArrayBuffer(v + '\0');
  if(v instanceof JSCallback) return v.ptr;
  if(typeof v === 'boolean') return +v;
  return v;
}

/* Calls a defined function; see the header. */
export function call(name, ...args) {
  const f = functions.get(String(name));

  if(!f) throw new Error('call_function: no such function: ' + name);

  const values = f.pointers.map((isPointer, i) => (isPointer ? pointerArg(args[i]) : typeof args[i] === 'boolean' ? +args[i] : args[i]));
  const r = f.fn(...values);

  switch(f.returns) {
    case 'void': return 0;
    case 'cstring': return r;
    case 'pointer': return r === null ? 0 : Number(r);
  }

  return typeof r === 'bigint' ? Number(r) : r;
}
