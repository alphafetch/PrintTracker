import { AMS_TYPES, BRANDS, brandOfLegacyModel, findPrinter } from './catalog.js';
import { ACCENTS, BACKGROUNDS, CORRUPT_KEY, CURRENCIES, DATE_FORMATS, ANALYSIS_GROUPS, FAIL_REASONS, RANGES, KNOWN_MATERIALS, MAX_EXTRA_PRINTERS, NOZZLES, SCHEMA_VERSION, SETTINGS_VERSION, STORAGE_KEY, UNIT_LABELS } from './constants.js';
import { clampNum, cleanText, isObject, isSafeId, isValidDate, notify, todayLocal, validMinutes } from './util.js';

// ---------- State and storage ----------

export function defaultSettings() {
    return {
        accent: 'amber',
        background: 'blueprint',
        bgStrength: 60,
        animate: true,
        density: 'comfortable',
        currency: '$',
        dateFormat: 'mdy',
        lowPercent: 25,
        defaultMaterial: 'pla',
        defaultSpoolGrams: 1000,
        backupDays: 30,
        dryDays: 30,
        shortcuts: true,
        settingsVersion: SETTINGS_VERSION,
        customPresets: {},
        // more printers: { id: same fields as `printer` }. The `printer` below is the main one.
        printers: {},
        // watts, kwhPrice and price: null means "use the automatic value", a number is the person's own
        printer: { brand: '', model: '', nickname: '', nozzle: '0.4', date: '', price: null, watts: null, kwhPrice: null, wear: null }
    };
}

/** One printer's details. Before settings version 2, 0 meant "not set"; now null means that and 0 is a real value. */
export function cleanPrinter(raw, legacy = false) {
    const d = defaultSettings().printer;
    const p = isObject(raw) ? raw : {};
    const own = (v, max, digits) => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || (legacy && n === 0)) return null;
        const f = Math.pow(10, digits);
        return Math.round(Math.min(n, max) * f) / f;
    };
    let brand = BRANDS.some((b) => b.key === p.brand) ? p.brand : brandOfLegacyModel(p.model);
    const model = findPrinter(brand, p.model) ? p.model : '';
    if (!brand) brand = '';
    return {
        brand,
        model,
        nickname: cleanText(p.nickname, 40),
        nozzle: NOZZLES.includes(String(p.nozzle)) ? String(p.nozzle) : d.nozzle,
        date: isValidDate(p.date) ? p.date : '',
        price: own(p.price, 10000000, 2),
        watts: own(p.watts, 5000, 0),
        kwhPrice: own(p.kwhPrice, 100, 4),
        wear: own(p.wear, 10000, 4)
    };
}

/** The extra printers: { id: printer }, at most MAX_EXTRA_PRINTERS. */
export function cleanPrinters(raw) {
    const out = {};
    if (!isObject(raw)) return out;
    for (const [id, p] of Object.entries(raw)) {
        if (Object.keys(out).length >= MAX_EXTRA_PRINTERS) break;
        if (!isSafeId(id) || !isObject(p)) continue;
        out[id] = cleanPrinter(p);
    }
    return out;
}

/** Turn anything (including junk from an import) into a complete, valid settings object. */
export function cleanSettings(raw) {
    const d = defaultSettings();
    const s = isObject(raw) ? raw : {};
    const legacy = !(Number(s.settingsVersion) >= SETTINGS_VERSION);

    let background = BACKGROUNDS.some((b) => b.key === s.background) ? s.background : d.background;
    if (legacy && background === 'layers') background = 'blueprint';

    return {
        accent: Object.prototype.hasOwnProperty.call(ACCENTS, s.accent) ? s.accent : d.accent,
        background,
        bgStrength: Math.round(clampNum(s.bgStrength, 0, 100, d.bgStrength)),
        animate: typeof s.animate === 'boolean' ? s.animate : d.animate,
        density: s.density === 'compact' ? 'compact' : 'comfortable',
        currency: CURRENCIES.includes(s.currency) ? s.currency : d.currency,
        dateFormat: DATE_FORMATS.includes(s.dateFormat) ? s.dateFormat : d.dateFormat,
        lowPercent: Math.round(clampNum(s.lowPercent, 5, 50, d.lowPercent)),
        defaultMaterial: [...KNOWN_MATERIALS, 'other'].includes(s.defaultMaterial) ? s.defaultMaterial : d.defaultMaterial,
        defaultSpoolGrams: Math.round(clampNum(s.defaultSpoolGrams, 0, 100000, d.defaultSpoolGrams)),
        backupDays: Math.round(clampNum(s.backupDays, 0, 365, d.backupDays)),
        dryDays: Math.round(clampNum(s.dryDays, 0, 365, d.dryDays)),
        shortcuts: typeof s.shortcuts === 'boolean' ? s.shortcuts : d.shortcuts,
        settingsVersion: SETTINGS_VERSION,
        customPresets: cleanPresets(s.customPresets),
        printers: cleanPrinters(s.printers),
        printer: cleanPrinter(s.printer, legacy)
    };
}

