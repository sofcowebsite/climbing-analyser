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
  maxGapSec: 0.7,
  smoothSec: 0.3,
  handMoveOn: 0.8, footMoveOn: 0.5, limbStill: 0.35, stillHoldSec: 0.3,
  // Hand moves are usually bigger than foot moves; a 15 cm foot step is a real move.
  handMoveDist: 0.4, footMoveDist: 0.25, handAdjustDist: 0.12, footAdjustDist: 0.08,
  minElbow: 40, // anything tighter is almost always a tracking glitch
  pauseSpeed: 0.15, pauseMinSec: 1.2, restMinSec: 4,
  staticSpeed: 0.25,
  straightElbow: 145,
  upwardSpeed: 0.3,
  jerkAccel: 7,
  dynoSpeed: 1.6,
  fallSpeed: 2.5, fallDrop: 1.2,
  turnedRatio: 0.65,
};

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

// Builds smoothed per-landmark tracks: tracks[idx] = { x: [], y: [] } (NaN where unknown).
function buildTracks(frames, dt) {
  const n = frames.length;
  const coreOk = frames.map((f) => !!f.p && mean(CORE.map((i) => f.p[i][2])) >= CFG.minCoreVis);
  const maxGap = Math.max(1, Math.round(CFG.maxGapSec / dt));
  const win = Math.max(1, Math.round(CFG.smoothSec / dt) | 1);
  const tracks = {};
  const needed = new Set([...KEPT_LANDMARKS]);
  for (const idx of needed) {
    const xs = new Array(n), ys = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = frames[i].p;
      const ok = coreOk[i] && p[idx][2] >= (CORE.includes(idx) ? 0 : CFG.minPointVis);
      xs[i] = ok ? p[idx][0] : NaN;
      ys[i] = ok ? p[idx][1] : NaN;
    }
    tracks[idx] = { x: smooth(fillGaps(xs, maxGap), win), y: smooth(fillGaps(ys, maxGap), win) };
  }
  return { tracks, coreOk };
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
// A limb is "still" when its speed stays under limbStill; each run of motion between two
// still periods is classified by how far the limb ended up from where it started.
function segmentLimb(xs, ys, times, dt, T, isHand) {
  const n = xs.length;
  const vx = derivative(xs, dt), vy = derivative(ys, dt);
  const speed = vx.map((v, i) => (isNum(v) && isNum(vy[i]) ? Math.hypot(v, vy[i]) / T : NaN));
  const minPeak = isHand ? CFG.handMoveOn : CFG.footMoveOn;
  const moveDist = isHand ? CFG.handMoveDist : CFG.footMoveDist;
  const adjustDist = isHand ? CFG.handAdjustDist : CFG.footAdjustDist;
  const stillN = Math.max(1, Math.round(CFG.stillHoldSec / dt));
  const still = speed.map((s) => isNum(s) && s < CFG.limbStill);
  // Only still runs long enough to count as "on a hold".
  const holds = runs(n, (i) => still[i]).filter((r) => r.e - r.s + 1 >= stillN);
  const moves = [], adjustments = [];
  for (let k = 1; k < holds.length; k++) {
    const a = holds[k - 1].e, b = holds[k].s;
    let peak = 0, gap = false;
    for (let i = a; i <= b; i++) { if (isNum(speed[i])) peak = Math.max(peak, speed[i]); else gap = true; }
    if (gap) continue;
    const d = Math.hypot(xs[b] - xs[a], ys[b] - ys[a]) / T;
    const ev = { t0: times[a], t1: times[b], dist: d, peak, up: (ys[a] - ys[b]) / T };
    if (d >= moveDist && peak >= minPeak) moves.push(ev);
    else if (d >= adjustDist) adjustments.push(ev);
  }
  return { moves, adjustments, still, speed };
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

  const { tracks, coreOk } = buildTracks(frames, dt);

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
    return { ok: false, reason: 'Could not find a climber in enough of the video. Make sure your whole body is visible and well lit.', detected };
  }
  if (T < 0.035) warnings.push('You look very small in the frame, so measurements are less precise. Film closer or zoom in slightly.');
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

  // Falls: fast, large drop.
  const falls = [];
  for (const r of runs(n, (i) => isNum(vY[i]) && vY[i] < -CFG.fallSpeed)) {
    const hBefore = height[Math.max(0, r.s - 1)];
    const hAfter = height[Math.min(n - 1, r.e + Math.round(0.5 / dt))];
    if (isNum(hBefore) && isNum(hAfter) && hBefore - hAfter > CFG.fallDrop) falls.push({ t: times[r.s], drop: hBefore - hAfter });
  }
  // End the window at the high point if the climber comes down afterwards (lower-off / fall / jump down).
  const lastValid = n - 1 - [...comY].reverse().findIndex(isNum);
  if (maxIdx > wStart && lastValid - maxIdx > Math.round(1.5 / dt) && maxH - height[lastValid] > 0.8) {
    wEnd = Math.min(lastValid, maxIdx + Math.round(0.5 / dt));
  } else wEnd = lastValid;
  if (wEnd - wStart < Math.round(3 / dt)) { wStart = firstValid; wEnd = lastValid; }
  const inW = (i) => i >= wStart && i <= wEnd;
  const climbTime = times[wEnd] - times[wStart];

  // ----- limb events -----
  const limbs = {};
  for (const key of Object.keys(LIMB_POINTS)) {
    const xs = [], ys = [];
    for (let i = 0; i < n; i++) {
      const p = inW(i) ? limbPoint(tracks, key, i) : [NaN, NaN];
      xs.push(p[0]); ys.push(p[1]);
    }
    const visible = xs.filter(isNum).length / Math.max(1, wEnd - wStart + 1);
    limbs[key] = { ...segmentLimb(xs, ys, times, dt, T, key.endsWith('Hand')), visible, xs, ys };
  }
  const handMoves = [...limbs.lHand.moves.map((m) => ({ ...m, side: 'left' })), ...limbs.rHand.moves.map((m) => ({ ...m, side: 'right' }))];
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

  const metrics = {
    climbTime,
    movingTime,
    heightGain: gain, // torso lengths
    handMoves: handMoveCount,
    footMoves: footMoveCount,
    movesPerMin: climbTime > 0 ? (handMoveCount / climbTime) * 60 : null,
    footHandRatio: handMoveCount >= 3 && feetVisible >= 0.4 && !feetLost ? footMoveCount / handMoveCount : null,
    footReadjustRate: footMoveCount >= 3 && feetVisible >= 0.4 ? footAdjust / footMoveCount : null,
    handReadjustRate: handMoveCount >= 3 && handsVisible >= 0.4 ? handAdjust / handMoveCount : null,
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
  };

  // ----- key moments -----
  const events = [];
  for (const f of falls) events.push({ t: f.t, kind: 'fall', label: 'Fall or drop' });
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
