// Comparing two attempts at the same climb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/metrics.js';
import { coach } from '../js/coach.js';
import { compareAttempts, attemptOutcome, highPoint } from '../js/compare.js';
import { makeClimb, withEnding } from './synthetic.mjs';

const attempt = (cycles, ending, seed) => {
  const analysis = analyze(withEnding(makeClimb({ cycles, noise: 0.004, seed }), ending));
  return { id: `a${seed}`, name: 'Blue arête', createdAt: seed, analysis, report: coach(analysis) };
};

test('the same attempt twice shows no differences', () => {
  const a = attempt(5, 'footSlip', 1);
  const c = compareAttempts(a, a);
  assert.equal(c.verdict, 'same');
  assert.deepEqual(c.better, []);
  assert.deepEqual(c.worse, []);
  assert.match(c.headline, /same point as last time/);
  assert.ok(c.advice.length >= 1);
});

test('sending after a fall leads the comparison', () => {
  const prev = attempt(3, 'missedCatch', 1), now = attempt(5, 'mantle', 2);
  const c = compareAttempts(now, prev);
  assert.equal(c.outcome.before, 'fell');
  assert.equal(c.outcome.now, 'sent');
  assert.match(c.headline, /sent it this time/);
  assert.equal(c.facts.find((f) => f.label === 'Result').better, true);
  assert.equal(c.facts.find((f) => f.label === 'High point').better, true);
});

test('falling the same way twice is the first thing to fix', () => {
  const prev = attempt(3, 'missedCatch', 1), now = attempt(3, 'missedCatch', 3);
  const c = compareAttempts(now, prev);
  const fall = c.still.find((x) => x.key.startsWith('fall:'));
  assert.ok(fall, 'same fall cause listed under "the same on both attempts"');
  assert.match(c.advice[0], /^Fix first, because it stopped you both times/);
});

test('getting further is counted in moves', () => {
  const prev = attempt(3, 'missedCatch', 1), now = attempt(5, 'footSlip', 4);
  const c = compareAttempts(now, prev);
  assert.match(c.headline, /further than last time/);
  assert.equal(c.facts.find((f) => f.label === 'Came off on').better, true);
});

test('technique changes become better / worse items with a fix', () => {
  const a = attempt(5, 'mantle', 2);
  const prev = structuredClone(a);
  const ff = prev.report.items.find((i) => i.key === 'feetFirstRatio');
  const sa = prev.report.items.find((i) => i.key === 'straightArmRatio');
  const nowFF = a.report.items.find((i) => i.key === 'feetFirstRatio');
  ff.score = Math.max(0, nowFF.score - 30); ff.display = 'low';
  sa.score = 100; sa.display = '100%';
  const c = compareAttempts(a, prev);
  assert.ok(c.better.some((x) => x.key === 'feetFirstRatio'));
  const w = c.worse.find((x) => x.key === 'straightArmRatio');
  assert.ok(w && w.fix);
  assert.ok(c.advice.some((x) => x.startsWith('Straight arms when still slipped')));
});

test('a result set by hand wins over the detected one', () => {
  const a = attempt(5, 'mantle', 2);
  assert.equal(attemptOutcome(a.analysis, null), 'sent');
  assert.equal(attemptOutcome(a.analysis, 'fell'), 'fell');
  assert.equal(attemptOutcome(a.analysis, 'attempt'), 'unknown');
  assert.ok(highPoint(a.analysis) > 0);
});

test('coach() adds the comparison and a line in the take', () => {
  const prev = attempt(3, 'missedCatch', 1);
  const analysis = analyze(withEnding(makeClimb({ cycles: 5, noise: 0.004, seed: 2 }), 'mantle'));
  const r = coach(analysis, { compareWith: prev });
  assert.ok(r.comparison);
  assert.equal(r.comparison.prev.id, prev.id);
  assert.ok(r.take.lines.some((l) => l.startsWith('Compared with your earlier attempt:')));
  assert.doesNotThrow(() => structuredClone(r));
  assert.equal(coach(analysis).comparison, undefined);
});

test('old or partial sessions never break the comparison', () => {
  const now = attempt(5, 'mantle', 2);
  assert.equal(compareAttempts(now, { analysis: null, report: null }), null);
  const bare = { analysis: { metrics: {} }, report: { items: [] } };
  let c;
  assert.doesNotThrow(() => { c = compareAttempts(now, bare); });
  assert.ok(c.headline);
  assert.doesNotThrow(() => compareAttempts(bare, now));
});
