// A video element with a skeleton overlay that follows playback.

import { KEPT_LANDMARKS } from './metrics.js';
import { refinePoses } from './refine.js';

export const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

// Draws a skeleton; pts are [x, y, confidence, estimated?] normalised 0..1.
// Clearly seen parts are solid. Parts the model couldn't see properly (e.g. legs hidden
// behind the body) are drawn faded and dashed rather than disappearing.
export function drawSkeleton(ctx, pts, w, h, { color = '#3987e5', joint = '#ffffff', hideUnsure = false } = {}) {
  if (!pts) return;
  const get = (i) => {
    const q = pts[i];
    if (!q) return null;
    return { x: q[0], y: q[1], v: q[2] ?? 1, est: q[3] === 1 || (q[2] ?? 1) < 0.35 };
  };
  const lw = Math.max(2, w / 200);
  ctx.lineCap = 'round';
  for (const [a, b] of POSE_CONNECTIONS) {
    const p = get(a), q = get(b);
    if (!p || !q) continue;
    const unsure = p.est || q.est;
    if (unsure && hideUnsure) continue;
    ctx.globalAlpha = unsure ? 0.45 : 1;
    ctx.setLineDash(unsure ? [lw * 2, lw * 2] : []);
    ctx.lineWidth = lw;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x * w, p.y * h);
    ctx.lineTo(q.x * w, q.y * h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = joint;
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]) {
    const p = get(i);
    if (!p || (p.est && hideUnsure)) continue;
    ctx.globalAlpha = p.est ? 0.45 : 1;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, Math.max(3, w / 160) * (p.est ? 0.8 : 1), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function createPlayer(container) {
  container.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'video-wrap';
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.controls = true;
  const canvas = document.createElement('canvas');
  wrap.append(video, canvas);

  const controls = document.createElement('div');
  controls.className = 'video-controls';
  const skelLabel = document.createElement('label');
  skelLabel.className = 'check';
  const skel = document.createElement('input');
  skel.type = 'checkbox';
  skel.checked = true;
  skelLabel.append(skel, document.createTextNode('Show skeleton'));
  const slow = document.createElement('button');
  slow.type = 'button';
  slow.className = 'btn btn-small';
  slow.textContent = 'Speed: 1×';
  controls.append(skelLabel, slow);
  container.append(wrap, controls);

  let track = null; // { t: [], pts: [[x,y,v]x33 | null] }
  let live = null;  // landmarks being drawn during analysis
  let liveBox = null; // tracked region during analysis (normalised)
  let marker = null;  // where the user tapped the climber (normalised)
  let picking = null; // callback while waiting for a tap
  let url = null;
  let raf = 0;
  const speeds = [1, 0.5, 0.25];
  let speedIdx = 0;
  slow.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % speeds.length;
    video.playbackRate = speeds[speedIdx];
    slow.textContent = `Speed: ${speeds[speedIdx]}×`;
  });
  skel.addEventListener('change', draw);

  // Size and position the canvas over the visible picture (the video is letterboxed).
  function layout() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    const bw = video.clientWidth, bh = video.clientHeight;
    const s = Math.min(bw / vw, bh / vh);
    const w = vw * s, h = vh * s;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.left = `${(bw - w) / 2}px`;
    canvas.style.top = `${(bh - h) / 2}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { w: canvas.width, h: canvas.height };
  }

  // Skeleton at time t, blended between the two nearest analysed frames so it moves smoothly
  // at the video's frame rate instead of jumping 10–15 times a second.
  function frameAt(t) {
    if (!track || !track.t.length) return null;
    let lo = 0, hi = track.t.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (track.t[m] < t) lo = m + 1; else hi = m; }
    const b = lo, a = lo > 0 ? lo - 1 : lo;
    const pa = track.pts[a], pb = track.pts[b];
    const ta = track.t[a], tb = track.t[b];
    if (pa && pb && tb > ta && t >= ta && t <= tb && tb - ta < 0.5) {
      const f = (t - ta) / (tb - ta);
      return pa.map((qa, i) => {
        const qb = pb[i];
        if (!qa || !qb) return qa || qb;
        return [qa[0] + (qb[0] - qa[0]) * f, qa[1] + (qb[1] - qa[1]) * f, Math.min(qa[2], qb[2]), qa[3] === 1 || qb[3] === 1 ? 1 : 0];
      });
    }
    const i = Math.abs(track.t[a] - t) < Math.abs(track.t[b] - t) ? a : b;
    return Math.abs(track.t[i] - t) < 0.3 ? track.pts[i] : null;
  }

  function draw() {
    const size = layout();
    if (!size) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.w, size.h);
    if (!skel.checked) return;
    const pts = live || frameAt(video.currentTime);
    // Live (raw) poses during analysis hide unsure parts; the cleaned-up replay shows them faded.
    if (pts) drawSkeleton(ctx, pts, size.w, size.h, { color: '#3987e5', joint: '#ffffff', hideUnsure: !!live });
    const lw = Math.max(2, size.w / 250);
    if (liveBox) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = lw;
      ctx.setLineDash([lw * 4, lw * 3]);
      ctx.strokeRect(liveBox.x0 * size.w, liveBox.y0 * size.h, (liveBox.x1 - liveBox.x0) * size.w, (liveBox.y1 - liveBox.y0) * size.h);
      ctx.setLineDash([]);
    }
    if (marker && !live) {
      const x = marker.x * size.w, y = marker.y * size.h, r = Math.max(14, size.w / 18);
      ctx.lineWidth = lw * 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = 'rgba(57,135,229,0.35)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 1.6, y); ctx.lineTo(x - r * 0.5, y); ctx.moveTo(x + r * 0.5, y); ctx.lineTo(x + r * 1.6, y);
      ctx.moveTo(x, y - r * 1.6); ctx.lineTo(x, y - r * 0.5); ctx.moveTo(x, y + r * 0.5); ctx.lineTo(x, y + r * 1.6); ctx.stroke();
    }
  }

  // Tap-to-select: while picking, the overlay catches one tap on the picture.
  canvas.addEventListener('pointerdown', (ev) => {
    if (!picking) return;
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    marker = { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
    const cb = picking;
    stopPicking();
    draw();
    cb({ ...marker, t: video.currentTime });
  });
  const hintEl = document.createElement('div');
  hintEl.className = 'pick-hint';
  hintEl.textContent = 'Tap on the climber';
  // While picking, the phone's own video controls are hidden (on iPhone they sit on top of the
  // picture and swallow the tap), so a slider takes over moving through the video.
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.className = 'pick-scrub';
  scrub.min = '0';
  scrub.step = '0.01';
  scrub.setAttribute('aria-label', 'Move through the video');
  scrub.addEventListener('input', () => { video.currentTime = Number(scrub.value); });
  const scrubRow = document.createElement('div');
  scrubRow.className = 'pick-scrub-row';
  scrubRow.append(document.createTextNode('Move to a moment where the climber is easy to see:'), scrub);
  let hadControls = true;
  function stopPicking() {
    if (!picking) return;
    picking = null;
    hintEl.remove();
    scrubRow.remove();
    canvas.style.pointerEvents = 'none';
    wrap.classList.remove('picking');
    video.controls = hadControls;
  }

  // Redraw on every presented video frame when the browser supports it (exactly in sync),
  // otherwise on every animation frame.
  const hasVFC = 'requestVideoFrameCallback' in video;
  let vfc = 0;
  function loop() {
    draw();
    if (video.paused || video.ended) return;
    if (hasVFC) vfc = video.requestVideoFrameCallback(loop);
    else raf = requestAnimationFrame(loop);
  }
  video.addEventListener('play', () => {
    cancelAnimationFrame(raf);
    if (hasVFC && vfc) video.cancelVideoFrameCallback(vfc);
    loop();
  });
  video.addEventListener('pause', draw);
  video.addEventListener('seeked', draw);
  video.addEventListener('loadeddata', draw);
  const ro = new ResizeObserver(draw);
  ro.observe(video);

  return {
    video,
    async load(file) {
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(file);
      video.src = url;
      video.load();
      await new Promise((resolve, reject) => {
        const ok = () => { cleanup(); resolve(); };
        const bad = () => { cleanup(); reject(new Error('This video format could not be opened in the browser.')); };
        const cleanup = () => { video.removeEventListener('loadeddata', ok); video.removeEventListener('error', bad); };
        video.addEventListener('loadeddata', ok);
        video.addEventListener('error', bad);
      });
      if (!isFinite(video.duration) || video.duration <= 0) throw new Error('Could not read the video length.');
    },
    setTrack(tr) { track = tr; draw(); },
    setLive(pts, box = null) { live = pts; liveBox = box; draw(); },
    pickPoint(cb) {
      video.pause();
      if (!picking) hadControls = video.controls;
      picking = cb;
      video.controls = false;
      canvas.style.pointerEvents = 'auto';
      wrap.classList.add('picking');
      wrap.appendChild(hintEl);
      scrub.max = String(video.duration || 0);
      scrub.value = String(video.currentTime);
      wrap.after(scrubRow);
      draw();
    },
    get picking() { return !!picking; },
    cancelPick() { stopPicking(); },
    setMarker(m) { marker = m; draw(); },
    showControls(on) { video.controls = on; controls.hidden = !on; },
    // seek(t) jumps there paused; seek(t, rate) plays from there at that speed (e.g. 0.5 for slow motion).
    seek(t, rate) {
      video.pause();
      video.currentTime = Math.max(0, t);
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (rate) {
        video.playbackRate = rate;
        slow.textContent = `Speed: ${rate}×`;
        speedIdx = Math.max(0, speeds.indexOf(rate));
        video.play().catch(() => {});
      }
    },
    destroy() {
      ro.disconnect();
      cancelAnimationFrame(raf);
      if (hasVFC && vfc) video.cancelVideoFrameCallback(vfc);
      video.removeAttribute('src');
      video.load();
      if (url) URL.revokeObjectURL(url);
      container.replaceChildren();
    },
  };
}

// Packs analysed frames into a compact track for storage (normalised 0..1 coords).
export function packTrack(frames, aspect) {
  return {
    aspect,
    t: frames.map((f) => Math.round(f.t * 1000) / 1000),
    c: frames.map((f) => (f.cam ? [Math.round(f.cam[0] * 1e4) / 1e4, Math.round(f.cam[1] * 1e4) / 1e4] : [0, 0])),
    p: frames.map((f) => (f.p ? KEPT_LANDMARKS.flatMap((i) => [
      Math.round((f.p[i][0] / aspect) * 1000) / 1000,
      Math.round(f.p[i][1] * 1000) / 1000,
      Math.round(f.p[i][2] * 100) / 100,
    ]) : null)),
  };
}

// Expands a stored track into the { t, pts } format used by the player.
export function unpackTrack(packed) {
  if (!packed) return null;
  return {
    t: packed.t,
    pts: packed.p.map((flat) => {
      if (!flat) return null;
      const pts = new Array(33).fill(null);
      KEPT_LANDMARKS.forEach((idx, k) => { pts[idx] = [flat[k * 3], flat[k * 3 + 1], flat[k * 3 + 2]]; });
      return pts;
    }),
  };
}

// Stored raw track -> cleaned-up track for replay (continuous legs, estimated parts marked).
export function displayTrack(packed) {
  if (!packed) return null;
  const A = packed.aspect;
  const raw = unpackTrack(packed);
  const frames = packed.t.map((t, i) => ({
    t,
    cam: packed.c ? packed.c[i] : [0, 0],
    p: raw.pts[i] ? raw.pts[i].map((q) => (q ? [q[0] * A, q[1], q[2]] : [0, 0, 0])) : null,
  }));
  const r = refinePoses(frames);
  return { t: packed.t, pts: r.frames.map((f) => (f.p ? f.p.map((q) => (q ? [q[0] / A, q[1], q[2], q[3]] : null)) : null)) };
}
