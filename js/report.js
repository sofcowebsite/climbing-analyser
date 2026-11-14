// Renders one session's analysis report.

import { lineChart, scoreBars } from './charts.js';
import { scoreLabel, scoreStatus, COACHES, coachForQuality } from './coach.js';
import { createReplay } from './replay.js';
import { buildFixes, PLAIN_TITLES } from './mistakes.js';
import { renderTimeline, labelsExport, STATE_CATS } from './timeline.js';
import { GRADE_SCALES } from './grades.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const TYPE_LABELS = { boulder: 'Boulder', 'top-rope': 'Top rope', lead: 'Lead', other: 'Climb' };
const OUTCOME_LABELS = { sent: 'Sent', fell: 'Fell', attempt: 'Working it' };
const VENUE_LABELS = { outdoor: 'Outdoor', indoor: 'Indoor' };
// Small counts read better as words in sentences.
const word = (n) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);

// A coach's round avatar (initial letter in the coach's colour).
export function coachAvatar(c, size = 40) {
  return h('span', { class: `avatar avatar-${c.id}`, style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px`, 'aria-hidden': 'true', text: c.name[0] });
}

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

const RATING = {
  clean: { label: 'Clean', status: 'good' },
  ok: { label: '1 thing to fix', status: 'warning' },
  rough: { label: 'Needs work', status: 'critical' },
};

function card(title, ...children) {
  return h('div', { class: 'card' }, title ? h('h3', { text: title }) : null, ...children);
}

const CONF_TEXT = { high: 'Sure', medium: 'Fairly sure', low: 'Not sure' };
function confBadge(c) {
  if (!c) return null;
  return h('span', { class: `conf conf-${c}`, title: 'How sure the analysis is', text: CONF_TEXT[c] });
}

const OUTCOME_CHOICES = [['sent', 'Sent / topped'], ['fell', 'Fell'], ['attempt', 'Still working it']];
const RESULT_TO_OUTCOME = { topped: 'sent', finished: 'sent', fell: 'fell', unknown: 'attempt' };

function labelled(label, text, cls = '') {
  if (!text) return null;
  return h('p', { class: `labelled ${cls}` }, h('strong', { text: `${label} ` }), text);
}

/**
 * The report reads top to bottom, most useful first:
 *   summary      who/what/score, the coach's short take, how it ended (correctable)
 *   1 Fix these first   each fall and each habit to change, with a big replay of the moment
 *   2 What you did well a short list
 *   (Vs your earlier attempt, when one was picked)
 *   Everything else     one folded section with every chart, table and measurement
 * opts: { heightCm, onSeek(t, rate) | null, onSetOutcome(val), onOpen(id), extra: Node (after
 *         the summary), footer: Node, history: [sessions], track, aspect,
 *         level: 'simple' | 'standard' | 'expert' (defaults to the session's coach) }
 */
export function renderReport(container, session, opts = {}) {
  container.replaceChildren();
  container.classList.add('report');
  const a = session.analysis;
  const r = session.report;
  const m = a.metrics;
  const heightCm = opts.heightCm;
  const canSeek = typeof opts.onSeek === 'function';
  const coachInfo = COACHES[r.coach] || coachForQuality(session.settings?.quality);
  const level = opts.level || coachInfo.level;
  const simple = level === 'simple';
  const seekBtn = (t, label) => {
    const b = h('button', { type: 'button', class: 'linkish', text: label || fmtTime(t, true) });
    if (canSeek) b.addEventListener('click', () => opts.onSeek(t)); else b.disabled = true;
    return b;
  };

  // ================= summary =================
  const pills = [TYPE_LABELS[session.type] || 'Climb'];
  if (VENUE_LABELS[session.venue]) pills.push(VENUE_LABELS[session.venue]);
  if (session.grade) pills.push(session.grade);
  if (session.outcome) pills.push(OUTCOME_LABELS[session.outcome]);
  const oc = r.outcome || a.outcome;
  container.append(h('div', { class: 'card summary-card' },
    h('div', { class: 'report-head' },
      ring(r.overall),
      h('div', {},
        h('h2', { text: session.name || 'Untitled climb' }),
        h('div', { class: 'meta', text: fmtDate(session.createdAt) }),
        h('div', {}, pills.map((p) => h('span', { class: 'pill', text: p }))),
        h('div', { class: `status status-${scoreStatus(r.overall)}`, text: `Technique: ${scoreLabel(r.overall).toLowerCase()}` }),
      ),
    ),
    r.take?.lines?.length
      ? h('div', { class: 'take' },
        h('div', { class: 'take-head' }, coachAvatar(coachInfo, 32), h('strong', { text: `${coachInfo.name}'s take` })),
        h('ul', { class: 'take-lines' }, r.take.lines.slice(0, simple ? 3 : 4).map((x) => h('li', { text: x }))))
      : h('p', { class: 'summary', text: r.summary }),
    oc ? outcomeBlock(session, oc, opts) : null,
    session.notes ? h('p', { class: 'muted small', text: `Your notes: ${session.notes}` }) : null,
  ));
  const heads = [...(a.warnings || [])];
  if (r.reliability && r.reliability.level !== 'high') heads.push(r.reliability.text);
  if (heads.length) container.append(h('div', { class: 'card warn' }, h('h3', { text: 'Heads up' }), heads.map((w) => h('p', { text: w }))));
  if (opts.extra) container.append(opts.extra);

  const chapter = (n, title, intro, ...kids) => h('section', { class: 'chapter', 'aria-label': title },
    h('div', { class: 'chapter-head' },
      h('h2', {}, h('span', { class: 'chapter-num', 'aria-hidden': 'true', text: String(n) }), title),
      intro ? h('p', { class: 'muted', text: intro }) : null),
    ...kids);
  let nChapter = 0;

  // ================= 1. fix these first =================
  const fixes = buildFixes(a, r, { habits: simple ? 1 : 3, falls: simple ? 1 : 3 });
  const nFalls = fixes.filter((f) => f.kind === 'fall').length;
  const nHabits = fixes.length - nFalls;
  const intro = !fixes.length ? null
    : [nFalls ? (nFalls === 1 ? 'Why you came off' : `Why you came off, all ${word(nFalls)} times`) : null,
      nHabits ? (nHabits === 1 ? `${nFalls ? 'then ' : ''}the one habit that would help you most` : `${nFalls ? 'then ' : ''}the ${word(nHabits)} habits that would help you most, in order`) : null]
      .filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) + '. Each one replays the moment it happened.';
  container.append(chapter(++nChapter, fixes.length === 1 ? 'Your one thing to fix' : 'Fix these first', intro,
    fixes.length ? fixes.map((f, i) => fixCard(f, i + 1, { simple, opts, canSeek }))
      : h('div', { class: 'card' }, h('p', { text: 'Nothing stood out as a clear problem on this climb. Nice work! Keep climbing like this, or try something a little harder.' }))));

  // ================= 2. what you did well =================
  const strengths = (r.strengths || []).slice(0, simple ? 2 : 3);
  if (strengths.length) {
    container.append(chapter(++nChapter, 'What you did well', null, h('div', { class: 'card' },
      h('ul', { class: 'well-list' }, strengths.map((s) => h('li', {},
        h('span', { class: 'well-tick', 'aria-hidden': 'true', text: '✓' }),
        h('div', {},
          h('strong', { text: s.label }), s.tag === 'fixed' ? h('span', { class: 'pill pill-good', text: 'Fixed since last time' }) : null,
          h('p', { class: 'small', text: firstSentences(s.text, s.tag === 'fixed' ? 2 : 1) })),
      ))))));
  }

  // ================= this attempt vs an earlier attempt =================
  const cmp = r.comparison;
  if (cmp) {
    const prevS = (opts.history || []).find((x) => x.id === cmp.prev.id);
    const shot = (src, label, sub) => h('figure', { class: 'attempt' },
      src ? h('img', { src, alt: label }) : h('div', { class: 'attempt-blank', text: 'No picture' }),
      h('figcaption', {}, h('strong', { text: label }), h('span', { class: 'muted small', text: sub })));
    const arrow = (b) => (b === true ? h('span', { class: 'chg chg-up', text: '▲ better' }) : b === false ? h('span', { class: 'chg chg-down', text: '▼ worse' }) : h('span', { class: 'muted', text: '–' }));
    const listOf = (title, items, cls) => (items.length ? [h('h4', { text: title }), h('ul', { class: `ticks ${cls}` }, items.map((x) => h('li', { text: x.text })))] : []);
    container.append(chapter(++nChapter, 'Vs your earlier attempt',
      { better: 'This attempt went better. Here\'s what changed.', worse: 'This one didn\'t go as well. Here\'s what changed, and how to get it back.', mixed: 'Some things got better and some slipped.', same: 'The two attempts were very similar.' }[cmp.verdict] || '',
      card(null,
        h('div', { class: 'attempts' },
          shot(prevS?.thumb, 'Earlier attempt', cmp.prev.createdAt ? fmtDate(cmp.prev.createdAt) : ''),
          shot(session.thumb, 'This attempt', fmtDate(session.createdAt))),
        h('p', { class: 'cmp-headline', text: cmp.headline }),
        ...listOf('Better this time', cmp.better, 'good'),
        ...listOf('Worse this time', cmp.worse, 'bad'),
        ...listOf('The same on both attempts', cmp.still, 'bad'),
        h('h4', { text: 'On your next attempt' }),
        h('ol', { class: 'next-steps' }, cmp.advice.map((x) => h('li', { text: x }))),
        h('details', { class: 'also' }, h('summary', { text: 'Side-by-side numbers' }),
          h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
            h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { class: 'num', text: 'Earlier' }), h('th', { class: 'num', text: 'This time' }), h('th', { class: 'num', text: '' }))),
            h('tbody', {}, cmp.facts.map((f) => h('tr', {},
              h('td', { text: f.label }), h('td', { class: 'num', text: f.before }), h('td', { class: 'num', text: f.now }), h('td', { class: 'num' }, arrow(f.better))))))),
          cmp.caveats.length ? h('p', { class: 'muted small', text: cmp.caveats.join(' ') }) : null),
        prevS && opts.onOpen ? h('button', { type: 'button', class: 'btn btn-small', text: 'Open the earlier attempt', onclick: () => opts.onOpen(prevS.id) }) : null,
      )));
  }

  // ================= everything else (folded) =================
  // Everything that's interesting but not needed to know what to work on. Nothing was removed
  // from the report: it all lives here. The deep-dive coach opens it by default.
  const more = h('details', { class: 'card everything' },
    h('summary', {}, h('span', { class: 'everything-title', text: 'Everything else' }),
      h('span', { class: 'muted small', text: 'Scores, charts, every move, left vs right, the movement timeline and all the numbers.' })));
  if (level === 'expert') more.open = true;
  const sub = (title, ...kids) => h('div', { class: 'sub' }, title ? h('h3', { text: title }) : null, ...kids);
  const later = [];
  const draw = (fn) => later.push(fn);
  const parts = [];

  // ----- scores -----
  const bars = h('div');
  parts.push(sub('Your technique scores', h('p', { class: 'muted small', text: 'Out of 100 for each area.' }), bars));
  scoreBars(bars, Object.values(r.categories).map((c) => ({ label: c.label, value: c.score, status: scoreStatus(c.score), statusLabel: scoreLabel(c.score), note: c.blurb })));

  // ----- quick numbers + height chart -----
  const metresUp = torsoToMetres(m.heightGain, heightCm);
  const chartBox = h('div');
  parts.push(sub('Moment by moment',
    h('div', { class: 'tiles' },
      tile('Climb time', fmtTime(m.climbTime), `${Math.round((1 - (m.pausedShare || 0)) * 100)}% moving`),
      tile('Height gained', `≈${metresUp.toFixed(1)} m`, heightCm ? 'based on your height' : 'set your height in Guide'),
      tile('Hand moves', String(m.handMoves), isNum(m.movesPerMin) ? `${m.movesPerMin.toFixed(1)} per min` : ''),
      tile('Foot moves', String(m.footMoves), isNum(m.footHandRatio) ? `${m.footHandRatio.toFixed(1)} per hand move` : ''),
    ),
    h('p', { class: 'muted small', style: 'margin-top:10px', text: canSeek ? 'How high you were through the climb. Tap the chart or a moment to jump to it in the video.' : 'How high you were through the climb. Shaded areas are pauses.' }),
    chartBox,
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'k-line' }), 'Height'),
      h('span', {}, h('i', { class: 'k-band' }), 'Hesitation'),
      h('span', {}, h('i', { class: 'k-rest' }), 'Rest (4 s+)'),
      h('span', {}, h('i', { class: 'k-marker' }), 'Key moment'),
    ),
    a.events.length ? h('ul', { class: 'moments' }, a.events.map((e) => eventItem(e, canSeek, opts.onSeek))) : null,
  ));
  const s = a.series;
  const toM = (v) => torsoToMetres(v, heightCm);
  draw(() => lineChart(chartBox, {
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
      const mv = (a.moves || []).find((x) => s.t[i] >= x.t0 - 0.2 && s.t[i] <= x.t1 + 0.2);
      if (mv) rows.push({ value: `#${mv.n}`, label: `${mv.side} hand move` });
      const ev = a.events.find((e) => Math.abs(e.t - s.t[i]) < 0.35);
      if (ev) rows.push({ value: '•', label: ev.label });
      return rows;
    },
    onPick: canSeek ? opts.onSeek : null,
    ariaLabel: 'Line chart of height climbed over time, with pauses shaded',
    height: 210,
  }));

  // ----- the rest of the plan (anything not shown as a fix card above) -----
  const shownKeys = new Set(fixes.map((f) => f.key));
  const otherPlan = (r.actionPlan || []).filter((p) => !String(p.key || '').startsWith('fall:') && !shownKeys.has(p.key) && !fixes.some((f) => f.title === p.title));
  if (otherPlan.length) {
    parts.push(sub('More to work on later', otherPlan.map((p) => h('div', { class: 'insight' },
      h('h4', { text: PLAIN_TITLES[p.key] || p.title }), h('p', { class: 'small', text: p.saw }), labelled('Next time:', p.doThis, 'cue')))));
  }

  // ----- move by move -----
  if (r.moveReview?.length) {
    const listEl = h('ul', { class: 'moves' });
    const renderMoves = (all) => {
      listEl.replaceChildren(...r.moveReview.slice(0, all ? undefined : 6).map((mv) => {
        const rt = { ...RATING[mv.rating] };
        if (mv.issues > 1) rt.label = `${mv.issues} things to fix`;
        return h('li', { class: `move move-${mv.rating}` },
          h('div', { class: 'move-head' },
            h('strong', { text: `#${mv.n} · ${mv.side === 'left' ? 'Left' : 'Right'} hand` }),
            seekBtn(Math.max(0, mv.t0 - 1)),
            h('span', { class: `status status-${rt.status}`, text: rt.label }),
          ),
          mv.good.length ? h('ul', { class: 'ticks good' }, mv.good.map((g) => h('li', { text: g.text ?? g }))) : null,
          mv.bad.length ? h('ul', { class: 'ticks bad' }, mv.bad.map((g) => h('li', { text: g.text ?? g }))) : null,
          !mv.good.length && !mv.bad.length ? h('p', { class: 'muted small', text: 'Same as the patterns above.' }) : null,
          mv.info.length ? h('p', { class: 'muted small', text: mv.info.join(' · ') }) : null,
        );
      }));
    };
    renderMoves(false);
    const showAll = r.moveReview.length > 6
      ? h('button', { type: 'button', class: 'btn btn-block btn-small', text: `Show all ${r.moveReview.length} moves`, onclick: (e) => { renderMoves(true); e.target.remove(); } })
      : null;
    const pats = r.movePatterns || [];
    parts.push(sub('Move by move',
      h('p', { class: 'small', text: r.moveSummary }),
      pats.length ? h('div', { class: 'patterns' },
        h('p', { class: 'small' }, h('strong', { text: 'On most of your moves:' })),
        pats.filter((x) => x.kind === 'bad').length ? h('ul', { class: 'ticks bad' }, pats.filter((x) => x.kind === 'bad').map((x) => h('li', { text: `${x.text} (${x.count} of ${r.moveReview.length})` }))) : null,
        pats.filter((x) => x.kind === 'good').length ? h('ul', { class: 'ticks good' }, pats.filter((x) => x.kind === 'good').map((x) => h('li', { text: `${x.text} (${x.count} of ${r.moveReview.length})` }))) : null,
        h('p', { class: 'muted small', text: 'Below, each move only lists what was different.' }),
      ) : null,
      canSeek ? h('p', { class: 'muted small', text: 'Tap a time to watch that move (starts 1 s before).' }) : null,
      listEl, showAll,
    ));
  }

  // ----- start / middle / top -----
  if (a.sections?.length === 3) {
    const row = (label, f) => h('tr', {}, h('td', { text: label }), a.sections.map((x) => h('td', { class: 'num', text: f(x) })));
    const pctOr = (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '—');
    parts.push(sub('Start, middle and top',
      h('p', { class: 'muted small', text: 'The climb split into three equal parts, to show where your technique held up and where it slipped.' }),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', { text: '' }), a.sections.map((x) => h('th', { class: 'num', text: x.name })))),
        h('tbody', {},
          row('Hand moves', (x) => String(x.moves)),
          row('Seconds per move', (x) => (isNum(x.setup) ? x.setup.toFixed(1) : '—')),
          row('Straight arms', (x) => pctOr(x.straightArm)),
          row('Feet first', (x) => pctOr(x.feetFirst)),
          row('Jolts', (x) => String(x.jolts)),
          row('Hesitations', (x) => String(x.hesitations)),
        ),
      )),
      r.sectionInsights.map((x) => h('div', { class: 'insight' }, h('h4', { text: x.title }), h('p', { text: x.text }), x.advice ? labelled('Next time:', x.advice, 'cue') : null)),
    ));
  }

  // ----- left vs right -----
  if (a.sides) {
    const sd = a.sides;
    const armTxt = (x) => (x ? `${Math.round(x.bent * 100)}%` : '—');
    parts.push(sub('Left vs right',
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { class: 'num', text: 'Left' }), h('th', { class: 'num', text: 'Right' }))),
        h('tbody', {},
          h('tr', {}, h('td', { text: 'Hand moves' }), h('td', { class: 'num', text: String(sd.handMoves.left) }), h('td', { class: 'num', text: String(sd.handMoves.right) })),
          h('tr', {}, h('td', { text: 'Foot moves' }), h('td', { class: 'num', text: String(sd.footMoves.left) }), h('td', { class: 'num', text: String(sd.footMoves.right) })),
          h('tr', {}, h('td', { text: 'High steps' }), h('td', { class: 'num', text: String(sd.highSteps.left) }), h('td', { class: 'num', text: String(sd.highSteps.right) })),
          h('tr', {}, h('td', { text: 'Arm bent when still' }), h('td', { class: 'num', text: armTxt(sd.arms.left) }), h('td', { class: 'num', text: armTxt(sd.arms.right) })),
        ),
      )),
      r.sideInsights.map((x) => h('div', { class: 'insight' }, h('h4', { text: x.title }), h('p', { text: x.text }), x.advice ? labelled('Next time:', x.advice, 'cue') : null)),
    ));
  }

  // ----- other observations -----
  const obs = [...(r.extraInsights || []).map((x) => h('div', { class: 'insight' }, h('h4', { text: x.title }), h('p', { text: x.text }), x.advice ? labelled('Tip:', x.advice, 'cue') : null)),
    ...r.notes.map((n) => h('div', { class: 'insight' }, h('p', { text: n })))];
  if (obs.length) parts.push(sub('Other things we noticed', obs));

  // ----- detailed breakdown per area -----
  for (const [key, cat] of Object.entries(r.categories)) {
    const its = r.items.filter((i) => i.category === key && isNum(i.value));
    if (!its.length) continue;
    parts.push(h('div', { class: 'sub' },
      h('div', { class: 'bar-head' }, h('h3', { text: cat.label }), h('span', { class: `status status-${scoreStatus(cat.score)}`, text: isNum(cat.score) ? `${cat.score} · ${scoreLabel(cat.score)}` : '' })),
      h('p', { class: 'muted small', text: cat.blurb }),
      its.map((it) => h('details', { class: 'metric' },
        h('summary', {},
          h('span', { class: 'metric-name', text: it.label }),
          h('span', { class: 'metric-val', text: it.display }),
          h('span', { class: `status status-${it.info ? 'none' : scoreStatus(it.score)}`, text: it.info ? 'info' : String(it.score) }),
        ),
        h('p', { class: 'muted small', text: it.what }),
        it.text ? h('p', {}, it.confidence === 'low' ? h('em', { text: 'Possibly: ' }) : null, it.text) : null,
        labelled('Over your climbs:', it.history),
        labelled('Why it matters:', it.why),
        !it.info && isNum(it.score) && it.score < 65 ? labelled('Next time:', it.cue, 'cue') : null,
        it.confidence ? h('p', { class: 'muted small' }, 'Confidence: ', confBadge(it.confidence)) : null,
      )),
    ));
  }

  // ----- how you moved (movement states), repertoire, timeline -----
  const mv = r.movement;
  if (mv && a.labels) {
    const total = STATE_CATS.reduce((acc, [k]) => acc + (mv.share[k] || 0), 0) || 1;
    const bar = h('div', { class: 'stack', role: 'img', 'aria-label': `Time split: ${STATE_CATS.map(([k, l]) => `${l} ${Math.round((mv.share[k] || 0) * 100)}%`).join(', ')}` },
      STATE_CATS.filter(([k]) => (mv.share[k] || 0) > 0).map(([k, , cls]) => h('span', { class: `stack-seg ${cls}`, style: `flex:${(mv.share[k] || 0) / total}` })));
    parts.push(sub('How you moved',
      h('p', { class: 'muted small', text: 'Where your time went, using the movement states from climbing research (PLOS ONE, 2017).' }),
      bar,
      h('div', { class: 'legend' }, STATE_CATS.map(([k, label, cls]) => h('span', {}, h('i', { class: `lane-key ${cls}` }), `${label} ${Math.round((mv.share[k] || 0) * 100)}%`))),
      h('p', { class: 'small', style: 'margin-top:8px', text: `${mv.fluency.stops} stops · ${mv.fluency.handProbes} hand probes · ${mv.fluency.footProbes} foot probes · body rose with the hand on ${mv.fluency.controlledMoves} of ${mv.fluency.upMoves} upward moves` }),
      mv.insights.map((x) => h('div', { class: 'insight' }, h('h4', { text: x.title }), h('p', { text: x.text }), x.advice ? labelled('Next time:', x.advice, 'cue') : null)),
      h('p', { class: 'muted small', text: mv.caveat }),
    ));
    parts.push(sub('Techniques spotted',
      mv.seen.length
        ? h('div', { class: 'chips' }, mv.seen.map((x) => h('span', { class: 'chip', title: `Detection confidence: ${x.conf}` }, `${x.label} ×${x.n}`, h('small', { text: x.conf === 'low' ? ' (not sure)' : '' }))))
        : h('p', { class: 'muted', text: 'No specific techniques (flags, drop knees, matches, cross-throughs, high steps…) were clearly seen.' }),
      h('p', { class: 'small', style: 'margin-top:8px' }, h('strong', { text: `For ${mv.terrain === 'unknown' ? 'this climb' : `${mv.terrain} terrain`}:` })),
      h('ul', { class: 'fixes' }, mv.suggestions.map((x) => h('li', { text: x }))),
    ));
    const tl = h('div');
    const exportBtn = h('button', { type: 'button', class: 'btn btn-small', text: 'Export labels (JSON)', onclick: () => exportLabels(session) });
    parts.push(sub('Movement timeline',
      h('p', { class: 'muted small', text: 'Each half second is labelled with what your body and each hand and foot were doing. Anything a single camera can\'t show (grip type, hips-to-wall distance, whether a foot is weighted) is marked unknown, not guessed.' }),
      tl,
      h('div', { class: 'actions', style: 'margin-top:8px' }, exportBtn),
    ));
    draw(() => renderTimeline(tl, a.labels, { fmtTime: (t) => fmtTime(t, true), onSeek: canSeek ? (t) => opts.onSeek(t, 0.5) : null }));
  }

  // ----- compared with previous climbs -----
  const hist = (opts.history || []).filter((x) => x.id !== session.id && x.createdAt < session.createdAt && x.report);
  if (hist.length) {
    const avg = (f) => { const v = hist.map(f).filter(isNum); return v.length ? v.reduce((acc, x) => acc + x, 0) / v.length : null; };
    const rows = [['Overall', r.overall, avg((x) => x.report.overall)],
      ...Object.entries(r.categories).map(([k, c]) => [c.label, c.score, avg((x) => x.report.categories?.[k]?.score)])];
    const changes = (r.sinceLast || []).filter((x) => x.kind !== 'fixed');
    parts.push(sub(`Compared with your previous ${hist.length === 1 ? 'climb' : `${hist.length} climbs`}`,
      changes.length ? h('p', { text: `Since your last climb: ${changes.map((x) => x.text).join(' ')}` }) : null,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { class: 'num', text: 'This climb' }), h('th', { class: 'num', text: 'Your average' }), h('th', { class: 'num', text: 'Change' }))),
        h('tbody', {}, rows.map(([label, now, av]) => h('tr', {},
          h('td', { text: label }),
          h('td', { class: 'num', text: isNum(now) ? String(now) : '—' }),
          h('td', { class: 'num', text: isNum(av) ? String(Math.round(av)) : '—' }),
          h('td', { class: 'num', text: isNum(now) && isNum(av) ? `${now - av >= 0 ? '▲ +' : '▼ '}${Math.round(now - av)}` : '—' }),
        ))),
      )),
    ));
  }

  // ----- how sure are we? -----
  if (r.reliability) {
    parts.push(h('div', { class: 'sub' },
      h('div', { class: 'bar-head' }, h('h3', { text: 'How sure are we?' }), confBadge(r.reliability.level)),
      h('p', { text: r.reliability.text }),
      r.reliability.points.length ? h('ul', { class: 'evidence' }, r.reliability.points.map((x) => h('li', { text: x }))) : null,
      h('p', { class: 'muted small', text: 'Every finding has its own confidence label. "Not sure" findings are kept out of your plan unless there is nothing better.' }),
    ));
  }

  // ----- all measurements -----
  const mRows = r.items.map((it) => h('tr', {},
    h('td', {}, h('span', { text: it.label }), h('span', { class: 'what', text: it.what })),
    h('td', { class: 'num', text: it.display }),
    h('td', { class: 'num', text: isNum(it.score) ? String(it.score) : (it.info ? 'info' : '—') }),
  ));
  const extraRows = [
    ['Time paused', isNum(m.pausedShare) ? `${Math.round(m.pausedShare * 100)}%` : '—'],
    ['Hesitations (1–4 s)', String(m.hesitations)],
    ['Rests (4 s+)', String(m.rests)],
    ['Average time between moves', isNum(m.avgSetup) ? `${m.avgSetup.toFixed(1)} s` : '—'],
    ['High steps', String(m.highSteps ?? '—')],
    ['Feet cutting loose', String(m.feetCuts ?? '—')],
    ['Shake-outs / chalk', String(m.shakeOuts ?? '—')],
    ['Stance width', isNum(m.stanceWidth) ? `${m.stanceWidth.toFixed(1)} torso lengths` : '—'],
    ['Dynamic moves', String(m.dynos)],
    ['Body tracked', `${Math.round(m.trackedRatio * 100)}% of frames`],
    ['Climber size in video', isNum(m.torsoPx) ? `${Math.round(m.torsoPx)} px torso` : '—'],
    ['Analysed', `${fmtTime(a.window.t0, true)} – ${fmtTime(a.window.t1, true)}`],
  ].map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { class: 'num', text: v }), h('td')));
  parts.push(sub('All measurements', h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Measure' }), h('th', { class: 'num', text: 'Value' }), h('th', { class: 'num', text: 'Score' }))),
    h('tbody', {}, mRows, extraRows),
  ))));

  more.append(...parts);
  container.append(more);
  // Charts need a laid-out box: draw when the section is (or first gets) opened.
  const drawAll = () => requestAnimationFrame(() => { for (const fn of later.splice(0)) fn(); });
  if (more.open) drawAll();
  else more.addEventListener('toggle', function once() { if (more.open) { more.removeEventListener('toggle', once); drawAll(); } });

  if (opts.footer) container.append(opts.footer);
}

