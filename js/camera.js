// Estimates how far the camera moved between two frames by matching the background
// (the rock), ignoring the area around the climber. Pure functions on small grayscale
// images so they can be tested in Node.

// RGBA ImageData -> gradient-magnitude image (robust to exposure changes).
export function gradientImage(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < w * h; i += 4, j++) g[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      out[k] = Math.abs(g[k + 1] - g[k - 1]) + Math.abs(g[k + w] - g[k - w]);
    }
  }
  return out;
}

function half(img, w, h) {
  const w2 = w >> 1, h2 = h >> 1;
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const k = 2 * y * w + 2 * x;
      out[y * w2 + x] = (img[k] + img[k + 1] + img[k + w] + img[k + w + 1]) / 4;
    }
  }
  return { img: out, w: w2, h: h2 };
}

function halfMask(m, w, h) {
  const w2 = w >> 1, h2 = h >> 1;
  const out = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const k = 2 * y * w + 2 * x;
      out[y * w2 + x] = m[k] & m[k + 1] & m[k + w] & m[k + w + 1];
    }
  }
  return out;
}

// Mean absolute difference between prev(p) and cur(p + d) over usable pixels.
function cost(a, b, m, w, h, dx, dy) {
  let s = 0, n = 0;
  const x0 = Math.max(1, -dx + 1), x1 = Math.min(w - 1, w - dx - 1);
  const y0 = Math.max(1, -dy + 1), y1 = Math.min(h - 1, h - dy - 1);
  for (let y = y0; y < y1; y++) {
    const row = y * w, row2 = (y + dy) * w + dx;
    for (let x = x0; x < x1; x++) {
      if (!m[row + x]) continue;
      s += Math.abs(a[row + x] - b[row2 + x]);
      n++;
    }
  }
  return n > 0 ? { c: s / n, n } : { c: Infinity, n: 0 };
}

/**
 * prev, cur: gradient images (w x h). mask: Uint8Array, 1 where background is usable.
 * Returns { dx, dy } in pixels of the input images: a point on the wall at p in prev is at p + d in cur.
 */
export function estimateShift(prev, cur, w, h, mask, { maxFrac = 0.15, guess = [0, 0] } = {}) {
  // Not enough texture (e.g. mostly sky): assume the camera is still.
  let tex = 0, cnt = 0;
  for (let k = 0; k < w * h; k++) if (mask[k]) { tex += prev[k]; cnt++; }
  if (cnt < w * h * 0.15 || tex / cnt < 4) return { dx: 0, dy: 0, reliable: false };

  const L1 = half(prev, w, h), C1 = half(cur, w, h), M1 = halfMask(mask, w, h);
  const L2 = half(L1.img, L1.w, L1.h), C2 = half(C1.img, C1.w, C1.h), M2 = halfMask(M1, L1.w, L1.h);
  const levels = [
    { a: prev, b: cur, m: mask, w, h },
    { a: L1.img, b: C1.img, m: M1, w: L1.w, h: L1.h },
    { a: L2.img, b: C2.img, m: M2, w: L2.w, h: L2.h },
  ];
  const minN = (lv) => lv.w * lv.h * 0.1;

  // Coarse exhaustive search.
  const top = levels[2];
  const R = Math.max(2, Math.ceil(top.w * maxFrac));
  const gx = Math.round(guess[0] / 4), gy = Math.round(guess[1] / 4);
  let best = { dx: 0, dy: 0, c: Infinity };
  for (let dy = gy - R; dy <= gy + R; dy++) {
    for (let dx = gx - R; dx <= gx + R; dx++) {
      const r = cost(top.a, top.b, top.m, top.w, top.h, dx, dy);
      if (r.n >= minN(top) && r.c < best.c) best = { dx, dy, c: r.c };
    }
  }
  // Refine at finer levels.
  for (let li = 1; li >= 0; li--) {
    const lv = levels[li];
    const cx = best.dx * 2, cy = best.dy * 2;
    best = { dx: cx, dy: cy, c: Infinity };
    for (let dy = cy - 2; dy <= cy + 2; dy++) {
      for (let dx = cx - 2; dx <= cx + 2; dx++) {
        const r = cost(lv.a, lv.b, lv.m, lv.w, lv.h, dx, dy);
        if (r.n >= minN(lv) && r.c < best.c) best = { dx, dy, c: r.c };
      }
    }
  }
  if (!isFinite(best.c)) return { dx: 0, dy: 0, reliable: false };

  // Prefer "no movement" when it's practically as good (stops tripod videos drifting).
  const zero = cost(prev, cur, mask, w, h, 0, 0);
  if (zero.c <= best.c * 1.04 + 0.05) return { dx: 0, dy: 0, reliable: true };

  // Sub-pixel refinement with a parabola through neighbouring costs.
  const sub = (cm, c0, cp) => {
    const d = cm - 2 * c0 + cp;
    return d > 0 ? Math.max(-0.5, Math.min(0.5, (cm - cp) / (2 * d))) : 0;
  };
  const c = (dx, dy) => cost(prev, cur, mask, w, h, dx, dy).c;
  const fx = sub(c(best.dx - 1, best.dy), best.c, c(best.dx + 1, best.dy));
  const fy = sub(c(best.dx, best.dy - 1), best.c, c(best.dx, best.dy + 1));
  return { dx: best.dx + (isFinite(fx) ? fx : 0), dy: best.dy + (isFinite(fy) ? fy : 0), reliable: true };
}

// Mask that excludes the climber's bounding box (normalised 0..1 coords, padded) and the image border.
export function backgroundMask(w, h, box, pad = 0.6) {
  const m = new Uint8Array(w * h).fill(1);
  const b = 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < b || y < b || x >= w - b || y >= h - b) m[y * w + x] = 0;
  if (box) {
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const x0 = Math.floor((box.x0 - bw * pad) * w), x1 = Math.ceil((box.x1 + bw * pad) * w);
    const y0 = Math.floor((box.y0 - bh * pad * 0.5) * h), y1 = Math.ceil((box.y1 + bh * pad * 0.5) * h);
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) m[y * w + x] = 0;
    }
  }
  return m;
}

function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/**
 * Tracks cumulative camera movement over a sequence of gradient images.
 * Motion is measured against a reference ("key") frame rather than the previous frame:
 * a slow pan moves well under a pixel per frame, but adds up against the key frame.
 * update(grad, climberBox) returns { cam: [x, y], delta: [dx, dy] } in image pixels,
 * where cam is the total shift since the first frame and delta the change since the last call.
 */
export function createCameraTracker(w, h) {
  let key = null;       // { grad, cam, box }
  let rel = [0, 0];     // shift of the current frame vs the key frame
  let cam = [0, 0];
  let prevBox = null;
  return {
    update(grad, box) {
      const before = [cam[0], cam[1]];
      if (!key) {
        key = { grad, cam: [0, 0], box };
      } else {
        const mask = backgroundMask(w, h, unionBox(unionBox(key.box, prevBox), box));
        const r = estimateShift(key.grad, grad, w, h, mask, { guess: rel });
        if (r.reliable) {
          rel = [r.dx, r.dy];
          cam = [key.cam[0] + r.dx, key.cam[1] + r.dy];
        }
        // Start a new key frame once the view has shifted a lot (or can't be matched).
        if (!r.reliable || Math.hypot(r.dx, r.dy) > w * 0.12) {
          key = { grad, cam: [cam[0], cam[1]], box };
          rel = [0, 0];
        }
      }
      prevBox = box;
      return { cam: [cam[0], cam[1]], delta: [cam[0] - before[0], cam[1] - before[1]] };
    },
  };
}
