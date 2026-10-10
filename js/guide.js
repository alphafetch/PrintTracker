import { Sections } from './constants.js';
import { openPrintPopup } from './printPopup.js';
import { makeBadge, renderAll } from './render.js';
import { openSettings } from './settings.js';
import { openSpoolPopup } from './spoolPopup.js';
import { saveState, state } from './state.js';
import { showTab } from './tabs.js';
import { $, h, isObject } from './util.js';

// ---------- Getting started: a short checklist for anyone new to the app ----------

/** The steps, with whether each one is done (worked out from what is already saved) and what its button does. */
export function guideSteps() {
    const spools = Object.values(state.spools).filter(isObject);
    return [
        {
            id: 'printer', title: 'Pick your printer',
            text: 'Choose the brand and model in Settings. It fills in power use and price for cost estimates. Skip it if your printer is not listed.',
            done: state.settings.printer.brand !== '', required: true,
            action: 'Open settings', run: () => openSettings('printer')
        },
        {
            id: 'spool', title: 'Add a filament spool',
            text: 'Enter the brand, colour, weight and price of a spool you own. Prints take their filament from the spools you pick.',
            done: spools.length > 0, required: true,
            action: 'Add a spool', run: () => { showTab(Sections.FILA); openSpoolPopup(); }
        },
        {
            id: 'ams', title: 'Set up your AMS',
            text: 'If your printer has an AMS, add it on the Filament tab and put your spools in its slots. They then appear as one-click chips when you log a print.',
            done: Object.keys(state.ams || {}).length > 0, required: false,
            action: 'Go to Filament', run: () => showTab(Sections.FILA)
        },
        {
            id: 'print', title: 'Log your first print',
            text: 'Give it a name, the grams used from each spool and, if you like, the print time. The slicer shows these numbers, and you can fill them from a slicer file.',
            done: Object.keys(state.prints).length > 0, required: true,
            action: 'Log a print', run: () => openPrintPopup()
        },
        {
            id: 'backup', title: 'Back up your data',
            text: 'Everything is saved in this browser only, on this device. Export a backup file now and then, and use it to move to another device.',
            done: typeof state.lastExported === 'string' && state.lastExported !== '', required: true,
            action: 'Open backup', run: () => $('data-button').click()
        }
    ];
}

/** The checklist panel for the top of the dashboard, or null if it was hidden. */
export function buildGuidePanel() {
    if (state.ui.guideDismissed) return null;
    const steps = guideSteps();
    const required = steps.filter((s) => s.required);
    const doneCount = required.filter((s) => s.done).length;
    const allDone = doneCount === required.length;

    const panel = h('div', 'panel guide-panel');
    panel.id = 'guide-panel';
    const head = h('div', 'guide-head');
    head.appendChild(h('h3', 'panel-title', allDone ? 'Getting started: all set' : 'Getting started'));
    const hide = h('button', 'btn btn-outline btn-small', 'Hide guide');
    hide.type = 'button';
    hide.id = 'guide-hide';
    hide.addEventListener('click', () => {
        state.ui.guideDismissed = true;
        saveState();
        renderAll();
    });
    head.appendChild(hide);
    panel.appendChild(head);

    if (allDone) {
        panel.appendChild(h('p', 'secondary-text', 'You have done the basics. You can bring this guide back any time in Settings, under Preferences.'));
        return panel;
    }

    const progress = h('p', 'guide-progress', `${doneCount} of ${required.length} steps done`);
    progress.id = 'guide-progress';
    panel.appendChild(progress);

    const list = h('ol', 'guide-steps');
    for (const step of steps) {
        const li = h('li', step.done ? 'guide-step is-done' : 'guide-step');
        li.dataset.step = step.id;
        const body = h('div', 'guide-body');
        const title = h('span', 'guide-title', step.title);
        if (!step.required) title.append(' (optional)');
        body.appendChild(title);
        body.appendChild(h('span', 'guide-text', step.text));
        li.appendChild(body);
        if (step.done) {
            li.appendChild(makeBadge('Done', 'green'));
        } else {
            const go = h('button', 'btn btn-outline btn-small', step.action);
            go.type = 'button';
            go.addEventListener('click', step.run);
            li.appendChild(go);
        }
        list.appendChild(li);
    }
    panel.appendChild(list);
    return panel;
}

/** Bring the guide back (used by the button in Settings). */
export function showGuideAgain() {
    state.ui.guideDismissed = false;
    saveState();
    renderAll();
}
