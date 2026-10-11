import { restoreSlots, slotsHolding, unloadSpool } from './ams.js';
import { renderAll } from './render.js';
import { saveState, state } from './state.js';
import { $, h, isObject, locationOf, notify, todayLocal } from './util.js';

// ---------- Select several spools: move, archive, restore or mark them dried together ----------

const MAX_LOCATION = 40;   // same limit as the "Stored in" box on a spool

let selecting = false;
const selected = new Set();
let visible = [];   // ids of the spools that match the current filters, in order
let bar = null;
let toggle = null;
let countEl = null;
let placeInput = null;
let placeList = null;
const actionButtons = [];

export const isSelectingSpools = () => selecting;
export const isSpoolSelected = (id) => selected.has(id);

export function toggleSpoolSelected(id, on) {
    if (on) selected.add(id);
    else selected.delete(id);
    updateSpoolBar();
}

/** Called after every render of the spool list. Anything selected that is no longer shown is dropped,
 * so a bulk action never touches spools you cannot see. */
export function setVisibleSpools(ids) {
    visible = ids;
    const shown = new Set(ids);
    for (const id of Array.from(selected)) if (!shown.has(id) || !isObject(state.spools[id])) selected.delete(id);
    if (Object.keys(state.spools).length === 0) selecting = false;
    updateSpoolBar();
}

export function setSelectingSpools(on) {
    selecting = Boolean(on);
    if (!selecting) selected.clear();
    renderAll();
    if (selecting) $('spool-bulk-all').focus();
    else toggle.focus();
}

function selectAllShown() {
    for (const id of visible) selected.add(id);
    renderAll();
}

function clearSelection() {
    selected.clear();
    renderAll();
}

const count = (n) => `${n} spool${n === 1 ? '' : 's'}`;

export function updateSpoolBar() {
    if (!bar) return;
    toggle.hidden = Object.keys(state.spools).length === 0;
    toggle.setAttribute('aria-pressed', String(selecting));
    toggle.textContent = selecting ? 'Stop selecting' : 'Select';
    bar.hidden = !selecting;
    if (!selecting) return;
    const n = selected.size;
    countEl.textContent = n === 0 ? 'None selected' : `${n} of ${visible.length} shown selected`;
    for (const b of actionButtons) b.disabled = n === 0;
    $('spool-bulk-all').disabled = visible.length === 0 || n === visible.length;

    placeList.replaceChildren();
    const seen = new Set();
    for (const s of Object.values(state.spools)) {
        const place = isObject(s) ? locationOf(s) : '';
        if (place === '' || seen.has(place.toLowerCase())) continue;
        seen.add(place.toLowerCase());
        const o = document.createElement('option');
        o.value = place;
        placeList.appendChild(o);
    }
    for (const card of document.querySelectorAll('#spools .spool-card')) {
        card.classList.toggle('is-selected', selected.has(card.dataset.id));
    }
}

/**
 * Change the selected spools with one function, then offer Undo.
 * `change(spool, id)` returns true if it changed something. Spools it leaves alone are not counted.
 * Everything a change can touch (the spool itself and its AMS slots) is restored on Undo.
 */
function applyToSelected(change, message, nothing) {
    const before = new Map();
    for (const id of selected) {
        const s = state.spools[id];
        if (!isObject(s)) continue;
        const copy = JSON.parse(JSON.stringify(s));
        const places = slotsHolding(id);
        if (change(s, id)) before.set(id, { copy, places });
    }
    if (before.size === 0) {
        notify(nothing);
        return;
    }
    saveState();
    renderAll();
    notify(message(before.size), {
        action: {
            label: 'Undo',
            onClick: () => {
                for (const [id, { copy, places }] of before) {
                    if (!state.spools[id]) continue;
                    state.spools[id] = copy;
                    restoreSlots(id, places);
                }
                saveState();
                renderAll();
            }
        }
    });
}

