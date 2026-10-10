import { tagKey, tagTotals, tagsOf } from './calc.js';
import { downloadBlob, buildPrintsCsv } from './data.js';
import { renderAll } from './render.js';
import { takeSnapshot } from './snapshots.js';
import { cleanTags, saveState, state } from './state.js';
import { $, h, isObject, notify, todayLocal } from './util.js';

// ---------- Select several prints: tag, untag, export or delete them together ----------

let selecting = false;
const selected = new Set();
let visible = [];   // ids of the prints that match the current search and filters, in order
let bar = null;
let toggle = null;
let countEl = null;
let tagInput = null;
let tagList = null;
const actionButtons = [];

export const isSelecting = () => selecting;
export const isSelected = (id) => selected.has(id);
export const selectedIds = () => Array.from(selected);

export function toggleSelected(id, on) {
    if (on) selected.add(id);
    else selected.delete(id);
    updateBulkBar();
}

/** Called after every render of the prints list. Anything selected that is no longer shown is dropped,
 * so a bulk action never touches prints you cannot see. */
export function setVisible(ids) {
    visible = ids;
    const shown = new Set(ids);
    for (const id of Array.from(selected)) if (!shown.has(id) || !isObject(state.prints[id])) selected.delete(id);
    if (Object.keys(state.prints).length === 0) selecting = false;
    updateBulkBar();
}

export function setSelecting(on) {
    selecting = Boolean(on);
    if (!selecting) selected.clear();
    renderAll();
    if (selecting) $('bulk-all').focus();
    else toggle.focus();
}

export function selectAllShown() {
    for (const id of visible) selected.add(id);
    renderAll();
}

export function clearSelection() {
    selected.clear();
    renderAll();
}

const count = (n) => `${n} print${n === 1 ? '' : 's'}`;

/** Refresh the bar: shown only while selecting, counts, and which buttons work. */
export function updateBulkBar() {
    if (!bar) return;
    const hasPrints = Object.keys(state.prints).length > 0;
    toggle.hidden = !hasPrints;
    toggle.setAttribute('aria-pressed', String(selecting));
    toggle.textContent = selecting ? 'Stop selecting' : 'Select';
    bar.hidden = !selecting;
    if (!selecting) return;
    const n = selected.size;
    countEl.textContent = n === 0 ? 'None selected' : `${n} of ${visible.length} shown selected`;
    for (const b of actionButtons) b.disabled = n === 0;
    $('bulk-all').disabled = visible.length === 0 || n === visible.length;

    tagList.replaceChildren();
    for (const t of tagTotals()) {
        const o = document.createElement('option');
        o.value = t.tag;
        tagList.appendChild(o);
    }
    // keep the card highlight in step
    for (const card of document.querySelectorAll('#print-list .print-card')) {
        card.classList.toggle('is-selected', selected.has(card.dataset.id));
    }
}

/** Add (or remove) tags on every selected print, with Undo. */
export function bulkTag(add) {
    const tags = cleanTags(tagInput.value);
    if (tags.length === 0) {
        notify('Type a tag first.', true);
        tagInput.focus();
        return;
    }
    const keys = new Set(tags.map(tagKey));
    const before = new Map();
    for (const id of selected) {
        const p = state.prints[id];
        if (!isObject(p)) continue;
        const old = tagsOf(p);
        const next = add ? cleanTags([...old, ...tags]) : old.filter((t) => !keys.has(tagKey(t)));
        if (JSON.stringify(next) === JSON.stringify(old)) continue;
        before.set(id, old);
        p.tags = next;
    }
    const label = tags.map((t) => `"${t}"`).join(', ');
    if (before.size === 0) {
        notify(add ? `Nothing to change: those prints already have ${label}, or have no room for more tags.` : `Nothing to change: none of those prints have ${label}.`);
        return;
    }
    saveState();
    renderAll();
    tagInput.value = '';
    notify(`${add ? 'Added' : 'Removed'} ${label} ${add ? 'to' : 'from'} ${count(before.size)}.`, {
        action: {
            label: 'Undo',
            onClick: () => {
                for (const [id, old] of before) if (state.prints[id]) state.prints[id].tags = old;
                saveState();
                renderAll();
            }
        }
    });
}

