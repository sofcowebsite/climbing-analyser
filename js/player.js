// A video element with a skeleton overlay that follows playback.

import { drawSkeleton } from './pose.js';
import { KEPT_LANDMARKS } from './metrics.js';

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

  function frameAt(t) {
    if (!track || !track.t.length) return null;
    let lo = 0, hi = track.t.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (track.t[m] < t) lo = m + 1; else hi = m; }
    const i = lo > 0 && Math.abs(track.t[lo - 1] - t) < Math.abs(track.t[lo] - t) ? lo - 1 : lo;
    return Math.abs(track.t[i] - t) < 0.3 ? track.pts[i] : null;
  }

  function draw() {
    const size = layout();
    if (!size) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size.w, size.h);
    if (!skel.checked) return;
    const pts = live || frameAt(video.currentTime);
    if (pts) drawSkeleton(ctx, pts, size.w, size.h, { color: '#3987e5', joint: '#ffffff' });
  }

  function loop() {
    draw();
    if (!video.paused && !video.ended) raf = requestAnimationFrame(loop);
  }
  video.addEventListener('play', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); });
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
    setLive(pts) { live = pts; draw(); },
    showControls(on) { video.controls = on; controls.hidden = !on; },
    seek(t) { video.pause(); video.currentTime = Math.max(0, t); wrap.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    destroy() {
      ro.disconnect();
      cancelAnimationFrame(raf);
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