export function bulkSetLocation(clear) {
    const place = clear ? '' : placeInput.value.trim().slice(0, MAX_LOCATION);
    if (!clear && place === '') {
        notify('Type where the spools are stored first.', true);
        placeInput.focus();
        return;
    }
    applyToSelected((s) => {
        if (locationOf(s) === place) return false;
        if (place === '') delete s.location;
        else s.location = place;
        return true;
    }, (n) => (clear ? `Cleared the storage place on ${count(n)}.` : `Moved ${count(n)} to "${place}".`),
    clear ? 'Nothing to change: none of those spools have a storage place.' : `Nothing to change: those spools are already stored in "${place}".`);
    if (!clear) placeInput.value = '';
}

export function bulkArchive(archive) {
    applyToSelected((s, id) => {
        if (Boolean(s.archived) === archive) return false;
        s.archived = archive;
        if (archive) unloadSpool(id);   // an archived spool leaves the AMS
        else delete s.leftover;
        return true;
    }, (n) => `${archive ? 'Archived' : 'Restored'} ${count(n)}.`,
    archive ? 'Nothing to archive: those spools are already archived.' : 'Nothing to restore: none of those spools are archived.');
}

export function bulkDried() {
    const today = todayLocal();
    applyToSelected((s) => {
        if (s.archived || s.driedDate === today) return false;
        s.driedDate = today;
        return true;
    }, (n) => `Logged ${count(n)} as dried today.`, 'Nothing to log: those spools are archived or were already dried today.');
}

function button(text, id, className, onClick) {
    const b = h('button', className, text);
    b.type = 'button';
    b.id = id;
    b.addEventListener('click', onClick);
    return b;
}

/** Build the toggle button and the bar. Called once at startup. */
export function setupBulkSpools() {
    toggle = button('Select', 'spool-select-button', 'btn btn-outline', () => setSelectingSpools(!selecting));
    toggle.title = 'Pick several spools to move, archive or log as dried together';
    toggle.setAttribute('aria-pressed', 'false');
    $('fila-actions').prepend(toggle);

    bar = h('div', 'bulk-bar');
    bar.id = 'spool-bulk-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Actions for the selected spools');
    bar.hidden = true;

    const top = h('div', 'bulk-row');
    countEl = h('span', 'bulk-count');
    countEl.id = 'spool-bulk-count';
    countEl.setAttribute('role', 'status');
    top.appendChild(countEl);
    top.appendChild(button('Select all shown', 'spool-bulk-all', 'btn btn-outline btn-small', selectAllShown));
    const none = button('Clear', 'spool-bulk-none', 'btn btn-outline btn-small', clearSelection);
    actionButtons.push(none);
    top.appendChild(none);
    top.appendChild(button('Done', 'spool-bulk-done', 'btn btn-outline btn-small', () => setSelectingSpools(false)));
    bar.appendChild(top);

    const row = h('div', 'bulk-row');
    placeInput = h('input', 'text-input bulk-tag');
    placeInput.type = 'text';
    placeInput.id = 'spool-bulk-place';
    placeInput.maxLength = MAX_LOCATION;
    placeInput.autocomplete = 'off';
    placeInput.placeholder = 'Place, e.g., Dry box 2';
    placeInput.setAttribute('aria-label', 'Storage place for the selected spools');
    placeList = h('datalist');
    placeList.id = 'spool-bulk-place-list';
    placeInput.setAttribute('list', 'spool-bulk-place-list');
    placeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); bulkSetLocation(false); } });
    row.append(placeInput, placeList);
    const defs = [
        ['Move here', 'spool-bulk-move', 'btn btn-outline btn-small', () => bulkSetLocation(false)],
        ['Clear place', 'spool-bulk-unplace', 'btn btn-outline btn-small', () => bulkSetLocation(true)],
        ['Dried today', 'spool-bulk-dried', 'btn btn-outline btn-small', bulkDried],
        ['Archive', 'spool-bulk-archive', 'btn btn-outline btn-small', () => bulkArchive(true)],
        ['Restore', 'spool-bulk-restore', 'btn btn-outline btn-small', () => bulkArchive(false)]
    ];
    for (const [text, id, cls, fn] of defs) {
        const b = button(text, id, cls, fn);
        actionButtons.push(b);
        row.appendChild(b);
    }
    bar.appendChild(row);

    $('fila-toolbar').after(bar);
}
