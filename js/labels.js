// Multi-label movement annotation, following an observational framework for climbing video:
//  - the climb is cut into short windows and each gets several labels (not one "move" label);
//  - left/right, contact state and a visibility/confidence label are kept for everything;
//  - things a single camera can't show (grip type, hip-to-wall distance, whether a foothold
//    is weighted, force, crack jam type) are labelled "unknown" rather than guessed;
//  - transitions (reach, probe, grip-set, weight transfer, foot-set, match, cross-through,
//    release, catch, regrip, rest/shake...) are separate timestamped events;
//  - whole-body states follow the PLOS ONE (2017) route-previewing study: immobility,
//    postural regulation, hold exploration, hold change and hold traction.
// The thresholds are this app's implementation choices, not validated diagnostic rules.
// Pure module: no DOM, testable in Node.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (a) => { const b = a.filter(isNum); return b.length ? b.reduce((s, v) => s + v, 0) / b.length : NaN; };
const r2 = (v) => Math.round(v * 100) / 100;

function runs(n, pred) {
  const out = [];
  let s = -1;
  for (let i = 0; i < n; i++) {
    if (pred(i)) { if (s < 0) s = i; } else if (s >= 0) { out.push({ s, e: i - 1 }); s = -1; }
  }
  if (s >= 0) out.push({ s, e: n - 1 });
  return out;
}

export const SEGMENT_SEC = 0.5;
export const TERRAINS = ['slab', 'vertical', 'overhang', 'roof', 'arete', 'corner/dihedral', 'crack', 'unknown'];
const LIMBS = [['lHand', 'left', 'hand'], ['rHand', 'right', 'hand'], ['lFoot', 'left', 'foot'], ['rFoot', 'right', 'foot']];

// ---------- events ----------

