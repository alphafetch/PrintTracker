import { remainingOf, totalGramsOfPrint, usageOf } from './calc.js';
import { openPrintPopup } from './printPopup.js';
import { plural, renderAll } from './render.js';
import { normalizeState, saveState, setState, state } from './state.js';
import { $, fmtGrams, formatDate, h, isObject, isValidDate, notify, todayLocal } from './util.js';
import { openWeighPopup } from './weigh.js';

// ---------- Data check: look for entries that do not add up, and offer a fix for each ----------

const MAX_SHOWN = 60;
let checked = false;

const spoolName = (s) => `${s.brand}, ${s.color}`;
const printKey = (p) => [p.name, p.date, p.minutes || '', Math.round(totalGramsOfPrint(p) * 100)].map((v) => String(v).trim().toLowerCase()).join('|');

/** Undo support: put back a copy of the data taken before a fix. */
function undoTo(before, label) {
    return {
        label: 'Undo',
        onClick: () => {
            setState(normalizeState(before));
            saveState();
            renderAll();
            notify(`Undid: ${label}.`);
        }
    };
}

function applyFix(label, change) {
    const before = JSON.parse(JSON.stringify(state));
    change();
    saveState();
    renderAll();
    notify(`${label}.`, { action: undoTo(before, label.charAt(0).toLowerCase() + label.slice(1)) });
}

/**
 * Everything that looks wrong right now. Each problem has an id, a kind, a message and one action
 * ({ label, run }). Nothing is changed by looking.
 */
export function findProblems() {
    const problems = [];
    const prints = Object.entries(state.prints).filter(([, p]) => isObject(p));
    const today = todayLocal();

    for (const [id, p] of prints) {
        const name = p.name || 'Untitled print';
        const gone = usageOf(p).filter((u) => !isObject(state.spools[u.spoolId]));
        if (gone.length > 0) {
            const grams = gone.reduce((sum, u) => sum + (Number(u.grams) || 0), 0);
            problems.push({
                id: `missing:${id}`, kind: 'missing-spool',
                text: `"${name}" (${formatDate(p.date)}) used ${plural(gone.length, 'spool')} that no longer exist${gone.length === 1 ? 's' : ''} (${fmtGrams(grams)}g).`,
                action: {
                    label: 'Remove those rows',
                    run: () => applyFix(`Removed ${plural(gone.length, 'missing spool row')} from "${name}"`, () => {
                        state.prints[id].usage = usageOf(p).filter((u) => isObject(state.spools[u.spoolId]));
                    })
                }
            });
        } else if (totalGramsOfPrint(p) <= 0) {
            problems.push({
                id: `empty:${id}`, kind: 'no-filament',
                text: `"${name}" (${formatDate(p.date)}) has no filament logged, so it does not use up any spool.`,
                action: { label: 'Edit', run: () => openPrintPopup({ printId: id }) }
            });
        }
        if (isValidDate(p.date) && p.date > today) {
            problems.push({
                id: `future:${id}`, kind: 'future-date',
                text: `"${name}" is dated ${formatDate(p.date)}, which is in the future.`,
                action: { label: 'Edit', run: () => openPrintPopup({ printId: id }) }
            });
        }
    }

    // identical prints: keep the first of each set
    const seen = new Map();
    for (const [id, p] of prints) {
        const key = printKey(p);
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key).push(id);
    }
    for (const ids of seen.values()) {
        if (ids.length < 2) continue;
        const p = state.prints[ids[0]];
        const extra = ids.slice(1);
        problems.push({
            id: `dup:${ids[0]}`, kind: 'duplicate',
            text: `"${p.name}" (${formatDate(p.date)}, ${fmtGrams(totalGramsOfPrint(p))}g) is logged ${ids.length} times with identical details.`,
            action: {
                label: `Delete ${extra.length === 1 ? 'the extra one' : `${extra.length} extras`}`,
                run: () => applyFix(`Deleted ${plural(extra.length, 'duplicate print')}`, () => { for (const x of extra) delete state.prints[x]; })
            }
        });
    }

    for (const [id, s] of Object.entries(state.spools)) {
        if (!isObject(s)) continue;
        const left = remainingOf(id, s);
        if (left < -1) {
            problems.push({
                id: `over:${id}`, kind: 'over-weight',
                text: `${spoolName(s)} has ${fmtGrams(-left)}g more logged against it than it weighed (${fmtGrams(s.startGrams)}g).`,
                action: { label: 'Re-weigh', run: () => openWeighPopup(id) }
            });
        }
        if (s.archived) {
            const loaded = Object.values(state.ams).filter((u) => u.slots.includes(id)).length;
            if (loaded > 0) {
                problems.push({
                    id: `ams:${id}`, kind: 'archived-loaded',
                    text: `${spoolName(s)} is archived but still shown in an AMS slot.`,
                    action: {
                        label: 'Unload it',
                        run: () => applyFix(`Unloaded ${spoolName(s)}`, () => {
                            for (const u of Object.values(state.ams)) u.slots = u.slots.map((x) => (x === id ? '' : x));
                        })
                    }
                });
            }
        }
    }
    return problems;
}

export function renderDataCheck() {
    const panel = $('data-check-panel');
    if (!panel) return;
    panel.replaceChildren(h('h3', 'panel-title', 'Data check'));
    panel.appendChild(h('p', 'body-text secondary-text small',
        'Looks through your prints and spools for things that do not add up, such as prints that use a deleted spool, spools logged past their weight, or the same print entered twice. Looking changes nothing; each fix asks first and can be undone.'));
    const actions = h('div', 'data-actions');
    const run = h('button', 'btn btn-outline', checked ? 'Check again' : 'Check my data');
    run.type = 'button';
    run.id = 'data-check-button';
    run.addEventListener('click', () => { checked = true; renderDataCheck(); const first = $('data-check-results'); if (first) first.focus(); });
    actions.appendChild(run);
    panel.appendChild(actions);
    if (!checked) return;

    const results = h('div', 'check-results');
    results.id = 'data-check-results';
    results.tabIndex = -1;
    results.setAttribute('role', 'status');
    const problems = findProblems();
    if (problems.length === 0) {
        results.appendChild(h('p', 'body-text check-ok', 'No problems found.'));
    } else {
        results.appendChild(h('p', 'body-text', `${plural(problems.length, 'thing')} to look at:`));
        for (const pr of problems.slice(0, MAX_SHOWN)) {
            const row = h('div', 'list-row check-row');
            row.dataset.kind = pr.kind;
            row.appendChild(h('span', 'list-main check-text', pr.text));
            const btn = h('button', 'btn btn-outline btn-small', pr.action.label);
            btn.type = 'button';
            btn.addEventListener('click', pr.action.run);
            row.appendChild(btn);
            results.appendChild(row);
        }
        if (problems.length > MAX_SHOWN) results.appendChild(h('p', 'secondary-text small', `Showing the first ${MAX_SHOWN}. Fix some and check again.`));
    }
    panel.appendChild(results);
}
