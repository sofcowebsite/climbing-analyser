import { FALL_CAUSES } from './falladvice.js';
import { metres } from './outcome.js';
import { compareAttempts } from './compare.js';

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

// Alternative cues and drills, used in turn when the same problem comes back on later
// climbs, so a recurring issue gets a new angle instead of the same words. Drills go
// roughly from simple to more demanding.
const VARIANTS = {
  feetFirstRatio: {
    cues: [
      'Look down before you look up: find the next foothold first, then the handhold it lets you reach.',
      'Say "feet" in your head before every hand move. It sounds silly, but it breaks the reach-first habit quickly.',
    ],
    drills: [
      'Drill: "Stepped reach". Before letting go with a hand, bring a foot up until you could reach the next hold with that arm still straight. If you can\'t, the foot isn\'t high enough yet.',
      'Drill: "Feet only". Hold two good handholds on a vertical wall and move only your feet: up, across and back down to new footholds, 10 times per side, as part of your warm-up.',
      'Drill: "Beat your count". On three warm-up routes, count your feet-first moves on the first one, then beat that number on the next two. Film the last one to check.',
    ],
  },
  footHandRatio: {
    cues: [
      'Use intermediate footholds: small smears and edges between the big ones keep your feet close under you.',
      'When your hands are high and your legs are straight, you\'re stretched out. That\'s the signal for a foot move, not another hand move.',
    ],
    drills: [
      'Drill: "Knee-height steps". On an easy route, only use footholds at or below knee height relative to your current foot: lots of small steps instead of a few big ones.',
      'Drill: "Glued hands". On a traverse, a hand may only move after both feet have moved.',
    ],
  },
  footReadjustRate: {
    cues: [
      'Choose the exact spot on the foothold (the best edge or dimple) before your foot leaves the old one.',
      'Slow the foot down for the last few centimetres, like putting a full glass down on a table.',
    ],
    drills: [
      'Drill: "Stare and count". Keep your eyes on each foot until it\'s weighted, then count "one" before you look up.',
      'Drill: "Target practice". Pick a chalk mark or the best part of each foothold and land your big toe exactly on it, first time.',
      'Drill: "Redo rule". On an easy route, any foot that moves after being placed means down-climbing one move and doing it again.',
    ],
  },
  straightArmRatio: {
    cues: [
      'Think "long arms, bent legs": when you\'re still, the bend should be in your knees, not your elbows.',
      'Hang like a coat on a hook: shoulders engaged, elbows straight, hips sitting out from the wall.',
    ],
    drills: [
      'Drill: "Two-second hang". On every hold of an easy route, pause for two seconds on a straight arm before moving. If you can\'t straighten it, move your feet until you can.',
      'Drill: "Bend only to move". On an easy overhang, your arms may only bend while actually travelling between holds. Film it and check every still moment.',
      'Drill: "Shoulder set". Hang a jug on one straight arm and pull the shoulder blade down without bending the elbow, 5 × 5 s per arm. That\'s the position to rest in.',
    ],
  },
  legDrive: {
    cues: [
      'Before the reach, sink your hips slightly and push up from the foot, like getting out of a low chair.',
      'Let your hand ride up on your legs\' push: it should arrive at the hold without your arm having to pull.',
    ],
    drills: [
      'Drill: "Stand, then reach". Split every move in two: first stand up fully on the foothold and freeze, then reach.',
      'Drill: "Open hands". On a slab or easy vertical wall, climb using open hands only (no crimping or pulling), so the lift has to come from your legs.',
      'Drill: "One hand down". On easy vertical terrain, climb short sections with one hand behind your back. The legs have to lift you.',
    ],
  },
  balanceOffset: {
    cues: [
      'Your belly button should be above the foot you\'re about to push from.',
      'If a hand is working hard to hold you in, your hips are in the wrong place: move them instead of squeezing harder.',
    ],
    drills: [
      'Drill: "Light hand". Before each reach, relax the grip of the hand that\'s about to move until you could let go. Shift your hips until you can.',
      'Drill: "Flag everything". On an easy route, flag the free leg on every move where both feet are on the same side. It teaches you where your balance point is.',
      'Drill: "Hip-shift traverse". Traverse slowly, moving your hips fully over one foot before moving the other foot or a hand.',
    ],
  },
  turnedShare: {
    cues: [
      'On a long reach, turn the same-side hip in: reaching with the right hand means right hip toward the rock.',
      'Try each hard move twice, once square and once turned, and keep whichever leaves your arm straighter.',
    ],
    drills: [
      'Drill: "Back-step lap". On a steep wall, back-step (outside edge, hip in) on every move of an easy route.',
      'Drill: "Drop-knee hunt". On an overhang, find three moves where a drop knee makes the reach easier, and repeat each one 3 times.',
    ],
  },
  pathEfficiency: {
    cues: [
      'Before each move, picture where your hips need to end up, then move them there in one go.',
      'Don\'t swing to build momentum. If you need it, one small pump of the hips is enough.',
    ],
    drills: [
      'Drill: "Freeze". A partner calls "freeze" at random moments; you should always be in a position you could hold.',
      'Drill: "Watch your hips". Film a route and watch only your hips. Mark every place they go down or sideways for no reason, and fix those spots on the next go.',
    ],
  },
  controlledRatio: {
    cues: [
      'Grab softly first, then tighten. A soft landing is a controlled landing.',
      'Keep your feet pushing through the reach, and don\'t let your hips drift off the wall as you grab.',
    ],
    drills: [
      'Drill: "Touch, then take". Touch every new hold lightly for a moment before gripping it. You can only do that if you arrive in control.',
      'Drill: "Stick it". After every hand move, freeze for 2 seconds with your feet still on. Any swing or foot cut means repeating the move.',
    ],
  },
  jerkyPerMin: {
    cues: [
      'Move at a speed you could stop at any moment.',
      'Breathe out as you make each move. It takes the lunge out of it.',
    ],
    drills: [
      'Drill: "Slow motion". Climb an easy route taking about 5 seconds per move, completely smoothly.',
      'Drill: "Quiet climbing". A partner listens: every thud, slap or scrape is a point against you. Aim for zero.',
    ],
  },
  hesitationsPerMin: {
    cues: [
      'If you have to stop and think, do it on a good hold with a straight arm, never on a bad one.',
      'Decide the next two moves before you leave a rest, not one move at a time.',
    ],
    drills: [
      'Drill: "Beta out loud". Before climbing, tell a partner the full sequence, hands and feet. Afterwards, note where the real sequence was different.',
      'Drill: "Count of three". On a new route below your limit, give yourself a count of three at each hold, then move, even if you\'re unsure.',
    ],
  },
  handReadjustRate: {
    cues: [
      'Shape your hand for the hold (crimp, open hand, pinch) before it arrives.',
      'Slow the hand for the last 5 cm so it lands exactly where you aimed.',
    ],
    drills: [
      'Drill: "Look, then grab". Look at each hold for a second before you reach and decide the grip before your hand moves.',
      'Drill: "First grip". Go round the gym grabbing different hold types from the ground, one try each: your first grip has to be your final grip.',
    ],
  },
};
for (const d of METRIC_DEFS) {
  d.cues = [d.cue, ...(VARIANTS[d.key]?.cues || [])];
  d.drills = [d.drill, ...(VARIANTS[d.key]?.drills || [])];
}