export function bulkExport() {
    const ids = new Set(selected);
    if (ids.size === 0) return;
    downloadBlob(new Blob(['﻿' + buildPrintsCsv(ids)], { type: 'text/csv;charset=utf-8' }),
        `print-tracker-selected-${todayLocal()}.csv`);
    notify(`Exported ${count(ids.size)} as a CSV file.`);
}

export function bulkDelete() {
    const removed = [];
    for (const id of selected) {
        if (isObject(state.prints[id])) removed.push([id, state.prints[id]]);
    }
    if (removed.length === 0) return;
    takeSnapshot(`Before deleting ${count(removed.length)}`);
    for (const [id] of removed) delete state.prints[id];
    selected.clear();
    saveState();
    renderAll();
    notify(`Deleted ${count(removed.length)}.`, {
        action: {
            label: 'Undo',
            onClick: () => {
                for (const [id, p] of removed) state.prints[id] = p;
                saveState();
                renderAll();
            }
        }
    });
}

function button(text, id, className, onClick) {
    const b = h('button', className, text);
    b.type = 'button';
    b.id = id;
    b.addEventListener('click', onClick);
    return b;
}

/** Build the toggle button and the bar. Called once at startup. */
export function setupBulk() {
    toggle = button('Select', 'select-button', 'btn btn-outline', () => setSelecting(!selecting));
    toggle.title = 'Pick several prints to tag, export or delete together';
    toggle.setAttribute('aria-pressed', 'false');
    $('prints-actions').prepend(toggle);

    bar = h('div', 'bulk-bar');
    bar.id = 'bulk-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Actions for the selected prints');
    bar.hidden = true;

    const top = h('div', 'bulk-row');
    countEl = h('span', 'bulk-count');
    countEl.id = 'bulk-count';
    countEl.setAttribute('role', 'status');
    top.appendChild(countEl);
    top.appendChild(button('Select all shown', 'bulk-all', 'btn btn-outline btn-small', selectAllShown));
    const none = button('Clear', 'bulk-none', 'btn btn-outline btn-small', clearSelection);
    top.appendChild(none);
    actionButtons.push(none);
    top.appendChild(button('Done', 'bulk-done', 'btn btn-outline btn-small', () => setSelecting(false)));
    bar.appendChild(top);

    const tagRow = h('div', 'bulk-row');
    tagInput = h('input', 'text-input bulk-tag');
    tagInput.type = 'text';
    tagInput.id = 'bulk-tag';
    tagInput.maxLength = 100;
    tagInput.spellcheck = false;
    tagInput.autocomplete = 'off';
    tagInput.placeholder = 'Tag, e.g., gift';
    tagInput.setAttribute('aria-label', 'Tag to add or remove');
    tagList = h('datalist');
    tagList.id = 'bulk-tag-list';
    tagInput.setAttribute('list', 'bulk-tag-list');
    tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bulkTag(true); } });
    tagRow.append(tagInput, tagList);
    for (const [text, id, add] of [['Add tag', 'bulk-add-tag', true], ['Remove tag', 'bulk-remove-tag', false]]) {
        const b = button(text, id, 'btn btn-outline btn-small', () => bulkTag(add));
        actionButtons.push(b);
        tagRow.appendChild(b);
    }
    const exp = button('Export CSV', 'bulk-export', 'btn btn-outline btn-small', bulkExport);
    const del = button('Delete', 'bulk-delete', 'btn btn-danger-ghost btn-small', bulkDelete);
    actionButtons.push(exp, del);
    tagRow.append(exp, del);
    bar.appendChild(tagRow);

    $('prints-toolbar').after(bar);
}
