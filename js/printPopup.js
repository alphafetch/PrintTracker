import { amsLoadedList, amsSlotLabel } from './ams.js';
import { activeSpools, gramsUsedOfSpool, remainingOf, usageOf } from './calc.js';
import { FAIL_REASONS } from './constants.js';
import { renderAll } from './render.js';
import { spoolPopup } from './spoolPopup.js';
import { cleanFailReason, cleanProfile, saveState, state } from './state.js';
import { $, clearError, fmtGrams, h, isObject, isValidDate, makeSwatch, normalizeLink, notify, showError, spoolHex, todayLocal, uid, validMinutes } from './util.js';

// ---------- Print popup (create and edit) ----------

export const printPopup = $('print-popup');
export const printPopupTitle = $('print-popup-title');
export const nameInput = $('name-tinput');
export const printDateInput = $('date-tinput');
export const linkInput = $('link-tinput');
export const hoursInput = $('hours-ninput');
export const minutesInput = $('minutes-ninput');
export const notesInput = $('notes-input');
export const resultSuccess = $('result-rinput1');
export const resultFailure = $('result-rinput2');
export const failField = $('fail-reason-field');
export const failSelect = $('fail-reason-select');
export const profileInputs = {
    name: $('profile-name-tinput'),
    layer: $('profile-layer-tinput'),
    infill: $('profile-infill-tinput'),
    supports: $('profile-supports-tinput')
};
export const rowList = $('filament-row-list');
export const rowTemplate = $('filament-row-template');
export const addRowButton = $('add-filament-row-button');
export const printError = $('print-error');
export const savePrintButton = $('add-print-button');
export const cancelPrintButton = $('cancel-print-button');

// "Why did it fail?" options
failSelect.appendChild(Object.assign(h('option', 'option-input', 'Not sure / not set'), { value: '' }));
for (const [key, label] of FAIL_REASONS) failSelect.appendChild(Object.assign(h('option', 'option-input', label), { value: key }));

/** The reason picker only makes sense for failed prints. */
export function syncFailField() {
    failField.hidden = !resultFailure.checked;
}
resultSuccess.addEventListener('change', syncFailField);
resultFailure.addEventListener('change', syncFailField);

export let editingPrintId = null;   // null means "create a new print"
export let pendingQueueId = null;   // queue item to mark done once the print is saved

export function updateBodyLock() {
    const open = printPopup.style.display === 'block' || spoolPopup.style.display === 'block';
    document.body.classList.toggle('modal-open', open);
}

/**
 * Open the print popup.
 *   printId     edit this print
 *   copyFromId  start a new print pre-filled from an existing one ("Print again")
 *   name, link  pre-fill for a new print (used by the queue)
 *   queueId     queue item to tick off after saving
 */
export function openPrintPopup({ printId = null, copyFromId = null, name = '', link = '', queueId = null } = {}) {
    if (!printId && activeSpools().length === 0) {
        notify('Add a filament spool first (Filament tab).', true);
        return;
    }

    editingPrintId = printId;
    pendingQueueId = queueId;
    const print = printId ? state.prints[printId] : null;
    const source = print || (copyFromId ? state.prints[copyFromId] : null);

    printPopupTitle.textContent = print ? 'Edit Print' : 'Create Print';
    savePrintButton.textContent = print ? 'Save Changes' : 'Create Print';

    nameInput.value = source ? (source.name || '') : name;
    printDateInput.value = print && isValidDate(print.date) ? print.date : todayLocal();
    linkInput.value = source ? (source.link || '') : link;
    if (print && !print.result) {
        resultFailure.checked = true;
    } else {
        resultSuccess.checked = true;
    }

    const minutes = source ? validMinutes(Number(source.minutes)) : null;
    hoursInput.value = minutes ? String(Math.floor(minutes / 60)) : '';
    minutesInput.value = minutes ? String(minutes % 60) : '';
    notesInput.value = source && typeof source.notes === 'string' ? source.notes : '';
    failSelect.value = print && !print.result ? cleanFailReason(print.failReason, false) : '';
    const profile = source ? cleanProfile(source.profile) : null;   // "Print again" keeps the profile
    for (const key of Object.keys(profileInputs)) profileInputs[key].value = profile ? profile[key] : '';
    syncFailField();

    rowList.replaceChildren();
    let usage = source ? usageOf(source) : [];
    if (!print) usage = usage.filter((u) => isObject(state.spools[u.spoolId]));   // a copy should not carry deleted spools
    if (usage.length > 0) {
        for (const u of usage) addFilamentRow({ spoolId: u.spoolId, grams: u.grams });
    } else {
        addFilamentRow();
    }

    renderAmsQuick();
    clearError(printError);
    printPopup.style.display = 'block';
    printPopup.scrollTop = 0;
    updateBodyLock();
    nameInput.focus();
}

