import { costOfPrint, energyCostOfPrint, totalGramsOfPrint, usageOf, wearCostOfPrint } from './calc.js';
import { failReasonLabel, MAX_IMPORT_BYTES, SCHEMA_VERSION } from './constants.js';
import { planCsvImport } from './csv.js';
import { renderDashboard } from './dashboard.js';
import { renderAll, safeRender } from './render.js';
import { syncAllSettings } from './settingsKit.js';
import { takeSnapshot } from './snapshots.js';
import { cleanAms, cleanParts, cleanFailReason, cleanMaintenance, cleanProfile, cleanSettings, cleanUi, emptyState, normalizeState, saveState, setState, state } from './state.js';
import { applyTheme } from './theme.js';
import { $, notify, uid, cleanText, isSafeId, fmtGrams, isHex, isObject, isValidDate, normalizeLink, todayLocal, validMinutes } from './util.js';

// ---------- Data: export, import, clear ----------

export const dataMessage = $('data-message');
export const importFile = $('import-file');
export const importCsvFile = $('import-csv-file');

export function setDataMessage(text, isError = false) {
    dataMessage.textContent = text;
    dataMessage.className = isError ? 'fail-text' : 'body-text';
    dataMessage.hidden = false;
}

export function renderData() {
    const prints = Object.keys(state.prints).length;
    const spools = Object.keys(state.spools).length;
    const queued = Object.keys(state.queue).length;
    const exported = state.lastExported ? new Date(state.lastExported) : null;
    const when = exported && !Number.isNaN(exported.getTime()) ? exported.toLocaleString() : 'never';
    $('data-summary').textContent = `${prints} prints, ${spools} spools, ${queued} queue items. Last exported: ${when}.`;
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportData() {
    state.lastExported = new Date().toISOString();
    saveState();

    downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }),
        `print-tracker-${todayLocal()}.json`);

    renderData();
    safeRender('the dashboard', renderDashboard);
    setDataMessage('Exported a backup file.');
}

/** Quote a CSV cell, and defuse spreadsheet formulas (=, +, -, @) in user text. */
export function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function buildPrintsCsv() {
    const rows = [['Date', 'Name', 'Result', 'Print time (min)', 'Filament (g)', 'Est. cost', 'Spools', 'Link', 'Notes',
        'Failure reason', 'Profile', 'Layer height', 'Infill', 'Supports']];
    const entries = Object.values(state.prints).filter(isObject)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    for (const p of entries) {
        const prof = isObject(p.profile) ? p.profile : {};
        const spoolNames = usageOf(p).map((u) => {
            const s = state.spools[u.spoolId];
            return `${s ? `${s.brand} ${s.color}` : 'Deleted spool'} (${fmtGrams(Number(u.grams) || 0)}g)`;
        }).join('; ');
        rows.push([
            p.date || '', p.name || '', p.result ? 'Success' : 'Failure',
            validMinutes(Number(p.minutes)) || '', fmtGrams(totalGramsOfPrint(p)),
            (costOfPrint(p) + energyCostOfPrint(p) + wearCostOfPrint(p)).toFixed(2), spoolNames, p.link || '', p.notes || '',
            failReasonLabel(p.failReason), prof.name || '', prof.layer || '', prof.infill || '', prof.supports || ''
        ]);
    }
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function exportCsv() {
    if (Object.keys(state.prints).length === 0) {
        setDataMessage('There are no prints to export yet.', true);
        return;
    }
    downloadBlob(new Blob(['﻿' + buildPrintsCsv()], { type: 'text/csv;charset=utf-8' }),
        `print-tracker-prints-${todayLocal()}.csv`);
    setDataMessage('Exported your prints as a CSV file.');
}

export function readFileText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

/** Check and clean an imported backup. Returns { state, missingRefs } or { error }. */
export function validateImport(data) {
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
            hex: isHex(s.hex) ? s.hex.toLowerCase() : '',
            startGrams: s.startGrams,
            price: typeof s.price === 'number' && s.price >= 0 ? s.price : null,
            date: isValidDate(s.date) ? s.date : '',
            driedDate: isValidDate(s.driedDate) ? s.driedDate : '',
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
        prints[id] = {
            name, date: p.date, result: Boolean(p.result), link: link === null ? '' : link, usage,
            minutes: validMinutes(p.minutes),
            notes: cleanText(p.notes, 500),
            failReason: cleanFailReason(p.failReason, Boolean(p.result)),
            profile: cleanProfile(p.profile)
        };
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
            // null means "the backup did not include this", so the current value is kept
            maintenance: data.maintenance === undefined ? null : cleanMaintenance(data.maintenance),
            settings: data.settings === undefined ? null : cleanSettings(data.settings),
            hideArchived: Boolean(data.hideArchived),
            theme: data.theme === 'light' || data.theme === 'dark' ? data.theme : null,
            lastExported: typeof data.lastExported === 'string' ? data.lastExported : null,
            ui: cleanUi(data.ui),
            ams: cleanAms(data.ams, spools),
            parts: cleanParts(data.parts)
        }
    };
}

