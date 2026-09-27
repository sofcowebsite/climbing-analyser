// Did the climber finish, and if they fell, why? Pure functions over the body tracks
// (wall coordinates, torso-length units), testable in Node.
//
// Finishing signals: a mantle/top-out, climbing out of the top of the frame, or matching
// the highest hold and holding it before coming down in control. Falling signals: a fast,
// free-fall-like drop, especially one that starts within about a second of reaching a
// hold (the hold was never really held). Every conclusion carries its evidence and a
// confidence level, and alternatives are listed when the evidence is ambiguous.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (a) => { const b = a.filter(isNum); return b.length ? b.reduce((s, v) => s + v, 0) / b.length : NaN; };
const f1 = (v) => (Math.round(v * 10) / 10).toString();
// Torso lengths -> rough metres (torso ≈ 30% of an average 1.7 m climber).
export const metres = (t) => `${(Math.round(t * 0.51 * 2) / 2).toFixed(1)} m`;

function runs(n, pred) {
  const out = [];
  let s = -1;
  for (let i = 0; i < n; i++) {
    if (pred(i)) { if (s < 0) s = i; } else if (s >= 0) { out.push({ s, e: i - 1 }); s = -1; }
  }
  if (s >= 0) out.push({ s, e: n - 1 });
  return out;
}

export const OUT_CFG = {
  dropSpeed: 1.6,        // T/s: a drop at least this fast is a candidate fall
  dropMin: 0.8,          // T: minimum height lost
  freeFallAccel: 6,      // T/s²: free fall is ~19 T/s²; lowering/down-climbing is far gentler
  holdToCount: 1.0,      // s: a hold must be held at least this long to count as "held"
  stableBeforeDismount: 1.2,
};

/**
 * Finds significant descents. Each is { s, e, t, tEnd, drop, peakSpeed, onsetAccel, kind }
 * where kind is 'fast' (free-fall-like) or 'controlled' (lowering / down-climbing).
 */
export function detectDrops({ height, vY, times, dt }) {
  const n = height.length;
  const out = [];
  const pad = Math.round(0.2 / dt);
  let cand = runs(n, (i) => isNum(vY[i]) && vY[i] < -0.4);
  // Merge runs separated by tiny gaps.
  cand = cand.reduce((acc, r) => {
    const last = acc[acc.length - 1];
    if (last && r.s - last.e <= pad) last.e = r.e; else acc.push({ ...r });
    return acc;
  }, []);
  for (const r of cand) {
    let peak = 0;
    for (let i = r.s; i <= r.e; i++) if (isNum(vY[i])) peak = Math.max(peak, -vY[i]);
    const before = height.slice(Math.max(0, r.s - Math.round(0.5 / dt)), r.s + 1).filter(isNum);
    const after = height.slice(r.e, Math.min(n, r.e + Math.round(0.8 / dt))).filter(isNum);
    if (!before.length || !after.length) continue;
    const drop = Math.max(...before) - Math.min(...after);
    if (drop < OUT_CFG.dropMin) continue;
    // How quickly did it get going? Free fall reaches high speed almost immediately.
    const k = Math.min(r.e, r.s + Math.round(0.4 / dt));
    let onsetAccel = 0;
    for (let i = r.s; i <= k; i++) if (isNum(vY[i])) onsetAccel = Math.max(onsetAccel, -vY[i] / Math.max(dt, times[i] - times[r.s] + dt));
    const dur = times[r.e] - times[r.s];
    const fast = peak >= OUT_CFG.dropSpeed && (onsetAccel >= OUT_CFG.freeFallAccel || dur < 1.2);
    out.push({ s: r.s, e: r.e, t: times[r.s], tEnd: times[r.e], drop, peakSpeed: peak, onsetAccel, kind: fast ? 'fast' : 'controlled' });
  }
  return out;
}

