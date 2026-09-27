// Runs MediaPipe Pose on a video, entirely in the browser.
// The model and WebAssembly runtime are served from this site (see /vendor and /models).

import { FilesetResolver, PoseLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';
import { gradientImage, createCameraTracker } from './camera.js';

const WASM_PATH = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODELS = {
  heavy: new URL('../models/pose_landmarker_heavy.task', import.meta.url).href,
  full: new URL('../models/pose_landmarker_full.task', import.meta.url).href,
  lite: new URL('../models/pose_landmarker_lite.task', import.meta.url).href,
};

let cached = { key: null, landmarker: null };
let pending = null; // { key, promise } while a model is loading
const modelBuffers = {};

// Download a file with progress (the service worker caches it, so later loads are instant).
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url.split('/').pop()} (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) { const b = new Uint8Array(await res.arrayBuffer()); onProgress?.(1); return b; }
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) { // content-length was wrong; fall back to growing
      const bigger = new Uint8Array(Math.max(out.length * 2, got + value.length));
      bigger.set(out.subarray(0, got)); return finishGrow(bigger, got, value, reader, onProgress);
    }
    out.set(value, got);
    got += value.length;
    onProgress?.(Math.min(1, got / total));
  }
  return got === out.length ? out : out.subarray(0, got);
}
async function finishGrow(buf, got, value, reader, onProgress) {
  buf.set(value, got); got += value.length;
  for (;;) {
    const { done, value: v } = await reader.read();
    if (done) break;
    if (got + v.length > buf.length) { const b2 = new Uint8Array(buf.length * 2); b2.set(buf.subarray(0, got)); buf = b2; }
    buf.set(v, got); got += v.length;
  }
  onProgress?.(1);
  return buf.subarray(0, got);
}

export async function loadLandmarker({ model = 'full', delegate = 'GPU', onProgress } = {}) {
  const key = `${model}:${delegate}`;
  if (cached.key === key) return cached.landmarker;
  if (pending?.key === key) return pending.promise;
  const promise = (async () => {
    // The WebAssembly runtime and the model download in parallel.
    const wasmUrl = `${WASM_PATH}/vision_wasm_internal.wasm`;
    let pw = 0, pm = 0;
    const report = () => onProgress?.(0.35 * pw + 0.65 * pm);
    // Pre-download the runtime only when the service worker will cache it (otherwise
    // MediaPipe would download it a second time).
    const canCache = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
    if (!canCache) pw = 1;
    const [fileset, buf] = await Promise.all([
      (canCache ? fetchWithProgress(wasmUrl, (f) => { pw = f; report(); }).catch(() => null) : Promise.resolve())
        .then(() => FilesetResolver.forVisionTasks(WASM_PATH)),
      modelBuffers[model] ? Promise.resolve(modelBuffers[model]) : fetchWithProgress(MODELS[model], (f) => { pm = f; report(); }),
    ]);
    modelBuffers[model] = buf;
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: buf, delegate },
      // IMAGE mode: we move our own zoomed crop between frames, so the model's built-in
      // frame-to-frame tracking would be misled.
      runningMode: 'IMAGE',
      numPoses: 2,
      // Low thresholds = aggressive detection; the tracking and clean-up steps filter noise.
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
    // Warm-up: the first detection compiles GPU shaders, which can take a second or two.
    // Do it now, not on the first real frame.
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, 64, 64);
      landmarker.detect(c);
    } catch { /* warm-up is best effort */ }
    // Free the previous model only once the new one is ready.
    const old = cached.landmarker;
    cached = { key, landmarker };
    if (old && old !== landmarker) { try { old.close(); } catch { /* already closed */ } }
    return landmarker;
  })();
  pending = { key, promise };
  try { return await promise; } finally { if (pending?.promise === promise) pending = null; }
}

