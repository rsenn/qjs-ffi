import { safeIdent, flattenName, paramTypes, paramNames, isByValue } from './common.js';

/* --jsdoc: the JS type a value of ffi type `t` has as an argument or as a
 * return value. `known` holds the names of the bound classes, whose
 * instances are also accepted where a pointer to them is declared. */
function jsDocType(t, known, isReturn) {
  switch(t) {
    case 'void': return 'void';
    case 'bool': return 'boolean';
    case 'i64':
    case 'u64': return isReturn ? 'bigint' : 'bigint|number';
    case 'cstring': return isReturn ? 'string' : 'string|null';
  }

  if(isByValue(t)) return isReturn ? 'ArrayBuffer' : 'ArrayBuffer|ArrayBufferView';
  if(!t.endsWith('*') && !['pointer', 'ptr', 'function'].includes(t)) return 'number';
  if(isReturn) return 'number|bigint|null';

  const name = t.endsWith(' *') ? t.slice(0, -2) : '';
  const cls = known.has(name) ? name : [...known].filter(k => k.endsWith('::' + name)).length === 1 ? [...known].find(k => k.endsWith('::' + name)) : null;

  return (cls ? safeIdent(flattenName(cls)) + '|' : '') + 'object|number|bigint|null';
}

/* --jsdoc: one `/** ... *\/` block. `head` is free text lines and tags;
 * `entries` are IR function entries, documented as `@param`s and a
 * `@returns` (`returns` false for a constructor), each under an
 * `@overload` when there is more than one. */
export function jsDoc(head, entries, known, indent, returns = true) {
  const lines = [...head];
  const multi = entries.length > 1;

  for(const e of entries) {
    const names = paramNames(e);
    const types = paramTypes(e);

    if(multi) lines.push('@overload');
    e.args.forEach((_, i) => lines.push('@param {' + jsDocType(types[i], known, false) + '} ' + names[i] + ' - ' + types[i]));
    if(returns) lines.push('@returns {' + jsDocType(e.returns || 'void', known, true) + '}' + (e.returns && e.returns !== 'void' ? ' - ' + e.returns : ''));
  }

  return indent + '/**\n' + lines.map(l => indent + ' * ' + l + '\n').join('') + indent + ' */\n';
}
