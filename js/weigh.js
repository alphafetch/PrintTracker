import { adjustOf, gramsUsedOfSpool, remainingOf } from './calc.js';
import { updateBodyLock } from './printPopup.js';
import { renderAll } from './render.js';
import { saveState, state } from './state.js';
import { $, clearError, fmtGrams, h, notify, showError, todayLocal } from './util.js';

// ---------- Re-weigh a spool: correct the grams left using a kitchen scale ----------

let popup = null;
let grossEl = null;
let emptyEl = null;
let previewEl = null;
let errorEl = null;
let weighId = null;
let weighReturn = null;

/** Empty-spool weight to suggest: this spool's saved one, else the most recent one saved on any spool. */
export function suggestedEmptyGrams(id) {
    const own = Number(state.spools[id] && state.spools[id].emptyGrams);
    if (own > 0) return own;
    let latest = null;
    for (const s of Object.values(state.spools)) {
        if (Number(s.emptyGrams) > 0 && (!latest || String(s.weighedDate || '') >= String(latest.weighedDate || ''))) latest = s;
    }
    return latest ? Number(latest.emptyGrams) : null;
}

/**
 * What a scale reading means for a spool.
 * gross = spool + filament on the scale, empty = the bare spool.
 * Returns { actual, logged, diff } in grams, or null when the numbers do not make sense.
 */
export function weighResult(id, gross, empty) {
    const spool = state.spools[id];
    if (!spool || !Number.isFinite(gross) || !Number.isFinite(empty) || gross < 0 || empty < 0 || gross < empty) return null;
    const actual = gross - empty;
    const logged = remainingOf(id, spool);
    return { actual, logged, diff: actual - logged };
}

/** Save the scale reading. The correction is kept as a number of grams, so later prints still subtract from it. */
export function applyWeigh(id, gross, empty) {
    const spool = state.spools[id];
    const result = weighResult(id, gross, empty);
    if (!spool || !result) return false;
    const before = { adjust: spool.adjust, emptyGrams: spool.emptyGrams, weighedDate: spool.weighedDate };
    spool.adjust = adjustOf(spool) + result.diff;
    spool.emptyGrams = empty;
    spool.weighedDate = todayLocal();
    saveState();
    renderAll();
    notify(`${spool.brand}, ${spool.color}: set to ${fmtGrams(result.actual)}g left.`, {
        action: {
            label: 'Undo',
            onClick: () => {
                if (!state.spools[id]) return;
                for (const [k, v] of Object.entries(before)) {
                    if (v === undefined) delete state.spools[id][k];
                    else state.spools[id][k] = v;
                }
                saveState();
                renderAll();
            }
        }
    });
    return true;
}

function field(labelText, input, id) {
    const wrap = h('div', 'field');
    const label = h('label', null, labelText);
    label.htmlFor = id;
    wrap.append(label, input);
    return wrap;
}

function numberInput(id, placeholder) {
    const el = h('input', 'number-input');
    el.type = 'number';
    el.id = id;
    el.min = '0';
    el.step = '0.1';
    el.placeholder = placeholder;
    el.inputMode = 'decimal';
    return el;
}

export function renderWeighPreview() {
    if (!popup) return;
    const gross = grossEl.valueAsNumber;
    const empty = emptyEl.valueAsNumber;
    clearError(errorEl);
    if (!Number.isFinite(gross) || !Number.isFinite(empty)) {
        previewEl.textContent = 'Enter the scale reading and the empty spool weight to see the result.';
        return;
    }
    const result = weighResult(weighId, gross, empty);
    if (!result) {
        previewEl.textContent = gross < empty ? 'The scale reading is less than the empty spool. Check both numbers.' : 'Enter valid weights.';
        return;
    }
    const d = result.diff;
    const verdict = Math.abs(d) < 0.5 ? 'That matches the log.'
        : d > 0 ? `That is ${fmtGrams(d)}g more than the log says.` : `That is ${fmtGrams(-d)}g less than the log says.`;
    previewEl.textContent = `Filament on the spool: ${fmtGrams(result.actual)}g. The log says ${fmtGrams(Math.max(0, result.logged))}g. ${verdict}`;
}

