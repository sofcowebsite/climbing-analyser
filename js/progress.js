// The "Progress" overview across all saved sessions.

import { lineChart, scoreBars, sparkline } from './charts.js';
import { CATEGORIES, METRIC_DEFS, scoreLabel, scoreStatus } from './coach.js';
import { GRADE_SCALES, hardestSends } from './grades.js';
import { h, tile, fmtTime, fmtDate } from './report.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const avg = (a) => { const b = a.filter(isNum); return b.length ? b.reduce((s, v) => s + v, 0) / b.length : null; };

export function renderProgress(container, sessions, { onOpen } = {}) {
  container.replaceChildren();
  if (!sessions.length) {
    container.append(h('div', { class: 'card empty' },
      h('h3', { text: 'No climbs yet' }),
      h('p', { class: 'muted', text: 'Analyse a few climbs and your overall trends will appear here.' }),
    ));
    return;
  }
  const chrono = [...sessions].sort((a, b) => a.createdAt - b.createdAt);
  const n = chrono.length;
  const overall = chrono.map((s) => s.report.overall);
  const recent = overall.slice(-5), previous = overall.slice(-10, -5);
  const recentAvg = avg(recent), prevAvg = avg(previous);

  // Hero: recent average score.
  const delta = isNum(recentAvg) && isNum(prevAvg) ? Math.round(recentAvg - prevAvg) : null;
  container.append(h('div', { class: 'card' },
    h('div', { class: 'muted small', text: `Average score, last ${recent.length} climb${recent.length > 1 ? 's' : ''}` }),
    h('div', { class: 'hero-num', text: isNum(recentAvg) ? String(Math.round(recentAvg)) : '—' }),
    h('div', { class: `status status-${scoreStatus(recentAvg)}`, text: scoreLabel(recentAvg) }),
    delta !== null ? h('p', { class: 'small', style: 'margin-top:6px', text: `${delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : '■ '}${delta} vs the 5 climbs before` }) : null,
  ));

  // Tiles
  const totalTime = chrono.reduce((s, x) => s + (x.analysis.metrics.climbTime || 0), 0);
  const withOutcome = chrono.filter((s) => s.outcome === 'sent' || s.outcome === 'fell');
  const sendRate = withOutcome.length ? chrono.filter((s) => s.outcome === 'sent').length / withOutcome.length : null;
  const hard = hardestSends(chrono);
  const hardText = Object.entries(hard).map(([k, v]) => `${v.grade}`).join(' · ') || '—';
  const hardSub = Object.keys(hard).map((k) => GRADE_SCALES[k].label.split(' ')[0]).join(' · ');
  container.append(h('div', { class: 'tiles' },
    tile('Climbs analysed', String(n), `since ${fmtDate(chrono[0].createdAt)}`),
    tile('Time on the wall', fmtTime(totalTime), 'total, analysed'),
    tile('Send rate', isNum(sendRate) ? `${Math.round(sendRate * 100)}%` : '—', `${chrono.filter((s) => s.outcome === 'sent').length} sent`),
    tile('Hardest send', hardText, hardSub || 'add grades to track'),
  ));

  // Overall trend
  const trendBox = h('div');
  container.append(h('div', { class: 'card' },
    h('h3', { text: 'Overall score by climb' }),
    h('p', { class: 'muted small', text: 'Tap a point to see which climb it was.' }),
    trendBox,
  ));
  requestAnimationFrame(() => lineChart(trendBox, {
    xs: chrono.map((_, i) => i + 1),
    ys: overall,
    yMin: 0, yMax: 100,
    xFmt: (x, tick) => (tick ? `#${x}` : `Climb #${x}`),
    xTicks: n <= 8 ? chrono.map((_, i) => i + 1) : undefined,
    yFmt: (v) => String(Math.round(v)),
    dots: n <= 30,
    area: false,
    tipTitle: (i) => `${fmtDate(chrono[i].createdAt)} · ${chrono[i].grade || ''}`.replace(/ · $/, ''),
    tipRows: (i) => [
      { value: isNum(overall[i]) ? String(overall[i]) : '—', label: 'overall', key: 'k-line' },
      { value: chrono[i].name || 'Untitled climb', label: '' },
    ],
    onPick: (x) => onOpen?.(chrono[x - 1].id, true),
    ariaLabel: 'Line chart of overall technique score for each climb',
    height: 190,
  }));

  // Category trends
  const catTiles = h('div', { class: 'tiles' });
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const vals = chrono.map((s) => s.report.categories[key]?.score);
    const r5 = avg(vals.slice(-5)), p5 = avg(vals.slice(-10, -5));
    const d = isNum(r5) && isNum(p5) ? Math.round(r5 - p5) : null;
    const spark = h('div');
    catTiles.append(h('div', { class: 'tile' },
      h('div', { class: 'label', text: cat.label }),
      h('div', { class: 'value', text: isNum(r5) ? String(Math.round(r5)) : '—' }),
      h('div', { class: 'delta', text: d === null ? 'recent average' : `${d > 0 ? '▲ +' : d < 0 ? '▼ ' : '■ '}${d} vs before` }),
      spark,
    ));
    sparkline(spark, vals);
  }
  container.append(h('div', { class: 'card' },
    h('h3', { text: 'Technique areas' }),
    h('p', { class: 'muted small', text: 'Average of your last 5 climbs, with the trend across all climbs.' }),
    catTiles,
  ));

  // Strongest / weakest
  const catAvg = Object.entries(CATEGORIES).map(([k, c]) => ({ key: k, label: c.label, v: avg(chrono.slice(-10).map((s) => s.report.categories[k]?.score)) })).filter((c) => isNum(c.v));
  if (catAvg.length >= 2) {
    const sorted = [...catAvg].sort((a, b) => b.v - a.v);
    container.append(h('div', { class: 'card' },
      h('h3', { text: 'Your climbing profile' }),
      h('p', {}, h('strong', { text: 'Strongest: ' }), `${sorted[0].label} (${Math.round(sorted[0].v)})`),
      h('p', {}, h('strong', { text: 'Biggest opportunity: ' }), `${sorted[sorted.length - 1].label} (${Math.round(sorted[sorted.length - 1].v)})`),
    ));
  }

  // Recurring focus areas
  const last = chrono.slice(-10);
  const counts = {};
  for (const s of last) for (const imp of s.report.improvements) counts[imp.key] = (counts[imp.key] || 0) + 1;
  const recurring = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (recurring.length) {
    const bars = h('div');
    container.append(h('div', { class: 'card' },
      h('h3', { text: 'Recurring things to work on' }),
      h('p', { class: 'muted small', text: `How often each issue was flagged in your last ${last.length} climbs.` }),
      bars,
    ));
    scoreBars(bars, recurring.map(([key, c]) => {
      const def = METRIC_DEFS.find((d) => d.key === key);
      const share = Math.round((c / last.length) * 100);
      return { label: def?.label || key, value: share, valueText: `${share}%`, status: share >= 50 ? 'critical' : 'warning', statusLabel: `${c} of ${last.length}`, note: def?.drill };
    }));
  }

  // Latest vs average for each measure
  const latest = chrono[n - 1];
  const rows = METRIC_DEFS.filter((d) => !d.info).map((def) => {
    const all = chrono.map((s) => s.report.items.find((i) => i.key === def.key)?.score);
    const a = avg(all.slice(0, -1));
    const l = all[n - 1];
    return h('tr', {},
      h('td', { text: def.label }),
      h('td', { class: 'num', text: isNum(l) ? String(l) : '—' }),
      h('td', { class: 'num', text: isNum(a) ? String(Math.round(a)) : '—' }),
    );
  });
  if (n >= 2) {
    container.append(h('details', { class: 'card' },
      h('summary', { text: 'Latest climb vs your average' }),
      h('p', { class: 'muted small', text: `Scores out of 100. Latest: ${latest.name || 'Untitled climb'}.` }),
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Measure' }), h('th', { class: 'num', text: 'Latest' }), h('th', { class: 'num', text: 'Average' }))),
        h('tbody', {}, rows),
      ),
    ));
  }
}
