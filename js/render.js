import { renderAms } from './ams.js';
import { renderDashboard } from './dashboard.js';
import { renderData } from './data.js';
import { renderPrints } from './prints.js';
import { renderQueue } from './queue.js';
import { renderMaintenanceSettings } from './settings.js';
import { renderSpools } from './spools.js';
import { h, notify } from './util.js';

// ---------- Rendering: everything ----------

export function safeRender(name, fn) {
    try {
        fn();
    } catch (error) {
        console.error(`Failed to render ${name}.`, error);
        notify(`Could not display ${name}. Check the console for details.`, true);
    }
}

export function renderAll() {
    safeRender('the dashboard', renderDashboard);
    safeRender('prints', renderPrints);
    safeRender('spools', renderSpools);
    safeRender('the AMS', renderAms);
    safeRender('the queue', renderQueue);
    safeRender('data info', renderData);
    safeRender('maintenance', renderMaintenanceSettings);
}

export function plural(n, word, pluralWord) {
    return `${n} ${n === 1 ? word : (pluralWord || word + 's')}`;
}

export function emptyState_(message, hint) {
    const box = h('div', 'empty-state');
    box.appendChild(h('p', 'warn-text empty-title', message));
    if (hint) box.appendChild(h('p', 'secondary-text small', hint));
    return box;
}

export function makeBadge(text, kind) {
    return h('span', kind ? `badge badge-${kind}` : 'badge', text);
}
