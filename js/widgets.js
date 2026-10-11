import { autoBackupRecent } from './autoBackup.js';
import { BRANDS } from './catalog.js';
import { calcStats, effectivePrice, hardwareCost, hasManyPrinters, printerCfg, printerIds, printerStats } from './calc.js';
import { SPOOL_GRAMS, UNIT_LABELS } from './constants.js';
import { dashPanel } from './dashboard.js';
import { exportData } from './data.js';
import { plural, renderAll } from './render.js';
import { openSettings } from './settings.js';
import { saveState, state } from './state.js';
import { daysBetween, fmtDuration, fmtMoney, fmtNum, formatDate, h, icon, notify, todayLocal } from './util.js';

// ---------- Dashboard pieces: backup reminder, printer, achievements ----------

export function buildBackupBanner() {
    const days = state.settings.backupDays;
    const hasData = Object.keys(state.prints).length + Object.keys(state.spools).length > 0;
    if (!days || !hasData) return null;
    if (autoBackupRecent(days)) return null;   // a folder backup counts

    const last = state.lastExported ? new Date(state.lastExported) : null;
    const known = last && !Number.isNaN(last.getTime());
    const age = known ? Math.floor((Date.now() - last.getTime()) / 86400000) : Infinity;
    if (age < days) return null;

    // The X hides the reminder for one reminder period, then it comes back.
    const dismissed = state.ui.backupDismissedAt ? new Date(state.ui.backupDismissedAt) : null;
    if (dismissed && (Date.now() - dismissed.getTime()) / 86400000 < days) return null;

    const banner = h('div', 'banner');
    banner.id = 'backup-banner';
    banner.appendChild(icon('alert'));
    const text = h('p', 'banner-text');
    text.appendChild(h('strong', null, known ? `Your last backup was ${plural(age, 'day')} ago. ` : 'You have not backed up yet. '));
    text.append('Everything lives in this browser, so keep a copy.');
    banner.appendChild(text);
    const button = h('button', 'btn btn-primary btn-small', 'Export backup');
    button.type = 'button';
    button.addEventListener('click', exportData);
    banner.appendChild(button);

    const close = h('button', 'icon-btn banner-close');
    close.type = 'button';
    close.id = 'backup-banner-close';
    close.setAttribute('aria-label', 'Dismiss backup reminder');
    close.title = `Hide this for ${plural(days, 'day')}`;
    close.appendChild(icon('close'));
    close.addEventListener('click', () => {
        const before = state.ui.backupDismissedAt;
        state.ui.backupDismissedAt = new Date().toISOString();
        saveState();
        renderAll();
        notify(`Backup reminder hidden for ${plural(days, 'day')}.`, {
            action: {
                label: 'Undo',
                onClick: () => {
                    state.ui.backupDismissedAt = before;
                    saveState();
                    renderAll();
                }
            }
        });
    });
    banner.appendChild(close);
    return banner;
}

/**
 * Every upkeep task with how much of its interval is used. `stats` is the all-prints stats; when there is more
 * than one printer, each task counts only its own printer's prints. `printerId` limits the list to one printer.
 */
export function maintenanceStatus(stats, printerId = null) {
    const today = todayLocal();
    const many = hasManyPrinters();
    const cache = {};
    const statsOf = (task) => {
        if (!many) return stats;
        const id = task.printerId || '';
        if (!cache[id]) cache[id] = calcStats('all', id);
        return cache[id];
    };
    const list = Object.entries(state.maintenance)
        .filter(([, task]) => printerId === null || (task.printerId || '') === printerId)
        .map(([id, task]) => {
            const st = statsOf(task);
            const used = task.unit === 'hours' ? Math.max(0, st.minutes / 60 - task.atHours)
                : task.unit === 'prints' ? Math.max(0, st.total - task.atPrints)
                : task.unit === 'spools' ? Math.max(0, (st.grams - task.atGrams) / SPOOL_GRAMS)
                : Math.max(0, daysBetween(task.lastDate, today));
            const remaining = task.every - used;
            return { id, task, used, remaining, fraction: used / task.every, due: remaining <= 0 };
        });
    list.sort((a, b) => b.fraction - a.fraction);
    return list;
}

/** "1 hour", "2.5 hours", "1 print", "3 prints", "1 day". */
export function unitCount(n, unit) {
    const text = fmtNum(n);
    return text === '1' ? `${text} ${unit.replace(/s$/, '')}` : `${text} ${unit}`;
}

export function maintenanceText(m) {
    const unit = UNIT_LABELS[m.task.unit];
    if (!m.due) return `${unitCount(m.remaining, unit)} left`;
    return m.remaining === 0 ? 'Due now' : `Overdue by ${unitCount(-m.remaining, unit)}`;
}

export function markMaintenanceDone(id) {
    const task = state.maintenance[id];
    if (!task) return;
    const before = { ...task };
    const stats = printerStats(task.printerId || '');
    task.lastDate = todayLocal();
    task.atHours = stats.minutes / 60;
    task.atPrints = stats.total;
    task.atGrams = stats.grams;
    saveState();
    renderAll();
    notify(`Marked "${task.name}" as done.`, {
        action: {
            label: 'Undo',
            onClick: () => {
                state.maintenance[id] = before;
                saveState();
                renderAll();
            }
        }
    });
}

