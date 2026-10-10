import { MAX_SNAPSHOTS, SNAPSHOT_KEY } from './constants.js';
import { state } from './state.js';
import { isObject } from './util.js';

// ---------- Local backup snapshots ----------
//
// The last few versions of your data, kept in this browser (a separate storage key from the data itself).
// They protect against a bad import, a mis-click or a deleted spool. They are NOT a real backup: clearing
// site data erases them too, so keep exporting a JSON file now and then.

/** All snapshots, newest first. Anything malformed is skipped. */
export function listSnapshots() {
    let raw = null;
    try {
        raw = localStorage.getItem(SNAPSHOT_KEY);
    } catch (error) {
        return [];
    }
    if (!raw) return [];
    try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        return list.filter((s) => isObject(s) && typeof s.data === 'string' && typeof s.at === 'string' && !Number.isNaN(new Date(s.at).getTime()))
            .map((s) => ({ at: s.at, reason: typeof s.reason === 'string' ? s.reason.slice(0, 60) : '', data: s.data }))
            .sort((a, b) => b.at.localeCompare(a.at));
    } catch (error) {
        return [];
    }
}

function writeSnapshots(list) {
    // If storage is full, drop the oldest one at a time until it fits.
    for (let keep = list.length; keep >= 0; keep--) {
        try {
            localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(list.slice(0, keep)));
            return keep === list.length;
        } catch (error) { /* try with fewer */ }
    }
    return false;
}

/** The counts shown next to a snapshot. */
export function describeSnapshot(snap) {
    try {
        const d = JSON.parse(snap.data);
        const n = (o) => (isObject(o) ? Object.keys(o).length : 0);
        return { prints: n(d.prints), spools: n(d.spools), queue: n(d.queue) };
    } catch (error) {
        return { prints: 0, spools: 0, queue: 0 };
    }
}

/**
 * Save the current data as a snapshot. Returns true if one was stored.
 * Empty data is skipped, and so is an exact copy of the newest snapshot.
 */
export function takeSnapshot(reason) {
    if (Object.keys(state.prints).length + Object.keys(state.spools).length + Object.keys(state.queue).length === 0) return false;
    const data = JSON.stringify(state);
    const list = listSnapshots();
    if (list.length > 0 && list[0].data === data) return false;
    list.unshift({ at: new Date().toISOString(), reason, data });
    writeSnapshots(list.slice(0, MAX_SNAPSHOTS));
    return true;
}

/** One automatic snapshot per day, taken when the app starts. */
export function dailySnapshot() {
    const list = listSnapshots();
    if (list.length > 0 && Date.now() - new Date(list[0].at).getTime() < 24 * 3600 * 1000) return false;
    return takeSnapshot('Daily');
}

export function deleteSnapshot(at) {
    writeSnapshots(listSnapshots().filter((s) => s.at !== at));
}
