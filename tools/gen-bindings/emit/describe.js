import { paramTypes, paramNames, jsLiteral } from './common.js';

/* --describe: `__sig(target, [ { params: ["name: type"], returnType, arity }, ... ]);`,
 * one element per overload. */
export function sigCode(target, entries) {
  const sigs = entries.map(e => {
    const types = paramTypes(e);

    return { params: paramNames(e).map((n, i) => n + ': ' + types[i]), returnType: e.returnType, arity: e.arity };
  });

  return '__sig(' + target + ', ' + jsLiteral(sigs) + ');\n';
}

/* The binding of a plain function as a named-parameter wrapper around `impl`
 * (--describe), since a CFunction or a rest-args closure has no names to
 * report. */
export function describedFunction(ident, fn, impl, doc = '') {
  const names = paramNames(fn).join(', ');

  return 'const __f_' + ident + ' = ' + impl + ';\n' + doc + 'export function ' + ident + '(' + names + ') { return __f_' + ident + '(' + names + '); }\n' + sigCode(ident, [fn]);
}

export const DESCRIBE_HELPERS = `
function __sig(fn, sigs) {
  Object.defineProperty(fn, Symbol.for("describe"), { value: sigs });
}
`;
