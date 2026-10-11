import { totalGramsOfPrint } from './calc.js';
import { applyState, readFileText, setDataMessage, validateImport } from './data.js';
import { MAX_IMPORT_BYTES } from './constants.js';
import { renderAll } from './render.js';
import { takeSnapshot } from './snapshots.js';
import { normalizeState, saveState, state } from './state.js';
import { $, notify, uid } from './util.js';

// ---------- Merge import: add what another backup has that this browser does not ----------

const norm = (v) => String(v === undefined || v === null ? '' : v).trim().toLowerCase();
const num = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '');

const spoolKey = (s) => [s.brand, s.material, s.color, s.date, num(s.startGrams), num(s.price)].map(norm).join('|');
const printKey = (p) => [p.name, p.date, p.minutes || '', num(totalGramsOfPrint(p))].map(norm).join('|');
const queueKey = (q) => [q.name, q.link].map(norm).join('|');

/** Take one unused id off the list for this key (so two identical items are not both matched to one). */
function takeMatch(pool, key) {
    const list = pool.get(key);
    return list && list.length > 0 ? list.shift() : null;
}

function poolOf(items, keyOf) {
    const pool = new Map();
    for (const [id, item] of Object.entries(items)) {
        if (!item || typeof item !== 'object') continue;
        const key = keyOf(item);
        if (!pool.has(key)) pool.set(key, []);
        pool.get(key).push(id);
    }
    return pool;
}

/**
 * Work out what merging `incoming` (a validated state) into `current` would add. Changes nothing.
 * Spools that match one you already have (brand, material, colour, date, weight and price) are not
 * copied; their prints use your copy instead. Prints and queue items that match are skipped.
 * Returns { spools, prints, queue, skipped: { spools, prints, queue } } where the first three are new entries.
 */
export function planMerge(incoming, current) {
    const taken = new Set([...Object.keys(current.spools), ...Object.keys(current.prints), ...Object.keys(current.queue)]);
    const freshId = (wanted) => {
        let id = wanted;
        while (taken.has(id)) id = uid();
        taken.add(id);
        return id;
    };

    const plan = { spools: {}, prints: {}, queue: {}, skipped: { spools: 0, prints: 0, queue: 0 } };

    // spools: map each incoming id to the id it will have afterwards
    const spoolPool = poolOf(current.spools, spoolKey);
    const spoolMap = {};
    for (const [id, s] of Object.entries(incoming.spools)) {
        const match = takeMatch(spoolPool, spoolKey(s));
        if (match) {
            spoolMap[id] = match;
            plan.skipped.spools++;
        } else {
            const newId = freshId(id);
            spoolMap[id] = newId;
            plan.spools[newId] = s;
        }
    }

    // prints: compare after remapping spools, so the grams and the spools used line up
    const printPool = poolOf(current.prints, printKey);
    for (const [id, p] of Object.entries(incoming.prints)) {
        if (takeMatch(printPool, printKey(p))) { plan.skipped.prints++; continue; }
        const usage = p.usage.map((u) => ({ spoolId: spoolMap[u.spoolId] || u.spoolId, grams: u.grams }));
        plan.prints[freshId(id)] = { ...p, usage };
    }

    const queuePool = poolOf(current.queue, queueKey);
    for (const [id, q] of Object.entries(incoming.queue)) {
        if (takeMatch(queuePool, queueKey(q))) { plan.skipped.queue++; continue; }
        plan.queue[freshId(id)] = q;
    }
    return plan;
}

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function handleMerge() {
    const input = $('merge-file');
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setDataMessage('That file is too large to be a backup.', true);

    let data;
    try {
        data = JSON.parse(await readFileText(file));
    } catch (error) {
        return setDataMessage('That file could not be read as JSON.', true);
    }
    const result = validateImport(data);
    if (result.error) return setDataMessage(`Merge failed: ${result.error} Nothing was changed.`, true);

    const plan = planMerge(result.state, state);
    const added = { prints: Object.keys(plan.prints).length, spools: Object.keys(plan.spools).length, queue: Object.keys(plan.queue).length };
    const skipped = plan.skipped.prints + plan.skipped.spools + plan.skipped.queue;
    if (added.prints + added.spools + added.queue === 0) {
        return setDataMessage(`Nothing new to add: everything in this backup is already here (${skipped} duplicate${skipped === 1 ? '' : 's'} skipped).`);
    }

    const summary = `${count(added.prints, 'print')}, ${count(added.spools, 'spool')} and ${count(added.queue, 'queue item')}`;
    const skipText = skipped > 0
        ? ` ${count(plan.skipped.prints, 'print')}, ${count(plan.skipped.spools, 'spool')} and ${count(plan.skipped.queue, 'queue item')} you already have will be skipped.`
        : '';
    const ok = confirm(`Add ${summary} from this backup to your data?${skipText} Your current data and settings stay as they are.`);
    if (!ok) return setDataMessage('Merge cancelled. Nothing was changed.');

    const before = JSON.parse(JSON.stringify(state));
    takeSnapshot('Before merge');
    Object.assign(state.spools, plan.spools);
    Object.assign(state.prints, plan.prints);
    Object.assign(state.queue, plan.queue);
    saveState();
    renderAll();

    const refs = result.missingRefs > 0 ? ` ${count(result.missingRefs, 'filament entry')} in the backup pointed to spools it does not contain.` : '';
    setDataMessage(`Added ${summary}.${skipped > 0 ? ` Skipped ${skipped} you already had.` : ''}${refs}`);
    notify(`Merged ${summary}.`, {
        action: {
            label: 'Undo',
            onClick: () => {
                applyState(normalizeState(before));
                setDataMessage('Merge undone.');
            }
        }
    });
}

$('merge-button').addEventListener('click', () => $('merge-file').click());
$('merge-file').addEventListener('change', handleMerge);
