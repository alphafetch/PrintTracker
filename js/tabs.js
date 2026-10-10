import { Sections, TABS } from './constants.js';
import { syncAllSettings } from './settings.js';
import { saveState, state } from './state.js';
import { applyTheme, currentTheme } from './theme.js';
import { $, h, icon } from './util.js';

// ---------- Tabs ----------

export const sectionEls = {
    [Sections.DASH]: $('dashboard'),
    [Sections.PRINTS]: $('prints'),
    [Sections.FILA]: $('filament'),
    [Sections.QUEUE]: $('queue'),
    [Sections.DATA]: $('data'),
    [Sections.SETTINGS]: $('settings')
};
export const tabButtons = {};

export function buildHeader() {
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

export function toggleTheme() {
    state.theme = currentTheme() === 'light' ? 'dark' : 'light';
    saveState();
    applyTheme();
    syncAllSettings();
}

export function showTab(section, { updateAddress = true } = {}) {
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