// Holds: runs where a limb is still AND actually seen, long enough to count as "on a hold".
function holdsOf(limb, dt) {
  const minN = Math.max(2, Math.round(0.3 / dt));
  return runs(limb.still.length, (i) => limb.still[i] && limb.seen[i]).filter((r) => r.e - r.s + 1 >= minN);
}
const posAt = (limb, i) => [limb.xs[i], limb.ys[i]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function detectEvents(c) {
  const { times, dt, T, n, limbs, handMoves, footMoves, vY, comX, heights: H, pauses, falls } = c;
  const ev = [];
  const add = (t, type, extra = {}) => ev.push({ t: r2(t), type, ...extra });

  // Hand and foot moves: reach / release at the start, contact at the end.
  for (const m of handMoves) {
    add(m.t0, 'release', { limb: 'hand', side: m.side, move: m.n });
    add(m.t0, m.up < -0.3 ? 'reverse/downclimb' : 'hand_reach', { limb: 'hand', side: m.side, move: m.n });
    const i0 = Math.round((m.t0 - times[0]) / dt), i1 = Math.round((m.t1 - times[0]) / dt);
    let peak = 0;
    for (let i = i0; i <= i1; i++) if (isNum(vY[i])) peak = Math.max(peak, vY[i]);
    add(m.t1, peak > 1.2 ? 'catch' : 'grip_set', { limb: 'hand', side: m.side, move: m.n, dynamic: peak > 1.2 });
    // Weight transfer: the body follows the new hold within 1.5 s (rises, or shifts toward it).
    const j = Math.min(n - 1, i1 + Math.round(2 / dt));
    const rise = isNum(H.com[j]) && isNum(H.com[i1]) ? H.com[j] - H.com[i1] : NaN;
    const hk = m.side === 'left' ? 'lHand' : 'rHand';
    const shift = isNum(comX[j]) && isNum(comX[i1]) && isNum(limbs[hk].xs[i1]) ? (Math.abs(limbs[hk].xs[i1] - comX[i1]) - Math.abs(limbs[hk].xs[i1] - comX[j])) / T : NaN;
    if ((isNum(rise) && rise > 0.2) || (isNum(shift) && shift > 0.2)) {
      const k = i1 + Math.max(1, Math.round(0.3 / dt));
      add(times[Math.min(n - 1, k)], 'weight_transfer', { side: m.side, move: m.n });
    }
  }
  for (const m of footMoves) {
    add(m.t0, 'foot_move', { limb: 'foot', side: m.side });
    add(m.t1, 'foot_set', { limb: 'foot', side: m.side, highStep: m.up >= 0.7 });
  }

  // Probes: a limb leaves its hold, goes somewhere, and comes back without using the new spot.
  const probes = [];
  for (const [key, side, kind] of LIMBS) {
    const L = limbs[key];
    const hs = holdsOf(L, dt);
    for (let k = 1; k < hs.length; k++) {
      const a = hs[k - 1].e, b = hs[k].s;
      const pa = posAt(L, a), pb = posAt(L, b);
      if (![...pa, ...pb].every(isNum)) continue;
      let exc = 0;
      for (let i = a; i <= b; i++) if (isNum(L.xs[i])) exc = Math.max(exc, dist(posAt(L, i), pa) / T);
      if (dist(pa, pb) / T < 0.25 && exc >= 0.4 && times[b] - times[a] <= 2.5) {
        probes.push({ t0: times[a], t1: times[b], side, limb: kind, reach: r2(exc) });
        add(times[a] + (times[b] - times[a]) / 2, 'touch/probe', { limb: kind, side, reach: r2(exc) });
      }
    }
  }

  // Regrips: small re-placements right after a hand move.
  for (const [key, side, kind] of LIMBS) {
    for (const a of limbs[key].adjustments) add(a.t0, kind === 'hand' ? 'regrip/reset' : 'foot_reposition', { limb: kind, side });
  }

  // Matches and swaps: two hands (or feet) on the same spot.
  const pairMatch = (ka, kb, thr) => runs(n, (i) => limbs[ka].still[i] && limbs[kb].still[i] && limbs[ka].seen[i] && limbs[kb].seen[i]
    && isNum(limbs[ka].xs[i]) && isNum(limbs[kb].xs[i]) && dist(posAt(limbs[ka], i), posAt(limbs[kb], i)) / T < thr)
    .filter((r) => times[r.e] - times[r.s] >= 0.3);
  const handMatches = pairMatch('lHand', 'rHand', 0.35);
  for (const r of handMatches) add(times[r.s], 'hand_match');
  const footMatches = pairMatch('lFoot', 'rFoot', 0.25);
  for (const r of footMatches) {
    add(times[r.s], 'foot_match');
    // A swap: shortly after matching, one foot leaves while the other stays.
    const after = footMoves.find((m) => m.t0 >= times[r.e] - 0.1 && m.t0 <= times[r.e] + 1.5);
    if (after) add(after.t0, 'foot_swap', { side: after.side });
  }

  // Cross-throughs: a hand (or foot) finishes on the far side of the other one.
  const crossCheck = (moves, kind) => {
    for (const m of moves) {
      const i1 = Math.round((m.t1 - times[0]) / dt);
      const me = m.side === 'left' ? (kind === 'hand' ? 'lHand' : 'lFoot') : (kind === 'hand' ? 'rHand' : 'rFoot');
      const oth = m.side === 'left' ? (kind === 'hand' ? 'rHand' : 'rFoot') : (kind === 'hand' ? 'lHand' : 'lFoot');
      const x = limbs[me].xs[i1], ox = limbs[oth].xs[i1];
      if (!isNum(x) || !isNum(ox)) continue;
      const crossed = m.side === 'left' ? x - ox > 0.15 * T : ox - x > 0.15 * T;
      if (crossed) add(m.t1, kind === 'hand' ? 'cross_through' : 'crossover', { side: m.side, limb: kind });
    }
  };
  crossCheck(handMoves, 'hand');
  crossCheck(footMoves, 'foot');

  // Rests and shake-outs.
  for (const p of pauses) if (p.type === 'rest') { add(p.t0, 'rest_start'); add(p.t1, 'rest_end'); }
  for (const s of c.shakeOuts || []) add(s.t, 'shakeout', { side: s.side, limb: 'hand' });
  for (const f of falls || []) add(f.t, 'fall');

  ev.sort((a, b) => a.t - b.t);
  return { events: ev, probes, handMatches: handMatches.length, footMatches: footMatches.length };
}

// ---------- per-frame primitives ----------

function framePrimitives(c) {
  const { n, dt, T, limbs, handMoves, footMoves, vY, vX, speed, elbow, knee, tracks, heights: H, swRatio, times } = c;
  const swMax = (() => { const v = swRatio.filter(isNum).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length * 0.9)] : NaN; })();
  const inMove = (moves, i) => moves.some((m) => times[i] >= m.t0 && times[i] <= m.t1);
  const P = [];
  for (let i = 0; i < n; i++) {
    const moving = {}, holding = {}, seen = {};
    for (const [key] of LIMBS) {
      const L = limbs[key];
      seen[key] = !!L.seen[i];
      holding[key] = !!(L.still[i] && L.seen[i]);
      moving[key] = isNum(L.speed[i]) && L.speed[i] > 0.5 && !L.still[i];
    }
    const hipMoving = isNum(speed[i]) && speed[i] > 0.25;
    const handChange = inMove(handMoves, i), footChange = inMove(footMoves, i);
    const probing = (c.probes || []).some((p) => times[i] >= p.t0 && times[i] <= p.t1);
    // PLOS ONE-style state for this frame (priority order).
    let state = 'immobility';
    if (handChange || footChange) state = 'hold_change';
    else if (probing || Object.values(moving).some(Boolean)) state = 'hold_exploration';
    else if (hipMoving && isNum(vY[i]) && vY[i] > 0.3) state = 'hold_traction';
    else if (hipMoving) state = 'postural_regulation';
    if (!c.coreOk[i]) state = 'unknown';
    P.push({ moving, holding, seen, hipMoving, state, swr: isNum(swRatio[i]) && isNum(swMax) ? swRatio[i] / swMax : NaN });
  }
  return P;
}

