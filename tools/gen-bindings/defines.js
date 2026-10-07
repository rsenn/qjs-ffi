/* a regex scanner for the object-like #define lines of a header, for the
 * constants clang's AST does not carry (macros are gone after the
 * preprocessor). */

const LINE = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)(?![\w(])[ \t]*(.*)$/;
const TOKEN = /\s*(?:(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.\d*(?:[eE][-+]?\d+)?[fFlL]?|\.\d+(?:[eE][-+]?\d+)?[fFlL]?|\d+[eE][-+]?\d+[fFlL]?|\d+)([uUlL]*)|'((?:[^'\\]|\\.)+)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_]\w*)|(<<|>>|[-+*\/%&|^~!()]))/y;

const ESCAPES = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '\\': 92, "'": 39, '"': 34, '?': 63, 0: 0 };

/* the source text without comments and with continued lines joined. */
function clean(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\\\r?\n/g, ' ');
}

function charValue(s) {
  if(s[0] !== '\\') return BigInt(s.codePointAt(0));
  if(/^\\x[0-9a-fA-F]+$/.test(s)) return BigInt(parseInt(s.slice(2), 16));
  if(/^\\[0-7]{1,3}$/.test(s)) return BigInt(parseInt(s.slice(1), 8));
  return s.length === 2 && s[1] in ESCAPES ? BigInt(ESCAPES[s[1]]) : undefined;
}

function tokenize(body) {
  const out = [];
  let m;

  TOKEN.lastIndex = 0;

  while(TOKEN.lastIndex < body.length && /\S/.test(body.slice(TOKEN.lastIndex))) {
    if(!(m = TOKEN.exec(body))) return null;

    if(m[1] !== undefined) {
      const n = m[1];

      if(/^0[xXbB]/.test(n)) out.push({ t: 'int', v: BigInt(n) });
      else if(/[.eE]/.test(n)) out.push({ t: 'float', v: Number(n.replace(/[fFlL]$/, '')) });
      else out.push({ t: 'int', v: n.length > 1 && n[0] === '0' ? BigInt('0o' + n.slice(1)) : BigInt(n) });
    } else if(m[3] !== undefined) {
      const v = charValue(m[3]);

      if(v === undefined) return null;
      out.push({ t: 'int', v });
    } else if(m[4] !== undefined) {
      try {
        out.push({ t: 'str', v: JSON.parse('"' + m[4] + '"') });
      } catch(e) {
        return null;
      }
    } else if(m[5] !== undefined) out.push({ t: 'id', v: m[5] });
    else out.push({ t: 'op', v: m[6] });
  }

  return out;
}

const BINARY = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];

function apply(op, a, b) {
  if(a.t === 'str' || b.t === 'str') return undefined;

  if(a.t === 'int' && b.t === 'int') {
    const x = a.v, y = b.v;

    switch (op) {
      case '|': return { t: 'int', v: x | y };
      case '^': return { t: 'int', v: x ^ y };
      case '&': return { t: 'int', v: x & y };
      case '<<': return y >= 0n && y < 128n ? { t: 'int', v: x << y } : undefined;
      case '>>': return y >= 0n && y < 128n ? { t: 'int', v: x >> y } : undefined;
      case '+': return { t: 'int', v: x + y };
      case '-': return { t: 'int', v: x - y };
      case '*': return { t: 'int', v: x * y };
      case '/': return y ? { t: 'int', v: x / y } : undefined;
      case '%': return y ? { t: 'int', v: x % y } : undefined;
    }
  }

  const x = Number(a.v), y = Number(b.v);

  switch (op) {
    case '+': return { t: 'float', v: x + y };
    case '-': return { t: 'float', v: x - y };
    case '*': return { t: 'float', v: x * y };
    case '/': return { t: 'float', v: x / y };
  }

  return undefined;
}

