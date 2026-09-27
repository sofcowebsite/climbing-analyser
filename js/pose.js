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

export async function loadLandmarker({ model = 'full', delegate = 'GPU' } = {}) {
  const key = `${model}:${delegate}`;
  if (cached.key === key) return cached.landmarker;
  if (cached.landmarker) { try { cached.landmarker.close(); } catch { /* already closed */ } }
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const landmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODELS[model], delegate },
    // IMAGE mode: we move our own zoomed crop between frames, so the model's built-in
    // frame-to-frame tracking would be misled.
    runningMode: 'IMAGE',
    numPoses: 2,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
  cached = { key, landmarker };
  return landmarker;
}

// Loads with the preferred delegate, falling back to CPU if the GPU path fails.
export async function loadWithFallback(model, preferCpu) {
  if (!preferCpu) {
    try { return { landmarker: await loadLandmarker({ model, delegate: 'GPU' }), delegate: 'GPU' }; }
    catch (e) { console.warn('GPU delegate failed, using CPU', e); }
  }
  return { landmarker: await loadLandmarker({ model, delegate: 'CPU' }), delegate: 'CPU' };
}

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

/**
 * Samples the video at `fps` between start and end and runs pose detection on each frame.
 * It follows the climber with a zoomed crop (so far-away climbers are big enough for the
 * model), picks the climber over other people using `hint` (a tap, 0..1 coords) or
 * "highest person in frame", and measures camera movement from the background.
 * onFrame(progress 0..1, pts|null, box|null) is called after each frame for live preview
 * (pts: [[x, y, v]] normalised 0..1; box: tracked region normalised 0..1).
 */
export async function processVideo(video, { landmarker, fps = 10, start = 0, end = null, onFrame, signal, hint = null, twoPass = false }) {
  const duration = video.duration;
  const tEnd = Math.min(end ?? duration, duration - 0.05);
  const W = video.videoWidth, H = video.videoHeight;
  const aspect = W / H;

  const crop = document.createElement('canvas');
  crop.width = crop.height = CROP;
  const ctx = crop.getContext('2d');

  // Small frame for camera-motion estimation.
  let mw = 192, mh = Math.round((192 * H) / W);
  if (mh > 400) { mh = 400; mw = Math.round((400 * W) / H); }
  const motion = document.createElement('canvas');
  motion.width = mw; motion.height = mh;
  const mctx = motion.getContext('2d', { willReadFrequently: true });

  const frames = [];
  const total = Math.max(1, Math.floor((tEnd - start) * fps) + 1);
  let roi = null;             // { cx, cy, s } in source pixels
  let last = null;            // last hip centre (source px)
  let lostFor = 0;
  const camera = createCameraTracker(mw, mh);
  let prevBox = null;
  const cam = [0, 0];         // cumulative camera shift, normalised to frame height
  const anchor = hint ? { x: hint.x * W, y: hint.y * H } : null;
  const minS = Math.max(96, Math.min(W, H) * 0.08);
  const maxS = Math.max(W, H);

  const choose = (poses, near) => {
    const good = poses.filter((p) => coreVis(p) >= 0.5);
    if (!good.length) return null;
    if (near) return nearest(good, near).pose;
    return good.reduce((a, b) => (hipCenter(b).y < hipCenter(a).y ? b : a)); // highest person = climber
  };

  for (let k = 0; k < total; k++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const t = start + k / fps;
    await seek(video, t);
    await frameReady(video);

    // 1. Camera movement from the background.
    mctx.drawImage(video, 0, 0, mw, mh);
    const grad = gradientImage(mctx.getImageData(0, 0, mw, mh).data, mw, mh);
    const { cam: c, delta } = camera.update(grad, prevBox);
    cam[0] = c[0] / mh;
    cam[1] = c[1] / mh;
    if (roi) { roi.cx += (delta[0] * W) / mw; roi.cy += (delta[1] * H) / mh; }
    if (last) { last = { x: last.x + (delta[0] * W) / mw, y: last.y + (delta[1] * H) / mh }; }

    // 2. Find the climber: in the tracked region first, then a bigger region, then the whole frame.
    let pose = null;
    if (roi) {
      pose = choose(detectRegion(landmarker, video, ctx, W, H, roi.cx - roi.s / 2, roi.cy - roi.s / 2, roi.s, twoPass), last);
      if (!pose && lostFor < fps * 2) {
        const s2 = Math.min(maxS, roi.s * 2);
        pose = choose(detectRegion(landmarker, video, ctx, W, H, roi.cx - s2 / 2, roi.cy - s2 / 2, s2, twoPass), last);
      }
    }
    if (!pose && (!roi || lostFor % Math.max(1, Math.round(fps)) === 0)) {
      const people = await searchFrame(landmarker, video, ctx, W, H);
      pose = choose(people, last || anchor);
      // After losing the climber for a while, don't jump to someone far away.
      if (pose && last && roi) {
        const c = hipCenter(pose);
        if (Math.hypot(c.x - last.x, c.y - last.y) > roi.s * 1.5 && lostFor < fps * 4) pose = null;
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
    frames.push({ t, p: pose ? pose.map((q) => [q.x / H, q.y / H, q.v]) : null, cam: [cam[0], cam[1]] });
    onFrame?.((k + 1) / total, pts, boxNorm);
  }
  return { frames, aspect, width: W, height: H };
}
