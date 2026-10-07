import { safeIdent, header, skippedComment, warningsComment, bindable, paramTypes, jsLiteral, cfType, structTypesCode, usedStructs, wrapReturn } from './common.js';
import { prepareByValue, prepareClassTypes, dropForBun } from '../by-value.js';
import { describedFunction, DESCRIBE_HELPERS } from './describe.js';
import { jsDoc } from './jsdoc.js';
import { runtimeCode, variablesCode, needsRuntime } from './runtime.js';
import { classesCode } from './classes.js';

/* Emits `export const NAME = value;` for every constant variable whose value
 * is known at generation time (an `extern` one has none, only a symbol). */
export function constantsCode(fields) {
  const known = fields.filter(f => f.const && f.value !== undefined);
  if(!known.length) return '';

  return '\n// constants\n' + known.map(f => 'export const ' + safeIdent(f.name) + ' = ' + jsLiteral(f.value) + ';\n').join('');
}

/* Emits `export const NAME = value;` for every enum of the sources
 * (see bindable()), one group per enum with a header comment naming its tag (or "(anonymous)"). A constant
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

/* Emits `export const NAME = value;` for every scanned #define (ir.defines),
 * leaving out a name some other export already has: `taken`, the
 * identifiers of functions, variables, classes and enum constants. */
function definesCode(defines, taken) {
  const lines = [];

  for(const d of defines || []) {
    const id = safeIdent(d.name);

    if(taken.has(id)) continue;
    taken.add(id);
    lines.push('export const ' + id + ' = ' + (d.big ? d.value + 'n' : jsLiteral(d.value)) + ';\n');
  }

  return lines.length ? '\n// defines\n' + lines.join('') : '';
}

/* bun:ffi has no dlsym(): the address of a symbol is the `.ptr` of the
 * function a one-symbol dlopen() makes of it. */
const BUN_SYM = library => `const __syms = new Map();

function __sym(name) {
  let p = __syms.get(name);

  if(p === undefined) {
    p = dlopen(${JSON.stringify(library)}, { [name]: { args: [], returns: "void" } }).symbols[name].ptr;
    __syms.set(name, p);
  }

  return p;
}
`;

export function generateCFunction(ir, opts) {
  if(opts.target === 'bun') dropForBun(ir);

  const { functions, cxxFunctions, classes, enums } = bindable(ir, opts);

  prepareByValue(ir, opts);
  prepareClassTypes(ir, opts, classes);
  const lib = opts.library ? '__lib' : 'RTLD_DEFAULT';
  const views = opts.structs || classes.length > 0 || cxxFunctions.length > 0;
  const bun = opts.target === 'bun';
  const imports = bun
    ? ['CFunction', 'dlopen', opts.ffiType ? 'FFIType' : null, views ? 'toArrayBuffer' : null, views ? 'ptr as __ptr' : null, views ? 'CString' : null].filter(Boolean)
    : [
    'CFunction',
    opts.ffiType ? 'FFIType' : null,
    views ? 'toArrayBuffer' : null,
    views ? 'read as __rd' : null,
    views ? 'write as __wr' : null,
    views ? 'ptr as __ptr' : null,
    views ? 'toString as __cstr' : null,
    'dlsym',
    opts.library ? 'dlopen' : null,
    opts.library ? 'RTLD_NOW' : 'RTLD_DEFAULT',
    // calloc() and free() are not in the bound library.
    opts.library && opts.finalize && classes.length > 0 ? 'RTLD_DEFAULT' : null,
  ].filter(Boolean);

  let out = header(opts);
  out += 'import { ' + imports.join(', ') + (bun ? " } from 'bun:ffi';\n\n" : " } from 'ffi';\n\n");

  if(bun) out += BUN_SYM(opts.library);
  else if(opts.library) out += 'const __lib = dlopen(' + JSON.stringify(opts.library) + ', RTLD_NOW);\n' + 'if (__lib == null) throw new Error("gen-bindings: dlopen(' + opts.library + ') failed");\n\n';

  if(!bun) out += 'function __sym(name) {\n' + '  const p = dlsym(' + lib + ', name);\n' + '  if(p == null) throw new Error("gen-bindings: symbol not found: " + name);\n' + '  return p;\n' + '}\n';
  if(opts.describe) out += DESCRIBE_HELPERS;
  out += enumConstantsCode(enums);
  out += constantsCode(ir.fields);
  out += definesCode(ir.defines, new Set([...functions, ...cxxFunctions, ...ir.fields, ...classes].map(x => safeIdent(x.name)).concat(enums.flatMap(e => e.fields.map(c => safeIdent(c.name))))));
  if(needsRuntime(ir, opts, classes)) out += runtimeCode(opts);
  out += variablesCode(ir, opts) + classesCode(ir, classes, opts, cxxFunctions);
  out += structTypesCode(ir, usedStructs([...functions, ...cxxFunctions, ...classes.flatMap(c => [...c.methods, ...c.constructors])]), opts);
  out += '\n';

  for(const fn of functions) {
    const args = paramTypes(fn).map(t => cfType(t, opts));
    const ident = safeIdent(fn.name);
    const impl = wrapReturn(fn.returns, 'CFunction({ptr:__sym(' + jsLiteral(fn.name) + '),args:[' + args.join(',') + '],returns:' + cfType(fn.returns, opts) + (fn.variadic ? ',variadic:true' : '') + '})', opts);

    const doc = opts.jsdoc ? jsDoc([fn.name], [fn], new Set(classes.map(c => c.name)), '') : '';

    out += opts.describe ? describedFunction(ident, fn, impl, doc) : doc + 'export const ' + ident + ' = ' + impl + ';\n';
    if(ident !== fn.name) out += '// note: "' + fn.name + '" is a reserved word, exported above as "' + ident + '"\n';
  }

  out += skippedComment(ir.skipped) + warningsComment(ir.warnings);
  return out;
}
