import * as std from 'std';
import { tests, assert } from './tinytest.js';

const root = scriptArgs[0].replace(/[^/]*$/, '') + '../';
const header = root + 'tests/cxx/missing-include.h';

function sh(cmd) {
  const p = std.popen(cmd + ' 2>&1', 'r');
  const out = p.readAsString();
  p.close();
  return out;
}

const gen = (...args) => sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', ...args, header].join(' '));

await tests({
  'a missing include is reported with a hint to add -I'() {
    const out = gen();

    assert(/clang reported 1 error\(s\) in .*missing-include\.h.*gb_nowhere\/macros\.h' file not found/.test(out), out);
    assert(out.includes('-I<dir>'), out);
    assert(out.includes('no bindable functions found'), out);
  },

  'with the include directory there is no warning and the function is bound'() {
    const out = gen('-I' + root + 'tests/cxx/inc');

    assert(!out.includes('warning'), out);
    assert(out.includes("export const gb_add = CFunction({ptr:__sym('gb_add')"), out);
  },

  'an include found in a parent directory of the source is added as -I by itself'() {
    const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', root + 'tests/cxx/inc/gb_nowhere/auto.h'].join(' '));

    assert(/note: .*auto\.h needs gb_nowhere\/macros\.h, adding -I.*tests\/cxx\/inc\n/.test(out), out);
    assert(!out.includes('warning'), out);
    assert(out.includes("export const gb_auto = CFunction({ptr:__sym('gb_auto')"), out);
  },

  '--no-auto-include leaves the include alone: a warning and no bindings'() {
    const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--no-auto-include', root + 'tests/cxx/inc/gb_nowhere/auto.h'].join(' '));

    assert(!out.includes('adding -I'), out);
    assert(out.includes('not found: gb_nowhere/macros.h'), out);
    assert(out.includes('no bindable functions found'), out);
  },

  'generated struct and variable code writes with ffi write(), not a DataView'() {
    const out = sh(['qjsm', root + 'tools/gen-bindings.js', '--no-cache', '--structs', root + 'tests/cxx/vars.h'].join(' '));

    assert(out.includes('write as __wr'), out);
    assert(!out.includes('DataView') && !out.includes('__dv'), out);
  },
});
