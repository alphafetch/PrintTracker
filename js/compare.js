import { totalGramsOfPrint } from './calc.js';
import { MAX_IMPORT_BYTES } from './constants.js';
import { readFileText, setDataMessage, validateImport } from './data.js';
import { poolOf, printKey, queueKey, spoolKey, takeMatch } from './merge.js';
import { state } from './state.js';
import { $, fmtGrams, fmtMoney, formatDate, h } from './util.js';

// ---------- Compare a backup file with what is here (changes nothing) ----------

const MAX_LISTED = 12;

const yes = (v) => (v ? 'yes' : 'no');
const FIELDS = {
    prints: [
        ['name', 'name', (p) => p.name], ['date', 'date', (p) => formatDate(p.date)], ['result', 'result', (p) => (p.result ? 'success' : 'failure')],
        ['time', 'print time', (p) => (p.minutes ? `${p.minutes} min` : 'none')], ['grams', 'filament', (p) => `${fmtGrams(totalGramsOfPrint(p))}g`],
        ['notes', 'notes', (p) => (p.notes ? 'has notes' : 'none')], ['tags', 'tags', (p) => (Array.isArray(p.tags) && p.tags.length ? p.tags.join(', ') : 'none')]
    ],
    spools: [
        ['brand', 'brand', (s) => s.brand], ['material', 'material', (s) => s.material], ['color', 'colour', (s) => s.color],
        ['startGrams', 'weight', (s) => `${s.startGrams}g`], ['price', 'price', (s) => (Number.isFinite(s.price) ? fmtMoney(s.price) : 'none')],
        ['date', 'date bought', (s) => (s.date ? formatDate(s.date) : 'none')], ['location', 'location', (s) => s.location || 'none'],
        ['archived', 'archived', (s) => yes(s.archived)]
    ],
    queue: [['name', 'name', (q) => q.name], ['link', 'link', (q) => q.link || 'none'], ['done', 'done', (q) => yes(q.done)]]
};
// Stricter than Merge's keys: a print whose result or notes changed, or a spool that was archived or moved, counts as changed.
const KEYS = {
    prints: (p) => [printKey(p), p.result, String(p.notes || '').trim(), (p.tags || []).join(',').toLowerCase()].join('|'),
    spools: (s) => [spoolKey(s), String(s.location || '').trim().toLowerCase(), Boolean(s.archived)].join('|'),
    queue: (q) => [queueKey(q), Boolean(q.done)].join('|')
};
const LABEL = { prints: (p) => p.name || 'Untitled print', spools: (s) => `${s.brand}, ${s.color}`, queue: (q) => q.name || 'Untitled' };

/** The fields that differ between two versions of the same item, as "field: file value, here value". */
function differences(kind, fileItem, hereItem) {
    const out = [];
    for (const [, label, read] of FIELDS[kind]) {
        const a = read(fileItem), b = read(hereItem);
        if (a !== b) out.push(`${label}: ${a} in the file, ${b} here`);
    }
    return out;
}

/**
 * Compare a validated backup with the current data. Items match when they have the same details
 * (the same rule Merge uses); unmatched items with the same id on both sides count as changed.
 * Returns, for prints, spools and queue: { both, onlyFile: [{id, label}], onlyHere: [...], changed: [{id, label, diffs}] }.
 */
export function compareStates(file, here) {
    const out = {};
    for (const kind of ['prints', 'spools', 'queue']) {
        const pool = poolOf(here[kind], KEYS[kind]);
        const unmatchedFile = [];
        let both = 0;
        for (const [id, item] of Object.entries(file[kind])) {
            const hit = takeMatch(pool, KEYS[kind](item));
            if (hit) both++; else unmatchedFile.push(id);
        }
        const leftHere = new Set(Array.from(pool.values()).flat());
        const changed = [];
        const onlyFile = [];
        for (const id of unmatchedFile) {
            if (leftHere.has(id)) {
                leftHere.delete(id);
                changed.push({ id, label: LABEL[kind](here[kind][id]), diffs: differences(kind, file[kind][id], here[kind][id]) });
            } else onlyFile.push({ id, label: LABEL[kind](file[kind][id]) });
        }
        const onlyHere = Array.from(leftHere, (id) => ({ id, label: LABEL[kind](here[kind][id]) }));
        out[kind] = { both, onlyFile, onlyHere, changed };
    }
    return out;
}

