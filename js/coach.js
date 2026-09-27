import { FALL_CAUSES } from './falladvice.js';
import { metres } from './outcome.js';

// Turns measurements into scores (0-100) and detailed, plain-language coaching:
// a per-area breakdown, a move-by-move review, how technique changed from start to top,
// left/right differences and a prioritised action plan with targets for next session.
// Pure module: no DOM, testable in Node.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Linear map from a "bad" value to a "good" value onto 0-100.
function scale(v, bad, good) {
  if (!isNum(v)) return null;
  return Math.round(clamp(((v - bad) / (good - bad)) * 100, 0, 100));
}

const pct = (v) => `${Math.round(v * 100)}%`;
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (nums, max = 8) => {
  if (!nums.length) return '';
  const s = nums.slice(0, max).map((x) => `#${x}`);
  if (nums.length > max) return `${s.join(', ')} and ${nums.length - max} more`;
  return s.length === 1 ? s[0] : `${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}`;
};
// Aim for a realistic step up, not perfection.
const stepUp = (v, good, stepFrac = 0.5) => v + (good - v) * stepFrac;

// Each measure: how it's scored, what it means, why it matters, what to do about it.
export const METRIC_DEFS = [
  {
    key: 'feetFirstRatio', category: 'footwork', label: 'Feet first',
    format: pct, score: (v) => scale(v, 0.25, 0.8),
    what: 'Share of hand moves where you moved a foot first, after grabbing the previous hold.',
    why: 'Moving your feet up first puts your body in position, so the next hand move becomes a push with your legs instead of a pull with your arms. It\'s the single habit that most separates efficient climbers from strong-armed ones.',
    good: (v, m) => `You set your feet before ${pct(v)} of your hand moves. Your hands were mostly following your feet, which is exactly the right order.`,
    bad: (v, m) => `You moved a foot first on only ${pct(v)} of your hand moves. Most of the time your hand went up while your feet stayed low, so you had to pull yourself up to the new hold.`,
    cue: 'Before every reach, stop and ask: "Where do my feet go?" Move at least one foot up, then reach.',
    drill: 'Drill: "Feet, feet, hand". On climbs 2–3 grades below your max, make two foot moves before every hand move. Exaggerate it, even with tiny footholds.',
    target: (v) => `Feet first on at least ${pct(Math.min(0.9, stepUp(v, 0.8)))} of hand moves.`,
  },
  {
    key: 'footHandRatio', category: 'footwork', label: 'Feet per hand move',
    format: (v) => f1(v), score: (v) => scale(v, 0.4, 1.1),
    what: 'How many times you moved a foot for every hand move.',
    why: 'Your legs are several times stronger than your arms. More, smaller foot moves keep your feet high, so each hand move needs less pulling.',
    good: (v, m) => `You made ${m.footMoves} foot moves for ${m.handMoves} hand moves (${f1(v)} per hand move), so your legs did a lot of the work.`,
    bad: (v, m) => `You moved your feet ${m.footMoves} times but your hands ${m.handMoves} times (${f1(v)} feet per hand move). Your feet were being left behind, which means reaching from low, stretched positions.`,
    cue: 'Keep your feet "chasing" your hands: when your hands are high and your feet low, the next move is a foot, not a hand.',
    drill: 'Drill: "Two feet per hand". On routes well below your limit, make at least two foot moves before every hand move, even small ones to better footholds.',
    target: (v) => `At least ${f1(Math.min(1.5, stepUp(v, 1.2)))} foot moves per hand move.`,
  },
  {
    key: 'footReadjustRate', category: 'footwork', label: 'Quiet feet',
    format: (v) => `${f1(v)} readjustments per placement`, score: (v) => scale(v, 0.8, 0.1),
    what: 'How often a foot shuffled again shortly after being placed. Lower is better.',
    why: 'Each re-placement costs energy and grip time. It usually means you looked away before your toe was properly on the hold.',
    good: (v) => `Your feet mostly stayed where you put them (${f1(v)} readjustments per placement). That's precise, quiet footwork.`,
    bad: (v) => `Your feet were readjusted ${f1(v)} times per placement. You're placing them roughly and then correcting, instead of placing them precisely once.`,
    cue: 'Watch your foot all the way onto the hold, and only look up once it\'s weighted.',
    drill: 'Drill: "Silent feet". Climb easy routes placing every foot without a sound and without moving it again.',
    target: (v) => `Under ${f1(Math.max(0.15, stepUp(v, 0.15)))} readjustments per placement.`,
  },
  {
    key: 'straightArmRatio', category: 'arms', label: 'Straight arms when still',
    format: pct, score: (v) => scale(v, 0.15, 0.7),
    what: 'Of the moments you were holding still, the share spent hanging on straight arms (elbow 145° or more).',
    why: 'A straight arm hangs off bones and ligaments. A bent arm holds you up with your biceps and forearms, which is what pumps you out on longer climbs.',
    good: (v) => `You held still on straight arms ${pct(v)} of the time, hanging off your skeleton rather than your muscles.`,
    bad: (v) => `Only ${pct(v)} of your still moments were on straight arms. The rest of the time you were locked off with bent elbows, burning strength just to stay on.`,
    cue: 'Whenever you stop (to look, clip, or chalk), let your arms go long and sink your hips down and back.',
    drill: 'Drill: "Straight-arm traverse". Traverse near the ground keeping your arms straight the whole time. Move by bending your legs and turning your hips.',
    target: (v) => `Straight arms at least ${pct(Math.min(0.85, stepUp(v, 0.75)))} of the time when still.`,
  },
  {
    key: 'legDrive', category: 'arms', label: 'Leg drive',
    format: pct, score: (v) => scale(v, 0.3, 0.7),
    what: 'Estimated share of your upward movement that came from straightening your legs rather than bending your arms.',
    why: 'Pushing with your legs is cheap. Pulling with your arms is expensive. On a route of 20 moves, the difference decides whether you reach the top pumped or fresh.',
    good: (v) => `About ${pct(v)} of your upward movement came from pushing with your legs.`,
    bad: (v) => `Only about ${pct(v)} of your upward movement came from your legs. The rest was pulling with your arms.`,
    cue: 'Think "stand up", not "pull up". Push through the foothold until your leg is straight, and only then grab the next hold.',
    drill: 'Drill: "Hover hands". Before grabbing each new hold, hover your hand over it for one second. You can only do that if your legs and balance are holding you up.',
    target: (v) => `Leg drive above ${pct(Math.min(0.8, stepUp(v, 0.7)))}.`,
  },
  {
    key: 'balanceOffset', category: 'body', label: 'Hips over feet',
    format: (v) => `${f1(v)} torso lengths off`, score: (v) => scale(v, 0.9, 0.2),
    what: 'When you were standing still, how far your centre of mass was to the side of your feet. Lower is better on vertical rock.',
    why: 'When your weight is over your feet, gravity presses you onto the footholds. When it\'s off to the side, you swing out ("barn door"), and your hands have to squeeze harder to hold you in.',
    good: (v) => `When you stopped, your hips were well centred over your feet (${f1(v)} torso lengths off). Good balance means less grip needed.`,
    bad: (v) => `When you stopped, your hips were on average ${f1(v)} torso lengths to the side of your feet, so your hands were fighting to keep you in.`,
    cue: 'Before each reach, shift your hips over the foot you\'ll push from. If both feet are on one side, stick the other leg out as a counterweight (flag).',
    drill: 'Drill: "One-foot balance". On a slab or vertical wall, practise standing on one foot and taking both hands off for a second. Shift your hips until you can.',
    target: (v) => `Hips within ${f1(Math.max(0.25, stepUp(v, 0.25)))} torso lengths of your feet.`,
  },
  {
    key: 'turnedShare', category: 'body', label: 'Hip turning', info: true,
    // Not scored: how much to turn depends on the wall angle, which the camera can't see.
    format: pct, score: () => null,
    what: 'Share of moving time with your body turned side-on to the wall (twist-locks, drop knees, back-steps).',
    why: 'Turning a hip into the wall brings your centre of mass closer to the rock and extends your reach by several centimetres. On steep rock it\'s essential.',
    good: (v) => `You turned your hips into the wall ${pct(v)} of the time you were moving, using twist-locks and back-steps.`,
    bad: (v) => `You stayed square to the wall almost the whole time (turned only ${pct(v)} of moving time).`,
    cue: 'On side-pulls and long reaches, turn the hip on the reaching side into the wall and step on the outside edge of that foot.',
    drill: 'Drill: "Outside edge only". On a slightly overhanging route, use the outside edge of your shoe on every foothold. This forces you to turn your hips in.',
    target: () => 'Turn into the wall on at least a few moves per route, especially long reaches.',
  },
  {
    key: 'pathEfficiency', category: 'flow', label: 'Movement efficiency',
    format: pct, score: (v) => scale(v, 0.2, 0.6),
    what: 'Straight-line distance your body travelled divided by the actual path it took. Higher means less wasted movement.',
    why: 'Every swing, lurch or up-and-down costs energy and makes holds harder to use. Efficient climbers look slow and calm because nothing is wasted.',
    good: (v) => `Your body took a direct line up the route (${pct(v)} efficiency).`,
    bad: (v) => `Your body travelled about ${f1(1 / Math.max(v, 0.05))}× the straight-line distance up the route. That means swinging, lurching or moving up and down.`,
    cue: 'Move your hips in one smooth line toward the next position. Plan the body position before the hand move.',
    drill: 'Drill: "Slow motion". Climb a familiar route as slowly and smoothly as you can, keeping your hips moving steadily in one direction.',
    target: (v) => `Efficiency above ${pct(Math.min(0.75, stepUp(v, 0.65)))}.`,
  },
  {
    key: 'controlledRatio', category: 'flow', label: 'Controlled moves',
    format: pct, score: (v) => scale(v, 0.5, 0.95),
    what: 'Share of hand moves that ended without a jolt, swing or feet cutting loose.',
    why: 'Arriving at a hold in control means you can use it immediately. A jolt or swing forces you to squeeze hard just to stay on, and it\'s how people fall off holds they actually reached.',
    good: (v) => `${pct(v)} of your moves ended in control: no jolts, swings or feet cutting loose.`,
    bad: (v) => `Only ${pct(v)} of your moves ended in control. The rest ended in a jolt, a swing, or your feet cutting loose.`,
    cue: 'Keep your core tight and your toes pulling into the footholds as you reach. Arrive at the hold, don\'t slap it.',
    drill: 'Drill: "Deadpoint practice". On easy terrain, practise moving to a hold so you arrive at the top of your motion, when your body is weightless, and grab it softly.',
    target: (v) => `At least ${pct(Math.min(0.95, stepUp(v, 0.95)))} of moves under control.`,
  },
  {
    key: 'jerkyPerMin', category: 'flow', label: 'Sudden jolts',
    format: (v) => `${f1(v)} per min`, score: (v) => scale(v, 8, 1),
    what: 'Sudden changes in body speed (lunging, slipping, catching a swing). Lower is smoother.',
    why: 'Jolts shock-load your fingers and shoulders and usually mean a move was lunged rather than controlled.',
    good: (v) => `Your movement was smooth, with only ${f1(v)} sudden jolts per minute.`,
    bad: (v) => `You had ${f1(v)} sudden jolts per minute: sharp lunges, slips or swings you had to catch.`,
    cue: 'If you need momentum, generate it from your legs and hips in one fluid motion. Don\'t throw with your arms.',
    drill: 'Drill: "Pause at the hold". On every move, freeze for a second just as you touch the new hold, before weighting it. This forces controlled arrivals.',
    target: (v) => `Fewer than ${f1(Math.max(1, stepUp(v, 1)))} jolts per minute.`,
  },
  {
    key: 'hesitationsPerMin', category: 'flow', label: 'Hesitations',
    format: (v) => `${f1(v)} per min`, score: (v) => scale(v, 4, 0.5),
    what: 'Short stops of 1–4 seconds mid-route. These are usually unplanned pauses to work out the next move.',
    why: 'Stopping while you\'re still on your arms to work out the next move burns strength without resting. Knowing the sequence lets you keep moving and save your energy for the hard part.',
    good: (v) => `You kept moving steadily, with ${f1(v)} hesitations per minute. That looks like you read the route well.`,
    bad: (v, m) => `You hesitated ${plural(m.hesitations, 'time')} (${f1(v)} per minute), stopping mid-sequence to work out what to do.`,
    cue: 'Read the route from the ground, and name your rest spots. On the wall, only stop at the rests you planned.',
    drill: 'Drill: "Route reading". Before you start, point out every hand move from the ground and mime the sequence. Then climb it without stopping, even if a move turns out wrong.',
    target: (v) => `Fewer than ${f1(Math.max(0.5, stepUp(v, 0.5)))} hesitations per minute.`,
  },
  {
    key: 'handReadjustRate', category: 'flow', label: 'Grip readjustments',
    format: (v) => `${f1(v)} per hand move`, score: (v) => scale(v, 0.8, 0.1),
    what: 'How often a hand shuffled on a hold after grabbing it. Lower means more precise hand placement.',
    why: 'Re-gripping wastes time and strength. It usually means you grabbed the hold before seeing where its best part is.',
    good: (v) => `You grabbed holds precisely (${f1(v)} readjustments per hand move).`,
    bad: (v) => `You readjusted your grip ${f1(v)} times per hand move. You're grabbing first and finding the good part of the hold second.`,
    cue: 'Look at the exact spot on the hold before you move, and grab it once.',
    drill: 'Drill: "One touch". If you touch a hold, you have to use it exactly as you first grabbed it.',
    target: (v) => `Under ${f1(Math.max(0.15, stepUp(v, 0.15)))} re-grips per hand move.`,
  },
];

