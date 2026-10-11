import { onSave, state } from './state.js';
import { $, h, isObject } from './util.js';

// ---------- Activity log: what changed in the prints, spools and queue, newest first ----------
// The log is built by comparing the data before and after every save, so it covers everything
// (editing, importing, undoing), not only actions that show a message. It lives in this browser only.

export const ACTIVITY_KEY = 'printTracker.activity';
export const MAX_ENTRIES = 60;
const MAX_LISTED = 25;
const BULK = 5;   // more changes than this of one kind in one save are summarised as a count

const spoolName = (s) => `${s.brand}, ${s.color}`;
const KINDS = {
    prints: { one: 'print', many: 'prints', label: (p) => String(p.name || 'Untitled print') },
    spools: { one: 'spool', many: 'spools', label: spoolName },
    queue: { one: 'queue item', many: 'queue items', label: (q) => String(q.name || 'Untitled') }
};

/** id -> { text: what the item is called, json: its full contents } for each kind. */
export function snapshotOf(data) {
    const out = {};
    for (const kind of Object.keys(KINDS)) {
        out[kind] = {};
        for (const [id, item] of Object.entries(data[kind] || {})) {
            if (isObject(item)) out[kind][id] = { text: KINDS[kind].label(item), json: JSON.stringify(item), archived: Boolean(item.archived), done: Boolean(item.done) };
        }
    }
    return out;
}

/** The sentences describing how `next` differs from `prev` (both snapshots). Oldest first within a kind. */
export function diffSnapshots(prev, next) {
    const lines = [];
    for (const [kind, names] of Object.entries(KINDS)) {
        const added = [], removed = [], changed = [];
        for (const [id, now] of Object.entries(next[kind])) {
            const was = prev[kind][id];
            if (!was) added.push(now);
            else if (was.json !== now.json) changed.push({ was, now });
        }
        for (const [id, was] of Object.entries(prev[kind])) if (!next[kind][id]) removed.push(was);

        const group = (list, many, one) => {
            if (list.length > BULK) lines.push(`${many} ${list.length} ${names.many}`);
            else for (const x of list) lines.push(one(x));
        };
        if (kind === 'queue') {
            group(added, 'Added', (x) => `Added "${x.text}" to the queue`);
            group(removed, 'Removed from the queue:', (x) => `Removed "${x.text}" from the queue`);
            for (const { was, now } of changed.slice(0, BULK)) {
                if (was.done !== now.done) lines.push(now.done ? `Finished "${now.text}" in the queue` : `Reopened "${now.text}" in the queue`);
                else lines.push(`Edited "${now.text}" in the queue`);
            }
            if (changed.length > BULK) lines.push(`Changed ${changed.length} queue items`);
        } else if (kind === 'spools') {
            group(added, 'Added', (x) => `Added spool "${x.text}"`);
            group(removed, 'Deleted', (x) => `Deleted spool "${x.text}"`);
            for (const { was, now } of changed.slice(0, BULK)) {
                if (was.archived !== now.archived) lines.push(`${now.archived ? 'Archived' : 'Restored'} spool "${now.text}"`);
                else lines.push(`Updated spool "${now.text}"`);
            }
            if (changed.length > BULK) lines.push(`Updated ${changed.length} spools`);
        } else {
            group(added, 'Logged', (x) => `Logged print "${x.text}"`);
            group(removed, 'Deleted', (x) => `Deleted print "${x.text}"`);
            for (const { now } of changed.slice(0, BULK)) lines.push(`Edited print "${now.text}"`);
            if (changed.length > BULK) lines.push(`Edited ${changed.length} prints`);
        }
    }
    return lines;
}

export function readLog() {
    try {
        const raw = JSON.parse(localStorage.getItem(ACTIVITY_KEY) || '[]');
        return (Array.isArray(raw) ? raw : []).filter((e) => isObject(e) && typeof e.text === 'string' && typeof e.at === 'string').slice(0, MAX_ENTRIES);
    } catch (error) {
        return [];
    }
}

function writeLog(entries) {
    try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES))); } catch (error) { /* a full or blocked store only loses the log */ }
}

let last = snapshotOf(state);

/** Compare with the last save and add what changed to the log. */
export function recordChanges() {
    const next = snapshotOf(state);
    const lines = diffSnapshots(last, next);
    last = next;
    if (lines.length > 0) {
        const at = new Date().toISOString();
        writeLog([...lines.reverse().map((text) => ({ at, text })), ...readLog()]);
    }
    renderActivity();
}

export function renderActivity() {
    const panel = $('activity-panel');
    if (!panel) return;
    panel.replaceChildren(h('h3', 'panel-title', 'Recent changes'));
    panel.appendChild(h('p', 'body-text secondary-text small',
        `What changed in your prints, spools and queue, newest first, including edits, imports and undos. Kept in this browser only, the last ${MAX_ENTRIES} changes. Settings, AMS and upkeep are not logged.`));
    const entries = readLog();
    if (entries.length === 0) {
        const none = h('p', 'body-text activity-empty', 'Nothing yet. Changes you make from now on will show up here.');
        panel.appendChild(none);
        return;
    }
    const list = h('ul', 'activity-list');
    list.id = 'activity-list';
    for (const e of entries.slice(0, MAX_LISTED)) {
        const when = new Date(e.at);
        const li = h('li', 'activity-item');
        li.appendChild(h('span', 'activity-text', e.text));
        li.appendChild(h('span', 'activity-time secondary-text small', Number.isNaN(when.getTime()) ? '' : when.toLocaleString()));
        list.appendChild(li);
    }
    panel.appendChild(list);
    if (entries.length > MAX_LISTED) panel.appendChild(h('p', 'secondary-text small', `Showing the latest ${MAX_LISTED} of ${entries.length}.`));
    const clear = h('button', 'btn btn-outline btn-small', 'Clear log');
    clear.type = 'button';
    clear.id = 'activity-clear';
    clear.addEventListener('click', () => { writeLog([]); renderActivity(); });
    panel.appendChild(clear);
}

onSave(recordChanges);