/** Saved upkeep presets: { id: { name, tasks: [{ name, unit, every }] } }. */
export function cleanPresets(raw) {
    const out = {};
    if (!isObject(raw)) return out;
    for (const [id, preset] of Object.entries(raw).slice(0, 20)) {
        if (!isSafeId(id) || !isObject(preset) || !Array.isArray(preset.tasks)) continue;
        const name = cleanText(preset.name, 40);
        if (name === '') continue;
        const tasks = [];
        for (const t of preset.tasks.slice(0, 40)) {
            if (!isObject(t)) continue;
            const taskName = cleanText(t.name, 60);
            const every = Number(t.every);
            if (taskName === '' || !Object.prototype.hasOwnProperty.call(UNIT_LABELS, t.unit)) continue;
            if (!Number.isFinite(every) || every <= 0 || every > 1000000) continue;
            tasks.push({ name: taskName, unit: t.unit, every });
        }
        if (tasks.length > 0) out[id] = { name, tasks };
    }
    return out;
}

/** A printer id that exists ('' means the main printer). */
export function cleanPrinterId(id, printers) {
    return typeof id === 'string' && id !== '' && isObject(printers) && Object.prototype.hasOwnProperty.call(printers, id) ? id : '';
}

/** Clean the maintenance list. Entries that cannot be repaired are dropped. */
export function cleanMaintenance(raw, printers = {}) {
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
            atPrints: Math.round(clampNum(t.atPrints, 0, 10000000, 0)),
            atGrams: clampNum(t.atGrams, 0, 1e10, 0),
            printerId: cleanPrinterId(t.printerId, printers)
        };
    }
    return out;
}

/** AMS units: { id: { name, type, slots: [spoolId or ''] } }. Slots pointing at missing spools are emptied. */
export function cleanAms(raw, spools) {
    const out = {};
    if (!isObject(raw)) return out;
    const used = new Set();
    for (const [id, u] of Object.entries(raw).slice(0, 12)) {
        if (!isSafeId(id) || !isObject(u)) continue;
        const info = AMS_TYPES.find((t) => t.key === u.type);
        const name = cleanText(u.name, 30);
        if (!info || name === '') continue;
        const given = Array.isArray(u.slots) ? u.slots : [];
        const slots = [];
        for (let i = 0; i < info.slots; i++) {
            const sid = given[i];
            const ok = typeof sid === 'string' && isSafeId(sid) && isObject(spools) && isObject(spools[sid]) && !used.has(sid);
            if (ok) used.add(sid);
            slots.push(ok ? sid : '');
        }
        const price = typeof u.price === 'number' && u.price >= 0 && u.price <= 10000000 ? Math.round(u.price * 100) / 100 : null;
        out[id] = { name, type: info.key, slots, price };
    }
    return out;
}

/** Wear parts (nozzle, build plate...): { id: { name, lastDate, atHours, lifespan|null, price|null } }. */
export function cleanParts(raw, printers = {}) {
    const out = {};
    if (!isObject(raw)) return out;
    for (const [id, p] of Object.entries(raw).slice(0, 30)) {
        if (!isSafeId(id) || !isObject(p)) continue;
        const name = cleanText(p.name, 40);
        if (name === '') continue;
        const num = (v, max, digits) => {
            if (v === null || v === undefined || v === '') return null;
            const n = Number(v);
            if (!Number.isFinite(n) || n <= 0) return null;
            const f = Math.pow(10, digits);
            return Math.round(Math.min(n, max) * f) / f;
        };
        out[id] = {
            name,
            lastDate: isValidDate(p.lastDate) ? p.lastDate : todayLocal(),
            atHours: clampNum(p.atHours, 0, 10000000, 0),
            lifespan: num(p.lifespan, 100000, 1),
            price: num(p.price, 10000000, 2),
            printerId: cleanPrinterId(p.printerId, printers)
        };
    }
    return out;
}

