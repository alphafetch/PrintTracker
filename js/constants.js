

// ---------- Constants ----------

export const STORAGE_KEY = 'printTracker';
export const CORRUPT_KEY = 'printTracker.corrupt';
export const SCHEMA_VERSION = 1;
export const SETTINGS_VERSION = 2;
export const SPOOL_GRAMS = 1000;   // one "spool" of upkeep counting = 1 kg of filament printed
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_MINUTES = 9999 * 60 + 59;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const KNOWN_MATERIALS = ['pla', 'petg', 'abs', 'asa', 'tpu'];

export const MATERIAL_COLORS = {
    pla: '#F59E0B',
    petg: '#38BDF8',
    abs: '#F87171',
    asa: '#A78BFA',
    tpu: '#4ADE80',
    other: '#94A3B8',
    unknown: '#64748B'
};

export const COLOR_WORDS = {
    black: '#1c1c1e', white: '#f2f2f2', gray: '#8e8e93', grey: '#8e8e93', silver: '#c0c0c8',
    red: '#e53935', orange: '#fb8c00', yellow: '#fdd835', green: '#43a047', lime: '#c0ca33',
    teal: '#00897b', cyan: '#00bcd4', blue: '#1e88e5', navy: '#1a237e', purple: '#8e24aa',
    violet: '#7e57c2', magenta: '#d81b60', pink: '#ec407a', brown: '#6d4c41', beige: '#d7c4a3',
    tan: '#c8a97e', gold: '#d4af37', bronze: '#a9743a', copper: '#b87333', clear: '#cfd8dc',
    transparent: '#cfd8dc', natural: '#e8dfc8'
};
export const DEFAULT_SWATCH = '#6b7280';

export const Sections = Object.freeze({
    DASH: 'dashboard',
    PRINTS: 'prints',
    FILA: 'filament',
    QUEUE: 'queue',
    DATA: 'data',
    SETTINGS: 'settings'
});

export const TABS = [
    { label: 'Dashboard', idPrefix: 'dash',     section: Sections.DASH,     icon: 'dashboard' },
    { label: 'Prints',    idPrefix: 'prints',   section: Sections.PRINTS,   icon: 'cube' },
    { label: 'Filament',  idPrefix: 'fila',     section: Sections.FILA,     icon: 'spool' },
    { label: 'Queue',     idPrefix: 'queue',    section: Sections.QUEUE,    icon: 'list' },
    { label: 'Data',      idPrefix: 'data',     section: Sections.DATA,     icon: 'download' },
    { label: 'Settings',  idPrefix: 'settings', section: Sections.SETTINGS, icon: 'gear' }
];

// Accent colors. Each has a dark-theme and a light-theme variant so text stays readable.
export const ACCENTS = {
    amber:   { label: 'Amber',   dark: { accent: '#f59e0b', strong: '#fbbf24', link: '#fbbf24' }, light: { accent: '#f59e0b', strong: '#d97706', link: '#b45309' } },
    sky:     { label: 'Sky',     dark: { accent: '#38bdf8', strong: '#7dd3fc', link: '#7dd3fc' }, light: { accent: '#0ea5e9', strong: '#0284c7', link: '#0369a1' } },
    emerald: { label: 'Emerald', dark: { accent: '#34d399', strong: '#6ee7b7', link: '#6ee7b7' }, light: { accent: '#10b981', strong: '#059669', link: '#047857' } },
    teal:    { label: 'Teal',    dark: { accent: '#2dd4bf', strong: '#5eead4', link: '#5eead4' }, light: { accent: '#14b8a6', strong: '#0d9488', link: '#0f766e' } },
    violet:  { label: 'Violet',  dark: { accent: '#a78bfa', strong: '#c4b5fd', link: '#c4b5fd' }, light: { accent: '#8b5cf6', strong: '#7c3aed', link: '#6d28d9' } },
    rose:    { label: 'Rose',    dark: { accent: '#fb7185', strong: '#fda4af', link: '#fda4af' }, light: { accent: '#f43f5e', strong: '#e11d48', link: '#be123c' } }
};

export const BACKGROUNDS = [
    { key: 'layers',    label: 'Layers' },
    { key: 'honeycomb', label: 'Honeycomb' },
    { key: 'blueprint', label: 'Blueprint' },
    { key: 'dots',      label: 'Dot grid' },
    { key: 'aurora',    label: 'Glow' },
    { key: 'none',      label: 'Plain' }
];

export const NOZZLES = ['0.2', '0.4', '0.6', '0.8'];
export const CURRENCIES = ['$', '\u20AC', '\u00A3', '\u00A5', '\u20B9', '\u20A9', 'C$', 'A$', 'CHF', 'kr', 'z\u0142'];
export const SUFFIX_CURRENCIES = ['kr', 'z\u0142'];
export const DATE_FORMATS = ['mdy', 'dmy', 'iso'];
export const UNIT_LABELS = { hours: 'hours', days: 'days', prints: 'prints', spools: 'spools' };

// Simple stroke icons (24x24 viewBox). Built with createElementNS, never innerHTML.
export const ICONS = {
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

// Filled Material Symbols (24x24) used where a recognizable system icon helps.
export const FILLED_ICONS = {
    edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 000-1.41l-2.34-2.34a.996.996 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
};

export const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- Failure reasons, date ranges ----------

/** Why a print failed. The key is what gets saved. */
export const FAIL_REASONS = [
    ['spaghetti', 'Spaghetti (print came loose)'],
    ['warping', 'Warping or curling'],
    ['clog', 'Nozzle clog or under-extrusion'],
    ['shift', 'Layer shift'],
    ['adhesion', 'Poor bed adhesion'],
    ['stringing', 'Stringing or blobs'],
    ['other', 'Something else']
];

export function failReasonLabel(key) {
    const hit = FAIL_REASONS.find(([k]) => k === key);
    return hit ? hit[1] : '';
}

/** Date ranges for the dashboard stats. */
export const RANGES = [
    ['all', 'All time'],
    ['month', 'This month'],
    ['30', 'Last 30 days'],
    ['90', 'Last 90 days'],
    ['year', 'This year']
];
