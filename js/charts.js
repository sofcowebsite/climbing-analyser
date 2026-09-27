// Small dependency-free SVG charts. Colours come from CSS custom properties.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function makeTooltip(container) {
  let tip = container.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(tip);
  }
  return tip;
}

// rows: [{ value, label, key? }] rendered with textContent (labels may come from user input).
function fillTip(tip, title, rows) {
  tip.replaceChildren();
  const h = document.createElement('div');
  h.className = 'chart-tip-title';
  h.textContent = title;
  tip.appendChild(h);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'chart-tip-row';
    if (r.key) {
      const k = document.createElement('span');
      k.className = `chart-tip-key ${r.key}`;
      row.appendChild(k);
    }
    const v = document.createElement('strong');
    v.textContent = r.value;
    const l = document.createElement('span');
    l.textContent = r.label;
    row.append(v, l);
    tip.appendChild(row);
  }
}

function placeTip(tip, container, x, y) {
  tip.hidden = false;
  const cw = container.clientWidth;
  const tw = tip.offsetWidth;
  let left = x + 12;
  if (left + tw > cw - 4) left = x - tw - 12;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(0, y - 10)}px`;
}

/**
 * Line chart with optional shaded bands, event markers and a crosshair.
 * opts: { xs, ys, xFmt, yFmt, bands: [{x0,x1,cls,label}], markers: [{x,label}],
 *         yMin, yMax, height, tipRows(i) -> rows, tipTitle(i), onPick(x), ariaLabel, dots }
 */
export function lineChart(container, opts) {
  container.replaceChildren();
  container.classList.add('chart');
  const W = Math.max(280, container.clientWidth || 340);
  const H = opts.height || 200;
  const m = { l: 40, r: 12, t: 12, b: 26 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xs = opts.xs, ys = opts.ys;
  const valid = ys.map((v, i) => [xs[i], v]).filter(([, v]) => isNum(v));
  if (valid.length < 2) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Not enough data for a chart yet.';
    container.appendChild(p);
    return;
  }
  const xMin = opts.xMin ?? xs[0], xMax = opts.xMax ?? xs[xs.length - 1];
  const yVals = valid.map(([, v]) => v);
  let yMin = opts.yMin ?? Math.min(0, ...yVals), yMax = opts.yMax ?? Math.max(...yVals);
  if (yMax - yMin < 1e-6) yMax = yMin + 1;
  const ticks = niceTicks(yMin, yMax, 4);
  yMin = Math.min(yMin, ticks[0]); yMax = Math.max(yMax, ticks[ticks.length - 1]);
  const sx = (x) => m.l + ((x - xMin) / (xMax - xMin || 1)) * iw;
  const sy = (y) => m.t + ih - ((y - yMin) / (yMax - yMin)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opts.ariaLabel || 'Chart' }, container);

  for (const b of opts.bands || []) {
    el('rect', { x: sx(b.x0), y: m.t, width: Math.max(1, sx(b.x1) - sx(b.x0)), height: ih, class: `band ${b.cls || ''}` }, svg);
  }
  for (const t of ticks) {
    el('line', { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), class: t === ticks[0] ? 'axis' : 'grid' }, svg);
    const tx = el('text', { x: m.l - 6, y: sy(t) + 4, 'text-anchor': 'end', class: 'tick' }, svg);
    tx.textContent = opts.yFmt ? opts.yFmt(t, true) : t;
  }
  for (const t of opts.xTicks || niceTicks(xMin, xMax, 5)) {
    if (t < xMin || t > xMax) continue;
    const tx = el('text', { x: sx(t), y: H - 6, 'text-anchor': 'middle', class: 'tick' }, svg);
    tx.textContent = opts.xFmt ? opts.xFmt(t, true) : t;
  }

  // Path, broken at gaps.
  let d = '', area = '', seg = [];
  const flush = () => {
    if (seg.length > 1) {
      d += seg.map(([x, y], k) => `${k ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('');
      area += `M${sx(seg[0][0]).toFixed(1)},${sy(Math.max(yMin, 0)).toFixed(1)}` +
        seg.map(([x, y]) => `L${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('') +
        `L${sx(seg[seg.length - 1][0]).toFixed(1)},${sy(Math.max(yMin, 0)).toFixed(1)}Z`;
    }
    seg = [];
  };
  xs.forEach((x, i) => { if (isNum(ys[i])) seg.push([x, ys[i]]); else flush(); });
  flush();
  if (opts.area !== false) el('path', { d: area, class: 'area' }, svg);
  el('path', { d, class: 'line' }, svg);

  if (opts.dots) {
    valid.forEach(([x, y]) => el('circle', { cx: sx(x), cy: sy(y), r: 4, class: 'dot' }, svg));
  }
  for (const mk of opts.markers || []) {
    const i = nearestIndex(xs, mk.x);
    if (!isNum(ys[i])) continue;
    el('circle', { cx: sx(xs[i]), cy: sy(ys[i]), r: 4.5, class: `marker ${mk.cls || ''}` }, svg);
  }
  // Direct label on the last point.
  const last = valid[valid.length - 1];
  if (opts.endLabel !== false) {
    el('circle', { cx: sx(last[0]), cy: sy(last[1]), r: 4, class: 'dot' }, svg);
  }

  const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' }, svg);
  const focus = el('circle', { r: 5, class: 'dot focus', visibility: 'hidden' }, svg);
  const tip = makeTooltip(container);
  const hit = el('rect', { x: m.l, y: 0, width: iw, height: H, fill: 'transparent', tabindex: 0 }, svg);
  let cur = valid.length - 1;

  const show = (i) => {
    if (!isNum(ys[i])) return;
    const x = sx(xs[i]), y = sy(ys[i]);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    focus.setAttribute('cx', x); focus.setAttribute('cy', y); focus.setAttribute('visibility', 'visible');
    fillTip(tip, opts.tipTitle ? opts.tipTitle(i) : (opts.xFmt ? opts.xFmt(xs[i]) : xs[i]), opts.tipRows ? opts.tipRows(i) : [{ value: opts.yFmt ? opts.yFmt(ys[i]) : ys[i], label: '' }]);
    placeTip(tip, container, (x / W) * container.clientWidth, (y / H) * svg.getBoundingClientRect().height);
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const pick = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const xv = xMin + ((x - m.l) / iw) * (xMax - xMin);
    let i = nearestIndex(xs, xv);
    if (!isNum(ys[i])) i = nearestValid(xs, ys, xv);
    cur = i;
    show(i);
    return i;
  };
  hit.addEventListener('pointermove', pick);
  hit.addEventListener('pointerdown', (ev) => { const i = pick(ev); opts.onPick?.(xs[i]); });
  hit.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') hide(); });
  hit.addEventListener('focus', () => show(cur));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      const dir = ev.key === 'ArrowRight' ? 1 : -1;
      let i = cur + dir;
      while (i >= 0 && i < xs.length && !isNum(ys[i])) i += dir;
      if (i >= 0 && i < xs.length) { cur = i; show(i); }
      ev.preventDefault();
    } else if (ev.key === 'Enter') opts.onPick?.(xs[cur]);
  });
}

function nearestIndex(xs, x) {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  return best;
}
function nearestValid(xs, ys, x) {
  let best = -1;
  for (let i = 0; i < xs.length; i++) if (isNum(ys[i]) && (best < 0 || Math.abs(xs[i] - x) < Math.abs(xs[best] - x))) best = i;
  return Math.max(0, best);
}

/**
 * Horizontal 0-100 bars with a value at the tip and a status word.
 * items: [{ label, value, status, statusLabel, note }]
 */
export function scoreBars(container, items) {
  container.replaceChildren();
  container.classList.add('bars');
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const head = document.createElement('div');
    head.className = 'bar-head';
    const name = document.createElement('span');
    name.className = 'bar-label';
    name.textContent = it.label;
    const st = document.createElement('span');
    st.className = `status status-${it.status}`;
    st.textContent = it.statusLabel;
    head.append(name, st);
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = isNum(it.value) ? `${Math.max(2, it.value)}%` : '0%';
    const val = document.createElement('span');
    val.className = 'bar-value';
    val.textContent = it.valueText ?? (isNum(it.value) ? it.value : '—');
    track.append(fill, val);
    row.append(head, track);
    if (it.note) {
      const n = document.createElement('p');
      n.className = 'bar-note';
      n.textContent = it.note;
      row.appendChild(n);
    }
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', `${it.label}: ${it.valueText ?? (isNum(it.value) ? `${it.value} out of 100` : 'no data')}, ${it.statusLabel}`);
    container.appendChild(row);
  }
}

// Tiny trend line for stat tiles.
export function sparkline(container, values) {
  container.replaceChildren();
  const vals = values.filter(isNum);
  if (vals.length < 2) return;
  const W = 120, H = 32, p = 4;
  const min = Math.min(...vals), max = Math.max(...vals);
  const sx = (i) => p + (i / (vals.length - 1)) * (W - 2 * p);
  const sy = (v) => H - p - ((v - min) / (max - min || 1)) * (H - 2 * p);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true', class: 'spark' }, container);
  el('path', { d: vals.map((v, i) => `${i ? 'L' : 'M'}${sx(i)},${sy(v)}`).join(''), class: 'spark-line' }, svg);
  el('circle', { cx: sx(vals.length - 1), cy: sy(vals[vals.length - 1]), r: 3, class: 'spark-dot' }, svg);
}
