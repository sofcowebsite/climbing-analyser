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
    frames.push({ t, p });
  }
  return frames;
}
