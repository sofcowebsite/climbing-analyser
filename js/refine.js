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
 * Cuts off walking to or from the phone. People start recording and walk to the wall, then
 * walk back to stop it, so at the very start and end they look much bigger on screen than
 * while climbing. Those stretches aren't climbing and would distort the measurements.
 *
 * Walking toward the camera looks like steady, fast growth on screen (well over 10% per
 * second) that carries on until the person fills the frame or disappears. Someone filming
 * who zooms in or steps closer makes the climber grow once and then level off while they
 * keep climbing, so a stretch is only cut when the growth keeps going right to the end.
 * Frames where nobody is found at the very start or end are cut as well.
 * Returns { frames, trimStart, trimEnd } (seconds removed at each end).
 */
export function trimCameraApproach(frames, { factor = 1.3, rate = 1.08, maxShare = 0.4 } = {}) {
  const n = frames.length;
  const none = { frames, trimStart: 0, trimEnd: 0 };
  if (n < 10) return none;
  const size = frames.map((f) => {
    const p = f.p;
    // Only confident detections: junk right by the lens often sits at about 0.5.
    if (!p || Math.min(p[11][2], p[12][2], p[23][2], p[24][2]) < 0.6) return NaN;
    return dist(mid(p[11], p[12]), mid(p[23], p[24]));
  });
  const good = size.map((v, i) => [v, i]).filter(([v]) => isNum(v));
  if (good.length < 10) return none;
  const dt = Math.max(1e-3, (frames[n - 1].t - frames[0].t) / (n - 1));
  const k = Math.max(1, Math.round(0.5 / dt)); // compare sizes half a second apart
  // Typical climbing size: the middle half of the video.
  const midVals = good.filter(([, i]) => i >= n * 0.25 && i <= n * 0.75).map(([v]) => v);
  const ref = median(midVals.length >= 5 ? midVals : good.map(([v]) => v));
  // Smooth a little so a single bad frame doesn't decide anything. sm1 is a rolling median
  // over about a second, so a few junk detections can't drag it around.
  const sm = smoothArr(size, 5);
  const sm1 = size.map((v, i) => {
    const w = size.slice(Math.max(0, i - k), Math.min(n, i + k + 1)).filter(isNum);
    return w.length >= Math.max(2, k / 2) ? median(w) : NaN;
  });
  const limit = Math.floor(n * maxShare);
  const firstSeen = good[0][1], lastSeen = good[good.length - 1][1];

  // One side at a time. dir = +1 looks at the end (walking up to the phone to stop it),
  // -1 at the start (walking from the phone to the wall). Returns the first/last frame to keep.
  const approach = (dir) => {
    const edge = dir > 0 ? n - 1 : 0;
    const zone = [];
    for (let i = edge; Math.abs(i - edge) < limit && i >= 0 && i < n; i -= dir) zone.push(i);
    // The biggest the person gets near this end of the video (on the second-long average, so
    // one nonsense detection right by the lens can't be the peak).
    const pk = zone.filter((i) => isNum(sm1[i])).reduce((a, i) => (a === null || sm1[i] > sm1[a] ? i : a), null);
    if (pk === null || sm1[pk] < ref * factor) return dir > 0 ? lastSeen : firstSeen;
    // Right by the lens the detector loses the person or returns nonsense, so up to 3 s
    // after the peak is fine; more than that means they carried on (e.g. a zoom mid-climb).
    if (Math.abs(edge - pk) * dt > 3) return dir > 0 ? lastSeen : firstSeen;
    // Walk back from the peak while the person was smaller than everything after (still
    // approaching), on a second-long average so a brief dip in the detection doesn't stop it.
    // Start inside the ramp (where the size is down to two-thirds of the peak): right at the
    // peak the size levels off, which would look like the start of the approach.
    let i = pk;
    while (Math.abs(i - edge) < limit && i - dir >= 0 && i - dir < n && !(isNum(sm1[i]) && sm1[i] <= sm1[pk] / 1.5)) i -= dir;
    if (!(isNum(sm1[i]) && sm1[i] <= sm1[pk] / 1.5)) return dir > 0 ? lastSeen : firstSeen;
    let runMin = sm1[i];
    while (Math.abs(i - edge) < limit) {
      const next = i - dir;
      if (next < 0 || next >= n) break;
      if (!isNum(sm1[next])) { i = next; continue; }
      if (sm1[next] > runMin * 1.06) break;
      // Stop where the growth starts: before that the size was level (climbing).
      const ahead = Math.max(Math.min(next + dir * k, n - 1), 0);
      if (isNum(sm1[ahead]) && sm1[ahead] < sm1[next] * 1.04) break;
      runMin = Math.min(runMin, sm1[next]);
      i = next;
    }
    while (!isNum(sm1[i]) && i !== pk) i += dir;
    // A real approach makes the person at least 1.5x bigger. At the end it must also be quick
    // (on average 15%+ per second) and run into the end of the video, because someone filming
    // may zoom in or step closer during the last moves. At the start, a big person shrinking
    // away in the first few seconds is walking from the phone to the wall, often slowly
    // (standing, chalking, sitting down for the start), so the speed isn't checked there.
    const secs = Math.abs(pk - i) * dt;
    const quick = secs >= 0.3 && Math.log(sm1[pk] / sm1[i]) / secs >= Math.log(rate) * 2;
    const early = dir < 0 && Math.abs(pk - edge) * dt <= 3;
    if (!isNum(sm1[i]) || sm1[pk] < sm1[i] * 1.5 || !(quick || early)) return dir > 0 ? lastSeen : firstSeen;
    return i;
  };
  const start = Math.max(firstSeen, approach(-1)), end = Math.min(lastSeen, approach(1));
  if (end - start < 10) return none;
  return {
    frames: frames.slice(start, end + 1),
    trimStart: start ? frames[start].t - frames[0].t : 0,
    trimEnd: end < n - 1 ? frames[n - 1].t - frames[end].t : 0,
  };
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
  const scale = normalizeScale(world, times, dt, coreOk);
  return { frames: out, world, coreOk, T: scale.applied ? scale.ref : T, bones, scale };
}

