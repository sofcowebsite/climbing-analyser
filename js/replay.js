// Big animated skeleton replay of a moment in the climb: a fall, or a move that shows a habit
// to fix. It works from the stored poses, so it needs no video. It zooms in on the climber,
// draws the holds they were using (estimated from where hands and feet stayed still), shows
// the body part at fault in red and, where it can, a green guide for what to do instead.
// The replay pauses on the key moment with a short note, and has steps to jump between.

import { POSE_CONNECTIONS } from './player.js';

const LIMB_JOINTS = {
  lFoot: [25, 27, 29, 31], rFoot: [26, 28, 30, 32], feet: [25, 26, 27, 28, 29, 30, 31, 32],
  lHand: [13, 15], rHand: [14, 16], lArm: [11, 13, 15], rArm: [12, 14, 16], arms: [11, 12, 13, 14, 15, 16], torso: [11, 12, 23, 24],
};
const ARM = { left: [11, 13, 15], right: [12, 14, 16] };
const FEET = [[27, 31], [28, 32]]; // ankle, toe
const FREEZE_MS = 2200;

const isPt = (q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]);
const seen = (q) => isPt(q) && (q[2] ?? 1) >= 0.3 && q[3] !== 1;
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const fmtClock = (t) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}

// Elbow (or any joint) angle in degrees.
function jointAngle(a, b, c) {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const d = Math.hypot(...v1) * Math.hypot(...v2);
  if (!d) return NaN;
  return (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180) / Math.PI;
}

/**
 * Everything the replay needs for one example, in "wall" units (x scaled by the aspect ratio
 * so distances are true). Exported for tests.
 */
export function prepareExample(track, aspect, ex) {
  const W = (q) => (isPt(q) ? [q[0] * aspect, q[1], q[2] ?? 1, q[3] ?? 0] : null);
  const frames = [];
  for (let i = 0; i < track.t.length; i++) {
    if (track.t[i] >= ex.t0 && track.t[i] <= ex.t1 && track.pts[i]) frames.push({ t: track.t[i], i, p: track.pts[i].map(W) });
  }
  if (frames.length < 3) return null;
  // Body size: shoulder-centre to hip-centre.
  const T = median(frames.map(({ p }) => {
    const [ls, rs, lh, rh] = [p[11], p[12], p[23], p[24]];
    if (![ls, rs, lh, rh].every(isPt)) return NaN;
    return Math.hypot((ls[0] + rs[0]) / 2 - (lh[0] + rh[0]) / 2, (ls[1] + rs[1]) / 2 - (lh[1] + rh[1]) / 2);
  })) || 0.1;
  let keyK = 0;
  frames.forEach((f, k) => { if (Math.abs(f.t - ex.tKey) < Math.abs(frames[keyK].t - ex.tKey)) keyK = k; });

  // Holds: places a hand or foot stayed still for a few frames.
  const holds = [];
  const ends = [[15, 'hand'], [16, 'hand'], [31, 'foot'], [32, 'foot']];
  for (const [j, kind] of ends) {
    for (let k = 2; k < frames.length - 2; k++) {
      const q = frames[k].p[j];
      if (!seen(q)) continue;
      let still = true;
      for (const d of [-2, -1, 1, 2]) {
        const o = frames[k + d].p[j];
        if (!isPt(o) || Math.hypot(o[0] - q[0], o[1] - q[1]) > 0.1 * T) { still = false; break; }
      }
      if (!still) continue;
      const near = holds.find((h) => h.kind === kind && Math.hypot(h.x - q[0], h.y - q[1]) < 0.3 * T);
      if (near) { near.x = (near.x * near.n + q[0]) / (near.n + 1); near.y = (near.y * near.n + q[1]) / (near.n + 1); near.n++; }
      else holds.push({ x: q[0], y: q[1], n: 1, kind });
    }
  }

  // Green guide for "move your feet first": where each foot went shortly after this move.
  // Shown as "step here first" until the foot actually gets there.
  const footTargets = [];
  if (ex.guide === 'feetUp') {
    const key = frames[keyK].p;
    for (const [ankle] of FEET) {
      const a0 = key[ankle];
      if (!isPt(a0)) continue;
      for (let i = frames[keyK].i + 1; i < track.t.length && track.t[i] <= ex.tKey + 5; i++) {
        const q = W(track.pts[i]?.[ankle]), nx = W(track.pts[i + 1]?.[ankle]);
        if (!q || !nx || q[1] > a0[1] - 0.35 * T) continue;
        if (Math.hypot(nx[0] - q[0], nx[1] - q[1]) > 0.06 * T) continue; // still moving
        footTargets.push({ joint: ankle, x: q[0], y: q[1], t: track.t[i] });
        break;
      }
    }
  }

  // Frame the climber (for falls, the lead-up only, so the climber stays big).
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  const lead = ex.annot === 'fall' ? frames.filter((f) => f.t <= ex.tKey + 0.1) : frames;
  for (const f of (lead.length >= 3 ? lead : frames)) for (const q of f.p) if (isPt(q)) add(q[0], q[1]);
  for (const ft of footTargets) add(ft.x, ft.y);
  const pad = Math.max(x1 - x0, y1 - y0) * 0.14;
  return { frames, T, keyK, holds: holds.filter((h) => h.n >= 3), footTargets, box: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad } };
}

