'use strict';

/* =====================================================================
   Print Tracker
   Everything is stored in one localStorage entry (see STORAGE_KEY):

   {
     schemaVersion: 1,
     prints: { <id>: { name, date, result (true = success), link, usage: [{ spoolId, grams }] } },
     spools: { <id>: { brand, material, color, startGrams, price (number|null), date, archived } },
     queue:  { <id>: { name, link, done } },
     hideArchived: false,
     lastExported: null
   }

   Remaining grams for a spool are never stored: they are calculated from
   the spool's starting weight minus the grams logged in prints.
   ===================================================================== */

// ---------- Constants ----------

const STORAGE_KEY = 'printTracker';
const CORRUPT_KEY = 'printTracker.corrupt';
const SCHEMA_VERSION = 1;
const LOW_FRACTION = 0.25;   // at or below this share left: "low"
const WARN_FRACTION = 0.5;   // at or below this share left: warning color
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const Sections = Object.freeze({
    DASH: 'dashboard',
    PRINTS: 'prints',
    FILA: 'filament',
    QUEUE: 'queue',
    DATA: 'data'
});

const TABS = [
    { label: 'Dashboard',   idPrefix: 'dash',   section: Sections.DASH },
    { label: 'Prints',      idPrefix: 'prints', section: Sections.PRINTS },
    { label: 'Filament',    idPrefix: 'fila',   section: Sections.FILA },
    { label: 'Print Queue', idPrefix: 'queue',  section: Sections.QUEUE },
    { label: 'Data Export', idPrefix: 'data',   section: Sections.DATA }
];

// ---------- Small helpers ----------

const $ = (id) => document.getElementById(id);

/** Create an element with an optional class and text (text is never parsed as HTML). */
function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function uid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // randomUUID only exists on HTTPS/localhost, so fall back for plain-HTTP LAN use.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function todayLocal() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

function isValidDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    const d = new Date(Date.UTC(y, mo - 1, da));
    return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === da;
}

function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === 'string' ? iso : '');
    return m ? `${m[2]}/${m[3]}/${m[1]}` : 'No date';
}

function fmtGrams(n) {
    return String(Math.round(n * 10) / 10);
}

function fmtMoney(n) {
    return '$' + n.toFixed(2);
}

function cleanText(v, max = 200) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/**
 * Returns '' for an empty link, a clean http(s) URL string, or null if the
 * text is not an acceptable web address. Anything that is not http/https
 * (for example "javascript:...") is rejected.
 */
function normalizeLink(value) {
    const text = String(value ?? '').trim();
    if (text === '') return '';
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text;
    try {
        const url = new URL(withScheme);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.href;
    } catch (error) {
        return null;
    }
}

function linkLabel(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
        return url;
    }
}

function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
    return false;
}

function clearError(el) {
    el.textContent = '';
    el.hidden = true;
}

let toastTimer = null;
function notify(message, isError = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.className = isError ? 'error' : '';
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 4500);
}

// ---------- State and storage ----------

function emptyState() {
    return {
        schemaVersion: SCHEMA_VERSION,
        prints: {},
        spools: {},
        queue: {},
        hideArchived: false,
        lastExported: null
    };
}

function normalizeState(data) {
    const s = isObject(data) ? data : {};
    return {
        schemaVersion: SCHEMA_VERSION,
        prints: isObject(s.prints) ? s.prints : {},
        spools: isObject(s.spools) ? s.spools : {},
        queue: isObject(s.queue) ? s.queue : {},
        hideArchived: Boolean(s.hideArchived),
        lastExported: typeof s.lastExported === 'string' ? s.lastExported : null
    };
}

function loadState() {
    let raw = null;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
        console.error('Could not read browser storage.', error);
    }
    if (!raw) return emptyState();

    try {
        return normalizeState(JSON.parse(raw));
    } catch (error) {
        console.error('Saved data is corrupted. Keeping a copy and starting fresh.', error);
        try { localStorage.setItem(CORRUPT_KEY, raw); } catch (e) { /* nothing more to do */ }
        return emptyState();
    }
}

let state = loadState();

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
    } catch (error) {
        console.error(error);
        notify('Could not save: browser storage is full or blocked. Export your data to keep it.', true);
        return false;
    }
}

// ---------- Calculations ----------

function usageOf(print) {
    return print && Array.isArray(print.usage) ? print.usage.filter(isObject) : [];
}