export const CATEGORIES = {
  footwork: { label: 'Footwork', blurb: 'How much your feet move, whether they lead your hands, and how precisely you place them.' },
  arms: { label: 'Arm efficiency', blurb: 'Hanging on straight arms and pushing with your legs.' },
  body: { label: 'Body position', blurb: 'Hips over feet, and turning into the wall.' },
  flow: { label: 'Flow', blurb: 'Smooth, controlled, direct and decisive movement.' },
};

export function scoreLabel(s) {
  if (!isNum(s)) return 'Not enough data';
  if (s >= 80) return 'Excellent';
  if (s >= 65) return 'Good';
  if (s >= 45) return 'Fair';
  return 'Needs work';
}

export function scoreStatus(s) {
  if (!isNum(s)) return 'none';
  if (s >= 65) return 'good';
  if (s >= 45) return 'warning';
  return 'critical';
}

// Which moves show a given problem (for evidence in the report).
const MOVE_FLAGS = {
  feetFirstRatio: (mv) => mv.feetBefore === 0,
  footHandRatio: (mv) => mv.feetBefore === 0,
  straightArmRatio: (mv) => isNum(mv.holdElbow) && mv.holdElbow < 110,
  legDrive: (mv) => isNum(mv.legShare) && mv.legShare <= 0.35,
  balanceOffset: (mv) => isNum(mv.balance) && mv.balance >= 0.7,
  controlledRatio: (mv) => mv.jolt || mv.cut,
  jerkyPerMin: (mv) => mv.jolt,
  hesitationsPerMin: (mv) => mv.hesitated,
  handReadjustRate: (mv) => mv.regrip === true,
};

