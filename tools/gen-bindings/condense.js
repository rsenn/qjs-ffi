import { JsonParser } from 'json';
import { header } from './emit/common.js';

/* clang's JSON AST is megabytes per header (cairo.h: ~3.7MB), nearly all of
 * it source ranges, function bodies and attributes irrelevant here. It is
 * read token by token from clang's stdout with json.JsonParser and only the
 * needed nodes/keys are ever materialized; everything else is consumed and
 * dropped. Which children a node keeps is decided the moment its "kind" key
 * arrives (clang always writes "id", then "kind", before anything else).
 */
const TOP_KINDS = new Set(['FunctionDecl', 'VarDecl', 'EnumDecl', 'RecordDecl', 'TypedefDecl', 'TypeAliasDecl', 'CXXRecordDecl', 'NamespaceDecl', 'LinkageSpecDecl']);

const CLASS_KINDS = new Set(['FieldDecl', 'VarDecl', 'EnumDecl', 'TypedefDecl', 'TypeAliasDecl', 'CXXRecordDecl', 'CXXMethodDecl', 'CXXConstructorDecl', 'CXXDestructorDecl']);

const DROP_KEYS = new Set(['range', 'referencedDecl', 'previousDecl', 'parentDeclContext', 'valueCategory', 'isUsed', 'isReferenced']);

const RECORD_INFO_KEYS = new Set(['isAbstract', 'isPolymorphic']);

/* System-library namespaces (std, __gnu_cxx, ...) hold megabytes of
 * declarations nobody binds. */
const SYSTEM_NAMESPACE = /^(std|__\w*)$/;

const LOC_KEYS = new Set(['file', 'line', 'spellingLoc', 'expansionLoc']);

const EXPR_KEYS = new Set(['kind', 'value', 'opcode', 'inner']);

const EXPR_KIND = /(Expr|Literal|Operator)$/;

/* 'skip': drop the node; 'shallow': keep only id/kind/name/loc (still needed
 * for clang's "current file" tracking); 'leaf': keep its keys but not its
 * children; 'expr': constant-expression node, keep EXPR_KEYS only; 'full':
 * keep, and recurse with this same policy for its children.
 */
function nodePolicy(parent, kind) {
  switch (parent) {
    case 'TranslationUnitDecl':
      return TOP_KINDS.has(kind) ? 'full' : 'shallow';
    case 'NamespaceDecl':
    case 'LinkageSpecDecl':
      return TOP_KINDS.has(kind) ? 'full' : 'skip';
    case 'FunctionDecl':
    case 'CXXMethodDecl':
    case 'CXXConstructorDecl':
    case 'CXXDestructorDecl':
      return kind === 'ParmVarDecl' ? 'leaf' : 'skip';
    case 'EnumDecl':
      return kind === 'EnumConstantDecl' ? 'full' : 'skip';
    case 'RecordDecl':
      return kind === 'FieldDecl' || kind === 'RecordDecl' || kind === 'EnumDecl' || kind === 'AlignedAttr' ? 'full' : kind === 'PackedAttr' ? 'leaf' : 'skip';
    case 'CXXRecordDecl':
      return CLASS_KINDS.has(kind) || kind === 'AlignedAttr' ? 'full' : kind === 'AccessSpecDecl' || kind === 'PackedAttr' || kind === 'FinalAttr' ? 'leaf' : 'skip';
    case 'TypedefDecl':
    case 'TypeAliasDecl':
      return kind === 'ElaboratedType' ? 'leaf' : 'skip';
    case 'VarDecl':
    case 'EnumConstantDecl':
    case 'FieldDecl':
    case 'AlignedAttr':
      return EXPR_KIND.test(kind) ? 'expr' : 'skip';
  }
  return EXPR_KIND.test(parent) && EXPR_KIND.test(kind) ? 'expr' : 'skip';
}

const { NEED_DATA, NONE, OBJECT, OBJECT_END, ARRAY, ARRAY_END, KEY, STRING, TRUE, FALSE, NULL, NUMBER } = JsonParser;

