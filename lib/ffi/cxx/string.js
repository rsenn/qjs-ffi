/* ffi/cxx/string.js -- string: a std::string you own.
 *
 * ```js
 * import { string } from 'ffi/cxx/string.js';
 * import { CXXFunction } from 'ffi/cxx.js';
 *
 * const s = new string('hello');
 * shout(s);                // a CXXFunction taking std::string&; s changed in place
 * s.value;                 // "hello!!!"
 * s.delete();
 * ```
 *
 *   new string(value = '')   a std::string holding value
 *   value                    the contents; assigning replaces them
 *   length                   bytes (the UTF-8 length, not characters)
 *   buffer                   the 32 bytes of the object; CXXFunction passes
 *                            it as is for std::string& and std::string*
 *   delete()                 frees it now; also [Symbol.dispose]; a string
 *                            nobody deleted is freed when it is collected
 *
 * The address of the object never changes, so C++ may keep a pointer to it.
 */
import { ptr, read } from "ffi";
import { makeString, readString, freeString } from "../cxx.js";

const dispose = Symbol.dispose || Symbol.for("Symbol.dispose");
const registry = new FinalizationRegistry(buffer => freeString(buffer));

export class string {
  #buffer;

  constructor(value = "") {
    this.#buffer = makeString(String(value));
    registry.register(this, this.#buffer, this.#buffer);
  }

  get buffer() {
    if(!this.#buffer) throw new TypeError("string: deleted");
    return this.#buffer;
  }

  get value() {
    return readString(ptr(this.buffer));
  }

  set value(v) {
    freeString(this.buffer);
    makeString(String(v), this.#buffer);
  }

  get length() {
    return Number(read.u64(ptr(this.buffer), 8));
  }

  toString() {
    return this.value;
  }

  delete() {
    if(!this.#buffer) return;

    registry.unregister(this.#buffer);
    freeString(this.#buffer);
    this.#buffer = null;
  }

  [dispose]() {
    this.delete();
  }
}