// ---------- move-by-move review ----------

export function reviewMove(mv) {
  const good = [], bad = [], info = [];
  const g = (k, text) => good.push({ k, text });
  const b = (k, text) => bad.push({ k, text });
  if (mv.feetBefore > 0) g('feet', mv.feetUp ? 'Stepped your feet up first' : 'Moved a foot first');
  else b('feet', 'Reached without moving your feet first');
  if (isNum(mv.holdElbow)) {
    if (mv.holdElbow >= 145) g('arm', 'Hung off a straight arm while reaching');
    else if (mv.holdElbow < 110) b('arm', `Held on with a bent arm (${mv.holdElbow}°) while reaching`);
  }
  if (isNum(mv.legShare)) {
    if (mv.legShare >= 0.6) g('legs', 'Pushed up with your legs');
    else if (mv.legShare <= 0.35) b('legs', 'Pulled up mostly with your arms');
  }
  if (isNum(mv.balance)) {
    if (mv.balance <= 0.3) g('hips', 'Hips over your feet at the start of the move');
    else if (mv.balance >= 0.7) b('hips', 'Hips out to the side of your feet');
  }
  if (mv.hesitated || mv.setup > 4) b('hesitate', `Hesitated before the move (${f1(mv.setup)} s from the last hold)`);
  if (mv.cut) b('control', 'Feet cut loose');
  else if (mv.jolt) b('control', 'Arrived with a jolt or swing');
  else g('control', 'Arrived in control');
  if (mv.regrip === true) b('regrip', 'Re-gripped the hold after grabbing it');
  if (mv.dynamic) info.push('Dynamic move');
  if (mv.reach >= 1.4) info.push('Long reach');
  const rating = bad.length === 0 ? 'clean' : bad.length === 1 ? 'ok' : 'rough';
  return { good, bad, info, rating };
}

// Things that happened on most moves are said once as a pattern, not repeated per move.
function movePatterns(review) {
  const n = review.length;
  if (n < 4) return { patterns: [], review };
  const count = {};
  for (const mv of review) {
    for (const x of mv.bad) count[`bad:${x.k}`] = (count[`bad:${x.k}`] || 0) + 1;
    for (const x of mv.good) count[`good:${x.k}`] = (count[`good:${x.k}`] || 0) + 1;
  }
  const common = new Set(Object.entries(count).filter(([, c]) => c / n >= 0.6).map(([k]) => k));
  const patterns = [...common].map((key) => {
    const [kind, k] = key.split(':');
    const sample = review.find((mv) => mv[kind].some((x) => x.k === k))[kind].find((x) => x.k === k);
    return { kind, k, count: count[key], text: sample.text.replace(/ \(\d+°\)/, '') };
  }).sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind === 'bad' ? -1 : 1));
  const filtered = review.map((mv) => ({
    ...mv,
    good: mv.good.filter((x) => !common.has(`good:${x.k}`)),
    bad: mv.bad.filter((x) => !common.has(`bad:${x.k}`)),
  }));
  return { patterns, review: filtered };
}

