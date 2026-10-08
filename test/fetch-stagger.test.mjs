// test/fetch-stagger.test.mjs
//
// The stagger exists because of a measurement, not a hunch: from Cloudflare
// egress the origins answer 429, because four feeds requested in the same
// second look like four requests from one impatient client.
//
// The dangerous shape of this feature is the one where it silently stops
// working. A NaN or a coerced zero reads as "the setting is on" in the workflow
// file while the fetcher bursts anyway, and a 429 on every feed is the only
// symptom. So most of what follows is about the parse, not the pause.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  staggerMsFrom,
  collectAllSources,
  setStaggerSleepForTests,
  DEFAULT_STAGGER_MS
} from '../scripts/fetch-feeds.mjs';

// ---------------------------------------------------------------------------
// Parsing. The value an operator sets is the whole configuration surface.
// ---------------------------------------------------------------------------

test('a plain string is read as the number of milliseconds it says', () => {
  assert.equal(staggerMsFrom('1500'), 1500);
  assert.equal(staggerMsFrom('5000'), 5000);
  assert.equal(staggerMsFrom('1'), 1);
});

test('surrounding whitespace does not break the parse', () => {
  // Shell and YAML both hand over trailing newlines and stray spaces
  // surprisingly often. `Number.parseInt` tolerates whitespace anyway, and this
  // pins that it stays tolerated.
  assert.equal(staggerMsFrom(' 250 '), 250);
  assert.equal(staggerMsFrom('\t750'), 750);
});

test('0, empty, and unset all disable the stagger', () => {
  assert.equal(staggerMsFrom('0'), 0, 'an explicit 0 is the documented off switch');
  assert.equal(staggerMsFrom(''), 0, 'empty means unset, not "use the default"');
  assert.equal(staggerMsFrom('   '), 0, 'whitespace-only is still empty');
  assert.equal(staggerMsFrom(undefined), 0);
  assert.equal(staggerMsFrom(null), 0);
});

test('a garbage value falls back to the default and is never NaN or zero', () => {
  // THIS IS THE CASE THAT SILENTLY KILLS THE FEATURE. `Number.parseInt('abc')`
  // is NaN, and `setTimeout(fn, NaN)` does not reject - it fires on the next
  // tick. So an unguarded parse turns "I configured 5 seconds" into "no delay
  // at all", with the configuration still plainly saying it is on.
  for (const garbage of ['abc', '5_000', 'five seconds', '5000ms', '--5000', '1e3', '5.5', '+7']) {
    const value = staggerMsFrom(garbage);
    assert.ok(Number.isFinite(value), `"${garbage}" produced ${value}, which is not a finite number`);
    assert.notEqual(value, 0, `"${garbage}" must not silently disable the stagger`);
    assert.equal(value, DEFAULT_STAGGER_MS, `"${garbage}" must fall back to the default`);
  }

  // And the default itself is a real wait, not a symbol that happens to be
  // non-zero.
  assert.equal(staggerMsFrom('abc'), 5000);
  assert.ok(DEFAULT_STAGGER_MS > 0, 'the default stagger must actually stagger');
});

test('a negative value falls back to the default', () => {
  // A negative delay is not "no delay". Downstream it is a coerced zero, or a
  // range error, depending on which API consumes it - and both look like a
  // configuration that took effect.
  for (const negative of ['-1', '-5000', '-0.5']) {
    const value = staggerMsFrom(negative);
    assert.ok(Number.isFinite(value), `"${negative}" produced ${value}`);
    assert.ok(value >= 0, `"${negative}" must not produce a negative delay`);
    assert.equal(value, DEFAULT_STAGGER_MS, `"${negative}" must fall back to the default`);
  }
});

// ---------------------------------------------------------------------------
// The loop. Counts come from an injected sleep, so the suite does not sit here
// for five seconds per gap.
// ---------------------------------------------------------------------------

