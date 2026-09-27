// Coaching across several climbs: recurring issues get new cues/drills and a trend line,
// lasting strengths collapse into one line, fixes are called out, and nothing changes
// for a first climb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../js/metrics.js';
import { coach, METRIC_DEFS, COACHES, coachForQuality } from '../js/coach.js';
import { makeClimb, withEnding } from './synthetic.mjs';

const climb = (seed, ending = 'footSlip') => analyze(withEnding(makeClimb({ cycles: 5, noise: 0.004, seed }), ending), { terrain: 'vertical' });

// Coach a run of climbs, each with the ones before it as history.
function series(n, ending) {
  const history = [], reports = [];
  for (let i = 0; i < n; i++) {
    const report = coach(climb(i + 1, ending), { history });
    reports.push(report);
    history.push({ createdAt: i, report: structuredClone(report) });
  }
  return reports;
}

// Sentences shared between two reports' plan, strengths and fall cards.
function sentences(r) {
  const parts = [
    ...r.actionPlan.flatMap((p) => [p.why, p.doThis, p.drill]),
    ...r.strengths.map((s) => s.text),
    ...r.fallAnalyses.flatMap((f) => [f.primary?.why, f.primary?.drill, ...f.primary.fixes.slice(0, 1), ...f.nextAttempt]),
    ...r.extraInsights.map((x) => x.advice),
  ];
  return new Set(parts.filter(Boolean));
}
const overlap = (a, b) => { const A = sentences(a), B = sentences(b); return [...A].filter((x) => B.has(x)).length / Math.max(1, A.size); };

test('a first climb is coached exactly as before', () => {
  const r = climb(1);
  const a = coach(r), b = coach(r, { history: [] });
  assert.deepEqual(a, b);
  for (const it of a.items) {
    const def = METRIC_DEFS.find((d) => d.key === it.key);
    assert.equal(it.cue, def.cue);
    assert.equal(it.drill, def.drill);
  }
  assert.deepEqual(a.sinceLast, []);
});

test('a recurring problem gets a new cue and drill and a trend line', () => {
  const [first, second] = series(2);
  const again = second.improvements.filter((i) => first.improvements.some((x) => x.key === i.key));
  assert.ok(again.length, 'the synthetic climbs should share at least one problem');
  for (const i of again) {
    const before = first.improvements.find((x) => x.key === i.key);
    assert.notEqual(i.cue, before.cue, `${i.key}: same cue twice`);
    assert.notEqual(i.drill, before.drill, `${i.key}: same drill twice`);
    assert.match(i.history, /last climb too/);
  }
});

test('repeated climbs repeat far less of the same text', () => {
  const reports = series(4);
  const withHistory = overlap(reports[3], reports[2]);
  const without = overlap(coach(climb(4)), coach(climb(3)));
  assert.ok(withHistory < without * 0.6, `overlap ${withHistory.toFixed(2)} vs ${without.toFixed(2)} without history`);
});

test('explanations already given twice are left out of the plan', () => {
  const reports = series(3);
  const repeatKeys = reports[2].actionPlan.filter((p) => p.key && !p.key.startsWith('fall:') && reports[0].actionPlan.some((x) => x.key === p.key) && reports[1].actionPlan.some((x) => x.key === p.key));
  assert.ok(repeatKeys.length);
  for (const p of repeatKeys) { assert.equal(p.why, null); assert.ok(p.history); }
});

test('strengths kept for several climbs become one short line', () => {
  const reports = series(3);
  assert.ok(reports[0].strengths.length >= 2);
  const habits = reports[2].strengths.filter((s) => s.tag === 'steady');
  assert.equal(habits.length, 1);
  assert.ok(habits[0].keys.length >= 2);
  assert.match(habits[0].text, /last 3 climbs/);
  // Still counted as a strength on the next climb.
  const fourth = coach(climb(4), { history: reports.map((r, i) => ({ createdAt: i, report: r })) });
  assert.match(fourth.strengths.find((s) => s.tag === 'steady').text, /last 4 climbs/);
});