// How sure can we be? Combines tracking quality, how much evidence there is, and whether
// the body part the finding depends on was actually visible.
function confidenceFor(it, m, nMoves) {
  const lvl = { high: 2, medium: 1, low: 0 };
  let c = lvl[m.trackQuality || 'high'];
  const samples = nMoves >= 6 ? 2 : nMoves >= 3 ? 1 : 0;
  c = Math.min(c, samples);
  if (it.category === 'footwork' && isNum(m.feetVisible)) c = Math.min(c, m.feetVisible >= 0.7 ? 2 : m.feetVisible >= 0.45 ? 1 : 0);
  // Scores close to the line between "fine" and "needs work" are less certain.
  if (isNum(it.score) && it.score >= 40 && it.score <= 60) c = Math.min(c, 1);
  return ['low', 'medium', 'high'][Math.max(0, c)];
}

// ---------- the full report ----------

export function coach(result) {
  const m = result.metrics;
  const moves = result.moves || [];
  const items = [];
  for (const def of METRIC_DEFS) {
    const v = m[def.key];
    const s = isNum(v) ? def.score(v) : null;
    const flagged = MOVE_FLAGS[def.key] ? moves.filter(MOVE_FLAGS[def.key]).map((mv) => mv.n) : [];
    items.push({
      key: def.key, category: def.category, label: def.label, value: v,
      display: isNum(v) ? def.format(v) : '—', score: s, info: !!def.info,
      what: def.what, why: def.why, cue: def.cue, drill: def.drill,
      target: isNum(v) ? def.target(v) : null,
      text: isNum(v) ? ((isNum(s) ? s >= 60 : v >= 0.08) ? def.good(v, m) : def.bad(v, m)) : null,
      moves: flagged,
    });
  }

  const categories = {};
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const scored = items.filter((i) => i.category === key && isNum(i.score));
    categories[key] = { label: cat.label, blurb: cat.blurb, score: scored.length ? Math.round(scored.reduce((a, i) => a + i.score, 0) / scored.length) : null };
  }
  const catScores = Object.values(categories).map((c) => c.score).filter(isNum);
  const overall = catScores.length ? Math.round(catScores.reduce((a, b) => a + b, 0) / catScores.length) : null;

  for (const it of items) it.confidence = isNum(it.value) ? confidenceFor(it, m, moves.length) : null;

  const strengths = [], improvements = [];
  for (const it of items) {
    if (!isNum(it.score)) continue;
    if (it.score >= 70) strengths.push({ key: it.key, label: it.label, score: it.score, text: it.text, confidence: it.confidence });
    else if (it.score < 50) {
      const evidence = it.moves.length && moves.length ? ` Seen on ${plural(it.moves.length, 'move')}: ${list(it.moves)}.` : '';
      const hedge = it.confidence === 'low' ? 'Possibly: ' : '';
      improvements.push({ key: it.key, label: it.label, score: it.score, text: hedge + it.text + evidence, drill: it.drill, cue: it.cue, why: it.why, target: it.target, moves: it.moves, confidence: it.confidence });
    }
  }
  strengths.sort((a, b) => b.score - a.score);
  improvements.sort((a, b) => a.score - b.score);

  // Move-by-move review, with anything that happened on most moves pulled out as a pattern.
  const fellOn = new Map((result.falls || []).filter((f) => f.move).map((f, k) => [f.move.n, k + 1]));
  const rawReview = moves.map((mv) => {
    const rv = reviewMove(mv);
    if (fellOn.has(mv.n)) {
      rv.bad.unshift({ k: 'fell', text: `You came off this move (see Fall ${fellOn.get(mv.n)})` });
      rv.rating = 'rough';
    }
    return { ...mv, ...rv, issues: rv.bad.length };
  });
  const { patterns: movePatternsList, review: moveReview } = movePatterns(rawReview);
  const clean = rawReview.filter((x) => x.rating === 'clean').length;
  const rough = rawReview.filter((x) => x.rating === 'rough').length;
  const moveSummary = rawReview.length
    ? `${plural(rawReview.length, 'hand move')}: ${clean} clean, ${rawReview.length - clean - rough} with one thing to fix, ${rough} with several.`
    : null;

  const sectionInsights = sectionAnalysis(result.sections || []);
  const sideInsights = sideAnalysis(result.sides, m);
  const extraInsights = extraAnalysis(result, m);

  // How it ended, and a breakdown of every fall.
  const outcome = result.outcome || null;
  const fallAnalyses = (result.falls || []).map((f, k) => describeFall(f, k, result));

  // Other observations (not scored).
  const notes = [];
  if (m.rests > 0) {
    notes.push(m.restStraightArm > 0
      ? `You took ${plural(m.rests, 'proper rest')} (4 s or longer), ${m.restStraightArm} of them on straight arms.`
      : `You took ${plural(m.rests, 'rest')} of 4 s or longer, but with bent arms, which recovers much less. Straighten the arm, sink the hips and alternate hands every few seconds.`);
  } else if (m.climbTime > 60) {
    notes.push(`You climbed for ${Math.round(m.climbTime)} s without a proper rest. Plan a shake-out on the best hold before the hardest section.`);
  }
  const turn = items.find((i) => i.key === 'turnedShare');
  if (turn && isNum(turn.value)) notes.push(turn.value >= 0.08 ? turn.text : `${turn.text} ${turn.cue}`);
  if (m.dynos > 0) notes.push(`${plural(m.dynos, 'dynamic move')} detected (fast upward body motion).`);
  if (m.scaleCompensated && Math.abs((m.scaleChange || 1) - 1) >= 0.2) {
    const pc = Math.round(Math.abs(m.scaleChange - 1) * 100);
    notes.push(`You looked about ${pc}% ${m.scaleChange < 1 ? 'smaller' : 'bigger'} on screen by the end of the climb, which is normal when you climb ${m.scaleChange < 1 ? 'away from' : 'toward'} the camera. All measurements were rescaled to your body size, so they're not affected.`);
  }

  const actionPlan = buildActionPlan(improvements, sectionInsights, sideInsights, extraInsights, fallAnalyses);
  actionPlan.forEach((p, k) => { const it = items.find((i) => i.key === p.key); if (it) it.inPlan = k + 1; });

  // Summary: how it ended first, then the single most useful thing to know.
  const cats = Object.entries(categories).filter(([, c]) => isNum(c.score));
  const bestCat = [...cats].sort((a, b) => b[1].score - a[1].score)[0];
  const worstCat = [...cats].sort((a, b) => a[1].score - b[1].score)[0];
  const parts = [];
  if (outcome) {
    const sure = outcome.confidence === 'high' ? '' : outcome.confidence === 'medium' ? ' (probably)' : ' (not sure)';
    const endTxt = { topped: 'You topped out', finished: 'You finished the climb', fell: 'You fell', unknown: 'We couldn\'t tell how the climb ended' }[outcome.result] || '';
    if (endTxt) parts.push(endTxt + (outcome.result === 'unknown' ? '' : sure) + '.');
    if (outcome.result === 'fell' && fallAnalyses.length) {
      const f = fallAnalyses[fallAnalyses.length - 1];
      if (f.primary && f.primary.key !== 'unclear') parts.push(`Most likely cause: ${f.primary.title.toLowerCase()}.`);
    }
  }
  if (bestCat && worstCat && bestCat[0] !== worstCat[0]) {
    parts.push(`Technique ${overall}/100: strongest in ${bestCat[1].label.toLowerCase()}, weakest in ${worstCat[1].label.toLowerCase()}.`);
  } else if (bestCat) parts.push(`Technique ${overall}/100.`);
  if (m.trackQuality === 'low') parts.push('Tracking quality was low, so treat these results as rough.');
  const summary = parts.join(' ') || 'Not enough of your body was tracked to score this climb.';

  const reliability = reliabilityCheck(m, moves.length, result);
  const movement = movementAnalysis(result.labels);

  return { overall, categories, items, strengths, improvements, notes, summary, actionPlan, moveReview, movePatterns: movePatternsList, moveSummary, sectionInsights, sideInsights, extraInsights, outcome, fallAnalyses, reliability, movement };
}