// Loads with the preferred delegate, falling back to CPU if the GPU path fails.
export async function loadWithFallback(model, preferCpu, onProgress) {
  if (!preferCpu) {
    try { return { landmarker: await loadLandmarker({ model, delegate: 'GPU', onProgress }), delegate: 'GPU' }; }
    catch (e) { console.warn('GPU delegate failed, using CPU', e); }
  }
  return { landmarker: await loadLandmarker({ model, delegate: 'CPU', onProgress }), delegate: 'CPU' };
}

// Start loading in the background (e.g. as soon as a video is chosen) so it's ready by the
// time the user taps Analyse.
let preloadPromise = null, preloadKey = null;
export function preload(model, preferCpu, onProgress) {
  const key = `${model}:${preferCpu}`;
  if (preloadKey !== key || !preloadPromise) {
    preloadKey = key;
    preloadPromise = loadWithFallback(model, preferCpu, (f) => preloadListeners.forEach((l) => l(f)));
    preloadPromise.catch(() => { preloadPromise = null; });
  }
  if (onProgress) preloadListeners.add(onProgress);
  return preloadPromise;
}
const preloadListeners = new Set();
export function stopPreloadProgress(fn) { preloadListeners.delete(fn); }

function seek(video, t) {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - t) < 1e-3 && video.readyState >= 2) { resolve(); return; }
    const timer = setTimeout(() => { cleanup(); reject(new Error('Seeking timed out')); }, 8000);
    const done = () => { cleanup(); resolve(); };
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

// Waits until the frame at the current position has been decoded (iOS can report "seeked" early).
function frameReady(video) {
  return new Promise((resolve) => {
    if ('requestVideoFrameCallback' in video) {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      video.requestVideoFrameCallback(finish);
      setTimeout(finish, 120);
    } else requestAnimationFrame(() => resolve());
  });
}

const CROP = 384;          // pixels the pose model sees for the tracked region
const CORE_IDX = [11, 12, 23, 24];

// MediaPipe landmark pairs that swap when the image is mirrored.
const MIRROR_PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18],
  [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
const LR_GROUPS = [[[11, 12], [13, 14], [15, 16]], [[23, 24], [25, 26], [27, 28], [29, 30], [31, 32]]];

let flipCanvas = null;

// Runs pose detection on a square region of the source video frame.
// Returns every pose found, mapped to source-pixel coordinates.
// With `twoPass`, the region is also analysed mirrored and the two results are combined:
// the model makes different mistakes on a mirrored picture (especially on hidden legs),
// so averaging them is more accurate, and where they disagree we know to trust it less.
function detectRegion(landmarker, video, ctx, W, H, x0, y0, S, twoPass = false) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CROP, CROP);
  const sx0 = Math.max(0, x0), sy0 = Math.max(0, y0);
  const sx1 = Math.min(W, x0 + S), sy1 = Math.min(H, y0 + S);
  if (sx1 - sx0 < 4 || sy1 - sy0 < 4) return [];
  const k = CROP / S;
  ctx.drawImage(video, sx0, sy0, sx1 - sx0, sy1 - sy0, (sx0 - x0) * k, (sy0 - y0) * k, (sx1 - sx0) * k, (sy1 - sy0) * k);
  const res = landmarker.detect(ctx.canvas);
  const poses = (res.landmarks || []).map((lm) => lm.map((q) => ({ x: x0 + q.x * S, y: y0 + q.y * S, v: q.visibility ?? 1 })));
  if (!twoPass || !poses.length) return poses;

  if (!flipCanvas) { flipCanvas = document.createElement('canvas'); flipCanvas.width = flipCanvas.height = CROP; }
  const fctx = flipCanvas.getContext('2d');
  fctx.setTransform(-1, 0, 0, 1, CROP, 0);
  fctx.drawImage(ctx.canvas, 0, 0);
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  const mres = landmarker.detect(flipCanvas);
  const mirrored = (mres.landmarks || []).map((lm) => {
    const p = lm.map((q) => ({ x: x0 + (1 - q.x) * S, y: y0 + q.y * S, v: q.visibility ?? 1 }));
    for (const [a, b] of MIRROR_PAIRS) [p[a], p[b]] = [p[b], p[a]];
    return p;
  });
  return poses.map((p) => {
    const box = poseBox(p);
    const size = box ? Math.max(box.x1 - box.x0, box.y1 - box.y0) : S / 3;
    const m = nearest(mirrored, hipCenter(p));
    if (!m.pose || m.dist > size * 0.35) return p;
    return fusePoses(p, m.pose, size);
  });
}

