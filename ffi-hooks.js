/* ffi-hooks.js: lets a script written for Node or Bun import its own
 * module name.
 *
 * ```sh
 * qjsm -I ffi-hooks.js script.js
 * ```
 *
 *   'node:ffi'  loads node-ffi.js, the API of Node's node:ffi
 *   'bun:ffi'   loads ffi, which follows bun:ffi
 *
 * without it qjsm reads 'node:ffi' as plain `ffi`, bun's API under Node's
 * name: dlopen() then returns { symbols, close }, not { lib, functions }.
 * -I runs this file first, and the hook stays for every later import,
 * dynamic ones too.
 */
const MODULES = { 'node:ffi': 'node-ffi.js', 'bun:ffi': 'ffi' };

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(MODULES[specifier] || specifier, context);
  },
});