/** Total grams logged against a spool (failed prints count too). */
function gramsUsedOfSpool(spoolId, excludePrintId = null) {
    let total = 0;
    for (const [printId, print] of Object.entries(state.prints)) {
        if (printId === excludePrintId) continue;
        for (const u of usageOf(print)) {
            if (u.spoolId === spoolId) total += Number(u.grams) || 0;
        }
    }
    return total;
}

function printsUsingSpool(spoolId) {
    return Object.values(state.prints).filter((p) => usageOf(p).some((u) => u.spoolId === spoolId)).length;
}

function activeSpools() {
    return Object.entries(state.spools).filter(([, s]) => isObject(s) && !s.archived);
}

function calcStats() {
    const prints = Object.values(state.prints).filter(isObject);
    const spools = Object.entries(state.spools).filter(([, s]) => isObject(s));

    const total = prints.length;
    const succeeded = prints.filter((p) => p.result).length;

    let grams = 0;
    let usedCost = 0;
    const byMaterial = {};
    const byMonth = {};

    for (const p of prints) {
        for (const u of usageOf(p)) {
            const g = Number(u.grams) || 0;
            grams += g;
            const spool = state.spools[u.spoolId];
            const material = spool ? String(spool.material || 'other').toLowerCase() : 'unknown';
            byMaterial[material] = (byMaterial[material] || 0) + g;
            if (spool && Number.isFinite(spool.price) && Number(spool.startGrams) > 0) {
                usedCost += g * (spool.price / spool.startGrams);
            }
        }
        if (isValidDate(p.date)) {
            const key = p.date.slice(0, 7);
            byMonth[key] = (byMonth[key] || 0) + 1;
        }
    }

    let spent = 0;
    let pricedGrams = 0;
    for (const [, s] of spools) {
        if (Number.isFinite(s.price)) {
            spent += s.price;
            pricedGrams += Number(s.startGrams) || 0;
        }
    }

    const active = spools.filter(([, s]) => !s.archived);
    const low = active.filter(([id, s]) => {
        const start = Number(s.startGrams) || 0;
        return start > 0 && (start - gramsUsedOfSpool(id)) / start <= LOW_FRACTION;
    }).length;

    return {
        total, succeeded, failed: total - succeeded,
        grams, usedCost, spent,
        costPerGram: pricedGrams > 0 ? spent / pricedGrams : null,
        hasPrices: spools.some(([, s]) => Number.isFinite(s.price)),
        byMaterial, byMonth,
        spoolCount: spools.length, activeCount: active.length, lowCount: low
    };
}

// ---------- Tabs ----------

const sectionEls = {
    [Sections.DASH]: $('dashboard'),
    [Sections.PRINTS]: $('prints'),
    [Sections.FILA]: $('filament'),
    [Sections.QUEUE]: $('queue'),
    [Sections.DATA]: $('data')
};
const tabButtons = {};

function buildHeader() {
    const headerEl = $('header');

    const title = h('h1', 'headers', 'Print Tracker');
    title.id = 'main-header';
    title.addEventListener('click', () => showTab(Sections.DASH));
    headerEl.appendChild(title);

    for (const tab of TABS) {
        const b = h('button', 'tab-buttons', tab.label);
        b.type = 'button';
        b.id = tab.idPrefix + '-button';
        b.addEventListener('click', () => showTab(tab.section));
        headerEl.appendChild(b);
        tabButtons[tab.section] = b;
    }
}

function showTab(section) {
    if (!sectionEls[section]) {
        console.error('showTab called with an unknown section:', section);
        section = Sections.DASH;
    }
    for (const [name, el] of Object.entries(sectionEls)) {
        el.hidden = name !== section;
    }
    for (const [name, button] of Object.entries(tabButtons)) {
        button.classList.toggle('active', name === section);
    }
}

// ---------- Rendering: everything ----------

function safeRender(name, fn) {
    try {
        fn();
    } catch (error) {
        console.error(`Failed to render ${name}.`, error);
        notify(`Could not display ${name}. Check the console for details.`, true);
    }
}

function renderAll() {
    safeRender('the dashboard', renderDashboard);
    safeRender('prints', renderPrints);
    safeRender('spools', renderSpools);
    safeRender('the queue', renderQueue);
    safeRender('data info', renderData);
}

// ---------- Rendering: dashboard ----------

