// Movement timeline: one lane for the whole-body state and one per limb, over the climb.
// Tap (or arrow-key to) a moment to see every label for that half-second window.

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

// Categories drawn in each lane (fixed colour order; see CSS --cat-*).
export const STATE_CATS = [
  ['hold_change', 'Changing holds', 'cat-1'],
  ['hold_traction', 'Pulling / pushing up', 'cat-2'],
  ['postural_regulation', 'Adjusting body', 'cat-3'],
  ['hold_exploration', 'Exploring', 'cat-4'],
  ['immobility', 'Still', 'cat-5'],
];
const LIMB_CAT = (v) => {
  if (!v || v === 'unknown') return 'unknown';
  if (['reach', 'release', 'reverse/downclimb'].includes(v)) return 'moving';
  if (v === 'touch/probe') return 'probe';
  if (['grip_set', 'foot_set', 'high_step', 'crossover', 'foot_swap', 'regrip/reset'].includes(v)) return 'placing';
  if (v === 'shakeout') return 'shakeout';
  return 'holding';
};
// Same colour = same meaning in every lane: blue = moving to a new hold, yellow =
// exploring/probing, pink = still/resting.
export const LIMB_CATS = [
  ['holding', 'On a hold', 'lane-hold'],
  ['moving', 'Moving', 'cat-1'],
  ['placing', 'Placing / re-gripping', 'cat-1'],
  ['probe', 'Probing', 'cat-4'],
  ['shakeout', 'Shaking out', 'cat-5'],
  ['unknown', 'Can\'t see', 'lane-unknown'],
];

const LANES = [
  ['Body', (s) => (s.labels.body_state || 'unknown'), STATE_CATS],
  ['L hand', (s) => LIMB_CAT(s.labels.hand_left), LIMB_CATS],
  ['R hand', (s) => LIMB_CAT(s.labels.hand_right), LIMB_CATS],
  ['L foot', (s) => LIMB_CAT(s.labels.foot_left), LIMB_CATS],
  ['R foot', (s) => LIMB_CAT(s.labels.foot_right), LIMB_CATS],
];

const PRETTY = {
  segment_role: 'Role', movement_mode: 'Static / dynamic', contact_count_visible: 'Contacts visible', body_state: 'Body state',
  hand_left: 'Left hand', hand_right: 'Right hand', foot_left: 'Left foot', foot_right: 'Right foot',
  hand_grip_visible: 'Grip type', body_orientation: 'Body orientation', hip_wall_relation: 'Hips to wall', hip_motion: 'Hip movement',
  arm_posture: 'Supporting arm', leg_posture: 'Legs', balance_proxy: 'Balance', flag: 'Flag', movement_family: 'Movement family',
  terrain_context: 'Terrain', handhold_orientation: 'Hold direction (from arm angle)', crack_subtype: 'Crack jam', transition_event: 'Events',
  outcome: 'Outcome', visibility_confidence: 'Visibility',
};
const CONF = { high: 'sure', medium: 'fairly sure', low: 'not sure' };

/**
 * labels: result.labels; opts: { onSeek?: (t) => void, fmtTime: (t) => string }
 */
