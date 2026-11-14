// The "Fix these first" list: every fall, then the plan's top habits to change, each with
// the moments in the climb that show it best, ready for the animated replay.
// Pure module: no DOM, testable in Node. Works from a saved session's analysis + report, so
// climbs saved by older versions get it too without being re-analysed.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sideWord = (s) => (s === 'left' ? 'left' : 'right');
const other = (s) => (s === 'left' ? 'right' : 'left');
const handKey = (s) => (s === 'left' ? 'lHand' : 'rHand');
const armKey = (s) => (s === 'left' ? 'lArm' : 'rArm');
const MAX_EXAMPLES = 4;
const secs = (v) => { const n = Math.max(1, Math.round(v || 0)); return n === 1 ? 'a second' : `${n} seconds`; };

// Plain-language titles: what you did, not the name of the measurement.
export const PLAIN_TITLES = {
  feetFirstRatio: 'Reaching before moving your feet',
  footHandRatio: 'Leaving your feet behind',
  footReadjustRate: 'Shuffling your feet after placing them',
  straightArmRatio: 'Holding on with bent arms',
  legDrive: 'Pulling with your arms instead of pushing with your legs',
  balanceOffset: 'Hips out to the side of your feet',
  pathEfficiency: 'Wasted movement',
  controlledRatio: 'Landing moves out of control',
  jerkyPerMin: 'Jerky, lunging moves',
  hesitationsPerMin: 'Stopping to think mid-climb',
  handReadjustRate: 'Re-gripping holds after grabbing them',
};

// How each habit shows up on a single move: which moves count, worst first, and what the
// replay highlights (red), points out (callout) and suggests instead (green guide).
const HABITS = {
  feetFirstRatio: {
    annot: 'feet', guide: 'feetUp',
    pick: (mv) => mv.feetBefore === 0, worst: (mv) => -(mv.up || 0),
    highlight: () => ['feet'], tKey: (mv) => mv.t0 + Math.min(0.25, mv.dur / 2),
    callout: (mv) => `Your ${sideWord(mv.side)} hand is going up, but your feet haven't moved.`,
    good: (mv) => mv.feetBefore > 0, best: (mv) => (mv.feetUp ? 0 : 1),
    goodCallout: (mv) => `Feet first: you moved your feet up, then reached with your ${sideWord(mv.side)} hand.`,
  },
  straightArmRatio: {
    annot: 'arm', guide: 'straightArm',
    pick: (mv) => isNum(mv.holdElbow) && mv.holdElbow < 110, worst: (mv) => mv.holdElbow,
    highlight: (mv) => [armKey(other(mv.side))], tKey: (mv) => (mv.t0 + mv.t1) / 2,
    callout: (mv) => `Your ${other(mv.side)} arm is bent to about ${mv.holdElbow}° while it holds you. A straight arm is 145° or more.`,
    good: (mv) => isNum(mv.holdElbow) && mv.holdElbow >= 145, best: (mv) => -mv.holdElbow,
    goodCallout: (mv) => `Your ${other(mv.side)} arm stayed straight (about ${mv.holdElbow}°) while it held you.`,
  },
  legDrive: {
    annot: 'legs', guide: null,
    pick: (mv) => isNum(mv.legShare) && mv.legShare <= 0.35, worst: (mv) => mv.legShare,
    highlight: () => ['arms'], tKey: (mv) => mv.t0,
    callout: (mv) => `Your arms are doing about ${Math.round((1 - mv.legShare) * 100)}% of the lifting here. Your legs should be pushing you up.`,
    good: (mv) => isNum(mv.legShare) && mv.legShare >= 0.6, best: (mv) => -mv.legShare,
    goodCallout: (mv) => `Your legs did about ${Math.round(mv.legShare * 100)}% of the lifting here.`,
  },
  balanceOffset: {
    annot: 'hips', guide: 'hipsOverFeet',
    pick: (mv) => isNum(mv.balance) && mv.balance >= 0.7, worst: (mv) => -mv.balance,
    highlight: () => ['torso'], tKey: (mv) => mv.t0,
    callout: () => 'Your hips are out to the side of your feet as you reach, so your hands have to hold you in.',
    good: (mv) => isNum(mv.balance) && mv.balance <= 0.3, best: (mv) => mv.balance,
    goodCallout: () => 'Hips right over your feet as you reach.',
  },
  controlledRatio: {
    annot: 'control', guide: null,
    pick: (mv) => mv.jolt || mv.cut, worst: (mv) => (mv.cut ? 0 : 1),
    highlight: (mv) => (mv.cut ? ['feet'] : [handKey(mv.side)]), tKey: (mv) => mv.t1 + 0.15,
    callout: (mv) => (mv.cut ? 'Your feet came off the wall as you grabbed the hold.' : 'You landed on the hold with a jolt instead of arriving softly.'),
    good: (mv) => !mv.jolt && !mv.cut, best: () => 0,
    goodCallout: () => 'You arrived on the hold softly, with your feet still on.',
  },
  jerkyPerMin: {
    annot: 'control', guide: null,
    pick: (mv) => mv.jolt, worst: () => 0,
    highlight: (mv) => [handKey(mv.side)], tKey: (mv) => mv.t1 + 0.15,
    callout: () => 'A sudden jolt here: the move was lunged rather than controlled.',
    good: (mv) => !mv.jolt, best: () => 0,
    goodCallout: () => 'A smooth move, with no jolt.',
  },
  hesitationsPerMin: {
    annot: 'hesitate', guide: null,
    pick: (mv) => mv.hesitated || mv.setup > 4, worst: (mv) => -(mv.setup || 0),
    highlight: () => [], tKey: (mv) => Math.max(mv.t0 - 0.6, mv.t0 - (mv.setup || 0) / 2),
    callout: (mv) => `You stopped here for about ${secs(mv.setup)} before moving on.`,
    good: (mv) => !mv.hesitated && isNum(mv.setup) && mv.setup <= 2, best: (mv) => mv.setup,
    goodCallout: () => 'You kept moving here, with no long stop.',
  },
  handReadjustRate: {
    annot: 'regrip', guide: null,
    pick: (mv) => mv.regrip === true, worst: () => 0,
    highlight: (mv) => [handKey(mv.side)], tKey: (mv) => mv.t1 + 0.5,
    callout: (mv) => `Your ${sideWord(mv.side)} hand grabbed the hold, then had to shuffle to get it right.`,
    good: (mv) => mv.regrip === false, best: () => 0,
    goodCallout: (mv) => `Your ${sideWord(mv.side)} hand got the hold right first time.`,
  },
};
HABITS.footHandRatio = HABITS.feetFirstRatio;
HABITS.cuts = { ...HABITS.controlledRatio, pick: (mv) => mv.cut, good: (mv) => !mv.cut };

