'use strict';

/* =====================================================================
   Print Tracker
   Everything is stored in one localStorage entry (see STORAGE_KEY):

   {
     schemaVersion: 1,
     prints: { <id>: { name, date, result (true = success), link, usage: [{ spoolId, grams }],
                       minutes (number|null), notes (string) } },
     spools: { <id>: { brand, material, color, hex ('#rrggbb' or ''), startGrams,
                       price (number|null), date, archived } },
     queue:  { <id>: { name, link, done } },
     maintenance: { <id>: { name, unit: 'hours'|'days'|'prints', every, lastDate, atHours, atPrints } },
     settings: { accent, background, bgStrength, animate, density, currency, dateFormat, lowPercent,
                 defaultMaterial, defaultSpoolGrams, backupDays, shortcuts,
                 printer: { model, nickname, nozzle, date, price, watts, kwhPrice } },
     hideArchived: false,
     theme: 'dark' | 'light' | null (null = follow the system),
     lastExported: null
   }

   `minutes`, `notes`, `hex`, `theme`, `settings` and `maintenance` are optional
   additions; older saves without them load fine.

   Remaining grams for a spool are never stored: they are calculated from
   the spool's starting weight minus the grams logged in prints.
   ===================================================================== */

// ---------- Constants ----------

const STORAGE_KEY = 'printTracker';
const CORRUPT_KEY = 'printTracker.corrupt';
const SCHEMA_VERSION = 1;
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_MINUTES = 9999 * 60 + 59;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KNOWN_MATERIALS = ['pla', 'petg', 'abs', 'asa', 'tpu'];

const MATERIAL_COLORS = {
    pla: '#F59E0B',
    petg: '#38BDF8',
    abs: '#F87171',
    asa: '#A78BFA',
    tpu: '#4ADE80',
    other: '#94A3B8',
    unknown: '#64748B'
};

const COLOR_WORDS = {
    black: '#1c1c1e', white: '#f2f2f2', gray: '#8e8e93', grey: '#8e8e93', silver: '#c0c0c8',
    red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047', lime: '#c0ca33',
    teal: '#00897b', cyan: '#00bcd4', blue: '#1e88e5', navy: '#1a237e', purple: '#8e24aa',
    violet: '#7e57c2', magenta: '#d81b60', pink: '#ec407a', brown: '#6d4c41', beige: '#d7c4a3',
    tan: '#c8a97e', gold: '#d4af37', bronze: '#a9743a', copper: '#b87333', clear: '#cfd8dc',
    transparent: '#cfd8dc', natural: '#e8dfc8'
};
const DEFAULT_SWATCH = '#6b7280';

const Sections = Object.freeze({
    DASH: 'dashboard',
    PRINTS: 'prints',
    FILA: 'filament',
    QUEUE: 'queue',
    DATA: 'data',
    SETTINGS: 'settings'
});

const TABS = [
    { label: 'Dashboard', idPrefix: 'dash',     section: Sections.DASH,     icon: 'dashboard' },
    { label: 'Prints',    idPrefix: 'prints',   section: Sections.PRINTS,   icon: 'cube' },
    { label: 'Filament',  idPrefix: 'fila',     section: Sections.FILA,     icon: 'spool' },
    { label: 'Queue',     idPrefix: 'queue',    section: Sections.QUEUE,    icon: 'list' },
    { label: 'Data',      idPrefix: 'data',     section: Sections.DATA,     icon: 'download' },
    { label: 'Settings',  idPrefix: 'settings', section: Sections.SETTINGS, icon: 'gear' }
];

// Accent colors. Each has a dark-theme and a light-theme variant so text stays readable.
const ACCENTS = {
    amber:   { label: 'Amber',   dark: { accent: '#f59e0b', strong: '#fbbf24', link: '#fbbf24' }, light: { accent: '#f59e0b', strong: '#d97706', link: '#b45309' } },
    sky:     { label: 'Sky',     dark: { accent: '#38bdf8', strong: '#7dd3fc', link: '#7dd3fc' }, light: { accent: '#0ea5e9', strong: '#0284c7', link: '#0369a1' } },
    emerald: { label: 'Emerald', dark: { accent: '#34d399', strong: '#6ee7b7', link: '#6ee7b7' }, light: { accent: '#10b981', strong: '#059669', link: '#047857' } },
    teal:    { label: 'Teal',    dark: { accent: '#2dd4bf', strong: '#5eead4', link: '#5eead4' }, light: { accent: '#14b8a6', strong: '#0d9488', link: '#0f766e' } },
    violet:  { label: 'Violet',  dark: { accent: '#a78bfa', strong: '#c4b5fd', link: '#c4b5fd' }, light: { accent: '#8b5cf6', strong: '#7c3aed', link: '#6d28d9' } },
    rose:    { label: 'Rose',    dark: { accent: '#fb7185', strong: '#fda4af', link: '#fda4af' }, light: { accent: '#f43f5e', strong: '#e11d48', link: '#be123c' } }
};

const BACKGROUNDS = [
    { key: 'layers',    label: 'Layers' },
    { key: 'honeycomb', label: 'Honeycomb' },
    { key: 'blueprint', label: 'Blueprint' },
    { key: 'dots',      label: 'Dot grid' },
    { key: 'aurora',    label: 'Glow' },
    { key: 'none',      label: 'Plain' }
];

// Bambu Lab models (names as listed on Wikipedia's Bambu Lab article).
const PRINTER_MODELS = ['A1 mini', 'A1', 'A2L', 'P1P', 'P1S', 'P2S', 'X1', 'X1 Carbon', 'X1E', 'X2D',
    'H2D', 'H2D Pro', 'H2S', 'H2C', 'Other'];
const NOZZLES = ['0.2', '0.4', '0.6', '0.8'];
const CURRENCIES = ['$', '\u20AC', '\u00A3', '\u00A5', '\u20B9', '\u20A9', 'C$', 'A$', 'CHF', 'kr', 'z\u0142'];
const SUFFIX_CURRENCIES = ['kr', 'z\u0142'];
const DATE_FORMATS = ['mdy', 'dmy', 'iso'];
const UNIT_LABELS = { hours: 'hours', days: 'days', prints: 'prints' };

// Simple stroke icons (24x24 viewBox). Built with createElementNS, never innerHTML.
const ICONS = {
    dashboard: ['M3 3h8v8H3z', 'M13 3h8v5h-8z', 'M13 10h8v11h-8z', 'M3 13h8v8H3z'],
    cube: ['M12 2l9 5v10l-9 5-9-5V7z', 'M12 12l9-5', 'M12 12v10', 'M12 12L3 7'],
    spool: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M12 9a3 3 0 100 6 3 3 0 000-6z'],
    list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
    download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
    sun: ['M12 8a4 4 0 100 8 4 4 0 000-8z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
    moon: ['M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z'],
    plus: ['M12 5v14', 'M5 12h14'],
    search: ['M11 4a7 7 0 100 14 7 7 0 000-14z', 'M21 21l-4.3-4.3'],
    alert: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18h.01'],
    clock: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M12 7v5l3 2'],
    gear: ['M12 15a3 3 0 100-6 3 3 0 000 6z', 'M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z'],
    wrench: ['M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z'],
    check: ['M5 13l4 4L19 7'],
    star: ['M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z'],
    lock: ['M6 11h12v10H6z', 'M8 11V7a4 4 0 118 0v4'],
    bolt: ['M13 2L4 14h7l-1 8 9-12h-7z']
};

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- Small helpers ----------

const $ = (id) => document.getElementById(id);

/** Create an element with an optional class and text (text is never parsed as HTML). */
function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

function icon(name) {
    const svg = svgEl('svg', {
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon'
    });
    for (const d of ICONS[name] || []) svg.appendChild(svgEl('path', { d }));
    return svg;
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
    if (!m) return 'No date';
    switch (state.settings.dateFormat) {
        case 'dmy': return `${m[3]}/${m[2]}/${m[1]}`;
        case 'iso': return `${m[1]}-${m[2]}-${m[3]}`;
        default: return `${m[2]}/${m[3]}/${m[1]}`;
    }
}

/** Whole days from one ISO date to another (negative if `to` is earlier). */
function daysBetween(fromIso, toIso) {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromIso);
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIso);
    if (!a || !b) return 0;
    return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
}

function fmtGrams(n) {
    return String(Math.round(n * 10) / 10);
}

function fmtMoney(n, digits = 2) {
    const sym = state.settings.currency;
    const text = n.toFixed(digits);
    if (SUFFIX_CURRENCIES.includes(sym)) return `${text} ${sym}`;
    return sym.length > 1 && /^[A-Z]{3}$/.test(sym) ? `${sym} ${text}` : sym + text;
}

function fmtNum(n) {
    return String(Math.round(n * 10) / 10);
}

