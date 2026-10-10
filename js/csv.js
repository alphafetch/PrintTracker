import { FAIL_REASONS } from './constants.js';
import { cleanProfile, state } from './state.js';
import { cleanText, isObject, isValidDate, normalizeLink, uid, validMinutes } from './util.js';

// ---------- CSV import ----------

export const MAX_CSV_ROWS = 5000;

/** Split CSV text into rows of cells. Handles quotes, doubled quotes and line breaks inside quotes. */
export function parseCsv(text) {
    const src = String(text).replace(/^﻿/, '');
    const firstLine = src.split(/\r\n|\n|\r/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQuotes = false;
    for (const ch of firstLine) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (!inQuotes && ch in counts) counts[ch]++;
    }
    const delimiter = Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), ',');

    const rows = [];
    let row = [];
    let cell = '';
    inQuotes = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
            } else cell += ch;
        } else if (ch === '"' && cell === '') {
            inQuotes = true;
        } else if (ch === delimiter) {
            row.push(cell); cell = '';
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            rows.push(row); row = [];
        } else cell += ch;
    }
    if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const HEADER_ALIASES = {
    date: ['date', 'printed', 'printdate', 'printedon'],
    name: ['name', 'title', 'print', 'printname', 'model', 'file'],
    result: ['result', 'status', 'outcome', 'success'],
    minutes: ['printtimemin', 'printtimeminutes', 'minutes', 'time', 'duration', 'printtime'],
    grams: ['filamentg', 'filament', 'grams', 'weight', 'weightg', 'g'],
    spools: ['spools', 'spool', 'filaments'],
    link: ['link', 'url'],
    notes: ['notes', 'note', 'comments', 'comment'],
    failReason: ['failurereason', 'failreason', 'reason'],
    profile: ['profile', 'profilename'],
    layer: ['layerheight', 'layer'],
    infill: ['infill'],
    supports: ['supports', 'support']
};

function columnMap(header) {
    const keys = header.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const map = {};
    for (const [field, names] of Object.entries(HEADER_ALIASES)) {
        const idx = keys.findIndex((k) => names.includes(k));
        if (idx !== -1) map[field] = idx;
    }
    return map;
}

/** Our CSV export puts a ' in front of cells that start with = + - or @. Undo that. */
function unDefuse(text) {
    return /^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
}

export function parseLooseDate(text, dateFormat) {
    const t = String(text).trim().split(/[T ]/)[0];
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
    let y, mo, d;
    if (m) { y = m[1]; mo = m[2]; d = m[3]; }
    else {
        m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
        if (!m) return '';
        y = m[3];
        if (dateFormat === 'dmy') { d = m[1]; mo = m[2]; } else { mo = m[1]; d = m[2]; }
    }
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isValidDate(iso) ? iso : '';
}

export function parseResult(text) {
    const t = String(text).trim().toLowerCase();
    if (t === '') return true;
    if (/^(fail|failed|failure|false|no|n|0|bad|error)/.test(t)) return false;
    return true;
}

export function parseMinutes(text) {
    const t = String(text).trim().toLowerCase();
    if (t === '') return null;
    let minutes = null;
    let m = /^(\d+):(\d{1,2})$/.exec(t);
    if (m) minutes = Number(m[1]) * 60 + Number(m[2]);
    else if ((m = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?$/.exec(t)) && (m[1] || m[2])) {
        minutes = Math.round(Number(m[1] || 0) * 60 + Number(m[2] || 0));
    } else if (/^\d+(\.\d+)?$/.test(t)) minutes = Math.round(Number(t));
    return minutes === null ? null : validMinutes(minutes);
}

/** Match a failure reason by its label or its key; anything else is left blank. */
export function parseFailReason(text) {
    const t = String(text).trim().toLowerCase();
    if (t === '') return '';
    const hit = FAIL_REASONS.find(([key, label]) => key === t || label.toLowerCase() === t);
    return hit ? hit[0] : '';
}

function parseGrams(text) {
    const n = Number(String(text).replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : 0;
}

/** "Brand Color (120g); Other Spool (30g)" -> [{ label, grams|null }] */
function parseSpoolCell(text) {
    return String(text).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
        const m = /^(.*?)\s*\(\s*([\d.]+)\s*g\s*\)\s*$/i.exec(part);
        return m ? { label: m[1].trim(), grams: parseGrams(m[2]) } : { label: part, grams: null };
    }).filter((s) => s.label !== '');
}

