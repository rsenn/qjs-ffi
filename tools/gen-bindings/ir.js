import { runLayoutDump } from './clang.js';
import { normalizeType, splitFunctionType, sizeOfC, mapCType } from './types.js';
import { header } from './emit/common.js';
import { assignVtableSlots } from './vtable.js';

/* Builds a name -> underlying-type-string map from every top-level
 * TypedefDecl, for resolving a return type's typedef name in mapCType().
 * Prefers desugaredQualType (clang's fully-resolved canonical type, present
 * whenever it differs from qualType) over qualType, so most real-world
 * typedefs (FT_Error -> int, cairo_status_t -> enum _cairo_status) resolve
 * in a single lookup.
 */
export function collectTypedefs(root) {
  const typedefs = {};

  for(const node of root.inner || []) {
    if(node.kind === 'TypedefDecl' && node.name && node.type && !Object.prototype.hasOwnProperty.call(typedefs, node.name)) typedefs[node.name] = node.type.desugaredQualType || node.type.qualType;
  }

  return typedefs;
}

/* Resolves one EnumConstantDecl's value: the explicit initializer's
 * evaluated value (clang's ast-dump always gives this as a plain decimal
 * string, even for hex literals or `A | B`-style expressions), or the
 * previous constant's value + 1 for an implicit one -- same rule the C
 * standard uses.
 */
function enumConstants(enumDecl) {
  const constants = [];
  let next = 0;

  for(const c of enumDecl.inner || []) {
    if(c.kind !== 'EnumConstantDecl') continue;

    const init = (c.inner || []).find(x => 'value' in x);
    const value = init ? Number(init.value) : next;

    constants.push({ name: c.name, value });
    next = value + 1;
  }

  return constants;
}

/* Builds an index for resolving enum-typed return/parameter types back to
 * their full enumerator list:
 *   - enumsById: EnumDecl node id -> { name (tag, or null if anonymous),
 *     constants }, from every top-level EnumDecl that carries its full
 *     definition (a bare forward-reference node has no `inner`).
 *   - tagToId: enum tag name -> id, for the "enum TAG" spelling mapCType()
 *     sees directly (e.g. cairo_status_t's own qualType is "enum _cairo_status").
 *   - typedefToEnumId: typedef name -> id, for the `typedef enum { ... }
 *     Name;` idiom (named or anonymous tag), where mapCType() instead sees

 *     the bare typedef name. clang links a TypedefDecl to the EnumDecl it
 *     wraps via an intermediate ElaboratedType child's `ownedTagDecl.id`,
 *     which is the same id as that EnumDecl's own top-level definition.
 */
export function collectEnumIndex(root) {
  const enumsById = {};
  const tagToId = {};
  const typedefToEnumId = {};

  walkDecls(root.inner, (node, scope) => {
    if(node.kind === 'EnumDecl' && node.inner) {
      enumsById[node.id] = { name: node.name || null, constants: enumConstants(node) };
      if(node.name) tagToId[scope + node.name] = node.id;
    } else if(node.kind === 'TypedefDecl' && node.inner) {
      const elaborated = node.inner.find(c => c.kind === 'ElaboratedType');
      const owned = elaborated && elaborated.ownedTagDecl;

      if(owned && owned.kind === 'EnumDecl') typedefToEnumId[scope + node.name] = owned.id;
    }
  });

  return { enumsById, tagToId, typedefToEnumId };
}

/* Calls fn(node, scope) for every declaration under `nodes`, `scope` being
 * its qualified-name prefix ("ns::Class::"). Descends into namespaces, extern
 * "C" blocks and the public part of C++ classes: `access` is the access
 * level in force at the start of `nodes` (undefined: public, as in a
 * namespace).
 */
export function walkDecls(nodes, fn, scope = '', access) {
  for(const node of nodes || []) {
    if(node.kind === 'AccessSpecDecl') {
      access = node.access;
      continue;
    }
    if(access && access !== 'public') continue;

    fn(node, scope);

    if(node.kind === 'LinkageSpecDecl') walkDecls(node.inner, fn, scope);
    else if(node.kind === 'NamespaceDecl' && node.name) walkDecls(node.inner, fn, scope + node.name + '::');
    else if(node.kind === 'CXXRecordDecl' && node.name && !node.isImplicit) walkDecls(node.inner, fn, scope + node.name + '::', node.tagUsed === 'class' ? 'private' : 'public');
  }
}

