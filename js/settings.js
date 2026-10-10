import { calcStats, effectiveKwh, effectiveWatts, hardwareCost } from './calc.js';
import { MAINT_SETS, BRANDS, autoAmsPrice, autoKwh, autoPrice, autoWatts, defaultSetFor, findPrinter, modelsFor, wattsHint } from './catalog.js';
import { ACCENTS, BACKGROUNDS, CURRENCIES, KNOWN_MATERIALS, NOZZLES, Sections, UNIT_LABELS } from './constants.js';
import { SHORTCUTS } from './popups.js';
import { emptyState_, renderAll } from './render.js';
import { cleanSettings, defaultSettings, saveState, state } from './state.js';
import { showTab } from './tabs.js';
import { applyTheme } from './theme.js';
import { $, cleanText, clearError, fmtMoney, fmtNum, h, icon, isValidDate, makeLink, notify, showError, todayLocal, uid } from './util.js';
import { buildMaintenanceRow, maintenanceStatus } from './widgets.js';

// ---------- Settings ----------

export const settingSyncers = [];
export let settingsTabName = 'printer';

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

export function openSettings(tab = 'printer') {
    showTab(Sections.SETTINGS);
    showSettingsTab(tab);
}

export function showSettingsTab(name) {
    settingsTabName = name;
    for (const key of ['printer', 'appearance', 'preferences']) {
        const active = key === name;
        $('settings-' + key).hidden = !active;
        const tab = $('settings-tab-' + key);
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
    }
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
function modelField(id) {
    const select = h('select', 'dropdown');
    select.id = id;
    select.addEventListener('change', () => commitSettings((st) => { st.printer.model = select.value; }));
    addSync(() => {
        const { brand, model } = state.settings.printer;
        select.replaceChildren();
        const none = h('option', null, brand ? 'Not set' : 'Pick a brand first');
        none.value = '';
        select.appendChild(none);
        for (const p of modelsFor(brand)) {
            const o = h('option', null, p.model);
            o.value = p.model;
            select.appendChild(o);
        }
        select.disabled = modelsFor(brand).length === 0;
        select.value = model;
    });
    return select;
}

/**
 * A number that is filled in automatically when we know it, with a pencil to override it.
 *   get()  -> the person's own value, or null
 *   auto() -> { value, note, url } or null
 */
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

export function buildPrinterSettings(root) {
    const printer = settingCard('Your printer', 'Shown on the dashboard. Everything here is optional.');
    const set = (fn) => commitSettings((st) => fn(st.printer));
    printer.appendChild(settingRow('set-printer-brand', 'Brand', null,
        selectField('set-printer-brand', [['', 'Not set'], ...BRANDS.map((b) => [b.key, b.label])],
            () => state.settings.printer.brand,
            (v) => set((p) => { p.brand = v; if (!findPrinter(v, p.model)) p.model = ''; }))));
    printer.appendChild(settingRow('set-printer-model', 'Model', null, modelField('set-printer-model')));
    printer.appendChild(settingRow('set-printer-name', 'Nickname', 'Something to call it, like "Benchy HQ".',
        textField('set-printer-name', { maxlength: 40, placeholder: 'e.g., Workhorse' },
            () => state.settings.printer.nickname, (v) => set((p) => { p.nickname = v; }))));
    printer.appendChild(settingRow('set-printer-nozzle', 'Nozzle size', null,
        selectField('set-printer-nozzle', NOZZLES.map((n) => [n, `${n} mm`]),
            () => state.settings.printer.nozzle, (v) => set((p) => { p.nozzle = v; }))));
    printer.appendChild(settingRow('set-printer-date', 'Arrival or purchase date', 'A future date becomes a countdown on the dashboard.',
        dateField('set-printer-date', () => state.settings.printer.date, (v) => set((p) => { p.date = v; }))));
    printer.appendChild(settingRow('set-printer-price', 'Price paid', null,
        autoValueField('set-printer-price', {
            label: 'price paid', min: 0, max: 10000000, step: 0.01,
            get: () => state.settings.printer.price,
            auto: () => { const { brand, model } = state.settings.printer; return autoPrice(brand, model, state.settings.currency); },
            set: (v) => set((p) => { p.price = v; }),
            unit: () => state.settings.currency,
            format: (v) => fmtMoney(v),
            emptyNote: () => 'Not filled in automatically. Tap the pencil and enter what you paid. Typical prices are only known for some Bambu Lab models, in US dollars.'
        })));
    root.appendChild(printer);

    const power = settingCard('Electricity', 'Used to estimate the energy cost of prints that have a print time.');
    power.appendChild(settingRow('set-printer-watts', 'Average power while printing', null,
        autoValueField('set-printer-watts', {
            label: 'average power', min: 0, max: 5000, step: 1,
            get: () => state.settings.printer.watts,
            auto: () => { const { brand, model } = state.settings.printer; return autoWatts(brand, model); },
            set: (v) => set((p) => { p.watts = v; }),
            unit: 'W',
            format: (v) => `${v} W`,
            emptyNote: () => {
                const { brand, model } = state.settings.printer;
                return wattsHint(brand, model) ||
                    'No official average for this printer. Use a plug-in power meter, or tap the pencil to enter a number.';
            }
        })));
    power.appendChild(settingRow('set-printer-kwh', 'Electricity price', 'Per kilowatt-hour, in your currency.',
        autoValueField('set-printer-kwh', {
            label: 'electricity price', min: 0, max: 100, step: 0.0001,
            get: () => state.settings.printer.kwhPrice,
            auto: () => autoKwh(state.settings.currency),
            set: (v) => set((p) => { p.kwhPrice = v; }),
            unit: () => `${state.settings.currency} per kWh`,
            format: (v) => `${fmtMoney(v, v < 1 ? 3 : 2)} per kWh`,
            emptyNote: () => 'Check your power bill, then tap the pencil. Typical prices are only built in for $ and £.'
        })));
    const preview = h('p', 'secondary-text small');
    preview.id = 'energy-preview';
    power.appendChild(preview);
    addSync(() => {
        const w = effectiveWatts();
        const k = effectiveKwh();
        preview.textContent = w && k && w.value > 0 && k.value > 0
            ? `A 5 hour print would use about ${fmtMoney(5 * (w.value / 1000) * k.value)} of electricity.`
            : 'Fill in both values to see an example.';
    });
    root.appendChild(power);

    const wear = settingCard('Machine wear', 'Nozzles, build plates and AMS parts wear out. Enter what that costs per hour of printing and it is added to each print\'s cost. Leave it empty to ignore wear.');
    wear.appendChild(settingRow('set-printer-wear', 'Wear cost per print hour', 'For example, a $20 nozzle that lasts 200 hours is $0.10 per hour.',
        numberField('set-printer-wear', { min: 0, max: 10000, step: 'any', placeholder: 'e.g., 0.10', unit: 'per hour' },
            () => state.settings.printer.wear, (v) => set((p) => { p.wear = v; }))));
    const wearPreview = h('p', 'secondary-text small');
    wearPreview.id = 'wear-preview';
    wear.appendChild(wearPreview);
    addSync(() => {
        const rate = state.settings.printer.wear;
        wearPreview.textContent = rate > 0
            ? `A 5 hour print would add about ${fmtMoney(5 * rate)} of machine wear.`
            : 'Not counted in print costs right now.';
    });
    root.appendChild(wear);

    root.appendChild(buildCostCard());
    root.appendChild(buildMaintenanceCard());
}

let costListEl = null;
let costSummaryEl = null;

/** Printer + AMS prices and the total spent on the setup. Rebuilt on every render. */
export function buildCostCard() {
    const card = settingCard('AMS and total cost', 'Add what you paid for each AMS to see what the whole setup has cost. Add AMS units on the Filament tab.');
    costListEl = h('div', 'cost-list');
    costListEl.id = 'ams-prices';
    costSummaryEl = h('ul', 'fact-list cost-summary');
    costSummaryEl.id = 'cost-summary';
    card.append(costListEl, costSummaryEl);
    renderCostCard();
    return card;
}

export function renderCostCard() {
    if (!costListEl) return;
    costListEl.replaceChildren();
    const units = Object.entries(state.ams);
    if (units.length === 0) {
        costListEl.appendChild(h('p', 'secondary-text small', 'No AMS added yet.'));
    }
    for (const [id, unit] of units) {
        const field = autoValueField('ams-price-' + id, {
            label: `price of ${unit.name}`, min: 0, max: 10000000, step: 0.01,
            get: () => (Number.isFinite(unit.price) ? unit.price : null),
            auto: () => autoAmsPrice(unit.type, state.settings.currency),
            set: (v) => { unit.price = v === null ? null : Math.round(v * 100) / 100; saveState(); renderAll(); },
            unit: () => state.settings.currency,
            format: (v) => fmtMoney(v),
            emptyNote: () => 'No typical price known for this one. Tap the pencil and enter what you paid.'
        }, { sync: false });
        costListEl.appendChild(settingRow(null, unit.name, null, field));
    }

    const c = hardwareCost();
    costSummaryEl.replaceChildren();
    const line = (text) => costSummaryEl.appendChild(h('li', null, text));
    line(c.printer === null ? 'Printer: no price set' : `Printer: ${fmtMoney(c.printer)}${c.estimate ? ' (typical store price)' : ''}`);
    if (c.amsUnits > 0) line(`AMS: ${fmtMoney(c.ams)}${c.amsEstimate ? ' (includes typical store prices)' : ''}${c.amsPriced < c.amsUnits ? ` (${c.amsUnits - c.amsPriced} without a price)` : ''}`);
    line(`Printer and AMS: ${fmtMoney(c.hardware)}`);
    line(`Filament bought: ${fmtMoney(c.filament)}`);
    const total = h('li', 'cost-total');
    total.id = 'cost-total';
    total.textContent = `Total spent on the setup: ${fmtMoney(c.total)}`;
    costSummaryEl.appendChild(total);
}

export const UNIT_OPTION_LABELS = { hours: 'print hours', days: 'days', prints: 'prints', spools: 'spools (1 kg each)' };

export let maintenanceListEl = null;
let presetPickEl = null;
let presetListEl = null;
let presetPicked = false;

export function addMaintenance({ name, unit, every }) {
    const cleanName = cleanText(name, 60);
    const amount = Number(every);
    if (cleanName === '') return 'Give the task a name.';
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return 'Enter how often it is due, above 0.';
    if (!Object.prototype.hasOwnProperty.call(UNIT_LABELS, unit)) return 'Pick print hours, days, prints or spools.';
    const stats = calcStats();
    state.maintenance[uid()] = {
        name: cleanName, unit, every: amount,
        lastDate: todayLocal(), atHours: stats.minutes / 60, atPrints: stats.total, atGrams: stats.grams
    };
    saveState();
    renderAll();
    return '';
}

/** The sets on offer: built-in ones first, then the person's saved presets. */
export function allPresetSets() {
    const custom = Object.entries(state.settings.customPresets).map(([id, p]) => ({
        key: 'custom:' + id, label: p.name, custom: true, id,
        items: p.tasks.map((t) => ({ ...t, src: 'yours' }))
    }));
    return [...MAINT_SETS, ...custom];
}

function selectedSet() {
    const key = presetPickEl ? presetPickEl.value : '';
    return allPresetSets().find((s) => s.key === key) || null;
}

export function renderPresetList() {
    if (!presetPickEl || !presetListEl) return;
    const sets = allPresetSets();
    const wanted = presetPicked ? presetPickEl.value : defaultSetFor(state.settings.printer.brand, state.settings.printer.model);

    presetPickEl.replaceChildren();
    const builtIn = h('optgroup');
    builtIn.label = 'From manuals';
    const mine = h('optgroup');
    mine.label = 'Your presets';
    for (const s of sets) {
        const o = h('option', null, s.label);
        o.value = s.key;
        (s.custom ? mine : builtIn).appendChild(o);
    }
    presetPickEl.appendChild(builtIn);
    if (mine.children.length > 0) presetPickEl.appendChild(mine);
    presetPickEl.value = sets.some((s) => s.key === wanted) ? wanted : sets[0].key;

    const set = selectedSet();
    presetListEl.replaceChildren();
    if (!set) return;

    const have = new Set(Object.values(state.maintenance).map((t) => t.name.toLowerCase()));
    const list = h('div', 'preset-items');
    set.items.forEach((item, i) => {
        const row = h('label', 'preset-item');
        const box = h('input');
        box.type = 'checkbox';
        box.className = 'preset-check';
        box.dataset.index = String(i);
        const already = have.has(item.name.toLowerCase());
        box.checked = !already;
        box.disabled = already;
        const text = h('span', 'preset-text');
        text.appendChild(h('span', 'list-title', item.name));
        text.appendChild(h('span', 'list-sub', `Every ${fmtNum(item.every)} ${UNIT_LABELS[item.unit]}${already ? ' · already added' : ''}`));
        row.append(box, text);
        if (item.src === 'official') row.appendChild(h('span', 'chip chip-mini', 'From docs'));
        else if (item.src === 'suggested') row.appendChild(h('span', 'chip chip-mini chip-muted', 'Suggested'));
        list.appendChild(row);
    });
    presetListEl.appendChild(list);

    const foot = h('div', 'preset-foot');
    if (set.source) {
        const src = h('p', 'setting-hint');
        src.append('Source: ', makeLink(set.source.url, set.source.text));
        if (set.items.some((i) => i.src === 'suggested')) {
            src.append('. "Suggested" means the maker gives no interval, so it is a starting point.');
        }
        foot.appendChild(src);
    }
    const actions = h('div', 'data-actions');
    const add = h('button', 'btn btn-primary btn-small', 'Add selected');
    add.type = 'button';
    add.id = 'maint-set-add';
    add.addEventListener('click', () => {
        const stats = calcStats();
        let count = 0;
        presetListEl.querySelectorAll('.preset-check').forEach((box) => {
            if (!box.checked || box.disabled) return;
            const item = set.items[Number(box.dataset.index)];
            state.maintenance[uid()] = {
                name: item.name, unit: item.unit, every: item.every,
                lastDate: todayLocal(), atHours: stats.minutes / 60, atPrints: stats.total, atGrams: stats.grams
            };
            count++;
        });
        if (count === 0) return notify('Nothing new to add from this set.');
        saveState();
        renderAll();
        notify(`Added ${count} upkeep ${count === 1 ? 'task' : 'tasks'}.`);
    });
    actions.appendChild(add);
    if (set.custom) {
        const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete this preset');
        del.type = 'button';
        del.id = 'maint-preset-delete';
        del.addEventListener('click', () => {
            commitSettings((st) => { delete st.customPresets[set.id]; });
            presetPicked = false;
            renderPresetList();
        });
        actions.appendChild(del);
    }
    foot.appendChild(actions);
    presetListEl.appendChild(foot);
}

export function buildMaintenanceCard() {
    const card = settingCard('Upkeep reminders', 'Count print hours, days, prints or spools since you last did something. The intervals come from the printer\'s docs where they exist; change anything you like.');

    maintenanceListEl = h('div', 'maint-list');
    maintenanceListEl.id = 'maintenance-list';
    card.appendChild(maintenanceListEl);

    const form = h('div', 'maint-form');
    const name = h('input', 'text-input');
    name.type = 'text';
    name.id = 'maint-name';
    name.maxLength = 60;
    name.placeholder = 'Task, e.g., Replace nozzle';
    name.setAttribute('aria-label', 'Task name');
    const every = h('input', 'number-input');
    every.type = 'number';
    every.id = 'maint-every';
    every.min = '1';
    every.step = 'any';
    every.placeholder = 'Every';
    every.setAttribute('aria-label', 'How often');
    const unit = h('select', 'dropdown');
    unit.id = 'maint-unit';
    unit.setAttribute('aria-label', 'Unit');
    for (const u of Object.keys(UNIT_LABELS)) {
        const o = h('option', null, UNIT_OPTION_LABELS[u]);
        o.value = u;
        unit.appendChild(o);
    }
    const add = h('button', 'btn btn-primary', 'Add task');
    add.type = 'button';
    add.id = 'maint-add-button';
    const error = h('p', 'error-text');
    error.id = 'maint-error';
    error.hidden = true;
    const submit = () => {
        const problem = addMaintenance({ name: name.value, unit: unit.value, every: every.valueAsNumber });
        if (problem) return showError(error, problem);
        clearError(error);
        name.value = '';
        every.value = '';
        name.focus();
        return true;
    };
    add.addEventListener('click', submit);
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    every.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    form.append(name, every, unit, add);
    card.appendChild(form);
    card.appendChild(error);
    card.appendChild(h('p', 'setting-hint', 'A spool here means 1 kg of filament printed, like the "rolls" in Bambu Lab\'s guides.'));

    card.appendChild(h('h4', 'subhead', 'Quick start'));
    presetPickEl = h('select', 'dropdown');
    presetPickEl.id = 'maint-set';
    presetPickEl.setAttribute('aria-label', 'Upkeep set');
    presetPickEl.addEventListener('change', () => { presetPicked = true; renderPresetList(); });
    card.appendChild(settingRow('maint-set', 'Start from a set', 'Pick the set for your printer, tick what you want, then add it.', presetPickEl));
    presetListEl = h('div', 'preset-list');
    presetListEl.id = 'maint-set-list';
    card.appendChild(presetListEl);

    // Save the current tasks as a preset of your own.
    const saveRow = h('div', 'maint-form maint-save');
    const presetName = h('input', 'text-input');
    presetName.type = 'text';
    presetName.id = 'maint-preset-name';
    presetName.maxLength = 40;
    presetName.placeholder = 'Name a preset, e.g., My A1 routine';
    presetName.setAttribute('aria-label', 'Preset name');
    const saveButton = h('button', 'btn btn-outline', 'Save my tasks as a preset');
    saveButton.type = 'button';
    saveButton.id = 'maint-preset-save';
    const presetError = h('p', 'error-text');
    presetError.hidden = true;
    const savePreset = () => {
        const label = cleanText(presetName.value, 40);
        const tasks = Object.values(state.maintenance).map((t) => ({ name: t.name, unit: t.unit, every: t.every }));
        if (label === '') return showError(presetError, 'Give the preset a name.');
        if (tasks.length === 0) return showError(presetError, 'Add at least one task first.');
        if (Object.keys(state.settings.customPresets).length >= 20) return showError(presetError, 'You can keep up to 20 presets.');
        const id = uid();
        commitSettings((st) => { st.customPresets[id] = { name: label, tasks }; });
        clearError(presetError);
        presetName.value = '';
        presetPicked = true;
        presetPickEl.value = 'custom:' + id;
        renderPresetList();
        notify(`Saved the preset "${label}".`);
        return true;
    };
    saveButton.addEventListener('click', savePreset);
    presetName.addEventListener('keydown', (e) => { if (e.key === 'Enter') savePreset(); });
    saveRow.append(presetName, saveButton);
    card.appendChild(saveRow);
    card.appendChild(presetError);
    return card;
}

export function renderMaintenanceSettings() {
    if (!maintenanceListEl) return;
    renderPresetList();
    renderCostCard();
    maintenanceListEl.replaceChildren();
    const list = maintenanceStatus(calcStats());
    if (list.length === 0) {
        maintenanceListEl.appendChild(emptyState_('No upkeep tasks yet.', 'Add one below, or pick a quick add.'));
        return;
    }
    for (const m of list) maintenanceListEl.appendChild(buildMaintenanceRow(m, { withDelete: true }));
}

export function buildAppearanceSettings(root) {
    const look = settingCard('Look and feel');

    look.appendChild(settingRow('set-theme', 'Theme', 'Auto follows your device.',
        selectField('set-theme', [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']],
            () => state.theme || 'auto',
            (v) => {
                state.theme = v === 'auto' ? null : v;
                saveState();
                applyTheme();
                syncAllSettings();
            })));

    const swatches = h('div', 'swatch-picker');
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', 'Accent color');
    const swatchButtons = {};
    for (const [key, accent] of Object.entries(ACCENTS)) {
        const b = h('button', 'accent-swatch');
        b.type = 'button';
        b.id = 'accent-' + key;
        b.title = accent.label;
        b.setAttribute('aria-label', accent.label);
        b.style.background = accent.dark.accent;
        b.addEventListener('click', () => commitSettings((st) => { st.accent = key; }));
        swatches.appendChild(b);
        swatchButtons[key] = b;
    }
    addSync(() => {
        for (const [key, b] of Object.entries(swatchButtons)) {
            const on = key === state.settings.accent;
            b.classList.toggle('selected', on);
            b.setAttribute('aria-pressed', String(on));
        }
    });
    look.appendChild(settingRow(null, 'Accent color', null, swatches));

    look.appendChild(settingRow('set-density', 'Card spacing', 'Compact fits more on the screen.',
        selectField('set-density', [['comfortable', 'Comfortable'], ['compact', 'Compact']],
            () => state.settings.density, (v) => commitSettings((st) => { st.density = v; }))));
    root.appendChild(look);

    const bgCard = settingCard('Background', 'Inspired by what a slicer draws: layer lines, infill and build plate grids.');
    const tiles = h('div', 'bg-tiles');
    tiles.setAttribute('role', 'group');
    tiles.setAttribute('aria-label', 'Background style');
    const tileButtons = {};
    for (const { key, label } of BACKGROUNDS) {
        const b = h('button', 'bg-tile');
        b.type = 'button';
        b.id = 'bg-' + key;
        b.appendChild(h('span', `bg-preview bgp-${key}`));
        b.appendChild(h('span', 'bg-tile-label', label));
        b.addEventListener('click', () => commitSettings((st) => { st.background = key; }));
        tiles.appendChild(b);
        tileButtons[key] = b;
    }
    addSync(() => {
        for (const [key, b] of Object.entries(tileButtons)) {
            const on = key === state.settings.background;
            b.classList.toggle('selected', on);
            b.setAttribute('aria-pressed', String(on));
        }
    });
    bgCard.appendChild(tiles);
    bgCard.appendChild(settingRow('set-bg-strength', 'Intensity', null,
        rangeField('set-bg-strength', { min: 0, max: 100, step: 5, format: (n) => `${n}%` },
            () => state.settings.bgStrength, (v) => commitSettings((st) => { st.bgStrength = v; }))));
    bgCard.appendChild(settingRow('set-animate', 'Animate the background', 'Slow drifting motion. Turned off automatically if your device asks for reduced motion.',
        toggleField('set-animate', () => state.settings.animate, (v) => commitSettings((st) => { st.animate = v; }))));
    root.appendChild(bgCard);
}

export function buildPreferenceSettings(root) {
    const units = settingCard('Units and formats');
    units.appendChild(settingRow('set-currency', 'Currency', null,
        selectField('set-currency', CURRENCIES.map((c) => [c, c]),
            () => state.settings.currency, (v) => commitSettings((st) => { st.currency = v; }))));
    units.appendChild(settingRow('set-date-format', 'Date format', null,
        selectField('set-date-format', [['mdy', 'MM/DD/YYYY'], ['dmy', 'DD/MM/YYYY'], ['iso', 'YYYY-MM-DD']],
            () => state.settings.dateFormat, (v) => commitSettings((st) => { st.dateFormat = v; }))));
    root.appendChild(units);

    const filament = settingCard('Filament');
    filament.appendChild(settingRow('set-low', 'Low filament warning', 'A spool counts as low at or below this share of its weight.',
        numberField('set-low', { min: 5, max: 50, step: 1, placeholder: '25', unit: '%' },
            () => state.settings.lowPercent, (v) => commitSettings((st) => { st.lowPercent = v === null ? 25 : v; }))));
    filament.appendChild(settingRow('set-default-material', 'Default material', 'Pre-selected when you add a spool.',
        selectField('set-default-material', [...KNOWN_MATERIALS, 'other'].map((m) => [m, m.toUpperCase()]),
            () => state.settings.defaultMaterial, (v) => commitSettings((st) => { st.defaultMaterial = v; }))));
    filament.appendChild(settingRow('set-default-grams', 'Default spool weight', 'Pre-filled when you add a spool. Use 0 to leave it empty.',
        numberField('set-default-grams', { min: 0, max: 100000, step: 1, placeholder: '1000', unit: 'g' },
            () => state.settings.defaultSpoolGrams, (v) => commitSettings((st) => { st.defaultSpoolGrams = v === null ? 0 : v; }))));
    filament.appendChild(settingRow('set-dry-days', 'Drying reminder', 'Flag a spool as "needs drying?" when it has been open this many days since it was opened or last dried. Use 0 to turn it off.',
        numberField('set-dry-days', { min: 0, max: 365, step: 1, placeholder: '30', unit: 'days' },
            () => state.settings.dryDays, (v) => commitSettings((st) => { st.dryDays = v === null ? 0 : v; }))));
    root.appendChild(filament);

    const safety = settingCard('Backups and shortcuts');
    safety.appendChild(settingRow('set-backup-days', 'Backup reminder', 'Show a reminder on the dashboard when your last export is older than this. Use 0 to turn it off.',
        numberField('set-backup-days', { min: 0, max: 365, step: 1, placeholder: '30', unit: 'days' },
            () => state.settings.backupDays, (v) => commitSettings((st) => { st.backupDays = v === null ? 0 : v; }))));
    safety.appendChild(settingRow('set-shortcuts', 'Keyboard shortcuts', null,
        toggleField('set-shortcuts', () => state.settings.shortcuts, (v) => commitSettings((st) => { st.shortcuts = v; }))));
    const keys = h('dl', 'shortcut-list');
    for (const [key, what] of SHORTCUTS) {
        keys.appendChild(h('dt', null, key));
        keys.lastChild.className = 'kbd';
        keys.appendChild(h('dd', null, what));
    }
    safety.appendChild(keys);
    root.appendChild(safety);

    const reset = h('div', 'data-actions');
    const resetButton = h('button', 'btn btn-outline', 'Reset settings to defaults');
    resetButton.type = 'button';
    resetButton.id = 'reset-settings-button';
    resetButton.addEventListener('click', () => {
        if (!confirm('Reset all settings, including your printer details, to their defaults? Your prints, spools and queue are not touched.')) return;
        state.settings = defaultSettings();
        state.theme = null;
        saveState();
        applyTheme();
        syncAllSettings();
        renderAll();
        notify('Settings reset.');
    });
    reset.appendChild(resetButton);
    root.appendChild(reset);
}

export function buildSettings() {
    const names = [['printer', 'Printer'], ['appearance', 'Appearance'], ['preferences', 'Preferences']];
    const bar = $('settings-tabs');
    for (const [key, label] of names) {
        const b = h('button', 'subtab', label);
        b.type = 'button';
        b.id = 'settings-tab-' + key;
        b.setAttribute('role', 'tab');
        b.addEventListener('click', () => showSettingsTab(key));
        bar.appendChild(b);
    }
    buildPrinterSettings($('settings-printer'));
    buildAppearanceSettings($('settings-appearance'));
    buildPreferenceSettings($('settings-preferences'));
    showSettingsTab(settingsTabName);
}
