// The "Fix these first" list: falls and habits, each with the moments that show them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/metrics.js';
import { coach } from '../js/coach.js';
import { buildFixes, PLAIN_TITLES } from '../js/mistakes.js';
import { makeClimb, withEnding } from './synthetic.mjs';

const run = (style, ending) => {
  let frames = makeClimb({ noise: 0.004, ...style });
  if (ending) frames = withEnding(frames, ending);
  const analysis = analyze(frames, { terrain: 'vertical' });
  return { analysis, report: coach(analysis) };
};

test('a fall comes first, with one replay around the moment you came off', () => {
  const { analysis, report } = run({ cycles: 5, seed: 1 }, 'footSlip');
  assert.ok(report.fallAnalyses.length, 'the synthetic foot slip should be detected as a fall');
  const fixes = buildFixes(analysis, report);
  assert.equal(fixes[0].kind, 'fall');
  const ex = fixes[0].examples[0];
  assert.ok(ex, 'the fall should have a replay');
  assert.equal(ex.annot, 'fall');
  assert.ok(ex.t0 < ex.tKey && ex.tKey <= ex.t1, 'the fall moment is inside the replay');
  assert.ok(ex.highlight.length, 'the body part that let go is highlighted');
  // The plan's "fix what made you fall" item isn't repeated as a second card.
  assert.ok(!fixes.some((f) => f.kind === 'habit' && /fall/i.test(f.title)));
});

test('habits come with the worst moves as examples, inside each move\'s replay window', () => {
  const { analysis, report } = run({ cycles: 8, seed: 3, feetFirst: false, bentArms: true });
  const fixes = buildFixes(analysis, report);
  const habits = fixes.filter((f) => f.kind === 'habit');
  assert.ok(habits.length >= 2, 'bent arms and feet-last climbing should give at least two habits');
  for (const f of habits) {
    assert.ok(f.title && !/Ratio|PerMin/.test(f.title), 'titles are plain words');
    assert.ok(f.doThis, `${f.title}: says what to do instead`);
    for (const ex of f.examples) {
      assert.ok(ex.t0 < ex.t1 && ex.tKey >= ex.t0 && ex.tKey <= ex.t1, `${f.title}: key moment inside the window`);
      assert.equal(ex.phases.length, 3);
      assert.ok(ex.phases.every((p, i) => i === 0 || p.t >= ex.phases[i - 1].t), 'phases in time order');
      assert.ok(ex.callout.length > 10);
    }
    assert.ok(f.examples.length <= 4);
  }
  const arms = fixes.find((f) => f.key === 'straightArmRatio');
  if (arms && arms.examples.length > 1) {
    // Worst (most bent) first.
    const angle = (ex) => analysis.moves.find((m) => m.n === ex.move).holdElbow;
    assert.ok(angle(arms.examples[0]) <= angle(arms.examples[1]));
    assert.equal(arms.examples[0].guide, 'straightArm');
  }
});

test('the quick-look coach gets one habit; a clean climb gets no habit cards', () => {
  const bad = run({ cycles: 8, seed: 3, feetFirst: false, bentArms: true });
  assert.ok(buildFixes(bad.analysis, bad.report, { habits: 1 }).filter((f) => f.kind === 'habit').length <= 1);
  const good = run({ cycles: 6, seed: 2 });
  for (const f of buildFixes(good.analysis, good.report)) assert.notEqual(f.key, 'feetFirstRatio');
});

test('works on old saved reports with missing fields', () => {
  assert.deepEqual(buildFixes(null, null), []);
  assert.deepEqual(buildFixes({}, {}), []);
  const fixes = buildFixes({ moves: [] }, { actionPlan: [{ key: 'straightArmRatio', title: 'Straight arms when still', doThis: 'Hang long.' }] });
  assert.equal(fixes[0].title, PLAIN_TITLES.straightArmRatio);
  assert.deepEqual(fixes[0].examples, []);
});