/* C++ declarations that live inside a class and are collected on their own. */
const NESTED_KINDS = new Set(['CXXRecordDecl', 'EnumDecl', 'TypedefDecl', 'TypeAliasDecl']);

const CLASS_MEMBER_KINDS = new Set(['CXXMethodDecl', 'CXXConstructorDecl', 'CXXDestructorDecl']);

/* In C++ mode every struct is a CXXRecordDecl; one that declares no
 * methods and has no bases is still just data, i.e. an IR `structs` entry. */
function isPlainRecord(node) {
  return !(node.bases && node.bases.length) && !(node.inner || []).some(c => !c.isImplicit && CLASS_MEMBER_KINDS.has(c.kind));
}

/* Walks the translation unit's top-level declarations, tracking the
 * "current file" the way clang's own -ast-dump=json does: a node's
 * loc.file is only present when it differs from the previous node's, so a
 * node without one belongs to whatever file was last seen (see the sample
 * dump this was validated against -- system-header typedefs pulled in via
 * #include get their own file, then it switches back once real nodes from
 * a file accepted by `isSourceFile` start).
 */
export function collectIR(root, isSourceFile, idPrefix) {
  const ir = newIR();
  const seen = new Set();
  const typedefs = collectTypedefs(root);
  const enumIndex = collectEnumIndex(root);
  const recordTypedefs = collectRecordTypedefs(root);
  const enumIds = new Set();
  let currentFile = null;

  function addEnum(id) {
    const e = id !== undefined && enumIndex.enumsById[id];
    if(!e || enumIds.has(id)) return;
    enumIds.add(id);
    ir.enums.push({ id: idPrefix + id, name: e.name, kind: 'enum', fields: e.constants.map(c => ({ name: c.name, type: 'number', value: c.value })) });
  }

  function typeName(m, qualType) {
    return m.supported ? m.cf : normalizeType(qualType);
  }

  for(const node of root.inner || []) {
    if(node.loc && node.loc.file !== undefined) currentFile = node.loc.file;

    if(!isSourceFile(currentFile)) continue;

    collectDecl(node, '');
  }

  /* `scope` is the qualified-name prefix of the namespace/class `node` is in. */
  function collectDecl(node, scope) {
    if(node.isImplicit) return;

    switch (node.kind) {
      case 'EnumDecl':
        if(node.inner) addEnum(node.id);
        break;
      case 'RecordDecl':
        collectStruct(node, scope);
        break;
      case 'CXXRecordDecl':
        if(isPlainRecord(node)) collectStruct(node, scope);
        else collectClass(node, scope);
        break;
      case 'VarDecl':
        collectVariable(node);
        break;
      case 'FunctionDecl':
        collectFunction(node, scope);
        break;
      case 'TypedefDecl':
      case 'TypeAliasDecl':
        collectTypedef(node, scope);
        break;
      case 'LinkageSpecDecl':
        for(const child of node.inner || []) collectDecl(child, scope);
        break;
      case 'NamespaceDecl':
        if(node.name) for(const child of node.inner || []) collectDecl(child, scope + node.name + '::');
        break;
    }
  }

  /* The layout clang dumped for the record type spelled `name`, if any. */
  function layoutOf(name) {
    const l = (root.layouts || {})[normalizeType(name)];

    return l && l.align !== undefined ? l : undefined;
  }

  /* { size, align } in bytes of the C type `cType` (`resolved` being its
   * canonical spelling), or null if it cannot be told from the type alone:
   * scalars, pointers, arrays of those and records clang laid out. */
  function typeInfo(cType, resolved) {
    const t = resolved || cType;
    const array = /^(.*?)\s*((?:\[\d+\])+)$/.exec(t);

    if(array) {
      const elem = typeInfo(array[1], null);
      const count = [...array[2].matchAll(/\[(\d+)\]/g)].reduce((n, d) => n * Number(d[1]), 1);

      return elem && { size: elem.size * count, align: elem.align };
    }

    const m = mapCType(t, typedefs, enumIndex);

    if(m.supported) {
      const size = sizeOfC(m, t, typedefs, enumIndex);

      return size === null ? null : { size, align: m.def === 'longdouble' ? 16 : size };
    }

    const l = layoutOf(cType) || (resolved && layoutOf(resolved));

    return l ? { size: l.size, align: l.align } : null;
  }

  /* Bit offsets of the fields of a record clang could not lay out (a member
   * of incomplete type spoils the whole record): fields placed one after the
   * other at their natural alignment, bitfields packed into units of their
   * declared type like the x86-64 ABI does, up to the first field whose size
   * is unknown; the rest stay undefined. A packed record is not attempted. */
  function fallbackOffsets(node) {
    const fields = (node.inner || []).filter(c => c.kind === 'FieldDecl');
    const offsets = [];
    const up = (n, a) => Math.ceil(n / a) * a;
    let cursor = 0;

    if((node.inner || []).some(c => c.kind === 'PackedAttr')) return offsets;

    for(const f of fields) {
      const info = typeInfo(f.type.qualType, f.type.desugaredQualType);
      if(!info) break;

      if(f.isBitfield) {
        const unit = 8 * info.size;
        const width = Number(((f.inner || []).find(x => 'value' in x) || {}).value);

        if(node.tagUsed === 'union') offsets.push(0);
        else if(width === 0) offsets.push((cursor = up(cursor, unit)));
        else {
          if((cursor % unit) + width > unit) cursor = up(cursor, unit);
          offsets.push(cursor);
          cursor += width;
        }
      } else if(node.tagUsed === 'union') {
        offsets.push(0);
      } else {
        cursor = up(cursor, 8 * info.align);
        offsets.push(cursor);
        cursor += 8 * info.size;
      }
    }

    return offsets;
  }

  /* One struct member: `type` is the C type as written, `offset` and `size`
   * bytes (null where unknown), `ffi` what mapCType() makes of it. `bitOffset`
   * is the absolute bit offset from the layout dump and `size` the probed
   * byte size. A bitfield's `offset`/`size` are those of its storage unit (the
   * declared type, aligned) and its `bitOffset` is relative to that unit; a
   * reference member occupies a pointer. */
  function structField(node, bitOffset, size) {
    const cType = node.type.qualType;
    const m = mapCType((node.type && (node.type.desugaredQualType || cType)) || '', typedefs, enumIndex);
    const field = { name: node.name || '', type: cType, offset: null, size: null };
    const info = typeInfo(cType, node.type.desugaredQualType);

    if(size === undefined || /&$/.test(cType)) size = /&$/.test(cType) ? 8 : info ? info.size : null;

    if(node.isBitfield) {
      const unit = info ? info.size : null;

      field.size = unit;
      field.bits = Number(((node.inner || []).find(x => 'value' in x) || {}).value);
      field.bitOffset = null;

      if(bitOffset !== undefined && unit) {
        field.offset = Math.floor(bitOffset / (8 * unit)) * unit;
        field.bitOffset = bitOffset - field.offset * 8;
      }
    } else {
      field.size = size;
      if(bitOffset !== undefined) field.offset = bitOffset / 8;
    }

    field.ffi = typeName(m, cType);
    addEnum(m.enumId);
    return field;
  }

  /* typedef / using: `type` is the FFIType name when the aliased type maps to
   * one (else the C type), `record` the struct it names, if any. */
  function collectTypedef(node, scope) {
    const name = node.name && scope + node.name;
    if(!name || seen.has('typedef ' + name)) return;
    seen.add('typedef ' + name);

    const cType = node.type.qualType;
    const resolved = node.type.desugaredQualType;
    const m = mapCType(resolved || cType, typedefs, enumIndex);
    const entry = { name, kind: node.kind === 'TypeAliasDecl' ? 'using' : 'typedef', type: typeName(m, cType), cType };
    const elaborated = (node.inner || []).find(c => c.kind === 'ElaboratedType');
    const owned = elaborated && elaborated.ownedTagDecl;
    const layout = (root.layouts || {})['typedef ' + name];

    if(resolved && resolved !== cType) entry.resolved = resolved;
    if(owned && (owned.kind === 'RecordDecl' || owned.kind === 'CXXRecordDecl')) entry.record = owned.name ? scope + owned.name : (recordTypedefs[owned.id] || [])[0];
    if(layout) entry.size = layout.size;
    ir.typedefs.push(entry);
  }

  function collectStruct(node, scope) {
    if(!node.completeDefinition) return;

    const aliases = recordTypedefs[node.id] || [];
    const name = node.name ? scope + node.name : aliases[0];
    if(!name || seen.has('struct ' + name)) return;
    seen.add('struct ' + name);

    const fields = [];
    const layout = (root.layouts || {})[node.name ? (node.tagUsed || 'struct') + ' ' + name : aliases[0]];
    const offsets = layout ? layout.offsets : fallbackOffsets(node);
    let packed = false;
    let access = node.kind === 'CXXRecordDecl' && node.tagUsed === 'class' ? 'private' : 'public';
    let fieldIndex = 0;

    for(const child of node.inner || []) {
      if(child.kind === 'AccessSpecDecl') access = child.access;
      if(child.kind === 'PackedAttr') packed = true;
      if(NESTED_KINDS.has(child.kind) && access === 'public') collectDecl(child, name + '::');
      if(child.kind !== 'FieldDecl') continue;

      // Every field takes a layout slot, but only public ones are listed.
      const index = fieldIndex++;
      if(access === 'public') fields.push(structField(child, offsets[index], layout && layout.fieldSizes && layout.fieldSizes[child.name]));
    }

    const s = { name, type: node.tagUsed || 'struct', size: layout ? layout.size : null, align: layout ? layout.align : null, line: node.line === undefined ? null : node.line, methods: [], getters: [], setters: [], fields, prototypeChain: [] };
    if(aliases.length) s.typedefs = aliases;
    if(packed) s.packed = true;
    ir.structs.push(s);
  }

  function variableField(node) {
    const qualType = (node.type && (node.type.desugaredQualType || node.type.qualType)) || '';
    const isConst = isConstType(qualType);
    const value = node.inner && node.inner.length ? constValue(node.inner[0]) : undefined;
    const m = mapCType(qualType, typedefs, enumIndex);
    const field = { name: node.name, type: typeName(m, node.type.qualType), cType: node.type.qualType };

    if(isConst) field.const = true;
    if(value !== undefined) field.value = value;
    return { field, m, isConst, value };
  }

  function collectVariable(node) {
    if(seen.has('var ' + node.name)) return;

    const { field, m, isConst, value } = variableField(node);

    // A static variable is only worth exporting as a compile-time constant.
    if(node.storageClass === 'static' && (!isConst || value === undefined)) return;

    seen.add('var ' + node.name);
    ir.fields.push(field);
    addEnum(m.enumId);
  }

  /* Maps a function/method/constructor node's signature and returns
   * { isConst, ...the IR call description } (see describeCall), or null after
   * recording why in `skipped` under `label`.
   */
  function callable(node, label) {
    if(node.variadic) {
      ir.skipped.push({ name: label, reason: 'variadic functions are not supported' });
      return null;
    }

    const split = splitFunctionType(node.type.qualType);
    if(!split) {
      ir.skipped.push({ name: label, reason: 'could not parse function type "' + node.type.qualType + '"' });
      return null;
    }

    const retMap = mapCType(split.returnType, typedefs, enumIndex, 0, true);
    if(!retMap.supported) {
      ir.skipped.push({ name: label, reason: 'return type: ' + retMap.reason });
      return null;
    }

    const params = [];

    for(const child of node.inner || []) {
      if(child.kind !== 'ParmVarDecl') continue;

      const qualType = (child.type && (child.type.desugaredQualType || child.type.qualType)) || '';
      const pm = mapCType(qualType, typedefs, enumIndex, 0, true);

      if(!pm.supported) {
        ir.skipped.push({ name: label, reason: 'parameter ' + (child.name || '#' + params.length) + ' (' + qualType + '): ' + pm.reason });
        return null;
      }

      params.push({ name: child.name || 'a' + params.length, type: pm });
    }

    const used = [retMap, ...params.map(p => p.type)].map(m => m.enumId).filter(id => id !== undefined);
    for(const id of used) addEnum(id);

    /* Where a struct is passed or returned by value (at -1: the return
     * value), to be settled by resolveByValue(). */
    const byValue = [retMap, ...params.map(p => p.type)].map((m, i) => m.byValue && { ...m.byValue, at: i - 1 }).filter(Boolean);

    return {
      isConst: split.isConst,
      arity: params.length,
      params: params.map(p => p.name + ': ' + p.type.cf),
      returnType: retMap.cf,
      defTypes: { returnType: retMap.def, params: params.map(p => p.type.def) },
      enums: [...new Set(used)].map(id => idPrefix + id),
      ...(byValue.length ? { byValue } : {}),
    };
  }

  function collectFunction(node, scope) {
    if(node.storageClass === 'static') return;

    const cxx = node.mangledName && node.mangledName !== node.name;
    const key = cxx ? node.mangledName : node.name;
    if(seen.has(key)) return;

    const name = cxx ? scope + node.name : node.name;

    if(cxx && node.name.startsWith('operator')) {
      ir.skipped.push({ name, reason: 'operators are not supported' });
      return;
    }

    const call = callable(node, name);
    if(!call) return;

    seen.add(key);

    const { isConst, ...description } = call;
    ir.methods.push({ name, kind: 'function', ...(cxx ? { mangledName: node.mangledName } : {}), ...description });
  }

  /* A C++ class: its public fields, constructors, methods and (single)
   * destructor, each with the `mangledName` clang gives it, which is what
   * dlsym() needs. Private/protected members are only counted for field
   * offsets. A nested class or enum is collected on its own, qualified.
   */
  function collectClass(node, scope) {
    if(!node.completeDefinition || !node.name) return;

    const name = scope + node.name;
    if(seen.has('class ' + name)) return;
    seen.add('class ' + name);

    const tag = node.tagUsed || 'class';
    const layout = (root.layouts || {})[tag + ' ' + name];
    const info = node.definitionData || {};
    const offsets = layout ? layout.offsets : fallbackOffsets(node);
    const cls = { name, type: tag, size: null, align: null, line: node.line === undefined ? null : node.line, bases: [], methods: [], getters: [], setters: [], fields: [], prototypeChain: [], constructors: [] };
    let access = tag === 'class' ? 'private' : 'public';
    let fieldIndex = 0;

    if(layout) ((cls.size = layout.size), (cls.align = layout.align));
    if(info.isAbstract) cls.abstract = true;
    if(info.isPolymorphic) cls.polymorphic = true;

    for(const base of node.bases || []) {
      const entry = { name: base.type.desugaredQualType || base.type.qualType, access: base.access };

      if(base.isVirtual) entry.virtual = true;
      cls.bases.push(entry);
    }

    for(const child of node.inner || []) {
      if(child.kind === 'AccessSpecDecl') {
        access = child.access;
        continue;
      }

      if(child.kind === 'FieldDecl') {
        const index = fieldIndex++;
        if(access === 'public') cls.fields.push(structField(child, offsets[index], layout && layout.fieldSizes && layout.fieldSizes[child.name]));
        continue;
      }

      if(child.isImplicit || child.explicitlyDeleted || access !== 'public') continue;

      const label = name + '::' + child.name;

      switch (child.kind) {
        case 'CXXRecordDecl':
        case 'EnumDecl':
        case 'TypedefDecl':
        case 'TypeAliasDecl':
          collectDecl(child, name + '::');
          break;
        case 'VarDecl': {
          const { field, m } = variableField(child);

          cls.fields.push({ name: field.name, type: field.cType, ffi: field.type, ...(field.const ? { const: true } : {}), ...(field.value === undefined ? {} : { value: field.value }), static: true, mangledName: child.mangledName });
          addEnum(m.enumId);
          break;
        }
        case 'CXXDestructorDecl':
          cls.destructor = { mangledName: child.mangledName };
          if(child.virtual) cls.destructor.virtual = true;
          break;
        case 'CXXConstructorDecl':
        case 'CXXMethodDecl': {
          if(child.name.startsWith('operator')) {
            ir.skipped.push({ name: label, reason: 'operators are not supported' });
            break;
          }

          // An abstract class is never a complete object: only the base-object
          // constructor (C2) is emitted, no C1 to dlsym().
          if(child.kind === 'CXXConstructorDecl' && info.isAbstract) break;

          const call = callable(child, label);
          if(!call) break;

          const { isConst, ...description } = call;
          const entry = { name: child.name, kind: child.kind === 'CXXConstructorDecl' ? 'constructor' : 'function', mangledName: child.mangledName };

          if(entry.kind === 'function') {
            entry.static = child.storageClass === 'static';
            if(isConst) entry.const = true;
            if(child.virtual) entry.virtual = true;
            if(child.pure) entry.pure = true;
          } else {
            delete description.returnType;
            delete description.defTypes.returnType;
          }

          Object.assign(entry, description);
          (entry.kind === 'constructor' ? cls.constructors : cls.methods).push(entry);
          break;
        }
      }
    }

    if(layout && layout.vtableIndices) assignVtableSlots(cls, layout.vtableIndices);

    ir.classes.push(cls);
  }

  return ir;
}

