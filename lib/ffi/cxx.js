/* ffi/cxx.js -- CXXFunction: CFunction for a C++ signature with std::string.
 * proof of concept; libstdc++ (the __cxx11 ABI) on x86-64 only.
 *
 * ```js
 * import { CXXFunction } from 'ffi/cxx.js';
 *
 * const join = CXXFunction({ ptr, args: ['const std::string&', 'std::string_view'], returns: 'std::string' });
 * join('a', 'b');   // "ab"
 * ```
 *
 *   type in args                 JS value in             JS value out
 *   std::string, const std::string&, const std::string*
 *                                a string                -
 *   std::string&, std::string*   a string (null: NULL)   the string after the call
 *   std::string_view             a string                -
 *
 *   type in returns              JS value out
 *   std::string, const std::string&, const std::string*, std::string_view
 *                                a string (null for a NULL pointer)
 *
 * Every other type is passed to CFunction as it is. A call returns the result
 * first, then each output argument, in order; a single value comes as itself,
 * several as an array.
 *
 * A std::string is 32 bytes: the data pointer, the length, then a 16 byte
 * union (the capacity, or the inline buffer of a short string). Ours always
 * have their data on the heap, from operator new, with a capacity of 15 or
 * more (libstdc++ copies a short string over any string without checking).
 * A returned std::string goes through a buffer we pass as the first argument
 * (the Itanium ABI's hidden return pointer; x8 on aarch64, not supported).
 */
import { CFunction, RTLD_NOW, RTLD_GLOBAL, dlopen, dlsym, read, write, ptr, toArrayBuffer } from "ffi";

/* UTF-8 by hand: qjsm has no TextEncoder */
const enc = { encode: s => Uint8Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0)) };
const dec = { decode: b => decodeURIComponent(escape(Array.from(b, c => String.fromCharCode(c)).join(""))) };
const STRING = 32;
const VIEW = ["u64", "pointer"]; // std::string_view: length, then data

let newBytes, deleteBytes;

/* operator new / delete of libstdc++, which the callee frees our data with */
function runtime() {
  if(newBytes) return;

  const lib = dlopen("libstdc++.so.6", RTLD_NOW | RTLD_GLOBAL);

  newBytes = CFunction({ ptr: dlsym(lib, "_Znwm"), args: ["u64"], returns: "pointer" });
  deleteBytes = CFunction({ ptr: dlsym(lib, "_ZdlPv"), args: ["pointer"], returns: "void" });
}

/* a std::string holding the JS string s: an ArrayBuffer of its 32 bytes, or
 * obj when given (its old data must be freed already) */
export function makeString(s, obj = new ArrayBuffer(STRING)) {
  runtime();

  const bytes = enc.encode(s);
  const capacity = Math.max(bytes.length, 15); // libstdc++ assumes at least 15, the inline size
  const data = newBytes(capacity + 1);
  const at = ptr(obj);

  write.bytes(data, 0, bytes);
  write.u8(data, bytes.length, 0);
  write.ptr(at, 0, data);
  write.u64(at, 8, BigInt(bytes.length));
  write.u64(at, 16, BigInt(capacity));
  return obj;
}

/* the JS string of the std::string at address at */
export function readString(at) {
  const length = Number(read.u64(at, 8));

  return length ? dec.decode(new Uint8Array(toArrayBuffer(read.ptr(at, 0), 0, length))) : "";
}

/* destroys a std::string made by makeString(), or one the callee changed */
export function freeString(obj) {
  const at = ptr(obj);
  const data = read.ptr(at, 0);

  if(data !== at + 16) deleteBytes(data);
}

/* how a type of args is passed: 'in', 'out', 'view', or null for CFunction's */
function argKind(type) {
  const t = type.trim().replace(/\s*([&*])$/, " $1");

  if(t === "std::string" || t === "const std::string &" || t === "const std::string *") return "in";
  if(t === "std::string &" || t === "std::string *") return "out";
  if(t === "std::string_view" || t === "const std::string_view") return "view";
  return null;
}

/* how a type of returns comes back: 'new' (hidden pointer), 'ref', 'view', or null */
function returnKind(type) {
  const t = type.trim().replace(/\s*([&*])$/, " $1");

  if(t === "std::string") return "new";
  if(t === "const std::string &" || t === "std::string &" || t === "const std::string *" || t === "std::string *") return "ref";
  if(t === "std::string_view" || t === "const std::string_view") return "view";
  return null;
}

/* CXXFunction({ ptr, args, returns, ... }): a function like CFunction's */
export function CXXFunction({ ptr: fn, args = [], returns = "void", ...rest }) {
  const kinds = args.map(argKind);
  const ret = returnKind(returns);
  const cargs = kinds.map((k, i) => (k === "view" ? VIEW : k ? "pointer" : args[i]));
  const cret = ret === "new" ? "void" : ret === "view" ? VIEW : ret ? "pointer" : returns;

  if(ret === "new") cargs.unshift("pointer");

  const call = CFunction({ ptr: fn, args: cargs, returns: cret, ...rest });

  return (...a) => {
    const temps = []; // strings made for this call, freed after it
    const outs = [];
    const keep = [];
    const values = [];
    const result = [];

    try {
      if(ret === "new") {
        const slot = new ArrayBuffer(STRING);

        write.ptr(ptr(slot), 0, ptr(slot) + 16); // an empty string, safe to free
        temps.push(slot);
        values.push(slot);
      }

      kinds.forEach((k, i) => {
        if(k && a[i] && a[i].buffer instanceof ArrayBuffer && a[i].buffer.byteLength === STRING && k !== "view") {
          values.push(a[i].buffer); // a cxx/string.js string: passed as it is, changed in place
        } else if(k === "in") {
          temps.push(makeString(String(a[i])));
          values.push(temps[temps.length - 1]);
        } else if(k === "out") {
          const s = a[i] === null && /\*$/.test(args[i]) ? null : makeString(a[i] === undefined ? "" : String(a[i]));

          if(s) temps.push(s);
          outs.push(s);
          values.push(s);
        } else if(k === "view") {
          const bytes = enc.encode(String(a[i]));
          const view = new ArrayBuffer(16);

          write.u64(ptr(view), 0, BigInt(bytes.length));
          write.ptr(ptr(view), 8, bytes.length ? ptr(bytes) : 0);
          keep.push(bytes);
          values.push(view);
        } else {
          values.push(a[i]);
        }
      });

      const r = call(...values);

      if(ret === "new") result.push(readString(ptr(values[0])));
      else if(ret === "ref") result.push(r === null ? null : readString(r));
      else if(ret === "view") {
        const length = Number(read.u64(ptr(r), 0));

        result.push(length ? dec.decode(new Uint8Array(toArrayBuffer(read.ptr(ptr(r), 8), 0, length))) : "");
      } else if(returns !== "void") result.push(r);

      for(const s of outs) result.push(s && readString(ptr(s)));
    } finally {
      for(const s of temps) freeString(s);
    }

    return result.length > 1 ? result : result[0];
  };
}