// Pick the k-th entry of a list, wrapping round.
const pick = (pool, k) => pool[((k % pool.length) + pool.length) % pool.length];
// Start a list from its k-th entry, so a different point comes first.
const rotate = (arr, k) => (arr.length ? arr.map((_, i) => arr[(i + k) % arr.length]) : arr);
const ordinal = (n) => ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] || `${n}th`;

// ---------- memory of earlier climbs ----------
// Earlier reports let the coaching change from climb to climb: a recurring problem gets a
// different cue and drill each time along with how it has trended, explanations the climber
// has already read aren't repeated in full, and lasting strengths are only mentioned briefly.
// Everything is counted from the stored reports, so reopening a climb shows the same text.
function historyIndex(history) {
  const prev = (history || [])
    .filter((s) => s && s.report && Array.isArray(s.report.items))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const inList = (s, list, key) => (s.report[list] || []).some((x) => x.key === key);
  const count = (pred) => prev.reduce((c, s) => c + (pred(s.report) ? 1 : 0), 0);
  const streak = (pred) => { let k = 0; for (let i = prev.length - 1; i >= 0 && pred(prev[i].report); i--) k++; return k; };
  return {
    n: prev.length,
    last: prev.length ? prev[prev.length - 1].report : null,
    count, streak,
    flagged: (key) => prev.filter((s) => inList(s, 'improvements', key)).length,
    flagStreak: (key) => streak((r) => (r.improvements || []).some((x) => x.key === key)),
    strongStreak: (key) => streak((r) => (r.strengths || []).some((x) => x.key === key || (x.keys || []).includes(key))),
    scores: (key, k) => prev.slice(-k).map((s) => s.report.items.find((i) => i.key === key)?.score),
  };
}
const worstCategory = (cats) => Object.entries(cats || {}).filter(([, c]) => isNum(c?.score)).sort((a, b) => a[1].score - b[1].score)[0]?.[0] || null;

// How a problem has gone over earlier climbs, in one sentence (or null on a first climb).
// k counts notes already written for this report, so several recurring problems don't all
// get the same sentence.
function trendNote(it, H, k = 0) {
  if (!H.n || !isNum(it.score)) return null;
  const streak = H.flagStreak(it.key), times = H.flagged(it.key);
  if (streak >= 1) {
    const seq = H.scores(it.key, Math.min(streak, 4)).filter(isNum);
    const before = seq.length ? seq.reduce((a, b) => a + b, 0) / seq.length : null;
    const d = isNum(before) ? it.score - before : 0;
    const when = streak === 1 ? 'on your last climb too' : `on each of your last ${streak} climbs`;
    const path = seq.length ? ` (score ${[...seq, it.score].join(' → ')})` : '';
    const verdict = d >= 8 ? pick(['It\'s improving, so what you\'re doing is working: keep going.', 'Heading the right way.', 'Better than before: keep the same focus.'], k)
      : d <= -8 ? pick(['It\'s got worse, so give it priority.', 'This one slipped further, so put it first on your warm-ups.', 'Worse than before.'], k)
        : pick([
          'It hasn\'t moved much yet, so the cue and drill below are different from last time: a new angle on the same problem.',
          'No real change yet, so there\'s a fresh drill below.',
          'About the same as before. Try the new cue this time.',
        ], k);
    return `Flagged ${when}${path}. ${verdict}`;
  }
  if (times >= 1) return `This came back: it was fine on your last climb, but it's been flagged on ${times} of your ${H.n} earlier climbs. It slips when you're not thinking about it, so keep it on your warm-up checklist.`;
  if (H.n >= 2) return `New this climb: it wasn't a problem on any of your ${H.n} earlier climbs, so it may be down to this route (or how you felt today) rather than a habit.`;
  return null;
}

