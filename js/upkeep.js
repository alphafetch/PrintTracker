import { activeSpools, calcStats, daysOpen, hasManyPrinters, needsDrying, printerIds, printerName, printerStats } from './calc.js';
import { MAINT_SETS, defaultSetFor, dryingAdvice } from './catalog.js';
import { UNIT_LABELS } from './constants.js';
import { emptyState_, makeBadge, plural, renderAll } from './render.js';
import { markDried } from './spools.js';
import { saveState, state } from './state.js';
import { $, cleanText, clearError, fmtDuration, fmtMoney, fmtNum, formatDate, h, isValidDate, makeLink, makeSwatch, materialKey, spoolHex, notify, showError, todayLocal, uid } from './util.js';
import { buildMaintenanceRow, maintenanceStatus } from './widgets.js';

import { commitSettings, settingRow, settingCard } from './settingsKit.js';

// ---------- Upkeep reminders ----------

export const UNIT_OPTION_LABELS = { hours: 'print hours', days: 'days', prints: 'prints', spools: 'spools (1 kg each)' };

export let maintenanceListEl = null;
let presetPickEl = null;
let presetListEl = null;
let presetPicked = false;

/** The printer the Upkeep tab is showing ('' = main). Falls back to the main printer if that one was removed. */
let upkeepPrinter = '';
export function currentPrinter() {
    return printerIds().includes(upkeepPrinter) ? upkeepPrinter : '';
}
export function setUpkeepPrinter(id) {
    upkeepPrinter = printerIds().includes(id) ? id : '';
}