// ---------- posture helpers ----------

function supportingArm(c, i) {
  const { limbs, elbow, heights: H } = c;
  const cands = [];
  for (const [k, s] of [['lHand', 'l'], ['rHand', 'r']]) {
    const hk = s === 'l' ? 'lWrist' : 'rWrist', sk = s === 'l' ? 'lShoulder' : 'rShoulder';
    if (limbs[k].still[i] && limbs[k].seen[i] && isNum(elbow[s][i]) && isNum(H[hk][i]) && isNum(H[sk][i]) && H[hk][i] > H[sk][i] - 0.3) cands.push({ s, a: elbow[s][i] });
  }
  if (!cands.length) return { label: 'unknown', conf: 'low' };
  const otherMoving = cands.length === 1 && !(limbs[cands[0].s === 'l' ? 'rHand' : 'lHand'].still[i]);
  const a = Math.min(...cands.map((x) => x.a));
  if (a >= 145) return { label: 'straight_supporting_arm', conf: 'medium' };
  if (a < 95 && otherMoving) return { label: 'lockoff', conf: 'medium' };
  return { label: 'bent_supporting_arm', conf: 'medium' };
}

// Which way is the hand pulling on its hold? Inferred from the arm's direction (proxy only).
function holdOrientation(c, side, i) {
  const { tracks, T } = c;
  const w = side === 'l' ? 15 : 16, s = side === 'l' ? 11 : 12, e = side === 'l' ? 13 : 14;
  const W = [tracks[w].x[i], tracks[w].y[i]], S = [tracks[s].x[i], tracks[s].y[i]], E = [tracks[e].x[i], tracks[e].y[i]];
  if (![...W, ...S, ...E].every(isNum)) return 'unknown';
  const dx = (W[0] - S[0]) / T, dy = (S[1] - W[1]) / T; // dy > 0: hand above shoulder
  const outward = side === 'l' ? -dx : dx;             // positive: hand out to its own side
  const elbowOut = side === 'l' ? (S[0] - E[0]) / T : (E[0] - S[0]) / T;
  if (dy > 0.5) return 'down_pull';
  if (dy < -0.4 && Math.abs(dx) < 0.6) return 'undercling';
  if (Math.abs(dy) <= 0.5 && outward > 0.5) return 'side_pull';
  if (Math.abs(dy) <= 0.6 && outward < -0.1 && elbowOut > 0.25) return 'gaston';
  return 'unknown';
}