/* --- intermediate format (IR) --------------------------------------------- */

/* Shaped like describeObject() output (qjs-modules lib/describe-object.js):
 *   methods   kind:"function" entries: `arity`, `params` ("name: type" in
 *             TypeScript style, type being an FFIType name), `returnType`;
 *             plus `defTypes` (legacy define() type names) and `enums` (ids
 *             of the enums the signature uses). A function with C++ linkage
 *             has its qualified `name` ("ns::fn") and the `mangledName` to
 *             dlsym(); overloads are separate entries
 *   fields    exported variables/constants: { name, type, value?, const? }
 *   enums     { id, name, kind:"enum", fields:[{ name, type:"number", value }] }
 *   structs   { name, type:"struct"|"union", size, align (bytes), line,
 *             methods:[], getters:[], setters:[], fields, prototypeChain:[] },
 *             describeObject()-shaped, plus packed? and typedefs? (names that
 *             alias it). `size`, `align` and `line` are null where unknown.
 *             Each field is { name, type, offset, size, ffi }: `type` is the C
 *             type as written ("size_t", "char[4096]", "int (*)()"),
 *             `offset`/`size` are bytes (null where clang gave no layout, e.g.
 *             after a member of incomplete type) and `ffi` is what the field
 *             maps to for the ffi module ("u64", "struct node *"; the C type
 *             again when unsupported). A bitfield also has `bits`, its
 *             `offset`/`size` are those of its storage unit (the declared
 *             type) and its `bitOffset` counts from that unit's first bit.
 *             Sizes/offsets come from clang's record layouts (see
 *             runLayoutDump()), else from the type
 *   typedefs  typedef / using aliases: { name (qualified), kind:"typedef"|
 *             "using", type (FFIType name, else the C type), cType (as
 *             written), resolved? (canonical, when it differs), record? (the
 *             struct it names), size? (bytes) }
 *   skipped   { name, reason } for declarations that could not be bound
 * `source` records how the IR was produced, for the generated file's header.
 *   classes   C++ classes (and structs with methods or bases), shaped like
 *             structs: { name (qualified, "ns::Class"), type:"class"|"struct",
 *             size, align, line, abstract?, polymorphic?, bases:[{ name, access,
 *             virtual? }], fields (as `structs`, plus static:true and
 *             mangledName for static members, which have no offset/size),
 *             constructors, methods,
 *             destructor?:{ mangledName, virtual? } }. Only public members.
 *             `prototypeChain` lists the ancestors (first base each), see
 *             linkPrototypeChains().
 *             A method is a `methods`-style entry plus `mangledName` (the
 *             dlsym() name), `static`, `const?`, `virtual?`, `pure?`; its
 *             `params` do not list `this`. A constructor is the same with
 *             kind:"constructor" and the complete-object (C1) mangledName;
 *             an abstract class has none.
 */