// ---------- the coaches ----------
// Each analysis level is presented as its own coach: how carefully the video is tracked, and
// how much of the report is shown up front. Pick one in Settings or before analysing.
// The names are a light-hearted nod to well-known climbing YouTubers/coaches (first name
// only, playful, not an endorsement or affiliation) — the internal ids (pip/rowan/sage) are
// unchanged so saved sessions still match up to a coach after a rename.
export const COACHES = {
  pip: {
    id: 'pip', name: 'Magnus', role: 'Quick look', quality: 'fast', level: 'simple',
    speed: 'Fastest', detail: 'Short and simple',
    blurb: 'A fast check with a short, plain report: how it went, the one thing to work on, and what you did well. Less accurate on small or partly hidden climbers.',
  },
  rowan: {
    id: 'rowan', name: 'Alex', role: 'All-round coach', quality: 'accurate', level: 'standard',
    speed: 'Balanced', detail: 'Clear, with detail on request',
    blurb: 'Accurate tracking at a sensible speed. A clear report with a three-point plan; the technical extras are tucked away under "More detail".',
  },
  sage: {
    id: 'sage', name: 'Eric', role: 'Deep dive', quality: 'max', level: 'expert',
    speed: 'About 3× slower', detail: 'Everything, with all the numbers',
    blurb: 'The most accurate tracking (best for hidden legs and far-away climbers) and the full report: every measurement, the movement timeline and all the numbers.',
  },
};
export const coachForQuality = (q) => Object.values(COACHES).find((c) => c.quality === q) || COACHES.rowan;

// Everyday words for each measure, for the coach's short summary.
const PLAIN = {
  feetFirstRatio: 'moving your feet before your hands',
  footHandRatio: 'moving your feet more often',
  footReadjustRate: 'placing each foot once, precisely',
  straightArmRatio: 'resting on straight arms',
  legDrive: 'pushing up with your legs',
  balanceOffset: 'keeping your hips over your feet',
  turnedShare: 'turning your hips into the wall',
  pathEfficiency: 'moving in a direct line',
  controlledRatio: 'arriving at holds in control',
  jerkyPerMin: 'moving smoothly',
  hesitationsPerMin: 'keeping moving instead of stopping to think',
  handReadjustRate: 'grabbing each hold once',
};
const FALL_PLAIN = {
  missedCatch: 'you reached the hold but couldn\'t hold on to it',
  lateCatch: 'you grabbed the hold a moment too late on a dynamic move',
  overreach: 'you were at full stretch when you grabbed the hold',
  feetCut: 'your feet came off the wall as you moved',
  handSlip: 'your hand slid off the hold',
  footSlip: 'your foot slipped first',
  barnDoor: 'your body swung open sideways',
  lockoff: 'your bent arm gave out',
  stalled: 'you stayed too long in the hard part',
  pump: 'your forearms were too tired (pumped)',
};
const firstSentence = (t) => (t || '').split(/(?<=[.!?])\s/)[0];
const lower1 = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

// The coach's short, plain-language summary: how it went, what went well, what to do next.
function coachTake(rep, coachId) {
  const c = COACHES[coachId] || COACHES.rowan;
  const simple = c.level === 'simple', expert = c.level === 'expert';
  const lines = [];
  const oc = rep.outcome;
  const lastFall = rep.fallAnalyses[rep.fallAnalyses.length - 1];
  if ((oc?.result === 'topped' || oc?.result === 'finished') && oc.confidence === 'low') {
    // Not sure it was the finish (the camera can't see the holds): say so, and how to fix it.
    lines.push(`It looks like you finished: ${lower1(oc.headline)}. If that wasn't the finish hold, set the result to "Fell" below.`);
  } else if (oc?.result === 'topped' || oc?.result === 'finished') {
    lines.push(pick(simple ? ['Nice one: you made it to the top!', 'You got to the top. Great effort!'] : expert ? [`You completed the climb (${oc.result === 'topped' ? 'topped out' : 'held the finish'}).`] : ['You got to the top.', 'You finished the climb.'], rep.overall || 0));
  } else if (oc?.result === 'fell' && lastFall) {
    const why = FALL_PLAIN[lastFall.primary?.key];
    lines.push(`You came off at ${lastFall.clock}${lastFall.move ? ` on move ${lastFall.move.n}` : ''}.${why ? ` It looks like ${why}.` : ' The video doesn\'t show one clear reason.'}`);
  } else if (oc) lines.push(simple ? 'I couldn\'t tell for sure how the climb ended. You can set the result below.' : 'The video doesn\'t show clearly how the climb ended, so check the result below.');

  // Compared with an earlier attempt at this climb: the headline, plus the main thing that changed.
  const cmp = rep.comparison;
  if (cmp) {
    lines.push(`Compared with your earlier attempt: ${lower1(cmp.headline)}`);
    if (!simple) {
      const up = cmp.better.find((x) => !x.key.startsWith('fall:')), down = cmp.worse.find((x) => !x.key.startsWith('fall:'));
      if (up || down) lines.push([up ? `Better: ${lower1(up.text.split(':')[0])}` : null, down ? `worse: ${lower1(down.text.split(':')[0])}` : null].filter(Boolean).join('; ').replace(/^./, (c) => c.toUpperCase()) + '.');
    }
  }

  const good = rep.strengths.find((s) => s.tag === 'fixed') || rep.strengths.find((s) => s.tag !== 'steady') || rep.strengths[0];
  if (good) {
    if (good.key === 'habits') {
      const what = good.keys.map((k) => PLAIN[k]).filter(Boolean).slice(0, 2).join(' and ');
      lines.push(simple ? `You're still great at ${what}.` : `Still going well: ${what}.`);
    } else {
      const what = PLAIN[good.key] || lower1(good.label);
      lines.push(good.tag === 'fixed' ? `You fixed ${what} since last time. Well done!` : simple ? `You were great at ${what}.` : `Best part: ${what}${expert && isNum(good.score) ? ` (${good.score}/100)` : ''}.`);
    }
  }

  const plan = rep.actionPlan;
  const focusText = (p) => (p.key?.startsWith('fall:') ? 'the move you came off' : (p.key && PLAIN[p.key]) || lower1(p.title));
  if (plan[0]) {
    const p = plan[0];
    const how = firstSentence(p.doThis);
    lines.push(simple ? `Next time, try this: ${how}` : `Most important next time: ${focusText(p)}. ${how}`);
  } else if (!rep.improvements.length) lines.push('Nothing stood out as a clear weakness. Keep climbing like this.');
  if (!simple && plan[1]) lines.push(`After that: ${focusText(plan[1])}${plan[2] ? `, then ${focusText(plan[2])}` : ''}.`);

  if (!simple && rep.sinceLastHeadline) lines.push(rep.sinceLastHeadline);
  if (expert && isNum(rep.overall)) lines.push(`Technique score ${rep.overall}/100 (${scoreLabel(rep.overall).toLowerCase()}); tracking reliability ${rep.reliability.level}.`);
  if (rep.reliability.level === 'low') lines.push(simple ? 'The video was hard to read, so take this as a rough guide.' : 'The tracking was weak on this video, so treat these points as rough.');
  return { coach: c.id, name: c.name, role: c.role, lines };
}

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