// Confidence-weighted average of two estimates of the same pose.
function fusePoses(a, b, size) {
  b = b.slice();
  // The two passes can disagree about left/right; align them first.
  for (const pairs of LR_GROUPS) {
    let keep = 0, swap = 0;
    for (const [l, r] of pairs) {
      keep += Math.hypot(a[l].x - b[l].x, a[l].y - b[l].y) + Math.hypot(a[r].x - b[r].x, a[r].y - b[r].y);
      swap += Math.hypot(a[l].x - b[r].x, a[l].y - b[r].y) + Math.hypot(a[r].x - b[l].x, a[r].y - b[l].y);
    }
    if (swap < keep * 0.8) for (const [l, r] of pairs) [b[l], b[r]] = [b[r], b[l]];
  }
  return a.map((q, i) => {
    const r = b[i];
    const wa = Math.max(0.05, q.v), wb = Math.max(0.05, r.v);
    const x = (q.x * wa + r.x * wb) / (wa + wb), y = (q.y * wa + r.y * wb) / (wa + wb);
    const disagree = Math.hypot(q.x - r.x, q.y - r.y) / size;
    // Agreement between the passes raises confidence; disagreement lowers it.
    const v = Math.max(q.v, r.v) * (disagree > 0.12 ? 0.5 : disagree > 0.06 ? 0.8 : 1);
    return { x, y, v };
  });
}

function coreVis(pose) { return CORE_IDX.reduce((s, i) => s + pose[i].v, 0) / CORE_IDX.length; }
function hipCenter(pose) { return { x: (pose[23].x + pose[24].x) / 2, y: (pose[23].y + pose[24].y) / 2 }; }

// Bounding box of the reasonably visible landmarks.
function poseBox(pose) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pose) {
    if (q.v < 0.3) continue;
    x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
  }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