/* evaluates a macro body: literals, other known macros, ( ) and the C
 * operators of integers; undefined for anything else (casts, sizeof,
 * function calls, ?:, comparisons).
 *
 * ```js
 * evalBody("(1 << 4) | 0x2", {});   // { t: "int", v: 18n }
 * evalBody('"a" "b"', {});          // { t: "str", v: "ab" }
 * ```
 */
export function evalBody(body, known) {
  const toks = tokenize(body);
  let i = 0;

  if(!toks || !toks.length) return undefined;

  function primary() {
    const t = toks[i++];

    if(!t) return undefined;
    if(t.t === 'int' || t.t === 'float') return t;

    if(t.t === 'str') {
      let s = t.v;

      while(toks[i] && toks[i].t === 'str') s += toks[i++].v;
      return { t: 'str', v: s };
    }

    if(t.t === 'id') return Object.hasOwn(known, t.v) ? known[t.v] : undefined;

    if(t.v === '(') {
      const v = binary(0);

      return v && toks[i] && toks[i].v === ')' && ++i ? v : undefined;
    }

    if(t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!') {
      const v = primary();

      if(!v || v.t === 'str') return undefined;
      if(t.v === '+') return v;
      if(t.v === '-') return { t: v.t, v: -v.v };
      return v.t === 'int' ? { t: 'int', v: t.v === '~' ? ~v.v : v.v === 0n ? 1n : 0n } : undefined;
    }

    return undefined;
  }

  function binary(level) {
    if(level === BINARY.length) return primary();

    let left = binary(level + 1);

    while(left && toks[i] && toks[i].t === 'op' && BINARY[level].includes(toks[i].v)) {
      const op = toks[i++].v, right = binary(level + 1);

      left = right && apply(op, left, right);
    }

    return left;
  }

  const v = binary(0);

  return v && i === toks.length ? v : undefined;
}

/* the entry of the IR's `defines` for an evaluated value: a number when it
 * is exact as one, else the decimal text of the integer with big: true. */
function entry(name, v) {
  if(v.t === 'str') return { name, type: 'string', value: v.v };
  if(v.t === 'float') return Number.isFinite(v.v) ? { name, type: 'float', value: v.v } : undefined;
  if(v.v >= -(2n ** 53n) && v.v <= 2n ** 53n) return { name, type: 'int', value: Number(v.v) };
  if(v.v >= -(2n ** 63n) && v.v < 2n ** 64n) return { name, type: 'int', value: v.v.toString(), big: true };
  return undefined;
}

/* the constants `#define`d in `text`, in order, as { name, type, value }.
 *
 * ```js
 * scanDefines("#define N 5\n#define M (N * 2)\n#define S \"x\"\n");
 * // [{ name: "N", type: "int", value: 5 },
 * //  { name: "M", type: "int", value: 10 },
 * //  { name: "S", type: "string", value: "x" }]
 * ```
 *
 * Function-like macros, empty ones (include guards), names starting with
 * `_` and bodies that are not a constant expression are left out; a name
 * defined twice keeps its first value.
 *
 *   string  text   a header's source
 *   object  known  macros already evaluated (name -> value), by a header
 *                  this one includes; updated with this header's
 */
export function scanDefines(text, known = {}) {
  const out = [];
  const seen = new Set(Object.keys(known));

  for(const line of clean(text).split(/\r?\n/)) {
    const m = LINE.exec(line);

    if(!m || m[1].startsWith('_') || seen.has(m[1]) || !m[2].trim()) continue;

    const v = evalBody(m[2], known), e = v && entry(m[1], v);

    seen.add(m[1]);
    if(!e) continue;
    known[m[1]] = v;
    out.push(e);
  }

  return out;
}

/* the quoted #include targets of `text`, as written. */
export function localIncludes(text) {
  return [...clean(text).matchAll(/^[ \t]*#[ \t]*include[ \t]+"([^"]+)"/gm)].map(m => m[1]);
}