export class AstCondenser {
  constructor(parser) {
    this.p = parser;

    // clang writes a location's "line" only when it differs from the last
    // location it wrote, in document order, so a node without one is on the
    // line last seen anywhere, skipped subtrees included.
    this.line = 0;
  }

  next() {
    const t = this.p.parse();
    if(t === NEED_DATA) throw new Error('unexpected end of clang AST JSON');
    return t;
  }

  scalar(t) {
    switch (t) {
      case STRING:
        return this.p.token;
      case NUMBER:
        return Number(this.p.token);
      case TRUE:
        return true;
      case FALSE:
        return false;
      case NULL:
        return null;
    }
    throw new Error('unexpected clang AST JSON token ' + t);
  }

  /* Consumes the rest of a value whose first token `t` was already read. */
  skip(t) {
    if(t !== OBJECT && t !== ARRAY) return;

    for(let depth = 1, key = null; depth > 0; ) {
      const u = this.next();

      if(u === KEY) {
        key = this.p.token;
        continue;
      }

      if(u === NUMBER && key === 'line') this.line = Number(this.p.token);
      key = null;

      if(u === OBJECT || u === ARRAY) depth++;
      else if(u === OBJECT_END || u === ARRAY_END) depth--;
    }
  }

  /* Reads any value, keeping only `keys` (or every key if null) of each
   * object; `t` is the value's first token. */
  plain(t, keys) {
    if(t === OBJECT) {
      const o = {};
    
      for(let u; (u = this.next()) !== OBJECT_END; ) {
        const key = this.p.token;
        const v = this.next();
    
        if(keys && !keys.has(key)) this.skip(v);
        else o[key] = this.plain(v, keys);

        if(key === 'line' && typeof o[key] === 'number') this.line = o[key];
      }

      return o;
    }

    if(t === ARRAY) {
      const a = [];
      
      for(let u; (u = this.next()) !== ARRAY_END; ) a.push(this.plain(u, keys));
      
      return a;
    }

    return this.scalar(t);
  }

  /* Reads one node object (its opening "{" already consumed); returns null
   * if `nodePolicy(parent, kind)` says to drop it. */
  node(parent) {
    const o = {};
    let kind,
      policy = 'full';

    for(let u; (u = this.next()) !== OBJECT_END; ) {
      const key = this.p.token;
      const v = this.next();

      if(kind === undefined) {
        o[key] = this.scalar(v);

        if(key === 'kind') {
          kind = o.kind;
          policy = parent === null ? 'full' : nodePolicy(parent, kind);
        
          if(policy === 'skip') {
            this.skip(OBJECT);
            return null;
          }
        }
      } else if(policy === 'expr') {
        if(EXPR_KEYS.has(key) && key !== 'inner') o[key] = this.plain(v, null);
        else if(key === 'inner') o.inner = this.inner(kind, v);
        else this.skip(v);
      } else if(key === 'loc') {
        if(parent === 'TranslationUnitDecl' || parent === null) o.loc = this.plain(v, LOC_KEYS);
        else this.skip(v);

        if(policy !== 'shallow') o.line = this.line;
      } else if(key === 'inner') {
        if(policy === 'full') o.inner = this.inner(kind, v);
        else this.skip(v);
      } else if(DROP_KEYS.has(key) || (policy === 'shallow' && key !== 'name')) {
        this.skip(v);
      } else {
        o[key] = this.plain(v, key === 'definitionData' ? RECORD_INFO_KEYS : null);

        if(kind === 'NamespaceDecl' && key === 'name' && SYSTEM_NAMESPACE.test(o.name)) policy = 'shallow';
      }
    }

    return o;
  }

  inner(parent, t) {
    if(t !== ARRAY) throw new Error('clang AST: "inner" is not an array');
    const a = [];

    for(let u; (u = this.next()) !== ARRAY_END; ) {
      const n = this.node(parent);
      if(n) a.push(n);
    }
    
    return a;
  }

  root() {
    if(this.next() !== OBJECT) throw new Error('clang AST: root is not an object');
    return this.node(null);
  }
}