export function buildMaintenanceRow(m, { withDelete = false } = {}) {
    const row = h('div', m.due ? 'maint-row is-due' : 'maint-row');
    row.dataset.id = m.id;

    const top = h('div', 'maint-top');
    const text = h('div', 'maint-text');
    text.appendChild(h('span', 'list-title', m.task.name));
    text.appendChild(h('span', 'list-sub',
        `${fmtNum(m.used)} of ${fmtNum(m.task.every)} ${UNIT_LABELS[m.task.unit]} \u00B7 ${maintenanceText(m)}`));
    top.appendChild(text);

    const done = h('button', m.due ? 'btn btn-primary btn-small' : 'btn btn-outline btn-small', 'Done');
    done.type = 'button';
    done.title = 'Mark as done today and start counting again';
    done.addEventListener('click', () => markMaintenanceDone(m.id));
    top.appendChild(done);

    if (withDelete) {
        const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => {
            const removed = state.maintenance[m.id];
            delete state.maintenance[m.id];
            saveState();
            renderAll();
            notify(`Removed "${removed.name}".`, {
                action: {
                    label: 'Undo',
                    onClick: () => {
                        state.maintenance[m.id] = removed;
                        saveState();
                        renderAll();
                    }
                }
            });
        });
        top.appendChild(del);
    }
    row.appendChild(top);

    const bar = h('div', 'bar bar-thin');
    const level = m.fraction >= 1 ? 'fail' : m.fraction >= 0.8 ? 'warn' : 'ok';
    const fill = h('div', level === 'ok' ? 'bar-fill' : `bar-fill ${level}`);
    fill.style.width = Math.min(100, Math.round(m.fraction * 100)) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    return row;
}

export function buildPrinterPanel(allStats, id = '') {
    const many = hasManyPrinters();
    const pr = printerCfg(id);
    const stats = many ? calcStats('all', id) : allStats;
    const tasks = maintenanceStatus(allStats, many ? id : null);
    const brand = BRANDS.find((b) => b.key === pr.brand);
    const brandName = brand && brand.key !== 'other' ? brand.label : '';
    const modelName = pr.model && pr.model !== 'Other' ? `${brandName} ${pr.model}`.trim() : brandName;
    const configured = Boolean(modelName || pr.nickname || pr.date || pr.brand) || (many && stats.total > 0);

    const panel = dashPanel(many ? `Printer ${printerIds().indexOf(id) + 1}` : 'Printer');
    panel.id = id === '' ? 'printer-panel' : 'printer-panel-' + id;
    if (id !== '') panel.classList.add('printer-extra');

    if (!configured && tasks.length === 0) {
        panel.appendChild(h('p', 'body-text', 'Tell the app about your printer to track its hours, upkeep and electricity.'));
        const go = h('button', 'btn btn-outline btn-small', 'Set up printer');
        go.type = 'button';
        go.addEventListener('click', () => openSettings('printer'));
        panel.appendChild(go);
        panel.lastChild.classList.add('panel-action');
        return panel;
    }

    const head = h('div', 'printer-head');
    head.appendChild(h('span', 'printer-icon', ''));
    head.firstChild.appendChild(icon('cube'));
    const names = h('div', 'printer-names');
    names.appendChild(h('strong', 'printer-name', pr.nickname || modelName || (id === '' ? 'My printer' : 'Extra printer')));
    const facts = [];
    if (pr.nickname && modelName) facts.push(modelName);
    facts.push(`${pr.nozzle} mm nozzle`);
    names.appendChild(h('span', 'list-sub', facts.join(' \u00B7 ')));
    head.appendChild(names);
    panel.appendChild(head);

    const lines = h('ul', 'fact-list');
    if (pr.date) {
        const d = daysBetween(todayLocal(), pr.date);
        lines.appendChild(h('li', null, d > 0 ? `Arrives in ${plural(d, 'day')} (${formatDate(pr.date)})`
            : d === 0 ? 'Arrives today' : `In service for ${plural(-d, 'day')} (since ${formatDate(pr.date)})`));
    }
    lines.appendChild(h('li', null, `${fmtDuration(stats.minutes) || '0h'} printed across ${plural(stats.total, 'print')}`));
    const price = effectivePrice(pr);
    if (price) {
        lines.appendChild(h('li', null, price.auto ? `About ${fmtMoney(price.value)} (typical store price)` : `Paid ${fmtMoney(price.value)}`));
    }
    if (id === '') {
        const cost = hardwareCost();
        if (cost.ams > 0) lines.appendChild(h('li', null, `AMS: ${fmtMoney(cost.ams)}${cost.amsEstimate ? ' (typical)' : ''} \u00B7 ${many ? 'printers' : 'printer'} and AMS ${fmtMoney(cost.hardware)}`));
        if (cost.hardware > 0 || cost.filament > 0) {
            const total = h('li', 'cost-total', `Total spent on the setup: ${fmtMoney(cost.total)}`);
            total.id = 'printer-total';
            lines.appendChild(total);
        }
    }
    panel.appendChild(lines);

    if (tasks.length > 0) {
        panel.appendChild(h('h4', 'subhead', 'Upkeep'));
        for (const m of tasks.slice(0, 3)) panel.appendChild(buildMaintenanceRow(m));
    }

    const manage = h('button', 'btn btn-ghost btn-small panel-action', tasks.length > 0 ? 'Manage printer and upkeep' : 'Printer settings');
    manage.type = 'button';
    manage.addEventListener('click', () => openSettings('printer'));
    panel.appendChild(manage);
    return panel;
}

/** One panel per printer (just the main one until more are added). */
export function buildPrinterPanels(allStats) {
    return printerIds().map((id) => buildPrinterPanel(allStats, id));
}
