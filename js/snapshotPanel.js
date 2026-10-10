import { applyState, setDataMessage, validateImport } from './data.js';
import { MAX_SNAPSHOTS } from './constants.js';
import { deleteSnapshot, describeSnapshot, listSnapshots, takeSnapshot } from './snapshots.js';
import { state } from './state.js';
import { $, h, notify } from './util.js';

// ---------- Data tab: local snapshots ----------

export function restoreSnapshot(at) {
    const snap = listSnapshots().find((s) => s.at === at);
    if (!snap) return setDataMessage('That snapshot is gone.', true);
    let parsed;
    try {
        parsed = JSON.parse(snap.data);
    } catch (error) {
        return setDataMessage('That snapshot could not be read.', true);
    }
    const result = validateImport(parsed);
    if (result.error) return setDataMessage(`That snapshot could not be restored: ${result.error}`, true);
    const when = new Date(snap.at).toLocaleString();
    const ok = confirm(`Restore the snapshot from ${when}? Your current data is saved as a new snapshot first, so you can come back.`);
    if (!ok) return setDataMessage('Restore cancelled. Nothing was changed.');
    takeSnapshot('Before restore');
    applyState(result.state);
    notify(`Restored the snapshot from ${when}.`);
    return true;
}

export function renderSnapshots() {
    const root = $('snapshot-panel');
    root.replaceChildren();
    root.appendChild(h('h3', 'panel-title', 'Snapshots in this browser'));
    root.appendChild(h('p', 'body-text secondary-text small',
        `The last ${MAX_SNAPSHOTS} versions of your data are kept here automatically once a day, and before an import or "Delete all data". They live in this browser only, so clearing site data removes them too. Keep exporting a JSON file for a real backup.`));

    const list = listSnapshots();
    const box = h('div', 'snapshot-list');
    box.id = 'snapshot-list';
    if (list.length === 0) box.appendChild(h('p', 'secondary-text small', 'No snapshots yet.'));
    for (const snap of list) {
        const info = describeSnapshot(snap);
        const row = h('div', 'snapshot-row');
        row.dataset.at = snap.at;
        const text = h('span', 'list-main');
        text.appendChild(h('span', 'list-title', new Date(snap.at).toLocaleString()));
        text.appendChild(h('span', 'list-sub', `${snap.reason || 'Snapshot'} \u00B7 ${info.prints} prints, ${info.spools} spools, ${info.queue} queue items`));
        row.appendChild(text);
        const restore = h('button', 'btn btn-outline btn-small', 'Restore');
        restore.type = 'button';
        restore.addEventListener('click', () => restoreSnapshot(snap.at));
        const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => { deleteSnapshot(snap.at); renderSnapshots(); });
        row.append(restore, del);
        box.appendChild(row);
    }
    root.appendChild(box);

    const actions = h('div', 'data-actions');
    const now = h('button', 'btn btn-outline btn-small', 'Take a snapshot now');
    now.type = 'button';
    now.id = 'snapshot-now';
    now.addEventListener('click', () => {
        const made = takeSnapshot('Manual');
        renderSnapshots();
        setDataMessage(made ? 'Snapshot saved.' : 'Nothing new to snapshot (your data is empty or matches the newest snapshot).');
    });
    actions.appendChild(now);
    root.appendChild(actions);
    return Boolean(state);
}
