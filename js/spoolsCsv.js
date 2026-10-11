import { remainingOf } from './calc.js';
import { MAX_IMPORT_BYTES } from './constants.js';
import { MAX_CSV_ROWS, parseCsv, parseLooseDate } from './csv.js';
import { csvCell, downloadBlob, readFileText, setDataMessage } from './data.js';
import { renderAll } from './render.js';
import { normalizeState, saveState, setState, state } from './state.js';
import { $, cleanText, fmtGrams, guessHex, isHex, isObject, locationOf, notify, todayLocal, uid } from './util.js';

// ---------- Spools as CSV: export to a spreadsheet, import rows as new spools ----------

const HEADERS = ['Brand', 'Material', 'Color', 'Hex', 'Weight (g)', 'Price', 'Date bought', 'Location', 'Grams left', 'Status', 'Dried on', 'Empty spool (g)', 'Leftover (g)'];

export function buildSpoolsCsv() {
    const entries = Object.entries(state.spools).filter(([, s]) => isObject(s))
        .sort((a, b) => String(a[1].date || '').localeCompare(String(b[1].date || '')));
    const rows = [HEADERS];
    for (const [id, s] of entries) {
        rows.push([
            s.brand, s.material || 'other', s.color, s.hex || '', s.startGrams, Number.isFinite(s.price) ? s.price : '',
            s.date || '', locationOf(s), fmtGrams(Math.max(0, remainingOf(id, s))), s.archived ? 'Archived' : 'Active',
            s.driedDate || '', s.emptyGrams || '', s.archived && Number.isFinite(s.leftover) ? s.leftover : ''
        ]);
    }
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const ALIASES = {
    brand: ['brand', 'manufacturer', 'maker', 'vendor'],
    material: ['material', 'type', 'filamenttype'],
    color: ['color', 'colour'],
    hex: ['hex', 'colorhex', 'colourhex'],
    weight: ['weightg', 'weight', 'startgrams', 'grams', 'spoolweight', 'netweightg', 'netweight'],
    price: ['price', 'cost', 'paid'],
    date: ['datebought', 'date', 'bought', 'purchased', 'purchasedate', 'dateadded'],
    location: ['location', 'storage', 'storedin', 'storagelocation'],
    left: ['gramsleft', 'left', 'remaining', 'remainingg'],
    status: ['status', 'state'],
    dried: ['driedon', 'drieddate', 'dried'],
    empty: ['emptyspoolg', 'emptyspool', 'emptyweight', 'tare'],
    leftover: ['leftoverg', 'leftover']
};

const num = (text) => {
    const t = String(text ?? '').trim().replace(/[^0-9.\-]/g, '');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
};
const unDefuse = (t) => (/^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t);
const norm = (v) => String(v ?? '').trim().toLowerCase();
const same = (s, n) => [s.brand, s.material, s.color, s.date, s.startGrams, Number.isFinite(s.price) ? s.price : ''].map(norm).join('|')
    === [n.brand, n.material, n.color, n.date, n.startGrams, Number.isFinite(n.price) ? n.price : ''].map(norm).join('|');

/**
 * Turn spool CSV text into a plan. Nothing is changed here.
 * Returns { error } or { spools: [spool], duplicates, invalid }. A row that matches a spool you already have
 * (same brand, material, colour, date, weight and price) is a duplicate; an identical row counts against one copy only.
 */
export function planSpoolsCsvImport(text, existing = state.spools, dateFormat = state.settings.dateFormat) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { error: 'That file has no rows to import.' };
    if (rows.length - 1 > MAX_CSV_ROWS) return { error: `That file has more than ${MAX_CSV_ROWS} rows.` };
    const keys = rows[0].map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const col = {};
    for (const [field, names] of Object.entries(ALIASES)) {
        const i = keys.findIndex((k) => names.includes(k));
        if (i !== -1) col[field] = i;
    }
    if (col.brand === undefined || col.color === undefined || col.weight === undefined) {
        return { error: 'The first row needs at least "Brand", "Color" and "Weight (g)" columns.' };
    }
    const cell = (row, f) => (col[f] === undefined ? '' : unDefuse(String(row[col[f]] ?? '').trim()));

    const available = Object.values(existing).filter(isObject).map((s) => ({ s, used: false }));
    const spools = [];
    let duplicates = 0;
    let invalid = 0;
    for (const row of rows.slice(1)) {
        const brand = cleanText(cell(row, 'brand'), 40);
        const color = cleanText(cell(row, 'color'), 40);
        const weight = num(cell(row, 'weight'));
        if (brand === '' || color === '' || weight === null || !(weight > 0) || weight > 100000) { invalid++; continue; }
        const price = num(cell(row, 'price'));
        const spool = {
            brand,
            material: cleanText(cell(row, 'material'), 20).toLowerCase() || 'other',
            color,
            hex: isHex(cell(row, 'hex')) ? cell(row, 'hex').toLowerCase() : (guessHex(color) || ''),
            startGrams: weight,
            price: price !== null && price >= 0 ? price : null,
            date: parseLooseDate(cell(row, 'date'), dateFormat),
            driedDate: parseLooseDate(cell(row, 'dried'), dateFormat),
            archived: /^archiv/i.test(cell(row, 'status'))
        };
        const hit = available.find((a) => !a.used && same(a.s, spool));
        if (hit) { hit.used = true; duplicates++; continue; }
        available.push({ s: spool, used: true });   // an identical later row in this file is a duplicate of this one

        const place = cleanText(cell(row, 'location'), 40);
        if (place) spool.location = place;
        const empty = num(cell(row, 'empty'));
        if (empty !== null && empty > 0 && empty <= 5000) spool.emptyGrams = empty;
        // "Grams left" below the weight on a new spool becomes a correction, since no prints use it yet
        const left = num(cell(row, 'left'));
        if (left !== null && left >= 0 && left < weight) spool.adjust = left - weight;
        const leftover = num(cell(row, 'leftover'));
        if (spool.archived && leftover !== null && leftover >= 0 && leftover <= 100000) spool.leftover = leftover;
        spools.push(spool);
    }
    return { spools, duplicates, invalid };
}

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function exportSpoolsCsv() {
    if (Object.keys(state.spools).length === 0) return setDataMessage('There are no spools to export yet.', true);
    downloadBlob(new Blob(['﻿' + buildSpoolsCsv()], { type: 'text/csv;charset=utf-8' }), `print-tracker-spools-${todayLocal()}.csv`);
    setDataMessage('Exported your spools as a CSV file.');
}

