import { onSave, state } from './state.js';
import { $, h, todayLocal } from './util.js';

// ---------- Automatic backup to a folder (Chrome and Edge: File System Access API) ----------
// The person picks a folder once. After changes, the app rewrites print-tracker-backup.json there, and keeps one
// dated copy per day (the last 14 days), so wiping the data by mistake cannot overwrite the only good copy.

const DB_NAME = 'printTrackerBackup';
const STORE = 'handles';
const KEY = 'folder';
const META_KEY = 'printTracker.autoBackup';
export const LATEST_FILE = 'print-tracker-backup.json';
export const DATED_PREFIX = 'print-tracker-backup-';
export const KEEP_DATED = 14;
const DEBOUNCE_MS = 4000;
const DATED_RE = /^print-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/;

let handle = null;          // the chosen folder
let permission = 'unknown'; // 'granted' | 'prompt' | 'denied' | 'unknown'
let lastError = '';
let timer = null;

export const autoBackupSupported = () => typeof window.showDirectoryPicker === 'function' && typeof window.indexedDB !== 'undefined';

// --- remembering the folder (a folder handle can only be stored in IndexedDB) ---

function openDb() {
    return new Promise((resolve, reject) => {
        const req = window.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idb(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

const storeHandle = (value) => idb('readwrite', (s) => s.put(value, KEY));
const loadHandle = () => idb('readonly', (s) => s.get(KEY));
const forgetHandle = () => idb('readwrite', (s) => s.delete(KEY));

// --- last successful write, kept outside the app data so saving it does not trigger another backup ---

function readMeta() {
    try {
        const m = JSON.parse(localStorage.getItem(META_KEY) || 'null');
        return m && typeof m.at === 'string' && !Number.isNaN(new Date(m.at).getTime()) ? m : null;
    } catch (e) {
        return null;
    }
}

function writeMeta(meta) {
    try {
        if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta));
        else localStorage.removeItem(META_KEY);
    } catch (e) { /* storage blocked: the status line just will not show a time */ }
}

/** True when a folder is set up and was written to within `days` days. The backup reminder uses this. */
export function autoBackupRecent(days) {
    const meta = readMeta();
    if (!meta || !meta.enabled) return false;
    return (Date.now() - new Date(meta.at).getTime()) / 86400000 < Math.max(1, days);
}

// --- writing ---

async function writeFile(dir, name, text) {
    const file = await dir.getFileHandle(name, { create: true });
    const out = await file.createWritable();
    await out.write(text);
    await out.close();
}

async function exists(dir, name) {
    try {
        await dir.getFileHandle(name);
        return true;
    } catch (error) {
        if (error && error.name === 'NotFoundError') return false;
        throw error;
    }
}

/** Keep only the newest KEEP_DATED dated copies. */
async function pruneDated(dir) {
    const names = [];
    for await (const [name] of dir.entries()) if (DATED_RE.test(name)) names.push(name);
    names.sort().reverse();
    for (const name of names.slice(KEEP_DATED)) await dir.removeEntry(name);
}

const hasData = () => Object.keys(state.prints).length + Object.keys(state.spools).length + Object.keys(state.queue).length > 0;

/** Write the backup now. Returns true on success. Does nothing (and keeps the old files) when there is no data. */
export async function writeBackup() {
    if (!handle) return false;
    if (!hasData()) return false;   // an empty app must never replace a good backup
    try {
        permission = await handle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') {
            renderAutoBackup();
            return false;
        }
        const text = JSON.stringify(state, null, 2);
        await writeFile(handle, LATEST_FILE, text);
        const dated = `${DATED_PREFIX}${todayLocal()}.json`;
        if (!(await exists(handle, dated))) {
            await writeFile(handle, dated, text);
            await pruneDated(handle);
        }
        lastError = '';
        writeMeta({ at: new Date().toISOString(), enabled: true, name: handle.name || '' });
        const banner = document.getElementById('backup-banner');
        if (banner) banner.remove();   // the reminder is no longer needed
        renderAutoBackup();
        return true;
    } catch (error) {
        console.error(error);
        lastError = error && error.message ? error.message : 'Could not write to the folder.';
        renderAutoBackup();
        return false;
    }
}

function schedule() {
    if (!handle || permission === 'denied') return;
    clearTimeout(timer);
    timer = setTimeout(() => { writeBackup(); }, DEBOUNCE_MS);
}

onSave(schedule);

// --- choosing and stopping ---

export async function chooseFolder() {
    if (!autoBackupSupported()) return false;
    let dir;
    try {
        dir = await window.showDirectoryPicker({ id: 'printtracker-backup', mode: 'readwrite' });
    } catch (error) {
        if (!error || error.name !== 'AbortError') {
            lastError = error && error.message ? error.message : 'Could not open the folder.';
            renderAutoBackup();
        }
        return false;
    }
    try {
        await storeHandle(dir);
    } catch (error) {
        console.error(error);
        lastError = 'This browser would not remember the folder. Automatic backup needs site storage turned on.';
        renderAutoBackup();
        return false;
    }
    handle = dir;
    permission = 'granted';
    lastError = '';
    writeMeta({ at: readMeta() ? readMeta().at : new Date(0).toISOString(), enabled: true, name: dir.name || '' });
    const ok = await writeBackup();
    renderAutoBackup();
    return ok;
}

/** After a reload the browser may ask again before it lets the page write. This needs a click. */
export async function allowAccess() {
    if (!handle) return false;
    try {
        permission = await handle.requestPermission({ mode: 'readwrite' });
    } catch (error) {
        lastError = error && error.message ? error.message : 'Could not get access to the folder.';
    }
    if (permission === 'granted') return writeBackup();
    renderAutoBackup();
    return false;
}

export async function stopAutoBackup() {
    clearTimeout(timer);
    handle = null;
    permission = 'unknown';
    lastError = '';
    writeMeta(null);
    try { await forgetHandle(); } catch (e) { /* nothing stored */ }
    renderAutoBackup();
}

/** Pick up a folder chosen in an earlier visit. */
export async function initAutoBackup() {
    if (!autoBackupSupported()) return;
    try {
        const saved = await loadHandle();
        if (saved && typeof saved.queryPermission === 'function') {
            handle = saved;
            permission = await saved.queryPermission({ mode: 'readwrite' });
        }
    } catch (error) {
        console.error(error);
    }
    renderAutoBackup();
}

// --- the panel on the Data tab ---

function describeTime(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function button(text, id, cls, fn) {
    const b = h('button', cls, text);
    b.type = 'button';
    b.id = id;
    b.addEventListener('click', fn);
    return b;
}

export function renderAutoBackup() {
    const panel = $('auto-backup-panel');
    if (!panel) return;
    panel.replaceChildren(h('h3', 'panel-title', 'Automatic backup'));
    const status = h('p', 'body-text');
    status.id = 'auto-backup-status';
    status.setAttribute('role', 'status');
    const actions = h('div', 'data-actions');

    if (!autoBackupSupported()) {
        status.textContent = 'This browser cannot save backups to a folder by itself. Chrome and Edge can. Here, use Export JSON from time to time.';
        panel.append(status);
        return;
    }
    panel.appendChild(h('p', 'body-text secondary-text small',
        `Pick a folder once (a synced one such as OneDrive or Dropbox is ideal). After you change something, the app saves ${LATEST_FILE} there, plus one dated copy per day for the last ${KEEP_DATED} days. To restore, use Import JSON. Nothing is saved while the app has no data.`));

    const meta = readMeta();
    if (!handle) {
        status.textContent = 'Off.';
        actions.appendChild(button('Choose backup folder', 'auto-backup-choose', 'btn btn-primary', chooseFolder));
    } else if (permission !== 'granted') {
        status.textContent = `Paused: the browser needs your permission again for the folder "${handle.name || ''}".`;
        actions.append(
            button('Allow access', 'auto-backup-allow', 'btn btn-primary', allowAccess),
            button('Stop', 'auto-backup-stop', 'btn btn-outline', stopAutoBackup)
        );
    } else {
        const when = meta && describeTime(meta.at);
        status.textContent = `On: saving to the folder "${handle.name || ''}". ${when && meta.at !== new Date(0).toISOString() ? `Last saved ${when}.` : 'Waiting for the first save.'}`;
        actions.append(
            button('Back up now', 'auto-backup-now', 'btn btn-outline', writeBackup),
            button('Change folder', 'auto-backup-choose', 'btn btn-outline', chooseFolder),
            button('Stop', 'auto-backup-stop', 'btn btn-outline', stopAutoBackup)
        );
    }
    panel.appendChild(status);
    if (lastError) {
        const err = h('p', 'error-text', lastError);
        err.id = 'auto-backup-error';
        err.setAttribute('role', 'alert');
        panel.appendChild(err);
    }
    panel.appendChild(actions);
}