// How it ended, compact: the verdict, a one-tap correction, and the evidence folded away.
function outcomeBlock(session, oc, opts) {
  const detected = RESULT_TO_OUTCOME[oc.result];
  const userSet = session.outcomeSource === 'user' && session.outcome;
  const disagree = userSet && detected && userSet !== detected && oc.confidence !== 'low' && oc.result !== 'unknown';
  const choice = h('div', { class: 'choice-row' }, OUTCOME_CHOICES.map(([val, label]) => {
    const b = h('button', { type: 'button', class: `btn btn-small${session.outcome === val ? ' btn-primary' : ''}`, 'aria-pressed': String(session.outcome === val), text: label });
    if (opts.onSetOutcome) b.addEventListener('click', () => opts.onSetOutcome(val)); else b.disabled = true;
    return b;
  }));
  return h('div', { class: 'outcome' },
    h('div', { class: 'bar-head' }, h('h3', { text: `How it ended: ${oc.headline}` }), confBadge(oc.confidence)),
    disagree ? h('p', { class: 'warn-inline', text: `You marked this climb as "${OUTCOME_CHOICES.find((x) => x[0] === userSet)[1]}", but the video looks different. If you're right, keep your answer: your answer is what counts in your stats.` }) : null,
    h('p', { class: 'small', text: session.outcomeSource === 'user' ? 'Your answer:' : 'Is this right? Tap to correct it:' }),
    choice,
    oc.evidence?.length ? h('details', { class: 'also' }, h('summary', { text: 'Why we think so' }),
      h('ul', { class: 'evidence' }, oc.evidence.map((e) => h('li', { text: e }))),
      oc.alternatives?.length ? h('p', { class: 'muted small', text: oc.alternatives.join(' ') }) : null) : null,
  );
}

