// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, angle, fillGaps, smooth } from '../js/metrics.js';
import { coach, METRIC_DEFS } from '../js/coach.js';
import { hardestSends } from '../js/grades.js';
import { makeClimb } from './synthetic.mjs';

test('helpers', () => {
  assert.equal(Math.round(angle([0, 1], [0, 0], [1, 0])), 90);
  assert.equal(Math.round(angle([-1, 0], [0, 0], [1, 0])), 180);
  assert.deepEqual(fillGaps([1, NaN, 3], 2), [1, 2, 3]);
  assert.ok(Number.isNaN(fillGaps([1, NaN, NaN, NaN, 5], 2)[2]));
  assert.deepEqual(smooth([1, 2, 3], 3), [1.5, 2, 2.5]);
});

test('rejects videos with no climber', () => {
  const frames = Array.from({ length: 50 }, (_, i) => ({ t: i / 10, p: null }));
  const r = analyze(frames);
  assert.equal(r.ok, false);
  assert.match(r.reason, /climber/);
});

test('counts hand and foot moves on a clean climb', () => {
  const r = analyze(makeClimb({ cycles: 8 }));
  assert.ok(r.ok);
  assert.equal(r.metrics.handMoves, 8);
  assert.ok(r.metrics.footMoves >= 12 && r.metrics.footMoves <= 16, `footMoves=${r.metrics.footMoves}`);
  assert.ok(r.metrics.heightGain > 3);
  assert.equal(r.metrics.falls, 0);
});

test('footwork score separates foot-led from hand-led climbing', () => {
  const good = coach(analyze(makeClimb({ feetFirst: true })));
  const bad = coach(analyze(makeClimb({ feetFirst: false })));
  assert.ok(good.categories.footwork.score > bad.categories.footwork.score + 25);
  assert.ok(bad.improvements.some((i) => i.key === 'footHandRatio'));
  assert.ok(good.strengths.some((i) => i.key === 'footHandRatio'));
});

test('straight-arm score separates straight from bent arms', () => {
  const straight = analyze(makeClimb({}));
  const bent = analyze(makeClimb({ bentArms: true }));
  assert.ok(straight.metrics.straightArmRatio > bent.metrics.straightArmRatio + 0.2);
});

test('survives tracking dropouts and noise', () => {
  const frames = makeClimb({ noise: 0.006 });
  for (let i = 40; i < 46; i++) frames[i].p = null; // short occlusion
  const r = analyze(frames);
  assert.ok(r.ok);
  assert.equal(r.metrics.handMoves, 8);
  const c = coach(r);
  assert.ok(c.overall >= 0 && c.overall <= 100);
});

test('detects a fall and ends the analysis window at the high point', () => {
  const frames = makeClimb({ cycles: 6 });
  const tEnd = frames[frames.length - 1].t;
  // Append a fast 2.5-torso-length drop.
  const T = 0.12;
  for (let k = 1; k <= 12; k++) {
    const last = frames[frames.length - 1];
    const dy = k <= 5 ? 0.6 * T : 0;
    frames.push({ t: tEnd + k / 10, p: last.p.map(([x, y, v]) => [x, y + dy, v]) });
  }
  const r = analyze(frames);
  assert.equal(r.metrics.falls, 1);
  assert.ok(r.window.t1 < tEnd + 0.6);
  assert.ok(r.events.some((e) => e.kind === 'fall'));
});

test('every metric definition produces text', () => {
  const r = analyze(makeClimb({}));
  for (const def of METRIC_DEFS) {
    assert.equal(typeof def.good(0.5, r.metrics), 'string');
    assert.equal(typeof def.bad(0.5, r.metrics), 'string');
  }
});

test('hardest send per grade scale', () => {
  const h = hardestSends([
    { outcome: 'sent', gradeScale: 'v', grade: 'V3' },
    { outcome: 'sent', gradeScale: 'v', grade: 'V5' },
    { outcome: 'fell', gradeScale: 'v', grade: 'V7' },
    { outcome: 'sent', gradeScale: 'french', grade: '6b+' },
  ]);
  assert.equal(h.v.grade, 'V5');
  assert.equal(h.french.grade, '6b+');
});