/**
 * The climber's apparent size can drift during a video without any zoom: filmed from the
 * base of a crag they get smaller as they climb away from the camera. Measurements assume a
 * constant body size, so this rescales the tracks (in place) to one: every frame's pose is
 * scaled around the hips to the typical torso length, and the hip path is re-integrated at
 * the matching scale. Short leans and turns (which also shorten the torso on screen) are
 * ignored by using a rolling upper percentile over a few seconds.
 * Returns { applied, ref, first, last, ratio }.
 */
export function normalizeScale(world, times, dt, coreOk) {
  const n = times.length;
  const tors = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!coreOk[i] || Math.min(world[11].conf[i], world[12].conf[i], world[23].conf[i], world[24].conf[i]) < 0.5) continue;
    const sm = [(world[11].x[i] + world[12].x[i]) / 2, (world[11].y[i] + world[12].y[i]) / 2];
    const hm = [(world[23].x[i] + world[24].x[i]) / 2, (world[23].y[i] + world[24].y[i]) / 2];
    const d = dist(sm, hm);
    if (isNum(d) && d > 0) tors[i] = d;
  }
  const W = Math.max(2, Math.round(2 / dt));
  let local = tors.map((_, i) => {
    const win = tors.slice(Math.max(0, i - W), Math.min(n, i + W + 1)).filter(isNum);
    return win.length >= 5 ? quantile(win, 0.8) : NaN;
  });
  // Fill gaps from the nearest known value, then smooth.
  let lastKnown = NaN;
  local = local.map((v) => (isNum(v) ? (lastKnown = v) : lastKnown));
  lastKnown = NaN;
  for (let i = n - 1; i >= 0; i--) { if (isNum(local[i])) lastKnown = local[i]; else local[i] = lastKnown; }
  local = smoothArr(local, Math.max(1, Math.round(1 / dt) | 1));
  const known = local.filter(isNum);
  if (known.length < 5) return { applied: false, ratio: 1 };
  const ref = median(known);
  const q = Math.max(1, Math.floor(known.length / 4));
  const first = median(known.slice(0, q)), last = median(known.slice(-q));
  const spread = Math.max(...known) / Math.min(...known);
  const info = { ref, first, last, ratio: last / first, spread };
  // Small drifts are within measurement noise; leave the tracks untouched.
  if (spread < 1.15) return { ...info, applied: false };

  const hip = (i) => [(world[23].x[i] + world[24].x[i]) / 2, (world[23].y[i] + world[24].y[i]) / 2];
  let C = null, cPrev = null, kPrev = NaN;
  const idxs = Object.keys(world).map(Number);
  for (let i = 0; i < n; i++) {
    const k = isNum(local[i]) ? ref / local[i] : 1;
    const c = hip(i);
    const hasHip = isNum(c[0]) && isNum(c[1]);
    // Anchor for this frame: where the hips should be in the rescaled world.
    let anchorC, anchorRaw;
    if (hasHip) {
      if (!C) C = c.slice();
      else C = [C[0] + (c[0] - cPrev[0]) * (k + kPrev) / 2, C[1] + (c[1] - cPrev[1]) * (k + kPrev) / 2];
      cPrev = c; kPrev = k;
      anchorC = C; anchorRaw = c;
    } else if (cPrev) { anchorC = C; anchorRaw = cPrev; } else { anchorC = null; }
    for (const idx of idxs) {
      const x = world[idx].x[i], y = world[idx].y[i];
      if (!isNum(x) || !isNum(y)) continue;
      if (!anchorC) { world[idx].x[i] = x * k; world[idx].y[i] = y * k; continue; }
      world[idx].x[i] = anchorC[0] + (x - anchorRaw[0]) * k;
      world[idx].y[i] = anchorC[1] + (y - anchorRaw[1]) * k;
    }
  }
  return { ...info, applied: true };
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
