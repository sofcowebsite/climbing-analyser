// "Did your fixes work?": checking the earlier attempt's fixes on a new attempt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/metrics.js';
import { coach } from '../js/coach.js';
import { fixProgress } from '../js/followup.js';
import { habitOnMoves, buildFixes } from '../js/mistakes.js';
import { makeClimb, withEnding } from './synthetic.mjs';

const attempt = (style, ending, opts = {}) => {
  let frames = makeClimb({ noise: 0.004, cycles: 6, ...style });
  if (ending) frames = withEnding(frames, ending);
  const analysis = analyze(frames, { terrain: 'vertical' });
  return { analysis, report: coach(analysis), outcome: opts.outcome || null, coach: opts.coach || 'rowan' };
};

const messy = attempt({ seed: 3, feetFirst: false, bentArms: true }, 'footSlip');
const clean = attempt({ seed: 3 }, 'mantle');

test('fixing the habits shows them as fixed or better, with done-right moves first', () => {
  const p = fixProgress(clean, messy);
  assert.ok(p.items.length >= 2);
  const habits = p.items.filter((x) => x.kind === 'habit');
  assert.ok(habits.length >= 2, 'the messy attempt had at least two habits to fix');
  for (const it of habits) {
    assert.ok(['fixed', 'better'].includes(it.status), `${it.title}: expected fixed/better, got ${it.status}`);
    assert.ok(it.before.length, `${it.title}: has a replay of the earlier attempt`);
    if (it.after.length) assert.equal(it.after[0].good, true, `${it.title}: shows a move done right first`);
    assert.ok(it.text.length > 10);
  }
  const feet = habits.find((x) => x.key === 'feetFirstRatio');
  if (feet) assert.ok(feet.numbers && feet.numbers.before !== feet.numbers.now);
  assert.match(p.headline, /better|Brilliant|Well done/);
});

test('sending it after a fall marks the fall as fixed', () => {
  const p = fixProgress({ ...clean, outcome: 'sent' }, messy);
  const fall = p.items.find((x) => x.kind === 'fall');
  assert.ok(fall, 'the earlier fall is checked');
  assert.equal(fall.status, 'fixed');
  assert.match(fall.text, /sent it/);
});

test('the same habits again show as no change, with the misses first', () => {
  const again = attempt({ seed: 5, feetFirst: false, bentArms: true }, 'footSlip');
  const p = fixProgress(again, messy);
  for (const it of p.items.filter((x) => x.kind === 'habit')) {
    assert.ok(['same', 'worse', 'better'].includes(it.status), `${it.title}: ${it.status}`);
    if (it.status === 'same' && it.after.length) assert.notEqual(it.after[0].good, true);
  }
  const fall = p.items.find((x) => x.kind === 'fall');
  if (fall) assert.notEqual(fall.status, 'fixed');
});

test('habitOnMoves counts moves with the habit and moves done right', () => {
  const fixes = buildFixes(messy.analysis, messy.report);
  const arms = fixes.find((f) => f.key === 'straightArmRatio');
  assert.ok(arms);
  const m = habitOnMoves(messy.analysis, arms);
  assert.ok(m.total > 0 && m.bad > 0 && m.bad <= m.total);
  const c = habitOnMoves(clean.analysis, arms);
  assert.ok(c.good > 0 && c.goodExamples[0].good && c.goodExamples[0].highlight.length === 0);
});

test('copes with missing or old data', () => {
  assert.equal(fixProgress(null, messy), null);
  assert.equal(fixProgress(clean, { analysis: {} }), null);
  const p = fixProgress(clean, { analysis: { moves: [] }, report: { actionPlan: [] } });
  assert.deepEqual(p.items, []);
});
