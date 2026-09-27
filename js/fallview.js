// Animated skeleton replay of the seconds before a fall. It works from the stored poses, so
// it needs no video: it zooms in on the climber and highlights the body part that let go.

import { POSE_CONNECTIONS } from './player.js';

const LIMB_JOINTS = {
  lFoot: [25, 27, 29, 31], rFoot: [26, 28, 30, 32], feet: [25, 26, 27, 28, 29, 30, 31, 32],
  lHand: [13, 15], rHand: [14, 16], arms: [11, 12, 13, 14, 15, 16], torso: [11, 12, 23, 24],
};

/**
 * track: { t: [], pts: [[x, y, conf, est] x33 | null] } (normalised 0..1), aspect: width / height.
 * opts: { t0, t1, tFall, highlight: limb key, onWatchVideo?: (t0) => void }
 */
export function createFallReplay(container, track, aspect, opts) {
  container.replaceChildren();
  const idx = [];
  for (let i = 0; i < track.t.length; i++) if (track.t[i] >= opts.t0 && track.t[i] <= opts.t1 && track.pts[i]) idx.push(i);
  if (idx.length < 3) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Not enough tracking data around the fall to show a replay.';
    container.append(p);
    return;
  }
  // Frame the climber: bounding box of everything visible in the window (in true proportions).
  // Frame the lead-up, not the whole drop, so the climber stays big; the fall exits the frame.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const lead = idx.filter((i) => track.t[i] <= opts.tFall + 0.1);
  for (const i of (lead.length >= 3 ? lead : idx)) for (const q of track.pts[i]) {
    if (!q) continue;
    const x = q[0] * aspect, y = q[1];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.12;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;

  const wrap = document.createElement('div');
  wrap.className = 'replay';
  const canvas = document.createElement('canvas');
  const label = document.createElement('div');
  label.className = 'replay-label';
  const controls = document.createElement('div');
  controls.className = 'replay-controls';
  const play = document.createElement('button');
  play.type = 'button'; play.className = 'btn btn-small'; play.textContent = 'Pause';
  const speed = document.createElement('button');
  speed.type = 'button'; speed.className = 'btn btn-small'; speed.textContent = '0.5×';
  const scrub = document.createElement('input');
  scrub.type = 'range'; scrub.min = '0'; scrub.max = String(idx.length - 1); scrub.value = '0';
  scrub.setAttribute('aria-label', 'Replay position');
  controls.append(play, speed, scrub);
  if (opts.onWatchVideo) {
    const vid = document.createElement('button');
    vid.type = 'button'; vid.className = 'btn btn-small'; vid.textContent = 'Watch in video';
    vid.addEventListener('click', () => opts.onWatchVideo(opts.t0));
    controls.append(vid);
  }
  wrap.append(canvas, label);
  container.append(wrap, controls);

  const hi = new Set(LIMB_JOINTS[opts.highlight] || []);
  const css = getComputedStyle(document.documentElement);
  const colors = {
    bone: css.getPropertyValue('--series-1').trim() || '#2a78d6',
    hi: css.getPropertyValue('--critical').trim() || '#d03b3b',
    ink: css.getPropertyValue('--ink-2').trim() || '#555',
    bg: css.getPropertyValue('--surface-2').trim() || '#eee',
  };

  function draw(k) {
    const w = container.clientWidth || 320;
    const boxAspect = (x1 - x0) / (y1 - y0);
    const h = Math.min(320, Math.max(180, w / Math.max(0.4, boxAspect)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    const s = Math.min(w / (x1 - x0), h / (y1 - y0));
    const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
    const P = (q) => [ox + (q[0] * aspect - x0) * s, oy + (q[1] - y0) * s];
    // Faint trail of earlier frames.
    const trailFrom = Math.max(0, k - 6);
    for (let j = trailFrom; j < k; j += 2) drawPose(ctx, track.pts[idx[j]], P, 0.12, colors, hi);
    drawPose(ctx, track.pts[idx[k]], P, 1, colors, hi);
    ctx.restore();
    const dt = track.t[idx[k]] - opts.tFall;
    label.textContent = dt < -0.05 ? `${dt.toFixed(1)} s before the fall` : dt <= 0.05 ? 'Fall starts' : `+${dt.toFixed(1)} s`;
    label.classList.toggle('replay-fall', dt >= -0.05);
  }

  let k = 0, playing = true, rate = 0.5, last = performance.now(), acc = 0, raf = 0;
  const frameDur = (track.t[idx[1]] - track.t[idx[0]]) || 0.1;
  function tick(now) {
    if (!container.isConnected) return;
    const el = (now - last) / 1000; last = now;
    if (playing) {
      acc += el * rate;
      while (acc >= frameDur) { acc -= frameDur; k = (k + 1) % idx.length; if (k === 0) acc -= 0.8; }
      scrub.value = String(k);
      draw(k);
    }
    raf = requestAnimationFrame(tick);
  }
  play.addEventListener('click', () => { playing = !playing; play.textContent = playing ? 'Pause' : 'Play'; last = performance.now(); });
  speed.addEventListener('click', () => { rate = rate === 0.5 ? 0.25 : rate === 0.25 ? 1 : 0.5; speed.textContent = `${rate}×`; });
  scrub.addEventListener('input', () => { playing = false; play.textContent = 'Play'; k = Number(scrub.value); draw(k); });
  draw(0);
  raf = requestAnimationFrame(tick);
  return { stop: () => cancelAnimationFrame(raf) };
}

function drawPose(ctx, pts, P, alpha, colors, hi) {
  if (!pts) return;
  ctx.lineCap = 'round';
  for (const [a, b] of POSE_CONNECTIONS) {
    const p = pts[a], q = pts[b];
    if (!p || !q) continue;
    const est = p[3] === 1 || q[3] === 1;
    const isHi = hi.has(a) && hi.has(b);
    ctx.globalAlpha = alpha * (est ? 0.5 : 1);
    ctx.strokeStyle = isHi ? colors.hi : colors.bone;
    ctx.lineWidth = isHi ? 5 : 3.5;
    ctx.setLineDash(est ? [4, 4] : []);
    const [ax, ay] = P(p), [bx, by] = P(q);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  ctx.setLineDash([]);
  const head = pts[0];
  if (head) {
    const [hx, hy] = P(head);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colors.bone;
    ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