export function addMaintenance({ name, unit, every, printerId = currentPrinter() }) {
    const cleanName = cleanText(name, 60);
    const amount = Number(every);
    if (cleanName === '') return 'Give the task a name.';
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return 'Enter how often it is due, above 0.';
    if (!Object.prototype.hasOwnProperty.call(UNIT_LABELS, unit)) return 'Pick print hours, days, prints or spools.';
    const stats = printerStats(printerId);
    state.maintenance[uid()] = {
        name: cleanName, unit, every: amount,
        lastDate: todayLocal(), atHours: stats.minutes / 60, atPrints: stats.total, atGrams: stats.grams,
        printerId
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

    const have = new Set(Object.values(state.maintenance).filter((t) => (t.printerId || '') === currentPrinter()).map((t) => t.name.toLowerCase()));
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
        const printerId = currentPrinter();
        const stats = printerStats(printerId);
        let count = 0;
        presetListEl.querySelectorAll('.preset-check').forEach((box) => {
            if (!box.checked || box.disabled) return;
            const item = set.items[Number(box.dataset.index)];
            state.maintenance[uid()] = {
                name: item.name, unit: item.unit, every: item.every,
                lastDate: todayLocal(), atHours: stats.minutes / 60, atPrints: stats.total, atGrams: stats.grams,
                printerId
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
            const removed = state.settings.customPresets[set.id];
            commitSettings((st) => { delete st.customPresets[set.id]; });
            presetPicked = false;
            renderPresetList();
            notify(`Deleted the preset "${set.label}".`, {
                action: {
                    label: 'Undo',
                    onClick: () => {
                        commitSettings((st) => { st.customPresets[set.id] = removed; });
                        renderPresetList();
                    }
                }
            });
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
        const tasks = Object.values(state.maintenance).filter((t) => (t.printerId || '') === currentPrinter()).map((t) => ({ name: t.name, unit: t.unit, every: t.every }));
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

export function renderUpkeep() {
    renderPrinterPicker();
    renderHours();
    renderParts();
    renderDrying();
    if (!maintenanceListEl) return;
    renderPresetList();
    maintenanceListEl.replaceChildren();
    const list = maintenanceStatus(calcStats(), hasManyPrinters() ? currentPrinter() : null);
    if (list.length === 0) {
        maintenanceListEl.appendChild(emptyState_('No upkeep tasks yet.', 'Add one below, or pick a quick add.'));
        return;
    }
    for (const m of list) maintenanceListEl.appendChild(buildMaintenanceRow(m, { withDelete: true }));
}


// ---------- Printer hours and wear parts ----------

let hoursEl = null;
let partsListEl = null;
let partsSummaryEl = null;

export function totalPrintHours(printerId = '') {
    return printerStats(printerId).minutes / 60;
}

/** Hours printed since this part was last swapped. */
export function partUsage(part, hoursNow = totalPrintHours(part.printerId || '')) {
    return Math.max(0, hoursNow - part.atHours);
}

/** Money per print hour a part costs (price / lifespan), or null when either is missing. */
export function partRate(part) {
    return Number.isFinite(part.price) && Number.isFinite(part.lifespan) && part.lifespan > 0 ? part.price / part.lifespan : null;
}

export function partsWearRate(printerId = '') {
    return Object.values(state.parts).filter((p) => (p.printerId || '') === printerId).reduce((sum, p) => sum + (partRate(p) || 0), 0);
}

export function addPart({ name, lifespan, price, printerId = currentPrinter() }) {
    const cleanName = cleanText(name, 40);
    if (cleanName === '') return 'Give the part a name.';
    if (Object.values(state.parts).some((p) => (p.printerId || '') === printerId && p.name.toLowerCase() === cleanName.toLowerCase())) return 'You already track a part with that name.';
    if (Object.keys(state.parts).length >= 30) return 'You can track up to 30 parts.';
    const life = Number.isFinite(lifespan) ? lifespan : null;
    const cost = Number.isFinite(price) ? price : null;
    if (life !== null && life <= 0) return 'Lifespan must be above 0 hours, or left empty.';
    if (cost !== null && cost < 0) return 'Price must be 0 or more, or left empty.';
    state.parts[uid()] = {
        name: cleanName, lastDate: todayLocal(), atHours: totalPrintHours(printerId),
        lifespan: life, price: cost && cost > 0 ? cost : null, printerId
    };
    saveState();
    renderAll();
    return '';
}

export function swapPart(id) {
    const part = state.parts[id];
    if (!part) return;
    const before = { ...part };
    part.lastDate = todayLocal();
    part.atHours = totalPrintHours(part.printerId || '');
    saveState();
    renderAll();
    notify(`Logged: ${part.name} swapped today.`, {
        action: { label: 'Undo', onClick: () => { state.parts[id] = before; saveState(); renderAll(); } }
    });
}

export function deletePart(id) {
    const part = state.parts[id];
    if (!part) return;
    delete state.parts[id];
    saveState();
    renderAll();
    notify(`Removed "${part.name}".`, {
        action: { label: 'Undo', onClick: () => { state.parts[id] = part; saveState(); renderAll(); } }
    });
}

export function updatePart(id, { lifespan, price }) {
    const part = state.parts[id];
    if (!part) return 'That part no longer exists.';
    if (Number.isFinite(lifespan) && lifespan <= 0) return 'Lifespan must be above 0 hours, or left empty.';
    if (Number.isFinite(price) && price < 0) return 'Price must be 0 or more, or left empty.';
    part.lifespan = Number.isFinite(lifespan) ? lifespan : null;
    part.price = Number.isFinite(price) && price > 0 ? price : null;
    saveState();
    renderAll();
    return '';
}

function hoursStat(label, value, sub) {
    const card = h('div', 'stat-card');
    card.appendChild(h('p', 'stat-label', label));
    card.appendChild(h('p', 'stat-value', value));
    if (sub) card.appendChild(h('p', 'stat-sub', sub));
    return card;
}

export function renderHours() {
    if (!hoursEl) return;
    hoursEl.replaceChildren();
    const pid = currentPrinter();
    const many = hasManyPrinters();
    const all = printerStats(pid);
    const month = many ? calcStats('month', pid) : calcStats('month');
    hoursEl.appendChild(hoursStat('Print hours', fmtDuration(all.minutes) || '0h',
        all.timedPrints === 0 ? 'Log print times to track hours' : `from ${all.timedPrints} of ${all.total} prints with a time`));
    hoursEl.appendChild(hoursStat('This month', fmtDuration(month.minutes) || '0h', `${month.total} ${month.total === 1 ? 'print' : 'prints'}`));
    const overdue = maintenanceStatus(all, many ? pid : null).filter((m) => m.due).length;
    hoursEl.appendChild(hoursStat('Reminders due', String(overdue), overdue === 0 ? 'All caught up' : 'See the list below'));
}

function buildPartRow(id, part, hoursNow) {
    const row = h('div', 'part-row');
    row.dataset.id = id;
    const used = partUsage(part, hoursNow);

    const head = h('div', 'part-head');
    head.appendChild(h('strong', 'part-name', part.name));
    head.appendChild(h('span', 'chip chip-mini', `${fmtNum(used)} h since swap`));
    row.appendChild(head);

    if (Number.isFinite(part.lifespan)) {
        const fraction = used / part.lifespan;
        const level = fraction >= 1 ? 'fail' : fraction >= 0.75 ? 'warn' : 'ok';
        const bar = h('div', 'bar');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', String(Math.min(100, Math.round(fraction * 100))));
        bar.setAttribute('aria-label', `${part.name} life used`);
        const fill = h('div', level === 'ok' ? 'bar-fill' : `bar-fill ${level}`);
        fill.style.width = Math.min(100, Math.round(fraction * 100)) + '%';
        bar.appendChild(fill);
        row.appendChild(bar);
        const text = fraction >= 1
            ? `Past its ${fmtNum(part.lifespan)} h life by ${fmtNum(used - part.lifespan)} h. Time for a new one.`
            : `${fmtNum(used)} of ${fmtNum(part.lifespan)} h used (${Math.round(fraction * 100)}%)`;
        const status = h('p', fraction >= 1 ? 'list-sub part-over' : 'list-sub', text);
        status.dataset.level = level;
        row.appendChild(status);
    }

    const rate = partRate(part);
    const bits = [`Last swapped ${formatDate(part.lastDate)}`];
    if (Number.isFinite(part.price)) bits.push(fmtMoney(part.price));
    if (rate !== null) bits.push(`about ${fmtMoney(rate, 3)} per print hour`);
    row.appendChild(h('p', 'list-sub', bits.join(' \u00B7 ')));

    // inline editor
    const form = h('div', 'part-edit');
    form.hidden = true;
    const life = h('input', 'number-input');
    life.type = 'number'; life.min = '0'; life.step = 'any'; life.className = 'number-input part-life-edit';
    life.placeholder = 'Lifespan (h)';
    life.setAttribute('aria-label', `${part.name} lifespan in hours`);
    life.value = Number.isFinite(part.lifespan) ? String(part.lifespan) : '';
    const price = h('input', 'number-input');
    price.type = 'number'; price.min = '0'; price.step = 'any'; price.className = 'number-input part-price-edit';
    price.placeholder = 'Price';
    price.setAttribute('aria-label', `${part.name} price`);
    price.value = Number.isFinite(part.price) ? String(part.price) : '';
    const save = h('button', 'btn btn-primary btn-small part-save', 'Save');
    save.type = 'button';
    const cancel = h('button', 'btn btn-outline btn-small', 'Cancel');
    cancel.type = 'button';
    const error = h('p', 'error-text');
    error.hidden = true;
    save.addEventListener('click', () => {
        const problem = updatePart(id, {
            lifespan: life.value.trim() === '' ? NaN : life.valueAsNumber,
            price: price.value.trim() === '' ? NaN : price.valueAsNumber
        });
        if (problem) showError(error, problem);
    });
    cancel.addEventListener('click', () => { form.hidden = true; clearError(error); });
    form.append(life, price, save, cancel);

    const actions = h('div', 'card-actions');
    const swap = h('button', 'btn btn-outline btn-small part-swap', 'Swapped today');
    swap.type = 'button';
    swap.addEventListener('click', () => swapPart(id));
    const edit = h('button', 'btn btn-outline btn-small', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => { form.hidden = !form.hidden; });
    const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deletePart(id));
    actions.append(swap, edit, del);
    row.append(actions, form, error);
    return row;
}

export function renderParts() {
    if (!partsListEl) return;
    partsListEl.replaceChildren();
    const pid = currentPrinter();
    const entries = Object.entries(state.parts).filter(([, p]) => (p.printerId || '') === pid);
    if (entries.length === 0) {
        partsListEl.appendChild(h('p', 'secondary-text small', 'No parts tracked yet. Add your nozzle and build plate below.'));
    }
    const hoursNow = totalPrintHours(pid);
    for (const [id, part] of entries) partsListEl.appendChild(buildPartRow(id, part, hoursNow));

    for (const [key, name] of [['nozzle', 'Nozzle'], ['plate', 'Build plate']]) {
        const quick = $('part-quick-' + key);
        if (quick) quick.hidden = entries.some(([, p]) => p.name.toLowerCase() === name.toLowerCase());
    }

    const rate = partsWearRate(pid);
    partsSummaryEl.replaceChildren();
    if (rate > 0) {
        const wear = (pid === '' ? state.settings.printer : state.settings.printers[pid]).wear;
        partsSummaryEl.appendChild(h('p', 'setting-hint', `With the prices and lifespans you entered, parts wear out at about ${fmtMoney(rate, 3)} per print hour.` +
            (wear > 0 ? ` Your wear rate in Settings is ${fmtMoney(wear, 3)}.` : '')));
        if (Math.abs((wear || 0) - rate) > 0.00005) {
            const use = h('button', 'btn btn-outline btn-small', 'Use this as my wear rate');
            use.type = 'button';
            use.id = 'use-wear-rate';
            use.addEventListener('click', () => {
                commitSettings((st) => { (pid === '' ? st.printer : st.printers[pid]).wear = Math.round(rate * 10000) / 10000; });
                notify('Wear rate updated. It is now added to each print\'s cost.');
            });
            partsSummaryEl.appendChild(use);
        }
    } else {
        partsSummaryEl.appendChild(h('p', 'setting-hint', 'Enter a price and a lifespan for a part to see what it costs per print hour, and use that as your wear rate.'));
    }
}

function buildPartsCard() {
    const card = settingCard('Wear parts', 'Track how many print hours a nozzle, plate or other part has done since you last swapped it. Lifespan and price are optional and yours to choose.');
    partsListEl = h('div', 'parts-list');
    partsListEl.id = 'parts-list';
    card.appendChild(partsListEl);

    const quick = h('div', 'data-actions');
    for (const [key, name] of [['nozzle', 'Nozzle'], ['plate', 'Build plate']]) {
        const b = h('button', 'btn btn-outline btn-small', `Track ${name.toLowerCase()}`);
        b.type = 'button';
        b.id = 'part-quick-' + key;
        b.addEventListener('click', () => addPart({ name }));
        quick.appendChild(b);
    }
    card.appendChild(quick);

    const form = h('div', 'maint-form part-form');
    const name = h('input', 'text-input');
    name.type = 'text'; name.id = 'part-name'; name.maxLength = 40;
    name.placeholder = 'Part, e.g., Hardened nozzle';
    name.setAttribute('aria-label', 'Part name');
    const life = h('input', 'number-input');
    life.type = 'number'; life.id = 'part-life'; life.min = '0'; life.step = 'any';
    life.placeholder = 'Lifespan (h)';
    life.setAttribute('aria-label', 'Lifespan in hours');
    const price = h('input', 'number-input');
    price.type = 'number'; price.id = 'part-price'; price.min = '0'; price.step = 'any';
    price.placeholder = 'Price';
    price.setAttribute('aria-label', 'Price');
    const add = h('button', 'btn btn-primary', 'Add part');
    add.type = 'button';
    add.id = 'part-add-button';
    const error = h('p', 'error-text');
    error.id = 'part-error';
    error.hidden = true;
    const submit = () => {
        const problem = addPart({
            name: name.value,
            lifespan: life.value.trim() === '' ? NaN : life.valueAsNumber,
            price: price.value.trim() === '' ? NaN : price.valueAsNumber
        });
        if (problem) return showError(error, problem);
        clearError(error);
        name.value = ''; life.value = ''; price.value = '';
        name.focus();
        return true;
    };
    add.addEventListener('click', submit);
    for (const el of [name, life, price]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    form.append(name, life, price, add);
    card.append(form, error);

    partsSummaryEl = h('div', 'parts-summary');
    partsSummaryEl.id = 'parts-summary';
    card.appendChild(partsSummaryEl);
    return card;
}

let pickerEl = null;
let pickerSelect = null;

/** "Printer: [select]" row, shown only when there is more than one printer. */
function renderPrinterPicker() {
    if (!pickerEl) return;
    const ids = printerIds();
    pickerEl.hidden = ids.length < 2;
    if (ids.length < 2) { upkeepPrinter = ''; return; }
    const keep = currentPrinter();
    pickerSelect.replaceChildren();
    ids.forEach((id, i) => {
        const o = h('option', 'option-input', `${i + 1}. ${printerName(id)}`);
        o.value = id;
        pickerSelect.appendChild(o);
    });
    pickerSelect.value = keep;
}

/** Build the Upkeep tab: hours, wear parts, then the reminder list. */
export function buildUpkeepTab() {
    const root = $('upkeep-content');
    pickerEl = h('div', 'range-bar printer-pick');
    pickerEl.id = 'upkeep-printer-bar';
    const pickLabel = h('label', null, 'Printer');
    pickLabel.htmlFor = 'upkeep-printer';
    pickerSelect = h('select', 'dropdown');
    pickerSelect.id = 'upkeep-printer';
    pickerSelect.addEventListener('change', () => { upkeepPrinter = pickerSelect.value; renderUpkeep(); });
    pickerEl.append(pickLabel, pickerSelect, h('p', 'range-note', 'Hours, wear parts and reminders are counted for each printer on its own.'));
    hoursEl = h('div', 'stat-grid hours-grid');
    hoursEl.id = 'hours-panel';
    root.append(pickerEl, hoursEl, buildPartsCard(), buildDryingCard(), buildMaintenanceCard());
    renderUpkeep();
}

// ---------- Filament drying ----------

let dryListEl = null;
let drySummaryEl = null;
let dryDaysInput = null;

/** Status line for one spool: when it was dried or opened. */
export function dryingStatus(id, spool) {
    const days = daysOpen(id, spool);
    if (isValidDate(spool.driedDate)) return `Dried ${formatDate(spool.driedDate)} (${plural(days, 'day')} ago)`;
    if (days === null) return 'Not used yet, so still sealed as far as the app knows';
    return `Open for ${plural(days, 'day')}, never dried`;
}

export function setDriedDate(id, value) {
    const spool = state.spools[id];
    if (!spool) return '';
    if (value !== '' && !isValidDate(value)) return 'Pick a valid date, or clear it.';
    spool.driedDate = value;
    saveState();
    renderAll();
    return '';
}

export function renderDrying() {
    if (!dryListEl) return;
    dryListEl.replaceChildren();
    const spools = activeSpools()
        .map(([id, spool]) => ({ id, spool, due: needsDrying(id, spool), days: daysOpen(id, spool) }))
        .sort((a, b) => Number(b.due) - Number(a.due) || (b.days ?? -1) - (a.days ?? -1));
    const limit = state.settings.dryDays;
    if (dryDaysInput && document.activeElement !== dryDaysInput) dryDaysInput.value = String(limit);

    const due = spools.filter((s) => s.due).length;
    drySummaryEl.textContent = spools.length === 0 ? ''
        : limit === 0 ? 'The drying reminder is off. Set a number of days above to turn it on.'
        : due === 0 ? `Nothing needs drying right now (reminder after ${plural(limit, 'day')}).`
        : `${plural(due, 'spool')} may need drying (open ${plural(limit, 'day')} or more).`;

    if (spools.length === 0) {
        dryListEl.appendChild(emptyState_('No active spools.', 'Add a spool on the Filament tab to track its drying.'));
        return;
    }
    for (const { id, spool, due: isDue } of spools) {
        const row = h('div', isDue ? 'dry-row is-due' : 'dry-row');
        row.dataset.id = id;
        row.appendChild(makeSwatch(spoolHex(spool)));
        const text = h('div', 'dry-text');
        text.appendChild(h('span', 'list-title', `${spool.brand}, ${spool.color}`));
        text.appendChild(h('span', 'list-sub', `${String(spool.material || 'other').toUpperCase()} \u00B7 ${dryingStatus(id, spool)}`));
        const advice = dryingAdvice(materialKey(spool));
        if (advice) text.appendChild(h('span', 'list-sub dry-advice', advice));
        row.appendChild(text);
        if (isDue) row.appendChild(makeBadge('Needs drying?', 'amber'));

        const controls = h('div', 'dry-controls');
        const today = h('button', 'btn btn-outline btn-small', 'Dried today');
        today.type = 'button';
        today.addEventListener('click', () => markDried(id));
        const date = h('input', 'date-input dry-date');
        date.type = 'date';
        date.value = isValidDate(spool.driedDate) ? spool.driedDate : '';
        date.setAttribute('aria-label', `Last dried date for ${spool.brand}, ${spool.color}`);
        const error = h('p', 'error-text');
        error.hidden = true;
        date.addEventListener('change', () => {
            const problem = setDriedDate(id, date.value);
            if (problem) showError(error, problem);
        });
        controls.append(today, date);
        row.append(controls, error);
        dryListEl.appendChild(row);
    }
}

function buildDryingCard() {
    const card = settingCard('Filament drying', 'Spools soak up moisture once opened, which causes stringing and weak prints. Log when you dry a spool, and get a nudge when one has sat open too long.');
    const form = h('div', 'maint-form dry-limit');
    const label = h('label', null, 'Remind me after');
    label.htmlFor = 'dry-days-upkeep';
    dryDaysInput = h('input', 'number-input');
    dryDaysInput.type = 'number';
    dryDaysInput.id = 'dry-days-upkeep';
    dryDaysInput.min = '0';
    dryDaysInput.max = '365';
    dryDaysInput.step = '1';
    dryDaysInput.addEventListener('change', () => {
        const v = dryDaysInput.valueAsNumber;
        commitSettings((st) => { st.dryDays = Number.isFinite(v) ? v : 0; });
    });
    form.append(label, dryDaysInput, h('span', 'unit', 'days open (0 = off)'));
    card.appendChild(form);
    drySummaryEl = h('p', 'setting-hint');
    drySummaryEl.id = 'dry-summary';
    card.appendChild(drySummaryEl);
    dryListEl = h('div', 'dry-list');
    dryListEl.id = 'dry-list';
    card.appendChild(dryListEl);
    card.appendChild(h('p', 'setting-hint', 'Drying temperatures and times for each material are in the Material guide on the Filament tab.'));
    return card;
}
