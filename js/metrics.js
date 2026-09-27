// Turns a sequence of pose frames into climbing metrics.
//
// Input frames: [{ t: seconds, p: [[x, y, visibility] x 33] | null }]
// Coordinates are image-normalised with x already multiplied by the frame
// aspect ratio (width / height), so distances are isotropic.
// Everything here is pure (no DOM) so it can be unit-tested in Node.

export const LM = {
  nose: 0,
  lShoulder: 11, rShoulder: 12,
  lElbow: 13, rElbow: 14,
  lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24,
  lKnee: 25, rKnee: 26,
  lAnkle: 27, rAnkle: 28,
  lHeel: 29, rHeel: 30,
  lToe: 31, rToe: 32,
};

// Bumped when the analysis changes; older saved sessions are re-analysed from their stored poses.
export const ANALYSIS_VERSION = 4;

// Landmarks kept when a session is stored (enough to redraw the skeleton).
export const KEPT_LANDMARKS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

const CORE = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip];
const LIMB_POINTS = {
  lHand: [LM.lWrist], rHand: [LM.rWrist],
  lFoot: [LM.lAnkle, LM.lToe], rFoot: [LM.rAnkle, LM.rToe],
};

// Tunable thresholds, in torso lengths (T) and seconds.
export const CFG = {
  minCoreVis: 0.5,
  minPointVis: 0.35,
  stillRadius: 0.08, stillWindowSec: 0.4, stillHoldSec: 0.3,
  // Hand moves are usually bigger than foot moves; a 15 cm foot step is a real move.
  handMoveDist: 0.4, footMoveDist: 0.25, handAdjustDist: 0.12, footAdjustDist: 0.08,
  fineDetailPx: 60, // torso size (px) needed to see small hand/foot readjustments
  minElbow: 40, // anything tighter is almost always a tracking glitch
  pauseSpeed: 0.15, pauseMinSec: 1.2, restMinSec: 4,
  staticSpeed: 0.25,
  straightElbow: 145,
  upwardSpeed: 0.3,
  jerkAccel: 7,
  dynoSpeed: 1.6,
  turnedRatio: 0.65,
};

import { refinePoses, fixLeftRight } from './refine.js';
import { detectDrops, lostWhileDropping, classifyOutcome } from './outcome.js';

export { fixLeftRight };

// ---------- small helpers ----------

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function median(a) {
  const b = a.filter(isNum).sort((x, y) => x - y);
  if (!b.length) return NaN;
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

export function quantile(a, q) {
  const b = a.filter(isNum).sort((x, y) => x - y);
  if (!b.length) return NaN;
  const i = Math.min(b.length - 1, Math.max(0, Math.round(q * (b.length - 1))));
  return b[i];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Angle ABC in degrees.
export function angle(a, b, c) {
  const v1x = a[0] - b[0], v1y = a[1] - b[1];
  const v2x = c[0] - b[0], v2y = c[1] - b[1];
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!n) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Linear interpolation over NaN gaps no longer than maxGap samples.
export function fillGaps(arr, maxGap) {
  const out = arr.slice();
  let i = 0;
  while (i < out.length) {
    if (isNum(out[i])) { i++; continue; }
    let j = i;
    while (j < out.length && !isNum(out[j])) j++;
    const gap = j - i;
    if (i > 0 && j < out.length && gap <= maxGap) {
      const a = out[i - 1], b = out[j];
      for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i + 1)) / (gap + 1);
    }
    i = j;
  }
  return out;
}

// Centered moving average that ignores NaNs (NaN stays NaN).
export function smooth(arr, win) {
  if (win <= 1) return arr.slice();
  const h = Math.floor(win / 2);
  return arr.map((v, i) => {
    if (!isNum(v)) return NaN;
    let s = 0, n = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(arr.length - 1, i + h); k++) {
      if (isNum(arr[k])) { s += arr[k]; n++; }
    }
    return s / n;
  });
}

// Central-difference derivative.
export function derivative(arr, dt) {
  return arr.map((v, i) => {
    const a = arr[Math.max(0, i - 1)], b = arr[Math.min(arr.length - 1, i + 1)];
    const span = (Math.min(arr.length - 1, i + 1) - Math.max(0, i - 1)) * dt;
    return isNum(a) && isNum(b) && span ? (b - a) / span : NaN;
  });
}

// Contiguous runs where pred(i) is true: [{s, e}] inclusive indices.
function runs(n, pred) {
  const out = [];
  let s = -1;
  for (let i = 0; i < n; i++) {
    if (pred(i)) { if (s < 0) s = i; }
    else if (s >= 0) { out.push({ s, e: i - 1 }); s = -1; }
  }
  if (s >= 0) out.push({ s, e: n - 1 });
  return out;
}

// ---------- preprocessing ----------

// Builds per-landmark tracks in wall coordinates from the refined poses (see refine.js):
// tracks[idx] = { x: [], y: [], conf: [] } (NaN where unknown).
function buildTracks(frames) {
  const r = refinePoses(frames);
  return { tracks: r.world, coreOk: r.coreOk, refined: r.frames };
}

const pt = (tracks, idx, i) => [tracks[idx].x[i], tracks[idx].y[i]];
const ptOk = (p) => isNum(p[0]) && isNum(p[1]);