function clampNum(v, min, max, fallback) {
    const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function fmtDuration(minutes) {
    const m = Math.round(Number(minutes) || 0);
    if (m <= 0) return '';
    const hrs = Math.floor(m / 60);
    const mins = m % 60;
    if (hrs === 0) return `${mins}m`;
    return mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`;
}

function cleanText(v, max = 200) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function validMinutes(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_MINUTES ? Math.round(v) : null;
}

function isHex(v) {
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

function guessHex(colorName) {
    const words = String(colorName || '').toLowerCase().split(/[^a-z]+/);
    for (const w of words) {
        if (Object.prototype.hasOwnProperty.call(COLOR_WORDS, w)) return COLOR_WORDS[w];
    }
    return '';
}

function spoolHex(spool) {
    if (isObject(spool)) {
        if (isHex(spool.hex)) return spool.hex;
        const guess = guessHex(spool.color);
        if (guess) return guess;
    }
    return DEFAULT_SWATCH;
}

function materialKey(spool) {
    if (!isObject(spool)) return 'unknown';
    const m = String(spool.material || 'other').toLowerCase();
    return KNOWN_MATERIALS.includes(m) ? m : 'other';
}

function makeSwatch(hex, className = 'swatch') {
    const el = h('span', className);
    el.style.background = isHex(hex) ? hex : DEFAULT_SWATCH;
    el.setAttribute('aria-hidden', 'true');
    return el;
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

function makeLink(url, text) {
    const a = h('a', 'link-text', text === undefined ? linkLabel(url) : text);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = url;
    return a;
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
/**
 * Show a short message. The second argument is either a boolean (isError) or
 * { isError, action: { label, onClick } } for toasts with an Undo button.
 */
function notify(message, options = false) {
    const opts = typeof options === 'boolean' ? { isError: options } : (options || {});
    const toast = $('toast');
    toast.replaceChildren(h('span', 'toast-text', message));
    if (opts.action) {
        const button = h('button', 'toast-action', opts.action.label);
        button.type = 'button';
        button.addEventListener('click', () => {
            toast.style.display = 'none';
            opts.action.onClick();
        });
        toast.appendChild(button);
    }
    toast.className = opts.isError ? 'error' : '';
    toast.style.display = 'flex';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, opts.action ? 7000 : 4500);
}

// ---------- State and storage ----------

function defaultSettings() {
    return {
        accent: 'amber',
        background: 'layers',
        bgStrength: 60,
        animate: true,
        density: 'comfortable',
        currency: '$',
        dateFormat: 'mdy',
        lowPercent: 25,
        defaultMaterial: 'pla',
        defaultSpoolGrams: 1000,
        backupDays: 30,
        shortcuts: true,
        printer: { model: '', nickname: '', nozzle: '0.4', date: '', price: null, watts: 0, kwhPrice: 0 }
    };
}

/** Turn anything (including junk from an import) into a complete, valid settings object. */
function cleanSettings(raw) {
    const d = defaultSettings();
    const s = isObject(raw) ? raw : {};
    const p = isObject(s.printer) ? s.printer : {};
    return {
        accent: Object.prototype.hasOwnProperty.call(ACCENTS, s.accent) ? s.accent : d.accent,
        background: BACKGROUNDS.some((b) => b.key === s.background) ? s.background : d.background,
        bgStrength: Math.round(clampNum(s.bgStrength, 0, 100, d.bgStrength)),
        animate: typeof s.animate === 'boolean' ? s.animate : d.animate,
        density: s.density === 'compact' ? 'compact' : 'comfortable',
        currency: CURRENCIES.includes(s.currency) ? s.currency : d.currency,
        dateFormat: DATE_FORMATS.includes(s.dateFormat) ? s.dateFormat : d.dateFormat,
        lowPercent: Math.round(clampNum(s.lowPercent, 5, 50, d.lowPercent)),
        defaultMaterial: [...KNOWN_MATERIALS, 'other'].includes(s.defaultMaterial) ? s.defaultMaterial : d.defaultMaterial,
        defaultSpoolGrams: Math.round(clampNum(s.defaultSpoolGrams, 0, 100000, d.defaultSpoolGrams)),
        backupDays: Math.round(clampNum(s.backupDays, 0, 365, d.backupDays)),
        shortcuts: typeof s.shortcuts === 'boolean' ? s.shortcuts : d.shortcuts,
        printer: {
            model: PRINTER_MODELS.includes(p.model) ? p.model : '',
            nickname: cleanText(p.nickname, 40),
            nozzle: NOZZLES.includes(String(p.nozzle)) ? String(p.nozzle) : d.printer.nozzle,
            date: isValidDate(p.date) ? p.date : '',
            price: typeof p.price === 'number' && p.price >= 0 && p.price <= 10000000 ? p.price : null,
            watts: Math.round(clampNum(p.watts, 0, 5000, 0)),
            kwhPrice: Math.round(clampNum(p.kwhPrice, 0, 100, 0) * 1000) / 1000
        }
    };
}

/** Clean the maintenance list. Entries that cannot be repaired are dropped. */
function cleanMaintenance(raw) {
    const out = {};
    if (!isObject(raw)) return out;
    for (const [id, t] of Object.entries(raw)) {
        if (!isSafeId(id) || !isObject(t)) continue;
        const name = cleanText(t.name, 60);
        const every = Number(t.every);
        if (name === '' || !Object.prototype.hasOwnProperty.call(UNIT_LABELS, t.unit)) continue;
        if (!Number.isFinite(every) || every <= 0 || every > 1000000) continue;
        out[id] = {
            name,
            unit: t.unit,
            every,
            lastDate: isValidDate(t.lastDate) ? t.lastDate : todayLocal(),
            atHours: clampNum(t.atHours, 0, 10000000, 0),
            atPrints: Math.round(clampNum(t.atPrints, 0, 10000000, 0))
        };
    }
    return out;
}

function emptyState() {
    return {
        schemaVersion: SCHEMA_VERSION,
        prints: {},
        spools: {},
        queue: {},
        maintenance: {},
        settings: defaultSettings(),
        hideArchived: false,
        theme: null,
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
        maintenance: cleanMaintenance(s.maintenance),
        settings: cleanSettings(s.settings),
        hideArchived: Boolean(s.hideArchived),
        theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : null,
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

function lowFraction() {
    return state.settings.lowPercent / 100;
}

function warnFraction() {
    return Math.max(0.5, lowFraction() + 0.15);
}

/** Estimated electricity cost of one print (needs a print time, watts and a kWh price). */
function energyCostOfPrint(print) {
    const { watts, kwhPrice } = state.settings.printer;
    const minutes = validMinutes(Number(print && print.minutes));
    if (!minutes || !(watts > 0) || !(kwhPrice > 0)) return 0;
    return (minutes / 60) * (watts / 1000) * kwhPrice;
}

function remainingOf(id, spool) {
    return (Number(spool.startGrams) || 0) - gramsUsedOfSpool(id);
}

function totalGramsOfPrint(print) {
    return usageOf(print).reduce((sum, u) => sum + (Number(u.grams) || 0), 0);
}

/** Estimated material cost of one print, from the prices of the spools it used. */
function costOfPrint(print) {
    let cost = 0;
    for (const u of usageOf(print)) {
        const spool = state.spools[u.spoolId];
        if (spool && Number.isFinite(spool.price) && Number(spool.startGrams) > 0) {
            cost += (Number(u.grams) || 0) * (spool.price / spool.startGrams);
        }
    }
    return cost;
}

function calcStats() {
    const prints = Object.values(state.prints).filter(isObject);
    const spools = Object.entries(state.spools).filter(([, s]) => isObject(s));

    const total = prints.length;
    const succeeded = prints.filter((p) => p.result).length;

    let grams = 0;
    let usedCost = 0;
    let energyCost = 0;
    let minutes = 0;
    const byMaterial = {};
    const byMonth = {};

    for (const p of prints) {
        minutes += Number(p.minutes) > 0 ? Number(p.minutes) : 0;
        energyCost += energyCostOfPrint(p);
        for (const u of usageOf(p)) {
            const g = Number(u.grams) || 0;
            grams += g;
            const spool = state.spools[u.spoolId];
            const material = spool ? materialKey(spool) : 'unknown';
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
    let gramsLeft = 0;
    const lowSpools = [];
    for (const [id, s] of active) {
        const start = Number(s.startGrams) || 0;
        const left = start - gramsUsedOfSpool(id);
        gramsLeft += Math.max(0, left);
        if (start > 0 && left / start <= lowFraction()) lowSpools.push({ id, spool: s, left });
    }
    lowSpools.sort((a, b) => a.left - b.left);

    return {
        total, succeeded, failed: total - succeeded,
        grams, usedCost, energyCost, spent, minutes, gramsLeft,
        costPerGram: pricedGrams > 0 ? spent / pricedGrams : null,
        hasPrices: spools.some(([, s]) => Number.isFinite(s.price)),
        byMaterial, byMonth, lowSpools,
        spoolCount: spools.length, activeCount: active.length, lowCount: lowSpools.length
    };
}

// ---------- Theme ----------

function currentTheme() {
    if (state.theme === 'light' || state.theme === 'dark') return state.theme;
    try {
        if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return 'light';
        }
    } catch (error) { /* fall through to dark */ }
    return 'dark';
}

function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Apply theme, accent color, background style, motion and density to the page. */
function applyTheme() {
    const theme = currentTheme();
    const set = state.settings;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.bg = set.background;
    root.dataset.motion = set.animate ? 'on' : 'off';
    root.dataset.density = set.density;
    root.style.setProperty('--bg-strength', String(set.bgStrength / 100));
    const accent = ACCENTS[set.accent][theme];
    root.style.setProperty('--accent', accent.accent);
    root.style.setProperty('--accent-strong', accent.strong);
    root.style.setProperty('--link', accent.link);
    root.style.setProperty('--accent-soft', hexToRgba(accent.accent, theme === 'light' ? 0.16 : 0.14));
    const bg = $('bg');
    if (bg) bg.className = 'bgp-' + set.background;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5f9' : '#0f172a');
    const button = $('theme-button');
    button.replaceChildren(icon(theme === 'light' ? 'moon' : 'sun'));
    const label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    button.setAttribute('aria-label', label);
    button.title = label;
}

// ---------- Tabs ----------

const sectionEls = {
    [Sections.DASH]: $('dashboard'),
    [Sections.PRINTS]: $('prints'),
    [Sections.FILA]: $('filament'),
    [Sections.QUEUE]: $('queue'),
    [Sections.DATA]: $('data'),
    [Sections.SETTINGS]: $('settings')
};
const tabButtons = {};

function buildHeader() {
    const headerEl = $('header');

    const title = $('main-header');
    $('brand-icon').replaceChildren(icon('cube'));
    title.addEventListener('click', () => showTab(Sections.DASH));
    title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            showTab(Sections.DASH);
        }
    });

    for (const tab of TABS) {
        const b = h('button', 'tab-buttons');
        b.type = 'button';
        b.id = tab.idPrefix + '-button';
        b.appendChild(icon(tab.icon));
        b.appendChild(h('span', 'tab-label', tab.label));
        b.title = tab.label;
        b.addEventListener('click', () => showTab(tab.section));
        headerEl.appendChild(b);
        tabButtons[tab.section] = b;
    }

    $('theme-button').addEventListener('click', toggleTheme);
}

function toggleTheme() {
    state.theme = currentTheme() === 'light' ? 'dark' : 'light';
    saveState();
    applyTheme();
    syncAllSettings();
}

function showTab(section, { updateAddress = true } = {}) {
    if (!sectionEls[section]) {
        console.error('showTab called with an unknown section:', section);
        section = Sections.DASH;
    }
    for (const [name, el] of Object.entries(sectionEls)) {
        el.hidden = name !== section;
    }
    for (const [name, button] of Object.entries(tabButtons)) {
        const active = name === section;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    }
    if (updateAddress) {
        try {
            history.replaceState(null, '', '#' + section);
        } catch (error) { /* the address bar is a convenience only */ }
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
    safeRender('maintenance', renderMaintenanceSettings);
}

function plural(n, word, pluralWord) {
    return `${n} ${n === 1 ? word : (pluralWord || word + 's')}`;
}

function emptyState_(message, hint) {
    const box = h('div', 'empty-state');
    box.appendChild(h('p', 'warn-text empty-title', message));
    if (hint) box.appendChild(h('p', 'secondary-text small', hint));
    return box;
}

function makeBadge(text, kind) {
    return h('span', kind ? `badge badge-${kind}` : 'badge', text);
}

// ---------- Rendering: dashboard ----------

function statCard(label, value, sub, extraClass) {
    const card = h('div', extraClass ? `stat-card ${extraClass}` : 'stat-card');
    card.appendChild(h('p', 'stat-label', label));
    card.appendChild(h('p', 'stat-value', value));
    if (sub) card.appendChild(h('p', 'stat-sub', sub));
    return card;
}

function ringChart(fraction) {
    const r = 15.9155;   // circumference ~ 100
    const svg = svgEl('svg', { viewBox: '0 0 36 36', class: 'ring', 'aria-hidden': 'true' });
    svg.appendChild(svgEl('circle', { class: 'ring-track', cx: 18, cy: 18, r, fill: 'none', 'stroke-width': 3.6 }));
    svg.appendChild(svgEl('circle', {
        class: 'ring-fill', cx: 18, cy: 18, r, fill: 'none', 'stroke-width': 3.6, 'stroke-linecap': 'round',
        'stroke-dasharray': `${Math.max(0, Math.min(1, fraction)) * 100} 100`,
        transform: 'rotate(-90 18 18)'
    }));
    return svg;
}

function dashPanel(title, extraClass) {
    const panel = h('div', extraClass ? `panel ${extraClass}` : 'panel');
    panel.appendChild(h('h3', 'panel-title', title));
    return panel;
}

function renderDashboard() {
    const root = $('dashboard-content');
    root.replaceChildren();

    const stats = calcStats();

    if (stats.total === 0 && stats.spoolCount === 0) {
        const box = emptyState_('Nothing to show yet.', 'Add a spool in the Filament tab, then log your first print.');
        const go = h('button', 'btn btn-primary', 'Add your first spool');
        go.type = 'button';
        go.addEventListener('click', () => { showTab(Sections.FILA); openSpoolPopup(); });
        box.appendChild(go);
        root.appendChild(box);
        return;
    }

    const banner = buildBackupBanner();
    if (banner) root.appendChild(banner);

    // --- Stat cards ---
    const rate = stats.total > 0 ? stats.succeeded / stats.total : 0;
    const grid = h('div', 'stat-grid');

    const thisMonth = stats.byMonth[todayLocal().slice(0, 7)] || 0;
    grid.appendChild(statCard('Total prints', String(stats.total), `${thisMonth} this month`));

    const rateCard = statCard('Success rate', stats.total > 0 ? Math.round(rate * 100) + '%' : '-',
        `${stats.succeeded} succeeded, ${stats.failed} failed`, 'stat-with-ring');
    if (stats.total > 0) rateCard.appendChild(ringChart(rate));
    grid.appendChild(rateCard);

    const timedPrints = Object.values(state.prints).filter((p) => isObject(p) && validMinutes(Number(p.minutes))).length;
    grid.appendChild(statCard('Print time', stats.minutes > 0 ? fmtDuration(stats.minutes) : '-',
        timedPrints > 0 ? `~${fmtDuration(stats.minutes / timedPrints)} per timed print` : 'Log print time to track it'));
    grid.appendChild(statCard('Filament used', fmtGrams(stats.grams) + 'g',
        stats.total > 0 ? `~${fmtGrams(stats.grams / stats.total)}g per print` : 'Includes failed prints'));
    grid.appendChild(statCard('Filament left', fmtGrams(stats.gramsLeft) + 'g',
        `across ${plural(stats.activeCount, 'active spool')}`));
    grid.appendChild(statCard('Total spent', stats.hasPrices ? fmtMoney(stats.spent) : 'No prices',
        stats.costPerGram !== null ? `~${fmtMoney(stats.costPerGram, 3)} per gram` : 'Add prices to spools'));
    const totalCost = stats.usedCost + stats.energyCost;
    grid.appendChild(statCard('Cost of prints', totalCost > 0 ? fmtMoney(totalCost) : '-',
        stats.energyCost > 0 ? `incl. ${fmtMoney(stats.energyCost)} electricity`
            : totalCost > 0 && stats.total > 0 ? `~${fmtMoney(totalCost / stats.total)} per print` : 'Estimated from spool prices'));
    grid.appendChild(statCard('Spools', `${stats.activeCount} active`,
        `${stats.lowCount} low, ${stats.spoolCount - stats.activeCount} archived`));
    root.appendChild(grid);

    // --- Needs attention (low or empty spools) ---
    if (stats.lowSpools.length > 0) {
        const panel = dashPanel('Running low', 'panel-alert');
        for (const { id, spool, left } of stats.lowSpools) {
            const row = h('button', 'list-row list-button');
            row.type = 'button';
            row.dataset.id = id;
            row.appendChild(makeSwatch(spoolHex(spool)));
            const text = h('span', 'list-main');
            text.appendChild(h('span', 'list-title', `${spool.brand}, ${spool.color}`));
            text.appendChild(h('span', 'list-sub', String(spool.material || 'other').toUpperCase()));
            row.appendChild(text);
            row.appendChild(makeBadge(left <= 0 ? 'Empty' : `~${fmtGrams(left)}g left`, 'red'));
            row.addEventListener('click', () => showTab(Sections.FILA));
            panel.appendChild(row);
        }
        root.appendChild(panel);
    }

    const cols = h('div', 'dash-grid');
    cols.appendChild(buildPrinterPanel(stats));

    // --- Filament by material (donut) ---
    const materials = Object.entries(stats.byMaterial).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1]);
    if (materials.length > 0) {
        const panel = dashPanel('Filament by material');
        const wrap = h('div', 'donut-wrap');
        const donut = h('div', 'donut');
        let acc = 0;
        const stops = [];
        for (const [material, g] of materials) {
            const from = (acc / stats.grams) * 100;
            acc += g;
            const to = (acc / stats.grams) * 100;
            const color = MATERIAL_COLORS[material] || MATERIAL_COLORS.other;
            stops.push(`${color} ${from.toFixed(2)}% ${to.toFixed(2)}%`);
        }
        donut.style.background = `conic-gradient(${stops.join(', ')})`;
        const hole = h('div', 'donut-hole');
        hole.appendChild(h('strong', 'donut-total', fmtGrams(stats.grams) + 'g'));
        hole.appendChild(h('span', 'donut-caption', 'total'));
        donut.appendChild(hole);
        wrap.appendChild(donut);

        const legend = h('ul', 'legend');
        for (const [material, g] of materials) {
            const li = h('li', 'legend-row');
            const dot = h('span', 'legend-dot');
            dot.style.background = MATERIAL_COLORS[material] || MATERIAL_COLORS.other;
            li.appendChild(dot);
            li.appendChild(h('span', 'legend-name', material.toUpperCase()));
            const share = stats.grams > 0 ? Math.round((g / stats.grams) * 100) : 0;
            li.appendChild(h('span', 'legend-value', `${fmtGrams(g)}g (${share}%)`));
            legend.appendChild(li);
        }
        wrap.appendChild(legend);
        panel.appendChild(wrap);
        cols.appendChild(panel);
    }

    // --- Prints per month (columns, with empty months filled in) ---
    const monthKeys = Object.keys(stats.byMonth).sort();
    if (monthKeys.length > 0) {
        const panel = dashPanel('Prints per month');
        const [lastY, lastM] = monthKeys[monthKeys.length - 1].split('-').map(Number);
        const series = [];
        for (let i = 0; i < 12; i++) {
            const idx = lastY * 12 + (lastM - 1) - i;
            const y = Math.floor(idx / 12);
            const m = (idx % 12) + 1;
            const key = `${y}-${String(m).padStart(2, '0')}`;
            series.unshift({ key, y, m, n: stats.byMonth[key] || 0 });
            if (key <= monthKeys[0] && series.length >= 6) break;
        }
        const max = Math.max(...series.map((s) => s.n), 1);
        const chart = h('div', 'col-chart');
        for (const s of series) {
            const col = h('div', 'col');
            col.appendChild(h('span', 'col-value', s.n > 0 ? String(s.n) : ''));
            const track = h('div', 'col-track');
            const bar = h('div', s.n > 0 ? 'col-bar' : 'col-bar col-empty');
            bar.style.height = Math.max(s.n > 0 ? 6 : 2, Math.round((s.n / max) * 100)) + '%';
            track.appendChild(bar);
            col.appendChild(track);
            col.appendChild(h('span', 'col-label', MONTHS[s.m - 1]));
            col.title = `${MONTHS[s.m - 1]} ${s.y}: ${plural(s.n, 'print')}`;
            chart.appendChild(col);
        }
        panel.appendChild(chart);
        cols.appendChild(panel);
    }

    // --- Recent prints ---
    const recent = Object.entries(state.prints).filter(([, p]) => isObject(p))
        .sort((a, b) => String(b[1].date || '').localeCompare(String(a[1].date || ''))).slice(0, 5);
    if (recent.length > 0) {
        const panel = dashPanel('Recent prints');
        for (const [id, p] of recent) {
            const row = h('button', 'list-row list-button');
            row.type = 'button';
            row.dataset.id = id;
            const text = h('span', 'list-main');
            text.appendChild(h('span', 'list-title', p.name || 'Untitled print'));
            const bits = [formatDate(p.date), `${fmtGrams(totalGramsOfPrint(p))}g`];
            const dur = fmtDuration(p.minutes);
            if (dur) bits.push(dur);
            text.appendChild(h('span', 'list-sub', bits.join(' · ')));
            row.appendChild(text);
            row.appendChild(makeBadge(p.result ? 'Success' : 'Failure', p.result ? 'green' : 'red'));
            row.addEventListener('click', () => showTab(Sections.PRINTS));
            panel.appendChild(row);
        }
        cols.appendChild(panel);
    }

    // --- Up next (queue) ---
    const upNext = Object.entries(state.queue).filter(([, q]) => isObject(q) && !q.done).slice(0, 4);
    if (upNext.length > 0) {
        const panel = dashPanel('Up next');
        for (const [id, item] of upNext) {
            const row = h('div', 'list-row');
            const text = h('span', 'list-main');
            text.appendChild(h('span', 'list-title', item.name || 'Untitled'));
            const safeLink = normalizeLink(item.link);
            if (safeLink) {
                const sub = h('span', 'list-sub');
                sub.appendChild(makeLink(safeLink));
                text.appendChild(sub);
            }
            row.appendChild(text);
            const log = h('button', 'btn btn-outline btn-small', 'Log print');
            log.type = 'button';
            log.addEventListener('click', () => openPrintPopup({ name: item.name, link: item.link || '', queueId: id }));
            row.appendChild(log);
            panel.appendChild(row);
        }
        cols.appendChild(panel);
    }

    if (cols.children.length > 0) root.appendChild(cols);

    root.appendChild(buildAchievementsPanel(stats));
}

// ---------- Dashboard pieces: backup reminder, printer, achievements ----------

function buildBackupBanner() {
    const days = state.settings.backupDays;
    const hasData = Object.keys(state.prints).length + Object.keys(state.spools).length > 0;
    if (!days || !hasData) return null;

    const last = state.lastExported ? new Date(state.lastExported) : null;
    const known = last && !Number.isNaN(last.getTime());
    const age = known ? Math.floor((Date.now() - last.getTime()) / 86400000) : Infinity;
    if (age < days) return null;

    const banner = h('div', 'banner');
    banner.id = 'backup-banner';
    banner.appendChild(icon('alert'));
    const text = h('p', 'banner-text');
    text.appendChild(h('strong', null, known ? `Your last backup was ${plural(age, 'day')} ago. ` : 'You have not backed up yet. '));
    text.append('Everything lives in this browser, so keep a copy.');
    banner.appendChild(text);
    const button = h('button', 'btn btn-primary btn-small', 'Export backup');
    button.type = 'button';
    button.addEventListener('click', exportData);
    banner.appendChild(button);
    return banner;
}

function maintenanceStatus(stats) {
    const today = todayLocal();
    const hoursNow = stats.minutes / 60;
    const list = Object.entries(state.maintenance).map(([id, task]) => {
        const used = task.unit === 'hours' ? Math.max(0, hoursNow - task.atHours)
            : task.unit === 'prints' ? Math.max(0, stats.total - task.atPrints)
            : Math.max(0, daysBetween(task.lastDate, today));
        const remaining = task.every - used;
        return { id, task, used, remaining, fraction: used / task.every, due: remaining <= 0 };
    });
    list.sort((a, b) => b.fraction - a.fraction);
    return list;
}

/** "1 hour", "2.5 hours", "1 print", "3 prints", "1 day". */
function unitCount(n, unit) {
    const text = fmtNum(n);
    return text === '1' ? `${text} ${unit.replace(/s$/, '')}` : `${text} ${unit}`;
}

function maintenanceText(m) {
    const unit = UNIT_LABELS[m.task.unit];
    if (!m.due) return `${unitCount(m.remaining, unit)} left`;
    return m.remaining === 0 ? 'Due now' : `Overdue by ${unitCount(-m.remaining, unit)}`;
}

function markMaintenanceDone(id) {
    const task = state.maintenance[id];
    if (!task) return;
    const before = { ...task };
    const stats = calcStats();
    task.lastDate = todayLocal();
    task.atHours = stats.minutes / 60;
    task.atPrints = stats.total;
    saveState();
    renderAll();
    notify(`Marked "${task.name}" as done.`, {
        action: {
            label: 'Undo',
            onClick: () => {
                state.maintenance[id] = before;
                saveState();
                renderAll();
            }
        }
    });
}

function buildMaintenanceRow(m, { withDelete = false } = {}) {
    const row = h('div', m.due ? 'maint-row is-due' : 'maint-row');
    row.dataset.id = m.id;

    const top = h('div', 'maint-top');
    const text = h('div', 'maint-text');
    text.appendChild(h('span', 'list-title', m.task.name));
    text.appendChild(h('span', 'list-sub',
        `${fmtNum(m.used)} of ${fmtNum(m.task.every)} ${UNIT_LABELS[m.task.unit]} \u00B7 ${maintenanceText(m)}`));
    top.appendChild(text);

    const done = h('button', m.due ? 'btn btn-primary btn-small' : 'btn btn-outline btn-small', 'Done');
    done.type = 'button';
    done.title = 'Mark as done today and start counting again';
    done.addEventListener('click', () => markMaintenanceDone(m.id));
    top.appendChild(done);

    if (withDelete) {
        const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => {
            const removed = state.maintenance[m.id];
            delete state.maintenance[m.id];
            saveState();
            renderAll();
            notify(`Removed "${removed.name}".`, {
                action: {
                    label: 'Undo',
                    onClick: () => {
                        state.maintenance[m.id] = removed;
                        saveState();
                        renderAll();
                    }
                }
            });
        });
        top.appendChild(del);
    }
    row.appendChild(top);

    const bar = h('div', 'bar bar-thin');
    const level = m.fraction >= 1 ? 'fail' : m.fraction >= 0.8 ? 'warn' : 'ok';
    const fill = h('div', level === 'ok' ? 'bar-fill' : `bar-fill ${level}`);
    fill.style.width = Math.min(100, Math.round(m.fraction * 100)) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    return row;
}

function buildPrinterPanel(stats) {
    const pr = state.settings.printer;
    const tasks = maintenanceStatus(stats);
    const modelName = pr.model && pr.model !== 'Other' ? `Bambu Lab ${pr.model}` : '';
    const configured = Boolean(modelName || pr.nickname || pr.date || pr.model);

    const panel = dashPanel('Printer');
    panel.id = 'printer-panel';

    if (!configured && tasks.length === 0) {
        panel.appendChild(h('p', 'body-text', 'Tell the app about your printer to track its hours, upkeep and electricity.'));
        const go = h('button', 'btn btn-outline btn-small', 'Set up printer');
        go.type = 'button';
        go.addEventListener('click', () => openSettings('printer'));
        panel.appendChild(go);
        panel.lastChild.classList.add('panel-action');
        return panel;
    }

    const head = h('div', 'printer-head');
    head.appendChild(h('span', 'printer-icon', ''));
    head.firstChild.appendChild(icon('cube'));
    const names = h('div', 'printer-names');
    names.appendChild(h('strong', 'printer-name', pr.nickname || modelName || 'My printer'));
    const facts = [];
    if (pr.nickname && modelName) facts.push(modelName);
    facts.push(`${pr.nozzle} mm nozzle`);
    names.appendChild(h('span', 'list-sub', facts.join(' \u00B7 ')));
    head.appendChild(names);
    panel.appendChild(head);

    const lines = h('ul', 'fact-list');
    if (pr.date) {
        const d = daysBetween(todayLocal(), pr.date);
        lines.appendChild(h('li', null, d > 0 ? `Arrives in ${plural(d, 'day')} (${formatDate(pr.date)})`
            : d === 0 ? 'Arrives today' : `In service for ${plural(-d, 'day')} (since ${formatDate(pr.date)})`));
    }
    lines.appendChild(h('li', null, `${fmtDuration(stats.minutes) || '0h'} printed across ${plural(stats.total, 'print')}`));
    if (pr.price !== null) lines.appendChild(h('li', null, `Paid ${fmtMoney(pr.price)}`));
    panel.appendChild(lines);

    if (tasks.length > 0) {
        panel.appendChild(h('h4', 'subhead', 'Upkeep'));
        for (const m of tasks.slice(0, 3)) panel.appendChild(buildMaintenanceRow(m));
    }

    const manage = h('button', 'btn btn-ghost btn-small panel-action', tasks.length > 0 ? 'Manage printer and upkeep' : 'Printer settings');
    manage.type = 'button';
    manage.addEventListener('click', () => openSettings('printer'));
    panel.appendChild(manage);
    return panel;
}

function achievementList(stats) {
    const prints = Object.values(state.prints).filter(isObject)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    let streak = 0;
    let best = 0;
    for (const p of prints) {
        streak = p.result ? streak + 1 : 0;
        best = Math.max(best, streak);
    }
    const materials = Object.entries(stats.byMaterial).filter(([m, g]) => g > 0 && m !== 'unknown').length;
    const queueDone = Object.values(state.queue).some((q) => isObject(q) && q.done);

    return [
        { title: 'First layer', desc: 'Log your first print', done: stats.total >= 1 },
        { title: 'On a roll', desc: 'Log 10 prints', done: stats.total >= 10 },
        { title: 'Print farm', desc: 'Log 50 prints', done: stats.total >= 50 },
        { title: 'Century', desc: 'Log 100 prints', done: stats.total >= 100 },
        { title: 'Kilo club', desc: 'Use 1 kg of filament', done: stats.grams >= 1000 },
        { title: 'Spool eater', desc: 'Use 5 kg of filament', done: stats.grams >= 5000 },
        { title: 'Round the clock', desc: 'Log 24 hours of print time', done: stats.minutes >= 24 * 60 },
        { title: 'Marathon', desc: 'Log 100 hours of print time', done: stats.minutes >= 100 * 60 },
        { title: 'Clean streak', desc: '5 successful prints in a row', done: best >= 5 },
        { title: 'Collector', desc: 'Own 5 spools', done: stats.spoolCount >= 5 },
        { title: 'Material explorer', desc: 'Print with 3 materials', done: materials >= 3 },
        { title: 'Planner', desc: 'Finish an item from the queue', done: queueDone },
        { title: 'Backed up', desc: 'Export a backup', done: Boolean(state.lastExported) }
    ];
}

function buildAchievementsPanel(stats) {
    const list = achievementList(stats);
    const earned = list.filter((a) => a.done).length;
    const panel = dashPanel(`Achievements (${earned} of ${list.length})`, 'achievements-panel');
    panel.id = 'achievements';
    const grid = h('div', 'achv-grid');
    for (const a of list) {
        const tile = h('div', a.done ? 'achv earned' : 'achv');
        tile.appendChild(icon(a.done ? 'star' : 'lock'));
        const text = h('div', 'achv-text');
        text.appendChild(h('span', 'achv-title', a.title));
        text.appendChild(h('span', 'achv-desc', a.desc));
        tile.appendChild(text);
        tile.title = a.done ? 'Earned' : 'Not earned yet';
        grid.appendChild(tile);
    }
    panel.appendChild(grid);
    return panel;
}

// ---------- Rendering: prints ----------

const printList = $('print-list');
const printSearch = $('print-search');
const printFilter = $('print-filter');
const printSort = $('print-sort');

function setupPrintsToolbar() {
    $('prints-search-icon').replaceChildren(icon('search'));
    const plus = h('button', 'acc-buttons btn btn-primary');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Add a print');
    plus.appendChild(icon('plus'));
    plus.appendChild(h('span', 'btn-text', 'New print'));
    plus.addEventListener('click', () => openPrintPopup());
    $('prints-actions').appendChild(plus);

    printSearch.addEventListener('input', renderPrints);
    printFilter.addEventListener('change', renderPrints);
    printSort.addEventListener('change', renderPrints);
}

function printSearchText(p) {
    const parts = [p.name, p.notes, p.link, p.date, formatDate(p.date), p.result ? 'success' : 'failure failed'];
    for (const u of usageOf(p)) {
        const s = state.spools[u.spoolId];
        if (s) parts.push(s.brand, s.color, s.material);
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
}

function renderPrints() {
    printList.replaceChildren();

    const all = Object.entries(state.prints).filter(([, p]) => isObject(p));
    $('prints-toolbar').hidden = all.length === 0;

    if (all.length === 0) {
        $('prints-sub').textContent = 'Everything you have printed.';
        printList.appendChild(emptyState_('No prints yet! Click the + to start a new print!',
            'Each print subtracts its filament from the spools you pick.'));
        return;
    }

    const query = printSearch.value.trim().toLowerCase();
    const filter = printFilter.value;
    let entries = all.filter(([, p]) => {
        if (filter === 'success' && !p.result) return false;
        if (filter === 'failure' && p.result) return false;
        return query === '' || printSearchText(p).includes(query);
    });

    const byDate = (a, b) => String(a[1].date || '').localeCompare(String(b[1].date || ''));
    switch (printSort.value) {
        case 'oldest': entries.sort(byDate); break;
        case 'name': entries.sort((a, b) => String(a[1].name || '').localeCompare(String(b[1].name || ''), undefined, { sensitivity: 'base' })); break;
        case 'grams': entries.sort((a, b) => totalGramsOfPrint(b[1]) - totalGramsOfPrint(a[1])); break;
        case 'time': entries.sort((a, b) => (Number(b[1].minutes) || 0) - (Number(a[1].minutes) || 0)); break;
        default: entries.sort((a, b) => byDate(b, a));
    }

    const filtered = entries.length !== all.length;
    $('prints-sub').textContent = filtered
        ? `Showing ${entries.length} of ${plural(all.length, 'print')}`
        : plural(all.length, 'print') + ' logged';

    if (entries.length === 0) {
        printList.appendChild(emptyState_('No prints match your search or filter.', 'Try a different word or reset the filters.'));
        return;
    }
    for (const [id, print] of entries) printList.appendChild(buildPrintCard(id, print));
}

function buildPrintCard(id, p) {
    const card = h('article', 'row-card print-card');
    card.dataset.id = id;
    card.classList.add(p.result ? 'is-success' : 'is-failure');

    const head = h('div', 'card-head');
    const title = h('h2', 'card-title', p.name || 'Untitled print');
    head.appendChild(title);
    head.appendChild(makeBadge(p.result ? 'Success' : 'Failure', p.result ? 'green' : 'red'));
    card.appendChild(head);

    const meta = h('div', 'card-meta');
    meta.append(formatDate(p.date));
    const dur = fmtDuration(p.minutes);
    if (dur) {
        const d = h('span', 'meta-item');
        d.appendChild(icon('clock'));
        d.append(dur);
        meta.appendChild(d);
    }
    const energy = energyCostOfPrint(p);
    const cost = costOfPrint(p) + energy;
    if (cost > 0) {
        const c = h('span', 'meta-item', `~${fmtMoney(cost)}`);
        c.title = energy > 0 ? `Filament ${fmtMoney(cost - energy)} + electricity ${fmtMoney(energy)}` : 'Estimated filament cost';
        meta.appendChild(c);
    }
    const safeLink = normalizeLink(p.link);
    if (safeLink) meta.appendChild(makeLink(safeLink));
    card.appendChild(meta);

    const usage = usageOf(p);
    if (usage.length > 0) {
        const chips = h('div', 'chips');
        for (const u of usage) {
            const spool = state.spools[u.spoolId];
            const name = spool ? `${spool.brand}, ${spool.color}` : 'Deleted spool';
            const chip = h('span', 'chip');
            chip.appendChild(makeSwatch(spool ? spoolHex(spool) : DEFAULT_SWATCH, 'swatch swatch-small'));
            chip.append(`${name}: ${fmtGrams(Number(u.grams) || 0)}g`);
            chips.appendChild(chip);
        }
        card.appendChild(chips);
    }

    if (typeof p.notes === 'string' && p.notes.trim() !== '') {
        card.appendChild(h('p', 'card-notes', p.notes.trim()));
    }

    const buttons = h('div', 'card-actions');

    const edit = h('button', 'btn btn-outline btn-small', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => openPrintPopup({ printId: id }));
    buttons.appendChild(edit);

    const again = h('button', 'btn btn-outline btn-small', 'Print again');
    again.type = 'button';
    again.title = 'Log a new print with the same details';
    again.addEventListener('click', () => openPrintPopup({ copyFromId: id }));
    buttons.appendChild(again);

    const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deletePrint(id));
    buttons.appendChild(del);

    card.appendChild(buttons);
    return card;
}

function deletePrint(id) {
    const print = state.prints[id];
    if (!print) return;
    delete state.prints[id];
    saveState();
    renderAll();
    notify(`Deleted "${print.name}".`, {
        action: {
            label: 'Undo',
            onClick: () => {
                state.prints[id] = print;
                saveState();
                renderAll();
            }
        }
    });
}

// ---------- Print popup (create and edit) ----------

const printPopup = $('print-popup');
const printPopupTitle = $('print-popup-title');
const nameInput = $('name-tinput');
const printDateInput = $('date-tinput');
const linkInput = $('link-tinput');
const hoursInput = $('hours-ninput');
const minutesInput = $('minutes-ninput');
const notesInput = $('notes-input');
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

function updateBodyLock() {
    const open = printPopup.style.display === 'block' || spoolPopup.style.display === 'block';
    document.body.classList.toggle('modal-open', open);
}

/**
 * Open the print popup.
 *   printId     edit this print
 *   copyFromId  start a new print pre-filled from an existing one ("Print again")
 *   name, link  pre-fill for a new print (used by the queue)
 *   queueId     queue item to tick off after saving
 */
function openPrintPopup({ printId = null, copyFromId = null, name = '', link = '', queueId = null } = {}) {
    if (!printId && activeSpools().length === 0) {
        notify('Add a filament spool first (Filament tab).', true);
        return;
    }

    editingPrintId = printId;
    pendingQueueId = queueId;
    const print = printId ? state.prints[printId] : null;
    const source = print || (copyFromId ? state.prints[copyFromId] : null);

    printPopupTitle.textContent = print ? 'Edit Print' : 'Create Print';
    savePrintButton.textContent = print ? 'Save Changes' : 'Create Print';

    nameInput.value = source ? (source.name || '') : name;
    printDateInput.value = print && isValidDate(print.date) ? print.date : todayLocal();
    linkInput.value = source ? (source.link || '') : link;
    if (print && !print.result) {
        resultFailure.checked = true;
    } else {
        resultSuccess.checked = true;
    }

    const minutes = source ? validMinutes(Number(source.minutes)) : null;
    hoursInput.value = minutes ? String(Math.floor(minutes / 60)) : '';
    minutesInput.value = minutes ? String(minutes % 60) : '';
    notesInput.value = source && typeof source.notes === 'string' ? source.notes : '';

    rowList.replaceChildren();
    let usage = source ? usageOf(source) : [];
    if (!print) usage = usage.filter((u) => isObject(state.spools[u.spoolId]));   // a copy should not carry deleted spools
    if (usage.length > 0) {
        for (const u of usage) addFilamentRow({ spoolId: u.spoolId, grams: u.grams });
    } else {
        addFilamentRow();
    }

    clearError(printError);
    printPopup.style.display = 'block';
    printPopup.scrollTop = 0;
    updateBodyLock();
    nameInput.focus();
}

function closePrintPopup() {
    printPopup.style.display = 'none';
    editingPrintId = null;
    pendingQueueId = null;
    updateBodyLock();
}

function spoolLabel(id, spool) {
    const left = remainingOf(id, spool);
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

function readDuration() {
    const hText = hoursInput.value.trim();
    const mText = minutesInput.value.trim();
    if (hText === '' && mText === '') return { minutes: null };

    const hrs = hText === '' ? 0 : hoursInput.valueAsNumber;
    const mins = mText === '' ? 0 : minutesInput.valueAsNumber;
    if (!Number.isInteger(hrs) || !Number.isInteger(mins) || hrs < 0 || mins < 0 || hrs > 9999 || mins > 59) {
        return { error: 'Print time: use whole hours (0 or more) and minutes between 0 and 59.' };
    }
    const total = hrs * 60 + mins;
    return { minutes: total > 0 ? total : null };
}

function savePrint() {
    const name = nameInput.value.trim();
    const date = printDateInput.value;
    const link = normalizeLink(linkInput.value);

    if (name === '') return showError(printError, 'Give the print a name.');
    if (!isValidDate(date)) return showError(printError, 'Pick a valid date.');
    if (link === null) return showError(printError, 'The link must be a valid http:// or https:// address.');

    const duration = readDuration();
    if (duration.error) return showError(printError, duration.error);

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

    const record = {
        name, date, result: resultSuccess.checked, link, usage,
        minutes: duration.minutes,
        notes: notesInput.value.trim().slice(0, 500)
    };
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

const spoolList = $('spools');
const archiveOffBox = $('archive-off-checkbox');
const materialFilter = $('spool-material-filter');

function setupSpoolToolbar() {
    const plus = h('button', 'acc-buttons btn btn-primary');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Add a spool');
    plus.appendChild(icon('plus'));
    plus.appendChild(h('span', 'btn-text', 'Add spool'));
    plus.addEventListener('click', () => openSpoolPopup());
    $('fila-actions').appendChild(plus);

    archiveOffBox.addEventListener('change', () => {
        state.hideArchived = archiveOffBox.checked;
        saveState();
        renderSpools();
    });
    materialFilter.addEventListener('change', renderSpools);
}

function renderSpools() {
    spoolList.replaceChildren();
    archiveOffBox.checked = state.hideArchived;

    const all = Object.entries(state.spools).filter(([, s]) => isObject(s));
    $('fila-toolbar').hidden = all.length === 0;

    const active = all.filter(([, s]) => !s.archived);
    const left = active.reduce((sum, [id, s]) => sum + Math.max(0, remainingOf(id, s)), 0);
    $('fila-sub').textContent = all.length === 0
        ? 'Your spools and how much is left on each.'
        : `${plural(active.length, 'active spool')} · ~${fmtGrams(left)}g left in total`;

    if (all.length === 0) {
        spoolList.appendChild(emptyState_('No spools yet! Click the + to add a spool!',
            'Add each spool you buy. Prints subtract from it automatically.'));
        return;
    }

    const visible = all.filter(([, s]) => {
        if (s.archived && state.hideArchived) return false;
        return materialFilter.value === 'all' || materialKey(s) === materialFilter.value;
    });
    if (visible.length === 0) {
        const allArchivedHidden = state.hideArchived && all.every(([, s]) => s.archived);
        spoolList.appendChild(allArchivedHidden
            ? emptyState_("All spools are archived. Uncheck 'Hide archived' to see them, or click the + to add a new spool.")
            : emptyState_('No spools match this filter.', 'Pick another material or show archived spools.'));
        return;
    }

    // Active spools first (newest first), archived last
    visible.sort((a, b) => {
        const arch = Number(Boolean(a[1].archived)) - Number(Boolean(b[1].archived));
        return arch !== 0 ? arch : String(b[1].date || '').localeCompare(String(a[1].date || ''));
    });
    for (const [id, spool] of visible) spoolList.appendChild(buildSpoolCard(id, spool));
}

function buildSpoolCard(id, s) {
    const card = h('article', s.archived ? 'row-card spool-card is-archived' : 'row-card spool-card');
    card.dataset.id = id;

    const start = Number(s.startGrams) || 0;
    const used = gramsUsedOfSpool(id);
    const remaining = start - used;
    const fraction = start > 0 ? remaining / start : 0;
    const pct = Math.max(0, Math.round(fraction * 100));
    const level = fraction > warnFraction() ? 'ok' : fraction > lowFraction() ? 'warn' : 'fail';

    const top = h('div', 'spool-top');
    top.appendChild(makeSwatch(spoolHex(s), 'swatch swatch-large'));
    const heading = h('div', 'spool-heading');
    const title = h('h2', 'card-title', `${s.brand}, ${s.color}`);
    heading.appendChild(title);
    const badges = h('div', 'badge-row');
    badges.appendChild(makeBadge(String(s.material || 'other').toUpperCase()));
    if (s.archived) badges.appendChild(makeBadge('Archived', 'purple'));
    if (!s.archived && fraction <= lowFraction()) {
        badges.appendChild(makeBadge(remaining <= 0 ? 'Empty!' : 'Filament Low!', 'red'));
    }
    heading.appendChild(badges);
    top.appendChild(heading);
    card.appendChild(top);

    const line = h('p', 'spool-line');
    line.textContent = remaining >= 0
        ? `~${fmtGrams(remaining)}g remaining of ${fmtGrams(start)}g `
        : `Over by ~${fmtGrams(-remaining)}g (${fmtGrams(used)}g logged of ${fmtGrams(start)}g) `;
    line.appendChild(h('span', `pct pct-${level}`, `(~${pct}% remaining)`));
    card.appendChild(line);

    const bar = h('div', 'bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.min(100, pct)));
    bar.setAttribute('aria-label', 'Filament remaining');
    const fill = h('div', level === 'ok' ? 'bar-fill' : level === 'warn' ? 'bar-fill warn' : 'bar-fill fail');
    fill.style.width = Math.min(100, pct) + '%';
    bar.appendChild(fill);
    card.appendChild(bar);

    const hasPrice = Number.isFinite(s.price);
    const perGram = hasPrice && start > 0 ? s.price / start : null;
    card.appendChild(h('div', 'card-meta',
        [
            hasPrice ? fmtMoney(s.price) : 'No price',
            formatDate(s.date),
            perGram ? `~${fmtMoney(perGram, 3)}/g` : '-'
        ].join(' | ')));

    const uses = printsUsingSpool(id);
    card.appendChild(h('div', 'card-meta card-meta-soft',
        uses === 0 ? 'Not used yet' : `Used in ${plural(uses, 'print')} · ${fmtGrams(used)}g logged`));

    const buttons = h('div', 'card-actions');

    const archive = h('button', 'btn btn-outline btn-small', s.archived ? 'Unarchive' : 'Archive');
    archive.type = 'button';
    archive.addEventListener('click', () => archiveSpool(id));
    buttons.appendChild(archive);

    const again = h('button', 'btn btn-outline btn-small', 'Buy again');
    again.type = 'button';
    again.title = 'Add a new spool with the same details';
    again.addEventListener('click', () => openSpoolPopup({ copyFromId: id }));
    buttons.appendChild(again);

    const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deleteSpool(id));
    buttons.appendChild(del);

    card.appendChild(buttons);
    return card;
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
const hexInput = $('hex-input');
const gramsInput = $('grams-ninput');
const priceInput = $('price-ninput');
const spoolDateInput = $('date-dinput');
const spoolError = $('spool-error');

let hexTouched = false;   // true once the person picks a swatch color by hand

function openSpoolPopup({ copyFromId = null } = {}) {
    const source = copyFromId ? state.spools[copyFromId] : null;

    brandInput.value = source ? source.brand : '';
    materialDropdown.value = source && KNOWN_MATERIALS.includes(String(source.material).toLowerCase())
        ? String(source.material).toLowerCase()
        : (source ? 'other' : state.settings.defaultMaterial);
    colorInput.value = source ? source.color : '';
    hexInput.value = source ? spoolHex(source) : DEFAULT_SWATCH;
    hexTouched = Boolean(source && isHex(source.hex));
    gramsInput.value = source ? String(source.startGrams)
        : (state.settings.defaultSpoolGrams > 0 ? String(state.settings.defaultSpoolGrams) : '');
    priceInput.value = source && Number.isFinite(source.price) ? String(source.price) : '';
    spoolDateInput.value = todayLocal();
    clearError(spoolError);
    spoolPopup.style.display = 'block';
    spoolPopup.scrollTop = 0;
    updateBodyLock();
    (source ? gramsInput : brandInput).focus();
}

function closeSpoolPopup() {
    spoolPopup.style.display = 'none';
    updateBodyLock();
}

colorInput.addEventListener('input', () => {
    if (hexTouched) return;
    hexInput.value = guessHex(colorInput.value) || DEFAULT_SWATCH;
});
hexInput.addEventListener('input', () => { hexTouched = true; });

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
        hex: hexTouched && isHex(hexInput.value) ? hexInput.value.toLowerCase() : (guessHex(color) || ''),
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
    renderAll();
    queueNameInput.focus();
    return true;
}

function renderQueue() {
    const list = $('queue-list');
    list.replaceChildren();

    const entries = Object.entries(state.queue).filter(([, q]) => isObject(q));
    const doneCount = entries.filter(([, q]) => q.done).length;
    $('queue-clear-done-button').hidden = doneCount === 0;
    $('queue-sub').textContent = entries.length === 0
        ? 'Things you want to print next.'
        : `${entries.length - doneCount} to print · ${doneCount} done`;

    if (entries.length === 0) {
        list.appendChild(emptyState_('Nothing queued. Add something you want to print.',
            'Use "Log print" on an item to turn it into a print when it is done.'));
        return;
    }

    entries.sort((a, b) => Number(Boolean(a[1].done)) - Number(Boolean(b[1].done)));
    for (const [id, item] of entries) {
        const row = h('div', item.done ? 'queue-item done' : 'queue-item');
        row.dataset.id = id;

        const check = h('input', 'check-input');
        check.type = 'checkbox';
        check.checked = Boolean(item.done);
        check.setAttribute('aria-label', 'Mark as done');
        check.addEventListener('change', () => {
            state.queue[id].done = check.checked;
            saveState();
            renderAll();
        });
        row.appendChild(check);

        const name = h('span', 'queue-name');
        name.append(item.name || 'Untitled');
        const safeLink = normalizeLink(item.link);
        if (safeLink) {
            name.append(' ');
            name.appendChild(makeLink(safeLink, `(${linkLabel(safeLink)})`));
        }
        row.appendChild(name);

        if (!item.done) {
            const log = h('button', 'btn btn-outline btn-small', 'Log print');
            log.type = 'button';
            log.addEventListener('click', () => {
                openPrintPopup({ name: item.name, link: item.link || '', queueId: id });
            });
            row.appendChild(log);
        }

        const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => {
            const removed = state.queue[id];
            delete state.queue[id];
            saveState();
            renderAll();
            notify(`Removed "${removed.name}" from the queue.`, {
                action: {
                    label: 'Undo',
                    onClick: () => {
                        state.queue[id] = removed;
                        saveState();
                        renderAll();
                    }
                }
            });
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
    renderAll();
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

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportData() {
    state.lastExported = new Date().toISOString();
    saveState();

    downloadBlob(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }),
        `print-tracker-${todayLocal()}.json`);

    renderData();
    safeRender('the dashboard', renderDashboard);
    setDataMessage('Exported a backup file.');
}

/** Quote a CSV cell, and defuse spreadsheet formulas (=, +, -, @) in user text. */
function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function buildPrintsCsv() {
    const rows = [['Date', 'Name', 'Result', 'Print time (min)', 'Filament (g)', 'Est. cost', 'Spools', 'Link', 'Notes']];
    const entries = Object.values(state.prints).filter(isObject)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    for (const p of entries) {
        const spoolNames = usageOf(p).map((u) => {
            const s = state.spools[u.spoolId];
            return `${s ? `${s.brand} ${s.color}` : 'Deleted spool'} (${fmtGrams(Number(u.grams) || 0)}g)`;
        }).join('; ');
        rows.push([
            p.date || '', p.name || '', p.result ? 'Success' : 'Failure',
            validMinutes(Number(p.minutes)) || '', fmtGrams(totalGramsOfPrint(p)),
            (costOfPrint(p) + energyCostOfPrint(p)).toFixed(2), spoolNames, p.link || '', p.notes || ''
        ]);
    }
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function exportCsv() {
    if (Object.keys(state.prints).length === 0) {
        setDataMessage('There are no prints to export yet.', true);
        return;
    }
    downloadBlob(new Blob(['﻿' + buildPrintsCsv()], { type: 'text/csv;charset=utf-8' }),
        `print-tracker-prints-${todayLocal()}.csv`);
    setDataMessage('Exported your prints as a CSV file.');
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
            hex: isHex(s.hex) ? s.hex.toLowerCase() : '',
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
        prints[id] = {
            name, date: p.date, result: Boolean(p.result), link: link === null ? '' : link, usage,
            minutes: validMinutes(p.minutes),
            notes: cleanText(p.notes, 500)
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

    // Keep this browser's theme choice unless the backup carries one.
    if (incoming.theme === null) incoming.theme = state.theme;
    if (incoming.settings === null) incoming.settings = state.settings;
    if (incoming.maintenance === null) incoming.maintenance = state.maintenance;
    state = incoming;
    saveState();
    applyTheme();
    syncAllSettings();
    renderAll();
    const extra = result.missingRefs > 0
        ? ` ${result.missingRefs} filament entr${result.missingRefs === 1 ? 'y refers' : 'ies refer'} to spools that are not in the backup.`
        : '';
    setDataMessage(`Imported ${Object.keys(state.prints).length} prints, ${Object.keys(state.spools).length} spools and ${Object.keys(state.queue).length} queue items.${extra}`);
}

$('export-button').addEventListener('click', exportData);
$('export-csv-button').addEventListener('click', exportCsv);
$('import-button').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', handleImport);
$('clear-data-button').addEventListener('click', () => {
    if (!confirm('Delete ALL prints, spools and queue items from this browser? This cannot be undone. Export first if you are unsure.')) return;
    const { theme, settings } = state;
    state = emptyState();
    state.theme = theme;
    state.settings = settings;
    saveState();
    renderAll();
    setDataMessage('All data deleted.');
});

// ---------- Settings ----------

const settingSyncers = [];
let settingsTabName = 'printer';

function addSync(fn) {
    settingSyncers.push(fn);
    fn();
}

function syncAllSettings() {
    settingSyncers.forEach((fn) => fn());
}

/** Change settings: clean them, save, restyle the page and redraw. */
function commitSettings(mutator) {
    mutator(state.settings);
    state.settings = cleanSettings(state.settings);
    saveState();
    applyTheme();
    syncAllSettings();
    renderAll();
}

function openSettings(tab = 'printer') {
    showTab(Sections.SETTINGS);
    showSettingsTab(tab);
}

function showSettingsTab(name) {
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

function settingRow(id, label, hint, control) {
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

function settingCard(title, sub) {
    const card = h('div', 'panel');
    card.appendChild(h('h3', 'panel-title', title));
    if (sub) card.appendChild(h('p', 'secondary-text small card-sub', sub));
    return card;
}

function selectField(id, options, get, set) {
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

function numberField(id, { min, max, step = 'any', placeholder = '', unit = '' }, get, set) {
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

function textField(id, { maxlength, placeholder = '' }, get, set) {
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

function dateField(id, get, set) {
    const input = h('input', 'date-input');
    input.type = 'date';
    input.id = id;
    input.addEventListener('change', () => set(input.value));
    addSync(() => { input.value = get(); });
    return input;
}

function toggleField(id, get, set) {
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

function rangeField(id, { min, max, step = 1, format }, get, set) {
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

function buildPrinterSettings(root) {
    const printer = settingCard('Your printer', 'Shown on the dashboard. Everything here is optional.');
    const set = (fn) => commitSettings((st) => fn(st.printer));
    printer.appendChild(settingRow('set-printer-model', 'Model', null,
        selectField('set-printer-model', [['', 'Not set'], ...PRINTER_MODELS.map((m) => [m, m])],
            () => state.settings.printer.model, (v) => set((p) => { p.model = v; }))));
    printer.appendChild(settingRow('set-printer-name', 'Nickname', 'Something to call it, like "Benchy HQ".',
        textField('set-printer-name', { maxlength: 40, placeholder: 'e.g., Workhorse' },
            () => state.settings.printer.nickname, (v) => set((p) => { p.nickname = v; }))));
    printer.appendChild(settingRow('set-printer-nozzle', 'Nozzle size', null,
        selectField('set-printer-nozzle', NOZZLES.map((n) => [n, `${n} mm`]),
            () => state.settings.printer.nozzle, (v) => set((p) => { p.nozzle = v; }))));
    printer.appendChild(settingRow('set-printer-date', 'Arrival or purchase date', 'A future date becomes a countdown on the dashboard.',
        dateField('set-printer-date', () => state.settings.printer.date, (v) => set((p) => { p.date = v; }))));
    printer.appendChild(settingRow('set-printer-price', 'Price paid', null,
        numberField('set-printer-price', { min: 0, max: 10000000, step: 0.01, placeholder: 'optional' },
            () => state.settings.printer.price, (v) => set((p) => { p.price = v; }))));
    root.appendChild(printer);

    const power = settingCard('Electricity', 'Used to estimate the energy cost of prints that have a print time. Leave both at 0 to skip it.');
    power.appendChild(settingRow('set-printer-watts', 'Average power while printing', 'Check your printer\'s spec sheet or a plug-in power meter.',
        numberField('set-printer-watts', { min: 0, max: 5000, step: 1, placeholder: '0', unit: 'W' },
            () => state.settings.printer.watts || '', (v) => set((p) => { p.watts = v === null ? 0 : v; }))));
    power.appendChild(settingRow('set-printer-kwh', 'Electricity price', 'Per kilowatt-hour, in your currency.',
        numberField('set-printer-kwh', { min: 0, max: 100, step: 0.001, placeholder: '0', unit: 'per kWh' },
            () => state.settings.printer.kwhPrice || '', (v) => set((p) => { p.kwhPrice = v === null ? 0 : v; }))));
    const preview = h('p', 'secondary-text small');
    preview.id = 'energy-preview';
    power.appendChild(preview);
    addSync(() => {
        const { watts, kwhPrice } = state.settings.printer;
        preview.textContent = watts > 0 && kwhPrice > 0
            ? `A 5 hour print would use about ${fmtMoney(5 * (watts / 1000) * kwhPrice)} of electricity.`
            : 'Fill in both values to see an example.';
    });
    root.appendChild(power);

    root.appendChild(buildMaintenanceCard());
}

const MAINTENANCE_PRESETS = [
    { name: 'Clean the build plate', unit: 'prints', every: 10 },
    { name: 'Clean nozzle and extruder', unit: 'hours', every: 100 },
    { name: 'Lubricate rails and rods', unit: 'hours', every: 200 },
    { name: 'Dry opened filament', unit: 'days', every: 30 }
];

let maintenanceListEl = null;

function addMaintenance({ name, unit, every }) {
    const cleanName = cleanText(name, 60);
    const amount = Number(every);
    if (cleanName === '') return 'Give the task a name.';
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return 'Enter how often it is due, above 0.';
    if (!Object.prototype.hasOwnProperty.call(UNIT_LABELS, unit)) return 'Pick hours, days or prints.';
    const stats = calcStats();
    state.maintenance[uid()] = {
        name: cleanName, unit, every: amount,
        lastDate: todayLocal(), atHours: stats.minutes / 60, atPrints: stats.total
    };
    saveState();
    renderAll();
    return '';
}

function buildMaintenanceCard() {
    const card = settingCard('Upkeep reminders', 'Count print hours, days or prints since you last did something. The intervals are your call; check your printer\'s manual.');

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
        const o = h('option', null, UNIT_LABELS[u]);
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

    card.appendChild(h('p', 'setting-hint', 'Quick add, starting points you can change later:'));
    const presets = h('div', 'chips');
    for (const preset of MAINTENANCE_PRESETS) {
        const chip = h('button', 'chip chip-button', `+ ${preset.name} (every ${preset.every} ${UNIT_LABELS[preset.unit]})`);
        chip.type = 'button';
        chip.addEventListener('click', () => addMaintenance(preset));
        presets.appendChild(chip);
    }
    card.appendChild(presets);
    return card;
}

function renderMaintenanceSettings() {
    if (!maintenanceListEl) return;
    maintenanceListEl.replaceChildren();
    const list = maintenanceStatus(calcStats());
    if (list.length === 0) {
        maintenanceListEl.appendChild(emptyState_('No upkeep tasks yet.', 'Add one below, or pick a quick add.'));
        return;
    }
    for (const m of list) maintenanceListEl.appendChild(buildMaintenanceRow(m, { withDelete: true }));
}

function buildAppearanceSettings(root) {
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

function buildPreferenceSettings(root) {
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

function buildSettings() {
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

// ---------- Popups: Escape, backdrop click and Tab focus loop ----------

function trapFocus(popup, e) {
    const focusable = Array.from(popup.querySelectorAll('input, select, textarea, button, a[href]'))
        .filter((el) => !el.disabled && !el.hidden && el.type !== 'hidden' && el.offsetParent !== null && el.type !== 'radio');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

printPopup.addEventListener('click', (e) => { if (e.target === printPopup) closePrintPopup(); });
spoolPopup.addEventListener('click', (e) => { if (e.target === spoolPopup) closeSpoolPopup(); });
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePrintPopup();
        closeSpoolPopup();
    } else if (e.key === 'Tab') {
        if (printPopup.style.display === 'block') trapFocus(printPopup, e);
        else if (spoolPopup.style.display === 'block') trapFocus(spoolPopup, e);
    } else {
        handleShortcut(e);
    }
});

const SHORTCUTS = [
    ['1 - 6', 'Switch tabs'],
    ['N', 'New print'],
    ['S', 'Add a spool'],
    ['/', 'Search prints'],
    ['T', 'Toggle theme'],
    ['?', 'Open these shortcuts']
];

function handleShortcut(e) {
    if (!state.settings.shortcuts || e.ctrlKey || e.metaKey || e.altKey) return;
    if (printPopup.style.display === 'block' || spoolPopup.style.display === 'block') return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;

    const key = e.key.toLowerCase();
    const tabIndex = '123456'.indexOf(key);
    if (key.length === 1 && tabIndex !== -1) {
        showTab(TABS[tabIndex].section);
    } else if (key === 'n') {
        e.preventDefault();
        showTab(Sections.PRINTS);
        openPrintPopup();
    } else if (key === 's') {
        e.preventDefault();
        showTab(Sections.FILA);
        openSpoolPopup();
    } else if (key === '/') {
        e.preventDefault();
        showTab(Sections.PRINTS);
        printSearch.focus();
    } else if (key === 't') {
        toggleTheme();
    } else if (key === '?') {
        openSettings('preferences');
    }
}

// ---------- Start ----------

// Popups live at the top level of the page so they still show when opened from another tab
// (for example "Log print" on the Queue tab).
document.body.appendChild(printPopup);
document.body.appendChild(spoolPopup);

buildHeader();
setupPrintsToolbar();
setupSpoolToolbar();
buildSettings();
applyTheme();
renderAll();
{
    const fromAddress = (typeof location !== 'undefined' ? location.hash : '').replace('#', '');
    showTab(Object.values(Sections).includes(fromAddress) ? fromAddress : Sections.DASH, { updateAddress: false });
}