/**
 * Turn CSV text into a plan: the prints (and archived stand-in spools) that would be added.
 * Nothing is changed here. Returns { error } or { prints, spools, duplicates, invalid }.
 */
export function planCsvImport(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { error: 'That file has no rows to import.' };
    if (rows.length - 1 > MAX_CSV_ROWS) return { error: `That file has more than ${MAX_CSV_ROWS} rows.` };

    const col = columnMap(rows[0]);
    if (col.name === undefined || col.date === undefined) {
        return { error: 'The first row needs at least "Date" and "Name" columns.' };
    }

    const cell = (row, field) => (col[field] === undefined ? '' : unDefuse(String(row[col[field]] ?? '').trim()));

    const spoolsByLabel = new Map();
    for (const s of Object.values(state.spools)) {
        if (!isObject(s)) continue;
        const key = `${s.brand} ${s.color}`.trim().toLowerCase();
        if (!spoolsByLabel.has(key) || (spoolsByLabel.get(key).archived && !s.archived)) spoolsByLabel.set(key, s);
    }
    const idOfSpool = new Map(Object.entries(state.spools).map(([id, s]) => [s, id]));

    const newSpools = {};            // id -> spool
    const newByLabel = new Map();    // label -> id
    const spoolFor = (label) => {
        const key = label.trim().toLowerCase();
        const have = spoolsByLabel.get(key);
        if (have) return idOfSpool.get(have);
        if (newByLabel.has(key)) return newByLabel.get(key);
        const id = uid();
        newSpools[id] = {
            brand: cleanText(label, 40) || 'Imported filament', material: 'other', color: '(imported)', hex: '',
            startGrams: 1000, price: null, date: '', archived: true
        };
        newByLabel.set(key, id);
        return id;
    };

    const seen = new Set(Object.values(state.prints).filter(isObject)
        .map((p) => `${p.date}|${String(p.name).toLowerCase()}|${p.minutes ?? ''}`));

    const prints = [];
    let duplicates = 0;
    let invalid = 0;
    for (const row of rows.slice(1)) {
        const name = cleanText(cell(row, 'name'), 80);
        const date = parseLooseDate(cell(row, 'date'), state.settings.dateFormat);
        if (name === '' || date === '') { invalid++; continue; }

        const minutes = parseMinutes(cell(row, 'minutes'));
        const key = `${date}|${name.toLowerCase()}|${minutes ?? ''}`;
        if (seen.has(key)) { duplicates++; continue; }
        seen.add(key);

        const total = parseGrams(cell(row, 'grams'));
        const parts = parseSpoolCell(cell(row, 'spools'));
        const usage = [];
        if (parts.length > 0) {
            const known = parts.reduce((sum, s) => sum + (s.grams || 0), 0);
            const unknown = parts.filter((s) => s.grams === null).length;
            const share = unknown > 0 ? Math.max(0, total - known) / unknown : 0;
            for (const s of parts) usage.push({ spoolId: spoolFor(s.label), grams: s.grams === null ? share : s.grams });
        } else if (total > 0) {
            usage.push({ spoolId: spoolFor('Imported filament'), grams: total });
        }

        const link = normalizeLink(cell(row, 'link'));
        const result = parseResult(cell(row, 'result'));
        prints.push({
            name, date, result,
            link: link === null ? '' : link, usage, minutes,
            notes: cleanText(cell(row, 'notes'), 500),
            failReason: result ? '' : parseFailReason(cell(row, 'failReason')),
            profile: cleanProfile({
                name: cell(row, 'profile'), layer: cell(row, 'layer'),
                infill: cell(row, 'infill'), supports: cell(row, 'supports')
            })
        });
    }

    // Make sure stand-in spools are big enough that nothing shows as negative.
    for (const [label, id] of newByLabel) {
        void label;
        let used = 0;
        for (const p of prints) for (const u of p.usage) if (u.spoolId === id) used += u.grams;
        newSpools[id].startGrams = Math.max(1000, Math.ceil(used / 1000) * 1000);
    }

    if (prints.length === 0 && duplicates === 0) return { error: 'No usable rows were found. Each row needs a name and a valid date.' };
    return { prints, spools: newSpools, duplicates, invalid };
}