function limbPoint(tracks, key, i) {
  const pts = LIMB_POINTS[key].map((idx) => pt(tracks, idx, i)).filter(ptOk);
  if (!pts.length) return [NaN, NaN];
  return [mean(pts.map((p) => p[0])), mean(pts.map((p) => p[1]))];
}

// ---------- limb movement segmentation ----------

// Splits one limb's trajectory into moves (new hold) and adjustments (small re-placements).
// A limb is "still" (on a hold) when it stays inside a small radius for a short window.
// The radius adapts to the measured landmark jitter, which is much larger for far-away
// climbers. Each gap between two holds is classified by the distance between them.
function segmentLimb(xs, ys, times, dt, T, isHand, seen) {
  const n = xs.length;
  const vx = derivative(xs, dt), vy = derivative(ys, dt);
  const speed = vx.map((v, i) => (isNum(v) && isNum(vy[i]) ? Math.hypot(v, vy[i]) / T : NaN));
  const moveDist = isHand ? CFG.handMoveDist : CFG.footMoveDist;
  const adjustDist = isHand ? CFG.handAdjustDist : CFG.footAdjustDist;
  const stillN = Math.max(1, Math.round(CFG.stillHoldSec / dt));

  // Jitter: how far each point sits from the midpoint of its neighbours.
  const resid = [];
  for (let i = 1; i < n - 1; i++) {
    const rx = xs[i] - (xs[i - 1] + xs[i + 1]) / 2, ry = ys[i] - (ys[i - 1] + ys[i + 1]) / 2;
    if (isNum(rx) && isNum(ry)) resid.push(Math.hypot(rx, ry) / T);
  }
  const noise = isNum(median(resid)) ? median(resid) : 0;
  const stillR = Math.max(CFG.stillRadius, noise * 4);

  const h = Math.max(1, Math.round(CFG.stillWindowSec / 2 / dt));
  const still = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!isNum(xs[i])) continue;
    let sx = 0, sy = 0, c = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(n - 1, i + h); k++) if (isNum(xs[k])) { sx += xs[k]; sy += ys[k]; c++; }
    if (c < h + 1) continue;
    const mx = sx / c, my = sy / c;
    let spread = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(n - 1, i + h); k++) {
      if (isNum(xs[k])) spread = Math.max(spread, Math.hypot(xs[k] - mx, ys[k] - my) / T);
    }
    // Hidden stretches are estimated, so they can't prove the limb was on a hold.
    still[i] = spread < stillR && (!seen || seen[i]);
  }
  // Only still runs long enough to count as "on a hold".
  const holds = runs(n, (i) => still[i]).filter((r) => r.e - r.s + 1 >= stillN);
  const holdPos = (r, fromEnd) => {
    const idx = [];
    for (let i = fromEnd ? r.e : r.s, c = 0; c < 5 && i >= r.s && i <= r.e; i += fromEnd ? -1 : 1, c++) idx.push(i);
    return [median(idx.map((i) => xs[i])), median(idx.map((i) => ys[i]))];
  };
  const moves = [], adjustments = [];
  for (let k = 1; k < holds.length; k++) {
    const a = holds[k - 1], b = holds[k];
    let peak = 0, gap = false;
    for (let i = a.e; i <= b.s; i++) { if (isNum(speed[i])) peak = Math.max(peak, speed[i]); else gap = true; }
    if (gap) continue;
    const pa = holdPos(a, true), pb = holdPos(b, false);
    const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / T;
    const ev = { t0: times[a.e], t1: times[b.s], dist: d, peak, up: (pa[1] - pb[1]) / T };
    if (d >= moveDist) moves.push(ev);
    else if (d >= Math.max(adjustDist, stillR * 1.5)) adjustments.push(ev);
  }
  return { moves, adjustments, still, speed, noise };
}

// Adjustments that happen shortly after a move are "readjustments" (not settling on the first try).
function countReadjust(moves, adjustments, windowSec = 2.5) {
  let n = 0;
  for (const a of adjustments) {
    if (moves.some((m) => a.t0 >= m.t1 - 0.05 && a.t0 - m.t1 <= windowSec)) n++;
  }
  return n;
}

// ---------- main entry ----------

