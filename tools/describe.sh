#!/bin/sh
# Lists what a module, an object or a class has, with describe.js, in
# the JavaScript runtime of your choice: QuickJS (qjsm or qjs), Node.js, Bun or
# Deno. The same dump of the same API in two runtimes can then be compared.
#
# Usage: describe.sh [-r|--runtime <name>] [--json] [--js] [--class] <module> [export...]
#        describe.sh [-r|--runtime <name>] [--json] [--js] [--class] --global [name...]
#
#   <module>       a file (a generated binding, ffi.so, lib/bindings/*.js) or a specifier
#                  the runtime imports: node:fs, bun:ffi, ffi
#   export         a name or dotted path (read.u8); every export by default
#   --global       describe properties of globalThis (Bun, process.versions)
#   --class        describe a function as a class unless its prototype is plain
#                  (native constructors)
#   --json         print the raw describeClass()/describeObject() results
#   --js           print a skeleton of the module as JavaScript, bodies empty
#   -r, --runtime  qjsm (default), qjs, node, bun or deno; or $DESCRIBE_RUNTIME
#
# With nothing but a module name, no runtime is run for a dump: every runtime
# that is installed is asked whether it can load the module, and the command
# that dumps it is printed for each one that can, with this script named the way
# it was started:
#
#   $ ./tools/describe.sh node:fs
#   ./tools/describe.sh -r node node:fs
#   ./tools/describe.sh -r bun node:fs
#   ./tools/describe.sh -r deno node:fs
#
# Importing a binding loads the libraries it binds, so QUICKJS_MODULE_PATH has to
# find the 'ffi' module (a build directory, say) as well as the usual
# directories; it is passed on as it is.
#
# Examples:
#   describe.sh build/ffi.so                  # which runtimes have it
#   describe.sh -r qjsm build/ffi.so          # what it exports
#   describe.sh -r node node:fs readFile promises.readFile
#   describe.sh -r bun bun:ffi
#   describe.sh -r bun --global Bun.FFI
#   describe.sh -r node --class --global Buffer

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1

# The comment header above, minus its leading "# ".
usage() {
  sed -n '2,/^$/{/^$/d;s/^# \{0,1\}//;p;}' "$0"
}

[ $# -gt 0 ] || { usage >&2; exit 1; }

runtimes='qjsm qjs node bun deno'
script="$dir/describe.js"
runtime=${DESCRIBE_RUNTIME:-}
explicit=0
[ -z "$runtime" ] || explicit=1

while [ $# -gt 0 ]; do
  case $1 in
    -r|--runtime)
      [ $# -ge 2 ] || { echo "describe.sh: $1 needs a runtime name" >&2; exit 1; }
      runtime=$2
      explicit=1
      shift 2
      ;;
    --runtime=*)
      runtime=${1#--runtime=}
      explicit=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) break ;;
  esac
done

# $1 as one shell word, quoted if it needs it.
quote() {
  case $1 in
    '' | *[!A-Za-z0-9_./:@%+=,-]*) printf "'%s'" "$(printf %s "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf %s "$1" ;;
  esac
}

# A module name alone: find the runtimes that have it.
if [ "$explicit" = 0 ] && [ $# -eq 1 ]; then
  case $1 in
    -*) ;;
    *)
      found=0

      for r in $runtimes; do
        if ! command -v "$r" >/dev/null 2>&1; then
          echo "# $r: not installed" >&2
          continue
        fi

        probe_ok=0

        case $r in
          bun) bun run "$script" --probe "$1" >/dev/null 2>&1 && probe_ok=1 ;;
          deno) deno run -A "$script" --probe "$1" >/dev/null 2>&1 && probe_ok=1 ;;
          *) "$r" "$script" --probe "$1" >/dev/null 2>&1 && probe_ok=1 ;;
        esac

        if [ "$probe_ok" = 1 ]; then
          echo "$(quote "$0") -r $r $(quote "$1")"
          found=1
        else
          echo "# $r: cannot load $1" >&2
        fi
      done

      [ "$found" = 1 ] || { echo "describe.sh: no installed runtime can load $1" >&2; exit 1; }
      exit 0
      ;;
  esac
fi

runtime=${runtime:-qjsm}

case $runtime in
  qjsm|qjs|node|bun|deno) ;;
  *)
    echo "describe.sh: unknown runtime '$runtime' (qjsm, qjs, node, bun, deno)" >&2
    exit 1
    ;;
esac

command -v "$runtime" >/dev/null 2>&1 || {
  echo "describe.sh: $runtime not found" >&2
  exit 1
}

case $runtime in
  bun) exec bun run "$script" "$@" ;;
  deno) exec deno run -A "$script" "$@" ;;
  *) exec "$runtime" "$script" "$@" ;;
esac