// Tracking lost while moving down fast (motion blur during a fall often loses the pose).
export function lostWhileDropping({ height, vY, times, dt, coreOk }) {
  const n = height.length;
  let L = -1;
  for (let i = n - 1; i >= 0; i--) if (coreOk[i]) { L = i; break; }
  if (L < 0) return null;
  const tail = times[n - 1] - times[L];
  const k = Math.max(0, L - Math.round(0.4 / dt));
  const v = mean(vY.slice(k, L + 1));
  const dh = height[k] - height[L];
  if (tail >= 0.5 && isNum(v) && v < -1.2 && dh > 0.3) return { s: k, e: L, t: times[k], tEnd: times[L], drop: dh, peakSpeed: -v, onsetAccel: OUT_CFG.freeFallAccel, kind: 'fast', lost: true };
  return null;
}

// ---------- finishing signals ----------

function topOutSignals(c) {
  const { n, times, dt, heights: H, maxIdx, frames, coreOk, vY, limbs } = c;
  const maxH = H.com[maxIdx];
  // Mantle: near the top, both hands pressing down below the shoulders while the hips rise
  // up to hand level.
  const mantle = runs(n, (i) => {
    if (!(isNum(H.com[i]) && H.com[i] >= maxH - 0.6)) return false;
    const lw = H.lWrist[i], rw = H.rWrist[i], ls = H.lShoulder[i], rs = H.rShoulder[i], hip = H.hip[i];
    if (![lw, rw, ls, rs, hip].every(isNum)) return false;
    const below = lw < ls - 0.15 && rw < rs - 0.15;
    return below && hip >= Math.min(lw, rw) - 0.45 && (limbs.lHand.still[i] || limbs.rHand.still[i]);
  }).filter((r) => times[r.e] - times[r.s] >= 0.5);
  let stood = false;
  if (mantle.length) {
    const m = mantle[mantle.length - 1];
    const handLevel = Math.min(H.lWrist[m.s], H.rWrist[m.s]);
    for (let i = m.s; i < n; i++) if (isNum(H.lFoot[i]) && isNum(H.rFoot[i]) && Math.max(H.lFoot[i], H.rFoot[i]) >= handLevel - 0.3) { stood = true; break; }
  }
  // Climbing out of the top of the picture.
  let L = -1;
  for (let i = n - 1; i >= 0; i--) if (coreOk[i]) { L = i; break; }
  let outTop = false;
  if (L > 0 && frames[L]?.p) {
    const p = frames[L].p;
    const topY = Math.min(p[0][1], p[11][1], p[12][1]);
    const upward = mean(vY.slice(Math.max(0, L - Math.round(1 / dt)), L + 1));
    const nearEnd = L >= maxIdx - Math.round(0.5 / dt);
    outTop = topY < 0.08 && isNum(upward) && upward > 0.15 && nearEnd;
  }
  return { mantle: mantle.length ? { t: times[mantle[mantle.length - 1].s], dur: times[mantle[mantle.length - 1].e] - times[mantle[mantle.length - 1].s] } : null, stood, outTop };
}

// A hand that went up in the seconds before index s, however briefly it touched the hold.
// (Hold detection needs a limb to be still for a moment; a hold touched for 0.2 s before
// falling off wouldn't register as a move otherwise.)
export function recentReach(c, s) {
  const { times, dt, heights: H, handMoves } = c;
  let best = null;
  for (const [side, key, hk] of [['left', 'lWrist', 'lHand'], ['right', 'rWrist', 'rHand']]) {
    const from = Math.max(0, s - Math.round(1.5 / dt));
    const seg = H[key].slice(from, s + 1);
    if (seg.filter(isNum).length < 3 || !isNum(H[key][s])) continue;
    const lo = Math.min(...seg.filter(isNum));
    const rise = H[key][s] - lo;
    if (rise < 0.45) continue;
    const i0 = from + seg.indexOf(lo);
    let i1 = s;
    for (let i = i0; i <= s; i++) if (isNum(H[key][i]) && H[key][i] >= H[key][s] - 0.1) { i1 = i; break; }
    const known = handMoves.find((m) => m.side === side && Math.abs(m.t1 - times[i1]) < 0.5);
    const cand = {
      side, t0: times[i0], t1: times[i1], dist: known ? known.dist : rise, inferred: !known, handKey: hk,
      n: known ? known.n : (handMoves.length ? Math.max(...handMoves.map((m) => m.n || 0)) + 1 : 1),
    };
    if (!best || cand.t1 > best.t1) best = cand;
  }
  return best;
}

