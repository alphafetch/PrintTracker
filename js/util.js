import { COLOR_WORDS, DEFAULT_SWATCH, FILLED_ICONS, ICONS, KNOWN_MATERIALS, MAX_MINUTES, SUFFIX_CURRENCIES, SVG_NS } from './constants.js';
import { state } from './state.js';

// ---------- Small helpers ----------

export const $ = (id) => document.getElementById(id);

/** Create an element with an optional class and text (text is never parsed as HTML). */
export function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

export function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

export function icon(name) {
    if (Object.prototype.hasOwnProperty.call(FILLED_ICONS, name)) {
        const filled = svgEl('svg', { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true', class: 'icon icon-filled' });
        filled.appendChild(svgEl('path', { d: FILLED_ICONS[name] }));
        return filled;
    }
    const svg = svgEl('svg', {
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon'
    });
    for (const d of ICONS[name] || []) svg.appendChild(svgEl('path', { d }));
    return svg;
}

export function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function uid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // randomUUID only exists on HTTPS/localhost, so fall back for plain-HTTP LAN use.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function todayLocal() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

export function isValidDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    if (y < 1900 || y > 2100) return false;
    const d = new Date(Date.UTC(y, mo - 1, da));
    return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === da;
}

export function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === 'string' ? iso : '');
    if (!m) return 'No date';
    switch (state.settings.dateFormat) {
        case 'dmy': return `${m[3]}/${m[2]}/${m[1]}`;
        case 'iso': return `${m[1]}-${m[2]}-${m[3]}`;
        default: return `${m[2]}/${m[3]}/${m[1]}`;
    }
}

/** Whole days from one ISO date to another (negative if `to` is earlier). */
export function daysBetween(fromIso, toIso) {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromIso);
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIso);
    if (!a || !b) return 0;
    return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86400000);
}

export function fmtGrams(n) {
    return String(Math.round(n * 10) / 10);
}

export function fmtMoney(n, digits = 2) {
    const sym = state.settings.currency;
    const text = n.toFixed(digits);
    if (SUFFIX_CURRENCIES.includes(sym)) return `${text} ${sym}`;
    return sym.length > 1 && /^[A-Z]{3}$/.test(sym) ? `${sym} ${text}` : sym + text;
}

export function fmtNum(n) {
    return String(Math.round(n * 10) / 10);
}

export function clampNum(v, min, max, fallback) {
    const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function fmtDuration(minutes) {
    const m = Math.round(Number(minutes) || 0);
    if (m <= 0) return '';
    const hrs = Math.floor(m / 60);
    const mins = m % 60;
    if (hrs === 0) return `${mins}m`;
    return mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`;
}

export function cleanText(v, max = 200) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function validMinutes(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_MINUTES ? Math.round(v) : null;
}

export function isHex(v) {
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

export function guessHex(colorName) {
    const words = String(colorName || '').toLowerCase().split(/[^a-z]+/);
    for (const w of words) {
        if (Object.prototype.hasOwnProperty.call(COLOR_WORDS, w)) return COLOR_WORDS[w];
    }
    return '';
}

export function spoolHex(spool) {
    if (isObject(spool)) {
        if (isHex(spool.hex)) return spool.hex;
        const guess = guessHex(spool.color);
        if (guess) return guess;
    }
    return DEFAULT_SWATCH;
}

export function materialKey(spool) {
    if (!isObject(spool)) return 'unknown';
    const m = String(spool.material || 'other').toLowerCase();
    return KNOWN_MATERIALS.includes(m) ? m : 'other';
}

export function makeSwatch(hex, className = 'swatch') {
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
export function normalizeLink(value) {
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

export function linkLabel(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (error) {
        return url;
    }
}

export function makeLink(url, text) {
    const a = h('a', 'link-text', text === undefined ? linkLabel(url) : text);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = url;
    return a;
}

export function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
    return false;
}

export function clearError(el) {
    el.textContent = '';
    el.hidden = true;
}

export let toastTimer = null;
/**
 * Show a short message. The second argument is either a boolean (isError) or
 * { isError, action: { label, onClick } } for toasts with an Undo button.
 */
/** Fade the toast out (it stays in the page, just invisible and not clickable). */
export function hideToast() {
    const toast = $('toast');
    toast.classList.remove('show');
}

export function notify(message, options = false) {
    const opts = typeof options === 'boolean' ? { isError: options } : (options || {});
    const toast = $('toast');
    toast.replaceChildren(h('span', 'toast-text', message));
    if (opts.action) {
        const button = h('button', 'toast-action', opts.action.label);
        button.type = 'button';
        button.addEventListener('click', () => {
            hideToast();
            opts.action.onClick();
        });
        toast.appendChild(button);
    }
    toast.className = opts.isError ? 'error show' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.action ? 7000 : 4500);
}

export function isSafeId(id) {
    return /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== '__proto__';
}