export function analyze(frames, opts = {}) {
  const warnings = [];
  const n = frames.length;
  if (n < 10) return { ok: false, reason: 'Video too short to analyse.' };

  const times = frames.map((f) => f.t);
  const dt = (times[n - 1] - times[0]) / (n - 1) || 0.1;
  const detected = frames.filter((f) => f.p).length / n;

  // Rough body size in pixels: small, far-away climbers get noisier landmarks.
  const rawTorso = median(frames.map((f) => (f.p && mean(CORE.map((i) => f.p[i][2])) >= CFG.minCoreVis
    ? dist(mid(f.p[LM.lShoulder], f.p[LM.rShoulder]), mid(f.p[LM.lHip], f.p[LM.rHip])) : NaN)));
  const torsoPx = isNum(rawTorso) && opts.frameHeightPx ? rawTorso * opts.frameHeightPx : null;
  if (n < 10 || !frames.some((f) => f.p)) return { ok: false, reason: 'Could not find the climber in enough of the video. Try tapping on the climber before analysing, trimming to just the climb, or filming in 4K / closer.', detected };
  const { tracks, coreOk } = buildTracks(frames);
  if (!tracks) return { ok: false, reason: 'Could not find the climber in enough of the video. Try tapping on the climber before analysing, trimming to just the climb, or filming in 4K / closer.', detected };

  // Body scale: median torso length (shoulder mid to hip mid).
  const torso = [], shoulderW = [];
  for (let i = 0; i < n; i++) {
    if (!coreOk[i]) continue;
    const ls = pt(tracks, LM.lShoulder, i), rs = pt(tracks, LM.rShoulder, i);
    const lh = pt(tracks, LM.lHip, i), rh = pt(tracks, LM.rHip, i);
    if (![ls, rs, lh, rh].every(ptOk)) continue;
    torso.push(dist(mid(ls, rs), mid(lh, rh)));
  }
  const T = median(torso);
  const trackedRatio = coreOk.filter(Boolean).length / n;
  if (!isNum(T) || torso.length < 8) {
    return { ok: false, reason: 'Could not find the climber in enough of the video. Try tapping on the climber before analysing, trimming to just the climb, or filming in 4K / closer.', detected };
  }
  if (torsoPx !== null ? torsoPx < 22 : T < 0.03) {
    warnings.push('You are very small in the video, so hand and foot measurements are rough. Zoom in (2× or 3× lens) or film in 4K next time.');
  }
  // Camera movement (compensated, but worth knowing about).
  const camPath = frames.reduce((acc, f, i) => {
    if (i === 0 || !f.cam || !frames[i - 1].cam) return acc;
    return acc + Math.hypot(f.cam[0] - frames[i - 1].cam[0], f.cam[1] - frames[i - 1].cam[1]);
  }, 0);
  const cameraMoved = camPath > 0.05;
  // Zoom changes the apparent body size; the measurements assume a constant scale.
  const torsoEarly = median(frames.slice(0, n >> 2).map((f) => (f.p ? dist(mid(f.p[11], f.p[12]), mid(f.p[23], f.p[24])) : NaN)));
  const torsoLate = median(frames.slice(-(n >> 2)).map((f) => (f.p ? dist(mid(f.p[11], f.p[12]), mid(f.p[23], f.p[24])) : NaN)));
  if (isNum(torsoEarly) && isNum(torsoLate) && Math.max(torsoEarly, torsoLate) / Math.min(torsoEarly, torsoLate) > 1.5) {
    warnings.push('The zoom seems to change during the video, which distorts speed and height measurements. Try not to zoom while filming.');
  }
  if (trackedRatio < 0.6) warnings.push(`Your body was only tracked in ${Math.round(trackedRatio * 100)}% of the video. Results may be incomplete.`);

  // Per-frame body signals.
  const com = [], hipMid = [], shMid = [], elbow = { l: [], r: [] }, knee = { l: [], r: [] }, swRatio = [];
  for (let i = 0; i < n; i++) {
    const ls = pt(tracks, LM.lShoulder, i), rs = pt(tracks, LM.rShoulder, i);
    const lh = pt(tracks, LM.lHip, i), rh = pt(tracks, LM.rHip, i);
    if (![ls, rs, lh, rh].every(ptOk)) {
      com.push([NaN, NaN]); hipMid.push([NaN, NaN]); shMid.push([NaN, NaN]);
      elbow.l.push(NaN); elbow.r.push(NaN); knee.l.push(NaN); knee.r.push(NaN); swRatio.push(NaN);
      continue;
    }
    const hm = mid(lh, rh), sm = mid(ls, rs);
    hipMid.push(hm); shMid.push(sm);
    com.push([hm[0] * 0.6 + sm[0] * 0.4, hm[1] * 0.6 + sm[1] * 0.4]);
    elbow.l.push(angle(ls, pt(tracks, LM.lElbow, i), pt(tracks, LM.lWrist, i)));
    elbow.r.push(angle(rs, pt(tracks, LM.rElbow, i), pt(tracks, LM.rWrist, i)));
    knee.l.push(angle(lh, pt(tracks, LM.lKnee, i), pt(tracks, LM.lAnkle, i)));
    knee.r.push(angle(rh, pt(tracks, LM.rKnee, i), pt(tracks, LM.rAnkle, i)));
    swRatio.push(dist(ls, rs) / T);
  }

  const comX = com.map((c) => c[0]), comY = com.map((c) => c[1]);
  const firstValid = comY.findIndex(isNum);
  const baseY = comY[firstValid];
  // Height gained, in torso lengths (up is positive).
  const height = comY.map((y) => (isNum(y) ? (baseY - y) / T : NaN));
  const vX = derivative(comX, dt).map((v) => v / T);
  const vY = derivative(comY, dt).map((v) => -v / T); // up positive
  const speed = vX.map((v, i) => (isNum(v) && isNum(vY[i]) ? Math.hypot(v, vY[i]) : NaN));
  const accel = derivative(smooth(speed, 3), dt);

  // ----- climb window: from leaving the ground to reaching the high point -----
  let wStart = firstValid, wEnd = n - 1;
  const maxH = Math.max(...height.filter(isNum));
  const maxIdx = height.indexOf(maxH);
  const liftIdx = height.findIndex((h) => isNum(h) && h > 0.3);
  if (liftIdx > 0) wStart = Math.max(firstValid, liftIdx - Math.round(1 / dt));

  // Significant descents: falls, jumping off, lowering, down-climbing.
  const drops = detectDrops({ height, vY, times, dt });
  const lostDrop = lostWhileDropping({ height, vY, times, dt, coreOk });
  if (lostDrop && !drops.some((d) => Math.abs(d.t - lostDrop.t) < 1)) drops.push(lostDrop);
  const falls = drops.filter((d) => d.kind === 'fast');
  // End the window at the high point if the climber comes down afterwards (lower-off / fall / jump down),
  // but always include the start of a fall so we can see what caused it.
  const lastValid = n - 1 - [...comY].reverse().findIndex(isNum);
  if (maxIdx > wStart && lastValid - maxIdx > Math.round(1.5 / dt) && maxH - height[lastValid] > 0.8) {
    const fallAfter = falls.filter((d) => d.s >= maxIdx - Math.round(1 / dt)).map((d) => d.s);
    wEnd = Math.min(lastValid, Math.max(maxIdx, ...fallAfter) + Math.round(0.5 / dt));
  } else wEnd = lastValid;
  if (wEnd - wStart < Math.round(3 / dt)) { wStart = firstValid; wEnd = lastValid; }
  const inW = (i) => i >= wStart && i <= wEnd;
  const climbTime = times[wEnd] - times[wStart];

  // ----- limb events -----
  const limbs = {};
  for (const key of Object.keys(LIMB_POINTS)) {
    const xs = [], ys = [], seenMask = [];
    for (let i = 0; i < n; i++) {
      const p = inW(i) ? limbPoint(tracks, key, i) : [NaN, NaN];
      xs.push(p[0]); ys.push(p[1]);
      // Hands are rarely hidden for long; a looser bar avoids splitting holds on small figures.
      seenMask.push(Math.max(...LIMB_POINTS[key].map((idx) => tracks[idx].conf[i])) >= (key.endsWith('Hand') ? 0.2 : CFG.minPointVis));
    }
    // Share of the climb where this limb was clearly seen (not just estimated).
    const visible = seenMask.filter((v, i) => v && inW(i)).length / Math.max(1, wEnd - wStart + 1);
    limbs[key] = { ...segmentLimb(xs, ys, times, dt, T, key.endsWith('Hand'), seenMask), visible, xs, ys, seen: seenMask };
  }
  const handMoves = [...limbs.lHand.moves.map((m) => ({ ...m, side: 'left' })), ...limbs.rHand.moves.map((m) => ({ ...m, side: 'right' }))]
    .sort((a, b) => a.t0 - b.t0).map((m, k) => ({ ...m, n: k + 1 }));
  const footMoves = [...limbs.lFoot.moves.map((m) => ({ ...m, side: 'left' })), ...limbs.rFoot.moves.map((m) => ({ ...m, side: 'right' }))];
  const handAdjust = countReadjust(limbs.lHand.moves, limbs.lHand.adjustments) + countReadjust(limbs.rHand.moves, limbs.rHand.adjustments);
  const footAdjust = countReadjust(limbs.lFoot.moves, limbs.lFoot.adjustments) + countReadjust(limbs.rFoot.moves, limbs.rFoot.adjustments);
  const feetVisible = Math.min(limbs.lFoot.visible, limbs.rFoot.visible);
  const handsVisible = Math.min(limbs.lHand.visible, limbs.rHand.visible);
  // Climbing a body length or more without a single detected foot move means the feet weren't tracked.
  const feetLost = footMoves.length === 0 && handMoves.length >= 3;
  if (feetLost) warnings.push('No foot moves were detected, which usually means your feet weren\'t tracked well (out of frame, in shadow, or similar in colour to the wall). Footwork scores were skipped.');
  else if (feetVisible < 0.5) warnings.push('Your feet were often out of view, so footwork scores are less reliable. Keep your whole body in frame.');

  // ----- pauses -----
  const pauseMin = Math.round(CFG.pauseMinSec / dt);
  // A pause is when the body AND every visible limb are still.
  const limbsStill = (i) => Object.values(limbs).every((l) => l.still[i] || !isNum(l.speed[i]));
  const pauses = runs(n, (i) => inW(i) && isNum(speed[i]) && speed[i] < CFG.pauseSpeed && limbsStill(i))
    .filter((r) => r.e - r.s + 1 >= pauseMin)
    .map((r) => ({ t0: times[r.s], t1: times[r.e], dur: times[r.e] - times[r.s], s: r.s, e: r.e }))
    // Ignore standing on the ground at the very start.
    .filter((p) => p.s > wStart + 1 || height[p.e] > 0.3);
  for (const p of pauses) {
    const angles = [];
    for (let i = p.s; i <= p.e; i++) {
      for (const side of ['l', 'r']) {
        const key = side + 'Hand';
        if (limbs[key].still[i] && isNum(elbow[side][i]) && elbow[side][i] >= CFG.minElbow && handAboveShoulder(tracks, side, i, T)) angles.push(elbow[side][i]);
      }
    }
    p.elbow = median(angles);
    p.type = p.dur >= CFG.restMinSec ? 'rest' : 'hesitation';
  }
  const hesitations = pauses.filter((p) => p.type === 'hesitation');
  const rests = pauses.filter((p) => p.type === 'rest');
  const pausedTime = pauses.reduce((s, p) => s + p.dur, 0);

  // ----- straight arms on static holds -----
  const staticArm = [];
  let worstBent = null;
  for (let i = wStart; i <= wEnd; i++) {
    if (!(isNum(speed[i]) && speed[i] < CFG.staticSpeed)) continue;
    for (const side of ['l', 'r']) {
      const a = elbow[side][i];
      if (limbs[side + 'Hand'].still[i] && isNum(a) && a >= CFG.minElbow && handAboveShoulder(tracks, side, i, T)) {
        staticArm.push(a);
        if (!worstBent || a < worstBent.a) worstBent = { a, t: times[i] };
      }
    }
  }
  const straightArmRatio = staticArm.length >= 5 ? staticArm.filter((a) => a >= CFG.straightElbow).length / staticArm.length : null;

  // ----- legs vs arms during upward movement -----
  let legWork = 0, armWork = 0;
  const kVel = { l: derivative(knee.l, dt), r: derivative(knee.r, dt) };
  const eVel = { l: derivative(elbow.l, dt), r: derivative(elbow.r, dt) };
  for (let i = wStart; i <= wEnd; i++) {
    if (!(isNum(vY[i]) && vY[i] > CFG.upwardSpeed)) continue;
    for (const side of ['l', 'r']) {
      if (limbs[side + 'Foot'].still[i] && isNum(kVel[side][i]) && kVel[side][i] > 0) legWork += kVel[side][i];
      if (limbs[side + 'Hand'].still[i] && isNum(eVel[side][i]) && eVel[side][i] < 0) armWork += -eVel[side][i];
    }
  }
  const legDrive = legWork + armWork > 200 ? legWork / (legWork + armWork) : null;

  // ----- balance: hips over feet when static -----
  const offsets = [];
  for (let i = wStart; i <= wEnd; i++) {
    if (!(isNum(speed[i]) && speed[i] < CFG.staticSpeed)) continue;
    if (!limbs.lFoot.still[i] || !limbs.rFoot.still[i]) continue;
    const fx = (limbs.lFoot.xs[i] + limbs.rFoot.xs[i]) / 2;
    if (isNum(fx) && isNum(comX[i])) offsets.push(Math.abs(comX[i] - fx) / T);
  }
  const balanceOffset = offsets.length >= 5 ? median(offsets) : null;

  // ----- turning hips into the wall -----
  const swMax = quantile(swRatio.filter((_, i) => inW(i)), 0.9);
  const movingIdx = [];
  for (let i = wStart; i <= wEnd; i++) if (isNum(speed[i]) && speed[i] >= CFG.staticSpeed && isNum(swRatio[i])) movingIdx.push(i);
  const turnedShare = movingIdx.length >= 10 && isNum(swMax) && swMax > 0.3
    ? movingIdx.filter((i) => swRatio[i] / swMax < CFG.turnedRatio).length / movingIdx.length
    : null;

  // ----- smoothness -----
  const jerky = [];
  for (const r of runs(n, (i) => inW(i) && isNum(accel[i]) && Math.abs(accel[i]) > CFG.jerkAccel)) {
    const k = r.s + Math.floor((r.e - r.s) / 2);
    if (!falls.some((f) => Math.abs(f.t - times[k]) < 1.5)) jerky.push({ t: times[k], a: Math.abs(accel[k]) });
  }
  const pathSm = { x: smooth(comX, Math.round(0.5 / dt) | 1), y: smooth(comY, Math.round(0.5 / dt) | 1) };
  let pathLen = 0;
  for (let i = wStart + 1; i <= wEnd; i++) {
    const d = Math.hypot(pathSm.x[i] - pathSm.x[i - 1], pathSm.y[i] - pathSm.y[i - 1]);
    if (isNum(d)) pathLen += d;
  }
  const hStart = height[wStart], hEnd = Math.max(...height.slice(wStart, wEnd + 1).filter(isNum));
  const net = Math.hypot((pathSm.x[wEnd] - pathSm.x[wStart]) || 0, (hEnd - (hStart || 0)) * T);
  const pathEfficiency = pathLen > T ? Math.min(1, net / pathLen) : null;

  // ----- dynamic moves -----
  const dynos = runs(n, (i) => inW(i) && isNum(vY[i]) && vY[i] > CFG.dynoSpeed)
    .map((r) => ({ t: times[r.s] }));

  const gain = isNum(hEnd) && isNum(hStart) ? hEnd - hStart : 0;
  const movingTime = Math.max(0, climbTime - pausedTime);
  const handMoveCount = handMoves.length, footMoveCount = footMoves.length;
  // Readjustments are only a few centimetres: below ~60 px of torso they're lost in tracking jitter.
  const tooSmallForFine = torsoPx !== null && torsoPx < CFG.fineDetailPx;
  if (tooSmallForFine) warnings.push('You are too small in the video to measure fine details like grip and foot readjustments, so those were skipped. The other measurements still work.');

  const metrics = {
    climbTime,
    movingTime,
    heightGain: gain, // torso lengths
    handMoves: handMoveCount,
    footMoves: footMoveCount,
    movesPerMin: climbTime > 0 ? (handMoveCount / climbTime) * 60 : null,
    footHandRatio: handMoveCount >= 3 && feetVisible >= 0.4 && !feetLost ? footMoveCount / handMoveCount : null,
    footReadjustRate: footMoveCount >= 3 && feetVisible >= 0.4 && !tooSmallForFine ? footAdjust / footMoveCount : null,
    handReadjustRate: handMoveCount >= 3 && handsVisible >= 0.4 && !tooSmallForFine ? handAdjust / handMoveCount : null,
    straightArmRatio,
    legDrive,
    balanceOffset,
    turnedShare,
    pathEfficiency,
    jerkyPerMin: climbTime > 5 ? (jerky.length / climbTime) * 60 : null,
    hesitationsPerMin: climbTime > 5 ? (hesitations.length / climbTime) * 60 : null,
    hesitations: hesitations.length,
    rests: rests.length,
    restStraightArm: rests.filter((r) => isNum(r.elbow) && r.elbow >= CFG.straightElbow).length,
    pausedShare: climbTime > 0 ? pausedTime / climbTime : null,
    dynos: dynos.length,
    falls: falls.length,
    trackedRatio,
    detected,
    cameraMoved,
    torsoPx,
  };

  // ----- detailed breakdown: every hand move, sections of the climb, left vs right -----
  const detail = detailedBreakdown({
    times, dt, T, n, wStart, wEnd, inW, limbs, comX, vY, speed, elbow, knee, tracks, height,
    jerky, pauses, handAdjustAllowed: !tooSmallForFine, handMoves, footMoves,
  });
  Object.assign(metrics, detail.summary);

  // ----- how did it end? did they fall, and why? -----
  const hOf = (idx) => tracks[idx].y.map((y) => (isNum(y) ? (baseY - y) / T : NaN));
  const footH = (k) => limbs[k].ys.map((y) => (isNum(y) ? (baseY - y) / T : NaN));
  const heights = {
    com: height, hip: hipMid.map((p) => (isNum(p[1]) ? (baseY - p[1]) / T : NaN)),
    lWrist: hOf(LM.lWrist), rWrist: hOf(LM.rWrist), lShoulder: hOf(LM.lShoulder), rShoulder: hOf(LM.rShoulder),
    lFoot: footH('lFoot'), rFoot: footH('rFoot'),
  };
  const trackQuality = (torsoPx !== null && torsoPx < 30) || trackedRatio < 0.7 ? 'low'
    : (torsoPx !== null && torsoPx < 50) || feetVisible < 0.6 ? 'medium' : 'high';
  const octx = {
    times, dt, n, T, vY, vX, comX, speed, limbs, handMoves, footMoves, elbow, knee, heights, drops,
    maxIdx, frames, coreOk, trackQuality, climbStart: times[wStart],
    restsBefore: (t) => rests.some((r) => r.t1 <= t && r.t1 >= t - 60),
  };
  const outcome = classifyOutcome(octx);
  const fallReports = outcome.falls.map((f) => f.autopsy);
  metrics.falls = outcome.falls.length;
  metrics.trackQuality = trackQuality;
  metrics.feetVisible = feetVisible;

  // ----- key moments -----
  const events = [];
  for (const f of outcome.falls) events.push({ t: f.t, kind: 'fall', label: 'Fall' });
  if (outcome.dismount) events.push({ t: outcome.dismount.t, kind: 'dismount', label: 'Dropped off after finishing' });
  const longest = [...pauses].sort((a, b) => b.dur - a.dur)[0];
  if (longest) events.push({ t: longest.t0, kind: longest.type, label: `Longest ${longest.type === 'rest' ? 'rest' : 'pause'} (${longest.dur.toFixed(1)} s${isNum(longest.elbow) ? `, arms at ${Math.round(longest.elbow)}°` : ''})` });
  for (const j of [...jerky].sort((a, b) => b.a - a.a).slice(0, 3)) events.push({ t: j.t, kind: 'jerk', label: 'Sudden jolt in body movement' });
  if (worstBent && worstBent.a < 110) events.push({ t: worstBent.t, kind: 'bent', label: `Holding on with a bent arm (${Math.round(worstBent.a)}°)` });
  for (const d of dynos.slice(0, 3)) events.push({ t: d.t, kind: 'dyno', label: 'Dynamic move' });
  const readjustTimes = [];
  for (const key of ['lFoot', 'rFoot']) {
    for (const a of limbs[key].adjustments) if (limbs[key].moves.some((m) => a.t0 >= m.t1 - 0.05 && a.t0 - m.t1 <= 2.5)) readjustTimes.push(a.t0);
  }
  readjustTimes.sort((a, b) => a - b);
  if (readjustTimes.length) events.push({ t: readjustTimes[0], kind: 'readjust', label: `Foot readjusted after placing${readjustTimes.length > 1 ? ` (first of ${readjustTimes.length})` : ''}` });
  if (isNum(maxIdx) && maxIdx >= 0) events.push({ t: times[maxIdx], kind: 'top', label: 'High point' });
  events.sort((a, b) => a.t - b.t);

  // ----- chart series (downsampled to ~200 points) -----
  const step = Math.max(1, Math.ceil(n / 200));
  const series = { t: [], height: [], speed: [] };
  for (let i = 0; i < n; i += step) {
    series.t.push(round(times[i], 2));
    series.height.push(isNum(height[i]) ? round(height[i], 3) : null);
    series.speed.push(isNum(speed[i]) ? round(speed[i], 3) : null);
  }

  return {
    ok: true,
    torso: T,
    moves: detail.moves,
    outcome: { result: outcome.result, confidence: outcome.confidence, headline: outcome.headline, evidence: outcome.evidence, alternatives: outcome.alternatives },
    falls: fallReports,
    sections: detail.sections,
    sides: detail.sides,
    extras: detail.extras,
    window: { t0: times[wStart], t1: times[wEnd] },
    metrics,
    pauses: pauses.map(({ t0, t1, dur, type, elbow: e }) => ({ t0, t1, dur, type, elbow: isNum(e) ? Math.round(e) : null })),
    events,
    series,
    warnings,
  };
}

