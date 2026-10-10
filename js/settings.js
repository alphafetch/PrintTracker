import { Sections } from './constants.js';
import { showTab } from './tabs.js';
import { $, h } from './util.js';

import { buildAppearanceSettings } from './settingsAppearance.js';
import { buildPreferenceSettings } from './settingsPrefs.js';
import { buildPrinterSettings } from './settingsPrinter.js';

// ---------- Settings (tabs) ----------

export let settingsTabName = 'printer';

export function openSettings(tab = 'printer') {
    showTab(Sections.SETTINGS);
    showSettingsTab(tab);
}

export function showSettingsTab(name) {
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


export function buildSettings() {
    const names = [['printer', 'Printer'], ['appearance', 'Appearance'], ['preferences', 'Preferences']];
    const bar = $('settings-tabs');
    for (const [key, label] of names) {
        const b = h('button', 'subtab', label);
        b.type = 'button';
        b.id = 'settings-tab-' + key;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-controls', 'settings-' + key);
        b.addEventListener('click', () => showSettingsTab(key));
        b.addEventListener('keydown', (e) => {
            const keys = names.map(([k]) => k);
            const at = keys.indexOf(key);
            let next = -1;
            if (e.key === 'ArrowRight') next = (at + 1) % keys.length;
            else if (e.key === 'ArrowLeft') next = (at - 1 + keys.length) % keys.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = keys.length - 1;
            if (next === -1) return;
            e.preventDefault();
            showSettingsTab(keys[next]);
            $('settings-tab-' + keys[next]).focus();
        });
        bar.appendChild(b);
    }
    buildPrinterSettings($('settings-printer'));
    buildAppearanceSettings($('settings-appearance'));
    buildPreferenceSettings($('settings-preferences'));
    showSettingsTab(settingsTabName);
}