export function renderTimeline(container, labels, opts) {
  container.replaceChildren();
  const segs = labels.segments;
  if (!segs.length) return;
  const W = Math.max(300, container.clientWidth || 340);
  const laneH = 18, gap = 6, left = 60, top = 4;
  const H = top + LANES.length * (laneH + gap) + 26;
  const t0 = segs[0].t0, t1 = segs[segs.length - 1].t1;
  const sx = (t) => left + ((t - t0) / (t1 - t0 || 1)) * (W - left - 8);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Movement timeline: body state and each hand and foot over time' }, container);
  LANES.forEach(([name, get], li) => {
    const y = top + li * (laneH + gap);
    const lab = el('text', { x: 0, y: y + laneH - 5, class: 'tick' }, svg);
    lab.textContent = name;
    // Merge equal neighbours so the 2px surface gap separates real changes only.
    let run = null;
    const flush = () => { if (run) el('rect', { x: sx(run.t0) + 1, y, width: Math.max(1, sx(run.t1) - sx(run.t0) - 2), height: laneH, rx: 3, class: `lane ${run.cls}` }, svg); };
    for (const s of segs) {
      const v = get(s);
      const cat = LANES[li][2].find((c) => c[0] === v) || ['unknown', '', 'lane-unknown'];
      if (run && run.cls === cat[2] && Math.abs(run.t1 - s.t0) < 0.05) run.t1 = s.t1;
      else { flush(); run = { t0: s.t0, t1: s.t1, cls: cat[2] }; }
    }
    flush();
  });
  // Event ticks under the lanes.
  const ey = top + LANES.length * (laneH + gap);
  for (const e of labels.events) {
    if (!['fall', 'catch', 'touch/probe', 'hand_match', 'cross_through', 'rest_start'].includes(e.type)) continue;
    el('line', { x1: sx(e.t), x2: sx(e.t), y1: ey - 2, y2: ey + 6, class: `evtick ${e.type === 'fall' ? 'evtick-fall' : ''}` }, svg);
  }
  for (const t of [t0, (t0 + t1) / 2, t1]) {
    const tx = el('text', { x: sx(t), y: H - 4, 'text-anchor': t === t0 ? 'start' : t === t1 ? 'end' : 'middle', class: 'tick' }, svg);
    tx.textContent = opts.fmtTime(t);
  }
  const cursor = el('line', { y1: 0, y2: ey, class: 'crosshair', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: left, y: 0, width: W - left, height: H, fill: 'transparent', tabindex: 0 }, svg);

  const mkLegend = (title, items) => {
    const d = document.createElement('div');
    d.className = 'legend';
    const b = document.createElement('strong');
    b.textContent = title;
    d.append(b);
    for (const [label, cls] of items) {
      const sp = document.createElement('span');
      const i = document.createElement('i');
      i.className = `lane-key ${cls}`;
      sp.append(i, document.createTextNode(label));
      d.append(sp);
    }
    return d;
  };
  const legend = mkLegend('Body:', STATE_CATS.map(([, l, c]) => [l, c]));
  const legend2 = mkLegend('Hands & feet:', [['On a hold', 'lane-hold'], ['Moving / placing', 'cat-1'], ['Probing', 'cat-4'], ['Shaking out', 'cat-5'], ['Can\'t see', 'lane-unknown']]);
  const inspector = document.createElement('div');
  inspector.className = 'inspector';
  inspector.textContent = 'Tap the timeline to see every label for that moment.';
  container.append(legend, legend2, inspector);

  let cur = 0;
  const show = (k) => {
    cur = Math.max(0, Math.min(segs.length - 1, k));
    const s = segs[cur];
    const x = sx((s.t0 + s.t1) / 2);
    cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.setAttribute('visibility', 'visible');
    inspector.replaceChildren();
    const head = document.createElement('div');
    head.className = 'inspector-head';
    const title = document.createElement('strong');
    title.textContent = `${opts.fmtTime(s.t0)} – ${opts.fmtTime(s.t1)}`;
    head.append(title);
    if (opts.onSeek) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'linkish'; b.textContent = 'Watch';
      b.addEventListener('click', () => opts.onSeek(Math.max(0, s.t0 - 0.5)));
      head.append(b);
    }
    inspector.append(head);
    const table = document.createElement('table');
    table.className = 'data compact';
    for (const [k, v] of Object.entries(s.labels)) {
      const tr = document.createElement('tr');
      const a = document.createElement('td'); a.textContent = PRETTY[k] || k;
      const b = document.createElement('td'); b.textContent = (Array.isArray(v) ? v.join(', ') : String(v)).replace(/_/g, ' ');
      const c = document.createElement('td'); c.className = 'num muted';
      // "unknown" by design (not observable from one camera) isn't a low-confidence guess.
      c.textContent = String(v) === 'unknown' && s.conf?.[k] === 'high' ? 'can\'t be seen from one camera' : s.conf?.[k] ? CONF[s.conf[k]] : '';
      tr.append(a, b, c);
      table.append(tr);
    }
    inspector.append(table);
  };
  const pick = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const t = t0 + ((x - left) / (W - left - 8)) * (t1 - t0);
    let k = segs.findIndex((s) => t >= s.t0 && t < s.t1);
    if (k < 0) k = t < t0 ? 0 : segs.length - 1;
    show(k);
  };
  hit.addEventListener('pointerdown', pick);
  hit.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowRight') { show(cur + 1); ev.preventDefault(); }
    if (ev.key === 'ArrowLeft') { show(cur - 1); ev.preventDefault(); }
  });
  hit.addEventListener('focus', () => show(cur));
}

// Everything the app labelled, in a form that can be reviewed, corrected and used as
// training data for a real model later.
export function labelsExport(session) {
  const a = session.analysis;
  return {
    format: 'crux-coach-movement-labels', version: 1,
    note: 'Automatic labels from body-pose rules on a single camera. "unknown" means not observable, not absent. Each label has a confidence (conf).',
    climb: { name: session.name, date: new Date(session.createdAt).toISOString(), type: session.type, grade: session.grade, outcome: session.outcome, outcomeSource: session.outcomeSource, terrain: a.labels?.terrain },
    detectedOutcome: a.outcome, segmentSec: a.labels?.segmentSec, segments: a.labels?.segments, events: a.labels?.events,
    fluency: a.labels?.fluency, repertoire: a.labels?.repertoire, falls: a.falls,
  };
}
