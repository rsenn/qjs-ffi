/* Virtual calls go through the object's vtable, so a method needs its slot.
 * clang's -fdump-vtable-layouts prints them once a probe has made it lay the
 * class out (see runLayoutDump()):
 *
 *   VTable indices for 'geo::Shape' (3 entries).
 *      0 | geo::Shape::~Shape() [complete]
 *      1 | geo::Shape::~Shape() [deleting]
 *      2 | double geo::Shape::area() const
 *
 * An index is relative to the address point the object's vptr holds, and
 * names the methods the class itself declares, overriders included, which the
 * AST does not flag as virtual.
 */

/* Map: class name -> [{ index, text }]. */
export function parseVtableIndices(out) {
  const classes = new Map();
  const block = /^VTable indices for '([^']+)' \(\d+ entr(?:y|ies)\)\.\n((?:[ \t]+\d+ \| .*\n?)+)/gm;

  for(const m of out.matchAll(block)) classes.set(m[1], [...m[2].matchAll(/^[ \t]+(\d+) \| (.*)$/gm)].map(e => ({ index: Number(e[1]), text: e[2] })));

  return classes;
}

/* Map: probe class name -> [{ index, text }] of the full "Vtable for" block a
 * probe class derived from the class (see runLayoutDump()) prints, every slot
 * with the final overrider it holds, inherited ones too:
 *
 *   Vtable for '__gbk0' (5 entries).
 *      0 | offset_to_top (0)
 *      1 | __gbk0 RTTI
 *          -- (Guarded, 0) vtable address --
 *      2 | int Guarded2::f(int) const
 *      3 | int Guarded2::f(double) const
 *      4 | void __gbk0::__gb_key()
 *
 * The two header rows are not slots; slot n is row n + 2. */
export function parseVtableBlocks(out) {
  const classes = new Map();
  const block = /^Vtable for '([^']+)' \(\d+ entr(?:y|ies)\)\.\n((?:[ \t]+(?:\d+ \| .*|-- .*)\n?)+)/gm;

  for(const m of out.matchAll(block))
    classes.set(
      m[1],
      [...m[2].matchAll(/^[ \t]+(\d+) \| (.*)$/gm)].filter(e => Number(e[1]) >= 2).map(e => ({ index: Number(e[1]) - 2, text: e[2] })),
    );

  return classes;
}

/* The number of top-level, comma-separated items of `s`. */
function countParams(s) {
  if(!s.trim() || s.trim() === 'void') return 0;

  let depth = 0;
  let n = 1;

  for(const c of s) {
    if('(<[{'.includes(c)) depth++;
    else if(')>]}'.includes(c)) depth--;
    else if(c === ',' && depth === 0) n++;
  }

  return n;
}

/* The top-level, comma-separated items of `s`, trimmed. */
function splitParams(s) {
  const items = [];
  let depth = 0;
  let from = 0;

  if(!s.trim() || s.trim() === 'void') return items;

  for(let i = 0; i < s.length; i++) {
    if('(<[{'.includes(s[i])) depth++;
    else if(')>]}'.includes(s[i])) depth--;
    else if(s[i] === ',' && depth === 0) {
      items.push(s.slice(from, i).trim());
      from = i + 1;
    }
  }

  items.push(s.slice(from).trim());
  return items;
}

/* A parameter list spelled the way clang's vtable dump does and the way the
 * AST does, made comparable. */
const normParams = list => list.map(t => t.replace(/\b(class|struct|enum)\s+/g, '').replace(/\s+/g, ' ').replace(/\s*([*&,<>])\s*/g, '$1').trim()).join(',');

/* { name, arity, params, const } of the method entry `text` declares for `cls`, or
 * null (a destructor, or not a member of cls). */
function methodOf(text, cls) {
  const m = new RegExp('(?:^|[\\s*&])' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '::(\\w+)\\(').exec(text);

  if(!m) return null;

  const start = m.index + m[0].length;
  let depth = 1;
  let end = start;

  for(; end < text.length && depth > 0; end++) depth += text[end] === '(' ? 1 : text[end] === ')' ? -1 : 0;

  const params = text.slice(start, end - 1);

  return { name: m[1], arity: countParams(params), params: splitParams(params), const: /^\s*const\b/.test(text.slice(end)) };
}

/* Sets `vtableSlot` on the methods of class entry `cls` that the entries
 * (see parseVtableIndices()) match by name, number of parameters and
 * constness, and on its destructor (the complete-object one, which is what
 * `.delete()` calls). A method that is not matched by exactly one entry, or
 * shares all three with another of the class, is left alone, and so is bound
 * to its own symbol: a wrong slot would call the wrong function.
 */
export function assignVtableSlots(cls, entries, sigs) {
  const methods = entries.map(e => ({ ...methodOf(e.text, cls.name), index: e.index })).filter(m => m.name);
  const key = m => m.name + '/' + (m.args ? m.args.length : m.arity) + '/' + !!m.const;
  const own = cls.methods.filter(m => !m.static);
  const dtor = entries.find(e => e.text.includes('::~') && /\[complete\]\s*$/.test(e.text));

  for(const m of own) {
    const k = key(m);
    const found = methods.filter(e => key(e) === k);
    const siblings = own.filter(o => key(o) === k);

    if(found.length === 1 && siblings.length === 1) m.vtableSlot = found[0].index;
    else if(found.length === siblings.length && sigs && sigs.get(m)) {
      /* Overloads of one arity: tell them apart by their parameter types. */
      const same = found.filter(e => sigs.get(m).some(spelling => normParams(spelling) === normParams(e.params)));

      if(same.length === 1 && siblings.filter(o => (sigs.get(o) || []).some(spelling => normParams(spelling) === normParams(same[0].params))).length === 1) m.vtableSlot = same[0].index;
    }
  }

  if(dtor) cls.destructor = { ...cls.destructor, vtableSlot: dtor.index };
}

/* The virtual methods of class entry `cls` that have no slot, as warnings
 * { name, reason }: each is bound to its own symbol, so a call through a
 * wrapper of a base class would not run the override. a `final` class has
 * nothing to override it, so it gets none.
 *
 * ```js
 * unslottedVirtuals(cls, true);
 * // [{ name: "Twin::k", reason: "virtual, but the vtable dump does not tell it ..." }]
 * ```
 *
 *   object  cls      an IR class entry, after assignVtableSlots()
 *   bool    hasDump  clang printed the class's vtable
 *
 *   returns  an array, empty when every virtual method has its slot */
export function unslottedVirtuals(cls, hasDump) {
  if(cls.final) return [];

  const why = hasDump ? 'the vtable dump does not tell it apart from another method of the same name, parameter count and constness' : 'clang printed no vtable for the class';

  return cls.methods
    .filter(m => !m.static && (m.virtual || m.pure) && m.vtableSlot === undefined)
    .map(m => ({ name: cls.name + '::' + m.name, reason: 'virtual, but ' + why + '; it is bound to its own symbol, so a call through a base class wrapper is not virtual' + (m.pure ? ' (and a pure virtual has no symbol)' : '') }));
}
