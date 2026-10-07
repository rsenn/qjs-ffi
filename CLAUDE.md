# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## BUGS file format

Newly discovered bugs (see root `CLAUDE.md`, "Track Newly Discovered Bugs")
are appended to `BUGS` in this directory, one entry per bug, in the order
found, shaped like:

    - <canonical-name> (<file>:<line>): <short plain-text description
      of what's broken and how it was confirmed>

        <JS code that triggers it, or a one-line note if not
        practically reproducible in plain JS>

`canonical-name` is a short kebab-case handle for referring back to the
bug elsewhere (commit messages, other BUGS entries). The source location
is the primary place the bug lives, not every place it's felt.

`BUGS` itself is plain lowercase text: no back-quotes in descriptions,
keep descriptions to a sentence or two, and always include the source
location of the bug.

Always append newly discovered bugs to `BUGS` as soon as you find them,
without asking first or waiting to be told - this applies any time you're
working in this directory, not just when explicitly hunting for bugs.
Check at the end of a task whether anything surfaced during the work
(errors seen while testing, oddities noticed while reading code, things
that "shouldn't happen" but did) got logged; if not, log it before
finishing.

Once a bug is actually fixed, remove its entry from `BUGS` entirely -
don't leave it in tagged `[FIXED]`. `BUGS` tracks what's still open, not a
changelog of past fixes; a fix's own commit message (or, if the fix
uncovered something worth remembering during the chase - a wrong
assumption, a second bug found along the way, an install/build gotcha -
a note in the relevant source comment) is where that history belongs
instead.

## Comments

These rules govern every comment you write or rewrite in this repo, from
here on. Keep comments short and readable, not a running log of debugging
history — and not a packed block of prose either. A comment should be
something the reader's eye takes in as a shape, the way a table or a
diagram is, not something they have to read start to end to parse.

- Struct-member comments: 1-2 lines, right on the member.
- Any other comment explaining behavior: 4 lines max. If the full
  rationale genuinely needs more room, don't write a longer paragraph —
  restructure: a one-line summary, then a short list (one point per
  fact), or the argument table below. Never let a comment become an
  unbroken block of sentences; break it into pieces the eye can scan.
- Never reference `BUGS` / `TODO.md` entries, issue names, or "confirmed
  via repro X" in a comment — that history belongs in the commit message
  not in the source. State the current rule and its reason, not how it was discovered or what broke before it existed.
- Prefer showing over telling: when a C expression, a literal value, or
  a short before/after pair makes the point, put that in the comment
  instead of describing it in words. code says more, faster, than a sentence explaining the same fact.
- If a comment describes a function's parameters, give each one its own
  line: 2-space indent, then type, name, and description as aligned
  columns (pad names so the descriptions all start at the same column):
  ```
  /* one-line summary of what the function does.
   *
   *   const char*  name   what this argument is / controls
   *   size_t       len    what this argument is / controls
   *
   *   returns ssize_t     what the return value means
   /
  ```
- Write sentences a reader can take in on one pass: subject, verb,
  concrete fact, in that order. No hedging, no throat-clearing, no
  "used to X / now Y" history — state the current behavior and, if it's
  not obvious, the one reason it has to be that way.
- A comment starts lowercase, unless its first word is an identifier that
  starts with an uppercase letter (`CFunction: ...`, `JSClassDef.call ...`).
  Applies to every comment you write, rewritten or new. Later sentences in
  a comment are fragments or follow after `;`, not new capitalised ones.
- Comment text is 75 columns at most, measured after the leading ` * `
  (or `/* `); with the prefix that is 78, so a closing ` */` still fits.
- Multi-line code in a comment is fenced: ```` ```js ```` for JS and
  ```` ```c ```` for C, each fence on its own comment line. A one-line
  snippet stays in single backticks.
- A function's comment says what the function does, in plain words, in its
  first line. After two lines a reader who has not seen the code can say
  what goes in and what comes out; if they cannot, rewrite it.
- Show one concrete input and its result instead of describing the shape:
  `{ abs: <function> }` beats "an object with one entry per key".
- One comment per function, never one block shared by several. Name what
  each parameter is for in plain words, with the real value where it is a
  message (`"dlopen: symbol not found"`), not jargon like "prefixes the
  error messages".
- Never a packed block of text. Summary line, example, parameter columns
  and `returns` are separate paragraphs, split by an empty ` *` line.

### A JS-facing function, class or object gets a header block

Whatever C exposes to JS (a function, a class, an object spliced into the
export list) is explained once, in a block at its declaration: in the `.h`
for what other files call, above the definition for a `static`. The block
reads like the JS docs, in JS terms, and is the one place the 4-line prose
cap does not count the example and the table. Order:

1. `Name: what it is` (and the bun/Node API it mirrors, if any).
2. The JS usage as code in a ```js fence, not described in words.
3. Arguments and result as aligned columns, with the accepted forms, the
   default and the range in the description.
4. `throws`: which error type, for what.
5. One line on how it is wired in (`JS_OBJECT_DEF(...)` entry, `defaults`).

Example, after `ffi-read.h`:

````c
/* read: direct memory reads, no DataView or ArrayBuffer (bun:ffi's read).
 *
 * ```js
 * read.u8(ptr, byteOffset);
 * read.i64(ptr); // a bigint
 * ```
 *
 *   number|bigint|buffer  ptr         address, or an ArrayBuffer/view
 *   number                byteOffset  default 0, may be negative
 *
 *   returns  Number, bigint (i64, u64) or pointer (ptr), by member name
 *   throws   TypeError for a NULL pointer
 *
 * spliced into the export list:
 * JS_OBJECT_DEF("read", js_ffiread_funcs, FFI_READ_COUNT, ...).
 */
````

The same shape serves a class: constructor usage, then one line per
method/getter, then `throws`. Internals (ownership, why a pointer is
held) go in the 4-line comments at the code, not in this block.

## Running scripts with qjsm

To run a script (e.g. a throwaway test file while debugging), invoke it
as the plain positional argument: `qjsm script.js [args]` - same as
`repl.js`'s own header comment documents running itself
(`qjsm repl.js [--model ...]`).

Never use `qjsm -m script.js` (or `--module`) for this - `-m`/`--module`
is qjsm's special module loader (package.json/.ts-aware resolution,
per `qjsm --help`: "load an ES6 module"), unrelated to running a script
as the main program. A plain script run without `-m` already supports
`import`/`export` (it's ES module syntax either way) - `-m` is not
"the way to get module support", it's a different, unrelated loading
path, and using it to run a script is a category error, not just a
stylistic difference.

## Git commits

Omit the `Co-Authored-By: ...` trailer from commit messages. This overrides
any default attribution line Claude Code would otherwise append.


## Source layout

The `diet-coding` skill's one-function-per-source-file rule does not apply
here. A source file groups what belongs together (a class, a JS-facing
module, a helper family), as `c-function.c`, `ffi-type.c` and
`js-helpers.c` already do. The rest of the skill (explicit lengths, no
stdio/printf in hot paths, measuring with `size`/`nm`) still holds.