// One "fix" card: the title, the big replay, then what went wrong and what to do instead.
function fixCard(f, n, { simple, opts, canSeek }) {
  const replayBox = h('div', { class: 'replay-box' });
  const fall = f.kind === 'fall';
  const shownFixes = f.fixes.slice(0, simple ? 2 : 3);
  // Don't repeat a fix that's already listed above.
  const nextSteps = f.nextAttempt.filter((x) => !shownFixes.some((fx) => x.includes(fx.slice(0, 40)))).slice(0, simple ? 2 : 3);
  const block = (cls, title, ...kids) => (kids.flat().some(Boolean) ? h('div', { class: `fix-block ${cls}` }, h('h4', { text: title }), ...kids) : null);
  const el = h('article', { class: `card fix-card ${fall ? 'fix-fall' : 'fix-habit'}` },
    h('div', { class: 'fix-head' },
      h('span', { class: 'fix-num', 'aria-hidden': 'true', text: String(n) }),
      h('div', {}, h('h3', { text: f.title }), f.sub ? h('p', { class: 'muted small', text: f.sub }) : null),
      confBadge(f.confidence),
    ),
    f.pattern ? h('p', { class: 'warn-inline', text: f.pattern }) : null,
    replayBox,
    block('fix-saw', 'What went wrong', f.saw ? h('p', { text: f.saw }) : null, f.history ? h('p', { class: 'small muted', text: f.history }) : null),
    simple ? null : block('fix-why', 'Why it matters', f.why ? h('p', { class: 'small', text: f.why }) : null),
    block('fix-do', 'Do this instead',
      f.doThis ? h('p', { class: 'fix-cue', text: f.doThis }) : null,
      f.fixes.length ? h('ul', { class: 'fixes' }, shownFixes.map((x) => h('li', { text: x }))) : null),
    f.drill ? h('div', { class: 'drill' }, h('strong', { text: 'Practise it. ' }), f.drill.replace(/^Drill:\s*/, '')) : null,
    f.target ? h('p', { class: 'target' }, h('span', { text: '🎯 Goal for next time: ' }), f.target) : null,
    nextSteps.length ? h('div', { class: 'next-attempt' },
      h('h4', { text: 'On your next attempt' }),
      h('ol', {}, nextSteps.map((x) => h('li', { text: x }))),
    ) : null,
    f.secondary.length && !simple ? h('details', { class: 'also' },
      h('summary', { text: `Also played a part (${f.secondary.length})` }),
      f.secondary.map((c) => h('div', { class: 'cause' },
        h('div', { class: 'bar-head' }, h('h4', { text: c.title }), confBadge(c.confidence)),
        h('p', { class: 'small', text: c.evidence }),
        h('ul', { class: 'fixes' }, c.fixes.slice(0, 2).map((x) => h('li', { text: x }))),
      )),
    ) : null,
  );
  if (opts.track && f.examples.length) {
    requestAnimationFrame(() => createReplay(replayBox, opts.track, opts.aspect || 0.5625, {
      examples: f.examples,
      onWatchVideo: canSeek ? (t) => opts.onSeek(t, 0.5) : null,
    }));
  } else if (!f.examples.length && !fall) {
    replayBox.remove();
  }
  return el;
}

// The first sentence or two of a longer text.
function firstSentences(text, n = 1) {
  if (!text) return '';
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)/g);
  return parts ? parts.slice(0, n).join('').trim() : text;
}

async function exportLabels(session) {
  const json = JSON.stringify(labelsExport(session), null, 1);
  const name = `crux-labels-${(session.name || 'climb').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date(session.createdAt).toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Climbing movement labels' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: name });
  document.body.append(a); a.click(); a.remove();
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
