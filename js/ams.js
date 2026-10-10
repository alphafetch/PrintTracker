import { remainingOf, lowFraction } from './calc.js';
import { AMS_TYPES } from './catalog.js';
import { renderAll } from './render.js';
import { saveState, state } from './state.js';
import { $, cleanText, fmtGrams, h, icon, isObject, makeSwatch, notify, spoolHex, uid } from './util.js';

// ---------- AMS (Bambu Lab Automatic Material System) ----------

export const amsRoot = $('ams');

/** Spool ids currently loaded in any AMS slot. */
export function loadedSpoolIds() {
    const ids = new Set();
    for (const unit of Object.values(state.ams)) for (const id of unit.slots) if (id) ids.add(id);
    return ids;
}

/** Take a spool out of every AMS slot (used when it is archived or deleted). */
export function unloadSpool(spoolId) {
    for (const u of Object.values(state.ams)) u.slots = u.slots.map((id) => (id === spoolId ? '' : id));
}

/** Where a spool is loaded: [{ unitId, index }]. Used to put it back after an undo. */
export function slotsHolding(spoolId) {
    const out = [];
    for (const [unitId, u] of Object.entries(state.ams)) {
        u.slots.forEach((id, index) => { if (id === spoolId) out.push({ unitId, index }); });
    }
    return out;
}

/** Put a spool back into the slots it came from (only if they are still empty). */
export function restoreSlots(spoolId, places) {
    for (const { unitId, index } of places) {
        const u = state.ams[unitId];
        if (u && u.slots[index] === '') u.slots[index] = spoolId;
    }
}

/** "AMS 1, slot 2" for a loaded spool, or '' when it is not in an AMS. */
export function amsSlotLabel(spoolId) {
    for (const u of Object.values(state.ams)) {
        const i = u.slots.indexOf(spoolId);
        if (i !== -1) return u.slots.length === 1 ? u.name : `${u.name}, slot ${i + 1}`;
    }
    return '';
}

/** Loaded spools in slot order: [{ spoolId, label }] (active spools only). */
export function amsLoadedList() {
    const out = [];
    for (const u of Object.values(state.ams)) {
        u.slots.forEach((id, i) => {
            if (id && state.spools[id] && !state.spools[id].archived) out.push({ spoolId: id, label: u.slots.length === 1 ? u.name : `${u.name}, slot ${i + 1}` });
        });
    }
    return out;
}

export function addAmsUnit(type, customName = '') {
    const info = AMS_TYPES.find((t) => t.key === type);
    if (!info) return;
    const count = Object.values(state.ams).filter((u) => u.type === type).length + 1;
    state.ams[uid()] = { name: cleanText(customName, 30) || `${info.label} ${count}`, type, slots: Array(info.slots).fill(''), price: null };
    saveState();
    renderAll();
}

export function setAmsSlot(unitId, index, spoolId) {
    const unit = state.ams[unitId];
    if (!unit || index < 0 || index >= unit.slots.length) return;
    // A spool can only sit in one slot at a time.
    if (spoolId) {
        for (const u of Object.values(state.ams)) u.slots = u.slots.map((id) => (id === spoolId ? '' : id));
    }
    unit.slots[index] = spoolId && state.spools[spoolId] ? spoolId : '';
    saveState();
    renderAll();
}

export function renameAmsUnit(unitId, name) {
    const unit = state.ams[unitId];
    const clean = cleanText(name, 30);
    if (!unit || clean === '' || clean === unit.name) return false;
    unit.name = clean;
    saveState();
    renderAll();
    return true;
}

export function removeAmsUnit(unitId) {
    const removed = state.ams[unitId];
    if (!removed) return;
    delete state.ams[unitId];
    saveState();
    renderAll();
    notify(`Removed "${removed.name}".`, {
        action: { label: 'Undo', onClick: () => { state.ams[unitId] = removed; saveState(); renderAll(); } }
    });
}