function listOf(title, items, render) {
    if (items.length === 0) return null;
    const box = h('div', 'compare-list');
    box.appendChild(h('h4', 'compare-title', `${title} (${items.length})`));
    const ul = h('ul', 'compare-items');
    for (const item of items.slice(0, MAX_LISTED)) ul.appendChild(h('li', null, render(item)));
    box.appendChild(ul);
    if (items.length > MAX_LISTED) box.appendChild(h('p', 'secondary-text small', `and ${items.length - MAX_LISTED} more`));
    return box;
}

function show(fileName, result) {
    const panel = $('compare-panel');
    panel.hidden = false;
    panel.replaceChildren(h('h3', 'panel-title', 'Backup comparison'));
    panel.appendChild(h('p', 'body-text secondary-text small', `${fileName} compared with what is in this browser. Nothing was changed. Settings, AMS, upkeep and timers are not compared.`));

    const wrap = h('div', 'table-scroll');
    const table = h('table', 'data-table');
    table.id = 'compare-table';
    const head = h('tr');
    for (const [text, num] of [['', false], ['Same in both', true], ['Only in the file', true], ['Only here', true], ['Changed', true]]) {
        const th = h('th', num ? 'num' : null, text);
        th.scope = 'col';
        head.appendChild(th);
    }
    table.appendChild(h('thead')).appendChild(head);
    const body = h('tbody');
    for (const [kind, name] of [['prints', 'Prints'], ['spools', 'Spools'], ['queue', 'Queue items']]) {
        const r = result[kind];
        const tr = h('tr');
        tr.dataset.kind = kind;
        const th = h('th', 'row-head', name);
        th.scope = 'row';
        tr.append(th, ...[r.both, r.onlyFile.length, r.onlyHere.length, r.changed.length].map((n) => h('td', 'num', String(n))));
        body.appendChild(tr);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    panel.appendChild(wrap);

    const nothing = ['prints', 'spools', 'queue'].every((k) => result[k].onlyFile.length + result[k].onlyHere.length + result[k].changed.length === 0);
    if (nothing) {
        const same = h('p', 'body-text compare-same', 'The file and this browser hold the same prints, spools and queue items.');
        panel.appendChild(same);
    }
    for (const [kind, name] of [['prints', 'prints'], ['spools', 'spools'], ['queue', 'queue items']]) {
        const r = result[kind];
        for (const box of [
            listOf(`Only in the file: ${name}`, r.onlyFile, (i) => i.label),
            listOf(`Only here: ${name}`, r.onlyHere, (i) => i.label),
            listOf(`Changed: ${name}`, r.changed, (i) => `${i.label} \u2014 ${i.diffs.join('; ') || 'details differ'}`)
        ]) if (box) { box.dataset.kind = kind; panel.appendChild(box); }
    }
    if (result.prints.onlyFile.length + result.spools.onlyFile.length + result.queue.onlyFile.length > 0) {
        panel.appendChild(h('p', 'body-text secondary-text small', 'To bring what is only in the file into this browser, use Merge JSON.'));
    }
    const clear = h('button', 'btn btn-outline btn-small', 'Close comparison');
    clear.type = 'button';
    clear.id = 'compare-close';
    clear.addEventListener('click', () => { panel.hidden = true; panel.replaceChildren(); $('compare-button').focus(); });
    panel.appendChild(clear);
}

async function handleCompare() {
    const input = $('compare-file');
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setDataMessage('That file is too large to be a backup.', true);
    let data;
    try { data = JSON.parse(await readFileText(file)); } catch (error) { return setDataMessage('That file could not be read as JSON.', true); }
    const result = validateImport(data);
    if (result.error) return setDataMessage(`Compare failed: ${result.error} Nothing was changed.`, true);
    show(file.name, compareStates(result.state, state));
    setDataMessage(`Compared ${file.name}. Nothing was changed.`);
    $('compare-panel').scrollIntoView && $('compare-panel').scrollIntoView({ block: 'nearest' });
}

$('compare-button').addEventListener('click', () => $('compare-file').click());
$('compare-file').addEventListener('change', handleCompare);