// The replay of one hand move: a bit before (getting set), the reach, and the landing.
function moveExample(mv, h) {
  const before = h.annot === 'hesitate' ? Math.min(4, Math.max(1.2, mv.setup || 0)) + 0.3 : 1.2;
  const t0 = Math.max(0, mv.t0 - before), t1 = mv.t1 + 1;
  const tKey = Math.min(t1, Math.max(t0, h.tKey(mv)));
  return {
    label: `Move ${mv.n}`, sub: `${cap(sideWord(mv.side))} hand`, move: mv.n, side: mv.side,
    t0, t1, tKey, annot: h.annot, guide: h.guide, highlight: h.highlight(mv),
    ...(h.annot === 'hesitate' ? { stop: [Math.max(t0, mv.t0 - (mv.setup || 0)), mv.t0] } : {}),
    holdSide: other(mv.side), callout: h.callout(mv),
    phases: [
      { t: t0, label: h.annot === 'hesitate' ? 'Stopped' : 'Getting set', short: h.annot === 'hesitate' ? 'Stopped' : 'Get set' },
      { t: mv.t0, label: `${cap(sideWord(mv.side))} hand reaches`, short: 'Reach' },
      { t: mv.t1, label: 'Grabs the hold', short: 'Grab' },
    ],
  };
}

// The same move replay, but showing a move done right: nothing in red, no correction.
function goodExample(mv, h) {
  return { ...moveExample(mv, h), highlight: [], guide: null, good: true, callout: h.goodCallout(mv), stop: undefined };
}

function examplesFor(moves, h, filter = () => true) {
  return moves.filter((mv) => isNum(mv.t0) && isNum(mv.t1) && filter(mv) && h.pick(mv))
    .map((mv, i) => ({ mv, i }))
    // Worst first; equally bad ones stay in climb order.
    .sort((a, b) => h.worst(a.mv) - h.worst(b.mv) || a.i - b.i)
    .slice(0, MAX_EXAMPLES)
    .map(({ mv }) => moveExample(mv, h));
}

const clock = (t) => { const m = Math.floor(t / 60); return `${m}:${String(Math.floor(t - m * 60)).padStart(2, '0')}`; };

// A hesitation that wasn't right before a hand move: replay the pause itself.
function pauseExample(p) {
  const t0 = Math.max(0, p.t0 - 1), t1 = p.t1 + 1.2;
  return {
    label: `Pause at ${clock(p.t0)}`, sub: `${Math.max(1, Math.round(p.dur))} s`, move: null, side: null,
    t0, t1, tKey: Math.min(p.t1, p.t0 + 0.8), annot: 'hesitate', guide: null, highlight: [], stop: [p.t0, p.t1],
    callout: `You stopped here for about ${secs(p.dur)}, still holding on.`,
    phases: [
      { t: t0, label: 'Climbing', short: 'Before' },
      { t: p.t0, label: 'Stopped', short: 'Stopped' },
      { t: p.t1, label: 'Moving again', short: 'Moves on' },
    ],
  };
}