// How long the highest hold was held, and whether the hands were matched on it.
function heldAtTop(c, dropStartIdx) {
  const { n, times, dt, heights: H, limbs, handMoves, T } = c;
  const end = dropStartIdx ?? n - 1;
  let last = [...handMoves].filter((m) => m.t1 <= times[end] + 0.05).sort((a, b) => b.t1 - a.t1)[0];
  const reach = dropStartIdx != null ? recentReach(c, dropStartIdx) : null;
  if (reach && (!last || reach.t1 > last.t1 + 0.2)) last = reach;
  if (!last) return { held: 0, matched: false, lastMove: null };
  const i1 = Math.max(0, Math.min(n - 1, Math.round((last.t1 - times[0]) / dt)));
  let held = 0;
  const handKey = last.side === 'left' ? 'lHand' : 'rHand';
  for (let i = i1; i <= end; i++) { if (limbs[handKey].still[i] || !isNum(limbs[handKey].speed[i])) held = times[i] - times[i1]; else break; }
  // Matched: both hands close together near the highest hand position.
  let matched = false;
  for (let i = i1; i <= end; i++) {
    const lx = limbs.lHand.xs[i], rx = limbs.rHand.xs[i], ly = limbs.lHand.ys[i], ry = limbs.rHand.ys[i];
    // Two hands on one hold sit within about a hand's width of each other.
    if ([lx, rx, ly, ry].every(isNum) && Math.hypot(lx - rx, ly - ry) / T < 0.35) { matched = true; break; }
  }
  return { held, matched, lastMove: last };
}

/**
 * Classifies how the attempt ended and analyses every fall.
 * Returns { result, confidence, headline, evidence[], alternatives[], falls[], dismount }.
 */
