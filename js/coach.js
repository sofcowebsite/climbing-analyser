// Turns raw metrics into scores (0-100) and plain-language coaching.
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

// Each metric definition: how to score it, what it means, and what to say.
export const METRIC_DEFS = [
  {
    key: 'footHandRatio', category: 'footwork', label: 'Feet per hand move',
    format: (v) => f1(v), score: (v) => scale(v, 0.4, 1.1),
    what: 'How many times you moved a foot for every hand move.',
    good: (v, m) => `You made ${m.footMoves} foot moves for ${m.handMoves} hand moves (${f1(v)} per hand move). Moving your feet this often means your legs are doing the pushing.`,
    bad: (v, m) => `You moved your feet ${m.footMoves} times but your hands ${m.handMoves} times (${f1(v)} feet per hand move). Climbers who move efficiently usually move their feet at least as often as their hands. High feet let you push up with your legs instead of pulling with your arms.`,
    drill: 'Drill: "Two feet per hand". On routes well below your limit, make at least two foot moves before every hand move, even small ones to better footholds.',
  },
  {
    key: 'footReadjustRate', category: 'footwork', label: 'Foot readjustments',
    format: (v) => `${f1(v)} per placement`, score: (v) => scale(v, 0.8, 0.1),
    what: 'How often a foot shuffled again shortly after being placed. Lower is better ("quiet feet").',
    good: (v) => `Your feet mostly stayed where you put them (${f1(v)} readjustments per placement). That's precise, quiet footwork.`,
    bad: (v, m) => `Your feet were readjusted ${f1(v)} times per placement. Shuffling a foot after placing it wastes energy and usually means you looked away from the foothold too early.`,
    drill: 'Drill: "Silent feet". Climb easy routes placing every foot without a sound and without moving it again. Watch the foothold until your toe is on it.',
  },
  {
    key: 'straightArmRatio', category: 'arms', label: 'Straight arms when static',
    format: pct, score: (v) => scale(v, 0.15, 0.7),
    what: 'Of the moments you were holding still, the share spent hanging on straight arms (elbow 145° or more).',
    good: (v) => `You held still on straight arms ${pct(v)} of the time. Hanging off your skeleton rather than your biceps saves a lot of energy.`,
    bad: (v) => `Only ${pct(v)} of your static moments were on straight arms. Holding on with bent arms makes your biceps and forearms do the work and pumps you out fast.`,
    drill: 'Drill: "Straight-arm traverse". Traverse near the ground keeping your arms straight at all times. Move by bending your legs and turning your hips, not by pulling.',
  },
  {
    key: 'legDrive', category: 'arms', label: 'Leg drive',
    format: pct, score: (v) => scale(v, 0.3, 0.7),
    what: 'Estimated share of your upward movement driven by straightening your legs rather than bending your arms.',
    good: (v) => `About ${pct(v)} of your upward movement came from pushing with your legs. Legs are much stronger than arms, so this is the efficient way to climb.`,
    bad: (v) => `Only about ${pct(v)} of your upward movement came from your legs. The rest was pulling with your arms. Your legs are several times stronger than your arms.`,
    drill: 'Drill: "Hover hands". Before grabbing each new hold, hover your hand over it for one second. You can only do that if your legs and balance are holding you up.',
  },
  {
    key: 'balanceOffset', category: 'body', label: 'Hips over feet',
    format: (v) => `${f1(v)} torso lengths off`, score: (v) => scale(v, 0.9, 0.2),
    what: 'When you were standing still, how far your centre of mass was to the side of your feet. Lower is better on vertical walls.',
    good: (v) => `When you stopped, your hips were well centred over your feet (${f1(v)} torso lengths off). Good balance means less grip needed.`,
    bad: (v) => `When you stopped, your hips were on average ${f1(v)} torso lengths to the side of your feet. When your weight isn't over your feet, your hands have to hold you in, which costs grip strength.`,
    drill: 'Drill: "Hip over foot". Before every move, shift your hips over the foot you\'re about to push from. Try flagging (sticking a leg out to the side as a counterweight) when both feet are on one side.',
  },
  {
    key: 'turnedShare', category: 'body', label: 'Hip turning',
    // Not scored: how much to turn depends on wall angle, which the camera can't see.
    format: pct, score: () => null, info: true,
    what: 'Share of moving time with your body turned side-on to the wall (twist-locks, drop knees, back-steps).',
    good: (v) => `You turned your hips into the wall ${pct(v)} of the time you were moving. Twisting brings your hips close to the wall and extends your reach.`,
    bad: (v) => `You stayed square to the wall almost the whole time (turned only ${pct(v)} of moving time). Turning a hip into the wall (drop knees, back-steps) gives you extra reach and takes weight off your arms, especially on steep walls.`,
    drill: 'Drill: "Outside edge only". On a slightly overhanging route, use the outside edge of your shoe on every foothold. This forces you to turn your hips in.',
  },
  {
    key: 'pathEfficiency', category: 'flow', label: 'Movement efficiency',
    format: pct, score: (v) => scale(v, 0.2, 0.6),
    what: 'Straight-line distance your body travelled divided by the actual path it took. Higher means less wasted movement.',
    good: (v) => `Your body took a direct line up the route (${pct(v)} efficiency), with little wasted movement.`,
    bad: (v) => `Your body travelled about ${f1(1 / Math.max(v, 0.05))}× the straight-line distance up the route. Swinging back and forth or up and down wastes energy.`,
    drill: 'Drill: "Slow motion". Climb a familiar route as slowly and smoothly as you can, keeping your hips moving steadily in one direction.',
  },
  {
    key: 'jerkyPerMin', category: 'flow', label: 'Sudden jolts',
    format: (v) => `${f1(v)} per min`, score: (v) => scale(v, 8, 1),
    what: 'Sudden changes in body speed (lunging, slipping, catching a swing). Lower is smoother.',
    good: (v) => `Your movement was smooth, with only ${f1(v)} sudden jolts per minute.`,
    bad: (v) => `You had ${f1(v)} sudden jolts per minute: sharp lunges, slips or swings you had to catch. Controlled movement is safer and saves energy.`,
    drill: 'Drill: "Deadpoint practice". On easy terrain, practise moving to a hold so you arrive at the top of your motion, when your body is weightless. Grab it softly, with no slap.',
  },
  {
    key: 'hesitationsPerMin', category: 'flow', label: 'Hesitations',
    format: (v) => `${f1(v)} per min`, score: (v) => scale(v, 4, 0.5),
    what: 'Short stops of 1–4 seconds mid-route. These are usually unplanned pauses to work out the next move.',
    good: (v) => `You kept moving steadily, with ${f1(v)} hesitations per minute. That looks like you read the route well.`,
    bad: (v, m) => `You hesitated ${m.hesitations} times (${f1(v)} per minute). Stopping while you're still on your arms to work out the next move burns strength without resting.`,
    drill: 'Drill: "Route reading". Before you start, point out every hand move from the ground and mime the sequence. Then climb it without stopping, even if a move turns out wrong.',
  },
  {
    key: 'handReadjustRate', category: 'flow', label: 'Grip readjustments',
    format: (v) => `${f1(v)} per hand move`, score: (v) => scale(v, 0.8, 0.1),
    what: 'How often a hand shuffled on a hold after grabbing it. Lower means more precise hand placement.',
    good: (v) => `You grabbed holds precisely (${f1(v)} readjustments per hand move).`,
    bad: (v) => `You readjusted your grip ${f1(v)} times per hand move. Re-gripping costs strength and time.`,
    drill: 'Drill: "One touch". Look at the exact spot on the hold you want to grab and grab it once, in the right place. If you touch a hold, you have to use it as you first grabbed it.',
  },
];

