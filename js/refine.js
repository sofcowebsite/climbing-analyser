// Cleans up raw pose-model output before analysis. Pure functions, testable in Node.
//
// Legs are often partly hidden behind the body (or each other), and the pose model then
// gives low-confidence, jumpy guesses. Instead of throwing those points away (which made
// the legs vanish), this module:
//   1. keeps left/right labels consistent over time,
//   2. removes camera movement (so positions are "on the wall"),
//   3. runs a confidence-weighted smoother (Kalman filter + backward pass): confident points
//      are followed closely, doubtful ones are pulled toward what the surrounding frames say,
//      and short hidden stretches are bridged,
//   4. enforces body proportions: a shin or forearm can't be longer than it really is.

export const KEPT = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const CORE = [11, 12, 23, 24];

// Bones from the body outwards (parent, child). Lengths are learned per video.
const BONES = [
  [11, 13], [13, 15], [12, 14], [14, 16],      // arms
  [23, 25], [25, 27], [24, 26], [26, 28],      // legs
  [27, 29], [27, 31], [28, 30], [28, 32],      // feet
];
// Left/right versions of a bone share one length.
const BONE_PAIR = { '11-13': '12-14', '13-15': '14-16', '23-25': '24-26', '25-27': '26-28', '27-29': '28-30', '27-31': '28-32' };

const LR_GROUPS = {
  torso: [[11, 12], [23, 24]],
  arms: [[13, 14], [15, 16]],
  legs: [[25, 26], [27, 28], [29, 30], [31, 32]],
};
// Every left/right landmark pair (face, hands and feet included), for whole-body swaps.
const ALL_PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function median(a) {
  const b = a.filter(isNum).sort((x, y) => x - y);
  if (!b.length) return NaN;
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function quantile(a, q) {
  const b = a.filter(isNum).sort((x, y) => x - y);
  return b.length ? b[Math.min(b.length - 1, Math.max(0, Math.round(q * (b.length - 1))))] : NaN;
}
function smoothArr(arr, win) {
  const h = Math.floor(win / 2);
  return arr.map((v, i) => {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(arr.length - 1, i + h); k++) if (isNum(arr[k])) { s += arr[k]; n++; }
    return n ? s / n : v;
  });
}

/**
 * Keeps left/right labels consistent. Pose models often can't tell left from right on a
 * climber seen from behind, and can swap the whole body for seconds at a time.
 *  1. Anchor: when the shoulders are square to the camera, the climber (facing the wall) has
 *     their left shoulder on the image's left. Frames that disagree get the whole body swapped.
 *  2. Continuity: arms and legs (and the torso when it's turned side-on, where the anchor
 *     can't be used) are swapped if that matches the previous frame much better. This
 *     catches partial swaps, e.g. just the legs.
 * Returns new frames (input untouched).
 */
export function fixLeftRight(frames) {
  const widths = [];
  for (const f of frames) {
    if (!f.p || !f.p[11] || !f.p[12]) continue;
    if (Math.min(f.p[11][2], f.p[12][2]) >= 0.5) widths.push(Math.abs(f.p[11][0] - f.p[12][0]));
  }
  widths.sort((a, b) => a - b);
  const typical = widths.length ? widths[Math.floor(widths.length * 0.75)] : 0;

  const out = [];
  let prev = null;
  for (const f of frames) {
    if (!f.p) { out.push(f); continue; }
    const p = f.p.map((q) => (q ? q.slice() : q));
    let anchored = false;
    const ls = p[11], rs = p[12], lh = p[23], rh = p[24];
    if (typical > 0 && ls && rs && Math.min(ls[2], rs[2]) >= 0.5 && Math.abs(ls[0] - rs[0]) >= typical * 0.5) {
      anchored = true;
      const hipsAgree = !(lh && rh && Math.min(lh[2], rh[2]) >= 0.5) || (lh[0] > rh[0]) === (ls[0] > rs[0]);
      if (ls[0] > rs[0] && hipsAgree) for (const [l, r] of ALL_PAIRS) if (p[l] && p[r]) [p[l], p[r]] = [p[r], p[l]];
    }
    if (prev) {
      for (const [name, pairs] of Object.entries(LR_GROUPS)) {
        if (name === 'torso' && anchored) continue;
        let keep = 0, swap = 0, n = 0;
        for (const [l, r] of pairs) {
          if (!p[l] || !p[r] || !prev[l] || !prev[r]) continue;
          if (Math.min(p[l][2], p[r][2], prev[l][2], prev[r][2]) < 0.2) continue;
          keep += dist(p[l], prev[l]) + dist(p[r], prev[r]);
          swap += dist(p[l], prev[r]) + dist(p[r], prev[l]);
          n++;
        }
        if (n && swap < keep * 0.8) {
          // A torso swap (only when side-on) takes the whole body with it.
          const pairsToSwap = name === 'torso' ? ALL_PAIRS : pairs;
          for (const [l, r] of pairsToSwap) if (p[l] && p[r]) [p[l], p[r]] = [p[r], p[l]];
        }
      }
    }
    prev = p;
    out.push({ ...f, p });
  }
  return out;
}

