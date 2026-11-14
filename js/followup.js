// "Did your fixes work?": takes the things the earlier attempt's report told you to fix and
// checks each one on the new attempt: fixed, better, no change yet or worse, with the
// numbers, the moves where it happened (or where you got it right) and what to do next.
// Pure module: no DOM, testable in Node. Works on stored sessions of any age.

import { buildFixes, habitOnMoves, fallFix } from './mistakes.js';
import { attemptOutcome, highPoint } from './compare.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const metresTxt = (t) => `${(Math.round(Math.abs(t) * 0.51 * 2) / 2).toFixed(1)} m`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower1 = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

// A score change smaller than this is noise between two videos (same as compare.js).
const STEP = 12;

export const STATUS = {
  fixed: { label: 'Fixed', icon: '✓', rank: 0 },
  better: { label: 'Better', icon: '▲', rank: 1 },
  same: { label: 'No change yet', icon: '=', rank: 2 },
  worse: { label: 'Worse', icon: '▼', rank: 3 },
  unknown: { label: 'Couldn\'t tell', icon: '?', rank: 4 },
};

const lastFallOf = (report) => (report?.fallAnalyses?.length ? report.fallAnalyses[report.fallAnalyses.length - 1] : null);

function habitProgress(f, now, prev) {
  const item = (r) => (f.key ? (r.report.items || []).find((i) => i.key === f.key) : null);
  const pI = item(prev), nI = item(now);
  const pM = habitOnMoves(prev.analysis, f), nM = habitOnMoves(now.analysis, f);
  let status = 'unknown', numbers = null;
  if (pI && nI && isNum(pI.score) && isNum(nI.score)) {
    const d = nI.score - pI.score;
    status = nI.score >= 60 && pI.score < 60 ? 'fixed' : d >= STEP ? 'better' : d <= -STEP ? 'worse' : 'same';
    numbers = { label: pI.label, before: pI.display, now: nI.display };
  } else if (pM && nM && pM.total && nM.total) {
    // No single score (e.g. "keeping your feet on"): judge by the share of moves with it.
    const a = pM.bad / pM.total, b = nM.bad / nM.total;
    status = nM.bad === 0 ? 'fixed' : b <= a - 0.2 ? 'better' : b >= a + 0.2 ? 'worse' : 'same';
  } else if (!f.key) {
    const still = (now.report.actionPlan || []).some((p) => p.title === f.planTitle);
    status = still ? 'same' : 'better';
  }
  const moves = pM && nM && pM.total && nM.total
    ? `Earlier: on ${pM.bad} of ${plural(pM.total, 'move')}. This time: on ${nM.bad} of ${plural(nM.total, 'move')}.`
    : null;
  // Replays of this attempt: moves done right first when it improved, the misses first otherwise.
  const good = nM?.goodExamples || [], bad = nM?.badExamples || [];
  const improved = status === 'fixed' || status === 'better';
  const after = (improved ? [...good.slice(0, 2), ...bad.slice(0, 2)] : [...bad.slice(0, 2), ...good.slice(0, 2)])
    .map((ex) => ({ ...ex, sub: ex.good ? '✓ done right' : '✗ still there' }));
  const cue = nI?.cue || (now.report.actionPlan || []).find((p) => p.key === f.key || p.title === f.planTitle)?.doThis || f.doThis;
  const text = {
    fixed: nM && nM.bad > 0 && nM.total ? `Much better: you got it right on ${nM.total - nM.bad} of ${plural(nM.total, 'move')}. Keep going until it's every move.` : 'You fixed it. Keep doing exactly this.',
    better: `Getting there. Keep working on it: ${lower1(cue || 'same focus as last time.')}`,
    same: `Not there yet, and that's normal: habits take a few goes. Try this next time: ${lower1(cue || 'same focus as last time.')}`,
    worse: `This slipped compared with last time. Next time: ${lower1(cue || 'go back to basics on easier climbs first.')}`,
    unknown: 'We couldn\'t measure this clearly on the new video.',
  }[status];
  return { id: f.id, kind: 'habit', key: f.key, title: f.title, status, numbers, moves, text, before: f.examples, after };
}

function fallProgress(f, now, prev) {
  const oB = attemptOutcome(now.analysis, now.outcome);
  const fB = lastFallOf(now.report);
  const hA = highPoint(prev.analysis), hB = highPoint(now.analysis);
  const further = isNum(hA) && isNum(hB) && hB - hA >= 0.5;
  let status, text;
  if (oB === 'sent') {
    status = 'fixed'; text = 'You didn\'t fall this time: you sent it!';
  } else if (oB === 'fell' && fB) {
    const same = fB.primary?.key && fB.primary.key === f.key && f.key !== 'unclear';
    const where = fB.move?.n ? ` at move ${fB.move.n}` : '';
    if (same) {
      status = further ? 'better' : 'same';
      text = `You came off the same way again${where}${further ? `, but about ${metresTxt(hB - hA)} higher than last time` : ''}. Look at the fixes for it under "Fix these first".`;
    } else {
      status = further ? 'better' : 'same';
      const why = fB.primary && fB.primary.key !== 'unclear' ? `: ${lower1(fB.primary.title)}` : '';
      text = `That problem didn't make you fall this time, but you came off for a different reason${why}${where}.${further ? ` You got about ${metresTxt(hB - hA)} higher than last time.` : ''}`;
    }
  } else if (!(now.analysis?.falls || []).length) {
    status = 'better'; text = 'No fall was seen this time. If you sent it, set the result to "Sent" at the top.';
  } else {
    status = 'unknown'; text = 'We couldn\'t tell how this attempt ended. You can set the result at the top.';
  }
  const after = oB === 'fell' && fB ? fallFix(fB).examples : [];
  return { id: f.id, kind: 'fall', key: f.key, title: `Last time ${lower1(f.title)}`, status, numbers: null, moves: null, text, before: f.examples, after };
}

/**
 * now / prev: { analysis, report, outcome (user-set result or null), coach }
 * Returns { items, counts, headline } or null when there isn't enough to compare.
 */
export function fixProgress(now, prev) {
  if (!now?.analysis || !now.report || !prev?.analysis || !prev.report) return null;
  // The same fixes the earlier report showed (the quick-look coach showed just one habit).
  const simple = prev.coach === 'pip';
  const fixes = buildFixes(prev.analysis, prev.report, { habits: simple ? 1 : 3, falls: 1 });
  if (!fixes.length) return { items: [], counts: {}, headline: 'Your earlier attempt had nothing in particular to fix, so there\'s nothing to check here.' };
  const items = fixes.map((f) => (f.kind === 'fall' ? fallProgress(f, now, prev) : habitProgress(f, now, prev)));
  const counts = {};
  for (const it of items) counts[it.status] = (counts[it.status] || 0) + 1;
  const up = (counts.fixed || 0) + (counts.better || 0);
  const n = items.length;
  const headline = up === n ? (n === 1 ? 'The thing you were working on got better. Well done!' : `All ${n} things you were working on got better. Brilliant!`)
    : up === 0 ? (counts.worse ? 'None of the fixes have shown up yet, and something slipped. That\'s normal on a tired day: try again fresh.' : 'None of the fixes have shown up yet. That\'s normal: new habits take a few goes.')
      : `${up} of the ${n} things you were working on got better.`;
  return { items, counts, headline };
}