async function importSpoolsCsv() {
    const input = $('import-spools-csv-file');
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setDataMessage('That file is too large to import.', true);
    let text;
    try { text = await readFileText(file); } catch (error) { return setDataMessage('That file could not be read.', true); }

    const plan = planSpoolsCsvImport(text);
    if (plan.error) return setDataMessage(`Spool import failed: ${plan.error} Nothing was changed.`, true);
    const notes = [];
    if (plan.duplicates) notes.push(`${plan.duplicates} already here, skipped`);
    if (plan.invalid) notes.push(`${plan.invalid} without a brand, colour or valid weight, skipped`);
    if (plan.spools.length === 0) return setDataMessage(`Nothing new to add${notes.length ? ` (${notes.join('; ')})` : ''}.`);

    const ok = confirm(`Add ${count(plan.spools.length, 'spool')} from this CSV?${notes.length ? ` (${notes.join('; ')}.)` : ''} Your current data stays as it is.`);
    if (!ok) return setDataMessage('Spool import cancelled. Nothing was changed.');

    const before = JSON.parse(JSON.stringify(state));
    for (const s of plan.spools) state.spools[uid()] = s;
    saveState();
    renderAll();
    setDataMessage(`Added ${count(plan.spools.length, 'spool')} from the CSV.${notes.length ? ` ${notes.join('; ')}.` : ''}`);
    notify(`Added ${count(plan.spools.length, 'spool')}.`, {
        action: { label: 'Undo', onClick: () => { setState(normalizeState(before)); saveState(); renderAll(); setDataMessage('Spool import undone.'); } }
    });
}

$('export-spools-csv-button').addEventListener('click', exportSpoolsCsv);
$('import-spools-csv-button').addEventListener('click', () => $('import-spools-csv-file').click());
$('import-spools-csv-file').addEventListener('change', importSpoolsCsv);