function nearest(poses, pt) {
  let best = null, bd = Infinity;
  for (const p of poses) {
    const c = hipCenter(p);
    const d = Math.hypot(c.x - pt.x, c.y - pt.y);
    if (d < bd) { bd = d; best = p; }
  }
  return { pose: best, dist: bd };
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

// Scans the whole frame in overlapping tiles so small, far-away people are found.
// Yields between tiles so the page stays responsive.
async function searchFrame(landmarker, video, ctx, W, H) {
  const found = [];
  const add = (poses) => { for (const p of poses) if (coreVis(p) >= 0.5) found.push(p); };
  const full = Math.max(W, H);
  add(detectRegion(landmarker, video, ctx, W, H, (W - full) / 2, (H - full) / 2, full));
  for (const frac of [0.5, 0.3]) {
    const S = Math.round(Math.min(W, H) * frac * (H > W ? 1.4 : 1));
    const step = S / 2;
    for (let y = 0; y <= H - S / 2; y += step) {
      for (let x = 0; x <= W - S / 2; x += step) {
        add(detectRegion(landmarker, video, ctx, W, H, x, y, S));
        await yieldToUi();
      }
    }
    if (found.length) break;
  }
  // Merge duplicates of the same person found in overlapping tiles.
  const people = [];
  for (const p of found) {
    const c = hipCenter(p);
    const b = poseBox(p);
    const size = b ? Math.max(b.x1 - b.x0, b.y1 - b.y0) : 50;
    if (!people.some((q) => { const d = hipCenter(q); return Math.hypot(c.x - d.x, c.y - d.y) < size * 0.3; })) people.push(p);
  }
  return people;
}

// Plays the video (muted, fast) and hands over frames as they're decoded. Much faster than
// seeking to every frame: seeking makes the decoder start again from the previous keyframe.
// Pauses while each frame is processed, so nothing is skipped because processing is slow.
function playbackCapture(video, times, handle, signal) {
  return new Promise((resolve, reject) => {
    let k = 0, rate = 2, settled = false, lastCb = performance.now(), lastMt = -1, busy = false;
    const tol = times.length > 1 ? (times[1] - times[0]) * 0.5 : 0.05;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      video.removeEventListener('ended', onEnded);
      video.pause();
      if (err) reject(err); else resolve(k);
    };
    const onEnded = () => done();
    // If frames stop arriving (some browsers stall playback in the background), give up and
    // let the caller finish with seeking.
    // (Time spent processing a frame doesn't count: a slow frame isn't a stalled video.)
    const watchdog = setInterval(() => { if (!busy && performance.now() - lastCb > 4000) done(new Error('stalled')); }, 1000);
    const onFrame = async (now, meta) => {
      if (settled) return;
      lastCb = performance.now();
      if (signal?.aborted) { done(new DOMException('Cancelled', 'AbortError')); return; }
      const mt = meta.mediaTime;
      if (mt <= lastMt) { video.requestVideoFrameCallback(onFrame); return; }
      lastMt = mt;
      if (mt + tol < times[k]) { video.requestVideoFrameCallback(onFrame); return; }
      video.pause();
      // Targets we flew past (decoder dropped frames) stay empty; a later pass fills them.
      let skipped = 0;
      while (k + 1 < times.length && Math.abs(times[k + 1] - mt) < Math.abs(times[k] - mt)) { k++; skipped++; }
      busy = true;
      try { await handle(k, mt); } catch (e) { busy = false; done(e); return; }
      busy = false;
      lastCb = performance.now();
      // Adapt speed: dropped frames mean the decoder can't keep up.
      rate = skipped ? Math.max(1, rate * 0.7) : Math.min(4, rate * 1.05);
      k++;
      if (k >= times.length) { done(); return; }
      video.playbackRate = rate;
      video.requestVideoFrameCallback(onFrame);
      video.play().catch((e) => done(e));
    };
    video.addEventListener('ended', onEnded);
    video.playbackRate = rate;
    video.requestVideoFrameCallback(onFrame);
    video.play().catch((e) => done(e));
  });
}

/**
 * Samples the video at `fps` between start and end and runs pose detection on each frame.
 * It follows the climber with a zoomed crop (so far-away climbers are big enough for the
 * model), picks the climber over other people using `hint` (a tap, 0..1 coords) or
 * "highest person in frame", and measures camera movement from the background.
 * A second pass goes back to frames where the body wasn't found and tries harder there.
 * onFrame(progress 0..1, pts|null, box|null) is called after each frame for live preview
 * (pts: [[x, y, v]] normalised 0..1; box: tracked region normalised 0..1).
 */