export function closePrintPopup() {
    printPopup.style.display = 'none';
    editingPrintId = null;
    pendingQueueId = null;
    updateBodyLock();
}

export function spoolLabel(id, spool) {
    const left = remainingOf(id, spool);
    const material = String(spool.material || 'other').toUpperCase();
    const slot = amsSlotLabel(id);
    return `${spool.brand}, ${spool.color}: ${material} (~${fmtGrams(left)}g left)${slot ? ` [${slot}]` : ''}${spool.archived ? ' [archived]' : ''}`;
}

/** Fill a <select> with the active spools (plus the selected one even if archived or deleted). */
export function fillSpoolSelect(select, selectedId) {
    select.replaceChildren();
    for (const [id, spool] of Object.entries(state.spools)) {
        if (!isObject(spool)) continue;
        if (spool.archived && id !== selectedId) continue;
        const option = h('option', 'option-input', spoolLabel(id, spool));
        option.value = id;
        option.selected = id === selectedId;
        select.appendChild(option);
    }
    if (selectedId && !state.spools[selectedId]) {
        const option = h('option', 'option-input', 'Deleted spool');
        option.value = selectedId;
        option.selected = true;
        select.appendChild(option);
    }
}

export function firstUnusedSpoolId() {
    const inUse = new Set(Array.from(rowList.querySelectorAll('select'), (s) => s.value));
    const active = activeSpools();
    // Spools loaded in an AMS come first, since that is what you most likely just printed with.
    const loaded = new Set(amsLoadedList().map((l) => l.spoolId));
    const ordered = [...active.filter(([id]) => loaded.has(id)), ...active.filter(([id]) => !loaded.has(id))];
    const free = ordered.find(([id]) => !inUse.has(id));
    return (free || ordered[0] || [null])[0];
}

export function addFilamentRow({ spoolId = null, grams = '' } = {}) {
    const fragment = rowTemplate.content.cloneNode(true);
    const row = fragment.querySelector('.filament-row');
    const select = row.querySelector('select');
    const gramsInput = row.querySelector('input');
    const removeButton = row.querySelector('.row-remove-button');

    fillSpoolSelect(select, spoolId || firstUnusedSpoolId());
    if (grams !== '') gramsInput.value = grams;

    select.addEventListener('change', () => updateRowHint(row));
    gramsInput.addEventListener('input', () => updateRowHint(row));
    removeButton.addEventListener('click', () => {
        row.remove();
        updateRowControls();
    });

    rowList.appendChild(fragment);
    updateRowHint(row);
    updateRowControls();
}

/** Chips for the spools loaded in the AMS: one click adds (or selects) that spool as a filament row. */
export function renderAmsQuick() {
    const box = document.getElementById('ams-quick');
    box.replaceChildren();
    const loaded = amsLoadedList();
    box.hidden = loaded.length === 0;
    if (loaded.length === 0) return;
    box.appendChild(h('span', 'ams-quick-label', 'Loaded in your AMS:'));
    const chips = h('div', 'chips ams-quick-chips');
    for (const { spoolId, label } of loaded) {
        const s = state.spools[spoolId];
        const chip = h('button', 'chip chip-button');
        chip.type = 'button';
        chip.dataset.spool = spoolId;
        chip.appendChild(makeSwatch(spoolHex(s)));
        chip.append(` ${s.brand} ${s.color} \u00B7 ${label}`);
        chip.addEventListener('click', () => addAmsRow(spoolId));
        chips.appendChild(chip);
    }
    box.appendChild(chips);
}