test('a problem that was fixed since the last climb is called out', () => {
  const r = climb(1);
  const now = coach(r);
  const strong = now.strengths[0];
  // Pretend the last climb flagged it with a low score.
  const last = structuredClone(now);
  last.items.find((i) => i.key === strong.key).score = 25;
  last.improvements.push({ key: strong.key, label: strong.label, score: 25 });
  const c = coach(r, { history: [{ createdAt: 0, report: last }] });
  const fixed = c.strengths.find((s) => s.key === strong.key);
  assert.equal(fixed.tag, 'fixed');
  assert.match(fixed.text, /Fixed since your last climb \(score 25 →/);
  assert.ok(c.sinceLast.some((x) => x.kind === 'fixed' && x.key === strong.key));
  assert.match(c.summary, /no longer a problem/);
});

test('falling the same way again is flagged as a pattern with different advice', () => {
  const [first, second, third] = series(3);
  const f1 = first.fallAnalyses[0], f2 = second.fallAnalyses[0], f3 = third.fallAnalyses[0];
  assert.equal(f1.primary.key, f2.primary.key);
  assert.equal(f1.pattern, null);
  assert.match(f2.pattern, /second climb/);
  assert.match(f3.pattern, /third climb/);
  assert.notEqual(f2.primary.drill, f1.primary.drill);
  assert.notEqual(f3.primary.drill, f2.primary.drill);
  assert.notEqual(f2.primary.fixes[0], f1.primary.fixes[0]);
  assert.notEqual(f2.nextAttempt.at(-1), f1.nextAttempt.at(-1));
});

test('coaching with history is deterministic and storable', () => {
  const reports = series(3);
  const history = reports.slice(0, 2).map((r, i) => ({ createdAt: i, report: r }));
  const a = coach(climb(3), { history }), b = coach(climb(3), { history });
  assert.deepEqual(a, b);
  assert.doesNotThrow(() => structuredClone(a));
});

test('old or broken history entries are ignored', () => {
  const r = climb(2);
  const junk = [null, {}, { report: null }, { createdAt: 1, report: { overall: 50 } }, { createdAt: 2, report: { items: [], improvements: [{ key: 'legDrive' }] } }];
  assert.doesNotThrow(() => coach(r, { history: junk }));
});

test('each coach gives its own short summary', () => {
  const r = climb(2, 'barnDoor');
  const pip = coach(r, { coach: 'pip' }), rowan = coach(r, { coach: 'rowan' }), sage = coach(r, { coach: 'sage' });
  assert.equal(pip.coach, 'pip'); assert.equal(sage.take.name, 'Sage');
  for (const c of [pip, rowan, sage]) {
    assert.ok(c.take.lines.length >= 2);
    assert.match(c.take.lines[0], /came off at/);
  }
  assert.ok(pip.take.lines.length < sage.take.lines.length, 'the quick coach is shorter');
  assert.ok(!pip.take.lines.some((l) => /\/100/.test(l)), 'no scores in the quick summary');
  assert.ok(sage.take.lines.some((l) => /Technique score \d+\/100/.test(l)));
  // Unknown coach ids fall back to the all-round coach.
  assert.equal(coach(r, { coach: 'nobody' }).coach, 'rowan');
});

test('coaches map to analysis quality levels', () => {
  assert.equal(coachForQuality('fast').id, 'pip');
  assert.equal(coachForQuality('accurate').id, 'rowan');
  assert.equal(coachForQuality('max').id, 'sage');
  assert.equal(coachForQuality(undefined).id, 'rowan');
  assert.deepEqual(Object.values(COACHES).map((c) => c.level), ['simple', 'standard', 'expert']);
});

test('indoor and outdoor climbs get matching fall advice', () => {
  const frames = withEnding(makeClimb({ cycles: 5, noise: 0.004, seed: 1 }), 'footSlip');
  const out = coach(analyze(frames, { venue: 'outdoor' }));
  const ind = coach(analyze(frames, { venue: 'indoor' }));
  assert.equal(ind.venue, 'indoor');
  const fixes = (c) => c.fallAnalyses[0].primary.fixes.join(' ');
  assert.match(fixes(out), /brush the foothold/);
  assert.match(fixes(ind), /Gym footholds/);
  assert.doesNotMatch(fixes(ind), /brush the foothold/);
  for (const c of [out, ind]) for (const f of c.fallAnalyses[0].primary.fixes) assert.equal(typeof f, 'string');
});