const TWO_SOURCES = [{ id: 'a' }, { id: 'b' }];
const FOUR_SOURCES = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

/**
 * A collect that returns a distinguishable result and records the order it was
 * called in. No network, no fixtures.
 */
function fakeCollect(calls) {
  return async (source) => {
    calls.push(source.id);
    return { id: source.id, error: null, itemCount: 1, articles: [] };
  };
}

test('no sleep happens after the last source, and exactly one between two', async () => {
  const calls = [];
  const waits = [];
  const results = await collectAllSources(TWO_SOURCES, {
    collect: fakeCollect(calls),
    staggerMs: DEFAULT_STAGGER_MS,
    sleep: async (ms) => {
      waits.push(ms);
    }
  });

  assert.deepEqual(calls, ['a', 'b'], 'both sources must still be fetched');
  assert.equal(results.length, 2);
  assert.equal(waits.length, 1, 'two sources leave one gap, not two: nothing follows the last one');
  assert.equal(waits[0], DEFAULT_STAGGER_MS, 'the gap must be the configured stagger');
});

test('the gap count is sources minus one, for a realistic four-feed run', async () => {
  const calls = [];
  const waits = [];
  await collectAllSources(FOUR_SOURCES, {
    collect: fakeCollect(calls),
    staggerMs: DEFAULT_STAGGER_MS,
    sleep: async (ms) => {
      waits.push(ms);
    }
  });

  assert.equal(calls.length, 4);
  assert.equal(waits.length, 3, 'four feeds leave three gaps - sleeping after the fourth wastes the runner');
  assert.deepEqual(
    waits,
    [DEFAULT_STAGGER_MS, DEFAULT_STAGGER_MS, DEFAULT_STAGGER_MS],
    'every gap must be the same configured wait'
  );
});

test('a stagger of zero opens no gaps at all', async () => {
  const calls = [];
  const waits = [];
  await collectAllSources(FOUR_SOURCES, {
    collect: fakeCollect(calls),
    staggerMs: 0,
    sleep: async (ms) => {
      waits.push(ms);
    }
  });

  assert.equal(calls.length, 4, 'disabling the stagger must not disable the fetch');
  assert.equal(waits.length, 0, 'an explicit off switch must produce no waits');
});