function buildSlot(unitId, unit, index) {
    const spoolId = unit.slots[index];
    const spool = spoolId ? state.spools[spoolId] : null;
    const slot = h('div', spool ? 'ams-slot is-loaded' : 'ams-slot');
    slot.dataset.slot = String(index + 1);
    slot.appendChild(h('span', 'ams-slot-label', unit.slots.length === 1 ? 'Slot' : `Slot ${index + 1}`));

    if (spool) {
        const left = Math.max(0, remainingOf(spoolId, spool));
        const frac = Number(spool.startGrams) > 0 ? Math.min(1, left / spool.startGrams) : 0;
        const row = h('div', 'ams-spool');
        row.appendChild(makeSwatch(spoolHex(spool)));
        const text = h('div', 'ams-spool-text');
        text.appendChild(h('span', 'list-title', `${spool.brand}, ${spool.color}`));
        text.appendChild(h('span', 'list-sub', `${String(spool.material).toUpperCase()} · ${fmtGrams(left)}g left${frac <= lowFraction() ? ' · running low' : ''}`));
        row.appendChild(text);
        slot.appendChild(row);
        const bar = h('div', 'bar bar-thin');
        const fill = h('div', frac <= lowFraction() ? 'bar-fill warn' : 'bar-fill');
        fill.style.width = Math.round(frac * 100) + '%';
        bar.appendChild(fill);
        slot.appendChild(bar);
    } else {
        slot.appendChild(h('span', 'list-sub', 'Empty'));
    }

    const select = h('select', 'dropdown ams-select');
    select.setAttribute('aria-label', `Spool in ${unit.name}, slot ${index + 1}`);
    const none = h('option', null, 'Empty');
    none.value = '';
    select.appendChild(none);
    const elsewhere = loadedSpoolIds();
    for (const [id, s] of Object.entries(state.spools)) {
        if (!isObject(s) || s.archived) continue;
        if (elsewhere.has(id) && id !== spoolId) continue;
        const o = h('option', null, `${s.brand}, ${s.color}`);
        o.value = id;
        select.appendChild(o);
    }
    select.value = spoolId || '';
    select.addEventListener('change', () => setAmsSlot(unitId, index, select.value));
    slot.appendChild(select);
    return slot;
}

export function renderAms() {
    amsRoot.replaceChildren();
    const head = h('div', 'ams-head');
    const titles = h('div');
    titles.appendChild(h('h3', 'panel-title ams-title', 'AMS'));
    titles.appendChild(h('p', 'secondary-text small', 'Which spool is loaded in each slot of your Automatic Material System.'));
    head.appendChild(titles);

    const add = h('div', 'ams-add');
    const nameBox = h('input', 'text-input ams-name-new');
    nameBox.type = 'text';
    nameBox.id = 'ams-name';
    nameBox.maxLength = 30;
    nameBox.placeholder = 'Name (optional)';
    nameBox.setAttribute('aria-label', 'Name for the new AMS');
    nameBox.spellcheck = false;
    const type = h('select', 'dropdown');
    type.id = 'ams-type';
    type.setAttribute('aria-label', 'AMS type');
    for (const t of AMS_TYPES) {
        const o = h('option', null, `${t.label} (${t.slots} ${t.slots === 1 ? 'slot' : 'slots'})`);
        o.value = t.key;
        type.appendChild(o);
    }
    const button = h('button', 'btn btn-outline btn-small');
    button.type = 'button';
    button.id = 'ams-add-button';
    button.appendChild(icon('plus'));
    button.appendChild(h('span', 'btn-text', 'Add AMS'));
    button.addEventListener('click', () => addAmsUnit(type.value, nameBox.value));
    nameBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') addAmsUnit(type.value, nameBox.value); });
    add.append(nameBox, type, button);
    head.appendChild(add);
    amsRoot.appendChild(head);

    const units = Object.entries(state.ams);
    if (units.length === 0) {
        amsRoot.appendChild(h('p', 'secondary-text small ams-empty', 'No AMS added. Skip this if you load spools straight onto the printer.'));
        return;
    }
    const grid = h('div', 'ams-units');
    for (const [id, unit] of units) {
        const card = h('div', 'panel ams-unit');
        card.dataset.id = id;
        const top = h('div', 'ams-unit-top');
        const info = AMS_TYPES.find((t) => t.key === unit.type);
        const nameInput = h('input', 'ams-unit-name');
        nameInput.type = 'text';
        nameInput.maxLength = 30;
        nameInput.value = unit.name;
        nameInput.id = 'ams-rename-' + id;
        nameInput.spellcheck = false;
        nameInput.title = 'Click to rename';
        nameInput.setAttribute('aria-label', 'AMS name');
        nameInput.addEventListener('change', () => { if (!renameAmsUnit(id, nameInput.value)) nameInput.value = unit.name; });
        nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); else if (e.key === 'Escape') { e.stopPropagation(); nameInput.value = unit.name; nameInput.blur(); } });
        top.appendChild(nameInput);
        top.appendChild(h('span', 'chip chip-mini', info ? info.label : unit.type));
        const del = h('button', 'btn btn-danger-ghost btn-small', 'Remove');
        del.type = 'button';
        del.addEventListener('click', () => removeAmsUnit(id));
        top.appendChild(del);
        card.appendChild(top);
        const slots = h('div', unit.slots.length === 1 ? 'ams-slots one' : 'ams-slots');
        unit.slots.forEach((_, i) => slots.appendChild(buildSlot(id, unit, i)));
        card.appendChild(slots);
        grid.appendChild(card);
    }
    amsRoot.appendChild(grid);
}