export async function processVideo(video, { landmarker, fps = 10, start = 0, end = null, onFrame, signal, hint = null, twoPass = false }) {
  const duration = video.duration;
  const tEnd = Math.min(end ?? duration, duration - 0.05);
  const W = video.videoWidth, H = video.videoHeight;
  const aspect = W / H;
  // Playback capture needs muted playback (iOS blocks sound without a fresh tap).
  video.muted = true;

  const crop = document.createElement('canvas');
  crop.width = crop.height = CROP;
  const ctx = crop.getContext('2d');

  // Small frame for camera-motion estimation.
  let mw = 192, mh = Math.round((192 * H) / W);
  if (mh > 400) { mh = 400; mw = Math.round((400 * W) / H); }
  const motion = document.createElement('canvas');
  motion.width = mw; motion.height = mh;
  const mctx = motion.getContext('2d', { willReadFrequently: true });

  const total = Math.max(1, Math.floor((tEnd - start) * fps) + 1);
  const times = Array.from({ length: total }, (_, k) => start + k / fps);
  const frames = times.map((t) => ({ t, p: null, cam: null }));
  let roi = null;             // { cx, cy, s } in source pixels
  let last = null;            // last hip centre (source px)
  let lostFor = 0;
  const camera = createCameraTracker(mw, mh);
  let prevBox = null;
  const anchor = hint ? { x: hint.x * W, y: hint.y * H } : null;
  const minS = Math.max(96, Math.min(W, H) * 0.08);
  const maxS = Math.max(W, H);
  let processed = 0;

  // Pick the climber. While tracking, accept weaker detections close to where the climber
  // was (aggressive); a fresh acquisition must be clearer.
  const choose = (poses, near, relaxed = false) => {
    const good = poses.filter((p) => coreVis(p) >= (relaxed ? 0.3 : 0.5));
    if (!good.length) return null;
    if (near) {
      const m = nearest(good, near);
      if (relaxed && roi && m.dist > roi.s * 0.6) return null;
      return m.pose;
    }
    return good.reduce((a, b) => (hipCenter(b).y < hipCenter(a).y ? b : a)); // highest person = climber
  };

  // Processes whatever frame the video is currently showing, as sample k.
  const handle = async (k) => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    // 1. Camera movement from the background (frames arrive in order in this pass).
    mctx.drawImage(video, 0, 0, mw, mh);
    const grad = gradientImage(mctx.getImageData(0, 0, mw, mh).data, mw, mh);
    const { cam: c, delta } = camera.update(grad, prevBox);
    if (roi) { roi.cx += (delta[0] * W) / mw; roi.cy += (delta[1] * H) / mh; }
    if (last) { last = { x: last.x + (delta[0] * W) / mw, y: last.y + (delta[1] * H) / mh }; }

    // 2. Find the climber: in the tracked region first, then a bigger region, then the whole frame.
    let pose = null;
    if (roi) {
      pose = choose(detectRegion(landmarker, video, ctx, W, H, roi.cx - roi.s / 2, roi.cy - roi.s / 2, roi.s, twoPass), last, true);
      if (!pose && lostFor < fps * 2) {
        const s2 = Math.min(maxS, roi.s * 2);
        pose = choose(detectRegion(landmarker, video, ctx, W, H, roi.cx - s2 / 2, roi.cy - s2 / 2, s2, twoPass), last, true);
      }
    }
    if (!pose && (!roi || lostFor % Math.max(1, Math.round(fps / 2)) === 0)) {
      const people = await searchFrame(landmarker, video, ctx, W, H);
      pose = choose(people, last || anchor);
      // After losing the climber for a while, don't jump to someone far away.
      if (pose && last && roi) {
        const hc = hipCenter(pose);
        if (Math.hypot(hc.x - last.x, hc.y - last.y) > roi.s * 1.5 && lostFor < fps * 4) pose = null;
      }
    }

    let pts = null, boxNorm = null;
    if (pose) {
      lostFor = 0;
      last = hipCenter(pose);
      const b = poseBox(pose);
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      const target = { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, s: Math.min(maxS, Math.max(minS, Math.max(bw, bh) * 1.9)) };
      roi = roi
        ? { cx: roi.cx * 0.3 + target.cx * 0.7, cy: roi.cy * 0.3 + target.cy * 0.7, s: roi.s * 0.6 + target.s * 0.4 }
        : target;
      prevBox = { x0: b.x0 / W, y0: b.y0 / H, x1: b.x1 / W, y1: b.y1 / H };
      pts = pose.map((q) => [q.x / W, q.y / H, q.v]);
      boxNorm = { x0: (roi.cx - roi.s / 2) / W, y0: (roi.cy - roi.s / 2) / H, x1: (roi.cx + roi.s / 2) / W, y1: (roi.cy + roi.s / 2) / H };
    } else {
      lostFor++;
      if (roi && lostFor > fps * 2) roi = { ...roi, s: Math.min(maxS, roi.s * 1.25) };
    }
    frames[k] = { t: times[k], p: pose ? pose.map((q) => [q.x / H, q.y / H, q.v]) : null, cam: [c[0] / mh, c[1] / mh] };
    processed++;
    onFrame?.(0.85 * (processed / total), pts, boxNorm);
  };

  // ----- pass 1: play through (fast), or seek frame by frame where playback capture isn't available -----
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    try {
      await seek(video, times[0]);
      await playbackCapture(video, times, handle, signal);
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      console.warn('Playback capture stopped early, seeking the rest', e);
    }
  }
  // Seek through whatever pass 1 didn't reach (the whole video in seek mode), in order,
  // because the camera tracker needs frames in sequence. Frames skipped *inside* pass 1
  // are filled by pass 2 instead (detection only).
  let tail = total;
  while (tail > 0 && frames[tail - 1].cam === null) tail--;
  for (let k = tail; k < total; k++) {
    await seek(video, times[k]);
    await frameReady(video);
    await handle(k);
  }

  // Frames skipped in pass 1 have no camera estimate: interpolate one.
  for (let k = 0; k < total; k++) {
    if (frames[k].cam) continue;
    let a = k - 1; while (a >= 0 && !frames[a].cam) a--;
    let b = k + 1; while (b < total && !frames[b].cam) b++;
    const ca = a >= 0 ? frames[a].cam : null, cb = b < total ? frames[b].cam : null;
    if (ca && cb) { const f = (k - a) / (b - a); frames[k].cam = [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f]; }
    else frames[k].cam = (ca || cb || [0, 0]).slice();
  }

  // ----- pass 2: go back to short gaps where the body wasn't found and try harder -----
  // (a zoomed crop where the climber should be, both normal and mirrored, relaxed thresholds)
  const gaps = [];
  for (let k = 0; k < total; k++) {
    if (frames[k].p) continue;
    let a = k - 1; while (a >= 0 && !frames[a].p) a--;
    let b = k + 1; while (b < total && !frames[b].p) b++;
    if (a >= 0 && b < total && b - a - 1 <= Math.round(fps * 1.5)) gaps.push({ k, a, b });
  }
  const budget = Math.max(30, Math.round(total * 0.25));
  const todo = gaps.slice(0, budget);
  let g = 0;
  for (const { k, a, b } of todo) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const pa = frames[a].p, pb = frames[b].p;
    const f = (k - a) / (b - a);
    // Predicted climber box from the neighbours (converted back to source pixels).
    const box = (p) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of p) { if (q[2] < 0.3) continue; x0 = Math.min(x0, q[0] * H); x1 = Math.max(x1, q[0] * H); y0 = Math.min(y0, q[1] * H); y1 = Math.max(y1, q[1] * H); } return { x0, y0, x1, y1 }; };
    const ba = box(pa), bb = box(pb);
    if (![ba.x0, bb.x0].every(Number.isFinite)) continue;
    const cx = ((ba.x0 + ba.x1) / 2) * (1 - f) + ((bb.x0 + bb.x1) / 2) * f;
    const cy = ((ba.y0 + ba.y1) / 2) * (1 - f) + ((bb.y0 + bb.y1) / 2) * f;
    const size = Math.max(ba.x1 - ba.x0, ba.y1 - ba.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    await seek(video, times[k]);
    await frameReady(video);
    const near = { x: cx, y: cy };
    let pose = null;
    for (const mult of [2, 1.5, 2.8]) {
      const S = Math.min(maxS, Math.max(minS, size * mult));
      const poses = detectRegion(landmarker, video, ctx, W, H, cx - S / 2, cy - S / 2, S, true).filter((p) => coreVis(p) >= 0.3);
      if (poses.length) {
        const m = nearest(poses, near);
        if (m.dist < size * 0.7) { pose = m.pose; break; }
      }
    }
    if (pose) frames[k].p = pose.map((q) => [q.x / H, q.y / H, q.v]);
    g++;
    onFrame?.(0.85 + 0.15 * (g / todo.length), pose ? pose.map((q) => [q.x / W, q.y / H, q.v]) : null, null);
  }
  return { frames, aspect, width: W, height: H, recovered: todo.filter(({ k }) => frames[k].p).length };
}