/**
 * Confidence-weighted smoother for one coordinate series (random-walk Kalman filter with a
 * Rauch–Tung–Striebel backward pass). meas[i] may be NaN (not observed); conf[i] in 0..1.
 * q: expected movement per frame (std), r: measurement noise (std) of a fully confident point.
 */
export function kalmanSmooth(meas, conf, q, r) {
  const n = meas.length;
  const xf = new Array(n), pf = new Array(n), xp = new Array(n), pp = new Array(n);
  let x = NaN, P = Infinity;
  for (let i = 0; i < n; i++) {
    // Predict.
    const xPred = x, pPred = isNum(x) ? P + q * q : Infinity;
    xp[i] = xPred; pp[i] = pPred;
    // Update.
    const z = meas[i];
    if (isNum(z)) {
      // Low-visibility points are usually guesses (a limb hidden behind the body), often
      // pulled toward the torso: trust them much less than their raw score suggests.
      const c0 = Math.min(1, conf[i]);
      const c = Math.max(0.01, c0 < 0.3 ? c0 * 0.15 : c0);
      const R = (r / c) * (r / c);
      if (!isNum(xPred)) { x = z; P = R; }
      else { const K = pPred / (pPred + R); x = xPred + K * (z - xPred); P = (1 - K) * pPred; }
    } else { x = xPred; P = pPred; }
    xf[i] = x; pf[i] = P;
  }
  // Backward pass.
  const xs = xf.slice();
  for (let i = n - 2; i >= 0; i--) {
    if (!isNum(xf[i]) || !isNum(xs[i + 1]) || !isFinite(pp[i + 1])) continue;
    const G = pf[i] / pp[i + 1];
    xs[i] = xf[i] + G * (xs[i + 1] - xp[i + 1]);
  }
  return xs;
}

/**
 * frames: [{ t, p: [[x, y, vis] x33] | null, cam?: [x, y] }] (x already × aspect).
 * Returns { frames: refined frames in image coords (same format, p[i][2] = confidence and
 * p[i][3] = 1 when the point was estimated rather than clearly seen), world: tracks in wall
 * coords { [idx]: { x, y, conf } }, coreOk, T, bones }.
 */