export const CATEGORIES = {
  footwork: { label: 'Footwork', blurb: 'How much your feet move and how precisely you place them.' },
  arms: { label: 'Arm efficiency', blurb: 'Hanging on straight arms and pushing with your legs.' },
  body: { label: 'Body position', blurb: 'Hips over feet, and turning into the wall.' },
  flow: { label: 'Flow', blurb: 'Smooth, direct and decisive movement.' },
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

// Builds the full coaching report from analyze() output.
export function coach(result) {
  const m = result.metrics;
  const items = [];
  for (const def of METRIC_DEFS) {
    const v = m[def.key];
    const s = isNum(v) ? def.score(v) : null;
    items.push({ key: def.key, category: def.category, label: def.label, value: v, display: isNum(v) ? def.format(v) : '—', score: s, what: def.what, info: !!def.info });
  }

  const categories = {};
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const scored = items.filter((i) => i.category === key && isNum(i.score));
    let wsum = 0, sum = 0;
    for (const i of scored) { wsum += 1; sum += i.score; }
    categories[key] = { label: cat.label, blurb: cat.blurb, score: wsum ? Math.round(sum / wsum) : null };
  }
  const catScores = Object.values(categories).map((c) => c.score).filter(isNum);
  const overall = catScores.length ? Math.round(catScores.reduce((a, b) => a + b, 0) / catScores.length) : null;

  const strengths = [], improvements = [];
  for (const def of METRIC_DEFS) {
    const it = items.find((i) => i.key === def.key);
    if (!isNum(it.score)) continue;
    if (it.score >= 70) strengths.push({ key: def.key, label: def.label, score: it.score, text: def.good(it.value, m) });
    else if (it.score < 50) improvements.push({ key: def.key, label: def.label, score: it.score, text: def.bad(it.value, m), drill: def.drill });
  }
  strengths.sort((a, b) => b.score - a.score);
  improvements.sort((a, b) => a.score - b.score);

  // Extra observations that are not scored.
  const notes = [];
  if (m.rests > 0) {
    notes.push(m.restStraightArm > 0
      ? `You took ${m.rests} proper rest${m.rests > 1 ? 's' : ''} (4 s or longer), ${m.restStraightArm} of them on straight arms. That's good energy management.`
      : `You took ${m.rests} rest${m.rests > 1 ? 's' : ''} of 4 s or longer, but with bent arms. When resting, straighten your arms and shake out one hand at a time.`);
  }
  const turn = METRIC_DEFS.find((d) => d.key === 'turnedShare');
  if (isNum(m.turnedShare)) {
    notes.push(m.turnedShare >= 0.08
      ? turn.good(m.turnedShare, m)
      : `${turn.bad(m.turnedShare, m)} ${turn.drill}`);
  }
  if (m.cameraMoved) notes.push('The camera moved during the video. The app compensated by tracking the rock in the background, but a fixed camera gives the most accurate results.');
  if (m.dynos > 0) notes.push(`${m.dynos} dynamic move${m.dynos > 1 ? 's were' : ' was'} detected (fast upward body motion).`);
  if (m.falls > 0) notes.push(`A fall or big drop was detected. The analysis covers the climbing up to your high point.`);

  const cats = Object.entries(categories).filter(([, c]) => isNum(c.score));
  const best = [...cats].sort((a, b) => b[1].score - a[1].score)[0];
  const worst = [...cats].sort((a, b) => a[1].score - b[1].score)[0];
  let summary = 'Not enough of your body was tracked to score this climb.';
  if (best && worst && best[0] !== worst[0]) {
    summary = `Your strongest area was ${best[1].label.toLowerCase()} (${best[1].score}). The biggest opportunity is ${worst[1].label.toLowerCase()} (${worst[1].score}).`;
  } else if (best) {
    summary = `Overall ${scoreLabel(best[1].score).toLowerCase()} climbing in ${best[1].label.toLowerCase()}.`;
  }
  if (improvements[0]) summary += ` Focus next on: ${improvements[0].label.toLowerCase()}.`;

  return { overall, categories, items, strengths, improvements, notes, summary };
}
