// Runs MediaPipe Pose on a video, entirely in the browser.
// The model and WebAssembly runtime are served from this site (see /vendor and /models).

import { FilesetResolver, PoseLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';

const WASM_PATH = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
const MODELS = {
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
    runningMode: 'VIDEO',
    numPoses: 1,
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

/**
 * Samples the video at `fps` between start and end, runs pose detection on each frame
 * and returns frames in the format metrics.analyze() expects.
 * onFrame(progress 0..1, landmarks|null) is called after each frame for live preview.
 */
export async function processVideo(video, { landmarker, fps = 10, start = 0, end = null, onFrame, signal, maxSide = 640 }) {
  const duration = video.duration;
  const tEnd = Math.min(end ?? duration, duration - 0.05);
  const W = video.videoWidth, H = video.videoHeight;
  const scale = Math.min(1, maxSide / Math.max(W, H));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const aspect = W / H;

  const frames = [];
  const total = Math.max(1, Math.floor((tEnd - start) * fps) + 1);
  let lastTs = -1;
  for (let k = 0; k < total; k++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const t = start + k / fps;
    await seek(video, t);
    await frameReady(video);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let ts = Math.round(t * 1000);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    const res = landmarker.detectForVideo(canvas, ts);
    const lm = res.landmarks && res.landmarks[0];
    const p = lm ? lm.map((q) => [q.x * aspect, q.y, q.visibility ?? 1]) : null;
    frames.push({ t, p });
    onFrame?.((k + 1) / total, lm || null);
  }
  return { frames, aspect, width: W, height: H };
}

export const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

// Draws a skeleton; points are MediaPipe-normalised {x,y,visibility} or [x/aspect, y, v].
export function drawSkeleton(ctx, pts, w, h, { color = '#3987e5', joint = '#ffffff' } = {}) {
  if (!pts) return;
  const get = (i) => {
    const q = pts[i];
    if (!q) return null;
    return Array.isArray(q) ? { x: q[0], y: q[1], v: q[2] } : { x: q.x, y: q.y, v: q.visibility ?? 1 };
  };
  ctx.lineWidth = Math.max(2, w / 200);
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  for (const [a, b] of POSE_CONNECTIONS) {
    const p = get(a), q = get(b);
    if (!p || !q || p.v < 0.3 || q.v < 0.3) continue;
    ctx.beginPath();
    ctx.moveTo(p.x * w, p.y * h);
    ctx.lineTo(q.x * w, q.y * h);
    ctx.stroke();
  }
  ctx.fillStyle = joint;
  for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]) {
    const p = get(i);
    if (!p || p.v < 0.3) continue;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, Math.max(3, w / 160), 0, Math.PI * 2);
    ctx.fill();
  }
}
