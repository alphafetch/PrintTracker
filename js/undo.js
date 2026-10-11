import { diffSnapshots, snapshotOf } from './activity.js';
import { renderAll } from './render.js';
import { normalizeState, onSave, saveState, setState, state } from './state.js';
import { $, h, notify } from './util.js';

// ---------- Undo last change: step back through the last few changes made in this visit ----------
// Each save that changes your data (prints, spools, queue, upkeep, AMS, settings) remembers the data
// as it was just before. Display choices (sort order, theme, filters) are not "changes" and are kept.
// The steps live in memory only, so they are gone when the page is closed or reloaded.

export const MAX_STEPS = 10;
const MAX_CHARS = 20000000;   // together the remembered copies stay under about 20 MB
const KEEP = ['schemaVersion', 'ui', 'theme', 'hideArchived', 'lastExported'];   // not part of "your data"

const dataOf = (s) => {
    const out = {};
    for (const [k, v] of Object.entries(s)) if (!KEEP.includes(k)) out[k] = v;
    return JSON.stringify(out);
};

let current = dataOf(state);
const steps = [];   // { json: the data before the change, label: what the change was }
let restoring = false;

function describe(beforeJson) {
    let lines = [];
    try { lines = diffSnapshots(snapshotOf(JSON.parse(beforeJson)), snapshotOf(state)); } catch (error) { /* fall back to the generic text */ }
    if (lines.length === 0) return 'a change to settings, upkeep or the AMS';
    return lines.length === 1 ? lines[0] : `${lines[0]} and ${lines.length - 1} more`;
}

function trim() {
    while (steps.length > MAX_STEPS) steps.shift();
    let total = steps.reduce((sum, s) => sum + s.json.length, 0);
    while (steps.length > 1 && total > MAX_CHARS) total -= steps.shift().json.length;
}

export const undoSteps = () => steps.length;

/** Called after every save. Remembers the previous data when this save changed it. */
function track() {
    const now = dataOf(state);
    if (now === current) return;
    if (!restoring) {
        steps.push({ json: current, label: describe(current) });
        trim();
    }
    current = now;
    renderUndo();
}

/** Put the given data back, keeping the display choices as they are now. */
function restore(json) {
    restoring = true;
    try {
        const keep = {};
        for (const k of KEEP) keep[k] = state[k];
        setState(normalizeState({ ...JSON.parse(json), ...keep }));
        saveState();
        renderAll();
    } finally {
        restoring = false;
    }
}

export function undoLast() {
    const step = steps.pop();
    if (!step) return;
    const redo = current;
    restore(step.json);
    notify(`Undid: ${step.label}.`, {
        action: {
            label: 'Redo',
            onClick: () => {
                restore(redo);
                steps.push(step);
                renderUndo();
            }
        }
    });
    renderUndo();
}

export function renderUndo() {
    const panel = $('undo-panel');
    if (!panel) return;
    panel.replaceChildren(h('h3', 'panel-title', 'Undo last change'));
    panel.appendChild(h('p', 'body-text secondary-text small',
        `Steps back through your last ${MAX_STEPS} changes to prints, spools, the queue, upkeep, the AMS and settings. It works for edits, deletes, imports and merges. Your sort order, filters and theme stay as they are. Kept in memory only, so it starts empty each time you open the page; use a snapshot or backup to go further back.`));
    const last = steps[steps.length - 1];
    const b = h('button', 'btn btn-outline', last ? 'Undo last change' : 'Nothing to undo yet');
    b.type = 'button';
    b.id = 'undo-last';
    b.disabled = !last;
    b.addEventListener('click', undoLast);
    panel.appendChild(b);
    if (last) {
        const p = h('p', 'body-text undo-detail', `Would undo: ${last.label}. ${steps.length} step${steps.length === 1 ? '' : 's'} available.`);
        p.id = 'undo-detail';
        panel.appendChild(p);
    }
}

onSave(track);
