// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, angle, fillGaps, smooth, fixLeftRight } from '../js/metrics.js';
import { coach, METRIC_DEFS } from '../js/coach.js';
import { hardestSends } from '../js/grades.js';
import { makeClimb } from './synthetic.mjs';
import { refinePoses } from '../js/refine.js';

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

test('left/right mix-ups from the pose model are undone', () => {
  const clean = makeClimb({ cycles: 8 });
  // Swap every left/right pair in a scattered set of frames, as a confused model would.
  const swapped = clean.map((f, i) => {
    if (i % 3 !== 1 && i % 7 !== 2) return f;
    const p = f.p.map((q) => q.slice());
    for (let l = 11; l <= 31; l += 2) [p[l], p[l + 1]] = [p[l + 1], p[l]];
    return { ...f, p };
  });
  const fixed = fixLeftRight(swapped);
  const same = fixed.every((f, i) => f.p[15][0] === clean[i].p[15][0] && f.p[27][0] === clean[i].p[27][0]);
  assert.ok(same);
  const r = analyze(swapped);
  assert.equal(r.metrics.handMoves, 8);
});

test('camera pans are removed from the measurements', () => {
  // Same climb, but the camera follows the climber upwards: in the image they stay put.
  const frames = makeClimb({ cycles: 8 });
  const panned = frames.map((f, i) => {
    const hip = (frames[i].p[23][1] + frames[i].p[24][1]) / 2 - (frames[0].p[23][1] + frames[0].p[24][1]) / 2;
    return { ...f, p: f.p.map(([x, y, v]) => [x, y - hip, v]), cam: [0, -hip] };
  });
  const a = analyze(frames), b = analyze(panned);
  assert.equal(b.metrics.handMoves, a.metrics.handMoves);
  assert.ok(Math.abs(b.metrics.heightGain - a.metrics.heightGain) < 0.2);
  assert.equal(b.metrics.cameraMoved, true);
});

test('legs hidden behind the body are still tracked (not dropped)', () => {
  const frames = makeClimb({ cycles: 8, occludeLegs: true, noise: 0.003 });
  const truth = frames.truth;
  const r = refinePoses(frames);
  // Every frame keeps an ankle position, and it stays close to the truth.
  let have = 0, err = 0, n = 0, rawErr = 0;
  frames.forEach((f, i) => {
    const y = r.world[27].y[i];
    if (Number.isFinite(y)) have++;
    if (f.p[27][2] < 0.2 && Number.isFinite(y)) {
      err += Math.abs(y - truth[i].lFoot[1]);
      rawErr += Math.abs(f.p[27][1] - truth[i].lFoot[1]);
      n++;
    }
  });
  assert.ok(have / frames.length > 0.98, `coverage ${have / frames.length}`);
  assert.ok(err / n < (rawErr / n) * 0.6, `refined error ${(err / n).toFixed(4)} vs raw ${(rawErr / n).toFixed(4)}`);
  // Move counting still works with the legs hidden much of the time.
  const a = analyze(frames);
  assert.equal(a.metrics.handMoves, 8);
  assert.ok(a.metrics.footMoves >= 11 && a.metrics.footMoves <= 17, `footMoves=${a.metrics.footMoves}`);
});

test('detailed coaching: action plan, move-by-move, sections, sides', async () => {
  const r = analyze(makeClimb({ cycles: 10, feetFirst: false, bentArms: true }));
  const c = coach(r);
  assert.ok(c.actionPlan.length >= 1 && c.actionPlan.length <= 3);
  for (const p of c.actionPlan) {
    assert.ok(p.title && p.saw && p.why && p.doThis, `incomplete plan item ${p.title}`);
  }
  assert.equal(c.actionPlan[0].title, 'Feet first');
  assert.equal(c.moveReview.length, r.metrics.handMoves);
  assert.ok(c.moveReview.every((m) => ['clean', 'ok', 'rough'].includes(m.rating)));
  // Reaching without the feet happened on most moves, so it's reported once as a pattern
  // rather than repeated on every move.
  const feetPattern = c.movePatterns.find((p) => p.kind === 'bad' && p.k === 'feet');
  const feetOnMoves = c.moveReview.some((m) => m.bad.some((x) => x.k === 'feet'));
  assert.ok(feetPattern || feetOnMoves);
  if (feetPattern) assert.ok(!feetOnMoves, 'pattern should not be repeated per move');
  assert.equal(r.sections.length, 3);
  assert.ok(c.sectionInsights.length >= 1);
  assert.ok(c.sideInsights.length >= 1);
  assert.ok(typeof c.moveSummary === 'string' && c.moveSummary.length > 20);
  // A good climber gets strengths and "feet first" isn't the top priority.
  const g = coach(analyze(makeClimb({ cycles: 10 })));
  assert.ok(g.strengths.some((s) => s.key === 'feetFirstRatio'));
  assert.ok(!g.actionPlan.some((p) => p.title === 'Feet first'));
});