export function cleanUi(raw) {
    const u = isObject(raw) ? raw : {};
    const when = typeof u.backupDismissedAt === 'string' ? new Date(u.backupDismissedAt) : null;
    return {
        backupDismissedAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
        range: RANGES.some(([k]) => k === u.range) ? u.range : 'all',
        analysisGroup: ANALYSIS_GROUPS.some(([k]) => k === u.analysisGroup) ? u.analysisGroup : 'brand-material'
    };
}

export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;

/** Tags for a print: an array (or comma-separated text) cleaned to short, unique labels. Duplicates ignore case. */
export function cleanTags(raw) {
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
    const out = [];
    const seen = new Set();
    for (const item of list) {
        if (typeof item !== 'string') continue;
        const tag = cleanText(item.replace(/[,;]/g, ' ').replace(/\s+/g, ' '), MAX_TAG_LENGTH).trim();
        const key = tag.toLowerCase();
        if (tag === '' || seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
        if (out.length >= MAX_TAGS) break;
    }
    return out;
}

/** Print-profile notes: { name, layer, infill, supports } of short text, or null when all are empty. */
export function cleanProfile(raw) {
    if (!isObject(raw)) return null;
    const out = {
        name: cleanText(raw.name, 60),
        layer: cleanText(raw.layer, 20),
        infill: cleanText(raw.infill, 20),
        supports: cleanText(raw.supports, 40)
    };
    return Object.values(out).some((v) => v !== '') ? out : null;
}

/**
 * What a queued item should be printed with, copied from an earlier print: { minutes, usage, profile, notes, printerId },
 * or null when there is nothing in it.
 */
export function cleanQueueSpec(raw) {
    if (!isObject(raw)) return null;
    const usage = [];
    for (const u of Array.isArray(raw.usage) ? raw.usage.slice(0, 12) : []) {
        if (!isObject(u) || typeof u.spoolId !== 'string' || !isSafeId(u.spoolId)) continue;
        const grams = Number(u.grams);
        if (!Number.isFinite(grams) || grams <= 0 || grams > 1000000) continue;
        if (usage.some((x) => x.spoolId === u.spoolId)) continue;
        usage.push({ spoolId: u.spoolId, grams: Math.round(grams * 100) / 100 });
    }
    const spec = {
        minutes: validMinutes(Number(raw.minutes)),
        usage,
        profile: cleanProfile(raw.profile),
        notes: cleanText(raw.notes, 500),
        tags: cleanTags(raw.tags),
        printerId: typeof raw.printerId === 'string' && isSafeId(raw.printerId) ? raw.printerId : ''
    };
    return spec.minutes || usage.length > 0 || spec.profile || spec.notes || spec.tags.length > 0 || spec.printerId ? spec : null;
}

export function cleanFailReason(raw, result) {
    return !result && FAIL_REASONS.some(([k]) => k === raw) ? raw : '';
}

export function emptyState() {
    return {
        schemaVersion: SCHEMA_VERSION,
        prints: {},
        spools: {},
        queue: {},
        maintenance: {},
        settings: defaultSettings(),
        hideArchived: false,
        theme: null,
        lastExported: null,
        ui: { backupDismissedAt: null, range: 'all', analysisGroup: 'brand-material' },
        ams: {},
        parts: {}
    };
}

export function normalizeState(data) {
    const s = isObject(data) ? data : {};
    const settings = cleanSettings(s.settings);
    return {
        schemaVersion: SCHEMA_VERSION,
        prints: isObject(s.prints) ? s.prints : {},
        spools: isObject(s.spools) ? s.spools : {},
        queue: isObject(s.queue) ? s.queue : {},
        maintenance: cleanMaintenance(s.maintenance, settings.printers),
        settings,
        hideArchived: Boolean(s.hideArchived),
        theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : null,
        lastExported: typeof s.lastExported === 'string' ? s.lastExported : null,
        ui: cleanUi(s.ui),
        ams: cleanAms(s.ams, isObject(s.spools) ? s.spools : {}),
        parts: cleanParts(s.parts, settings.printers)
    };
}

export function loadState() {
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

export let state = loadState();
export function setState(next) { state = next; }

export function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return true;
    } catch (error) {
        console.error(error);
        notify('Could not save: browser storage is full or blocked. Export your data to keep it.', true);
        return false;
    }
}