/**
 * track: { t: [], pts: [[x, y, conf, est] x33 | null] } (normalised 0..1), aspect: width / height.
 * opts: { examples: [example from mistakes.js], index?: number, onWatchVideo?: (t) => void }
 */
export function createReplay(container, track, aspect, opts) {
  container.replaceChildren();
  const examples = (opts.examples || []).filter(Boolean);
  if (!track || !examples.length) return { stop() {} };

  const css = getComputedStyle(document.documentElement);
  const col = (name, fb) => css.getPropertyValue(name).trim() || fb;
  const colors = {
    bone: col('--series-1', '#2a78d6'), hi: col('--critical', '#d03b3b'), good: col('--good', '#0ca30c'),
    warn: col('--warning', '#fab219'), ink: col('--ink', '#111'), bg: col('--surface-2', '#eee'), hold: col('--muted', '#777'),
  };
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // ----- DOM -----
  const canvas = el('canvas', { role: 'img' });
  const label = el('div', { class: 'replay-label' });
  const clock = el('div', { class: 'replay-clock' });
  const callout = el('div', { class: 'replay-callout', 'aria-live': 'polite' });
  callout.hidden = true;
  const stage = el('div', { class: 'replay replay-big' }, canvas, label, clock, callout);
  const scrub = el('input', { type: 'range', min: '0', value: '0', 'aria-label': 'Replay position' });
  const keyMark = el('span', { class: 'replay-keymark', 'aria-hidden': 'true' });
  const scrubRow = el('div', { class: 'replay-scrub' }, scrub, keyMark);
  const phaseRow = el('div', { class: 'replay-phases', role: 'group', 'aria-label': 'Jump to a step' });
  const play = el('button', { type: 'button', class: 'btn btn-primary replay-play', text: 'Pause' });
  const back = el('button', { type: 'button', class: 'btn', 'aria-label': 'Back one frame', text: '◀︎' });
  const fwd = el('button', { type: 'button', class: 'btn', 'aria-label': 'Forward one frame', text: '▶︎' });
  const speed = el('button', { type: 'button', class: 'btn', 'aria-label': 'Playback speed: half', text: '½×' });
  const controls = el('div', { class: 'replay-controls' }, back, play, fwd, speed);
  const watch = opts.onWatchVideo ? el('button', { type: 'button', class: 'btn btn-block replay-watch', text: 'Watch this in your video (slow motion)', onclick: () => opts.onWatchVideo(ex.t0) }) : null;
  const legend = el('div', { class: 'replay-legend' });
  const picker = examples.length > 1 ? el('div', { class: 'replay-examples', role: 'group', 'aria-label': 'Where it happened' }) : null;
  container.append(...[picker && el('p', { class: 'replay-examples-head', text: `Seen on ${examples.length} moves. Tap one to watch it:` }), picker, stage, scrubRow, phaseRow, controls, watch, legend].filter(Boolean));

  let ex, data, k = 0, playing = !reduced, rate = 0.5, acc = 0, last = performance.now(), raf = 0, frozenUntil = 0, visible = true, size = { w: 0, h: 0 };
  const hiFor = (e) => new Set((e.highlight || []).flatMap((x) => LIMB_JOINTS[x] || []));
  let hi = new Set();

  function load(i) {
    ex = examples[i];
    data = prepareExample(track, aspect, ex);
    hi = hiFor(ex);
    if (picker) {
      picker.replaceChildren(...examples.map((e, j) => el('button', {
        type: 'button', class: `chip${j === i ? ' active' : ''}`, 'aria-pressed': String(j === i),
        onclick: () => { load(j); },
      }, el('strong', { text: e.label }), e.sub ? el('span', { text: ` · ${e.sub}` }) : null)));
    }
    if (!data) {
      stage.hidden = scrubRow.hidden = phaseRow.hidden = controls.hidden = legend.hidden = true;
      container.querySelector('.replay-missing')?.remove();
      container.append(el('p', { class: 'muted small replay-missing', text: 'Not enough tracking data around this moment to show a replay.' }));
      return;
    }
    container.querySelector('.replay-missing')?.remove();
    stage.hidden = scrubRow.hidden = phaseRow.hidden = controls.hidden = legend.hidden = false;
    scrub.max = String(data.frames.length - 1);
    keyMark.style.left = `calc(${(data.keyK / Math.max(1, data.frames.length - 1)) * 100}% - 1px)`;
    canvas.setAttribute('aria-label', `Skeleton replay. ${ex.callout}`);
    phaseRow.replaceChildren(
      ...ex.phases.map((p, j) => el('button', { type: 'button', class: 'phase', 'data-j': String(j), onclick: () => jumpTo(p.t, false) },
        el('span', { class: 'phase-num', text: String(j + 1) }), el('span', { text: p.short || p.label }))),
      el('button', { type: 'button', class: 'phase phase-key', 'aria-label': ex.annot === 'fall' ? 'Jump to the moment you let go' : 'Jump to the mistake', onclick: () => { jumpTo(ex.tKey, true); } }, el('span', { text: ex.annot === 'fall' ? '⚠ Let go' : '⚠ Mistake' })),
    );
    const items = [];
    if (hi.size || ex.annot === 'arm' || ex.annot === 'hips') items.push(el('span', {}, el('i', { class: 'lg lg-bad' }), 'The problem'));
    if (ex.guide) items.push(el('span', {}, el('i', { class: 'lg lg-good' }), 'Do it like this'));
    if (data.holds.length) items.push(el('span', {}, el('i', { class: 'lg lg-hold' }), 'Holds you used (estimated)'));
    legend.replaceChildren(...items);
    // Reduced motion: start on the key moment, paused.
    k = reduced ? data.keyK : 0;
    acc = 0; frozenUntil = 0;
    if (reduced) setPlaying(false);
    draw();
  }

  function jumpTo(t, freeze) {
    if (!data) return;
    let best = 0;
    data.frames.forEach((f, j) => { if (Math.abs(f.t - t) < Math.abs(data.frames[best].t - t)) best = j; });
    k = best; acc = 0;
    frozenUntil = freeze && playing ? performance.now() + FREEZE_MS : 0;
    draw();
  }
  function setPlaying(on) { playing = on; play.textContent = on ? 'Pause' : 'Play'; last = performance.now(); frozenUntil = 0; }

  function draw() {
    if (!data) return;
    const { frames, box, T } = data;
    const w = stage.clientWidth || container.clientWidth || 320;
    const boxAspect = (box.x1 - box.x0) / (box.y1 - box.y0);
    const maxH = Math.min(560, Math.max(320, (window.innerHeight || 800) * 0.62));
    const h = Math.round(Math.min(maxH, Math.max(280, w / Math.max(0.45, boxAspect))));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (size.w !== w || size.h !== h) {
      size = { w, h };
      canvas.style.height = `${h}px`;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, w, h);
    const s = Math.min(w / (box.x1 - box.x0), h / (box.y1 - box.y0));
    const ox = (w - (box.x1 - box.x0) * s) / 2, oy = (h - (box.y1 - box.y0) * s) / 2;
    const P = (q) => [ox + (q[0] - box.x0) * s, oy + (q[1] - box.y0) * s];
    const unit = s * T; // one torso length in pixels
    const f = frames[k];

    // Holds.
    for (const hd of data.holds) {
      const [x, y] = P([hd.x, hd.y]);
      ctx.globalAlpha = 0.22; ctx.fillStyle = colors.hold;
      ctx.beginPath(); ctx.ellipse(x, y, unit * (hd.kind === 'hand' ? 0.16 : 0.13), unit * (hd.kind === 'hand' ? 0.12 : 0.09), 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Faint trail of the last few frames.
    for (let j = Math.max(0, k - 6); j < k; j += 2) drawPose(ctx, frames[j].p, P, 0.12, unit, hi, false);
    tags = [];
    drawGuides(ctx, f, P, unit);
    drawPose(ctx, f.p, P, 1, unit, hi, true);
    drawAnnot(ctx, f, P, unit);
    for (const t of tags) paintTag(ctx, ...t);

    // Labels: which step this is, and the time in the video.
    let j = 0;
    ex.phases.forEach((p, n) => { if (f.t >= p.t - 0.02) j = n; });
    if (ex.annot === 'fall') {
      const dt = f.t - ex.tKey;
      label.textContent = dt < -0.05 ? `${(-dt).toFixed(1)} s before the fall` : dt <= 0.05 ? 'Fall starts' : 'Falling';
      label.classList.toggle('replay-bad', dt >= -0.05);
    } else if (ex.stop && f.t >= ex.stop[0] && f.t <= ex.stop[1]) {
      label.textContent = `Stopped · ${(f.t - ex.stop[0]).toFixed(1)} s`;
      label.classList.add('replay-bad');
    } else {
      label.textContent = ex.phases[j].label;
      label.classList.remove('replay-bad');
    }
    clock.textContent = fmtClock(f.t);
    for (const b of phaseRow.querySelectorAll('.phase[data-j]')) b.classList.toggle('active', Number(b.dataset.j) === j);
    const atKey = Math.abs(k - data.keyK) <= 1 || (f.t >= ex.tKey - 0.1 && f.t <= ex.tKey + 0.5);
    callout.hidden = !(atKey || performance.now() < frozenUntil);
    callout.textContent = ex.callout;
    scrub.value = String(k);
  }

  // Green "do it like this" guides.
  function drawGuides(ctx, f, P, unit) {
    const p = f.p;
    ctx.save();
    ctx.strokeStyle = colors.good; ctx.fillStyle = colors.good;
    ctx.lineWidth = Math.max(2.5, unit * 0.06); ctx.setLineDash([unit * 0.12, unit * 0.09]); ctx.lineCap = 'round';
    if (ex.guide === 'straightArm') {
      const [si, ei, wi] = ARM[ex.holdSide] || ARM.left;
      const sh = p[si], elb = p[ei], wr = p[wi];
      if ([sh, elb, wr].every(isPt) && jointAngle(sh, elb, wr) < 145) {
        const L = Math.hypot(sh[0] - elb[0], sh[1] - elb[1]) + Math.hypot(elb[0] - wr[0], elb[1] - wr[1]);
        const d = Math.hypot(sh[0] - wr[0], sh[1] - wr[1]) || 1;
        const g = [wr[0] + ((sh[0] - wr[0]) / d) * L, wr[1] + ((sh[1] - wr[1]) / d) * L];
        const [ax, ay] = P(wr), [gx, gy] = P(g);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(gx, gy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(gx, gy, unit * 0.1, 0, Math.PI * 2); ctx.stroke();
        tag(ctx, gx, gy - unit * 0.34, 'straight arm', colors.good);
      }
    } else if (ex.guide === 'hipsOverFeet') {
      const hm = mid(p[23], p[24]), feet = FEET.map(([a, t]) => p[t] || p[a]).filter(isPt);
      if (hm && feet.length) {
        const fx = feet.map((q) => q[0]), fy = Math.max(...feet.map((q) => q[1]));
        const lo = Math.min(...fx), hiX = Math.max(...fx);
        const [bx0, by] = P([lo, fy]), [bx1] = P([hiX, fy]);
        ctx.setLineDash([]); ctx.globalAlpha = 0.35; ctx.lineWidth = unit * 0.14;
        ctx.beginPath(); ctx.moveTo(bx0, by + unit * 0.12); ctx.lineTo(bx1 + 0.01, by + unit * 0.12); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = Math.max(2.5, unit * 0.06);
        // A little slack either side of the feet before calling the hips "outside".
        const slack = 0.15 * data.T;
        const outside = hm[0] < lo - slack || hm[0] > hiX + slack;
        const [hx, hy] = P(hm);
        ctx.setLineDash([unit * 0.1, unit * 0.08]);
        ctx.strokeStyle = outside ? colors.hi : colors.good;
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, by); ctx.stroke();
        if (outside) {
          const tx = Math.min(hiX, Math.max(lo, hm[0]));
          const [gx, gy] = P([tx, hm[1]]);
          ctx.strokeStyle = colors.good; ctx.setLineDash([]);
          arrow(ctx, hx, hy, gx, gy, unit);
          ctx.beginPath(); ctx.arc(gx, gy, unit * 0.11, 0, Math.PI * 2); ctx.stroke();
          tag(ctx, gx, gy - unit * 0.28, 'hips here', colors.good);
        }
      }
    } else if (ex.guide === 'feetUp') {
      for (const ft of data.footTargets) {
        if (f.t >= ft.t) continue; // the foot got there
        const cur = p[ft.joint];
        const [gx, gy] = P([ft.x, ft.y]);
        ctx.setLineDash([unit * 0.08, unit * 0.07]);
        ctx.beginPath(); ctx.arc(gx, gy, unit * 0.14, 0, Math.PI * 2); ctx.stroke();
        if (isPt(cur)) { const [cx, cy] = P(cur); ctx.setLineDash([]); arrow(ctx, cx, cy, gx, gy + unit * 0.14, unit); }
        tag(ctx, gx, gy - unit * 0.3, 'foot here first', colors.good);
      }
    }
    ctx.restore();
  }

  // Red markings for the problem itself.
  function drawAnnot(ctx, f, P, unit) {
    if (ex.annot !== 'arm') return;
    const [si, ei, wi] = ARM[ex.holdSide] || ARM.left;
    const sh = f.p[si], elb = f.p[ei], wr = f.p[wi];
    if (![sh, elb, wr].every(isPt)) return;
    const ang = jointAngle(sh, elb, wr);
    if (!Number.isFinite(ang)) return;
    const c = ang < 110 ? colors.hi : ang < 145 ? colors.warn : colors.good;
    const [ex0, ey0] = P(elb), [sx, sy] = P(sh), [wx, wy] = P(wr);
    const a1 = Math.atan2(sy - ey0, sx - ex0), a2 = Math.atan2(wy - ey0, wx - ex0);
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    ctx.save();
    ctx.strokeStyle = c; ctx.lineWidth = Math.max(2, unit * 0.05);
    ctx.beginPath(); ctx.arc(ex0, ey0, unit * 0.22, a1, a1 + d, d < 0); ctx.stroke();
    // Label on the outside of the bend.
    const mA = a1 + d / 2 + Math.PI;
    tag(ctx, ex0 + Math.cos(mA) * unit * 0.45, ey0 + Math.sin(mA) * unit * 0.45, `${Math.round(ang)}°`, c);
    ctx.restore();
  }

  function drawPose(ctx, pts, P, alpha, unit, hiSet, main) {
    if (!pts) return;
    const lw = Math.max(3, unit * 0.09);
    ctx.lineCap = 'round';
    for (const [a, b] of POSE_CONNECTIONS) {
      const p = pts[a], q = pts[b];
      if (!isPt(p) || !isPt(q)) continue;
      const est = p[3] === 1 || q[3] === 1;
      const isHi = hiSet.has(a) && hiSet.has(b);
      ctx.globalAlpha = alpha * (est ? 0.5 : 1);
      ctx.strokeStyle = isHi ? colors.hi : colors.bone;
      ctx.lineWidth = isHi ? lw * 1.5 : lw;
      ctx.setLineDash(est ? [lw * 1.3, lw * 1.3] : []);
      if (isHi && main) { ctx.shadowColor = colors.hi; ctx.shadowBlur = 10; }
      const [ax, ay] = P(p), [bx, by] = P(q);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.setLineDash([]);
    if (main) {
      for (const j of [13, 14, 15, 16, 25, 26, 27, 28]) {
        const q = pts[j];
        if (!isPt(q)) continue;
        ctx.globalAlpha = q[3] === 1 ? 0.5 : 1;
        ctx.fillStyle = hiSet.has(j) ? colors.hi : colors.bone;
        ctx.beginPath(); ctx.arc(...P(q), lw * 0.75, 0, Math.PI * 2); ctx.fill();
      }
    }
    const head = pts[0];
    if (isPt(head)) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colors.bone;
      ctx.beginPath(); ctx.arc(...P(head), Math.max(6, unit * 0.17), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  let tags = [];
  function tag(ctx, x, y, text, color) { tags.push([x, y, text, color]); }
  function paintTag(ctx, x, y, text, color) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    const tw = ctx.measureText(text).width + 12;
    const bx = Math.max(2, Math.min(size.w - tw - 2, x - tw / 2)), by = Math.max(2, Math.min(size.h - 22, y - 11));
    ctx.globalAlpha = 0.92; ctx.fillStyle = col('--surface', '#fff');
    roundRect(ctx, bx, by, tw, 22, 11); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 1.5; roundRect(ctx, bx, by, tw, 22, 11); ctx.stroke();
    ctx.fillStyle = col('--ink', '#111'); ctx.textBaseline = 'middle'; ctx.fillText(text, bx + 6, by + 11.5);
    ctx.restore();
  }

  function tick(now) {
    raf = 0;
    if (!container.isConnected) return;
    const dtSec = (now - last) / 1000; last = now;
    if (playing && data && now >= frozenUntil) {
      const fd = (data.frames[Math.min(k + 1, data.frames.length - 1)].t - data.frames[k].t) || 0.1;
      acc += dtSec * rate;
      while (acc >= fd) {
        acc -= fd;
        const next = (k + 1) % data.frames.length;
        // Stop on the key moment for a moment, with the note showing.
        if (next === data.keyK) { k = next; acc = 0; frozenUntil = now + FREEZE_MS; break; }
        k = next;
        if (k === 0) { acc = -0.8; break; } // short pause before looping
      }
      draw();
    } else if (playing) draw();
    if (visible) raf = requestAnimationFrame(tick);
  }
  const start = () => { if (!raf && visible) { last = performance.now(); raf = requestAnimationFrame(tick); } };

  play.addEventListener('click', () => { setPlaying(!playing); start(); });
  speed.addEventListener('click', () => { rate = rate === 0.5 ? 0.25 : rate === 0.25 ? 1 : 0.5; speed.textContent = rate === 1 ? '1×' : rate === 0.5 ? '½×' : '¼×'; speed.setAttribute('aria-label', `Playback speed: ${rate === 1 ? 'normal' : rate === 0.5 ? 'half' : 'quarter'}`); });
  const step = (d) => { setPlaying(false); k = Math.max(0, Math.min(data.frames.length - 1, k + d)); draw(); };
  back.addEventListener('click', () => data && step(-1));
  fwd.addEventListener('click', () => data && step(1));
  scrub.addEventListener('input', () => { setPlaying(false); k = Number(scrub.value); draw(); });

  // Only animate while on screen (several replays on one page would drain the battery).
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); if (visible) start(); });
    io.observe(stage);
  }
  window.addEventListener('resize', () => { if (container.isConnected) draw(); });
  load(Math.min(examples.length - 1, Math.max(0, opts.index || 0)));
  start();
  return { stop: () => { cancelAnimationFrame(raf); raf = 0; } };
}

function mid(a, b) { return isPt(a) && isPt(b) ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null; }

function arrow(ctx, x0, y0, x1, y1, unit) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
  if (L < unit * 0.2) return;
  const hs = Math.max(6, unit * 0.12);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x1 - hs * Math.cos(a - 0.5), y1 - hs * Math.sin(a - 0.5));
  ctx.moveTo(x1, y1); ctx.lineTo(x1 - hs * Math.cos(a + 0.5), y1 - hs * Math.sin(a + 0.5));
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