test('saved sessions can be re-analysed from their stored poses', async () => {
  const { packTrack } = await import('../js/player.js');
  const { framesFromTrack } = await import('../js/refine.js');
  const frames = makeClimb({ cycles: 8 });
  const again = analyze(framesFromTrack(packTrack(frames, 0.5625)));
  const direct = analyze(frames);
  assert.equal(again.metrics.handMoves, direct.metrics.handMoves);
  assert.ok(Math.abs(again.metrics.footMoves - direct.metrics.footMoves) <= 1);
});

// ---------- did they finish? why did they fall? ----------
import { withEnding } from './synthetic.mjs';

const ending = (kind, style = { cycles: 6 }) => analyze(withEnding(makeClimb(style), kind));

test('a hold touched and dropped within a second is a fall, not a finish', () => {
  const r = ending('missedCatch');
  assert.equal(r.outcome.result, 'fell');
  assert.equal(r.outcome.confidence, 'high');
  assert.equal(r.falls.length, 1);
  assert.equal(r.falls[0].causes[0].key, 'missedCatch');
  assert.ok(r.falls[0].stick < 1);
  const c = coach(r);
  assert.ok(c.actionPlan[0].title.startsWith('Fix what made you fall'));
  assert.ok(c.fallAnalyses[0].nextAttempt.length >= 2);
});

test('a foot slipping first is identified as the cause', () => {
  const r = ending('footSlip');
  assert.equal(r.outcome.result, 'fell');
  assert.equal(r.falls[0].causes[0].key, 'footSlip');
  assert.equal(r.falls[0].causes[0].side, 'left');
});

test('hands peeling off after hanging on bent arms points to the grip / pump', () => {
  const r = ending('pumpFall', { cycles: 10, bentArms: true });
  assert.equal(r.outcome.result, 'fell');
  const keys = r.falls[0].causes.map((c) => c.key);
  assert.equal(keys[0], 'handSlip');
  assert.ok(keys.includes('pump') || keys.includes('stalled'));
});

test('swinging off sideways is a barn door', () => {
  const r = ending('barnDoor');
  assert.equal(r.outcome.result, 'fell');
  assert.ok(r.falls[0].causes.some((c) => c.key === 'barnDoor'));
});

test('matching the top hold and holding it, then jumping off, is a finish', () => {
  const r = ending('matchJump');
  assert.equal(r.outcome.result, 'finished');
  assert.equal(r.falls.length, 0);
});

test('a mantle and standing up is a top-out', () => {
  const r = ending('mantle');
  assert.equal(r.outcome.result, 'topped');
  assert.equal(r.outcome.confidence, 'high');
});

test('climbing out of the top of the frame is a probable top-out', () => {
  const r = ending('outTop');
  assert.equal(r.outcome.result, 'topped');
  assert.equal(r.outcome.confidence, 'medium');
});

test('lowering off is not mistaken for a fall', () => {
  const r = ending('lower');
  assert.notEqual(r.outcome.result, 'fell');
  assert.equal(r.falls.length, 0);
});

test('an ordinary climb with no ending does not invent a fall', () => {
  const r = analyze(makeClimb({ cycles: 8 }));
  assert.equal(r.falls.length, 0);
  assert.notEqual(r.outcome.result, 'fell');
});
