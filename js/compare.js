// Compares two attempts at the same climb: how far you got, how it ended, and how each
// part of your technique changed, then turns the differences into what to do on the next go.
// Pure module: no DOM, testable in Node. Works on stored sessions of any age, so every
// field is treated as possibly missing.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const metresTxt = (t) => `${(Math.round(Math.abs(t) * 0.51 * 2) / 2).toFixed(1)} m`; // torso ≈ 0.51 m
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lower1 = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

// A score change smaller than this is treated as noise between two videos.
const SCORE_STEP = 12;

// How the attempt ended: 'sent', 'fell' or 'unknown'. A result the climber set by hand wins.
export function attemptOutcome(analysis, userOutcome) {
  if (userOutcome === 'sent' || userOutcome === 'fell') return userOutcome;
  if (userOutcome === 'attempt') return 'unknown';
  const r = analysis?.outcome?.result;
  return r === 'topped' || r === 'finished' ? 'sent' : r === 'fell' ? 'fell' : 'unknown';
}

// Highest point reached above the start, in torso lengths (comparable between videos because
// heights are scaled to the climber's body size).
export function highPoint(analysis) {
  const h = analysis?.series?.height;
  if (!Array.isArray(h)) return null;
  const vals = h.filter(isNum);
  if (vals.length < 3) return null;
  const start = vals.slice(0, Math.max(1, Math.round(vals.length * 0.05))).reduce((a, b) => a + b, 0) / Math.max(1, Math.round(vals.length * 0.05));
  return Math.max(...vals) - start;
}

const lastFall = (analysis, report) => {
  const falls = report?.fallAnalyses?.length ? report.fallAnalyses : analysis?.falls || [];
  return falls.length ? falls[falls.length - 1] : null;
};
const fallKey = (f) => f?.primary?.key || f?.causes?.[0]?.key || null;
const fallTitle = (f) => f?.primary?.title || null;

/**
 * now / prev: { analysis, report, outcome (user-set result or null), name, createdAt, id }
 * Returns null when there isn't enough to compare.
 */
