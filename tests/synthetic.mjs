// Generates a synthetic climber (33 MediaPipe-style landmarks per frame) for tests.
// Units: y in [0,1] (image height), x in [0, aspect].

function ik(root, end, l1, l2, bendDir) {
  const dx = end[0] - root[0], dy = end[1] - root[1];
  let d = Math.hypot(dx, dy);
  const maxD = l1 + l2 - 1e-6;
  const ux = dx / (d || 1), uy = dy / (d || 1);
  if (d > maxD) d = maxD;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const px = root[0] + ux * a, py = root[1] + uy * a;
  return [px - uy * h * bendDir, py + ux * h * bendDir];
}

const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// style: { feetPerHand: 1|2|0.5, bentArms: bool, noise: number, fps, cycles }
export function makeClimb(style = {}) {
  const { fps = 10, cycles = 8, noise = 0.002, bentArms = false, feetFirst = true, seed = 1 } = style;
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s / 2147483647 - 0.5) * 2; };
  const T = 0.12, aspect = 0.5625, cx = aspect / 2;
  const cycleSec = 3;
  const dur = cycles * cycleSec + 2;
  const frames = [];
  const truth = [];
  // State of holds (world y, smaller is higher).
  let hipY = 0.8;
  const hands = { l: [cx - 0.35 * T, hipY - 2.0 * T], r: [cx + 0.35 * T, hipY - 2.2 * T] };
  const feet = { l: [cx - 0.3 * T, hipY + 1.4 * T], r: [cx + 0.3 * T, hipY + 1.4 * T] };
  const plan = [];
  for (let c = 0; c < cycles; c++) {
    const hand = c % 2 ? 'l' : 'r';
    const t0 = 1 + c * cycleSec;
    if (feetFirst) {
      plan.push({ limb: 'foot', side: 'r', t0, t1: t0 + 0.6, dy: -0.45 * T });
      plan.push({ limb: 'foot', side: 'l', t0: t0 + 0.7, t1: t0 + 1.3, dy: -0.45 * T });
    } else if (c % 2 === 0) {
      plan.push({ limb: 'foot', side: 'r', t0, t1: t0 + 0.6, dy: -0.9 * T });
    }
    plan.push({ limb: 'body', t0: t0 + 1.4, t1: t0 + 2.1, dy: -0.45 * T });
    plan.push({ limb: 'hand', side: hand, t0: t0 + 2.2, t1: t0 + 2.8, dy: -0.9 * T });
  }
  const start = { hands: JSON.parse(JSON.stringify(hands)), feet: JSON.parse(JSON.stringify(feet)), hipY };
  for (let i = 0; i <= dur * fps; i++) {
    const t = i / fps;
    const H = JSON.parse(JSON.stringify(start.hands)), F = JSON.parse(JSON.stringify(start.feet));
    let hy = start.hipY;
    for (const p of plan) {
      const k = ease((t - p.t0) / (p.t1 - p.t0));
      if (p.limb === 'body') hy += p.dy * k;
      else if (p.limb === 'hand') H[p.side][1] += p.dy * k;
      else F[p.side][1] += p.dy * k;
    }
    const shoulderY = hy - T;
    const sl = [cx - 0.22 * T, shoulderY], sr = [cx + 0.22 * T, shoulderY];
    const hl = [cx - 0.15 * T, hy], hr = [cx + 0.15 * T, hy];
    const armL = bentArms ? 0.8 * T : 0.62 * T;
    const el = ik(sl, H.l, armL, armL, -1), er = ik(sr, H.r, armL, armL, 1);
    const wl = bentArms ? H.l : H.l, wr = H.r;
    const kl = ik(hl, F.l, 0.85 * T, 0.85 * T, 1), kr = ik(hr, F.r, 0.85 * T, 0.85 * T, -1);
    const p = new Array(33).fill(0).map(() => [cx, hy, 0.2]);
    const set = (idx, q, v = 0.95) => { p[idx] = [q[0] + rnd() * noise, q[1] + rnd() * noise, v]; };
    set(0, [cx, shoulderY - 0.4 * T]);
    set(11, sl); set(12, sr); set(13, el); set(14, er); set(15, wl); set(16, wr);
    set(23, hl); set(24, hr); set(25, kl); set(26, kr);
    set(27, F.l); set(28, F.r); set(29, [F.l[0] - 0.05 * T, F.l[1] + 0.05 * T]); set(30, [F.r[0] + 0.05 * T, F.r[1] + 0.05 * T]);
    set(31, [F.l[0] - 0.1 * T, F.l[1] + 0.02 * T]); set(32, [F.r[0] + 0.1 * T, F.r[1] + 0.02 * T]);
    if (style.occludeLegs) {
      // Legs hidden behind the body for ~40% of the time: the model reports low visibility
      // and guesses positions pulled toward the hips, with extra jitter.
      const hidden = Math.sin(t * 1.7) > 0.2;
      if (hidden) {
        for (const idx of [25, 26, 27, 28, 29, 30, 31, 32]) {
          const [x, y] = p[idx];
          const hip = idx % 2 ? hl : hr;
          p[idx] = [x + (hip[0] - x) * 0.25 + rnd() * 0.02, y + (hip[1] - y) * 0.25 + rnd() * 0.02, 0.12];
        }
      }
    }
    truth.push(style.occludeLegs ? { lFoot: F.l.slice(), rFoot: F.r.slice() } : null);
    frames.push({ t, p });
  }
  if (style.occludeLegs) frames.truth = truth;
  return frames;
}