// ---------- how you moved (movement states) and technique repertoire ----------

const STATE_INFO = {
  immobility: { label: 'Still', what: 'No limb and no hip movement.' },
  postural_regulation: { label: 'Adjusting body', what: 'Hips moving while all hands and feet stay put (finding balance or position).' },
  hold_exploration: { label: 'Exploring', what: 'A hand or foot moving without ending up on a new hold (probing, testing, re-placing).' },
  hold_change: { label: 'Changing holds', what: 'A hand or foot travelling to a new hold that it then uses.' },
  hold_traction: { label: 'Pulling / pushing up', what: 'Body rising while the hands and feet stay on their holds.' },
};
export { STATE_INFO };

const TERRAIN_TIPS = {
  slab: { want: ['highSteps'], tips: ['On slab, your weight goes through your feet: keep your hips out from the wall and over your feet, heels low for maximum rubber, and use your hands for balance rather than pulling.', 'Small, frequent foot moves and high steps with a rock-over are usually more secure than long reaches.'] },
  vertical: { want: ['flags', 'highSteps'], tips: ['On vertical rock, flagging and high steps let you keep your weight over one foot for longer reaches.'] },
  overhang: { want: ['dropKnees', 'flags'], tips: ['On overhangs, turning your hips in (drop knees, back-steps) and keeping toe tension are what keep your feet on and your arms straight.', 'Expect feet to cut on big moves: brace your core and toe-pull through the catch.'] },
  roof: { want: ['dropKnees'], tips: ['In roofs, heel and toe hooks and hip-to-the-rock body tension do most of the work. The camera can\'t see hooks, so check them on the replay.'] },
  arete: { want: ['flags'], tips: ['On arêtes, laybacking, heel hooks round the edge and flagging stop the barn door.'] },
  'corner/dihedral': { want: ['stems'], tips: ['In corners, stemming between the two walls often gives no-hands rests. Look for them before you get pumped.'] },
  crack: { want: [], tips: ['Jams can\'t be seen well enough from one camera to judge. The analysis treats your crack moves generically, so check jam technique on the replay.'] },
};

