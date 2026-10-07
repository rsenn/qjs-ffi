/**
 * Very simple in-browser unit-test library, with zero deps.
 *
 * Background turns green if all tests pass, otherwise red.
 * View the JavaScript console to see failure reasons.
 *
 * Example:
 *
 *   adder.js (code under test)
 *
 *     function add(a, b) {
 *       return a + b;
 *     }
 *
 *   adder-test.html (tests - just open a browser to see results)
 *
 *     <script src="tinytest.js"></script>
 *     <script src="adder.js"></script>
 *     <script>
 *
 *     tests({
 *
 *       'adds numbers'() {
 *         eq(6, add(2, 4));
 *         eq(6.6, add(2.6, 4));
 *       },
 *
 *       'subtracts numbers'() {
 *         eq(-2, add(2, -4));
 *       },
 *
 *     });
 *     </script>
 *
 * That's it. Stop using over complicated frameworks that get in your way.
 *
 * -Joe Walnes
 * MIT License. See https://github.com/joewalnes/jstinytest/
 */
/* loose == on primitives, element by element on arrays and objects */
function looseEqual(a, b) {
  if(typeof a != 'object' || typeof b != 'object' || a === null || b === null) return a == b;

  const ka = Object.keys(a);

  return ka.length == Object.keys(b).length && ka.every(k => k in b && looseEqual(a[k], b[k]));
}

/* a value as text for a failure message: arrays and objects as JSON */
function show(v) {
  return typeof v == 'object' && v !== null ? JSON.stringify(v, (k, x) => (typeof x == 'bigint' ? x + 'n' : x)) : '"' + v + '"';
}

const TinyTest = {
  async run(tests) {
    let count = 0,
      failures = 0;

    for(let testName in tests) {
      let testAction = tests[testName];
      //console.log('Test:', testName, testAction);
      try {
        await testAction();
        console.log('Test:', testName, 'OK');
      } catch(e) {
        failures++;
        console.error('Test:', testName, 'FAILED', e);
        console.error(e.stack);
      }
      count++;
    }

    if(failures) console.log(`${failures} out of ${count} tests failed.`);
    else console.log(`${count} tests succeeded.`);
  },

  fail(msg) {
    throw new Error('fail(): ' + msg);
  },

  assert(value, msg) {
    if(!value) {
      throw new Error('assert(): ' + msg);
    }
  },

  assertEquals(expected, actual) {
    if(!looseEqual(expected, actual)) {
      throw new Error('assertEquals() ' + show(expected) + ' != ' + show(actual));
    }
  },

  assertStrictEquals(expected, actual) {
    if(expected !== actual) {
      throw new Error('assertStrictEquals() "' + expected + '" !== "' + actual + '"');
    }
  },
};

export const fail = TinyTest.fail,
  assert = TinyTest.assert,
  assertEquals = TinyTest.assertEquals,
  eq = TinyTest.assertEquals, // alias for assertEquals
  assertStrictEquals = TinyTest.assertStrictEquals,
  tests = TinyTest.run;
