import { renderAll } from './render.js';
import { cleanSettings, saveState, state } from './state.js';
import { applyTheme } from './theme.js';
import { h, icon, isValidDate, makeLink, showError } from './util.js';


// ---------- Settings building blocks ----------

export const settingSyncers = [];
export function addSync(fn) {
    settingSyncers.push(fn);
    fn();
}

export function syncAllSettings() {
    settingSyncers.forEach((fn) => fn());
}

/** Change settings: clean them, save, restyle the page and redraw. */
export function commitSettings(mutator) {
    mutator(state.settings);
    state.settings = cleanSettings(state.settings);
    saveState();
    applyTheme();
    syncAllSettings();
    renderAll();
}


export function settingRow(id, label, hint, control) {
    const row = h('div', 'setting-row');
    const text = h('div', 'setting-text');
    const lab = h('label', 'setting-label', label);
    if (id) lab.htmlFor = id;
    text.appendChild(lab);
    if (hint) text.appendChild(h('p', 'setting-hint', hint));
    row.appendChild(text);
    const wrap = h('div', 'setting-control');
    wrap.appendChild(control);
    row.appendChild(wrap);
    return row;
}

export function settingCard(title, sub) {
    const card = h('div', 'panel');
    card.appendChild(h('h3', 'panel-title', title));
    if (sub) card.appendChild(h('p', 'secondary-text small card-sub', sub));
    return card;
}

export function selectField(id, options, get, set) {
    const select = h('select', 'dropdown');
    select.id = id;
    for (const [value, label] of options) {
        const option = h('option', null, label);
        option.value = value;
        select.appendChild(option);
    }
    select.addEventListener('change', () => set(select.value));
    addSync(() => { select.value = String(get()); });
    return select;
}

export function numberField(id, { min, max, step = 'any', placeholder = '', unit = '' }, get, set) {
    const input = h('input', 'number-input');
    input.type = 'number';
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.placeholder = placeholder;
    input.addEventListener('change', () => {
        const raw = input.value.trim();
        const value = raw === '' ? null : input.valueAsNumber;
        set(Number.isFinite(value) ? value : null);
    });
    addSync(() => {
        const v = get();
        input.value = v === null || v === undefined ? '' : String(v);
    });
    if (!unit) return input;
    const wrap = h('div', 'input-unit');
    wrap.append(input, h('span', 'unit', unit));
    return wrap;
}

export function textField(id, { maxlength, placeholder = '' }, get, set) {
    const input = h('input', 'text-input');
    input.type = 'text';
    input.id = id;
    input.maxLength = maxlength;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.addEventListener('change', () => set(input.value.trim()));
    addSync(() => { input.value = get(); });
    return input;
}

export function dateField(id, get, set) {
    const wrap = h('div', 'date-wrap');
    const input = h('input', 'date-input');
    input.type = 'date';
    input.id = id;
    input.min = '1900-01-01';
    input.max = '2100-12-31';

    // A native date box fires "change" while the year is still being typed (0002, 0020, 0202 ...).
    // Saving and redrawing at that point wipes the month and day, so only complete dates count.
    input.addEventListener('change', () => {
        if (input.validity && input.validity.badInput) return;   // half-typed
        const v = input.value;
        if (v !== '' && !isValidDate(v)) return;
        if (v !== get()) set(v);
    });
    // Leaving the box with a half-typed date puts the saved date back.
    input.addEventListener('blur', () => { input.value = get(); clear.hidden = get() === ''; });

    const clear = h('button', 'btn btn-ghost btn-small', 'Clear');
    clear.type = 'button';
    clear.id = id + '-clear';
    clear.addEventListener('click', () => { input.value = ''; set(''); });

    addSync(() => {
        // Never overwrite the box while the person is typing in it.
        if (document.activeElement !== input && input.value !== get()) input.value = get();
        clear.hidden = get() === '';
    });
    wrap.append(input, clear);
    return wrap;
}

export function toggleField(id, get, set) {
    const label = h('label', 'switch');
    const input = h('input', 'switch-input');
    input.type = 'checkbox';
    input.id = id;
    input.addEventListener('change', () => set(input.checked));
    label.appendChild(input);
    label.appendChild(h('span', 'switch-track'));
    addSync(() => { input.checked = Boolean(get()); });
    return label;
}