export function newIR() {
  return { name: 'bindings', type: 'object', version: 1, methods: [], fields: [], getters: [], setters: [], enums: [], structs: [], classes: [], typedefs: [], skipped: [], prototypeChain: [] };
}

/* Fills each class's `prototypeChain` like describeObject() does for a JS
 * object: one { level, constructorName, methods, getters, setters, fields }
 * per ancestor, following the first base (the one a generated class extends).
 * Needs every class of the IR, so it runs after the sources are merged. */
export function linkPrototypeChains(ir) {
  const byName = new Map(ir.classes.map(c => [c.name, c]));

  for(const c of ir.classes) {
    const visited = new Set([c.name]);

    c.prototypeChain = [];

    for(let b = c; b.bases[0] && byName.has(b.bases[0].name) && !visited.has(b.bases[0].name); ) {
      b = byName.get(b.bases[0].name);
      visited.add(b.name);
      c.prototypeChain.push({ level: c.prototypeChain.length, constructorName: b.name, methods: b.methods, getters: b.getters, setters: b.setters, fields: b.fields });
    }
  }
}

/* Merges `from` into `into`, keeping the first declaration of a name (a
 * variable declared without a value is upgraded by a later one with it). */
export function mergeIR(into, from) {
  const add = (list, items, key) => {
    const id = typeof key === 'function' ? key : x => x[key];
    const have = new Set(list.map(id));
    for(const item of items) if(!have.has(id(item))) (have.add(id(item)), list.push(item));
  };

  for(const f of from.fields) {
    const have = into.fields.find(x => x.name === f.name);
    if(have && have.value === undefined && f.value !== undefined) have.value = f.value;
  }

  add(into.methods, from.methods, m => m.mangledName || m.name);
  add(into.fields, from.fields, 'name');
  add(into.enums, from.enums, 'id');
  add(into.structs, from.structs, 'name');
  add(into.classes, from.classes, 'name');
  add(into.typedefs, from.typedefs, 'name');
  add(into.skipped, from.skipped, 'name');
  return into;
}