export function compareAttempts(now, prev) {
  if (!now?.analysis || !prev?.analysis || !now.report || !prev.report) return null;
  const A = prev.analysis, B = now.analysis, RA = prev.report, RB = now.report;
  const mA = A.metrics || {}, mB = B.metrics || {};
  const better = [], worse = [], still = [], caveats = [];
  const facts = [];

  // ----- how it ended and how far you got -----
  const oA = attemptOutcome(A, prev.outcome), oB = attemptOutcome(B, now.outcome);
  const hA = highPoint(A), hB = highPoint(B);
  const dH = isNum(hA) && isNum(hB) ? hB - hA : null;
  const fA = lastFall(A, RA), fB = lastFall(B, RB);
  const moveA = oA === 'fell' ? fA?.move?.n : null, moveB = oB === 'fell' ? fB?.move?.n : null;
  const OUT = { sent: 'Sent', fell: 'Fell', unknown: 'Not sure' };
  facts.push({ label: 'Result', before: OUT[oA], now: OUT[oB], better: oA === oB ? null : oB === 'sent' || (oA === 'sent' ? false : null) });
  if (isNum(hA) && isNum(hB)) facts.push({ label: 'High point', before: `≈${metresTxt(hA)}`, now: `≈${metresTxt(hB)}`, better: Math.abs(dH) < 0.5 ? null : dH > 0 });
  if (moveA || moveB) facts.push({ label: 'Came off on', before: moveA ? `move ${moveA}` : '—', now: moveB ? `move ${moveB}` : '—', better: moveA && moveB && moveA !== moveB ? moveB > moveA : null });

  let headline;
  if (oA !== 'sent' && oB === 'sent') {
    headline = `You sent it this time${moveA ? `, after coming off at move ${moveA} last attempt` : ''}!`;
  } else if (oA === 'sent' && oB === 'fell') {
    headline = `You came off this time${moveB ? ` at move ${moveB}` : ''}, after sending it on your earlier attempt.`;
  } else if (oA === 'fell' && oB === 'fell') {
    if (moveA && moveB && moveB !== moveA) {
      headline = moveB > moveA
        ? `You got ${plural(moveB - moveA, 'move')} further than last time (came off at move ${moveB} instead of ${moveA}).`
        : `You came off ${plural(moveA - moveB, 'move')} earlier than last time (move ${moveB} instead of ${moveA}).`;
    } else if (isNum(dH) && Math.abs(dH) >= 0.5) {
      headline = dH > 0 ? `You got about ${metresTxt(dH)} higher than last time before coming off.` : `You came off about ${metresTxt(dH)} lower than last time.`;
    } else headline = `You came off at about the same point as last time${moveB ? ` (move ${moveB})` : ''}.`;
  } else if (oA === 'sent' && oB === 'sent') {
    const d = isNum(RA.overall) && isNum(RB.overall) ? RB.overall - RA.overall : 0;
    headline = d >= 5 ? `Both attempts went to the top, and this one was cleaner (technique ${RA.overall} → ${RB.overall}).`
      : d <= -5 ? `Both attempts went to the top, but this one was rougher (technique ${RA.overall} → ${RB.overall}).`
        : 'Both attempts went to the top, with about the same technique.';
  } else if (isNum(dH) && Math.abs(dH) >= 0.5) {
    headline = dH > 0 ? `You got about ${metresTxt(dH)} higher than on your earlier attempt.` : `You stopped about ${metresTxt(dH)} lower than on your earlier attempt.`;
  } else {
    headline = isNum(RA.overall) && isNum(RB.overall) ? `Technique ${RA.overall} → ${RB.overall} compared with your earlier attempt.` : 'Here\'s how this attempt compares with your earlier one.';
  }
  if (isNum(dH) && Math.abs(dH) >= 0.5 && !(oA === 'fell' && oB === 'fell')) {
    (dH > 0 ? better : worse).push({ key: 'height', text: `${dH > 0 ? 'Got higher' : 'Didn\'t get as high'}: about ${metresTxt(hA)} → ${metresTxt(hB)}.` });
  }

  // ----- why you came off -----
  const kA = oA === 'fell' ? fallKey(fA) : null, kB = oB === 'fell' ? fallKey(fB) : null;
  let fallFix = null;
  if (kA && kB && kA === kB && kA !== 'unclear') {
    fallFix = fB.primary?.cue || null;
    still.push({ key: `fall:${kB}`, text: `You came off the same way both times: ${lower1(fallTitle(fB))}.`, fix: fallFix });
  } else {
    if (kA && kA !== 'unclear' && !(fB?.causes || []).some((c) => c.key === kA)) {
      better.push({ key: `fall:${kA}`, text: `Last time you came off because of: ${lower1(fallTitle(fA))}. That didn't happen this time.` });
    }
    if (kB && kB !== 'unclear') {
      fallFix = fB.primary?.cue || null;
      worse.push({ key: `fall:${kB}`, text: `This time you came off because of: ${lower1(fallTitle(fB))}.`, fix: fallFix });
    }
  }

  // ----- technique, measure by measure -----
  const itemsA = new Map((RA.items || []).map((i) => [i.key, i]));
  for (const b of RB.items || []) {
    const a = itemsA.get(b.key);
    if (!a || b.info || !isNum(a.score) || !isNum(b.score)) continue;
    const d = b.score - a.score;
    const change = `${a.display} → ${b.display}`;
    if (d >= SCORE_STEP) better.push({ key: b.key, d, label: b.label, change, text: `${b.label}: ${change}.` });
    else if (d <= -SCORE_STEP) worse.push({ key: b.key, d, label: b.label, change, text: `${b.label}: ${change}.`, fix: b.cue });
    else if (a.score < 50 && b.score < 50) still.push({ key: b.key, d, label: b.label, change, text: `${b.label} needed work on both attempts (${change}).`, fix: b.cue });
  }
  // Results (height, fall cause) first, then the biggest technique changes.
  const size = (x) => (x.d === undefined ? 1000 : Math.abs(x.d));
  better.sort((x, y) => size(y) - size(x));
  worse.sort((x, y) => size(y) - size(x));
  still.sort((x, y) => (x.key.startsWith('fall:') ? -1 : y.key.startsWith('fall:') ? 1 : 0));

  // Moves and time only mean something when you covered about the same ground.
  const sameGround = (oA === 'sent' && oB === 'sent') || (isNum(dH) && Math.abs(dH) < 0.5);
  if (isNum(mA.handMoves) && isNum(mB.handMoves)) facts.push({ label: 'Hand moves', before: String(mA.handMoves), now: String(mB.handMoves), better: null });
  if (isNum(mA.climbTime) && isNum(mB.climbTime)) facts.push({ label: 'Time on the wall', before: `${Math.round(mA.climbTime)} s`, now: `${Math.round(mB.climbTime)} s`, better: null });
  if (sameGround) {
    const dm = (mB.handMoves ?? 0) - (mA.handMoves ?? 0);
    if (isNum(mA.handMoves) && isNum(mB.handMoves) && Math.abs(dm) >= 2) {
      (dm < 0 ? better : worse).push({ key: 'moves', text: dm < 0 ? `Fewer hand moves for the same ground (${mA.handMoves} → ${mB.handMoves}): a tidier sequence.` : `More hand moves for the same ground (${mA.handMoves} → ${mB.handMoves}): extra adjustments or a less direct sequence.`, fix: dm > 0 ? 'Go back to the sequence that took fewer moves, and decide each hand move before you leave the previous hold.' : null });
    }
    if (isNum(mA.climbTime) && isNum(mB.climbTime) && mA.climbTime > 5) {
      const r = mB.climbTime / mA.climbTime;
      if (r <= 0.85) better.push({ key: 'time', text: `Quicker over the same ground (${Math.round(mA.climbTime)} s → ${Math.round(mB.climbTime)} s), so less time spent gripping.` });
      else if (r >= 1.2) worse.push({ key: 'time', text: `Slower over the same ground (${Math.round(mA.climbTime)} s → ${Math.round(mB.climbTime)} s), so more time spent gripping.`, fix: 'Know the sequence before you start and only stop where you planned to rest.' });
    }
  } else if (isNum(dH)) caveats.push('You covered different amounts of the climb, so moves and time aren\'t compared directly.');
  for (const [key, label, betterWhenLower] of [['feetCuts', 'Feet cutting loose', true], ['hesitations', 'Hesitations', true]]) {
    // Already covered by the hesitation rate above.
    if (key === 'hesitations' && [...better, ...worse].some((x) => x.key === 'hesitationsPerMin')) continue;
    const a = mA[key], b = mB[key];
    if (!isNum(a) || !isNum(b) || a === b) continue;
    if (Math.abs(b - a) < 2 && !(a > 0 && b === 0)) continue;
    const good = betterWhenLower ? b < a : b > a;
    (good ? better : worse).push({ key, text: `${label}: ${a} → ${b}.`, fix: good ? null : key === 'feetCuts' ? 'Keep your toes pulling into the footholds through each reach, and your core tight as you catch.' : 'Plan the sequence from the ground so you only stop where you meant to.' });
  }

  // Where on the climb it changed most (start / middle / top).
  const sA = A.sections, sB = B.sections;
  if (Array.isArray(sA) && Array.isArray(sB) && sA.length === 3 && sB.length === 3) {
    let best = null;
    for (let i = 0; i < 3; i++) {
      for (const [k, label] of [['straightArm', 'straight arms'], ['feetFirst', 'feet first']]) {
        const a = sA[i][k], b = sB[i][k];
        if (!isNum(a) || !isNum(b)) continue;
        if (!best || Math.abs(b - a) > Math.abs(best.d)) best = { d: b - a, a, b, label, where: sB[i].name };
      }
    }
    if (best && Math.abs(best.d) >= 0.25) {
      const txt = `${best.where}: ${best.label} ${Math.round(best.a * 100)}% → ${Math.round(best.b * 100)}%.`;
      if (best.d > 0) better.push({ key: 'section', text: txt });
      else worse.push({ key: 'section', text: txt, fix: `In the ${best.where.toLowerCase()} section, ${best.label === 'straight arms' ? 'hang off straight arms whenever you pause' : 'move a foot before each reach'}.` });
    }
  }

  // ----- how sure are we -----
  if (RA.reliability?.level === 'low' || RB.reliability?.level === 'low') caveats.push('Tracking was weak on one of the two videos, so small differences may just be noise.');
  if (isNum(mA.torsoPx) && isNum(mB.torsoPx) && Math.max(mA.torsoPx, mB.torsoPx) / Math.max(1, Math.min(mA.torsoPx, mB.torsoPx)) > 1.6) {
    caveats.push('The two videos were filmed from different distances. Heights are scaled to your body size, but fine details are less comparable.');
  }

  // ----- what to do on the next attempt -----
  const advice = [];
  const fallStill = still.find((x) => x.key.startsWith('fall:'));
  const fallNew = worse.find((x) => x.key.startsWith('fall:'));
  if (fallStill?.fix) advice.push(`Fix first, because it stopped you both times: ${fallStill.fix}`);
  else if (fallNew?.fix) advice.push(`This time's fall: ${fallNew.fix}`);
  for (const w of worse.filter((x) => x.fix && !x.key.startsWith('fall:')).slice(0, 2)) {
    advice.push(w.label ? `${w.label} slipped (${w.change}). ${w.fix}` : `${w.text} ${w.fix}`);
  }
  const st = still.filter((x) => !x.key.startsWith('fall:'))[0];
  if (st) advice.push(`${st.label} needed work on both attempts, so focus on it: ${st.fix}`);
  if (oB === 'fell' && moveB) advice.push(`Rehearse move ${moveB} on its own, starting from the position just before it, then link it from the start.`);
  // What improved, as habits to repeat (getting higher is a result, not something to repeat).
  const keep = better.filter((x) => x.label).slice(0, 2);
  if (keep.length) advice.push(`Keep what worked: ${keep.map((x) => lower1(x.label)).join(' and ')} got better. Whatever you changed there, do it again.`);
  // Nothing slipped: point to the next thing worth working on, from this climb's plan.
  const next = (RB.actionPlan || []).find((x) => !String(x.key || '').startsWith('fall:'));
  if (!worse.length && !still.length && next?.doThis) advice.push(`Next thing to work on: ${lower1(next.title)}. ${next.doThis.split(/(?<=[.!?])\s/)[0]}`);
  if (!advice.length) advice.push('The two attempts were very similar. Pick one thing from your plan below and focus on just that on the next go.');

  const score = better.length - worse.length + (oB === 'sent' && oA !== 'sent' ? 3 : 0) - (oA === 'sent' && oB !== 'sent' ? 3 : 0);
  const verdict = !better.length && !worse.length ? 'same' : score > 0 && !worse.length ? 'better' : score < 0 && !better.length ? 'worse' : 'mixed';
  if (isNum(RA.overall) && isNum(RB.overall)) facts.push({ label: 'Technique score', before: String(RA.overall), now: String(RB.overall), better: Math.abs(RB.overall - RA.overall) < 5 ? null : RB.overall > RA.overall });

  return {
    prev: { id: prev.id || null, name: prev.name || '', createdAt: prev.createdAt || null },
    headline, verdict, outcome: { before: oA, now: oB },
    facts, better, worse, still, advice, caveats,
  };
}