export function rangeField(id, { min, max, step = 1, format }, get, set) {
    const wrap = h('div', 'range-wrap');
    const input = h('input', 'range-input');
    input.type = 'range';
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const readout = h('span', 'range-value');
    input.addEventListener('input', () => {
        readout.textContent = format(Number(input.value));
        set(Number(input.value));
    });
    addSync(() => {
        input.value = String(get());
        readout.textContent = format(Number(get()));
    });
    wrap.append(input, readout);
    return wrap;
}

/** A model select whose options depend on the chosen brand. */

export function autoValueField(id, { label, get, auto, set, min, max, step, unit, format, emptyNote }, { sync = true } = {}) {
    let editing = false;
    const wrap = h('div', 'auto-field');

    const view = h('div', 'auto-view');
    const valueEl = h('span', 'auto-value');
    valueEl.id = id + '-value';
    const badge = h('span', 'chip chip-mini');
    badge.id = id + '-badge';
    const editButton = h('button', 'icon-btn');
    editButton.type = 'button';
    editButton.id = id + '-edit';
    editButton.setAttribute('aria-label', `Edit ${label}`);
    editButton.title = `Edit ${label}`;
    editButton.appendChild(icon('edit'));
    view.append(valueEl, badge, editButton);

    const form = h('div', 'auto-edit');
    form.hidden = true;
    const input = h('input', 'number-input');
    input.type = 'number';
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    const unitEl = h('span', 'unit');
    const save = h('button', 'btn btn-primary btn-small', 'Save');
    save.type = 'button';
    save.id = id + '-save';
    const cancel = h('button', 'btn btn-outline btn-small', 'Cancel');
    cancel.type = 'button';
    cancel.id = id + '-cancel';
    const reset = h('button', 'btn btn-ghost btn-small', 'Use automatic');
    reset.type = 'button';
    reset.id = id + '-reset';
    const error = h('p', 'error-text');
    error.hidden = true;
    form.append(input, unitEl, save, cancel, reset);

    const note = h('p', 'setting-hint auto-note');
    note.id = id + '-note';

    const refresh = () => {
        const own = get();
        const a = auto();
        form.hidden = !editing;
        view.hidden = editing;
        error.hidden = true;
        unitEl.textContent = typeof unit === 'function' ? unit() : unit;
        reset.hidden = !(own !== null && a);
        if (own !== null) {
            valueEl.textContent = format(own);
            badge.textContent = 'Your value';
        } else if (a) {
            valueEl.textContent = format(a.value);
            badge.textContent = 'Automatic';
        } else {
            valueEl.textContent = 'Not set';
            badge.textContent = '';
        }
        badge.hidden = badge.textContent === '';
        note.replaceChildren();
        if (own === null && a) {
            note.append(`${a.note}. `);
            if (a.url) note.appendChild(makeLink(a.url, 'Source'));
        } else if (own !== null && a) {
            note.append(`Automatic would be ${format(a.value)}.`);
        } else {
            note.append(emptyNote());
        }
    };

    const startEdit = () => {
        const own = get();
        const a = auto();
        editing = true;
        refresh();
        input.value = own !== null ? String(own) : a ? String(a.value) : '';
        input.focus();
        input.select();
    };
    const stopEdit = () => { editing = false; refresh(); editButton.focus(); };
    const commit = () => {
        const raw = input.value.trim();
        if (raw === '') {
            editing = false;
            set(null);
            return;
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < min || n > max) {
            showError(error, `Enter a number from ${min} to ${max}, or choose Use automatic.`);
            return;
        }
        editing = false;
        set(n);
    };

    editButton.addEventListener('click', startEdit);
    save.addEventListener('click', commit);
    cancel.addEventListener('click', stopEdit);
    reset.addEventListener('click', () => { editing = false; set(null); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopEdit(); }
    });

    // Fields rebuilt on every render (the AMS prices) must not register a syncer each time.
    if (sync) addSync(() => { if (!editing) refresh(); });
    else refresh();
    wrap.append(view, form, error, note);
    return wrap;
}

