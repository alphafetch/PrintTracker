import { activeSpools } from './calc.js';
import { updateBodyLock } from './printPopup.js';
import { $, fmtGrams, fmtMoney, formatDate, h, isObject, notify, spoolHex } from './util.js';
import { state } from './state.js';

// ---------- Printable spool labels ----------

export const LABEL_SIZES = [
    ['small', 'Small (63 x 38 mm)'],
    ['medium', 'Medium (90 x 50 mm)']
];

let popup = null;
let listEl = null;
let sheetEl = null;
let sizeEl = null;
let priceBox = null;
let dateBox = null;
let countEl = null;
let labelReturn = null;   // what had focus before the popup opened

/** One label for one spool. All text goes in as text, never as HTML. */
export function buildLabel(spool, { price = true, date = true } = {}) {
    const label = h('div', 'spool-label');
    const swatch = h('span', 'label-swatch');
    swatch.style.background = spoolHex(spool);
    label.appendChild(swatch);
    const body = h('div', 'label-body');
    body.appendChild(h('strong', 'label-brand', String(spool.brand || '')));
    body.appendChild(h('span', 'label-color', `${spool.color} · ${String(spool.material || 'other').toUpperCase()}`));
    const grams = Number(spool.startGrams) || 0;
    body.appendChild(h('span', 'label-line', `${fmtGrams(grams)} g`));
    if (date && spool.date) body.appendChild(h('span', 'label-line', `Bought ${formatDate(spool.date)}`));
    if (price && Number.isFinite(spool.price)) {
        const perGram = grams > 0 ? ` (${fmtMoney(spool.price / grams, 3)}/g)` : '';
        body.appendChild(h('span', 'label-line', `${fmtMoney(spool.price)}${perGram}`));
    }
    label.appendChild(body);
    return label;
}

function chosenIds() {
    return Array.from(listEl.querySelectorAll('input[type=checkbox]:checked'), (b) => b.value);
}

export function renderLabelPreview() {
    sheetEl.replaceChildren();
    sheetEl.className = `label-grid label-${sizeEl.value}`;
    const ids = chosenIds();
    for (const id of ids) {
        const spool = state.spools[id];
        if (isObject(spool)) sheetEl.appendChild(buildLabel(spool, { price: priceBox.checked, date: dateBox.checked }));
    }
    countEl.textContent = `${ids.length} ${ids.length === 1 ? 'label' : 'labels'}`;
    popup.querySelector('#labels-print').disabled = ids.length === 0;
}

