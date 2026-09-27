import test from 'node:test';
import assert from 'node:assert/strict';
import { gradientImage, estimateShift, backgroundMask, createCameraTracker } from '../js/camera.js';

// A smooth random "rock" texture, sampled with an offset (a camera pan).
function rock(w, h, ox, oy, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const blobs = Array.from({ length: 220 }, () => [rnd() * (w + 80) - 40, rnd() * (h + 80) - 40, 3 + rnd() * 9, rnd() * 200]);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 60;
      for (const [bx, by, r, c] of blobs) {
        const d2 = (x - ox - bx) ** 2 + (y - oy - by) ** 2;
        if (d2 < r * r * 4) v += c * Math.exp(-d2 / (r * r));
      }
      const k = (y * w + x) * 4;
      rgba[k] = rgba[k + 1] = rgba[k + 2] = Math.min(255, v);
      rgba[k + 3] = 255;
    }
  }
  return gradientImage(rgba, w, h);
}

test('recovers a camera pan', () => {
  const w = 96, h = 170;
  const a = rock(w, h, 0, 0);
  for (const [dx, dy] of [[0, 0], [3, -5], [-7, 10], [12, 2]]) {
    const b = rock(w, h, dx, dy);
    const r = estimateShift(a, b, w, h, backgroundMask(w, h, null));
    assert.ok(Math.abs(r.dx - dx) <= 0.6 && Math.abs(r.dy - dy) <= 0.6, `expected ${dx},${dy} got ${r.dx.toFixed(2)},${r.dy.toFixed(2)}`);
  }
});

test('ignores the masked climber area and a still camera stays still', () => {
  const w = 96, h = 170;
  const a = rock(w, h, 0, 0);
  const b = rock(w, h, 0, 0);
  // Paint a moving "climber" in b only.
  for (let y = 60; y < 110; y++) for (let x = 40; x < 56; x++) b[y * w + x] += 80;
  const mask = backgroundMask(w, h, { x0: 40 / w, y0: 60 / h, x1: 56 / w, y1: 110 / h });
  const r = estimateShift(a, b, w, h, mask);
  assert.equal(r.dx, 0);
  assert.equal(r.dy, 0);
});

test('featureless background reports no movement', () => {
  const w = 64, h = 64;
  const flat = new Float32Array(w * h);
  const r = estimateShift(flat, flat, w, h, backgroundMask(w, h, null));
  assert.equal(r.reliable, false);
  assert.equal(r.dx, 0);
});

test('slow pans add up (sub-pixel per frame)', () => {
  const w = 96, h = 170;
  const tracker = createCameraTracker(w, h);
  let out;
  // 0.15 px per frame for 60 frames = 9 px total, plus a still start.
  for (let i = 0; i <= 60; i++) out = tracker.update(rock(w, h, 0, i * 0.15), null);
  assert.ok(Math.abs(out.cam[1] - 9) < 1.2, `expected ~9 px, got ${out.cam[1].toFixed(2)}`);
  assert.ok(Math.abs(out.cam[0]) < 1, `x drift ${out.cam[0].toFixed(2)}`);
});

test('a still camera does not drift', () => {
  const w = 96, h = 170;
  const tracker = createCameraTracker(w, h);
  let out;
  for (let i = 0; i < 40; i++) out = tracker.update(rock(w, h, 0, 0), null);
  assert.deepEqual(out.cam, [0, 0]);
});