export function refinePoses(rawFrames, { maxBridgeSec = 2.5 } = {}) {
  const frames = fixLeftRight(rawFrames);
  const n = frames.length;
  const times = frames.map((f) => f.t);
  const dt = n > 1 ? (times[n - 1] - times[0]) / (n - 1) || 0.1 : 0.1;
  const coreOk = frames.map((f) => !!f.p && CORE.reduce((s, i) => s + f.p[i][2], 0) / 4 >= 0.5);

  // Smoothed camera path (its estimate moves in small steps).
  const camWin = Math.max(1, Math.round(0.8 / dt) | 1);
  const camX = smoothArr(frames.map((f) => (f.cam ? f.cam[0] : 0)), camWin);
  const camY = smoothArr(frames.map((f) => (f.cam ? f.cam[1] : 0)), camWin);

  // Body scale for noise settings.
  const T = median(frames.map((f, i) => (coreOk[i] ? dist(mid(f.p[11], f.p[12]), mid(f.p[23], f.p[24])) : NaN)));
  if (!isNum(T)) return { frames, world: null, coreOk, T, bones: {} };

  const world = {};
  const maxBridge = Math.round(maxBridgeSec / dt);
  for (const idx of KEPT) {
    const isCore = CORE.includes(idx);
    const xs = [], ys = [], cs = [];
    for (let i = 0; i < n; i++) {
      const q = coreOk[i] ? frames[i].p[idx] : null;
      // Core points are trusted when the core is found; limbs use their own visibility.
      const c = q ? (isCore ? Math.max(0.5, q[2]) : q[2]) : 0;
      xs.push(q ? q[0] - camX[i] : NaN);
      ys.push(q ? q[1] - camY[i] : NaN);
      cs.push(c);
    }
    // Hands and feet can move fast; the body moves slower.
    const isEnd = [15, 16, 27, 28, 29, 30, 31, 32].includes(idx);
    const q = T * (isEnd ? 0.18 : isCore ? 0.1 : 0.16) * (dt / 0.1);
    // Measurement noise from the data: how far confident points sit from their neighbours'
    // midpoint. Far-away climbers are much noisier than close ones.
    const resid = [];
    for (let i = 1; i < n - 1; i++) {
      if (Math.min(cs[i - 1], cs[i], cs[i + 1]) < 0.5) continue;
      resid.push(Math.abs(xs[i] - (xs[i - 1] + xs[i + 1]) / 2), Math.abs(ys[i] - (ys[i - 1] + ys[i + 1]) / 2));
    }
    const noise = median(resid);
    const r = Math.max(T * 0.03, isNum(noise) ? noise * 1.2 : T * 0.06);
    let sx = kalmanSmooth(xs, cs, q, r), sy = kalmanSmooth(ys, cs, q, r);
    // Extra smoothing that grows with the measured jitter (far-away climbers).
    const jitter = isNum(noise) ? noise / T : 0;
    const win = Math.max(1, Math.round((jitter > 0.08 ? 0.6 : jitter > 0.04 ? 0.45 : 0.3) / dt) | 1);
    sx = smoothArr(sx, win); sy = smoothArr(sy, win);
    // Don't invent positions across long hidden stretches or before/after the climber was seen.
    const seen = cs.map((c) => c >= 0.15);
    let lastSeen = -1;
    const nextSeen = new Array(n).fill(-1);
    for (let i = n - 1, nx = -1; i >= 0; i--) { if (seen[i]) nx = i; nextSeen[i] = nx; }
    for (let i = 0; i < n; i++) {
      if (seen[i]) { lastSeen = i; continue; }
      const a = lastSeen, b = nextSeen[i];
      if (a < 0 || b < 0 || b - a > maxBridge) { sx[i] = NaN; sy[i] = NaN; }
    }
    world[idx] = { x: sx, y: sy, conf: cs };
  }

  // Bone lengths: upper percentile of confident measurements (2D views only shorten bones).
  const lengths = {};
  for (const [a, b] of BONES) {
    const ls = [];
    for (let i = 0; i < n; i++) {
      if (world[a].conf[i] < 0.6 || world[b].conf[i] < 0.6) continue;
      const d = Math.hypot(world[a].x[i] - world[b].x[i], world[a].y[i] - world[b].y[i]);
      if (isNum(d)) ls.push(d);
    }
    lengths[`${a}-${b}`] = ls.length >= 5 ? quantile(ls, 0.9) : NaN;
  }
  const bones = {};
  for (const [a, b] of BONES) {
    const k = `${a}-${b}`;
    const pair = BONE_PAIR[k] || Object.keys(BONE_PAIR).find((x) => BONE_PAIR[x] === k);
    const vals = [lengths[k], pair ? lengths[pair] : NaN].filter(isNum);
    bones[k] = vals.length ? Math.max(...vals) : NaN;
  }
  // Enforce: a child joint can't be further from its parent than the bone allows.
  for (let i = 0; i < n; i++) {
    for (const [a, b] of BONES) {
      const L = bones[`${a}-${b}`];
      if (!isNum(L)) continue;
      const pa = [world[a].x[i], world[a].y[i]], pb = [world[b].x[i], world[b].y[i]];
      if (!isNum(pa[0]) || !isNum(pb[0])) continue;
      const d = dist(pa, pb), maxL = L * 1.12;
      if (d > maxL) {
        const k = maxL / d;
        world[b].x[i] = pa[0] + (pb[0] - pa[0]) * k;
        world[b].y[i] = pa[1] + (pb[1] - pa[1]) * k;
        world[b].conf[i] = Math.min(world[b].conf[i], 0.3);
      }
    }
  }

  // Refined frames in image coordinates, for display.
  const out = frames.map((f, i) => {
    if (!f.p && !KEPT.some((idx) => isNum(world[idx].x[i]))) return { ...f, p: null };
    const p = new Array(33).fill(null);
    let any = false;
    for (const idx of KEPT) {
      const x = world[idx].x[i], y = world[idx].y[i];
      if (!isNum(x)) continue;
      const c = world[idx].conf[i];
      p[idx] = [x + camX[i], y + camY[i], c, c < 0.35 ? 1 : 0];
      any = true;
    }
    return { ...f, p: any ? p : null };
  });
  return { frames: out, world, coreOk, T, bones };
}

// Stored (packed) track -> frames in the format analyze()/refinePoses() expect.
export function framesFromTrack(packed) {
  const A = packed.aspect;
  return packed.t.map((t, i) => {
    const flat = packed.p[i];
    let p = null;
    if (flat) {
      p = new Array(33).fill(null).map(() => [0, 0, 0]);
      KEPT.forEach((idx, k) => { p[idx] = [flat[k * 3] * A, flat[k * 3 + 1], flat[k * 3 + 2]]; });
    }
    return { t, cam: packed.c ? packed.c[i] : [0, 0], p };
  });
}
