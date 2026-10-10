import { CURRENCIES, KNOWN_MATERIALS } from './constants.js';
import { SHORTCUTS } from './popups.js';
import { renderAll } from './render.js';
import { defaultSettings, saveState, state } from './state.js';
import { applyTheme } from './theme.js';
import { h, notify } from './util.js';

import { syncAllSettings, commitSettings, settingRow, settingCard, selectField, numberField, toggleField } from './settingsKit.js';

// ---------- Settings: preferences ----------

export function buildPreferenceSettings(root) {
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
    filament.appendChild(settingRow('set-dry-days', 'Drying reminder', 'Flag a spool as "needs drying?" when it has been open this many days since it was opened or last dried. Use 0 to turn it off.',
        numberField('set-dry-days', { min: 0, max: 365, step: 1, placeholder: '30', unit: 'days' },
            () => state.settings.dryDays, (v) => commitSettings((st) => { st.dryDays = v === null ? 0 : v; }))));
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
        const before = { settings: state.settings, theme: state.theme };
        state.settings = defaultSettings();
        state.theme = null;
        saveState();
        applyTheme();
        syncAllSettings();
        renderAll();
        notify('Settings reset.', {
            action: {
                label: 'Undo',
                onClick: () => {
                    state.settings = before.settings;
                    state.theme = before.theme;
                    saveState();
                    applyTheme();
                    syncAllSettings();
                    renderAll();
                }
            }
        });
    });
    reset.appendChild(resetButton);
    root.appendChild(reset);
}