export function classifyOutcome(c) {
  const { times, drops, heights: H, maxIdx, n } = c;
  const top = topOutSignals(c);
  const maxH = H.com[maxIdx];

  // Label each fast drop: a fall, or getting down on purpose after finishing.
  const labelled = drops.filter((d) => d.kind === 'fast').map((d) => {
    const h = heldAtTop(c, d.s);
    const atTop = isNum(H.com[d.s]) && H.com[d.s] >= maxH - 0.5;
    const afterTopOut = top.mantle && top.mantle.t < d.t;
    // Only call it "getting down on purpose" with real finishing evidence: a top-out, or
    // both hands matched on the highest hold and held. A long hang and then a drop is not
    // proof of finishing: that is also exactly what running out of strength looks like.
    const deliberate = afterTopOut || (atTop && h.matched && h.held >= OUT_CFG.stableBeforeDismount);
    const out = { ...d, held: h.held, matched: h.matched, lastMove: h.lastMove, atTop, type: deliberate ? 'dismount' : 'fall' };
    if (!deliberate) out.autopsy = fallAutopsy(c, out);
    return out;
  });
  const falls = labelled.filter((d) => d.type === 'fall');
  // The attempt ended in a fall if the climber never got meaningfully higher afterwards.
  const finalFall = [...falls].reverse().find((f) => {
    const later = H.com.slice(f.e).filter(isNum);
    return !later.length || Math.max(...later) < H.com[f.s] + 0.3;
  });
  const dismount = labelled.find((d) => d.type === 'dismount') || null;
  const controlled = drops.find((d) => d.kind === 'controlled' && d.s >= maxIdx - 2);
  const held = heldAtTop(c, finalFall ? finalFall.s : dismount ? dismount.s : controlled ? controlled.s : null);

  const ev = [], alt = [];
  let result = 'unknown', confidence = 'low', headline = '';
  if (top.mantle && !finalFall) {
    result = 'topped';
    confidence = top.stood ? 'high' : 'medium';
    headline = top.stood ? 'Topped out' : 'Topped out (probably)';
    ev.push(`At ${f1(top.mantle.t)} s you pressed down with both hands below your shoulders while your hips came up to hand level. That's a mantle over the top.`);
    if (top.stood) ev.push('Then you brought your feet up to where your hands were and stood up.');
    else alt.push('We saw the mantle but not you standing up on top. If you slipped back off the lip, correct this.');
  } else if (top.outTop && !finalFall) {
    result = 'topped'; confidence = 'medium'; headline = 'Climbed out of view at the top';
    ev.push('You were still moving up when you went out of the top of the picture, and we didn\'t see a fall.');
    alt.push('We couldn\'t see the finish itself. If you fell after going out of view, correct this.');
  } else if (finalFall) {
    result = 'fell';
    // Use the same timing as the fall breakdown so the numbers agree.
    if (isNum(finalFall.autopsy?.stick)) finalFall.held = finalFall.autopsy.stick;
    const quick = isNum(finalFall.held) && finalFall.held < OUT_CFG.holdToCount;
    const letGo = (finalFall.autopsy?.causes || []).filter((x) => ['footSlip', 'handSlip', 'barnDoor', 'feetCut'].includes(x.key) && x.confidence !== 'low');
    // Second-guess: a long, calm hang at the top with nothing slipping could also be a
    // deliberate drop-off from the finish.
    const ambiguous = !quick && !letGo.length && finalFall.atTop && finalFall.held >= 2;
    confidence = ambiguous ? 'low' : (quick || letGo.length) && finalFall.drop >= 1.2 ? 'high' : 'medium';
    headline = ambiguous ? 'Came off (fell or let go?)' : 'Fell';
    ev.push(`Your body dropped about ${metres(finalFall.drop)} in ${f1(Math.max(0.1, finalFall.tEnd - finalFall.t))} s at ${f1(finalFall.t)} s. That's a fall, not a controlled descent${finalFall.lost ? ' (tracking was lost during the drop, which fast falls often cause)' : ''}.`);
    if (finalFall.lastMove) {
      ev.push(quick
        ? `${finalFall.held < 0.1 ? 'It started the instant' : `It started only ${f1(finalFall.held)} s after`} your ${finalFall.lastMove.side} hand reached its hold, so that hold was never really held.`
        : `You had been on your last hold for ${f1(finalFall.held)} s before it happened.`);
    }
    const what = { footSlip: 'a foot slipped', handSlip: 'a hand slid off', barnDoor: 'your body swung out', feetCut: 'your feet cut loose' };
    if (letGo.length) ev.push(`Something let go first: ${letGo.map((x) => what[x.key]).join(', ')}.`);
    if (!quick && finalFall.atTop && finalFall.held >= 0.8 && !letGo.length) alt.push('We did not see your hands matched or a top-out. If that was the finish hold and you let go on purpose, mark this climb as sent.');
  } else if (held.held >= 1.5 && (held.matched || dismount || controlled)) {
    result = 'finished'; confidence = held.matched && held.held >= 2 ? 'medium' : 'low';
    headline = held.matched ? 'Matched the top hold and held it' : 'Held the highest hold';
    ev.push(`You ${held.matched ? 'matched both hands on' : 'held'} your highest hold for ${f1(held.held)} s${dismount ? ', then dropped off deliberately' : controlled ? ', then came down in control' : ''}.`);
    alt.push('We can\'t see whether that was the actual finish hold. Correct this if it wasn\'t.');
  } else if (controlled) {
    result = 'finished'; confidence = 'low'; headline = 'Came down in control';
    ev.push('You came down steadily (lowering or down-climbing) rather than falling.');
    alt.push('That could be lowering off the top, taking on the rope, or down-climbing. We can\'t tell which, so please confirm.');
  } else {
    const endMoving = maxIdx >= n - 1 - Math.round(1 / c.dt);
    headline = endMoving ? 'Video ends mid-climb' : 'Not sure';
    ev.push(endMoving ? 'The video stops while you are still climbing, so we can\'t tell how it ended.' : 'We couldn\'t see a clear finish or a clear fall.');
  }
  return { result, confidence, headline, evidence: ev, alternatives: alt, falls, dismount, finalFallT: finalFall ? finalFall.t : null };
}

