import { inspect } from 'inspect';

const EMPTY_ARRAY = '__gb_empty_array__';
const EMPTY_OBJECT = '__gb_empty_object__';

/* `value` with each empty array and object replaced by a token string.
 * inspect() writes an extra closing bracket after an empty one that sits
 * inside another, so they go in as tokens and come back in toSource(). */
function mark(value) {
  if(Array.isArray(value)) return value.length ? value.map(mark) : EMPTY_ARRAY;
  if(value === null || typeof value != 'object') return value;

  const keys = Object.keys(value);

  return keys.length ? Object.fromEntries(keys.map(k => [k, mark(value[k])])) : EMPTY_OBJECT;
}

/* writes plain data (JSON-like) as an ES module: `export default <literal>;`
 *
 * ```js
 * toSource({ args: [], returns: "i32" });
 * // export default { args: [], returns: 'i32' };
 * ```
 */
export function toSource(value) {
  const text = inspect(mark(value), { reparseable: true, colors: false, compact: -3, depth: Infinity, maxArrayLength: Infinity, maxStringLength: Infinity, breakLength: 80 });

  return 'export default ' + text.replaceAll("'" + EMPTY_ARRAY + "'", '[]').replaceAll("'" + EMPTY_OBJECT + "'", '{}') + ';\n';
}
