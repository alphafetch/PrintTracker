import { ACCENTS } from './constants.js';
import { state } from './state.js';
import { $, icon } from './util.js';

// ---------- Theme ----------

export function currentTheme() {
    if (state.theme === 'light' || state.theme === 'dark') return state.theme;
    try {
        if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches) {
            return 'light';
        }
    } catch (error) { /* fall through to dark */ }
    return 'dark';
}

export function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Apply theme, accent color, background style, motion and density to the page. */
export function applyTheme() {
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
