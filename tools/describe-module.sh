#!/bin/sh
# Lists what a JS binding module exports (one from tools/gen-bindings.js or
# lib/), through describeClass()/describeObject() as copied to describe/.
#
# Usage: describe-module.sh [--json] <module.js> [export...]
#
# Importing the module loads the libraries it binds, so QUICKJS_MODULE_PATH has
# to find the 'ffi' module (a build directory, say) as well as the usual
# directories; it is passed on as it is.

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1

command -v qjsm >/dev/null 2>&1 || {
  echo "describe-module.sh: qjsm not found" >&2
  exit 1
}

exec qjsm "$dir/describe-module.js" "$@"