/** Use this spool: fill the first empty row, otherwise add a row, unless it is already there. */
export function addAmsRow(spoolId) {
    const rows = Array.from(rowList.querySelectorAll('.filament-row'));
    const existing = rows.find((r) => r.querySelector('select').value === spoolId);
    if (existing) { existing.querySelector('input').focus(); return; }
    const blank = rows.find((r) => r.querySelector('input').value.trim() === '');
    if (blank) {
        fillSpoolSelect(blank.querySelector('select'), spoolId);
        updateRowHint(blank);
        blank.querySelector('input').focus();
        return;
    }
    addFilamentRow({ spoolId });
    rowList.querySelector('.filament-row:last-child input').focus();
}

export function updateRowControls() {
    const rows = rowList.querySelectorAll('.filament-row');
    rows.forEach((row) => {
        row.querySelector('.row-remove-button').hidden = rows.length === 1;
    });
    addRowButton.disabled = rows.length >= activeSpools().length;
}

/** Non-blocking warning when a row uses more grams than the spool has left. */
export function updateRowHint(row) {
    const select = row.querySelector('select');
    const hint = row.querySelector('.row-hint');
    const grams = row.querySelector('input').valueAsNumber;
    const spool = state.spools[select.value];

    if (spool && Number.isFinite(grams) && grams > 0) {
        const left = (Number(spool.startGrams) || 0) - gramsUsedOfSpool(select.value, editingPrintId);
        if (grams > left) {
            hint.textContent = `Heads up: only ~${fmtGrams(Math.max(left, 0))}g left on this spool. You can still save.`;
            hint.hidden = false;
            return;
        }
    }
    hint.hidden = true;
}

export function readDuration() {
    const hText = hoursInput.value.trim();
    const mText = minutesInput.value.trim();
    if (hText === '' && mText === '') return { minutes: null };

    const hrs = hText === '' ? 0 : hoursInput.valueAsNumber;
    const mins = mText === '' ? 0 : minutesInput.valueAsNumber;
    if (!Number.isInteger(hrs) || !Number.isInteger(mins) || hrs < 0 || mins < 0 || hrs > 9999 || mins > 59) {
        return { error: 'Print time: use whole hours (0 or more) and minutes between 0 and 59.' };
    }
    const total = hrs * 60 + mins;
    return { minutes: total > 0 ? total : null };
}

export function savePrint() {
    const name = nameInput.value.trim();
    const date = printDateInput.value;
    const link = normalizeLink(linkInput.value);

    if (name === '') return showError(printError, 'Give the print a name.');
    if (!isValidDate(date)) return showError(printError, 'Pick a valid date.');
    if (link === null) return showError(printError, 'The link must be a valid http:// or https:// address.');

    const duration = readDuration();
    if (duration.error) return showError(printError, duration.error);

    const usage = [];
    const seen = new Set();
    const rows = Array.from(rowList.querySelectorAll('.filament-row'));
    for (let i = 0; i < rows.length; i++) {
        const spoolId = rows[i].querySelector('select').value;
        const grams = rows[i].querySelector('input').valueAsNumber;
        if (!spoolId) return showError(printError, `Filament row ${i + 1}: choose a spool.`);
        if (!Number.isFinite(grams) || grams <= 0) {
            return showError(printError, `Filament row ${i + 1}: enter a number of grams above 0.`);
        }
        if (seen.has(spoolId)) {
            return showError(printError, 'Each spool can only appear once per print. Combine the grams into one row.');
        }
        seen.add(spoolId);
        usage.push({ spoolId, grams: Math.round(grams * 100) / 100 });
    }
    if (usage.length === 0) return showError(printError, 'Add at least one filament.');

    const record = {
        name, date, result: resultSuccess.checked, link, usage,
        minutes: duration.minutes,
        notes: notesInput.value.trim().slice(0, 500),
        failReason: resultSuccess.checked ? '' : cleanFailReason(failSelect.value, false),
        profile: cleanProfile({
            name: profileInputs.name.value, layer: profileInputs.layer.value,
            infill: profileInputs.infill.value, supports: profileInputs.supports.value
        })
    };
    if (editingPrintId && state.prints[editingPrintId]) {
        state.prints[editingPrintId] = record;
    } else {
        state.prints[uid()] = record;
    }
    if (pendingQueueId && state.queue[pendingQueueId]) {
        state.queue[pendingQueueId].done = true;
    }

    saveState();
    closePrintPopup();
    renderAll();
    return true;
}

savePrintButton.addEventListener('click', savePrint);
cancelPrintButton.addEventListener('click', closePrintPopup);
addRowButton.addEventListener('click', () => addFilamentRow());
