// Renders one session's analysis report.

import { lineChart, scoreBars } from './charts.js';
import { scoreLabel, scoreStatus, METRIC_DEFS } from './coach.js';
import { GRADE_SCALES } from './grades.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const TYPE_LABELS = { boulder: 'Boulder', 'top-rope': 'Top rope', lead: 'Lead', other: 'Climb' };
const OUTCOME_LABELS = { sent: 'Sent', fell: 'Fell', attempt: 'Working it' };

export function fmtTime(sec, tenths = false) {
  if (!isNum(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')}`;
}

// Torso length ≈ 30% of standing height.
export function torsoToMetres(t, heightCm) {
  return t * 0.3 * ((heightCm || 170) / 100);
}

export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}
export { h };

function ring(score) {
  const r = 44, c = 2 * Math.PI * r;
  const wrap = h('div', { class: 'score-ring', role: 'img', 'aria-label': `Overall score ${isNum(score) ? score : 'not available'} out of 100` });
  wrap.innerHTML = `<svg viewBox="0 0 104 104" aria-hidden="true"><circle class="ring-track" cx="52" cy="52" r="${r}" fill="none" stroke-width="10"/><circle class="ring-fill" cx="52" cy="52" r="${r}" fill="none" stroke-width="10" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - (score || 0) / 100)}"/></svg>`;
  wrap.append(h('div', { class: 'ring-num' }, h('strong', { text: isNum(score) ? String(score) : '—' }), h('span', { text: 'overall' })));
  return wrap;
}

/**
 * opts: { heightCm, onSeek(t) | null, extra: Node (inserted after header) }
 */
export function renderReport(container, session, opts = {}) {
  container.replaceChildren();
  const { analysis: a, report: r } = session;
  const m = a.metrics;
  const heightCm = opts.heightCm;
  const canSeek = typeof opts.onSeek === 'function';

  // Header
  const pills = [TYPE_LABELS[session.type] || 'Climb'];
  if (session.grade) pills.push(session.grade);
  if (session.outcome) pills.push(OUTCOME_LABELS[session.outcome]);
  container.append(h('div', { class: 'card' },
    h('div', { class: 'report-head' },
      ring(r.overall),
      h('div', {},
        h('h2', { text: session.name || 'Untitled climb' }),
        h('div', { class: 'meta', text: fmtDate(session.createdAt) }),
        h('div', {}, pills.map((p) => h('span', { class: 'pill', text: p }))),
        h('div', { class: `status status-${scoreStatus(r.overall)}`, text: scoreLabel(r.overall) }),
      ),
    ),
    h('p', { class: 'summary', style: 'margin-top:12px', text: r.summary }),
    session.notes ? h('p', { class: 'muted small', text: `Notes: ${session.notes}` }) : null,
  ));

  if (opts.extra) container.append(opts.extra);

  if (a.warnings?.length) {
    container.append(h('div', { class: 'card warn' }, h('h3', { text: 'Heads up' }), a.warnings.map((w) => h('p', { text: w }))));
  }

  // Quick stats
  const metres = torsoToMetres(m.heightGain, heightCm);
  const tiles = h('div', { class: 'tiles' },
    tile('Climb time', fmtTime(m.climbTime), `${Math.round((1 - (m.pausedShare || 0)) * 100)}% moving`),
    tile('Height gained', `≈${metres.toFixed(1)} m`, heightCm ? 'based on your height' : 'set your height in Guide'),
    tile('Hand moves', String(m.handMoves), isNum(m.movesPerMin) ? `${m.movesPerMin.toFixed(1)} per min` : ''),
    tile('Foot moves', String(m.footMoves), isNum(m.footHandRatio) ? `${m.footHandRatio.toFixed(1)} per hand move` : ''),
  );
  container.append(tiles);

  // Category scores
  const bars = h('div');
  container.append(h('div', { class: 'card' }, h('h3', { text: 'Technique scores' }), bars));
  scoreBars(bars, Object.values(r.categories).map((c) => ({
    label: c.label, value: c.score, status: scoreStatus(c.score), statusLabel: scoreLabel(c.score), note: c.blurb,
  })));

  // Strengths & improvements
  if (r.strengths.length) {
    container.append(h('div', { class: 'card' },
      h('h3', { text: '✓ What you did well' }),
      h('ul', { class: 'feedback' }, r.strengths.map((s) => h('li', {},
        h('h4', {}, h('span', { text: s.label }), h('span', { class: 'status status-good', text: String(s.score) })),
        h('p', { text: s.text }),
      ))),
    ));
  }
  if (r.improvements.length) {
    container.append(h('div', { class: 'card' },
      h('h3', { text: '↗ What to work on' }),
      h('ul', { class: 'feedback' }, r.improvements.map((s) => h('li', {},
        h('h4', {}, h('span', { text: s.label }), h('span', { class: `status status-${scoreStatus(s.score)}`, text: String(s.score) })),
        h('p', { text: s.text }),
        h('div', { class: 'drill', text: s.drill }),
      ))),
    ));
  }
  if (!r.strengths.length && !r.improvements.length) {
    container.append(h('div', { class: 'card' }, h('p', { class: 'muted', text: 'No strong signals either way on this climb. Everything sits in the middle range. Check the details below.' })));
  }
  if (r.notes.length) {
    container.append(h('div', { class: 'card' }, h('h3', { text: 'Other observations' }), h('ul', {}, r.notes.map((n) => h('li', { text: n })))));
  }

  // Timeline chart
  const chartBox = h('div');
  const timelineCard = h('div', { class: 'card' },
    h('h3', { text: 'Height over time' }),
    h('p', { class: 'muted small', text: canSeek ? 'Tap the chart to jump to that moment in the video.' : 'How high your body was during the climb. Shaded areas are pauses.' }),
    chartBox,
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'k-line' }), 'Height'),
      h('span', {}, h('i', { class: 'k-band' }), 'Hesitation'),
      h('span', {}, h('i', { class: 'k-rest' }), 'Rest (4 s+)'),
      h('span', {}, h('i', { class: 'k-marker' }), 'Key moment'),
    ),
  );
  container.append(timelineCard);
  const s = a.series;
  const toM = (v) => torsoToMetres(v, heightCm);
  requestAnimationFrame(() => lineChart(chartBox, {
    xs: s.t,
    ys: s.height.map((v) => (isNum(v) ? toM(v) : null)),
    xFmt: (t) => fmtTime(t, false),
    yFmt: (v, tick) => (tick ? `${Math.round(v * 10) / 10}m` : `${v.toFixed(1)} m`),
    bands: a.pauses.map((p) => ({ x0: p.t0, x1: p.t1, cls: p.type === 'rest' ? 'rest' : '' })),
    markers: a.events.filter((e) => e.kind !== 'top').map((e) => ({ x: e.t })),
    tipTitle: (i) => fmtTime(s.t[i], true),
    tipRows: (i) => {
      const rows = [{ value: isNum(s.height[i]) ? `${toM(s.height[i]).toFixed(1)} m` : '—', label: 'height', key: 'k-line' }];
      if (isNum(s.speed[i])) rows.push({ value: `${toM(s.speed[i]).toFixed(2)} m/s`, label: 'body speed' });
      const ev = a.events.find((e) => Math.abs(e.t - s.t[i]) < 0.35);
      if (ev) rows.push({ value: '•', label: ev.label });
      return rows;
    },
    onPick: canSeek ? opts.onSeek : null,
    ariaLabel: 'Line chart of height climbed over time, with pauses shaded',
    height: 210,
  }));

  // Key moments
  if (a.events.length) {
    container.append(h('div', { class: 'card' },
      h('h3', { text: 'Key moments' }),
      canSeek ? null : h('p', { class: 'muted small', text: 'Attach the video above to jump to these moments.' }),
      h('ul', { class: 'moments' }, a.events.map((e) => eventItem(e, canSeek, opts.onSeek))),
    ));
  }

  // Full data table
  const rows = METRIC_DEFS.map((def) => {
    const it = r.items.find((i) => i.key === def.key);
    return h('tr', {},
      h('td', {}, h('span', { text: def.label }), h('span', { class: 'what', text: def.what })),
      h('td', { class: 'num', text: it.display }),
      h('td', { class: 'num', text: isNum(it.score) ? String(it.score) : (it.info ? 'info' : '—') }),
    );
  });
  const extra = [
    ['Time paused', isNum(m.pausedShare) ? `${Math.round(m.pausedShare * 100)}%` : '—'],
    ['Hesitations (1–4 s)', String(m.hesitations)],
    ['Rests (4 s+)', String(m.rests)],
    ['Dynamic moves', String(m.dynos)],
    ['Body tracked', `${Math.round(m.trackedRatio * 100)}% of frames`],
    ['Analysed', `${fmtTime(a.window.t0, true)} – ${fmtTime(a.window.t1, true)}`],
  ].map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { class: 'num', text: v }), h('td')));
  container.append(h('details', { class: 'card' },
    h('summary', { text: 'All measurements' }),
    h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Measure' }), h('th', { class: 'num', text: 'Value' }), h('th', { class: 'num', text: 'Score' }))),
      h('tbody', {}, rows, extra),
    ),
  ));
}

function eventItem(e, canSeek, onSeek) {
  const btn = h('button', { type: 'button' },
    h('span', { class: 'time', text: fmtTime(e.t, true) }),
    h('span', { text: e.label }),
  );
  if (canSeek) btn.addEventListener('click', () => onSeek(e.t));
  else btn.disabled = true;
  return h('li', {}, btn);
}

function tile(label, value, sub) {
  return h('div', { class: 'tile' },
    h('div', { class: 'label', text: label }),
    h('div', { class: 'value', text: value }),
    sub ? h('div', { class: 'delta', text: sub }) : null,
  );
}
export { tile };

export function gradeScaleOptions(select, selected) {
  select.replaceChildren(...Object.entries(GRADE_SCALES).map(([k, v]) => {
    const o = h('option', { value: k, text: v.label });
    if (k === selected) o.selected = true;
    return o;
  }));
}
