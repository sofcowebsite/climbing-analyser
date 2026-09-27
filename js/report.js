// Renders one session's analysis report.

import { lineChart, scoreBars } from './charts.js';
import { scoreLabel, scoreStatus, COACHES, coachForQuality } from './coach.js';
import { createFallReplay } from './fallview.js';
import { renderTimeline, labelsExport, STATE_CATS } from './timeline.js';
import { GRADE_SCALES } from './grades.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const TYPE_LABELS = { boulder: 'Boulder', 'top-rope': 'Top rope', lead: 'Lead', other: 'Climb' };
const OUTCOME_LABELS = { sent: 'Sent', fell: 'Fell', attempt: 'Working it' };
const VENUE_LABELS = { outdoor: 'Outdoor', indoor: 'Indoor' };

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
 * opts: { heightCm, onSeek(t) | null, extra: Node (inserted after header), history: [sessions],
 *         level: 'simple' | 'standard' | 'expert' (defaults to the session's coach) }
 */
export function renderReport(container, session, opts = {}) {
  container.replaceChildren();
  const a = session.analysis;
  const r = session.report;
  const m = a.metrics;
  const heightCm = opts.heightCm;
  const canSeek = typeof opts.onSeek === 'function';
  // How much to show depends on the coach. Tier 1 is always shown; tier 2 from the all-round
  // coach up; tier 3 in full by the deep-dive coach and under "More detail" by the all-round one.
  // The quick-look coach hides tiers 2-3 behind a "Show the full analysis" button.
  const coachInfo = COACHES[r.coach] || coachForQuality(session.settings?.quality);
  const level = opts.level || coachInfo.level;
  const simple = level === 'simple';
  const more = h('details', { class: 'card more-detail' },
    h('summary', { text: 'More detail' }),
    h('p', { class: 'muted small', text: 'The technical extras: how your time was split, the techniques spotted, the half-second movement timeline and every measurement.' }));
  let hidden = 0;
  const shown = (tier) => tier <= 1 || level === 'expert' || (tier === 2 && level === 'standard');
  const put = (tier, ...els) => {
    els = els.filter(Boolean);
    if (shown(tier)) container.append(...els);
    else if (level === 'standard') more.append(...els);
    else hidden++;
  };
  // Charts need a laid-out box: draw now if visible, when "More detail" first opens, or never.
  const draw = (tier, fn) => {
    if (shown(tier)) requestAnimationFrame(fn);
    else if (level === 'standard') {
      const once = () => { if (more.open) { more.removeEventListener('toggle', once); requestAnimationFrame(fn); } };
      more.addEventListener('toggle', once);
    }
  };
  const seekBtn = (t, label) => {
    const b = h('button', { type: 'button', class: 'linkish', text: label || fmtTime(t, true) });
    if (canSeek) b.addEventListener('click', () => opts.onSeek(t)); else b.disabled = true;
    return b;
  };

  // ----- header -----
  const pills = [TYPE_LABELS[session.type] || 'Climb'];
  if (VENUE_LABELS[session.venue]) pills.push(VENUE_LABELS[session.venue]);
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
    // The coach's take below replaces the one-line summary on newer reports.
    r.take?.lines?.length ? null : h('p', { class: 'summary', style: 'margin-top:12px', text: r.summary }),
    session.notes ? h('p', { class: 'muted small', text: `Notes: ${session.notes}` }) : null,
  ));
  // ----- the coach's take: the short, plain version -----
  if (r.take?.lines?.length) {
    container.append(h('div', { class: 'card take' },
      h('div', { class: 'take-head' }, coachAvatar(coachInfo), h('div', {}, h('h3', { text: `${coachInfo.name}'s take` }), h('div', { class: 'muted small', text: coachInfo.role }))),
      h('ul', { class: 'take-lines' }, r.take.lines.map((x) => h('li', { text: x }))),
    ));
  }
  if (opts.extra) container.append(opts.extra);
  if (a.warnings?.length) {
    container.append(h('div', { class: 'card warn' }, h('h3', { text: 'Heads up' }), a.warnings.map((w) => h('p', { text: w }))));
  }

  // ----- how did it end? -----
  const oc = r.outcome || a.outcome;
  if (oc) {
    const detected = RESULT_TO_OUTCOME[oc.result];
    const userSet = session.outcomeSource === 'user' && session.outcome;
    const disagree = userSet && detected && userSet !== detected && oc.confidence !== 'low' && oc.result !== 'unknown';
    const choice = h('div', { class: 'choice-row' }, OUTCOME_CHOICES.map(([val, label]) => {
      const b = h('button', { type: 'button', class: `btn btn-small${session.outcome === val ? ' btn-primary' : ''}`, text: label });
      if (opts.onSetOutcome) b.addEventListener('click', () => opts.onSetOutcome(val)); else b.disabled = true;
      return b;
    }));
    container.append(h('div', { class: 'card' },
      h('div', { class: 'bar-head' }, h('h3', { text: `How it ended: ${oc.headline}` }), confBadge(oc.confidence)),
      h('ul', { class: 'evidence' }, oc.evidence.map((e) => h('li', { text: e }))),
      oc.alternatives.length ? h('p', { class: 'muted small', text: oc.alternatives.join(' ') }) : null,
      disagree ? h('p', { class: 'warn-inline', text: `You marked this climb as "${OUTCOME_CHOICES.find((x) => x[0] === userSet)[1]}", but the video looks different. Check the replay below. If you're right, keep your answer; your answer is what counts in your stats.` }) : null,
      h('p', { class: 'small', style: 'margin-top:8px', text: session.outcomeSource === 'user' ? 'Your answer:' : 'Is this right? Tap to correct it:' }),
      choice,
    ));
  }

  // ----- falls -----
  for (const f of r.fallAnalyses || []) {
    const replayBox = h('div');
    const p = f.primary;
    container.append(h('div', { class: 'card fall-card' },
      h('h3', { text: f.headline }),
      h('p', { class: 'muted small', text: f.detail }),
      f.pattern ? h('p', { class: 'warn-inline', text: f.pattern }) : null,
      replayBox,
      p ? h('div', { class: 'cause' },
        h('div', { class: 'bar-head' }, h('h4', { text: p.key === 'unclear' ? p.title : `Most likely: ${p.title}` }), confBadge(p.confidence)),
        labelled('What we saw:', p.evidence),
        labelled('Why that makes you fall:', p.why),
        h('p', { class: 'labelled' }, h('strong', { text: 'How to fix it:' })),
        h('ul', { class: 'fixes' }, p.fixes.slice(0, simple ? 2 : undefined).map((x) => h('li', { text: x }))),
        h('div', { class: 'drill', text: p.drill }),
      ) : null,
      f.secondary.length && !simple ? h('details', { class: 'also' },
        h('summary', { text: `Also contributing (${f.secondary.length})` }),
        f.secondary.map((c) => h('div', { class: 'cause' },
          h('div', { class: 'bar-head' }, h('h4', { text: c.title }), confBadge(c.confidence)),
          h('p', { class: 'small', text: c.evidence }),
          h('ul', { class: 'fixes' }, c.fixes.slice(0, 2).map((x) => h('li', { text: x }))),
        )),
      ) : null,
      f.nextAttempt.length ? h('div', { class: 'next-attempt' },
        h('h4', { text: 'On your next attempt' }),
        h('ol', {}, f.nextAttempt.map((x) => h('li', { text: x }))),
      ) : null,
    ));
    if (opts.track && f.replay) {
      requestAnimationFrame(() => createFallReplay(replayBox, opts.track, opts.aspect || 0.5625, {
        t0: f.replay.t0, t1: f.replay.t1, tFall: f.t, highlight: p?.limb,
        onWatchVideo: canSeek ? (t) => opts.onSeek(t, 0.5) : null,
      }));
    }
  }

  // ----- action plan -----
  if (r.actionPlan?.length) {
    container.append(card(simple ? 'Your one thing to work on' : 'Your plan for next session',
      h('p', { class: 'muted small', text: simple ? 'The change that would help you most.' : `The ${r.actionPlan.length === 1 ? 'change' : `${r.actionPlan.length} changes`} that would help you most, in priority order.` }),
      h('ol', { class: 'plan' }, r.actionPlan.slice(0, simple ? 1 : undefined).map((p) => h('li', {},
        h('div', { class: 'bar-head' }, h('h4', { text: p.title }), confBadge(p.confidence)),
        labelled('What we saw:', p.saw),
        labelled('Over your climbs:', p.history),
        labelled('Why it matters:', p.why),
        labelled('Next time:', p.doThis, 'cue'),
        p.drill ? h('div', { class: 'drill', text: p.drill }) : null,
        p.target ? h('p', { class: 'target' }, h('span', { text: '🎯 Target: ' }), p.target) : null,
        p.moves?.length && canSeek ? h('div', { class: 'jump-row' }, h('span', { class: 'muted small', text: 'Watch: ' }), p.moves.slice(0, 6).map((n) => {
          const mv = a.moves.find((x) => x.n === n);
          return mv ? seekBtn(mv.t0 - 1, `move #${n}`) : null;
        })) : null,
      ))),
    ));
  } else if (r.strengths?.length || r.improvements?.length) {
    container.append(card('Your plan for next session', h('p', { class: 'muted', text: 'Nothing stood out as a clear weakness on this climb. Check the detailed breakdown below.' })));
  }

  // ----- quick stats -----
  const metres = torsoToMetres(m.heightGain, heightCm);
  container.append(h('div', { class: 'tiles' },
    tile('Climb time', fmtTime(m.climbTime), `${Math.round((1 - (m.pausedShare || 0)) * 100)}% moving`),
    tile('Height gained', `≈${metres.toFixed(1)} m`, heightCm ? 'based on your height' : 'set your height in Guide'),
    tile('Hand moves', String(m.handMoves), isNum(m.movesPerMin) ? `${m.movesPerMin.toFixed(1)} per min` : ''),
    tile('Foot moves', String(m.footMoves), isNum(m.footHandRatio) ? `${m.footHandRatio.toFixed(1)} per hand move` : ''),
  ));

  // ----- scores -----
  const bars = h('div');
  put(2, card('Technique scores', bars));
  scoreBars(bars, Object.values(r.categories).map((c) => ({ label: c.label, value: c.score, status: scoreStatus(c.score), statusLabel: scoreLabel(c.score), note: c.blurb })));

  // ----- what went well -----
  if (r.strengths?.length) {
    container.append(card('✓ What you did well',
      h('ul', { class: 'feedback' }, r.strengths.slice(0, simple ? 2 : undefined).map((s) => h('li', {},
        h('h4', {}, h('span', {}, s.label, s.tag === 'fixed' ? h('span', { class: 'pill', style: 'margin-left:6px', text: 'Fixed' }) : null), h('span', { class: 'status status-good', text: String(s.score) })),
        h('p', { text: s.text }),
      ))),
    ));
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
    const more = r.moveReview.length > 6
      ? h('button', { type: 'button', class: 'btn btn-block btn-small', text: `Show all ${r.moveReview.length} moves`, onclick: (e) => { renderMoves(true); e.target.remove(); } })
      : null;
    const pats = r.movePatterns || [];
    put(2, card('Move by move',
      h('p', { class: 'small', text: r.moveSummary }),
      pats.length ? h('div', { class: 'patterns' },
        h('p', { class: 'small' }, h('strong', { text: 'On most of your moves:' })),
        pats.filter((x) => x.kind === 'bad').length ? h('ul', { class: 'ticks bad' }, pats.filter((x) => x.kind === 'bad').map((x) => h('li', { text: `${x.text} (${x.count} of ${r.moveReview.length})` }))) : null,
        pats.filter((x) => x.kind === 'good').length ? h('ul', { class: 'ticks good' }, pats.filter((x) => x.kind === 'good').map((x) => h('li', { text: `${x.text} (${x.count} of ${r.moveReview.length})` }))) : null,
        h('p', { class: 'muted small', text: 'Below, each move only lists what was different.' }),
      ) : null,
      canSeek ? h('p', { class: 'muted small', text: 'Tap a time to watch that move (starts 1 s before).' }) : h('p', { class: 'muted small', text: 'Attach the video above to watch each move.' }),
      listEl, more,
    ));
  }

  // ----- how you moved (movement states), repertoire, timeline -----
  const mv = r.movement;
  if (mv && a.labels) {
    const total = STATE_CATS.reduce((acc, [k]) => acc + (mv.share[k] || 0), 0) || 1;
    const bar = h('div', { class: 'stack', role: 'img', 'aria-label': `Time split: ${STATE_CATS.map(([k, l]) => `${l} ${Math.round((mv.share[k] || 0) * 100)}%`).join(', ')}` },
      STATE_CATS.filter(([k]) => (mv.share[k] || 0) > 0).map(([k, , cls]) => h('span', { class: `stack-seg ${cls}`, style: `flex:${(mv.share[k] || 0) / total}` })));
    put(3, card('How you moved',
      h('p', { class: 'muted small', text: 'Where your time went, using the movement states from climbing research (PLOS ONE, 2017).' }),
      bar,
      h('div', { class: 'legend' }, STATE_CATS.map(([k, label, cls]) => h('span', {}, h('i', { class: `lane-key ${cls}` }), `${label} ${Math.round((mv.share[k] || 0) * 100)}%`))),
      h('p', { class: 'small', style: 'margin-top:8px', text: `${mv.fluency.stops} stops · ${mv.fluency.handProbes} hand probes · ${mv.fluency.footProbes} foot probes · body rose with the hand on ${mv.fluency.controlledMoves} of ${mv.fluency.upMoves} upward moves` }),
      mv.insights.map((x) => h('div', { class: 'insight' }, h('h4', { text: x.title }), h('p', { text: x.text }), x.advice ? labelled('Next time:', x.advice, 'cue') : null)),
      h('p', { class: 'muted small', text: mv.caveat }),
    ));
    put(3, card('Technique repertoire',
      mv.seen.length
        ? h('div', { class: 'chips' }, mv.seen.map((x) => h('span', { class: 'chip', title: `Detection confidence: ${x.conf}` }, `${x.label} ×${x.n}`, h('small', { text: x.conf === 'low' ? ' (not sure)' : '' }))))
        : h('p', { class: 'muted', text: 'No specific techniques (flags, drop knees, matches, cross-throughs, high steps…) were clearly seen.' }),
      h('p', { class: 'small', style: 'margin-top:8px' }, h('strong', { text: `For ${mv.terrain === 'unknown' ? 'this climb' : `${mv.terrain} terrain`}:` })),
      h('ul', { class: 'fixes' }, mv.suggestions.map((x) => h('li', { text: x }))),
    ));
    const tl = h('div');
    const exportBtn = h('button', { type: 'button', class: 'btn btn-small', text: 'Export labels (JSON)', onclick: () => exportLabels(session) });
    put(3, card('Movement timeline',
      h('p', { class: 'muted small', text: 'Each half second is labelled with what your body and each hand and foot were doing. Anything a single camera can\'t show (grip type, hips-to-wall distance, whether a foot is weighted) is marked unknown, not guessed.' }),
      tl,
      h('div', { class: 'actions', style: 'margin-top:8px' }, exportBtn),
    ));
    draw(3, () => renderTimeline(tl, a.labels, { fmtTime: (t) => fmtTime(t, true), onSeek: canSeek ? (t) => opts.onSeek(t, 0.5) : null }));
  }

  // ----- start / middle / top -----
  if (a.sections?.length === 3) {
    const row = (label, f) => h('tr', {}, h('td', { text: label }), a.sections.map((s) => h('td', { class: 'num', text: f(s) })));
    const pctOr = (v) => (isNum(v) ? `${Math.round(v * 100)}%` : '—');
    put(2, card('How the climb went: start, middle and top',
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', { text: '' }), a.sections.map((s) => h('th', { class: 'num', text: s.name })))),
        h('tbody', {},
          row('Hand moves', (s) => String(s.moves)),
          row('Seconds per move', (s) => (isNum(s.setup) ? s.setup.toFixed(1) : '—')),
          row('Straight arms', (s) => pctOr(s.straightArm)),
          row('Feet first', (s) => pctOr(s.feetFirst)),
          row('Jolts', (s) => String(s.jolts)),
          row('Hesitations', (s) => String(s.hesitations)),
        ),
      )),
      r.sectionInsights.map((x) => h('div', { class: 'insight' }, h('h4', { text: x.title }), h('p', { text: x.text }), x.advice ? labelled('Next time:', x.advice, 'cue') : null)),
    ));
  }

  // ----- left vs right -----
  if (a.sides) {
    const sd = a.sides;
    const armTxt = (x) => (x ? `${Math.round(x.bent * 100)}%` : '—');
    put(2, card('Left vs right',
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

  // ----- detailed breakdown per area -----
  for (const [key, cat] of Object.entries(r.categories)) {
    const its = r.items.filter((i) => i.category === key && isNum(i.value));
    if (!its.length) continue;
    put(3, h('div', { class: 'card' },
      h('div', { class: 'bar-head' }, h('h3', { text: cat.label }), h('span', { class: `status status-${scoreStatus(cat.score)}`, text: isNum(cat.score) ? `${cat.score} · ${scoreLabel(cat.score)}` : '' })),
      h('p', { class: 'muted small', text: cat.blurb }),
      its.map((it) => {
        const d = h('details', { class: 'metric' },
          h('summary', {},
            h('span', { class: 'metric-name', text: it.label }),
            h('span', { class: 'metric-val', text: it.display }),
            h('span', { class: `status status-${it.info ? 'none' : scoreStatus(it.score)}`, text: it.info ? 'info' : String(it.score) }),
          ),
          h('p', { class: 'muted small', text: it.what }),
          it.inPlan
            // Already explained in full in the plan; don't repeat it.
            ? h('p', { class: 'small' }, h('strong', { text: `Covered in your plan (#${it.inPlan}).` }))
            : [
              it.text ? h('p', {}, it.confidence === 'low' ? h('em', { text: 'Possibly: ' }) : null, it.text) : null,
              it.inPlan ? null : labelled('Over your climbs:', it.history),
              labelled('Why it matters:', it.why),
              !it.info && isNum(it.score) && it.score < 65 ? labelled('Next time:', it.cue, 'cue') : null,
              !it.info && isNum(it.score) && it.score < 50 ? h('div', { class: 'drill', text: it.drill }) : null,
            ],
          it.confidence ? h('p', { class: 'muted small' }, 'Confidence: ', confBadge(it.confidence)) : null,
        );
        if (!it.info && !it.inPlan && isNum(it.score) && it.score < 50) d.open = true;
        return d;
      }),
    ));
  }

  // ----- other observations -----
  const obs = [...(r.extraInsights || []).map((x) => h('div', { class: 'insight' }, h('h4', { text: x.title }), h('p', { text: x.text }), x.advice ? labelled('Tip:', x.advice, 'cue') : null)),
    ...r.notes.map((n) => h('div', { class: 'insight' }, h('p', { text: n })))];
  if (obs.length) put(2, card('Other observations', obs));

  // ----- compared with previous climbs -----
  const hist = (opts.history || []).filter((x) => x.id !== session.id && x.createdAt < session.createdAt && x.report);
  if (hist.length) {
    const avg = (f) => { const v = hist.map(f).filter(isNum); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const rows = [['Overall', r.overall, avg((x) => x.report.overall)],
      ...Object.entries(r.categories).map(([k, c]) => [c.label, c.score, avg((x) => x.report.categories?.[k]?.score)])];
    const prev = [...hist].sort((x, y) => y.createdAt - x.createdAt)[0];
    const lastFocus = prev.report.actionPlan?.[0] || prev.report.improvements?.[0];
    let focusText = null;
    // Newer reports list what changed since the last climb (fixes are shown under strengths).
    const changes = (r.sinceLast || []).filter((x) => x.kind !== 'fixed');
    if (r.sinceLast) focusText = changes.length ? `Since your last climb: ${changes.map((x) => x.text).join(' ')}` : null;
    else if (lastFocus) {
      const key = lastFocus.key || prev.report.improvements?.find((i) => i.label === lastFocus.title)?.key;
      const before = prev.report.items?.find((i) => i.key === key)?.score;
      const now = r.items.find((i) => i.key === key)?.score;
      const title = lastFocus.title || lastFocus.label;
      if (isNum(before) && isNum(now)) {
        const d = now - before;
        focusText = `Last time your top focus was "${title}" (score ${before}). This climb: ${now} (${d > 0 ? '+' : ''}${d}). ${d >= 10 ? 'Great progress, keep it up!' : d > -5 ? 'About the same, so keep drilling it.' : 'It slipped this time. Give it extra attention on your warm-up climbs.'}`;
      }
    }
    put(2, card(`Compared with your previous ${hist.length === 1 ? 'climb' : `${hist.length} climbs`}`,
      focusText ? h('p', { text: focusText }) : null,
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

  // ----- timeline chart -----
  const chartBox = h('div');
  put(2, h('div', { class: 'card' },
    h('h3', { text: 'Height over time' }),
    h('p', { class: 'muted small', text: canSeek ? 'Tap the chart to jump to that moment in the video.' : 'How high your body was during the climb. Shaded areas are pauses.' }),
    chartBox,
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'k-line' }), 'Height'),
      h('span', {}, h('i', { class: 'k-band' }), 'Hesitation'),
      h('span', {}, h('i', { class: 'k-rest' }), 'Rest (4 s+)'),
      h('span', {}, h('i', { class: 'k-marker' }), 'Key moment'),
    ),
  ));
  const s = a.series;
  const toM = (v) => torsoToMetres(v, heightCm);
  draw(2, () => lineChart(chartBox, {
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

  // ----- key moments -----
  if (a.events.length) {
    put(2, card('Key moments',
      canSeek ? null : h('p', { class: 'muted small', text: 'Attach the video above to jump to these moments.' }),
      h('ul', { class: 'moments' }, a.events.map((e) => eventItem(e, canSeek, opts.onSeek))),
    ));
  }

  // ----- how sure are we? -----
  if (r.reliability) {
    container.append(h('div', { class: 'card' },
      h('div', { class: 'bar-head' }, h('h3', { text: 'How sure are we?' }), confBadge(r.reliability.level)),
      h('p', { text: r.reliability.text }),
      r.reliability.points.length ? h('ul', { class: 'evidence' }, r.reliability.points.map((x) => h('li', { text: x }))) : null,
      h('p', { class: 'muted small', text: 'Every finding has its own confidence label. "Not sure" findings are kept out of your plan unless there is nothing better.' }),
    ));
  }

  // ----- all measurements -----
  const rows = r.items.map((it) => h('tr', {},
    h('td', {}, h('span', { text: it.label }), h('span', { class: 'what', text: it.what })),
    h('td', { class: 'num', text: it.display }),
    h('td', { class: 'num', text: isNum(it.score) ? String(it.score) : (it.info ? 'info' : '—') }),
  ));
  const extra = [
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
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Measure' }), h('th', { class: 'num', text: 'Value' }), h('th', { class: 'num', text: 'Score' }))),
    h('tbody', {}, rows, extra),
  ));
  // Inside "More detail" it's already folded away; elsewhere it gets its own fold.
  put(3, level === 'standard' ? card('All measurements', table) : h('details', { class: 'card' }, h('summary', { text: 'All measurements' }), table));

  if (more.children.length > 2) container.append(more);
  if (simple && hidden) {
    container.append(h('div', { class: 'card center' },
      h('p', { class: 'muted small', text: `${coachInfo.name} keeps it short. The full analysis has ${hidden} more sections: scores, move by move, start/middle/top, left vs right, charts and every measurement.` }),
      h('button', { type: 'button', class: 'btn btn-block', text: 'Show the full analysis', onclick: () => renderReport(container, session, { ...opts, level: 'expert' }) }),
    ));
  }
  if (opts.footer) container.append(opts.footer);
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
