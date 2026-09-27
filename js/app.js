import { analyze, ANALYSIS_VERSION } from './metrics.js';
import { framesFromTrack } from './refine.js';
import { coach } from './coach.js';
import { createPlayer, packTrack, displayTrack } from './player.js';
import { renderReport, fmtTime, fmtDate, h, gradeScaleOptions } from './report.js';
import { renderProgress } from './progress.js';
import { GRADE_SCALES } from './grades.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);
let settings = store.loadSettings();

// ---------- navigation ----------

const views = ['analyse', 'history', 'progress', 'guide'];
function showView(name) {
  for (const v of views) $(`view-${v}`).hidden = v !== name;
  document.querySelectorAll('.tabbar button').forEach((b) => {
    const on = b.dataset.view === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('view-title').textContent = $(`view-${name}`).dataset.title;
  window.scrollTo(0, 0);
  if (name === 'history') refreshHistory();
  if (name === 'progress') refreshProgress();
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- analyse flow ----------

let player = null;
let currentFile = null;
let trim = { start: 0, end: null };
let pick = null; // where the user tapped the climber: { x, y, t } (0..1 coords)
let abort = null;
const PICK_HELP = 'Scrub to the start of the climb, then tap the climber. This matters when they\'re far away or other people (like the belayer) are in shot.';

function step(name) {
  for (const s of ['pick', 'setup', 'progress', 'result']) $(`${s}-step`).hidden = s !== name;
  $('video-area').hidden = name === 'pick';
  if (player) player.showControls(name !== 'progress');
}

function updateGradeOptions() {
  const scale = $('grade-scale').value;
  const g = $('grade');
  g.replaceChildren(h('option', { value: '', text: '—' }), ...GRADE_SCALES[scale].grades.map((x) => h('option', { value: x, text: x })));
}
gradeScaleOptions($('grade-scale'), settings.gradeScale || 'v');
updateGradeOptions();
$('grade-scale').addEventListener('change', () => { updateGradeOptions(); settings.gradeScale = $('grade-scale').value; store.saveSettings(settings); });
$('details-form').addEventListener('submit', (e) => e.preventDefault());
$('details-form').elements.type.addEventListener('change', (e) => {
  const boulder = e.target.value === 'boulder';
  const cur = $('grade-scale').value;
  const isBoulderScale = cur === 'v' || cur === 'font';
  if (boulder !== isBoulderScale) {
    $('grade-scale').value = boulder ? 'v' : 'french';
    updateGradeOptions();
  }
});

function updateTrimLabels() {
  $('trim-start-val').textContent = fmtTime(trim.start, true);
  $('trim-end-val').textContent = fmtTime(trim.end ?? player?.video.duration, true);
}

$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  await openVideo(file);
});

// Load the pose model in the background as soon as there's a video, so Analyse starts
// straight away. The status line under the Analyse button shows how far it's got.
let modelReady = false;
function startPreload() {
  const q = store.QUALITY[settings.quality] || store.QUALITY.accurate;
  const el = $('model-status');
  modelReady = false;
  const onP = (f) => { if (!modelReady) el.textContent = `Preparing the pose model… ${Math.round(f * 100)}%`; };
  el.textContent = 'Preparing the pose model…';
  import('./pose.js').then((pose) => pose.preload(q.model, settings.preferCpu, onP))
    .then(() => { modelReady = true; el.textContent = 'Pose model ready ✓'; })
    .catch((e) => { console.warn('Preload failed', e); el.textContent = ''; })
    .finally(() => import('./pose.js').then((pose) => pose.stopPreloadProgress(onP)));
}

async function openVideo(file) {
  currentFile = file;
  startPreload();
  if (player) player.destroy();
  player = createPlayer($('video-area'));
  step('setup');
  try {
    await player.load(file);
  } catch (err) {
    toast(err.message || 'Could not open that video.');
    step('pick');
    return;
  }
  trim = { start: 0, end: null };
  updateTrimLabels();
  pick = null;
  $('pick-status').textContent = PICK_HELP;
  $('pick-btn').textContent = 'Tap to select climber';
  const form = $('details-form');
  form.reset();
  $('grade-scale').value = settings.gradeScale || 'v';
  updateGradeOptions();
  const base = file.name ? file.name.replace(/\.[^.]+$/, '') : '';
  form.elements.name.value = /^(IMG|VID|MOV|RPReplay|trim)[_-]?\d/i.test(base) || !base ? '' : base;
}

$('set-start').addEventListener('click', () => {
  trim.start = player.video.currentTime;
  if (trim.end !== null && trim.end <= trim.start + 1) trim.end = null;
  updateTrimLabels();
});
$('set-end').addEventListener('click', () => {
  const t = player.video.currentTime;
  if (t <= trim.start + 1) { toast('The end needs to be at least 1 second after the start.'); return; }
  trim.end = t;
  updateTrimLabels();
});
$('reset-trim').addEventListener('click', () => { trim = { start: 0, end: null }; updateTrimLabels(); });
$('pick-btn').addEventListener('click', () => {
  $('pick-btn').textContent = 'Now tap the climber in the video ↑';
  player.video.scrollIntoView({ behavior: 'smooth', block: 'center' });
  player.pickPoint((m) => {
    pick = m;
    $('pick-status').textContent = `Climber selected at ${fmtTime(m.t, true)}. The app will follow this person.`;
    $('pick-btn').textContent = 'Select again';
  });
});
$('change-video').addEventListener('click', () => $('file-input').click());
$('cancel-btn').addEventListener('click', () => abort?.abort());

function setProgress(title, frac, detail) {
  if (title) $('progress-title').textContent = title;
  $('progress-fill').style.width = `${Math.round(frac * 100)}%`;
  if (detail != null) $('progress-detail').textContent = detail;
}

async function grabThumbnail(video, t) {
  try {
    // "seeked" never fires if the video is already there, so don't wait forever.
    if (Math.abs(video.currentTime - t) > 0.01) {
      await Promise.race([
        new Promise((r) => { video.addEventListener('seeked', r, { once: true }); video.currentTime = t; }),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
    const c = document.createElement('canvas');
    const s = 160 / Math.max(video.videoWidth, video.videoHeight);
    c.width = Math.round(video.videoWidth * s);
    c.height = Math.round(video.videoHeight * s);
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return null; }
}

$('analyse-btn').addEventListener('click', runAnalysis);

async function runAnalysis() {
  if (abort || !player) return; // already running (double tap)
  abort = new AbortController();
  $('analyse-btn').disabled = true;
  const video = player.video;
  const form = $('details-form');
  const details = {
    name: form.elements.name.value.trim(),
    type: form.elements.type.value,
    outcome: form.elements.outcome.value,
    gradeScale: form.elements.gradeScale.value,
    grade: form.elements.grade.value,
    notes: form.elements.notes.value.trim(),
    terrain: form.elements.terrain.value,
  };
  // Prime decoding inside the tap (iOS won't seek an untouched video reliably).
  try { await video.play(); video.pause(); } catch { /* fine */ }

  player.cancelPick();
  step('progress');
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* unsupported */ }
  setProgress('Loading the pose model…', 0.02, 'The first run downloads about 20 MB, and it\'s cached after that.');

  try {
    const pose = await import('./pose.js');
    const q = store.QUALITY[settings.quality] || store.QUALITY.accurate;
    const onLoad = (f) => setProgress(modelReady ? 'Starting…' : 'Loading the pose model…', 0.02 + 0.08 * f,
      `${Math.round(f * 100)}% · the first run downloads ${q.model === 'heavy' ? 'about 40' : q.model === 'lite' ? 'about 17' : 'about 21'} MB, and it's cached after that.`);
    let { landmarker, delegate } = await pose.preload(q.model, settings.preferCpu, onLoad);
    pose.stopPreloadProgress(onLoad);
    const analysisStart = performance.now();
    const run = async (lm) => pose.processVideo(video, {
      landmarker: lm,
      fps: Number(settings.fps) || 10,
      start: trim.start,
      end: trim.end,
      signal: abort.signal,
      hint: pick,
      twoPass: q.twoPass,
      onFrame: (frac, pts, box) => {
        player.setLive(pts, box);
        const el = (performance.now() - analysisStart) / 1000;
        const eta = frac > 0.03 ? Math.max(0, el / frac - el) : null;
        setProgress('Analysing your climb…', frac, `${Math.round(frac * 100)}%${eta !== null ? ` · about ${Math.ceil(eta)} s left` : ''}. Keep this screen open.`);
      },
    });
    let out = await run(landmarker);
    // Some iOS GPUs return nothing; retry once on the CPU.
    if (delegate === 'GPU' && !out.frames.some((f) => f.p)) {
      setProgress('Retrying in compatibility mode…', 0.02, '');
      ({ landmarker } = await pose.loadWithFallback(q.model, true));
      out = await run(landmarker);
    }
    player.setLive(null);

    setProgress('Working out your technique…', 1, '');
    window.__crux.lastRun = out; // for debugging and automated tests
    const analysis = analyze(out.frames, { frameHeightPx: out.height, terrain: details.terrain });
    if (!analysis.ok) throw new Error(analysis.reason);
    const report = coach(analysis);
    const track = packTrack(out.frames, out.aspect);
    const thumb = await grabThumbnail(video, (analysis.window.t0 + analysis.window.t1) / 2);

    const auto = { topped: 'sent', finished: 'sent', fell: 'fell', unknown: 'attempt' }[analysis.outcome?.result] || 'attempt';
    const session = {
      id: `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
      ...details,
      videoName: currentFile?.name || '',
      videoDuration: video.duration,
      videoHeight: out.height,
      analysisVersion: ANALYSIS_VERSION,
      // "Detect from video" uses the detected ending; an explicit answer always wins.
      outcome: details.outcome === 'auto' ? auto : details.outcome,
      outcomeSource: details.outcome === 'auto' ? 'auto' : 'user',
      settings: { quality: settings.quality, fps: settings.fps },
      analysis,
      report,
      track,
      thumb,
    };
    await store.saveSession(session);
    store.requestPersistence();
    showResult(session);
  } catch (err) {
    player.setLive(null);
    if (err.name === 'AbortError') { step('setup'); toast('Analysis cancelled.'); }
    else {
      console.error(err);
      step('setup');
      toast(`${err.message || 'Something went wrong.'}${settings.preferCpu ? '' : ' Try turning on Compatibility mode in Guide.'}`, 7000);
    }
  } finally {
    abort = null;
    $('analyse-btn').disabled = false;
    try { await wakeLock?.release(); } catch { /* already released */ }
  }
}

async function showResult(session) {
  step('result');
  player.setMarker(null);
  const track = displayTrack(session.track);
  player.setTrack(track);
  const box = $('result-step');
  const history = await store.listSessions();
  const draw = () => {
    renderReport(box, session, {
      heightCm: settings.heightCm, history, track, aspect: session.track?.aspect,
      onSeek: (t, rate) => player.seek(t, rate),
      onSetOutcome: async (val) => { session.outcome = val; session.outcomeSource = 'user'; await store.saveSession(session); draw(); toast('Saved.'); },
    });
    box.append(h('div', { class: 'actions' },
      h('label', { class: 'btn btn-primary btn-block', for: 'file-input', text: 'Analyse another video' }),
    ));
  };
  draw();
  $('video-area').scrollIntoView({ block: 'start' });
  window.scrollTo(0, 0);
}

// ---------- history ----------

// Re-analyses climbs saved by an older version, from their stored poses (no video needed).
async function upgradeSession(s) {
  if ((s.analysisVersion || 1) >= ANALYSIS_VERSION) return s;
  try {
    if (s.track) {
      const analysis = analyze(framesFromTrack(s.track), { frameHeightPx: s.videoHeight || null, terrain: s.terrain });
      if (analysis.ok) s.analysis = analysis;
    }
    s.report = coach(s.analysis);
    // Climbs saved before auto-detection had their result chosen by hand.
    if (!s.outcomeSource) s.outcomeSource = 'user';
    s.analysisVersion = ANALYSIS_VERSION;
    await store.saveSession(s);
  } catch (e) { console.warn('Could not upgrade session', s.id, e); }
  return s;
}
async function upgradeAll(sessions) {
  const out = [];
  for (const s of sessions) out.push(await upgradeSession(s));
  return out;
}

let detailPlayer = null;

async function refreshHistory() {
  $('history-detail').hidden = true;
  $('history-list').hidden = false;
  if (detailPlayer) { detailPlayer.destroy(); detailPlayer = null; }
  const list = $('history-list');
  const sessions = await upgradeAll(await store.listSessions());
  list.replaceChildren();
  if (!sessions.length) {
    list.append(h('div', { class: 'card empty' },
      h('h3', { text: 'No saved climbs yet' }),
      h('p', { class: 'muted', text: 'Every climb you analyse is saved here on your phone.' }),
    ));
    return;
  }
  for (const s of sessions) {
    const thumb = s.thumb ? h('img', { src: s.thumb, alt: '' }) : h('div', { class: 'thumb' });
    list.append(h('button', { class: 'card session-card', type: 'button', onclick: () => openSession(s.id) },
      thumb,
      h('div', { class: 'info' },
        h('div', { class: 'title', text: s.name || 'Untitled climb' }),
        h('div', { class: 'meta', text: [fmtDate(s.createdAt), s.grade, s.outcome === 'sent' ? 'Sent' : s.outcome === 'fell' ? 'Fell' : null].filter(Boolean).join(' · ') }),
        h('div', { class: 'meta', text: `${fmtTime(s.analysis.metrics.climbTime)} on the wall` }),
      ),
      h('div', { class: 'score', text: s.report.overall ?? '—' }, h('small', { text: 'score' })),
    ));
  }
}

async function openSession(id, fromProgress = false) {
  let s = await store.getSession(id);
  if (!s) return;
  s = await upgradeSession(s);
  const history = await store.listSessions();
  if (fromProgress) showView('history');
  $('history-list').hidden = true;
  const box = $('history-detail');
  box.hidden = false;
  box.replaceChildren();
  window.scrollTo(0, 0);

  const back = h('button', { class: 'btn btn-link', type: 'button', text: '‹ All climbs', onclick: refreshHistory });
  const videoArea = h('div');
  const attachInput = h('input', { type: 'file', accept: 'video/*', hidden: 'true' });
  const attachBtn = h('button', { class: 'btn btn-block', type: 'button', text: 'Attach the video to replay with skeleton', onclick: () => attachInput.click() });
  const extra = h('div', {}, videoArea, attachBtn, attachInput);
  const reportBox = h('div', { class: 'view' });

  const track = displayTrack(s.track);
  let seekable = false;
  const render = (canSeek = seekable) => {
    seekable = canSeek;
    renderReport(reportBox, s, {
      history, track, aspect: s.track?.aspect,
      heightCm: settings.heightCm,
      onSeek: canSeek ? (t, rate) => detailPlayer.seek(t, rate) : null,
      onSetOutcome: async (val) => { s.outcome = val; s.outcomeSource = 'user'; await store.saveSession(s); render(); toast('Saved.'); },
      extra,
    });
  };
  attachInput.addEventListener('change', async () => {
    const f = attachInput.files[0];
    attachInput.value = '';
    if (!f) return;
    if (detailPlayer) detailPlayer.destroy();
    detailPlayer = createPlayer(videoArea);
    try {
      await detailPlayer.load(f);
      if (s.videoDuration && Math.abs(detailPlayer.video.duration - s.videoDuration) > 1) toast('This video is a different length from the one analysed. The skeleton may not line up.');
      detailPlayer.setTrack(track);
      attachBtn.hidden = true;
      render(true);
    } catch (err) { toast(err.message); }
  });

  const del = h('button', { class: 'btn btn-block btn-danger', type: 'button', text: 'Delete this climb', onclick: async () => {
    if (!confirm('Delete this climb? This cannot be undone.')) return;
    await store.deleteSession(s.id);
    toast('Climb deleted.');
    refreshHistory();
  } });
  box.append(back, reportBox, h('div', { class: 'actions', style: 'margin-top:14px' }, del));
  render(false);
}

// ---------- progress ----------

async function refreshProgress() {
  const sessions = await upgradeAll(await store.listSessions());
  renderProgress($('progress-content'), sessions, { onOpen: openSession });
}

// ---------- settings & data ----------

function bindSettings() {
  $('set-height').value = settings.heightCm || '';
  $('set-model').value = settings.quality;
  $('set-fps').value = String(settings.fps);
  $('set-cpu').checked = !!settings.preferCpu;
  $('set-height').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    settings.heightCm = v >= 100 && v <= 230 ? v : null;
    store.saveSettings(settings);
  });
  $('set-model').addEventListener('change', (e) => { settings.quality = e.target.value; store.saveSettings(settings); if (player) startPreload(); });
  $('set-fps').addEventListener('change', (e) => { settings.fps = Number(e.target.value); store.saveSettings(settings); });
  $('set-cpu').addEventListener('change', (e) => { settings.preferCpu = e.target.checked; store.saveSettings(settings); if (player) startPreload(); });
}
bindSettings();

$('export-btn').addEventListener('click', async () => {
  const json = await store.exportAll();
  const name = `crux-coach-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Crux Coach backup' }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: name });
  document.body.append(a);
  a.click();
  a.remove();
});
$('import-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const n = await store.importAll(await f.text());
    toast(`Imported ${n} climb${n === 1 ? '' : 's'}.`);
  } catch (err) { toast(err.message || 'Import failed.'); }
});
$('clear-btn').addEventListener('click', async () => {
  if (!confirm('Delete ALL saved climbs from this device? Export a backup first if you want to keep them.')) return;
  await store.clearSessions();
  toast('All climbs deleted.');
});

// Hide the install hint when already running as an installed app.
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install-card').hidden = true;

// ---------- offline support ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e)));
}

// Debug hook for automated tests.
window.__crux = { analyze, coach, store };