// history: earlier saved sessions ({ createdAt, report }), used to vary the coaching.
// coach: which coach presents it (see COACHES). venue: 'outdoor' | 'indoor'.
// compareWith: an earlier attempt at the same climb (a saved session) to compare against.
// outcome: the result the climber set by hand for this climb ('sent' | 'fell' | 'attempt'), if any.
export function coach(result, { history, coach: coachId = 'rowan', venue = result.venue || null, compareWith = null, outcome: userOutcome = null } = {}) {
  const m = result.metrics;
  const moves = result.moves || [];
  const H = historyIndex(history);
  const items = [];
  for (const def of METRIC_DEFS) {
    const v = m[def.key];
    const s = isNum(v) ? def.score(v) : null;
    const flagged = MOVE_FLAGS[def.key] ? moves.filter(MOVE_FLAGS[def.key]).map((mv) => mv.n) : [];
    // Each earlier climb that flagged this moves on to the next cue and drill.
    const times = H.flagged(def.key);
    items.push({
      key: def.key, category: def.category, label: def.label, value: v,
      display: isNum(v) ? def.format(v) : '—', score: s, info: !!def.info,
      what: def.what, why: def.why, cue: pick(def.cues, times), drill: pick(def.drills, times), seenBefore: times,
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
  let noted = 0;
  for (const it of [...items].sort((a, b) => a.score - b.score)) {
    if (it.info || !isNum(it.score) || it.score >= 50) continue;
    it.history = trendNote(it, H, noted);
    if (it.history) noted++;
  }

  const lastFlagged = (key) => (H.last?.improvements || []).some((x) => x.key === key);
  const lastScore = (key) => H.last?.items?.find((i) => i.key === key)?.score;
  const strengths = [], improvements = [];
  for (const it of items) {
    if (!isNum(it.score)) continue;
    if (it.score >= 70) {
      // A fix is news; a strength seen on the last few climbs only needs a line.
      const run = H.strongStreak(it.key);
      let text = it.text, tag = null;
      if (lastFlagged(it.key) && isNum(lastScore(it.key))) {
        tag = 'fixed';
        text = `Fixed since your last climb (score ${lastScore(it.key)} → ${it.score}). ${it.text}`;
      } else if (run >= 2) tag = 'steady';
      strengths.push({ key: it.key, label: it.label, score: it.score, text, tag, run, display: it.display, confidence: it.confidence });
    } else if (it.score < 50) {
      const evidence = it.moves.length && moves.length ? ` Seen on ${plural(it.moves.length, 'move')}: ${list(it.moves)}.` : '';
      const hedge = it.confidence === 'low' ? 'Possibly: ' : '';
      improvements.push({ key: it.key, label: it.label, score: it.score, text: hedge + it.text + evidence, drill: it.drill, cue: it.cue, why: it.why, target: it.target, moves: it.moves, confidence: it.confidence, history: it.history, seenBefore: it.seenBefore });
    }
  }
  // Fixed ones first, then the strongest; habits you've had for a while go last.
  const tagOrder = { fixed: 0, null: 1, steady: 2 };
  strengths.sort((a, b) => tagOrder[a.tag] - tagOrder[b.tag] || b.score - a.score);
  // Strengths you've had on the last few climbs are habits: one line for all of them.
  const steady = strengths.filter((x) => x.tag === 'steady');
  if (steady.length) {
    strengths.splice(strengths.indexOf(steady[0]), steady.length, {
      key: 'habits', label: steady.length === 1 ? `${steady[0].label}: still a strength` : 'Still strengths', score: Math.min(...steady.map((x) => x.score)), tag: 'steady', keys: steady.map((x) => x.key),
      text: (() => {
        const sameRun = steady.every((x) => x.run === steady[0].run);
        const names = steady.map((x) => `${x.label.toLowerCase()} (${x.display}${sameRun ? '' : `, ${x.run + 1} climbs running`})`);
        const joined = (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]).replace(/^./, (c) => c.toUpperCase());
        const when = sameRun ? ` on each of your last ${steady[0].run + 1} climbs` : '';
        return `${joined}: ${steady.length === 1 ? 'a strength' : 'all strengths'}${when}. ${steady.length === 1 ? 'It\'s' : 'These are'} habits now, so there's nothing to change.`;
      })(),
    });
  }
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
  const extraInsights = extraAnalysis(result, m, H);

  // How it ended, and a breakdown of every fall.
  const outcome = result.outcome || null;
  const fallAnalyses = [];
  for (const [k, f] of (result.falls || []).entries()) fallAnalyses.push(describeFall(f, k, result, H, fallAnalyses, venue));

  // Other observations (not scored).
  const notes = [];
  if (m.rests > 0) {
    notes.push(m.restStraightArm > 0
      ? `You took ${plural(m.rests, 'proper rest')} (4 s or longer), ${m.restStraightArm} of them on straight arms.`
      : `You took ${plural(m.rests, 'rest')} of 4 s or longer, but with bent arms, which recovers much less. ${pick([
        'Straighten the arm, sink the hips and alternate hands every few seconds.',
        'A rest only works on a straight arm: move your feet until the holding arm can hang long, then swap hands every 5–10 s.',
        'If you can\'t straighten the arm where you stopped, that spot isn\'t a rest. Look for a bigger hold or a better foot before stopping.',
      ], H.n)}`);
  } else if (m.climbTime > 60) {
    notes.push(`You climbed for ${Math.round(m.climbTime)} s without a proper rest. ${pick([
      'Plan a shake-out on the best hold before the hardest section.',
      'Before your next go, pick one hold from the ground where you\'ll stop and shake out.',
      'Even 5 seconds per hand on a good hold before the crux makes a difference.',
    ], H.n)}`);
  }
  const turn = items.find((i) => i.key === 'turnedShare');
  if (turn && isNum(turn.value)) notes.push(turn.value >= 0.08 ? turn.text : `${turn.text} ${turn.cue}`);
  if (m.dynos > 0) notes.push(`${plural(m.dynos, 'dynamic move')} detected (fast upward body motion).`);
  if (m.scaleCompensated && Math.abs((m.scaleChange || 1) - 1) >= 0.2) {
    const pc = Math.round(Math.abs(m.scaleChange - 1) * 100);
    notes.push(`You looked about ${pc}% ${m.scaleChange < 1 ? 'smaller' : 'bigger'} on screen by the end of the climb, which is normal when you climb ${m.scaleChange < 1 ? 'away from' : 'toward'} the camera. All measurements were rescaled to your body size, so they're not affected.`);
  }

  const actionPlan = buildActionPlan(improvements, sectionInsights, sideInsights, extraInsights, fallAnalyses, H);
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
  const sinceLast = changesSinceLast(items, categories, overall, H);
  if (bestCat && worstCat && bestCat[0] !== worstCat[0]) {
    const run = H.streak((r) => worstCategory(r.categories) === worstCat[0]);
    const again = run >= 1 ? ` again (${run + 1} climbs running)` : '';
    parts.push(`Technique ${overall}/100: strongest in ${bestCat[1].label.toLowerCase()}, weakest in ${worstCat[1].label.toLowerCase()}${again}.`);
  } else if (bestCat) parts.push(`Technique ${overall}/100.`);
  if (sinceLast.headline) parts.push(sinceLast.headline);
  if (m.trackQuality === 'low') parts.push('Tracking quality was low, so treat these results as rough.');
  const summary = parts.join(' ') || 'Not enough of your body was tracked to score this climb.';

  const reliability = reliabilityCheck(m, moves.length, result);
  const movement = movementAnalysis(result.labels, H);

  const rep = { overall, categories, items, strengths, improvements, notes, summary, actionPlan, moveReview, movePatterns: movePatternsList, moveSummary, sectionInsights, sideInsights, extraInsights, outcome, fallAnalyses, reliability, movement, sinceLast: sinceLast.list, sinceLastHeadline: sinceLast.headline, venue, coach: COACHES[coachId] ? coachId : 'rowan' };
  if (compareWith) {
    rep.comparison = compareAttempts(
      { analysis: result, report: rep, outcome: userOutcome },
      { analysis: compareWith.analysis, report: compareWith.report, outcome: compareWith.outcomeSource === 'user' ? compareWith.outcome : null, id: compareWith.id, name: compareWith.name, createdAt: compareWith.createdAt },
    );
  }
  rep.take = coachTake(rep, rep.coach);
  return rep;
}

// What changed since the previous climb: fixes, new problems and big moves in each area.
function changesSinceLast(items, categories, overall, H) {
  const L = H.last;
  if (!L) return { list: [], headline: null };
  const list = [];
  const wasFlagged = (key) => (L.improvements || []).some((x) => x.key === key);
  for (const it of items) {
    const before = L.items?.find((i) => i.key === it.key)?.score;
    if (it.info || !isNum(it.score) || !isNum(before)) continue;
    if (wasFlagged(it.key) && it.score >= 60) list.push({ kind: 'fixed', key: it.key, d: it.score - before, text: `${it.label}: fixed (${before} → ${it.score}).` });
    else if (!wasFlagged(it.key) && before >= 60 && it.score < 50) list.push({ kind: 'slipped', key: it.key, d: it.score - before, text: `${it.label}: slipped (${before} → ${it.score}).` });
  }
  for (const [key, c] of Object.entries(categories)) {
    const before = L.categories?.[key]?.score;
    if (!isNum(c.score) || !isNum(before) || Math.abs(c.score - before) < 8) continue;
    const d = c.score - before;
    list.push({ kind: d > 0 ? 'up' : 'down', key, d, text: `${c.label} ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} points (${before} → ${c.score}).` });
  }
  const fixed = list.filter((x) => x.kind === 'fixed');
  const up = list.filter((x) => x.kind === 'up').sort((a, b) => b.d - a.d)[0];
  const down = list.filter((x) => x.kind === 'down').sort((a, b) => a.d - b.d)[0];
  let headline = null;
  const lbl = (x) => (categories[x.key]?.label || '').toLowerCase();
  if (fixed.length) headline = `Since your last climb, ${fixed.map((x) => items.find((i) => i.key === x.key).label.toLowerCase()).join(' and ')} ${fixed.length > 1 ? 'are' : 'is'} no longer a problem.`;
  else if (up && down) headline = `Compared with your last climb, ${lbl(up)} went up ${up.d} points but ${lbl(down)} dropped ${-down.d}.`;
  else if (up) headline = `Compared with your last climb, ${lbl(up)} went up ${up.d} points.`;
  else if (down) headline = `Compared with your last climb, ${lbl(down)} dropped ${-down.d} points.`;
  else if (isNum(overall) && isNum(L.overall)) headline = Math.abs(overall - L.overall) <= 3 ? 'Very similar to your last climb overall.' : null;
  return { list, headline };
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

function movementAnalysis(labels, H) {
  if (!labels) return null;
  const f = labels.fluency, rep = labels.repertoire;
  const insights = [];
  // Advice for an insight seen on earlier climbs moves on to the next wording.
  const seen = (kind) => H.count((r) => (r.movement?.insights || []).some((x) => x.kind === kind));
  const pc = (v) => `${Math.round((v || 0) * 100)}%`;
  if (f.handProbes >= 2 || (f.share.hold_exploration || 0) >= 0.15) {
    insights.push({
      kind: 'exploring', title: 'A lot of exploring',
      text: `You touched ${plural(f.handProbes, 'hold')} with a hand and let go again without using ${f.handProbes === 1 ? 'it' : 'them'}${f.footProbes ? `, and tested ${plural(f.footProbes, 'foothold')}` : ''}. ${pc(f.share.hold_exploration)} of your time was exploring, against ${pc(f.share.hold_change)} actually moving between holds.`,
      advice: pick([
        'That\'s normal when you don\'t know a route yet. A route-previewing study (PLOS ONE, 2017) linked reading the route beforehand with fewer and shorter stops. Before you start, name each hold you\'ll use, in order, and which hand takes it.',
        'Probing is information-gathering done on your arms. Do more of it from the ground: look at each hold\'s shape and angle and decide how you\'ll grip it before you leave the floor.',
        'If you have to test a hold, test it from a straight arm and commit quickly to your first choice. Most probes on this climb ended back on the hold you started from.',
      ], seen('exploring')),
    });
  }
  if (f.stops >= 3) {
    insights.push({
      kind: 'stops', title: `${f.stops} stops`,
      text: `You came to a complete stop ${f.stops} times (1 s or longer, ${f1(f.stopAvg)} s on average, ${f1(f.stopTotal)} s in total).`,
      advice: pick([
        'Some stops are planned rests, which is fine. The costly ones are mid-sequence stops on poor holds. Compare them with the rests in the timeline below, and plan where you\'ll stop before you start.',
        'Check each stop in the timeline: was it on a good hold with a straight arm? If not, it cost strength without giving any back. Move those stops to the nearest good hold.',
      ], seen('stops')),
    });
  }
  if ((f.share.postural_regulation || 0) >= 0.2) {
    insights.push({
      kind: 'adjusting', title: 'Lots of body adjusting',
      text: `${pc(f.share.postural_regulation)} of your time was spent shifting your body while all four limbs stayed put.`,
      advice: pick([
        'This is usually searching for balance before a move. Set your hip position deliberately (over the foot you\'ll push from) and then commit, rather than shuffling until it feels right.',
        'Try deciding the body position during the previous move, so you arrive already set up. Adjusting after arriving is time spent gripping.',
      ], seen('adjusting')),
    });
  }
  if (f.upMoves >= 3 && f.controlledMoves / f.upMoves < 0.6) {
    insights.push({
      kind: 'reaching', title: 'Reaching without the body following',
      text: `On ${f.upMoves - f.controlledMoves} of ${f.upMoves} upward hand moves your body didn't rise along with the move. The hand went up, but your centre of mass stayed where it was.`,
      advice: pick([
        'In a controlled move the body rises from the legs as the hand travels (the IFSC definition of a controlled move is exactly this: centre of mass rising while the hand moves to the next hold). Start each move by driving the hips up, and let the hand arrive at the top of that motion.',
        'Reaching from a stationary body means the arm has to span the whole gap. Start the push from your feet a split second before the hand leaves, and the hold comes to you.',
      ], seen('reaching')),
    });
  }
  if (!insights.length) insights.push({ kind: 'efficient', title: 'Efficient movement pattern', text: `Most of your time went into moving between holds (${pc(f.share.hold_change)}) and pulling/pushing up (${pc(f.share.hold_traction)}), with little exploring and few stops.`, advice: '' });

  // Repertoire: what was seen (with how sure), and what might help on this terrain.
  const seenMoves = [];
  const addSeen = (n, label, conf) => { if (n > 0) seenMoves.push({ label, n, conf }); };
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
    // Lead with a different terrain tip each climb on the same terrain.
    suggestions.push(...rotate(tt.tips, H.count((r) => r.movement?.terrain === terrain)));
  } else if (H.count((r) => (r.movement?.suggestions || []).some((x) => x.startsWith('Set the terrain'))) < 2) {
    suggestions.push('Set the terrain (slab, vertical, overhang, …) when you analyse a climb to get advice specific to the rock angle.');
  }
  return {
    share: f.share, fluency: f, insights, seen: seenMoves, suggestions, terrain,
    caveat: 'These are observations of what your body did, not a measure of skill. Movement labels come from body-position rules on a single camera view, and each carries a confidence level.',
  };
}

// ---------- falls ----------

const fmtClock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// Some fixes differ between rock and gym walls ({ outdoor, indoor }); unknown venue gets the outdoor text.
const forVenue = (x, venue) => (typeof x === 'string' ? x : venue === 'indoor' ? x.indoor : x.outdoor);

function describeFall(f, k, result, H, earlier = [], venue = null) {
  const causes = f.causes.map((c) => {
    const def = FALL_CAUSES[c.key] || FALL_CAUSES.unclear;
    return { ...c, ...def, fixes: def.fixes.map((x) => forVenue(x, venue)) };
  });
  // Lead with the most solid explanation; keep weaker ones as "also possible".
  const primary = causes[0] || null;
  // The same cause on earlier climbs (or earlier in this one) is a pattern: say so, lead with
  // a different fix and give a different drill, rather than the same card again.
  let pattern = null;
  if (primary && primary.key !== 'unclear') {
    const before = H.count((r) => (r.fallAnalyses || []).some((x) => x.primary?.key === primary.key));
    const here = earlier.filter((x) => x.primary?.key === primary.key);
    const turn = before + here.length;
    if (turn) {
      primary.fixes = rotate(primary.fixes, turn);
      primary.drill = pick([primary.drill, ...(primary.moreDrills || [])], turn);
      // The short cue has been given already: focus on the fix that now leads the list.
      primary.cue = primary.fixes[0];
    }
    if (here.length) primary.why = `Same mechanism as Fall ${here[0].n} above.`;
    if (before) pattern = `This is the ${ordinal(before + 1)} climb where you've come off this way, so it's a pattern rather than bad luck. The fixes below start from a different one and the drill has changed, so work on the first fix specifically.`;
  }
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
  next.push(pick([
    'Once the move goes on its own, link it from the start. Keep it to 3–4 tries, then rest 5 minutes or more: tired attempts rehearse bad habits.',
    'When it goes in isolation, add one move before it, then two, until you can link it from the start. Rest properly between goes: quality attempts beat quantity.',
    'Stop working it once your attempts get worse rather than better. Come back fresh: moves you\'ve rehearsed often go first try on another day.',
  ], H.n + k));
  return {
    n: k + 1, t: f.t, clock: fmtClock(f.t), drop: f.drop, move: f.move, stick: f.stick, lost: f.lost,
    headline: `Fall ${k + 1} at ${fmtClock(f.t)}${where}`,
    detail: `You dropped about ${metres(f.drop)}${stickTxt}`,
    primary, secondary, nextAttempt: next, replay: f.replay, pattern,
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

function extraAnalysis(result, m, H) {
  const out = [];
  const moves = result.moves || [];
  const ex = result.extras || {};
  // How many earlier climbs showed the same observation: each one moves the advice on.
  const n = (title) => H.count((r) => (r.extraInsights || []).some((x) => x.title === title));
  if (m.feetCuts > 0) {
    const cutMoves = moves.filter((x) => x.cut).map((x) => x.n);
    out.push({
      kind: 'feetCuts', title: 'Feet cutting loose', priority: 50 + m.feetCuts * 5,
      text: `Your feet came off the rock ${plural(m.feetCuts, 'time')}${cutMoves.length ? ` (on move ${list(cutMoves)})` : ''}. Every cut means a swing you have to hold with your arms.`,
      advice: pick([
        'Keep your core tight and actively pull your toes toward you on the footholds, especially on steep rock and long reaches.',
        'Feet usually cut when the hips swing away from the wall during a reach. Keep the hips close and the heels slightly raised so the toes can press in.',
        'Pick footholds for the direction you\'re moving: when reaching right, load a foot that pushes left, so it opposes the swing.',
      ], n('Feet cutting loose')),
      drill: pick([
        'Drill: "Toe hooks and toe pulls". On an overhang, practise moves while consciously pulling with your toes. If your feet cut, repeat the move.',
        'Drill: "Feet stay on". On a steep boulder below your limit, any foot coming off means starting again. Do it until you get three clean runs.',
      ], n('Feet cutting loose')),
    });
  }
  if (m.highSteps > 0) {
    out.push({ kind: 'highSteps', title: 'High steps', text: `You used ${plural(m.highSteps, 'high step')}. High feet let you push up instead of pulling. Nice.`, advice: pick([
      'Keep looking for them, especially before long reaches.',
      'To get more out of them, sink your hips toward the heel of the high foot before you stand up, so the leg does the lifting.',
      'Next step: use them on your less-used leg too. Check the left vs right section to see which leg you favour.',
    ], n('High steps')) });
  } else if (moves.length >= 5) {
    out.push({ kind: 'highSteps', title: 'No high steps', text: 'You didn\'t use any high steps (a foot brought up to around hip height).', advice: pick([
      'On vertical rock, bringing a foot high and rocking over it is often easier than pulling. Look for a high foothold before each long reach.',
      'Before every move longer than your arm, check for a foothold at knee-to-hip height that you could rock onto.',
      'Hip mobility limits high steps. A couple of minutes of deep squats and frog stretches before climbing makes them much easier.',
    ], n('No high steps')) });
  }
  if (m.shakeOuts > 0) {
    out.push({ kind: 'shakeOuts', title: 'Shake-outs and chalking', text: `You dropped a hand to shake out or chalk ${plural(m.shakeOuts, 'time')}.`, advice: pick([
      'Do it on good holds with a straight arm, and shake out each hand for a few seconds, not just a quick dip.',
      'Let the resting arm hang below your heart for 5–10 s and swap hands a few times. One quick dip barely helps.',
      'Use the moment to read the next moves: look ahead while you shake, so you leave the rest knowing the sequence.',
    ], n('Shake-outs and chalking')) });
  } else if (m.climbTime > 45) {
    out.push({ kind: 'shakeOuts', title: 'No shake-outs', text: `You never dropped a hand to shake out or chalk during ${Math.round(m.climbTime)} s of climbing.`, advice: pick([
      'On longer climbs, shake out on the good holds before you get pumped, not after.',
      'Pick your shake-out holds from the ground, just like you pick your moves.',
      'Practise shaking out on easy routes, even when you don\'t need to, so it becomes automatic when you do.',
    ], n('No shake-outs')) });
  }
  if (isNum(m.stanceWidth)) {
    if (m.stanceWidth < 0.35) out.push({ kind: 'stance', title: 'Narrow stance', text: `Your feet were usually close together (${f1(m.stanceWidth)} torso lengths apart).`, advice: pick([
      'A slightly wider stance gives you a more stable base and makes it easier to shift your hips over either foot.',
      'With your feet together, any reach to the side swings you. Put one foot out wide in the direction you\'re reaching.',
    ], n('Narrow stance')) });
    else if (m.stanceWidth > 1.3) out.push({ kind: 'stance', title: 'Very wide stance', text: `Your feet were often very far apart (${f1(m.stanceWidth)} torso lengths).`, advice: pick([
      'Wide stems are great for resting in corners, but on a face they make it hard to move. Bring your feet under you more.',
      'From a wide stance your hips can\'t get over either foot. Bring one foot in toward your centre before moving up.',
    ], n('Very wide stance')) });
  }
  if (isNum(m.avgSetup) && moves.length >= 3) {
    const slow = m.avgSetup > 3;
    out.push({ kind: 'pace', title: 'Pace', text: `You averaged ${f1(m.avgSetup)} s between arriving at one hold and leaving for the next, and made ${f1(m.movesPerMin || 0)} hand moves per minute.`, advice: slow ? pick([
      'That\'s quite slow. Unless you\'re resting, aim to keep moving: time on the wall costs grip even when you\'re standing still.',
      'Slow is fine on good holds, costly on bad ones. Try to move quickly through the poor holds and slow down only on the good ones.',
    ], H.count((r) => (r.extraInsights || []).some((x) => x.kind === 'pace' && /slow/i.test(x.advice || '')))) : pick([
      'That\'s a good, steady pace.',
      'Steady pace again: you\'re not wasting time on holds.',
    ], n('Pace')) });
  }
  return out;
}

// ---------- action plan ----------

const PRIORITY_WEIGHT = { footwork: 1.1, arms: 1.05, body: 1, flow: 0.95 };

function buildActionPlan(improvements, sectionInsights, sideInsights, extraInsights, fallAnalyses = [], H = historyIndex([])) {
  // Low-confidence findings stay out of the plan unless there's nothing better.
  const solid = improvements.filter((i) => i.confidence !== 'low');
  const pool = solid.length ? solid : improvements;
  const cands = pool.map((i) => ({
    // Core technique (feet, arms) comes before flow when problems are equally bad.
    key: i.key, title: i.label, confidence: i.confidence, priority: (100 - i.score) * (PRIORITY_WEIGHT[METRIC_DEFS.find((d) => d.key === i.key)?.category] || 1),
    // Why it matters has been explained on at least two earlier climbs: the trend replaces it.
    saw: i.text, why: i.seenBefore >= 2 && i.history ? null : i.why, history: i.history, doThis: i.cue, drill: i.drill, target: i.target, moves: i.moves,
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
  const inPlan = (title) => H.count((r) => (r.actionPlan || []).some((p) => p.title === title));
  if (fade) cands.push({ title: 'Staying efficient when tired', priority: 55, saw: fade.text, why: 'Most falls happen in the last third of a route, when technique slips under fatigue.', doThis: fade.advice, drill: pick([
    'Drill: "Pump laps". Climb an easy route 3 times in a row without resting, focusing on perfect straight arms and footwork on the last lap.',
    'Drill: "Tired technique". At the end of a session, climb two easy routes while focusing on one thing only (straight arms or feet first). That\'s when the habit counts.',
    'Drill: "4×4s". Four easy boulders back-to-back, four rounds, with 3 minutes between rounds. Keep the footwork clean even on the last one.',
  ], inPlan('Staying efficient when tired')), target: 'Keep straight arms and feet-first at the same level in the top third as at the start.' });
  const cuts = extraInsights.find((x) => x.kind === 'feetCuts');
  if (cuts) cands.push({ title: 'Keeping your feet on', priority: cuts.priority, saw: cuts.text, why: inPlan('Keeping your feet on') >= 2 ? null : 'Feet cutting loose throws all your weight onto your fingers at once. It\'s one of the most common reasons to fall off a hold you actually reached.', doThis: cuts.advice, drill: cuts.drill, target: 'No feet cutting loose on routes at or below your level.' });
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