function handAboveShoulder(tracks, side, i, T) {
  const w = pt(tracks, side === 'l' ? LM.lWrist : LM.rWrist, i);
  const s = pt(tracks, side === 'l' ? LM.lShoulder : LM.rShoulder, i);
  return ptOk(w) && ptOk(s) && w[1] < s[1] + 0.3 * T;
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- detailed breakdown ----------

const sideKey = (side) => (side === 'left' ? 'l' : 'r');
const other = (side) => (side === 'left' ? 'right' : 'left');

function detailedBreakdown(c) {
  const { times, dt, T, n, wStart, wEnd, inW, limbs, comX, vY, speed, elbow, knee, tracks, height, jerky, pauses } = c;
  const idxAt = (t) => Math.max(0, Math.min(n - 1, Math.round((t - times[0]) / dt)));
  const hands = [...c.handMoves].sort((a, b) => a.t0 - b.t0);
  const feet = [...c.footMoves].sort((a, b) => a.t0 - b.t0);

  // Feet cutting loose: both feet moving fast at the same time while a hand holds on.
  const feetCuts = [];
  {
    const fast = (key, i) => isNum(limbs[key].speed[i]) && limbs[key].speed[i] > 1.3 && !limbs[key].still[i];
    const r = runs(n, (i) => inW(i) && fast('lFoot', i) && fast('rFoot', i) && (limbs.lHand.still[i] || limbs.rHand.still[i]));
    for (const x of r) if (x.e - x.s + 1 >= Math.max(2, Math.round(0.2 / dt))) feetCuts.push({ t: times[x.s] });
  }

  // Shake-outs / chalking: a hand dropped below the hips for a while, off the ground.
  const shakeOuts = [];
  for (const side of ['l', 'r']) {
    const w = side === 'l' ? LM.lWrist : LM.rWrist;
    const r = runs(n, (i) => inW(i) && isNum(height[i]) && height[i] > 0.6 &&
      isNum(tracks[w].y[i]) && isNum(tracks[LM.lHip].y[i]) && tracks[w].y[i] > (tracks[LM.lHip].y[i] + tracks[LM.rHip].y[i]) / 2);
    for (const x of r) {
      const dur = times[x.e] - times[x.s];
      if (dur >= 0.6) shakeOuts.push({ t: times[x.s], dur, side: side === 'l' ? 'left' : 'right' });
    }
  }
  shakeOuts.sort((a, b) => a.t - b.t);

  // High steps: a foot lifted a long way, or placed above the other knee.
  const highSteps = feet.filter((m) => {
    if (m.up >= 0.7) return true;
    const i = idxAt(m.t1);
    const otherKnee = m.side === 'left' ? LM.rKnee : LM.lKnee;
    const fy = limbs[m.side === 'left' ? 'lFoot' : 'rFoot'].ys[i];
    return m.up > 0.3 && isNum(fy) && isNum(tracks[otherKnee].y[i]) && fy < tracks[otherKnee].y[i];
  });

  // Stance width when both feet are planted.
  const widths = [];
  for (let i = wStart; i <= wEnd; i++) {
    if (limbs.lFoot.still[i] && limbs.rFoot.still[i] && isNum(limbs.lFoot.xs[i]) && isNum(limbs.rFoot.xs[i])) {
      widths.push(Math.abs(limbs.lFoot.xs[i] - limbs.rFoot.xs[i]) / T);
    }
  }
  const stanceWidth = widths.length >= 5 ? median(widths) : null;

  // ----- per hand move -----
  const moves = [];
  let prevArrive = times[wStart];
  hands.forEach((m, k) => {
    const i0 = idxAt(m.t0), i1 = idxAt(m.t1);
    const holdSide = other(m.side), hk = sideKey(holdSide);
    const setup = Math.max(0, m.t0 - prevArrive);
    const feetBefore = feet.filter((f) => f.t1 >= prevArrive - 0.2 && f.t1 <= m.t0 + 0.15);
    // Holding arm during the reach (only while that hand is on its hold).
    const holdAngles = [];
    for (let i = i0; i <= i1; i++) if (limbs[holdSide === 'left' ? 'lHand' : 'rHand'].still[i] && isNum(elbow[hk][i]) && elbow[hk][i] >= CFG.minElbow) holdAngles.push(elbow[hk][i]);
    const holdElbow = holdAngles.length ? median(holdAngles) : null;
    // Hips over feet at launch.
    const fx = [limbs.lFoot.xs[i0], limbs.rFoot.xs[i0]].filter(isNum);
    const balance = fx.length && isNum(comX[i0]) ? Math.abs(comX[i0] - mean(fx)) / T : null;
    // Legs vs arms while the body rises into the move.
    let leg = 0, arm = 0;
    for (let i = Math.max(wStart, i0 - Math.round(0.6 / dt)); i <= i1; i++) {
      if (!(isNum(vY[i]) && vY[i] > CFG.upwardSpeed)) continue;
      for (const s of ['l', 'r']) {
        const kv = (knee[s][Math.min(n - 1, i + 1)] - knee[s][Math.max(0, i - 1)]) / (2 * dt);
        const ev = (elbow[s][Math.min(n - 1, i + 1)] - elbow[s][Math.max(0, i - 1)]) / (2 * dt);
        if (limbs[s + 'Foot'].still[i] && isNum(kv) && kv > 0) leg += kv;
        if (limbs[s + 'Hand'].still[i] && isNum(ev) && ev < 0) arm += -ev;
      }
    }
    const legShare = leg + arm > 60 ? leg / (leg + arm) : null;
    let peakUp = 0;
    for (let i = i0; i <= i1; i++) if (isNum(vY[i])) peakUp = Math.max(peakUp, vY[i]);
    const dynamic = peakUp > CFG.dynoSpeed;
    const jolt = jerky.some((j) => j.t >= m.t1 - 0.3 && j.t <= m.t1 + 0.8);
    const handKey = m.side === 'left' ? 'lHand' : 'rHand';
    const regrip = c.handAdjustAllowed
      ? limbs[handKey].adjustments.some((a) => a.t0 >= m.t1 - 0.05 && a.t0 - m.t1 <= 2.5)
      : null;
    const cut = feetCuts.some((f) => f.t >= m.t0 - 0.2 && f.t <= m.t1 + 1);
    const hesitated = pauses.some((p) => p.type === 'hesitation' && p.t1 >= prevArrive && p.t0 <= m.t0);
    moves.push({
      n: k + 1, t0: round(m.t0, 2), t1: round(m.t1, 2), side: m.side,
      reach: round(m.dist, 2), up: round(m.up, 2), dur: round(m.t1 - m.t0, 2), setup: round(setup, 2),
      feetBefore: feetBefore.length, feetUp: feetBefore.some((f) => f.up > 0.15),
      holdElbow: isNum(holdElbow) ? Math.round(holdElbow) : null,
      balance: isNum(balance) ? round(balance, 2) : null,
      legShare: isNum(legShare) ? round(legShare, 2) : null,
      dynamic, jolt, regrip, cut, hesitated,
    });
    prevArrive = m.t1;
  });

  // ----- sections: start / middle / top -----
  const sections = [];
  const span = times[wEnd] - times[wStart];
  if (span > 6) {
    for (let k = 0; k < 3; k++) {
      const t0 = times[wStart] + (span * k) / 3, t1 = times[wStart] + (span * (k + 1)) / 3;
      const a = idxAt(t0), b = idxAt(t1);
      const ms = moves.filter((m) => m.t0 >= t0 && m.t0 < t1);
      const staticArm = [];
      for (let i = a; i <= b; i++) {
        if (!(isNum(speed[i]) && speed[i] < CFG.staticSpeed)) continue;
        for (const s of ['l', 'r']) if (limbs[s + 'Hand'].still[i] && isNum(elbow[s][i]) && elbow[s][i] >= CFG.minElbow) staticArm.push(elbow[s][i]);
      }
      const h0 = height[a], h1 = height[b];
      sections.push({
        name: ['Start', 'Middle', 'Top'][k], t0: round(t0, 2), t1: round(t1, 2),
        moves: ms.length,
        gain: isNum(h0) && isNum(h1) ? round(h1 - h0, 2) : null,
        straightArm: staticArm.length >= 4 ? round(staticArm.filter((x) => x >= CFG.straightElbow).length / staticArm.length, 2) : null,
        setup: ms.length ? round(mean(ms.map((m) => m.setup)), 2) : null,
        feetFirst: ms.length ? round(ms.filter((m) => m.feetBefore > 0).length / ms.length, 2) : null,
        jolts: jerky.filter((j) => j.t >= t0 && j.t < t1).length,
        hesitations: pauses.filter((p) => p.type === 'hesitation' && p.t0 >= t0 && p.t0 < t1).length,
      });
    }
  }

  // ----- left vs right -----
  const armStats = (s) => {
    const a = [];
    for (let i = wStart; i <= wEnd; i++) {
      if (!(isNum(speed[i]) && speed[i] < CFG.staticSpeed)) continue;
      if (limbs[s + 'Hand'].still[i] && isNum(elbow[s][i]) && elbow[s][i] >= CFG.minElbow) a.push(elbow[s][i]);
    }
    return a.length >= 4 ? { straight: round(a.filter((x) => x >= CFG.straightElbow).length / a.length, 2), bent: round(a.filter((x) => x < 110).length / a.length, 2) } : null;
  };
  const sides = {
    handMoves: { left: hands.filter((m) => m.side === 'left').length, right: hands.filter((m) => m.side === 'right').length },
    footMoves: { left: feet.filter((m) => m.side === 'left').length, right: feet.filter((m) => m.side === 'right').length },
    highSteps: { left: highSteps.filter((m) => m.side === 'left').length, right: highSteps.filter((m) => m.side === 'right').length },
    arms: { left: armStats('l'), right: armStats('r') },
  };

  const withFeet = moves.filter((m) => m.feetBefore > 0).length;
  const summary = {
    feetFirstRatio: moves.length >= 3 && limbs.lFoot.visible >= 0.3 ? withFeet / moves.length : null,
    avgSetup: moves.length ? mean(moves.map((m) => m.setup)) : null,
    controlledRatio: moves.length >= 3 ? moves.filter((m) => !m.jolt && !m.cut).length / moves.length : null,
    feetCuts: feetCuts.length,
    highSteps: highSteps.length,
    shakeOuts: shakeOuts.length,
    stanceWidth,
  };
  return {
    moves, sections, sides, summary,
    extras: { feetCuts, shakeOuts: shakeOuts.map((x) => ({ ...x, t: round(x.t, 2), dur: round(x.dur, 1) })), highSteps: highSteps.map((m) => ({ t: round(m.t0, 2), side: m.side })) },
  };
}