function movementAnalysis(labels) {
  if (!labels) return null;
  const f = labels.fluency, rep = labels.repertoire;
  const insights = [];
  const pc = (v) => `${Math.round((v || 0) * 100)}%`;
  if (f.handProbes >= 2 || (f.share.hold_exploration || 0) >= 0.15) {
    insights.push({
      title: 'A lot of exploring',
      text: `You touched ${plural(f.handProbes, 'hold')} with a hand and let go again without using ${f.handProbes === 1 ? 'it' : 'them'}${f.footProbes ? `, and tested ${plural(f.footProbes, 'foothold')}` : ''}. ${pc(f.share.hold_exploration)} of your time was exploring, against ${pc(f.share.hold_change)} actually moving between holds.`,
      advice: 'That\'s normal when you don\'t know a route yet. A route-previewing study (PLOS ONE, 2017) linked reading the route beforehand with fewer and shorter stops. Before you start, name each hold you\'ll use, in order, and which hand takes it.',
    });
  }
  if (f.stops >= 3) {
    insights.push({
      title: `${f.stops} stops`,
      text: `You came to a complete stop ${f.stops} times (1 s or longer, ${f1(f.stopAvg)} s on average, ${f1(f.stopTotal)} s in total).`,
      advice: 'Some stops are planned rests, which is fine. The costly ones are mid-sequence stops on poor holds. Compare them with the rests in the timeline below, and plan where you\'ll stop before you start.',
    });
  }
  if ((f.share.postural_regulation || 0) >= 0.2) {
    insights.push({
      title: 'Lots of body adjusting',
      text: `${pc(f.share.postural_regulation)} of your time was spent shifting your body while all four limbs stayed put.`,
      advice: 'This is usually searching for balance before a move. Set your hip position deliberately (over the foot you\'ll push from) and then commit, rather than shuffling until it feels right.',
    });
  }
  if (f.upMoves >= 3 && f.controlledMoves / f.upMoves < 0.6) {
    insights.push({
      title: 'Reaching without the body following',
      text: `On ${f.upMoves - f.controlledMoves} of ${f.upMoves} upward hand moves your body didn't rise along with the move. The hand went up, but your centre of mass stayed where it was.`,
      advice: 'In a controlled move the body rises from the legs as the hand travels (the IFSC definition of a controlled move is exactly this: centre of mass rising while the hand moves to the next hold). Start each move by driving the hips up, and let the hand arrive at the top of that motion.',
    });
  }
  if (!insights.length) insights.push({ title: 'Efficient movement pattern', text: `Most of your time went into moving between holds (${pc(f.share.hold_change)}) and pulling/pushing up (${pc(f.share.hold_traction)}), with little exploring and few stops.`, advice: '' });

  // Repertoire: what was seen (with how sure), and what might help on this terrain.
  const seen = [];
  const addSeen = (n, label, conf) => { if (n > 0) seen.push({ label, n, conf }); };
  addSeen(rep.highSteps, 'High steps', 'medium');
  addSeen(rep.flags, `Flags${rep.flagKinds.length ? ` (${rep.flagKinds.map((k) => k.replace(/_/g, ' ')).join(', ')})` : ''}`, 'low');
  addSeen(rep.dropKnees ? Math.max(1, Math.round(rep.dropKnees / 2)) : 0, 'Drop knees', 'low');
  addSeen(rep.frog ? 1 : 0, 'Frog positions', 'low');
  addSeen(rep.handMatches, 'Hand matches', 'medium');
  addSeen(rep.footMatches, 'Foot matches', 'medium');
  addSeen(rep.footSwaps, 'Foot swaps', 'medium');
  addSeen(rep.crossThroughs, 'Cross-throughs', 'medium');
  addSeen(rep.crossovers, 'Foot crossovers', 'low');
  addSeen(rep.catches, 'Dynamic catches', 'medium');
  addSeen(rep.downclimbs, 'Down-climbing moves', 'medium');
  for (const [fam, n] of Object.entries(rep.families || {})) addSeen(n ? 1 : 0, fam.charAt(0).toUpperCase() + fam.slice(1), 'low');
  const terrain = labels.terrain;
  const tt = TERRAIN_TIPS[terrain];
  const suggestions = [];
  if (tt) {
    for (const w of tt.want) {
      const have = w === 'stems' ? (rep.families?.stemming || 0) : rep[w];
      if (!have) suggestions.push({ highSteps: 'No high steps seen: look for high footholds to rock over before long reaches.', flags: 'No flags seen: when both feet are on one side, flag the other leg to stop the swing.', dropKnees: 'No drop knees seen: on steep ground a drop knee often turns a hard pull into a reach.', stems: 'No stemming seen: in a corner, bridging between the walls can take the weight off your arms.' }[w]);
    }
    suggestions.push(...tt.tips);
  } else {
    suggestions.push('Set the terrain (slab, vertical, overhang, …) when you analyse a climb to get advice specific to the rock angle.');
  }
  return {
    share: f.share, fluency: f, insights, seen, suggestions, terrain,
    caveat: 'These are observations of what your body did, not a measure of skill. Movement labels come from body-position rules on a single camera view, and each carries a confidence level.',
  };
}

// ---------- falls ----------

const fmtClock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function describeFall(f, k, result) {
  const causes = f.causes.map((c) => ({ ...c, ...(FALL_CAUSES[c.key] || FALL_CAUSES.unclear) }));
  // Lead with the most solid explanation; keep weaker ones as "also possible".
  const primary = causes[0] || null;
  const secondary = causes.slice(1).filter((c) => c.key !== 'unclear');
  const where = f.move ? ` on move #${f.move.n} (${f.move.side} hand)` : '';
  const stickTxt = f.stick === null || f.stick === undefined ? '.' : f.stick < 0.1 ? ', the instant your hand reached the hold.' : `, ${f1(f.stick)} s after your hand reached the hold.`;
  // Next attempt: a short, concrete plan (not a repeat of the fixes above).
  const next = [];
  const at = f.replay ? fmtClock(Math.max(0, f.t - 2)) : fmtClock(f.t);
  next.push(f.move ? `Rehearse move #${f.move.n} on its own, starting from the position you were in at ${at} (see the replay).` : `Rehearse the section around ${at} on its own.`);
  if (primary) next.push(`Focus on one thing: ${primary.cue}`);
  const sec = secondary.find((c) => c.confidence !== 'low');
  if (sec) next.push(`Then add: ${sec.cue}`);
  if (causes.some((c) => c.key === 'pump' || c.key === 'stalled') && !['pump', 'stalled'].includes(primary?.key)) next.push('Before this section, rest on the last good hold (straight arm, alternate hands) so you arrive fresh.');
  next.push('Once the move goes on its own, link it from the start. Keep it to 3–4 tries, then rest 5 minutes or more: tired attempts rehearse bad habits.');
  return {
    n: k + 1, t: f.t, clock: fmtClock(f.t), drop: f.drop, move: f.move, stick: f.stick, lost: f.lost,
    headline: `Fall ${k + 1} at ${fmtClock(f.t)}${where}`,
    detail: `You dropped about ${metres(f.drop)}${stickTxt}`,
    primary, secondary, nextAttempt: next, replay: f.replay,
  };
}

function reliabilityCheck(m, nMoves, result) {
  const points = [];
  let score = 3;
  if (isNum(m.torsoPx)) {
    if (m.torsoPx < 30) { points.push(`You were small in the video (torso about ${Math.round(m.torsoPx)} px), so fine details like foot placements are rough.`); score -= 1; }
    else points.push(`You were big enough in the video to track (torso about ${Math.round(m.torsoPx)} px).`);
  }
  if (isNum(m.feetVisible) && m.feetVisible < 0.6) { points.push(`Your feet were clearly visible only ${Math.round(m.feetVisible * 100)}% of the time (hidden behind your body or out of frame). Footwork findings are less certain, and hidden stretches were estimated.`); score -= 1; }
  if (m.trackedRatio < 0.8) { points.push(`Your body was found in ${Math.round(m.trackedRatio * 100)}% of frames.`); score -= 1; }
  if (nMoves < 4) { points.push(`Only ${plural(nMoves, 'hand move')} detected. That's too few to be sure about patterns.`); score -= 1; }
  if (m.cameraMoved) points.push('The camera moved; this was compensated for, but it adds some uncertainty to speeds and heights.');
  const level = score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
  return { level, points, text: level === 'high' ? 'Good tracking: these results should be reliable.' : level === 'medium' ? 'Decent tracking, with some uncertainty. See the notes below.' : 'Weak tracking: treat these results as rough indications.' };
}