test('a single source never waits, however long the stagger', async () => {
  const calls = [];
  const waits = [];
  await collectAllSources([{ id: 'only' }], {
    collect: fakeCollect(calls),
    staggerMs: 60_000,
    sleep: async (ms) => {
      waits.push(ms);
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(waits.length, 0, 'one feed is not a burst, so there is nothing to space out');
});

test('an empty source list is a no-op, not a hang', async () => {
  const waits = [];
  const results = await collectAllSources([], {
    collect: fakeCollect([]),
    staggerMs: DEFAULT_STAGGER_MS,
    sleep: async (ms) => {
      waits.push(ms);
    }
  });

  assert.deepEqual(results, []);
  assert.equal(waits.length, 0);
});

test('the module-level sleep is replaceable, which is what makes the counts above possible', async () => {
  // setStaggerSleepForTests is the seam the loop defaults to. If it were broken,
  // every counting test above would fall through to the real timer and this
  // suite would take minutes rather than milliseconds - so prove it works and
  // prove it restores.
  const calls = [];
  const waits = [];
  setStaggerSleepForTests(async (ms) => {
    waits.push(ms);
  });

  try {
    await collectAllSources(TWO_SOURCES, { collect: fakeCollect(calls), staggerMs: DEFAULT_STAGGER_MS });
    assert.equal(calls.length, 2);
    assert.equal(waits.length, 1, 'the injected sleep must be the one the loop calls');
  } finally {
    // Restore in a finally, always. A test that leaves a fake sleep installed
    // turns every later test in the process into a zero-wait fetcher, which is
    // the exact failure this file exists to prevent - caused by the test file.
    setStaggerSleepForTests(null);
  }

  const restored = [];
  setStaggerSleepForTests(async (ms) => restored.push(ms));
  setStaggerSleepForTests(null);
  assert.equal(restored.length, 0, 'the setter itself records nothing; it only replaces the sleep');
});

// ---------------------------------------------------------------------------
// Positive controls. Without these, the counting assertions above could pass
// because the counter never fires rather than because the loop is right.
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: the counting sleep can tell one call from three', async () => {
  // The tests above assert on an array length. If the injected function were
  // never called - or called once for every source including the last - both
  // `equal(waits.length, 1)` and `equal(waits.length, 3)` would still be
  // meaningful only if the counter actually counts. So count, by hand, and
  // check the counter distinguishes the two cases this feature must not confuse.
  const makeCounter = () => {
    const waits = [];
    const sleep = async (ms) => {
      waits.push(ms);
    };
    return { waits, sleep };
  };

  const twoFeedsOneGap = makeCounter();
  for (let i = 0; i < 1; i += 1) await twoFeedsOneGap.sleep(DEFAULT_STAGGER_MS);
  assert.equal(twoFeedsOneGap.waits.length, 1);

  const fourFeedsThreeGaps = makeCounter();
  for (let i = 0; i < 3; i += 1) await fourFeedsThreeGaps.sleep(DEFAULT_STAGGER_MS);
  assert.equal(fourFeedsThreeGaps.waits.length, 3);

  assert.notEqual(
    twoFeedsOneGap.waits.length,
    fourFeedsThreeGaps.waits.length,
    'the counter must distinguish "waited once" from "waited three times"'
  );
});

test('POSITIVE CONTROL: a stagger that always waits would fail the gap assertions', async () => {
  // The mirror image of the control above, run through the real loop. If the
  // loop slept after the last source as well as between sources, four feeds
  // would open four gaps; if it never slept, it would open none. Pin both wrong
  // answers to prove the loop's answer of three is not an artefact of the
  // assertion being weak.
  const sleepsFor = async (staggerMs, count) => {
    const waits = [];
    await collectAllSources(
      Array.from({ length: count }, (_, i) => ({ id: `s${i}` })),
      {
        collect: fakeCollect([]),
        staggerMs,
        sleep: async (ms) => {
          waits.push(ms);
        }
      }
    );
    return waits.length;
  };

  const alwaysOn = await sleepsFor(DEFAULT_STAGGER_MS, 4);
  const alwaysOff = await sleepsFor(0, 4);

  assert.equal(alwaysOn, 3, 'the real loop opens three gaps for four feeds');
  assert.equal(alwaysOff, 0, 'and zero when the stagger is off');
  assert.notEqual(alwaysOn, 4, 'so "sleeps after the last source too" is genuinely excluded');
  assert.notEqual(alwaysOn, alwaysOff, 'so the on/off distinction is genuinely observable');
});

test('POSITIVE CONTROL: the parse cannot be satisfied by returning zero for everything', async () => {
  // A stub that always returned 0 would pass "0 disables" and fail nothing else.
  // Pin the values themselves: distinct inputs must give distinct outputs, and
  // the good ones must not collapse onto the same number.
  assert.equal(staggerMsFrom('100'), 100);
  assert.equal(staggerMsFrom('200'), 200);
  assert.equal(staggerMsFrom('abc'), DEFAULT_STAGGER_MS);
  assert.equal(staggerMsFrom('-1'), DEFAULT_STAGGER_MS);
  assert.equal(staggerMsFrom('0'), 0);

  const values = new Set([
    staggerMsFrom('0'),
    staggerMsFrom('100'),
    staggerMsFrom('200'),
    staggerMsFrom('abc'),
    staggerMsFrom('-1'),
    staggerMsFrom('')
  ]);
  assert.equal(values.size, 4, '0, the two real values, and the default are four distinct answers');
});