export async function handleImport() {
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

    takeSnapshot('Before import');
    applyState(incoming);
    const extra = result.missingRefs > 0
        ? ` ${result.missingRefs} filament entr${result.missingRefs === 1 ? 'y refers' : 'ies refer'} to spools that are not in the backup.`
        : '';
    setDataMessage(`Imported ${Object.keys(state.prints).length} prints, ${Object.keys(state.spools).length} spools and ${Object.keys(state.queue).length} queue items.${extra}`);
}

/** Make an imported or restored state the current one. Keeps this browser's theme and settings if it carries none. */
export function applyState(incoming) {
    if (incoming.theme === null) incoming.theme = state.theme;
    if (incoming.settings === null) incoming.settings = state.settings;
    if (incoming.maintenance === null) incoming.maintenance = state.maintenance;
    setState(incoming);
    saveState();
    applyTheme();
    syncAllSettings();
    renderAll();
}

/** Add the prints in a CSV file to what is already here (nothing is replaced). */
export async function handleCsvImport() {
    const file = importCsvFile.files && importCsvFile.files[0];
    importCsvFile.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setDataMessage('That file is too large to import.', true);

    let text;
    try {
        text = await readFileText(file);
    } catch (error) {
        return setDataMessage('That file could not be read.', true);
    }

    const plan = planCsvImport(text);
    if (plan.error) return setDataMessage(`CSV import failed: ${plan.error} Nothing was changed.`, true);

    if (plan.prints.length === 0) {
        return setDataMessage(`Nothing new to add: all ${plan.duplicates} ${plan.duplicates === 1 ? 'row is' : 'rows are'} already here.`);
    }

    const standIns = Object.keys(plan.spools).length;
    const bits = [];
    if (plan.duplicates) bits.push(`${plan.duplicates} already here, skipped`);
    if (plan.invalid) bits.push(`${plan.invalid} without a name or valid date, skipped`);
    if (standIns) bits.push(`${standIns} archived stand-in ${standIns === 1 ? 'spool' : 'spools'} will be created for filament that is not in your list`);
    const ok = confirm(`Add ${plan.prints.length} ${plan.prints.length === 1 ? 'print' : 'prints'} from this CSV to your data?` +
        (bits.length ? ` (${bits.join('; ')}.)` : '') + ' Your current data stays as it is.');
    if (!ok) return setDataMessage('CSV import cancelled. Nothing was changed.');

    Object.assign(state.spools, plan.spools);
    for (const p of plan.prints) state.prints[uid()] = p;
    saveState();
    renderAll();
    setDataMessage(`Added ${plan.prints.length} ${plan.prints.length === 1 ? 'print' : 'prints'} from the CSV.` +
        (bits.length ? ` ${bits.join('; ')}.` : ''));
}

$('export-button').addEventListener('click', exportData);
$('export-csv-button').addEventListener('click', exportCsv);
$('import-button').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', handleImport);
$('import-csv-button').addEventListener('click', () => importCsvFile.click());
importCsvFile.addEventListener('change', handleCsvImport);
$('clear-data-button').addEventListener('click', () => {
    if (!confirm('Delete ALL prints, spools and queue items from this browser? This cannot be undone. Export first if you are unsure.')) return;
    takeSnapshot('Before delete all');
    const before = JSON.parse(JSON.stringify(state));
    const { theme, settings } = state;
    setState(emptyState());
    state.theme = theme;
    state.settings = settings;
    saveState();
    renderAll();
    setDataMessage('All data deleted. Undo below, or restore a snapshot.');
    notify('All data deleted.', {
        action: {
            label: 'Undo',
            onClick: () => {
                applyState(normalizeState(before));
                setDataMessage('Your data is back.');
            }
        }
    });
});