// Appends a scripted ending to a climb, for testing finish/fall detection.
// kind: 'missedCatch' | 'footSlip' | 'pumpFall' | 'barnDoor' | 'matchJump' | 'mantle' | 'lower' | 'outTop'
export function withEnding(frames, kind, { fps = 10 } = {}) {
  const T = 0.12, g = 19 * T; // gravity in image units per s²
  const out = frames.slice();
  let t = out[out.length - 1].t;
  let p = out[out.length - 1].p.map((q) => q.slice());
  const push = (pp, cam) => { t += 1 / fps; out.push({ t, p: pp ? pp.map((q) => q.slice()) : null, ...(cam ? { cam } : {}) }); };
  const hold = (sec) => { for (let i = 0; i < sec * fps; i++) push(p); };
  const move = (idxs, dx, dy, sec) => {
    const n = Math.max(1, Math.round(sec * fps));
    const start = idxs.map((i) => p[i].slice());
    for (let k = 1; k <= n; k++) {
      const e = k / n, s = e * e * (3 - 2 * e);
      idxs.forEach((i, j) => { p[i] = [start[j][0] + dx * s, start[j][1] + dy * s, p[i][2]]; });
      push(p);
    }
  };
  const all = Array.from({ length: 33 }, (_, i) => i);
  const body = all.filter((i) => ![15, 16].includes(i));
  const fallAll = (sec, idxs = all) => {
    const start = idxs.map((i) => p[i].slice());
    for (let k = 1; k <= sec * fps; k++) {
      const tt = k / fps, dy = Math.min(0.5 * g * tt * tt, 6 * T);
      idxs.forEach((i, j) => { p[i] = [start[j][0], start[j][1] + dy, p[i][2]]; });
      push(p);
    }
  };
  const RH = [16], LF = [27, 29, 31], RF = [28, 30, 32];
  switch (kind) {
    case 'missedCatch':
      hold(1.5);
      move(RH, 0.02, -1.0 * T, 0.5); // reach up...
      hold(0.2); // ...touch it...
      fallAll(1.0); // ...and come straight off
      hold(1.5);
      break;
    case 'footSlip':
      hold(2);
      move(LF, 0, 0.6 * T, 0.15); // left foot skates off
      hold(0.25);
      fallAll(1.0);
      hold(1.5);
      break;
    case 'pumpFall':
      hold(6); // stuck, hanging on
      move([15, 16], 0, 0.3 * T, 0.2); // hands peel off
      fallAll(1.0);
      hold(1.5);
      break;
    case 'barnDoor': {
      hold(1.5);
      // Everything except the right hand and right foot swings out to the left.
      const swing = all.filter((i) => ![16, 28, 30, 32].includes(i));
      move(swing, -0.9 * T, 0.1 * T, 0.5);
      fallAll(1.0);
      hold(1.5);
      break;
    }
    case 'matchJump':
      hold(1);
      move([15], p[16][0] - p[15][0] - 0.1 * T, p[16][1] - p[15][1], 0.6); // match
      hold(2.5); // hold the finish
      fallAll(1.0); // jump off
      hold(1.5);
      break;
    case 'mantle': {
      hold(1);
      // Hands stay on the lip; body rises until the hands are at the hips.
      const hands = [15, 16];
      const handY = Math.min(p[15][1], p[16][1]);
      const rise = (p[23][1] + p[24][1]) / 2 - handY + 0.1 * T;
      move(body, 0, -rise, 2.5);
      // Feet up to the lip, then stand.
      move([...LF, ...RF, 25, 26], 0, -(p[27][1] - handY) - 0.1 * T, 1.0);
      move(all.filter((i) => !hands.includes(i)), 0, -0.8 * T, 0.8);
      hold(1.5);
      break;
    }
    case 'lower':
      hold(2.5);
      move(all, 0, 4 * T, 5); // steady lower-off
      hold(1);
      break;
    case 'outTop': {
      // Keep climbing up and out of the picture.
      const top = Math.min(p[0][1], p[11][1], p[12][1]);
      move(all, 0, -(top - 0.05), 3);
      for (let i = 0; i < 1.5 * fps; i++) push(null);
      break;
    }
    // ----- technique sequences (then the climber just hangs there) -----
    case 'probe':
      hold(1);
      // Reach out sideways to feel a hold (a move a straight arm can actually make)...
      move([16], 0.55 * T, 0.25 * T, 0.5);
      move([14], 0.25 * T, 0.1 * T, 0.01);
      hold(0.2);
      // ...and come back without using it.
      move([16], -0.55 * T, -0.25 * T, 0.5);
      move([14], -0.25 * T, -0.1 * T, 0.01);
      hold(2);
      break;
    case 'match':
      hold(1);
      move([15, 13], p[16][0] - p[15][0] - 0.05 * T, p[16][1] - p[15][1], 0.7);
      hold(2);
      break;
    case 'crossThrough':
      hold(1);
      // Elbow travels with the hand (the arm stays a realistic length).
      move([15, 13], p[16][0] - p[15][0] + 0.5 * T, p[16][1] - p[15][1] - 0.9 * T, 0.7);
      hold(2);
      break;
    case 'flag': {
      hold(1);
      // Hips over the right foot, left leg straight out to the left.
      const hipsTorso = [0, 11, 12, 13, 14, 23, 24];
      move(hipsTorso, p[28][0] - (p[23][0] + p[24][0]) / 2, 0, 0.5);
      const hip = p[23];
      move([25], hip[0] - 0.6 * T - p[25][0], hip[1] + 0.3 * T - p[25][1], 0.4);
      move([27, 29, 31], hip[0] - 1.3 * T - p[27][0], hip[1] + 0.6 * T - p[27][1], 0.4);
      hold(2.5);
      break;
    }
    case 'dropKnee': {
      hold(1);
      // Turn side-on (shoulders look narrow) and drop the left knee to foot level.
      const mx = (p[11][0] + p[12][0]) / 2, hx = (p[23][0] + p[24][0]) / 2;
      move([11], mx - p[11][0] - 0.04 * T, 0, 0.4);
      move([12], mx - p[12][0] + 0.04 * T, 0, 0.4);
      move([23], hx - p[23][0] - 0.03 * T, 0, 0.3);
      move([24], hx - p[24][0] + 0.03 * T, 0, 0.3);
      move([25], p[27][0] + 0.4 * T - p[25][0], p[27][1] + 0.05 * T - p[25][1], 0.5);
      hold(2.5);
      break;
    }
    default: throw new Error(`unknown ending ${kind}`);
  }
  return out;
}
