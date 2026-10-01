import { safeIdent, header, skippedComment, bindable, paramTypes, jsLiteral, cfType, structTypesCode, usedStructs, wrapReturn } from './common.js';
import { prepareByValue } from '../by-value.js';
import { describedFunction, DESCRIBE_HELPERS } from './describe.js';
import { jsDoc } from './jsdoc.js';
import { runtimeCode, variablesCode, needsRuntime } from './structs.js';
import { classesCode } from './classes.js';

/* Emits `export const NAME = value;` for every constant variable whose value
 * is known at generation time (an `extern` one has none, only a symbol). */
export function constantsCode(fields) {
  const known = fields.filter(f => f.const && f.value !== undefined);
  if(!known.length) return '';

  return '\n// constants\n' + known.map(f => 'export const ' + safeIdent(f.name) + ' = ' + jsLiteral(f.value) + ';\n').join('');
}

/* Emits `export const NAME = value;` for every enum reachable from a
 * bindable function's signature (see bindable()), one group per
 * enum with a header comment naming its tag (or "(anonymous)"). A constant
 * already emitted by an earlier group is skipped rather than re-declared --
 * C forbids two enums from sharing a constant name at file scope, so this
 * is only a defensive backstop, not expected to ever trigger.
 */
function enumConstantsCode(enums) {
  if(!enums.length) return '';

  const emitted = new Set();
  let out = '';

  for(const e of enums) {
    const fresh = e.fields.filter(c => !emitted.has(c.name));
    if(!fresh.length) continue;

    out += '\n// enum ' + (e.name || '(anonymous)') + '\n';
    for(const c of fresh) {
      emitted.add(c.name);
      out += 'export const ' + safeIdent(c.name) + ' = ' + c.value + ';\n';
    }
  }

  return out;
}

export function generateCFunction(ir, opts) {
  const { functions, cxxFunctions, classes, enums } = bindable(ir, opts);

  prepareByValue(ir, opts);
  const lib = opts.library ? '__lib' : 'RTLD_DEFAULT';
  const views = opts.structs || classes.length > 0 || cxxFunctions.length > 0;
  const imports = [
    'CFunction',
    opts.ffiType ? 'FFIType' : null,
    views ? 'toArrayBuffer' : null,
    views ? 'read as __rd' : null,
    views ? 'ptr as __ptr' : null,
    views ? 'toString as __cstr' : null,
    'dlsym',
    opts.library ? 'dlopen' : null,
    opts.library ? 'RTLD_NOW' : 'RTLD_DEFAULT',
    // calloc() and free() are not in the bound library.
    opts.library && opts.finalize && classes.length > 0 ? 'RTLD_DEFAULT' : null,
  ].filter(Boolean);

  let out = header(opts);
  out += 'import { ' + imports.join(', ') + " } from 'ffi';\n\n";

  if(opts.library) out += 'const __lib = dlopen(' + JSON.stringify(opts.library) + ', RTLD_NOW);\n' + 'if (__lib == null) throw new Error("gen-bindings: dlopen(' + opts.library + ') failed");\n\n';

  out += 'function __sym(name) {\n' + '  const p = dlsym(' + lib + ', name);\n' + '  if(p == null) throw new Error("gen-bindings: symbol not found: " + name);\n' + '  return p;\n' + '}\n';
  if(opts.describe) out += DESCRIBE_HELPERS;
  out += enumConstantsCode(enums);
  out += constantsCode(ir.fields);
  if(needsRuntime(ir, opts, classes)) out += runtimeCode(opts);
  out += variablesCode(ir, opts) + classesCode(ir, classes, opts, cxxFunctions);
  out += structTypesCode(ir, usedStructs([...functions, ...cxxFunctions, ...classes.flatMap(c => [...c.methods, ...c.constructors])]), opts);
  out += '\n';

  for(const fn of functions) {
    const args = paramTypes(fn).map(t => cfType(t, opts));
    const ident = safeIdent(fn.name);
    const impl = wrapReturn(fn.returnType, 'CFunction({ptr:__sym(' + jsLiteral(fn.name) + '),args:[' + args.join(',') + '],returns:' + cfType(fn.returnType, opts) + '})', opts);

    const doc = opts.jsdoc ? jsDoc([fn.name], [fn], new Set(classes.map(c => c.name)), '') : '';

    out += opts.describe ? describedFunction(ident, fn, impl, doc) : doc + 'export const ' + ident + ' = ' + impl + ';\n';
    if(ident !== fn.name) out += '// note: "' + fn.name + '" is a reserved word, exported above as "' + ident + '"\n';
  }

  out += skippedComment(ir.skipped);
  return out;
}

export function generateDefine(ir, opts) {
  const { functions, cxxFunctions, classes, enums } = bindable(ir, opts);
  const lib = opts.library ? '__lib' : 'RTLD_DEFAULT';
  const views = opts.structs || classes.length > 0 || cxxFunctions.length > 0;
  const imports = [
    'dlsym',
    'define',
    'call',
    views ? 'toArrayBuffer' : null,
    views ? 'read as __rd' : null,
    views ? 'ptr as __ptr' : null,
    views ? 'toString as __cstr' : null,
    opts.library ? 'dlopen' : null,
    opts.library ? 'RTLD_NOW' : 'RTLD_DEFAULT',
  ].filter(Boolean);

  let out = header(opts);
  out += 'import { ' + imports.join(', ') + " } from 'ffi';\n\n";

  if(opts.library) out += 'const __lib = dlopen(' + JSON.stringify(opts.library) + ', RTLD_NOW);\n' + 'if (__lib == null) throw new Error("gen-bindings: dlopen(' + opts.library + ') failed");\n\n';

  out +=
    'function __bind(name, rtype, ...argtypes) {\n' +
    '  const p = dlsym(' +
    lib +
    ', name);\n' +
    '  if(p == null) throw new Error("gen-bindings: symbol not found: " + name);\n' +
    '  if(!define(name, p, null, rtype, ...argtypes))\n' +
    '    throw new Error("gen-bindings: define() failed for " + name);\n' +
    '  return (...args) => call(name, ...args);\n' +
    '}\n';
  if(opts.describe) out += DESCRIBE_HELPERS;
  out += enumConstantsCode(enums);
  out += constantsCode(ir.fields);
  if(needsRuntime(ir, opts, classes)) out += runtimeCode(opts);
  out += variablesCode(ir, opts) + classesCode(ir, classes, opts, cxxFunctions);
  out += '\n';

  for(const fn of functions) {
    const args = fn.defTypes.params.map(t => jsLiteral(t));
    const ident = safeIdent(fn.name);
    const impl = '__bind(' + jsLiteral(fn.name) + ',' + jsLiteral(fn.defTypes.returnType) + (args.length ? ',' + args.join(',') : '') + ')';

    const doc = opts.jsdoc ? jsDoc([fn.name], [fn], new Set(classes.map(c => c.name)), '') : '';

    out += opts.describe ? describedFunction(ident, fn, impl, doc) : doc + 'export const ' + ident + ' = ' + impl + ';\n';
    if(ident !== fn.name) out += '// note: "' + fn.name + '" is a reserved word, exported above as "' + ident + '"\n';
  }

  out += skippedComment(ir.skipped);
  return out;
}

/* --- main ----------------------------------------------------------------- */