function legPosture(c, i) {
  const { limbs, knee, tracks, T } = c;
  const out = [];
  // Support legs: planted, seen feet.
  for (const [k, s, side] of [['lFoot', 'l', 'left'], ['rFoot', 'r', 'right']]) {
    if (!(limbs[k].still[i] && limbs[k].seen[i]) || !isNum(knee[s][i])) continue;
    const kn = s === 'l' ? 25 : 26, an = s === 'l' ? 27 : 28;
    const kneeY = tracks[kn].y[i], ankY = tracks[an].y[i];
    // Drop knee: knee turned down to about foot level with a bent leg (body usually turned).
    if (knee[s][i] < 110 && isNum(kneeY) && isNum(ankY) && kneeY >= ankY - 0.15 * T) out.push(`drop_knee_${side}`);
    else out.push(knee[s][i] >= 150 ? 'extended_support_leg' : 'bent_support_leg');
  }
  // Frog: both knees bent and splayed wider than the feet, hips low.
  if (isNum(knee.l[i]) && isNum(knee.r[i]) && knee.l[i] < 120 && knee.r[i] < 120) {
    const kw = Math.abs(tracks[25].x[i] - tracks[26].x[i]) / T, fw = Math.abs(tracks[27].x[i] - tracks[28].x[i]) / T;
    const hipY = (tracks[23].y[i] + tracks[24].y[i]) / 2, kneeY = (tracks[25].y[i] + tracks[26].y[i]) / 2;
    // ...and the hips sink down toward knee level between them.
    const sunk = isNum(hipY) && isNum(kneeY) && (kneeY - hipY) / T < 0.35;
    if (isNum(kw) && isNum(fw) && kw > fw + 0.3 && kw > 0.8 && sunk) out.push('frog');
  }
  return out.length ? [...new Set(out)] : ['unknown'];
}

// Flag: one leg held straight out to the side as a counterweight while the body balances
// over the other foot. (Whether that foot touches the rock can't be seen; this is a proxy.)
function flagAt(c, i) {
  const { limbs, knee, T, comX } = c;
  for (const [k, s, side, other] of [['lFoot', 'l', 'left', 'rFoot'], ['rFoot', 'r', 'right', 'lFoot']]) {
    const L = limbs[k], O = limbs[other];
    if (!L.seen[i] || !O.still[i] || !O.seen[i]) continue;
    if (!isNum(knee[s][i]) || knee[s][i] < 145) continue;
    const fx = L.xs[i], ox = O.xs[i], hx = comX[i];
    if (![fx, ox, hx].every(isNum)) continue;
    // Body over the support foot, the other foot well out to one side.
    if (Math.abs(ox - hx) / T > 0.35 || Math.abs(fx - hx) / T < 0.6) continue;
    const crossed = (fx - ox) * (s === 'l' ? -1 : 1) < 0; // left foot to the right of the right foot, or vice versa
    return { label: `${crossed ? 'inside' : 'outside'}_flag_${side}`, side };
  }
  return null;
}

// ---------- segments ----------