function buildPopup() {
    popup = h('div', 'popup');
    popup.id = 'label-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-labelledby', 'label-popup-title');
    const content = h('div', 'popup-content label-popup-content');
    content.appendChild(h('h3', 'popup-title', 'Print spool labels'));
    content.querySelector('h3').id = 'label-popup-title';

    const pick = h('div', 'field label-pick');
    pick.appendChild(h('span', 'label-text', 'Spools'));
    listEl = h('div', 'label-list');
    listEl.id = 'label-list';
    pick.appendChild(listEl);
    content.appendChild(pick);

    const opts = h('div', 'field-row');
    const sizeField = h('div', 'field');
    const sizeLabel = h('label', null, 'Label size');
    sizeLabel.htmlFor = 'label-size';
    sizeEl = h('select', 'dropdown');
    sizeEl.id = 'label-size';
    for (const [key, text] of LABEL_SIZES) {
        const o = h('option', 'option-input', text);
        o.value = key;
        sizeEl.appendChild(o);
    }
    sizeField.append(sizeLabel, sizeEl);
    const showField = h('div', 'field');
    showField.appendChild(h('span', 'label-text', 'Show on label'));
    const mk = (id, text) => {
        const wrap = h('label', 'check-label');
        wrap.htmlFor = id;
        const box = h('input', 'check-input');
        box.type = 'checkbox';
        box.id = id;
        box.checked = true;
        wrap.append(box, h('span', null, text));
        return [wrap, box];
    };
    let priceWrap, dateWrap;
    [priceWrap, priceBox] = mk('label-price', 'Price');
    [dateWrap, dateBox] = mk('label-date', 'Date bought');
    showField.append(priceWrap, dateWrap);
    opts.append(sizeField, showField);
    content.appendChild(opts);

    countEl = h('p', 'secondary-text small');
    countEl.id = 'label-count';
    content.appendChild(countEl);

    sheetEl = h('div', 'label-grid label-small');
    sheetEl.id = 'label-sheet';
    sheetEl.setAttribute('aria-label', 'Label preview');
    content.appendChild(sheetEl);
    content.appendChild(h('p', 'secondary-text small label-tip', 'Tip: in the print dialog, turn off "Headers and footers", and set the scale to 100%. Stick the labels on sticker paper or print on plain paper and cut them out.'));

    const actions = h('div', 'popup-actions');
    const print = h('button', 'btn btn-primary', 'Print labels');
    print.type = 'button';
    print.id = 'labels-print';
    const close = h('button', 'btn btn-outline', 'Close');
    close.type = 'button';
    close.id = 'labels-close';
    actions.append(print, close);
    content.appendChild(actions);
    popup.appendChild(content);
    document.body.appendChild(popup);

    for (const el of [sizeEl, priceBox, dateBox]) el.addEventListener('change', renderLabelPreview);
    popup.addEventListener('click', (e) => { if (e.target === popup) closeLabelPopup(); });
    close.addEventListener('click', closeLabelPopup);
    print.addEventListener('click', printLabels);
}

export function printLabels() {
    document.body.classList.add('printing-labels');
    const done = () => document.body.classList.remove('printing-labels');
    window.addEventListener('afterprint', done, { once: true });
    try {
        window.print();
    } catch (error) {
        console.error(error);
        notify('Could not open the print dialog.', true);
    }
    // Some browsers return before the dialog closes; afterprint cleans up. This is the fallback.
    setTimeout(done, 60000);
}

export function openLabelPopup() {
    const spools = Object.entries(state.spools).filter(([, s]) => isObject(s));
    if (spools.length === 0) {
        notify('Add a spool first, then you can print its label.', true);
        return;
    }
    if (!popup) buildPopup();
    const active = new Set(activeSpools().map(([id]) => id));
    listEl.replaceChildren();
    for (const [id, s] of spools) {
        const wrap = h('label', 'check-label label-option');
        const box = h('input', 'check-input');
        box.type = 'checkbox';
        box.value = id;
        box.checked = active.has(id);
        box.addEventListener('change', renderLabelPreview);
        wrap.append(box, h('span', null, `${s.brand}, ${s.color} (${String(s.material || 'other').toUpperCase()})${s.archived ? ' [archived]' : ''}`));
        listEl.appendChild(wrap);
    }
    renderLabelPreview();
    labelReturn = document.activeElement;
    popup.style.display = 'block';
    popup.scrollTop = 0;
    updateBodyLock();
    popup.querySelector('input[type=checkbox]').focus();
}

export function closeLabelPopup() {
    if (!popup) return;
    const wasOpen = popup.style.display === 'block';
    popup.style.display = 'none';
    updateBodyLock();
    if (wasOpen && labelReturn && document.contains(labelReturn)) labelReturn.focus();
    labelReturn = null;
}

export function labelPopupOpen() {
    return Boolean(popup) && popup.style.display === 'block';
}

export function labelPopupEl() {
    return popup;
}

export function setupLabelsButton(container = $('fila-actions')) {
    const b = h('button', 'btn btn-outline');
    b.type = 'button';
    b.id = 'labels-button';
    b.appendChild(h('span', 'btn-text', 'Print labels'));
    b.setAttribute('aria-label', 'Print spool labels');
    b.addEventListener('click', openLabelPopup);
    container.appendChild(b);
}