export function fallFix(f) {
  const p = f.primary;
  const known = p && p.key !== 'unclear';
  const ex = f.replay && isNum(f.replay.t0) && isNum(f.replay.t1) ? [{
    label: `Fall ${f.n}`, sub: f.clock, move: f.move?.n ?? null, side: f.move?.side ?? null,
    t0: f.replay.t0, t1: f.replay.t1, tKey: f.t, annot: 'fall', guide: null,
    highlight: p?.limb ? [p.limb] : [], callout: known ? `${p.title}.` : 'This is where you came off.',
    phases: [
      { t: f.replay.t0, label: 'Leading up', short: 'Before' },
      { t: Math.max(f.replay.t0, f.t - 0.8), label: 'Losing it', short: 'Losing it' },
      { t: f.t, label: 'Falling', short: 'Fall' },
    ],
  }] : [];
  return {
    id: `fall-${f.n}`, kind: 'fall', key: known ? p.key : 'unclear',
    title: known ? `You came off: ${p.title.toLowerCase()}` : 'You came off',
    sub: `${f.headline}. ${f.detail}`,
    confidence: p?.confidence || 'low', pattern: f.pattern || null,
    saw: p?.evidence || null, why: p?.why || null,
    fixes: p?.fixes || [], doThis: null, drill: p?.drill || null, target: null,
    nextAttempt: f.nextAttempt || [], secondary: f.secondary || [],
    examples: ex,
  };
}

// Which habit rule a plan item (or fix) is about, and which moves it applies to.
function habitFor(item, analysis) {
  const moves = analysis.moves || [];
  let h = HABITS[item.key] || null;
  let filter = () => true;
  const title = item.planTitle || item.title || '';
  // Plan items that aren't one measurement: find the moves that show them.
  if (!h && title === 'Keeping your feet on') h = HABITS.cuts;
  else if (!h && title === 'Staying efficient when tired') {
    const top = (analysis.sections || [])[2];
    filter = (mv) => !top || mv.t0 >= top.t0;
    h = moves.some((mv) => filter(mv) && HABITS.straightArmRatio.pick(mv)) ? HABITS.straightArmRatio : HABITS.feetFirstRatio;
  } else if (!h && /locked off/.test(title)) {
    const side = /\bleft\b/i.test(title) ? 'left' : /\bright\b/i.test(title) ? 'right' : null;
    h = HABITS.straightArmRatio;
    if (side) filter = (mv) => other(mv.side) === side;
  }
  return { h, filter, moves };
}

/**
 * How a habit showed up on a climb, move by move: how many moves had it, how many were done
 * right, and replays of both (worst / best first). item: a fix from buildFixes, or anything
 * with { key, title }. Returns null when the habit can't be judged per move.
 */
export function habitOnMoves(analysis, item) {
  if (!analysis || !item) return null;
  const { h, filter, moves } = habitFor(item, analysis);
  if (!h) return null;
  const valid = moves.filter((mv) => isNum(mv.t0) && isNum(mv.t1) && filter(mv));
  const goodMoves = valid.filter((mv) => h.good(mv)).map((mv, i) => ({ mv, i }))
    .sort((a, b) => h.best(a.mv) - h.best(b.mv) || a.i - b.i).map(({ mv }) => mv);
  return {
    total: valid.length,
    bad: valid.filter((mv) => h.pick(mv)).length,
    good: goodMoves.length,
    badExamples: examplesFor(moves, h, filter),
    goodExamples: goodMoves.slice(0, MAX_EXAMPLES).map((mv) => goodExample(mv, h)),
  };
}

function habitFix(p, analysis, k) {
  const { h, filter, moves } = habitFor(p, analysis);
  return {
    id: `habit-${p.key || k}`, kind: 'habit', key: p.key || null,
    title: PLAIN_TITLES[p.key] || p.title, planTitle: p.title,
    sub: null, confidence: p.confidence || null, pattern: null,
    saw: p.saw || null, why: p.why || null, history: p.history || null,
    fixes: [], doThis: p.doThis || null, drill: p.drill || null, target: p.target || null,
    nextAttempt: [], secondary: [],
    examples: (() => {
      const ex = h ? examplesFor(moves, h, filter) : [];
      if (!ex.length && p.key === 'hesitationsPerMin') {
        return (analysis.pauses || []).filter((x) => x.type === 'hesitation' && isNum(x.t0) && isNum(x.t1))
          .sort((a, b) => b.dur - a.dur).slice(0, MAX_EXAMPLES).map(pauseExample);
      }
      return ex;
    })(),
  };
}

/**
 * Falls first (the last ones if there are many), then the plan's habits, minus the plan's
 * "fix what made you fall" item (the fall card covers it).
 * opts: { habits: how many habits (default 3), falls: how many falls (default 3) }
 */
export function buildFixes(analysis, report, { habits = 3, falls = 3 } = {}) {
  if (!analysis || !report) return [];
  const out = (report.fallAnalyses || []).slice(-falls).map(fallFix);
  (report.actionPlan || []).filter((p) => !String(p.key || '').startsWith('fall:'))
    .slice(0, habits).forEach((p, k) => out.push(habitFix(p, analysis, k)));
  return out;
}