// ---------- start / middle / top ----------

function sectionAnalysis(sections) {
  const out = [];
  if (sections.length !== 3) return out;
  const [a, , c] = sections;
  const drops = [];
  if (isNum(a.straightArm) && isNum(c.straightArm) && a.straightArm - c.straightArm >= 0.15) {
    drops.push(`straight arms went from ${pct(a.straightArm)} at the start to ${pct(c.straightArm)} near the top`);
  }
  if (isNum(a.feetFirst) && isNum(c.feetFirst) && a.feetFirst - c.feetFirst >= 0.25) {
    drops.push(`feet-first went from ${pct(a.feetFirst)} to ${pct(c.feetFirst)}`);
  }
  if (c.jolts - a.jolts >= 2) drops.push(`jolts went up from ${a.jolts} to ${c.jolts}`);
  if (drops.length) {
    out.push({
      kind: 'fatigue', title: 'Technique faded near the top',
      text: `Your technique got worse as you went up: ${drops.join('; ')}. This is the classic pattern of getting pumped. Tired arms bend and feet get lazy, which makes you even more tired.`,
      advice: 'Take a proper shake-out rest before the last third, and focus hardest on straight arms and feet-first exactly when you start to feel tired. Also train endurance: climb laps of easy routes without coming off.',
    });
  }
  if (isNum(a.setup) && isNum(c.setup) && c.setup > a.setup * 1.5 && c.setup - a.setup > 1) {
    out.push({
      kind: 'slowdown', title: 'You slowed down near the top',
      text: `You took ${f1(a.setup)} s per move at the start but ${f1(c.setup)} s per move near the top. That's either the crux, fatigue, or not knowing the sequence up there.`,
      advice: 'Study the top section from the ground before you start, and plan a rest just before it.',
    });
  }
  const best = [...sections].filter((s) => isNum(s.straightArm)).sort((x, y) => y.straightArm - x.straightArm)[0];
  if (!out.length && sections.every((s) => s.moves > 0)) {
    out.push({ kind: 'steady', title: 'Consistent from start to top', text: 'Your technique held up well from start to top, with no clear drop-off in straight arms, footwork or control.', advice: best ? `Your cleanest section was the ${best.name.toLowerCase()}.` : '' });
  }
  const hes = sections.map((s) => s.hesitations);
  const maxH = Math.max(...hes);
  if (maxH >= 2) {
    const where = sections[hes.indexOf(maxH)].name.toLowerCase();
    out.push({ kind: 'hesitation', title: `Most hesitation in the ${where}`, text: `${plural(maxH, 'hesitation')} happened in the ${where} section. That's where you were least sure of the sequence.`, advice: `Next time, rehearse the ${where} moves from the ground (or on top rope) until you can say them out loud in order.` });
  }
  return out;
}

// ---------- left vs right ----------

function sideAnalysis(sides, m) {
  const out = [];
  if (!sides) return out;
  const imbalance = (o, what, advice) => {
    const l = o.left, r = o.right, tot = l + r;
    if (tot < 6) return;
    const hi = l > r ? 'left' : 'right', lo = l > r ? 'right' : 'left';
    if (Math.max(l, r) >= Math.min(l, r) * 2) {
      out.push({ title: `Your ${hi} ${what} did most of the work`, text: `${what === 'hand' ? 'Hand' : 'Foot'} moves: left ${l}, right ${r}. Your ${lo} ${what} was fairly passive.`, advice });
    }
  };
  imbalance(sides.footMoves, 'foot', 'A passive leg usually means you\'re missing footholds on that side. Before each move, look for a foothold for your quieter foot too.');
  imbalance(sides.handMoves, 'hand', 'Leading with the same hand can mean you\'re matching a lot or avoiding moves on your weaker side. Practise reaching with the other hand on easy routes.');
  const la = sides.arms?.left, ra = sides.arms?.right;
  if (la && ra && Math.abs(la.bent - ra.bent) >= 0.3) {
    const worse = la.bent > ra.bent ? 'left' : 'right';
    out.push({
      title: `Your ${worse} arm was locked off much more`,
      text: `When holding still, your left arm was bent ${pct(la.bent)} of the time and your right arm ${pct(ra.bent)}. You're hanging on your ${worse} arm with a bent elbow.`,
      advice: `Consciously straighten your ${worse} arm whenever you pause. If it's your weaker side, it will tire first.`,
    });
  }
  const hs = sides.highSteps;
  if (hs && hs.left + hs.right >= 2 && (hs.left === 0 || hs.right === 0)) {
    const used = hs.left > 0 ? 'left' : 'right';
    out.push({ title: `High steps only with your ${used} leg`, text: `All ${hs.left + hs.right} high steps were with your ${used} leg.`, advice: `Practise high steps with your ${used === 'left' ? 'right' : 'left'} leg too, since that flexibility often opens up easier sequences.` });
  }
  if (!out.length) out.push({ title: 'Balanced left and right', text: 'Both sides of your body did a similar amount of work, with no big imbalance.', advice: '' });
  return out;
}

// ---------- extra observations ----------

