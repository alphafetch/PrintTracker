import { printerName, hasManyPrinters } from './calc.js';
import { openPrintPopup } from './printPopup.js';
import { openStartPopup } from './running.js';
import { emptyState_, renderAll } from './render.js';
import { cleanQueueSpec, saveState, state } from './state.js';
import { $, clearError, fmtDuration, fmtGrams, h, isObject, linkLabel, makeLink, normalizeLink, notify, showError, uid } from './util.js';

// ---------- Queue ----------

export const queueNameInput = $('queue-name-input');
export const queueLinkInput = $('queue-link-input');
export const queueError = $('queue-error');

export function addQueueItem() {
    const name = queueNameInput.value.trim();
    const link = normalizeLink(queueLinkInput.value);
    if (name === '') return showError(queueError, 'Enter what you want to print.');
    if (link === null) return showError(queueError, 'The link must be a valid http:// or https:// address.');

    state.queue[uid()] = { name, link, done: false };
    queueNameInput.value = '';
    queueLinkInput.value = '';
    clearError(queueError);
    saveState();
    renderAll();
    queueNameInput.focus();
    return true;
}

/** "1h 30m, 45g, Bambu Lab Black, 0.20mm Standard": what a queued item will be printed with. */
export function specSummary(spec) {
    const bits = [];
    const dur = fmtDuration(spec.minutes);
    if (dur) bits.push(dur);
    const grams = spec.usage.reduce((sum, u) => sum + u.grams, 0);
    if (grams > 0) bits.push(`${fmtGrams(grams)}g`);
    const spools = spec.usage.map((u) => state.spools[u.spoolId]).filter(isObject).map((s) => `${s.brand}, ${s.color}`);
    if (spools.length > 0) bits.push(spools.join(' + '));
    if (spec.profile && spec.profile.name) bits.push(spec.profile.name);
    if (spec.printerId && hasManyPrinters() && state.settings.printers[spec.printerId]) bits.push(printerName(spec.printerId));
    return bits.join(' \u00B7 ');
}

export function renderQueue() {
    const list = $('queue-list');
    list.replaceChildren();

    const entries = Object.entries(state.queue).filter(([, q]) => isObject(q));
    const doneCount = entries.filter(([, q]) => q.done).length;
    $('queue-clear-done-button').hidden = doneCount === 0;
    $('queue-sub').textContent = entries.length === 0
        ? 'Things you want to print next.'
        : `${entries.length - doneCount} to print · ${doneCount} done`;

    if (entries.length === 0) {
        list.appendChild(emptyState_('Nothing queued. Add something you want to print.',
            'Use "Log print" on an item to turn it into a print when it is done.'));
        return;
    }

    entries.sort((a, b) => Number(Boolean(a[1].done)) - Number(Boolean(b[1].done)));
    for (const [id, item] of entries) {
        const row = h('div', item.done ? 'queue-item done' : 'queue-item');
        row.dataset.id = id;

        const check = h('input', 'check-input');
        check.type = 'checkbox';
        check.checked = Boolean(item.done);
        check.setAttribute('aria-label', 'Mark as done');
        check.addEventListener('change', () => {
            state.queue[id].done = check.checked;
            saveState();
            renderAll();
        });
        row.appendChild(check);

        const name = h('span', 'queue-name');
        name.append(item.name || 'Untitled');
        const safeLink = normalizeLink(item.link);
        if (safeLink) {
            name.append(' ');
            name.appendChild(makeLink(safeLink, `(${linkLabel(safeLink)})`));
        }
        const spec = cleanQueueSpec(item.spec);
        const summary = spec ? specSummary(spec) : '';
        if (summary) {
            const sub = h('span', 'queue-spec', `Same as before: ${summary}`);
            name.append(' ');
            name.appendChild(sub);
        }
        row.appendChild(name);

        if (!item.done) {
            const start = h('button', 'btn btn-outline btn-small', 'Start');
            start.type = 'button';
            start.title = 'Start a timer for this print';
            start.addEventListener('click', () => openStartPopup({ name: item.name, link: item.link || '', queueId: id, spec: item.spec }));
            row.appendChild(start);
            const log = h('button', 'btn btn-outline btn-small', 'Log print');
            log.type = 'button';
            log.addEventListener('click', () => {
                openPrintPopup({ name: item.name, link: item.link || '', queueId: id, spec: item.spec });
            });
            row.appendChild(log);
        }

        const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => {
            const removed = state.queue[id];
            delete state.queue[id];
            saveState();
            renderAll();
            notify(`Removed "${removed.name}" from the queue.`, {
                action: {
                    label: 'Undo',
                    onClick: () => {
                        state.queue[id] = removed;
                        saveState();
                        renderAll();
                    }
                }
            });
        });
        row.appendChild(del);

        list.appendChild(row);
    }
}

$('queue-add-button').addEventListener('click', addQueueItem);
queueNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addQueueItem(); });
queueLinkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addQueueItem(); });
$('queue-clear-done-button').addEventListener('click', () => {
    const doneIds = Object.entries(state.queue).filter(([, q]) => isObject(q) && q.done).map(([id]) => id);
    const removed = Object.fromEntries(doneIds.map((id) => [id, state.queue[id]]));
    doneIds.forEach((id) => { delete state.queue[id]; });
    saveState();
    renderAll();
    notify(`Cleared ${doneIds.length} finished item${doneIds.length === 1 ? '' : 's'}.`, {
        action: { label: 'Undo', onClick: () => { Object.assign(state.queue, removed); saveState(); renderAll(); } }
    });
});