// ---------- why did they fall? ----------

/**
 * Looks at the seconds before each fall and lists likely causes with evidence.
 * Each cause: { key, confidence, evidence, limb }.
 */
export function fallAutopsy(c, fall) {
  const { times, dt, n, T, vY, vX, comX, limbs, handMoves, footMoves, elbow, speed, heights: H, trackQuality } = c;
  const s = fall.s;
  const at = (t) => Math.max(0, Math.min(n - 1, Math.round((t - times[0]) / dt)));
  const tS = times[s];
  const causes = [];
  const conf = (score, limbKey) => {
    let q = score;
    if (limbKey && limbs[limbKey]) {
      const seen = limbs[limbKey].seen.slice(at(tS - 1.5), s + 1);
      const frac = seen.filter(Boolean).length / Math.max(1, seen.length);
      if (frac < 0.5) q -= 1;
    }
    if (trackQuality === 'low') q -= 1;
    return q >= 2 ? 'high' : q >= 1 ? 'medium' : 'low';
  };

  let lastMove = [...handMoves].filter((m) => m.t1 <= tS + 0.3 && m.t1 >= tS - 5).sort((a, b) => b.t1 - a.t1)[0] || null;
  const reach = recentReach(c, s);
  if (reach && (!lastMove || reach.t1 > lastMove.t1 + 0.2)) lastMove = reach;
  const inMove = handMoves.find((m) => m.t0 <= tS && tS <= m.t1 + 0.1) || null;
  const move = inMove || lastMove;
  const stick = move ? Math.max(0, tS - move.t1) : null;

  // 1. Which limb let go first? Look for a hand or foot dropping before the body does.
  const firstDrop = (key) => {
    const ys = limbs[key].ys;
    for (let i = at(tS - 1.2); i <= Math.min(n - 1, s + Math.round(0.1 / dt)); i++) {
      const a = ys[i], b = ys[Math.min(n - 1, i + 1)];
      if (!isNum(a) || !isNum(b)) continue;
      const v = (b - a) / dt / T; // downward positive (image y grows downward)
      const j = Math.min(n - 1, i + Math.round(0.4 / dt));
      const drop = isNum(ys[j]) ? (ys[j] - a) / T : 0;
      const bodyStill = !isNum(vY[i]) || vY[i] > -0.8;
      if (v > 1.2 && drop > 0.25 && bodyStill) return { i, t: times[i], lead: tS - times[i], drop };
    }
    return null;
  };
  const feetFirst = ['lFoot', 'rFoot'].map((k) => ({ k, d: firstDrop(k) })).filter((x) => x.d && x.d.lead >= 0.05).sort((a, b) => b.d.lead - a.d.lead);
  const handsFirst = ['lHand', 'rHand'].map((k) => ({ k, d: firstDrop(k) })).filter((x) => x.d && x.d.lead >= 0.05).sort((a, b) => b.d.lead - a.d.lead);

  if (feetFirst.length && (!handsFirst.length || feetFirst[0].d.t <= handsFirst[0].d.t)) {
    const f = feetFirst[0];
    const side = f.k === 'lFoot' ? 'left' : 'right';
    const placed = footMoves.filter((m) => m.side === side && m.t1 <= f.d.t && m.t1 >= f.d.t - 1.5).sort((a, b) => b.t1 - a.t1)[0];
    const pushing = isNum(vY[f.d.i]) && vY[f.d.i] > 0.3;
    const ctx = [];
    if (placed) ctx.push(`you'd placed it only ${f1(f.d.t - placed.t1)} s earlier`);
    if (pushing) ctx.push('you were pushing up off it at that moment');
    causes.push({
      key: 'footSlip', limb: f.k, side,
      confidence: conf(2 + (f.d.lead > 0.15 ? 1 : 0), f.k),
      evidence: `Your ${side} foot came off ${f1(f.d.lead)} s before the rest of your body started to fall${ctx.length ? ` (${ctx.join(', ')})` : ''}. The hands let go because the foot did, not the other way round.`,
    });
  }
  if (handsFirst.length && !(feetFirst.length && feetFirst[0].d.t < handsFirst[0].d.t)) {
    const hnd = handsFirst[0];
    const side = hnd.k === 'lHand' ? 'left' : 'right';
    causes.push({
      key: 'handSlip', limb: hnd.k, side,
      confidence: conf(2, hnd.k),
      evidence: `Your ${side} hand slid down ${f1(hnd.d.drop)} torso lengths ${f1(hnd.d.lead)} s before your body dropped, while your feet were still on. The grip itself gave way.`,
    });
  }

  // 2. Never held the hold: fall during or right after a hand move.
  if (move && stick !== null && stick <= 0.8) {
    const i0 = at(move.t0), i1 = at(move.t1);
    let peakUp = 0, apex = null;
    for (let i = i0; i <= Math.min(n - 1, i1 + Math.round(0.4 / dt)); i++) {
      if (isNum(vY[i])) {
        peakUp = Math.max(peakUp, vY[i]);
        if (apex === null && peakUp > 0.6 && vY[i] <= 0) apex = i;
      }
    }
    const dynamic = peakUp > 1.2;
    const side = move.side;
    const handKey = side === 'left' ? 'lHand' : 'rHand';
    causes.push({
      key: 'missedCatch', limb: handKey, side,
      confidence: conf(stick <= 0.4 ? 2 : 1, handKey),
      evidence: stick <= 0.05
        ? `You fell while your ${side} hand was still moving to the hold (move #${move.n ?? '?'}).`
        : `You fell ${f1(stick)} s after your ${side} hand reached its hold (move #${move.n ?? '?'}). It was never actually held.`,
    });
    if (dynamic && apex !== null) {
      const late = move.t1 - times[apex];
      if (late > 0.12) {
        causes.push({ key: 'lateCatch', limb: handKey, side, confidence: conf(late > 0.25 ? 2 : 1, handKey), evidence: `This was a dynamic move. Your body reached the top of its motion (the dead point) at ${f1(times[apex])} s, but your hand only arrived ${f1(late)} s later, when you were already dropping.` });
      }
    }
    if (move.dist >= 1.25) {
      causes.push({ key: 'overreach', limb: handKey, side, confidence: conf(move.dist >= 1.5 ? 2 : 1, handKey), evidence: `The reach was long: ${f1(move.dist)} torso lengths from the last hold, so you caught it near full extension with little strength left.` });
    }
    // Feet came off during the move.
    const fast = (k, i) => isNum(limbs[k].speed[i]) && limbs[k].speed[i] > 1.3 && !limbs[k].still[i];
    let cut = false;
    for (let i = i0; i <= s; i++) if (fast('lFoot', i) && fast('rFoot', i)) { cut = true; break; }
    if (cut) causes.push({ key: 'feetCut', limb: 'feet', confidence: conf(2, 'lFoot'), evidence: 'Both feet came off the rock during the move, so your whole body swung out as you caught the hold.' });
    // Lock-off: the other arm was bent hard while reaching.
    const hk = side === 'left' ? 'r' : 'l';
    const angles = [];
    for (let i = i0; i <= i1; i++) if (isNum(elbow[hk][i]) && elbow[hk][i] >= 40) angles.push(elbow[hk][i]);
    const holdElbow = angles.length ? angles.sort((a, b) => a - b)[angles.length >> 1] : NaN;
    if (isNum(holdElbow) && holdElbow < 95) {
      causes.push({ key: 'lockoff', limb: hk === 'l' ? 'lHand' : 'rHand', confidence: conf(holdElbow < 80 ? 2 : 1, hk === 'l' ? 'lHand' : 'rHand'), evidence: `While you reached, your ${hk === 'l' ? 'left' : 'right'} arm was locked off at about ${Math.round(holdElbow)}°. A deep lock-off is very strength-hungry.` });
    }
  }

  // 3. Swinging sideways (barn door).
  let maxVX = 0, dirX = 0;
  for (let i = at(tS - 1); i <= s; i++) if (isNum(vX[i]) && Math.abs(vX[i]) > maxVX) { maxVX = Math.abs(vX[i]); dirX = Math.sign(vX[i]); }
  if (maxVX > 0.9) {
    const fx = [limbs.lFoot.xs[s], limbs.rFoot.xs[s]].filter(isNum);
    const off = fx.length && isNum(comX[s]) ? Math.abs(comX[s] - mean(fx)) / T : NaN;
    if (!isNum(off) || off > 0.4) {
      causes.push({ key: 'barnDoor', limb: 'torso', confidence: conf(maxVX > 1.4 ? 2 : 1), evidence: `Just before the fall your body swung ${dirX > 0 ? 'right' : 'left'} at ${f1(maxVX)} torso lengths per second${isNum(off) ? `, ending ${f1(off)} torso lengths to the side of your feet` : ''}. Nothing was stopping the rotation.` });
    }
  }

  // 4. Stalled, then pumped.
  // Stuck: body AND hands not moving (a reach in progress is not being stuck).
  let still = 0;
  const handsStill = (i) => ['lHand', 'rHand'].every((k) => limbs[k].still[i] || !isNum(limbs[k].speed[i]) || limbs[k].speed[i] < 0.5);
  // (Skip the last half second: that's the letting-go itself.)
  for (let i = s - 1 - Math.round(0.5 / dt); i >= 0; i--) { if (isNum(speed[i]) && speed[i] < 0.25 && handsStill(i)) still += dt; else break; }
  if (still >= 2.5) causes.push({ key: 'stalled', limb: 'arms', confidence: conf(still >= 4 ? 2 : 1), evidence: `You were stuck in the same position for ${f1(still)} s right before falling.` });
  const from = at(tS - 15);
  const arm = [];
  for (let i = from; i <= s; i++) {
    if (!(isNum(speed[i]) && speed[i] < 0.25)) continue;
    for (const sd of ['l', 'r']) if (limbs[sd + 'Hand'].still[i] && isNum(elbow[sd][i]) && elbow[sd][i] >= 40) arm.push(elbow[sd][i]);
  }
  const bentShare = arm.length >= 8 ? arm.filter((a) => a < 145).length / arm.length : NaN;
  const onWall = tS - c.climbStart;
  if (isNum(bentShare) && bentShare >= 0.65 && (onWall > 25 || still >= 2.5)) {
    causes.push({ key: 'pump', limb: 'arms', confidence: conf(bentShare >= 0.8 && onWall > 40 ? 2 : 1), evidence: `In the 15 s before the fall your arms were bent ${Math.round(bentShare * 100)}% of the time you held still, after ${Math.round(onWall)} s on the wall${c.restsBefore(tS) ? '' : ' without a proper rest'}. That builds pump fast.` });
  }

  if (!causes.length) causes.push({ key: 'unclear', limb: move ? (move.side === 'left' ? 'lHand' : 'rHand') : 'arms', confidence: 'low', evidence: 'Your feet were on, you weren\'t swinging and the reach wasn\'t extreme, so the body positions don\'t point to one clear cause.' });

  const rank = { high: 3, medium: 2, low: 1 };
  const order = ['footSlip', 'handSlip', 'feetCut', 'lateCatch', 'overreach', 'barnDoor', 'lockoff', 'missedCatch', 'stalled', 'pump', 'unclear'];
  causes.sort((a, b) => (rank[b.confidence] - rank[a.confidence]) || (order.indexOf(a.key) - order.indexOf(b.key)));
  return {
    t: tS, drop: fall.drop, lost: !!fall.lost,
    move: move ? { n: move.n, side: move.side, t0: move.t0, t1: move.t1 } : null,
    stick, causes,
    replay: { t0: Math.max(times[0], tS - 3), t1: Math.min(times[n - 1], tS + 0.6) },
  };
}
