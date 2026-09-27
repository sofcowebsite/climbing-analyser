// Stress tests: odd or broken input must never crash the analysis or the coaching,
// and the result must be storable (IndexedDB uses structured clone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/metrics.js';
import { coach } from '../js/coach.js';
import { makeClimb, withEnding } from './synthetic.mjs';
import { labelsExport } from '../js/timeline.js';

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
const pose = (fn) => Array.from({ length: 33 }, (_, i) => fn(i));

function check(name, frames, opts) {
  let r;
  assert.doesNotThrow(() => { r = analyze(frames, opts); }, `${name}: analyze threw`);
  assert.equal(typeof r.ok, 'boolean', `${name}: no ok flag`);
  if (!r.ok) { assert.ok(r.reason, `${name}: failure without a reason`); return r; }
  let c;
  assert.doesNotThrow(() => { c = coach(r); }, `${name}: coach threw`);
  assert.doesNotThrow(() => structuredClone({ analysis: r, report: c }), `${name}: result not storable`);
  assert.doesNotThrow(() => JSON.stringify(labelsExport({ analysis: r, report: c, createdAt: Date.now(), name: 'x' })), `${name}: export failed`);
  // Numbers shown to the user must be finite or null, never NaN/Infinity.
  for (const [k, v] of Object.entries(r.metrics)) {
    if (typeof v === 'number') assert.ok(Number.isFinite(v), `${name}: metric ${k} = ${v}`);
  }
  assert.ok(c.overall === null || (c.overall >= 0 && c.overall <= 100), `${name}: overall ${c.overall}`);
  for (const s of r.labels.segments) assert.ok(s.t1 > s.t0, `${name}: empty segment`);
  return r;
}

test('empty and tiny inputs', () => {
  check('empty', []);
  check('five frames', makeClimb({ cycles: 1 }).slice(0, 5));
  check('one frame', makeClimb({ cycles: 1 }).slice(0, 1));
});

test('no climber found at all', () => {
  const r = check('all null', Array.from({ length: 120 }, (_, i) => ({ t: i / 10, p: null })));
  assert.equal(r.ok, false);
});

test('climber found in a single frame only', () => {
  const one = makeClimb({ cycles: 2 })[10];
  const frames = Array.from({ length: 80 }, (_, i) => ({ t: i / 10, p: i === 40 ? one.p : null }));
  check('single valid frame', frames);
});

test('climber never moves', () => {
  const p = makeClimb({ cycles: 1 })[5].p;
  check('frozen', Array.from({ length: 200 }, (_, i) => ({ t: i / 10, p })));
});

test('pure noise poses', () => {
  const r = rng(3);
  check('noise', Array.from({ length: 150 }, (_, i) => ({ t: i / 10, p: pose(() => [r() * 0.56, r(), r()]) })));
});

test('NaN and missing landmarks inside poses', () => {
  const frames = makeClimb({ cycles: 5 }).map((f, i) => {
    const p = f.p.map((q) => q.slice());
    if (i % 7 === 0) p[27] = [NaN, NaN, 0.9];
    if (i % 11 === 0) p[15] = [NaN, 0.5, NaN];
    if (i % 13 === 0) for (const k of [25, 26, 27, 28]) p[k] = [0, 0, 0];
    return { ...f, p };
  });
  check('nan landmarks', frames);
});

test('patchy tracking', () => {
  const r = rng(9);
  check('patchy', makeClimb({ cycles: 6 }).map((f) => (r() < 0.4 ? { ...f, p: null } : f)));
});

test('very low and very high frame rates', () => {
  check('2 fps', makeClimb({ cycles: 6, fps: 2 }));
  check('30 fps', makeClimb({ cycles: 4, fps: 30 }));
});

test('uneven timestamps', () => {
  const r = rng(5);
  let t = 0;
  check('uneven', makeClimb({ cycles: 5 }).map((f) => { t += 0.05 + r() * 0.1; return { ...f, t }; }));
});

test('camera shake and missing camera data', () => {
  const r = rng(7);
  check('shake', makeClimb({ cycles: 5 }).map((f) => ({ ...f, cam: [(r() - 0.5) * 0.05, (r() - 0.5) * 0.05] })));
  check('cam nulls', makeClimb({ cycles: 5 }).map((f, i) => ({ ...f, cam: i % 3 ? [0, 0] : null })));
});

test('every scripted ending, at several climb lengths and terrains', () => {
  const kinds = ['missedCatch', 'footSlip', 'pumpFall', 'barnDoor', 'matchJump', 'mantle', 'lower', 'outTop', 'probe', 'match', 'crossThrough', 'flag', 'dropKnee'];
  const terrains = ['slab', 'overhang', 'crack', 'unknown', undefined];
  let k = 0;
  for (const kind of kinds) {
    for (const cycles of [2, 5]) {
      check(`${kind}/${cycles}`, withEnding(makeClimb({ cycles, noise: 0.004, seed: k + 1 }), kind), { terrain: terrains[k++ % terrains.length], frameHeightPx: 1080 });
    }
  }
});

test('tiny climber far away', () => {
  // Scale the whole body down to ~1/5 size around a point, like a climber filmed from far off.
  const frames = makeClimb({ cycles: 5, noise: 0.001 }).map((f) => ({ ...f, p: f.p.map(([x, y, v]) => [0.28 + (x - 0.28) * 0.2, 0.5 + (y - 0.5) * 0.2, v]) }));
  const r = check('tiny', frames, { frameHeightPx: 720 });
  if (r.ok) assert.ok(r.warnings.length >= 1, 'should warn about the small size');
});