function extraAnalysis(result, m) {
  const out = [];
  const moves = result.moves || [];
  const ex = result.extras || {};
  if (m.feetCuts > 0) {
    const cutMoves = moves.filter((x) => x.cut).map((x) => x.n);
    out.push({
      kind: 'feetCuts', title: 'Feet cutting loose', priority: 50 + m.feetCuts * 5,
      text: `Your feet came off the rock ${plural(m.feetCuts, 'time')}${cutMoves.length ? ` (on move ${list(cutMoves)})` : ''}. Every cut means a swing you have to hold with your arms.`,
      advice: 'Keep your core tight and actively pull your toes toward you on the footholds, especially on steep rock and long reaches.',
      drill: 'Drill: "Toe hooks and toe pulls". On an overhang, practise moves while consciously pulling with your toes. If your feet cut, repeat the move.',
    });
  }
  if (m.highSteps > 0) {
    out.push({ kind: 'highSteps', title: 'High steps', text: `You used ${plural(m.highSteps, 'high step')}. High feet let you push up instead of pulling. Nice.`, advice: 'Keep looking for them, especially before long reaches.' });
  } else if (moves.length >= 5) {
    out.push({ kind: 'highSteps', title: 'No high steps', text: 'You didn\'t use any high steps (a foot brought up to around hip height).', advice: 'On vertical rock, bringing a foot high and rocking over it is often easier than pulling. Look for a high foothold before each long reach.' });
  }
  if (m.shakeOuts > 0) {
    out.push({ kind: 'shakeOuts', title: 'Shake-outs and chalking', text: `You dropped a hand to shake out or chalk ${plural(m.shakeOuts, 'time')}.`, advice: 'Do it on good holds with a straight arm, and shake out each hand for a few seconds, not just a quick dip.' });
  } else if (m.climbTime > 45) {
    out.push({ kind: 'shakeOuts', title: 'No shake-outs', text: `You never dropped a hand to shake out or chalk during ${Math.round(m.climbTime)} s of climbing.`, advice: 'On longer climbs, shake out on the good holds before you get pumped, not after.' });
  }
  if (isNum(m.stanceWidth)) {
    if (m.stanceWidth < 0.35) out.push({ kind: 'stance', title: 'Narrow stance', text: `Your feet were usually close together (${f1(m.stanceWidth)} torso lengths apart).`, advice: 'A slightly wider stance gives you a more stable base and makes it easier to shift your hips over either foot.' });
    else if (m.stanceWidth > 1.3) out.push({ kind: 'stance', title: 'Very wide stance', text: `Your feet were often very far apart (${f1(m.stanceWidth)} torso lengths).`, advice: 'Wide stems are great for resting in corners, but on a face they make it hard to move. Bring your feet under you more.' });
  }
  if (isNum(m.avgSetup) && moves.length >= 3) {
    out.push({ kind: 'pace', title: 'Pace', text: `You averaged ${f1(m.avgSetup)} s between arriving at one hold and leaving for the next, and made ${f1(m.movesPerMin || 0)} hand moves per minute.`, advice: m.avgSetup > 3 ? 'That\'s quite slow. Unless you\'re resting, aim to keep moving: time on the wall costs grip even when you\'re standing still.' : 'That\'s a good, steady pace.' });
  }
  return out;
}

// ---------- action plan ----------

const PRIORITY_WEIGHT = { footwork: 1.1, arms: 1.05, body: 1, flow: 0.95 };

function buildActionPlan(improvements, sectionInsights, sideInsights, extraInsights, fallAnalyses = []) {
  // Low-confidence findings stay out of the plan unless there's nothing better.
  const solid = improvements.filter((i) => i.confidence !== 'low');
  const pool = solid.length ? solid : improvements;
  const cands = pool.map((i) => ({
    // Core technique (feet, arms) comes before flow when problems are equally bad.
    key: i.key, title: i.label, confidence: i.confidence, priority: (100 - i.score) * (PRIORITY_WEIGHT[METRIC_DEFS.find((d) => d.key === i.key)?.category] || 1),
    saw: i.text, why: i.why, doThis: i.cue, drill: i.drill, target: i.target, moves: i.moves,
  }));
  // What made you fall comes first when we're reasonably sure about it.
  const lastFall = fallAnalyses[fallAnalyses.length - 1];
  if (lastFall && lastFall.primary && lastFall.primary.key !== 'unclear' && lastFall.primary.confidence !== 'low') {
    const c = lastFall.primary;
    // Short here: the full explanation is in the fall card above the plan.
    cands.push({
      key: `fall:${c.key}`, title: `Fix what made you fall: ${c.title.toLowerCase()}`, priority: 200,
      saw: `${lastFall.headline}: ${c.evidence}`, why: null, doThis: `${c.cue} The full breakdown and replay are in the "${lastFall.headline}" card above.`, drill: null,
      target: lastFall.move ? `Stick move #${lastFall.move.n} and hold it for a full second before the next move.` : 'Get past this point without coming off.',
      moves: lastFall.move ? [lastFall.move.n] : [], confidence: c.confidence,
    });
  }
  const fade = sectionInsights.find((x) => x.kind === 'fatigue');
  if (fade) cands.push({ title: 'Staying efficient when tired', priority: 55, saw: fade.text, why: 'Most falls happen in the last third of a route, when technique slips under fatigue.', doThis: fade.advice, drill: 'Drill: "Pump laps". Climb an easy route 3 times in a row without resting, focusing on perfect straight arms and footwork on the last lap.', target: 'Keep straight arms and feet-first at the same level in the top third as at the start.' });
  const cuts = extraInsights.find((x) => x.kind === 'feetCuts');
  if (cuts) cands.push({ title: 'Keeping your feet on', priority: cuts.priority, saw: cuts.text, why: 'Feet cutting loose throws all your weight onto your fingers at once. It\'s one of the most common reasons to fall off a hold you actually reached.', doThis: cuts.advice, drill: cuts.drill, target: 'No feet cutting loose on routes at or below your level.' });
  const side = sideInsights.find((x) => x.advice && /did most of the work|locked off/.test(x.title));
  if (side) cands.push({ title: side.title, priority: 35, saw: side.text, why: 'Imbalances mean one side tires first, and they often hide easier sequences on the other side.', doThis: side.advice, drill: '', target: 'Closer to an even split between left and right.' });
  // "Feet first" and "feet per hand move" say the same thing; keep the more actionable
  // "feet first" wording at the higher of the two priorities.
  const ff = cands.find((c) => c.key === 'feetFirstRatio'), fh = cands.find((c) => c.key === 'footHandRatio');
  if (ff && fh) { ff.priority = Math.max(ff.priority, fh.priority); cands.splice(cands.indexOf(fh), 1); }
  // One item per theme.
  const seen = new Set();
  return cands.sort((a, b) => b.priority - a.priority).filter((c) => {
    const theme = c.key === 'feetFirstRatio' || c.key === 'footHandRatio' ? 'feet' : c.key || c.title;
    if (seen.has(theme)) return false;
    seen.add(theme);
    return true;
  }).slice(0, 3);
}