function isConstType(qualType) {
  const t = qualType.trim();
  return /(^|[\s*])const$/.test(t) || (!t.includes('*') && /^const\b/.test(t));
}

/* Evaluates the literal initializer of a constant variable, or undefined if
 * it is anything but a (possibly negated) number/character/string literal. */
function constValue(node) {
  switch (node.kind) {
    case 'IntegerLiteral':
    case 'FloatingLiteral':
    case 'CharacterLiteral':
    case 'ConstantExpr': {
      const n = Number(node.value);
      return node.value !== undefined && Number.isFinite(n) ? n : node.inner ? constValue(node.inner[0]) : undefined;
    }
    case 'StringLiteral':
      try {
        return JSON.parse(node.value);
      } catch(e) {
        return undefined;
      }
    case 'ImplicitCastExpr':
    case 'ParenExpr':
      return node.inner ? constValue(node.inner[0]) : undefined;
    case 'UnaryOperator': {
      const v = node.inner ? constValue(node.inner[0]) : undefined;
      return typeof v !== 'number' ? undefined : node.opcode === '-' ? -v : node.opcode === '+' ? v : undefined;
    }
  }
  return undefined;
}

/* record node id -> every (qualified) typedef name wrapping it
 * (`typedef struct {..} T;`) */
export function collectRecordTypedefs(root) {
  const names = {};

  walkDecls(root.inner, (node, scope) => {
    if(node.kind !== 'TypedefDecl') return;

    const elaborated = (node.inner || []).find(c => c.kind === 'ElaboratedType');
    const owned = elaborated && elaborated.ownedTagDecl;

    if(owned && (owned.kind === 'RecordDecl' || owned.kind === 'CXXRecordDecl')) (names[owned.id] = names[owned.id] || []).push(scope + node.name);
  });

  return names;
}

/* --- code generation ----------------------------------------------------- */