function statCard(label, value, sub) {
    const card = h('div', 'stat-card');
    card.appendChild(h('p', 'stat-label', label));
    card.appendChild(h('p', 'stat-value', value));
    if (sub) card.appendChild(h('p', 'stat-sub', sub));
    return card;
}

function renderDashboard() {
    const root = $('dashboard-content');
    root.replaceChildren();

    const stats = calcStats();

    if (stats.total === 0 && stats.spoolCount === 0) {
        root.appendChild(h('p', 'warn-text', 'Nothing to show yet. Add a spool in the Filament tab, then log a print.'));
        return;
    }

    const rate = stats.total > 0 ? Math.round((stats.succeeded / stats.total) * 100) + '%' : '-';
    const grid = h('div', 'stat-grid');
    grid.appendChild(statCard('Total prints', String(stats.total)));
    grid.appendChild(statCard('Success rate', rate, `${stats.succeeded} succeeded, ${stats.failed} failed`));
    grid.appendChild(statCard('Filament used', fmtGrams(stats.grams) + 'g',
        stats.total > 0 ? `~${fmtGrams(stats.grams / stats.total)}g per print` : 'Includes failed prints'));
    grid.appendChild(statCard('Total spent', stats.hasPrices ? fmtMoney(stats.spent) : 'No prices',
        stats.costPerGram !== null ? `~$${stats.costPerGram.toFixed(3)} per gram` : 'Add prices to spools'));
    grid.appendChild(statCard('Cost of prints', stats.usedCost > 0 ? fmtMoney(stats.usedCost) : '-',
        'Estimated from spool prices'));
    grid.appendChild(statCard('Spools', `${stats.activeCount} active`,
        `${stats.lowCount} low, ${stats.spoolCount - stats.activeCount} archived`));
    root.appendChild(grid);

    // Filament used by material
    const materials = Object.entries(stats.byMaterial).sort((a, b) => b[1] - a[1]);
    if (materials.length > 0) {
        const block = h('div', 'row-card dash-block');
        block.appendChild(h('h3', 'headers section-header', 'Filament by material'));
        const max = materials[0][1] || 1;
        for (const [material, g] of materials) {
            const row = h('div', 'mat-row');
            row.appendChild(h('span', 'mat-name', material.toUpperCase()));
            const bar = h('div', 'bar');
            const fill = h('div', 'bar-fill');
            fill.style.width = Math.max(2, Math.round((g / max) * 100)) + '%';
            bar.appendChild(fill);
            row.appendChild(bar);
            const share = stats.grams > 0 ? Math.round((g / stats.grams) * 100) : 0;
            row.appendChild(h('span', 'mat-value', `${fmtGrams(g)}g (${share}%)`));
            block.appendChild(row);
        }
        root.appendChild(block);
    }

    // Prints per month (most recent 12 months that have prints)
    const months = Object.entries(stats.byMonth).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
    if (months.length > 0) {
        const block = h('div', 'row-card dash-block');
        block.appendChild(h('h3', 'headers section-header', 'Prints per month'));
        const max = Math.max(...months.map(([, n]) => n));
        for (const [key, n] of months) {
            const [y, m] = key.split('-');
            const row = h('div', 'mat-row');
            row.appendChild(h('span', 'mat-name', `${MONTHS[Number(m) - 1]} ${y}`));
            const bar = h('div', 'bar');
            const fill = h('div', 'bar-fill');
            fill.style.width = Math.round((n / max) * 100) + '%';
            bar.appendChild(fill);
            row.appendChild(bar);
            row.appendChild(h('span', 'mat-value', String(n)));
            block.appendChild(row);
        }
        root.appendChild(block);
    }
}

// ---------- Rendering: prints ----------

const printsCard = h('div', 'card');
$('prints').appendChild(printsCard);

