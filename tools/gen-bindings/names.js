import { bindable, flattenName, safeIdent } from './emit/common.js';
import { identOf } from './structs.js';

/* The names the generated module would export twice, because --namespace
 * dropped what told them apart: [{ ident, entities: ['class a::Foo', ...] }].
 * Only a clash in which a name the stripping changed takes part is reported,
 * so output that was fine without --namespace is judged as it was before.
 * Needs setNamespaces() to have been called.
 */
export function nameCollisions(ir, opts) {
  const { functions, cxxFunctions, classes, enums } = bindable(ir, opts);
  const idents = new Map();
  const stripped = name => flattenName(name) !== name.replace(/::/g, '_');

  /* `entity` tells apart what is one thing under several declarations
   * (overloads, a struct and its typedef names) from what is two. */
  const add = (ident, entity, label, name) => {
    if(!idents.has(ident)) idents.set(ident, new Map());
    idents.get(ident).set(entity, { label, stripped: stripped(name) });
  };

  for(const f of functions) add(safeIdent(f.name), 'function ' + f.name, 'function ' + f.name, f.name);
  for(const f of cxxFunctions) add(safeIdent(flattenName(f.name)), 'function ' + f.name, 'function ' + f.name, f.name);
  for(const c of classes) add(identOf(c.name), 'record ' + c.name, 'class ' + c.name, c.name);
  for(const e of enums) for(const c of e.fields) add(safeIdent(c.name), 'enum constant ' + c.name, 'enum constant ' + c.name, c.name);

  for(const f of ir.fields) {
    if(f.const && f.value !== undefined) add(safeIdent(f.name), 'constant ' + f.name, 'constant ' + f.name, f.name);
    else if(opts.structs) add(safeIdent(f.name), 'variable ' + f.name, 'variable ' + f.name, f.name);
  }

  if(opts.structs) {
    for(const s of ir.structs.filter(s => s.size != null)) {
      add(identOf(s.name), 'record ' + s.name, s.type + ' ' + s.name, s.name);
      for(const alias of s.typedefs || []) add(identOf(alias), 'record ' + s.name, 'typedef ' + alias + ' of ' + s.name, alias);
    }

    for(const t of ir.typedefs || []) if(t.record) add(identOf(t.name), 'record ' + t.record, 'typedef ' + t.name + ' of ' + t.record, t.name);
  }

  return [...idents]
    .filter(([, entities]) => entities.size > 1 && [...entities.values()].some(e => e.stripped))
    .map(([ident, entities]) => ({ ident, entities: [...entities.values()].map(e => e.label) }));
}
