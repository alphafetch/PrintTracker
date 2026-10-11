import { remainingOf } from './calc.js';
import { updateBodyLock } from './printPopup.js';
import { archiveSpool } from './spools.js';
import { state } from './state.js';
import { clearError, fmtGrams, h, showError } from './util.js';

// ---------- Archive a spool: ask how much is really left ----------

let popup = null;
let infoEl = null;
let gramsEl = null;
let errorEl = null;
let leftId = null;
let leftReturn = null;

function confirm_(grams) {
    const id = leftId;
    closeLeftoverPopup();
    archiveSpool(id, grams);
}

function save() {
    const grams = gramsEl.valueAsNumber;
    if (!Number.isFinite(grams) || grams < 0 || grams > 100000) return showError(errorEl, 'Enter the grams left (0 or more).');
    confirm_(grams);
    return true;
}

function buildPopup() {
    popup = h('div', 'popup');
    popup.id = 'leftover-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-labelledby', 'leftover-popup-title');
    const content = h('div', 'popup-content leftover-popup-content');
    const title = h('h3', 'popup-title', 'Archive spool');
    title.id = 'leftover-popup-title';
    content.appendChild(title);
    infoEl = h('p', 'weigh-spool');
    infoEl.id = 'leftover-info';
    content.appendChild(infoEl);
    content.appendChild(h('p', 'secondary-text small', 'How much filament is left on it? The Filament tab adds up leftovers so you can see what is sitting on the shelf. Weigh it if you can (spool weight is usually 150 to 250g).'));

    gramsEl = h('input', 'number-input');
    gramsEl.type = 'number';
    gramsEl.id = 'leftover-grams';
    gramsEl.min = '0';
    gramsEl.step = '0.1';
    gramsEl.inputMode = 'decimal';
    const field = h('div', 'field');
    const label = h('label', null, 'Grams left');
    label.htmlFor = 'leftover-grams';
    field.append(label, gramsEl);
    content.appendChild(field);

    errorEl = h('p', 'error-text');
    errorEl.id = 'leftover-error';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    content.appendChild(errorEl);

    const actions = h('div', 'popup-actions leftover-actions');
    const mk = (text, id, cls, fn) => { const b = h('button', cls, text); b.type = 'button'; b.id = id; b.addEventListener('click', fn); return b; };
    actions.append(
        mk('Archive', 'leftover-save', 'btn btn-primary', save),
        mk('Used up', 'leftover-zero', 'btn btn-outline', () => confirm_(0)),
        mk('Do not record', 'leftover-skip', 'btn btn-outline', () => confirm_(null)),
        mk('Cancel', 'leftover-cancel', 'btn btn-outline', closeLeftoverPopup)
    );
    content.appendChild(actions);
    popup.appendChild(content);
    document.body.appendChild(popup);
    gramsEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    popup.addEventListener('click', (e) => { if (e.target === popup) closeLeftoverPopup(); });
}

export function openLeftoverPopup(id) {
    const spool = state.spools[id];
    if (!spool) return;
    if (!popup) buildPopup();
    leftId = id;
    const left = Math.max(0, remainingOf(id, spool));
    infoEl.textContent = `${spool.brand}, ${spool.color}. The log says about ${fmtGrams(left)}g is left.`;
    gramsEl.value = String(Math.round(left * 10) / 10);
    clearError(errorEl);
    leftReturn = document.activeElement;
    popup.style.display = 'block';
    popup.scrollTop = 0;
    updateBodyLock();
    gramsEl.focus();
    gramsEl.select();
}

export function closeLeftoverPopup() {
    if (!popup) return;
    const was = popup.style.display === 'block';
    popup.style.display = 'none';
    leftId = null;
    updateBodyLock();
    if (was && leftReturn && document.contains(leftReturn)) leftReturn.focus();
    leftReturn = null;
}

export function leftoverPopupOpen() {
    return Boolean(popup) && popup.style.display === 'block';
}

export function leftoverPopupEl() {
    return popup;
}