function renderPrints() {
    printsCard.replaceChildren();

    const plus = h('button', 'acc-buttons', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Add a print');
    plus.addEventListener('click', () => openPrintPopup());
    printsCard.appendChild(plus);

    const entries = Object.entries(state.prints).filter(([, p]) => isObject(p));
    if (entries.length === 0) {
        printsCard.appendChild(h('p', 'warn-text', 'No prints yet! Click the + to start a new print!'));
        return;
    }

    entries.sort((a, b) => String(b[1].date || '').localeCompare(String(a[1].date || '')));
    for (const [id, print] of entries) showPrintCard(id, print);
}

function showPrintCard(id, p) {
    const card = h('div', 'row-card');
    card.dataset.id = id;

    const title = h('h2', 'headers section-header no-bottom-mar', p.name || 'Untitled print');
    const badge = h('span', p.result ? 'badge badge-green-override' : 'badge badge-red-override',
        p.result ? 'Success' : 'Failure');
    title.appendChild(badge);
    card.appendChild(title);

    const meta = h('div', 'body-text no-top-mar secondary-text card-meta');
    meta.append(formatDate(p.date));
    const safeLink = normalizeLink(p.link);
    if (safeLink) {
        meta.append(' | ');
        const a = h('a', 'link-text', linkLabel(safeLink));
        a.href = safeLink;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = safeLink;
        meta.appendChild(a);
    }
    card.appendChild(meta);

    const parts = usageOf(p).map((u) => {
        const spool = state.spools[u.spoolId];
        const name = spool ? `${spool.brand}, ${spool.color}` : 'Deleted spool';
        return `${name}: ${fmtGrams(Number(u.grams) || 0)}g`;
    });
    if (parts.length > 0) {
        card.appendChild(h('div', 'body-text no-top-mar secondary-text card-meta', parts.join(' & ')));
    }

    const buttons = h('div', 'no-top-mar flex-row');
    buttons.style.padding = '10px 25px';

    const edit = h('button', 'buttons-filled inline-button oot-button-sz', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => openPrintPopup({ printId: id }));
    buttons.appendChild(edit);

    const del = h('button', 'buttons-empty inline-button oot-button-sz', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deletePrint(id));
    buttons.appendChild(del);

    card.appendChild(buttons);
    printsCard.appendChild(card);
}

function deletePrint(id) {
    const print = state.prints[id];
    if (!print) return;
    if (!confirm(`Delete this print?: "${print.name}" This cannot be undone.`)) return;
    delete state.prints[id];
    saveState();
    renderAll();
}

// ---------- Print popup (create and edit) ----------

const printPopup = $('print-popup');
const printPopupTitle = $('print-popup-title');
const nameInput = $('name-tinput');
const printDateInput = $('date-tinput');
const linkInput = $('link-tinput');
const resultSuccess = $('result-rinput1');
const resultFailure = $('result-rinput2');
const rowList = $('filament-row-list');
const rowTemplate = $('filament-row-template');
const addRowButton = $('add-filament-row-button');
const printError = $('print-error');
const savePrintButton = $('add-print-button');
const cancelPrintButton = $('cancel-print-button');

let editingPrintId = null;   // null means "create a new print"
let pendingQueueId = null;   // queue item to mark done once the print is saved

function openPrintPopup({ printId = null, name = '', link = '', queueId = null } = {}) {
    if (!printId && activeSpools().length === 0) {
        notify('Add a filament spool first (Filament tab).', true);
        return;
    }

    editingPrintId = printId;
    pendingQueueId = queueId;
    const print = printId ? state.prints[printId] : null;

    printPopupTitle.textContent = print ? 'Edit Print' : 'Create Print';
    savePrintButton.textContent = print ? 'Save Changes' : 'Create Print';

    nameInput.value = print ? (print.name || '') : name;
    printDateInput.value = print && isValidDate(print.date) ? print.date : todayLocal();
    linkInput.value = print ? (print.link || '') : link;
    if (print && !print.result) {
        resultFailure.checked = true;
    } else {
        resultSuccess.checked = true;
    }

    rowList.replaceChildren();
    const usage = print ? usageOf(print) : [];
    if (usage.length > 0) {
        for (const u of usage) addFilamentRow({ spoolId: u.spoolId, grams: u.grams });
    } else {
        addFilamentRow();
    }

    clearError(printError);
    printPopup.style.display = 'block';
    nameInput.focus();
}

function closePrintPopup() {
    printPopup.style.display = 'none';
    editingPrintId = null;
    pendingQueueId = null;
}

function spoolLabel(id, spool) {
    const left = (Number(spool.startGrams) || 0) - gramsUsedOfSpool(id);
    const material = String(spool.material || 'other').toUpperCase();
    return `${spool.brand}, ${spool.color}: ${material} (~${fmtGrams(left)}g left)${spool.archived ? ' [archived]' : ''}`;
}

/** Fill a <select> with the active spools (plus the selected one even if archived or deleted). */
function fillSpoolSelect(select, selectedId) {
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

function firstUnusedSpoolId() {
    const inUse = new Set(Array.from(rowList.querySelectorAll('select'), (s) => s.value));
    const active = activeSpools();
    const free = active.find(([id]) => !inUse.has(id));
    return (free || active[0] || [null])[0];
}

function addFilamentRow({ spoolId = null, grams = '' } = {}) {
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

function updateRowControls() {
    const rows = rowList.querySelectorAll('.filament-row');
    rows.forEach((row) => {
        row.querySelector('.row-remove-button').hidden = rows.length === 1;
    });
    addRowButton.disabled = rows.length >= activeSpools().length;
}

/** Non-blocking warning when a row uses more grams than the spool has left. */
function updateRowHint(row) {
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

function savePrint() {
    const name = nameInput.value.trim();
    const date = printDateInput.value;
    const link = normalizeLink(linkInput.value);

    if (name === '') return showError(printError, 'Give the print a name.');
    if (!isValidDate(date)) return showError(printError, 'Pick a valid date.');
    if (link === null) return showError(printError, 'The link must be a valid http:// or https:// address.');

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

    const record = { name, date, result: resultSuccess.checked, link, usage };
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

// ---------- Rendering: spools ----------

const filamentCard = h('div', 'card');
filamentCard.id = 'spools';
$('filament').appendChild(filamentCard);

const archiveOffBox = $('archive-off-checkbox');

archiveOffBox.addEventListener('change', () => {
    state.hideArchived = archiveOffBox.checked;
    saveState();
    renderSpools();
});

function renderSpools() {
    filamentCard.replaceChildren();
    archiveOffBox.checked = state.hideArchived;

    const plus = h('button', 'acc-buttons', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Add a spool');
    plus.addEventListener('click', openSpoolPopup);
    filamentCard.appendChild(plus);

    const all = Object.entries(state.spools).filter(([, s]) => isObject(s));
    if (all.length === 0) {
        filamentCard.appendChild(h('p', 'warn-text', 'No spools yet! Click the + to add a spool!'));
        return;
    }

    const visible = all.filter(([, s]) => !s.archived || !state.hideArchived);
    if (visible.length === 0) {
        filamentCard.appendChild(h('p', 'warn-text',
            "All spools are archived. Uncheck 'Hide archived' to see them, or click the + to add a new spool."));
        return;
    }

    // Active spools first, archived last
    visible.sort((a, b) => Number(Boolean(a[1].archived)) - Number(Boolean(b[1].archived)));
    for (const [id, spool] of visible) showSpoolCard(id, spool);
}

function showSpoolCard(id, s) {
    const card = h('div', 'row-card');
    card.dataset.id = id;

    const start = Number(s.startGrams) || 0;
    const used = gramsUsedOfSpool(id);
    const remaining = start - used;
    const fraction = start > 0 ? remaining / start : 0;
    const pct = Math.max(0, Math.round(fraction * 100));
    const level = fraction > WARN_FRACTION ? 'ok' : fraction > LOW_FRACTION ? 'warn' : 'fail';

    const title = h('h2', 'headers section-header no-bottom-mar', `${s.brand}, ${s.color}`);
    title.appendChild(h('span', 'badge', String(s.material || 'other').toUpperCase()));
    if (s.archived) title.appendChild(h('span', 'badge badge-purple-override', 'Archived'));
    card.appendChild(title);

    const line = h('p', 'body-text no-top-mar no-bottom-mar');
    line.textContent = remaining >= 0
        ? `~${fmtGrams(remaining)}g remaining of ${fmtGrams(start)}g`
        : `Over by ~${fmtGrams(-remaining)}g (${fmtGrams(used)}g logged of ${fmtGrams(start)}g)`;

    const percent = h('span', level === 'ok' ? 'body-text inline-text' : level === 'warn' ? 'warn-text inline-text' : 'fail-text inline-text',
        `(~${pct}% remaining)`);
    line.appendChild(percent);

    if (!s.archived && fraction <= LOW_FRACTION) {
        line.appendChild(h('span', 'badge badge-red-override low-mar-badge-override low-badge-gap',
            remaining <= 0 ? 'Empty!' : 'Filament Low!'));
    }
    card.appendChild(line);

    const bar = h('div', 'bar');
    const fill = h('div', level === 'ok' ? 'bar-fill' : level === 'warn' ? 'bar-fill warn' : 'bar-fill fail');
    fill.style.width = Math.min(100, pct) + '%';
    bar.appendChild(fill);
    card.appendChild(bar);

    const hasPrice = Number.isFinite(s.price);
    const perGram = hasPrice && start > 0 ? s.price / start : null;
    const lower = h('div', 'body-text no-top-mar no-bottom-mar secondary-text card-meta',
        [
            hasPrice ? fmtMoney(s.price) : 'No price',
            formatDate(s.date),
            perGram ? `~$${perGram.toFixed(3)}/g` : '-'
        ].join(' | '));
    card.appendChild(lower);

    const buttons = h('div', 'no-top-mar flex-row');
    buttons.style.padding = '10px 25px';

    const archive = h('button', 'buttons-filled inline-button oot-button-sz', s.archived ? 'Unarchive' : 'Archive');
    archive.type = 'button';
    archive.addEventListener('click', () => archiveSpool(id));
    buttons.appendChild(archive);

    const del = h('button', 'buttons-empty inline-button oot-button-sz', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deleteSpool(id));
    buttons.appendChild(del);

    card.appendChild(buttons);
    filamentCard.appendChild(card);
}

function archiveSpool(id) {
    const spool = state.spools[id];
    if (!spool) return;
    spool.archived = !spool.archived;
    saveState();
    renderAll();
}

function deleteSpool(id) {
    const spool = state.spools[id];
    if (!spool) return;
    const uses = printsUsingSpool(id);
    if (uses > 0) {
        alert(`This spool is used in ${uses} print${uses === 1 ? '' : 's'}. Archive it instead.`);
        return;
    }
    if (!confirm(`Delete this spool?: "${spool.brand}, ${spool.color}" This cannot be undone.`)) return;
    delete state.spools[id];
    saveState();
    renderAll();
}

// ---------- Spool popup ----------

const spoolPopup = $('filament-add-popup');
const brandInput = $('brand-tinput');
const materialDropdown = $('material-dropdown');
const colorInput = $('color-tinput');
const gramsInput = $('grams-ninput');
const priceInput = $('price-ninput');
const spoolDateInput = $('date-dinput');
const spoolError = $('spool-error');

function openSpoolPopup() {
    brandInput.value = '';
    materialDropdown.value = 'pla';
    colorInput.value = '';
    gramsInput.value = '';
    priceInput.value = '';
    spoolDateInput.value = todayLocal();
    clearError(spoolError);
    spoolPopup.style.display = 'block';
    brandInput.focus();
}

function closeSpoolPopup() {
    spoolPopup.style.display = 'none';
}

function saveSpool() {
    const brand = brandInput.value.trim();
    const color = colorInput.value.trim();
    const grams = gramsInput.valueAsNumber;
    const hasPriceText = priceInput.value.trim() !== '';
    const price = priceInput.valueAsNumber;

    if (brand === '') return showError(spoolError, 'Enter a brand.');
    if (color === '') return showError(spoolError, 'Enter a color.');
    if (!Number.isFinite(grams) || grams <= 0) return showError(spoolError, 'Enter the spool weight in grams (above 0).');
    if (hasPriceText && (!Number.isFinite(price) || price < 0)) return showError(spoolError, 'The price must be 0 or more, or left empty.');
    if (!isValidDate(spoolDateInput.value)) return showError(spoolError, 'Pick a valid date.');

    state.spools[uid()] = {
        brand,
        material: materialDropdown.value,
        color,
        startGrams: grams,
        price: hasPriceText ? price : null,
        date: spoolDateInput.value,
        archived: false
    };

    saveState();
    closeSpoolPopup();
    renderAll();
    return true;
}

$('add-spool-button').addEventListener('click', saveSpool);
$('cancel-spool-button').addEventListener('click', closeSpoolPopup);

// ---------- Queue ----------

const queueNameInput = $('queue-name-input');
const queueLinkInput = $('queue-link-input');
const queueError = $('queue-error');

function addQueueItem() {
    const name = queueNameInput.value.trim();
    const link = normalizeLink(queueLinkInput.value);
    if (name === '') return showError(queueError, 'Enter what you want to print.');
    if (link === null) return showError(queueError, 'The link must be a valid http:// or https:// address.');

    state.queue[uid()] = { name, link, done: false };
    queueNameInput.value = '';
    queueLinkInput.value = '';
    clearError(queueError);
    saveState();
    renderQueue();
    queueNameInput.focus();
    return true;
}

function renderQueue() {
    const list = $('queue-list');
    list.replaceChildren();

    const entries = Object.entries(state.queue).filter(([, q]) => isObject(q));
    $('queue-clear-done-button').hidden = !entries.some(([, q]) => q.done);

    if (entries.length === 0) {
        list.appendChild(h('p', 'warn-text', 'Nothing queued. Add something you want to print.'));
        return;
    }

    entries.sort((a, b) => Number(Boolean(a[1].done)) - Number(Boolean(b[1].done)));
    for (const [id, item] of entries) {
        const row = h('div', item.done ? 'queue-item done' : 'queue-item');

        const check = h('input', 'radio-input');
        check.type = 'checkbox';
        check.checked = Boolean(item.done);
        check.setAttribute('aria-label', 'Mark as done');
        check.addEventListener('change', () => {
            state.queue[id].done = check.checked;
            saveState();
            renderQueue();
        });
        row.appendChild(check);

        const name = h('span', 'queue-name');
        name.append(item.name || 'Untitled');
        const safeLink = normalizeLink(item.link);
        if (safeLink) {
            name.append(' ');
            const a = h('a', 'link-text', `(${linkLabel(safeLink)})`);
            a.href = safeLink;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.title = safeLink;
            name.appendChild(a);
        }
        row.appendChild(name);

        if (!item.done) {
            const log = h('button', 'small-button', 'Log print');
            log.type = 'button';
            log.addEventListener('click', () => {
                openPrintPopup({ name: item.name, link: item.link || '', queueId: id });
            });
            row.appendChild(log);
        }

        const del = h('button', 'small-button small-button-danger', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => {
            delete state.queue[id];
            saveState();
            renderQueue();
        });
        row.appendChild(del);

        list.appendChild(row);
    }
}

$('queue-add-button').addEventListener('click', addQueueItem);
queueNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addQueueItem(); });
queueLinkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addQueueItem(); });
$('queue-clear-done-button').addEventListener('click', () => {
    const doneIds = Object.entries(state.queue).filter(([, q]) => isObject(q) && q.done).map(([id]) => id);
    doneIds.forEach((id) => { delete state.queue[id]; });
    saveState();
    renderQueue();
    notify(`Cleared ${doneIds.length} finished item${doneIds.length === 1 ? '' : 's'}.`);
});

// ---------- Data: export, import, clear ----------

const dataMessage = $('data-message');
const importFile = $('import-file');

function setDataMessage(text, isError = false) {
    dataMessage.textContent = text;
    dataMessage.className = isError ? 'fail-text' : 'body-text';
    dataMessage.hidden = false;
}

function renderData() {
    const prints = Object.keys(state.prints).length;
    const spools = Object.keys(state.spools).length;
    const queued = Object.keys(state.queue).length;
    const exported = state.lastExported ? new Date(state.lastExported) : null;
    const when = exported && !Number.isNaN(exported.getTime()) ? exported.toLocaleString() : 'never';
    $('data-summary').textContent = `${prints} prints, ${spools} spools, ${queued} queue items. Last exported: ${when}.`;
}

function exportData() {
    state.lastExported = new Date().toISOString();
    saveState();

    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `print-tracker-${todayLocal()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    renderData();
    setDataMessage('Exported a backup file.');
}

function readFileText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

function isSafeId(id) {
    return /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== '__proto__';
}

/** Check and clean an imported backup. Returns { state, missingRefs } or { error }. */
function validateImport(data) {
    if (!isObject(data) || !isObject(data.prints) || !isObject(data.spools)) {
        return { error: 'This does not look like a Print Tracker backup.' };
    }
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > SCHEMA_VERSION) {
        return { error: 'This backup was made by a newer version of the app.' };
    }

    const spools = {};
    for (const [id, s] of Object.entries(data.spools)) {
        if (!isSafeId(id) || !isObject(s)) return { error: 'A spool entry is malformed.' };
        const brand = cleanText(s.brand, 40);
        const color = cleanText(s.color, 40);
        if (brand === '' || color === '') return { error: `A spool is missing its brand or color (id ${id}).` };
        if (typeof s.startGrams !== 'number' || !(s.startGrams > 0)) {
            return { error: `Spool "${brand}, ${color}" has an invalid weight.` };
        }
        spools[id] = {
            brand,
            material: cleanText(s.material, 20).toLowerCase() || 'other',
            color,
            startGrams: s.startGrams,
            price: typeof s.price === 'number' && s.price >= 0 ? s.price : null,
            date: isValidDate(s.date) ? s.date : '',
            archived: Boolean(s.archived)
        };
    }

    let missingRefs = 0;
    const prints = {};
    for (const [id, p] of Object.entries(data.prints)) {
        if (!isSafeId(id) || !isObject(p)) return { error: 'A print entry is malformed.' };
        const name = cleanText(p.name, 80);
        if (name === '') return { error: `A print has no name (id ${id}).` };
        if (!isValidDate(p.date)) return { error: `Print "${name}" has an invalid date.` };
        const rawUsage = p.usage === undefined ? [] : p.usage;
        if (!Array.isArray(rawUsage)) return { error: `Print "${name}" has invalid filament usage.` };

        const usage = [];
        for (const u of rawUsage) {
            if (!isObject(u) || typeof u.spoolId !== 'string' || typeof u.grams !== 'number' || !(u.grams >= 0)) {
                return { error: `Print "${name}" has invalid filament usage.` };
            }
            if (!spools[u.spoolId]) missingRefs++;
            usage.push({ spoolId: u.spoolId, grams: u.grams });
        }
        const link = normalizeLink(typeof p.link === 'string' ? p.link : '');
        prints[id] = { name, date: p.date, result: Boolean(p.result), link: link === null ? '' : link, usage };
    }

    const queue = {};
    if (data.queue !== undefined) {
        if (!isObject(data.queue)) return { error: 'The queue section is malformed.' };
        for (const [id, q] of Object.entries(data.queue)) {
            if (!isSafeId(id) || !isObject(q)) return { error: 'A queue entry is malformed.' };
            const name = cleanText(q.name, 80);
            if (name === '') return { error: `A queue item has no name (id ${id}).` };
            const link = normalizeLink(typeof q.link === 'string' ? q.link : '');
            queue[id] = { name, link: link === null ? '' : link, done: Boolean(q.done) };
        }
    }

    return {
        missingRefs,
        state: {
            schemaVersion: SCHEMA_VERSION,
            prints, spools, queue,
            hideArchived: Boolean(data.hideArchived),
            lastExported: typeof data.lastExported === 'string' ? data.lastExported : null
        }
    };
}

async function handleImport() {
    const file = importFile.files && importFile.files[0];
    importFile.value = '';
    if (!file) return;

    if (file.size > MAX_IMPORT_BYTES) return setDataMessage('That file is too large to be a backup.', true);

    let data;
    try {
        data = JSON.parse(await readFileText(file));
    } catch (error) {
        return setDataMessage('That file could not be read as JSON.', true);
    }

    const result = validateImport(data);
    if (result.error) return setDataMessage(`Import failed: ${result.error} Nothing was changed.`, true);

    const incoming = result.state;
    const ok = confirm(
        `Replace your current data (${Object.keys(state.prints).length} prints, ${Object.keys(state.spools).length} spools) ` +
        `with this backup (${Object.keys(incoming.prints).length} prints, ${Object.keys(incoming.spools).length} spools)? ` +
        'This cannot be undone. Export first if you are unsure.'
    );
    if (!ok) return setDataMessage('Import cancelled. Nothing was changed.');

    state = incoming;
    saveState();
    renderAll();
    const extra = result.missingRefs > 0
        ? ` ${result.missingRefs} filament entr${result.missingRefs === 1 ? 'y refers' : 'ies refer'} to spools that are not in the backup.`
        : '';
    setDataMessage(`Imported ${Object.keys(state.prints).length} prints, ${Object.keys(state.spools).length} spools and ${Object.keys(state.queue).length} queue items.${extra}`);
}

$('export-button').addEventListener('click', exportData);
$('import-button').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', handleImport);
$('clear-data-button').addEventListener('click', () => {
    if (!confirm('Delete ALL prints, spools and queue items from this browser? This cannot be undone. Export first if you are unsure.')) return;
    state = emptyState();
    saveState();
    renderAll();
    setDataMessage('All data deleted.');
});

// ---------- Popups: Escape and backdrop click ----------

printPopup.addEventListener('click', (e) => { if (e.target === printPopup) closePrintPopup(); });
spoolPopup.addEventListener('click', (e) => { if (e.target === spoolPopup) closeSpoolPopup(); });
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePrintPopup();
        closeSpoolPopup();
    }
});

// ---------- Start ----------

// Popups live at the top level of the page so they still show when opened from another tab
// (for example "Log print" on the Queue tab).
document.body.appendChild(printPopup);
document.body.appendChild(spoolPopup);

buildHeader();
renderAll();
showTab(Sections.DASH);
