import { ACCENTS, BACKGROUNDS } from './constants.js';
import { saveState, state } from './state.js';
import { applyTheme } from './theme.js';
import { h } from './util.js';

import { syncAllSettings, commitSettings, addSync, settingRow, settingCard, selectField, toggleField, rangeField } from './settingsKit.js';

// ---------- Settings: appearance ----------

export function buildAppearanceSettings(root) {
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

