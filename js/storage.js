// Saved sessions live in IndexedDB on this device only. Settings live in localStorage.

const DB_NAME = 'crux-coach';
const STORE = 'sessions';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function saveSession(session) {
  await tx('readwrite', (s) => reqP(s.put(session)));
  return session;
}

export async function getSession(id) {
  return tx('readonly', (s) => reqP(s.get(id)));
}

export async function listSessions() {
  const all = await tx('readonly', (s) => reqP(s.getAll()));
  return (all || []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteSession(id) {
  return tx('readwrite', (s) => reqP(s.delete(id)));
}

export async function clearSessions() {
  return tx('readwrite', (s) => reqP(s.clear()));
}

export async function exportAll() {
  const sessions = await listSessions();
  return JSON.stringify({ app: 'crux-coach', version: 1, exportedAt: new Date().toISOString(), sessions });
}

export async function importAll(json) {
  const data = JSON.parse(json);
  if (!data || data.app !== 'crux-coach' || !Array.isArray(data.sessions)) throw new Error('This file is not a Crux Coach backup.');
  let n = 0;
  for (const s of data.sessions) {
    if (s && s.id && s.analysis && s.report) { await saveSession(s); n++; }
  }
  return n;
}

// Ask the browser not to evict our data (helps on iOS when installed to the Home Screen).
export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* unsupported */ }
  return false;
}

const SETTINGS_KEY = 'crux-coach-settings';
export const DEFAULT_SETTINGS = { model: 'full', preferCpu: false, fps: 10, heightCm: null, units: 'metric' };

export function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