export function buildLabels(c) {
  const { times, dt, n, T, vY, vX, speed, limbs, heights: H, wStart, wEnd, terrain, pauses, falls, fallReports, jerky, tracks } = c;
  const evInfo = detectEvents(c);
  const P = framePrimitives({ ...c, probes: evInfo.probes });
  const segN = Math.max(1, Math.round(SEGMENT_SEC / dt));
  const segments = [];
  const flagSpans = [], familyCounts = {};
  const terr = terrain && TERRAINS.includes(terrain) ? terrain : 'unknown';
  const mantleFrames = new Set();
  const maxH = Math.max(...H.com.filter(isNum));
  for (let i = 0; i < n; i++) {
    const lw = H.lWrist[i], rw = H.rWrist[i], ls = H.lShoulder[i], rs = H.rShoulder[i], hip = H.hip[i];
    if ([lw, rw, ls, rs, hip].every(isNum) && H.com[i] >= maxH - 0.6 && lw < ls - 0.15 && rw < rs - 0.15 && hip >= Math.min(lw, rw) - 0.45) mantleFrames.add(i);
  }

  for (let s = wStart; s <= wEnd; s += segN) {
    const e = Math.min(wEnd, s + segN - 1);
    const idx = []; for (let i = s; i <= e; i++) idx.push(i);
    const t0 = times[s], t1 = times[e] + dt;
    const tracked = idx.filter((i) => c.coreOk[i]).length / idx.length;
    const L = {};
    const conf = {};
    const set = (k, v, cf = 'medium') => { L[k] = v; conf[k] = cf; };

    // Visibility first: it caps confidence for everything else.
    const limbSeen = LIMBS.map(([k]) => idx.filter((i) => P[i].seen[k]).length / idx.length);
    const fast = idx.some((i) => isNum(speed[i]) && speed[i] > 2);
    let vis = 'clear';
    if (tracked < 0.3) vis = fast ? 'motion_blur' : 'out_of_frame';
    else if (Math.min(...limbSeen) < 0.5) vis = 'partial_occlusion';
    else if (mean(idx.map((i) => P[i].swr)) < 0.55) vis = 'camera_angle_limited';
    set('visibility_confidence', vis, 'high');
    const capConf = vis === 'clear' ? 'medium' : 'low';
    if (tracked < 0.3) {
      segments.push({ t0: r2(t0), t1: r2(t1), labels: { visibility_confidence: vis, segment_role: 'unknown' }, conf: { visibility_confidence: 'high' } });
      continue;
    }

    // Whole-body state (PLOS ONE categories) = the most common frame state.
    const counts = {};
    for (const i of idx) counts[P[i].state] = (counts[P[i].state] || 0) + 1;
    const state = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const fallHere = (falls || []).some((f) => f.t >= t0 - 0.2 && f.t < t1);
    set('body_state', fallHere ? 'unknown (falling)' : state, capConf);

    // Events inside this window.
    const evs = evInfo.events.filter((x) => x.t >= t0 && x.t < t1);
    set('transition_event', evs.length ? [...new Set(evs.map((x) => x.type))] : ['none'], 'medium');

    // Role of this window.
    const inRest = pauses.some((p) => p.type === 'rest' && p.t0 <= t1 && p.t1 >= t0);
    let role = 'transition';
    if (fallHere) role = 'recovery';
    else if (inRest) role = 'rest';
    else if (evs.some((x) => x.type === 'weight_transfer')) role = 'weight_transfer';
    else if (evs.some((x) => x.type === 'grip_set' || x.type === 'catch' || x.type === 'foot_set')) role = 'contact_set';
    else if (state === 'hold_change' && idx.some((i) => P[i].moving.lHand || P[i].moving.rHand)) role = 'reach';
    else if (state === 'hold_change') role = 'setup';
    else if (state === 'postural_regulation') role = 'stabilization';
    else if (state === 'immobility') role = 'stabilization';
    set('segment_role', role, capConf);

    // Static or dynamic.
    const peakUp = Math.max(0, ...idx.map((i) => (isNum(vY[i]) ? vY[i] : 0)));
    const feetOff = idx.some((i) => !P[i].holding.lFoot && !P[i].holding.rFoot && P[i].seen.lFoot && P[i].seen.rFoot && P[i].moving.lFoot && P[i].moving.rFoot);
    let mode = 'static';
    if (fallHere || (jerky || []).some((j) => j.t >= t0 && j.t < t1)) mode = 'controlled_fall/catch';
    else if (peakUp > 1.2) mode = feetOff ? 'dyno' : 'deadpoint';
    else if (peakUp > 0.8) mode = 'dynamic';
    set('movement_mode', mode, peakUp > 1.2 || mode === 'static' ? capConf : 'low');

    // Contacts: how many limbs visibly on holds (unknown if a limb can't be seen).
    const mid = idx[idx.length >> 1];
    const contacts = LIMBS.filter(([k]) => P[mid].holding[k]).length;
    const allSeen = LIMBS.every(([k]) => P[mid].seen[k]);
    set('contact_count_visible', allSeen ? contacts : (contacts ? `${contacts}+ (some limbs hidden)` : 'unknown'), allSeen ? 'medium' : 'low');

    // Per-limb actions.
    for (const [k, side, kind] of LIMBS) {
      const key = `${kind}_${side}`;
      const ev = evs.filter((x) => x.side === side && (x.limb === kind || (!x.limb && kind === 'hand' && ['weight_transfer'].includes(x.type))));
      const seenFrac = idx.filter((i) => P[i].seen[k]).length / idx.length;
      let act;
      if (seenFrac < 0.4) act = 'unknown';
      else if (kind === 'hand') {
        const types = ev.map((x) => x.type);
        if (types.includes('touch/probe')) act = 'touch/probe';
        else if (types.includes('catch') || types.includes('grip_set')) act = 'grip_set';
        else if (types.includes('hand_reach') || types.includes('reverse/downclimb')) act = 'reach';
        else if (types.includes('regrip/reset')) act = 'regrip/reset';
        else if (types.includes('shakeout')) act = 'shakeout';
        else if (P[mid].holding[k]) act = holdOrientation(c, side === 'left' ? 'l' : 'r', mid);
        else act = 'unknown';
      } else {
        const types = ev.map((x) => x.type);
        if (types.includes('foot_set')) act = ev.find((x) => x.type === 'foot_set')?.highStep ? 'high_step' : 'foot_set';
        else if (types.includes('crossover')) act = 'crossover';
        else if (types.includes('foot_swap')) act = 'foot_swap';
        else if (types.includes('foot_move')) act = 'release';
        else if (types.includes('touch/probe')) act = 'touch/probe';
        else if (P[mid].holding[k]) {
          // Weighted only if the leg is visibly pushing (knee straightening while the body rises).
          const s2 = side === 'left' ? 'l' : 'r';
          const kv = (c.knee[s2][Math.min(e, mid + 1)] - c.knee[s2][Math.max(s, mid - 1)]);
          act = isNum(kv) && kv > 3 && isNum(vY[mid]) && vY[mid] > 0.3 ? 'weight_on_foot' : 'foot_on_hold (weight unknown)';
        } else act = 'unknown';
      }
      set(key, act, seenFrac >= 0.8 ? capConf : 'low');
    }
    // The camera can't see fingers or hold shapes: never guess the grip.
    set('hand_grip_visible', 'unknown', 'high');

    // Body orientation from how wide the shoulders look (turning narrows them). The camera
    // can't tell which way you turned from behind, so direction stays unknown.
    const swr = mean(idx.map((i) => P[i].swr));
    set('body_orientation', !isNum(swr) ? 'unknown' : swr >= 0.8 ? 'frontal/square' : swr < 0.55 ? 'side_on (direction unknown)' : 'rotated (direction unknown)', isNum(swr) ? 'low' : 'low');

    // Hips: distance to the wall can't be judged from a single front-on view.
    set('hip_wall_relation', 'unknown', 'high');
    const mvx = mean(idx.map((i) => vX[i])), mvy = mean(idx.map((i) => vY[i]));
    let hm = 'still';
    if (isNum(mvx) && isNum(mvy) && Math.hypot(mvx, mvy) > 0.2) hm = Math.abs(mvy) >= Math.abs(mvx) ? (mvy > 0 ? 'up' : 'down') : (mvx > 0 ? 'right' : 'left');
    set('hip_motion', hm, capConf);

    set('arm_posture', supportingArm(c, mid).label, capConf);
    set('leg_posture', legPosture(c, mid), capConf === 'medium' && limbSeen[2] > 0.8 && limbSeen[3] > 0.8 ? 'medium' : 'low');

    // Balance.
    const signs = idx.map((i) => Math.sign(vX[i] || 0)).filter((x) => x !== 0);
    let flips = 0; for (let k = 1; k < signs.length; k++) if (signs[k] !== signs[k - 1]) flips++;
    const maxVX = Math.max(0, ...idx.map((i) => Math.abs(vX[i] || 0)));
    let bal = 'stable';
    if (fallHere) bal = 'unknown';
    else if (maxVX > 0.9 && (fallHere || idx.some((i) => P[i].swr < 0.7))) bal = 'barn_door/swing';
    else if (flips >= 2 && maxVX > 0.3) bal = 'sway';
    else if (state === 'postural_regulation') bal = 'postural_regulation';
    set('balance_proxy', bal, capConf);

    // Flag.
    const fl = idx.map((i) => flagAt(c, i)).filter(Boolean);
    const flag = fl.length >= Math.ceil(idx.length / 2) ? fl[0].label : 'none';
    set('flag', flag, flag === 'none' ? capConf : 'low');
    if (flag !== 'none') flagSpans.push({ t0, t1, label: flag });

    // Movement family.
    const fams = [];
    if (idx.some((i) => mantleFrames.has(i))) fams.push('mantling');
    const dy = H.com[e] - H.com[s], dxw = isNum(c.comX[e]) && isNum(c.comX[s]) ? (c.comX[e] - c.comX[s]) / T : NaN;
    if (isNum(dxw) && isNum(dy) && Math.abs(dxw) > 0.35 && Math.abs(dxw) > 1.5 * Math.abs(dy)) fams.push('traverse');
    const fw = isNum(limbs.lFoot.xs[mid]) && isNum(limbs.rFoot.xs[mid]) ? Math.abs(limbs.lFoot.xs[mid] - limbs.rFoot.xs[mid]) / T : NaN;
    if (P[mid].holding.lFoot && P[mid].holding.rFoot && isNum(fw) && fw > 1.6) fams.push('stemming');
    // Layback: both hands pulling out to one side while the feet sit on the other.
    const hx = [limbs.lHand.xs[mid], limbs.rHand.xs[mid]], fx = [limbs.lFoot.xs[mid], limbs.rFoot.xs[mid]];
    if ([...hx, ...fx, c.comX[mid]].every(isNum) && P[mid].holding.lHand && P[mid].holding.rHand) {
      const ho = (mean(hx) - c.comX[mid]) / T, fo = (mean(fx) - c.comX[mid]) / T;
      if (Math.abs(ho) > 0.5 && Math.sign(ho) !== Math.sign(fo) && Math.abs(fo) > 0.3) fams.push('laybacking');
    }
    if (terr === 'crack') fams.push('crack_jamming (from terrain; jam type unknown)');
    if (terr === 'roof' && idx.some((i) => P[i].state === 'hold_change')) fams.push('roof_move');
    set('movement_family', fams.length ? fams : ['none'], fams.length ? 'low' : capConf);
    for (const f of fams) familyCounts[f] = (familyCounts[f] || 0) + 1;

    set('terrain_context', terr, terr === 'unknown' ? 'low' : 'high');
    set('handhold_orientation', ['l', 'r'].map((sd) => (P[mid].holding[sd === 'l' ? 'lHand' : 'rHand'] ? `${sd === 'l' ? 'left' : 'right'}: ${holdOrientation(c, sd, mid)}` : null)).filter(Boolean).join(', ') || 'unknown', 'low');
    set('crack_subtype', 'unknown', 'high');

    // What came of this window.
    let out = 'controlled_hold';
    const fr = (fallReports || []).find((f) => f.t >= t0 - 0.2 && f.t < t1);
    if (fr) {
      const top = fr.causes[0]?.key;
      out = top === 'footSlip' || top === 'handSlip' ? 'slip' : top === 'missedCatch' || top === 'lateCatch' ? 'failed_contact' : 'fall';
    } else if (evs.some((x) => x.type === 'touch/probe')) out = 'exploratory_touch';
    else if (isNum(dy) && dy > 0.15 && evs.some((x) => ['hand_reach', 'grip_set', 'catch', 'weight_transfer', 'foot_set'].includes(x.type))) out = 'controlled_progress';
    else if (state === 'hold_change' || state === 'hold_traction') out = isNum(dy) && dy > 0.1 ? 'controlled_progress' : 'controlled_hold';
    set('outcome', out, capConf);

    segments.push({ t0: r2(t0), t1: r2(t1), labels: L, conf });
  }

  // PLOS ONE-style fluency summary over the climb window.
  const inW = []; for (let i = wStart; i <= wEnd; i++) if (P[i].state !== 'unknown') inW.push(P[i].state);
  const share = {};
  for (const st of ['immobility', 'postural_regulation', 'hold_exploration', 'hold_change', 'hold_traction']) share[st] = inW.length ? r2(inW.filter((x) => x === st).length / inW.length) : null;
  const stops = runs(n, (i) => i >= wStart && i <= wEnd && P[i].state === 'immobility').filter((r) => times[r.e] - times[r.s] >= 1);
  const stopDur = stops.map((r) => times[r.e] - times[r.s]);
  // IFSC-style controlled movement: the body rises while a hand goes to the next hold.
  const moves = c.handMoves.filter((m) => m.up > 0.2);
  let controlled = 0;
  for (const m of moves) {
    const i0 = Math.max(0, Math.round((m.t0 - times[0]) / dt) - Math.round(1.5 / dt)), j = Math.min(n - 1, Math.round((m.t1 - times[0]) / dt) + Math.round(1.5 / dt));
    if (isNum(H.com[j]) && isNum(H.com[i0]) && H.com[j] - H.com[i0] > 0.15) controlled++;
  }
  const fluency = {
    share,
    stops: stops.length,
    stopAvg: stopDur.length ? r2(mean(stopDur)) : 0,
    stopTotal: r2(stopDur.reduce((a, b) => a + b, 0)),
    probes: evInfo.probes.length,
    handProbes: evInfo.probes.filter((p) => p.limb === 'hand').length,
    footProbes: evInfo.probes.filter((p) => p.limb === 'foot').length,
    explorationVsChange: share.hold_exploration !== null && share.hold_change + share.hold_exploration > 0 ? r2(share.hold_exploration / (share.hold_change + share.hold_exploration)) : null,
    controlledMoves: controlled, upMoves: moves.length,
  };

  const counts = (type) => evInfo.events.filter((x) => x.type === type).length;
  const repertoire = {
    handMatches: evInfo.handMatches, footMatches: evInfo.footMatches, footSwaps: counts('foot_swap'),
    crossThroughs: counts('cross_through'), crossovers: counts('crossover'),
    flags: mergeSpans(flagSpans).length, flagKinds: [...new Set(flagSpans.map((f) => f.label))],
    dropKnees: segments.filter((sg) => Array.isArray(sg.labels.leg_posture) && sg.labels.leg_posture.some((x) => x.startsWith('drop_knee'))).length,
    frog: segments.filter((sg) => Array.isArray(sg.labels.leg_posture) && sg.labels.leg_posture.includes('frog')).length,
    highSteps: evInfo.events.filter((x) => x.type === 'foot_set' && x.highStep).length,
    catches: counts('catch'), downclimbs: counts('reverse/downclimb'),
    families: familyCounts,
  };
  return { version: 1, segmentSec: SEGMENT_SEC, terrain: terr, segments, events: evInfo.events, fluency, repertoire };
}

function mergeSpans(spans) {
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.label === s.label && s.t0 - last.t1 < 0.05) last.t1 = s.t1; else out.push({ ...s });
  }
  return out;
}