function save() {
    const gross = grossEl.valueAsNumber;
    const empty = emptyEl.valueAsNumber;
    if (!Number.isFinite(gross) || gross <= 0) return showError(errorEl, 'Enter what the scale shows with the spool on it.');
    if (!Number.isFinite(empty) || empty < 0) return showError(errorEl, 'Enter the weight of the empty spool (0 or more).');
    if (gross < empty) return showError(errorEl, 'The scale reading cannot be less than the empty spool.');
    const id = weighId;
    closeWeighPopup();
    return applyWeigh(id, gross, empty);
}

function buildPopup() {
    popup = h('div', 'popup');
    popup.id = 'weigh-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-labelledby', 'weigh-popup-title');
    const content = h('div', 'popup-content weigh-popup-content');
    const title = h('h3', 'popup-title', 'Re-weigh spool');
    title.id = 'weigh-popup-title';
    content.appendChild(title);
    content.appendChild(h('p', 'secondary-text small', 'Put the spool on a scale and enter what it shows. The app works out the filament left and corrects its count. Prints you log afterwards still subtract from it.'));
    const sub = h('p', 'weigh-spool');
    sub.id = 'weigh-spool';
    content.appendChild(sub);

    grossEl = numberInput('weigh-gross', 'e.g., 612');
    emptyEl = numberInput('weigh-empty', 'e.g., 250');
    const row = h('div', 'field-row');
    row.append(field('Scale reading (grams)', grossEl, 'weigh-gross'), field('Empty spool (grams)', emptyEl, 'weigh-empty'));
    content.appendChild(row);
    content.appendChild(h('p', 'secondary-text small', 'Empty spool weights vary, usually 150 to 250g for cardboard or plastic. Weigh one once and the app remembers it.'));

    previewEl = h('p', 'weigh-preview');
    previewEl.id = 'weigh-preview';
    previewEl.setAttribute('role', 'status');
    content.appendChild(previewEl);

    errorEl = h('p', 'error-text');
    errorEl.id = 'weigh-error';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    content.appendChild(errorEl);

    const actions = h('div', 'popup-actions');
    const ok = h('button', 'btn btn-primary', 'Save weight');
    ok.type = 'button';
    ok.id = 'weigh-save';
    const cancel = h('button', 'btn btn-outline', 'Cancel');
    cancel.type = 'button';
    cancel.id = 'weigh-cancel';
    actions.append(ok, cancel);
    content.appendChild(actions);
    popup.appendChild(content);
    document.body.appendChild(popup);

    grossEl.addEventListener('input', renderWeighPreview);
    emptyEl.addEventListener('input', renderWeighPreview);
    for (const el of [grossEl, emptyEl]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    ok.addEventListener('click', save);
    cancel.addEventListener('click', closeWeighPopup);
    popup.addEventListener('click', (e) => { if (e.target === popup) closeWeighPopup(); });
}

export function openWeighPopup(id) {
    const spool = state.spools[id];
    if (!spool) return;
    if (!popup) buildPopup();
    weighId = id;
    const used = gramsUsedOfSpool(id);
    $('weigh-spool').textContent = `${spool.brand}, ${spool.color}. The log says about ${fmtGrams(Math.max(0, remainingOf(id, spool)))}g left of ${fmtGrams(Number(spool.startGrams) || 0)}g (${fmtGrams(used)}g logged).`;
    grossEl.value = '';
    const empty = suggestedEmptyGrams(id);
    emptyEl.value = empty ? String(empty) : '';
    renderWeighPreview();
    weighReturn = document.activeElement;
    popup.style.display = 'block';
    popup.scrollTop = 0;
    updateBodyLock();
    grossEl.focus();
}

export function closeWeighPopup() {
    if (!popup) return;
    const wasOpen = popup.style.display === 'block';
    popup.style.display = 'none';
    weighId = null;
    updateBodyLock();
    if (wasOpen && weighReturn && document.contains(weighReturn)) weighReturn.focus();
    weighReturn = null;
}

export function weighPopupOpen() {
    return Boolean(popup) && popup.style.display === 'block';
}

export function weighPopupEl() {
    return popup;
}
