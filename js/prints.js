import { costOfPrint, energyCostOfPrint, hasManyPrinters, printerIdOf, printerName, totalGramsOfPrint, usageOf, wearCostOfPrint } from './calc.js';
import { DEFAULT_SWATCH, failReasonLabel } from './constants.js';
import { openPrintPopup } from './printPopup.js';
import { emptyState_, makeBadge, plural, renderAll } from './render.js';
import { cleanQueueSpec, saveState, state } from './state.js';
import { $, fmtDuration, fmtGrams, fmtMoney, formatDate, h, icon, isObject, makeLink, makeSwatch, normalizeLink, notify, spoolHex, uid } from './util.js';

// ---------- Rendering: prints ----------

export const printList = $('print-list');
export const printSearch = $('print-search');
export const printFilter = $('print-filter');
export const printSort = $('print-sort');

export function setupPrintsToolbar() {
    $('prints-search-icon').replaceChildren(icon('search'));
    const plus = h('button', 'acc-buttons btn btn-primary');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Add a print');
    plus.appendChild(icon('plus'));
    plus.appendChild(h('span', 'btn-text', 'New print'));
    plus.addEventListener('click', () => openPrintPopup());
    $('prints-actions').appendChild(plus);

    printSearch.addEventListener('input', renderPrints);
    printFilter.addEventListener('change', renderPrints);
    printSort.addEventListener('change', renderPrints);
}

export function printSearchText(p) {
    const prof = isObject(p.profile) ? p.profile : {};
    const parts = [p.name, p.notes, p.link, p.date, formatDate(p.date), p.result ? 'success' : 'failure failed',
        failReasonLabel(p.failReason), prof.name, prof.layer, prof.infill, prof.supports];
    if (hasManyPrinters()) parts.push(printerName(printerIdOf(p)));
    for (const u of usageOf(p)) {
        const s = state.spools[u.spoolId];
        if (s) parts.push(s.brand, s.color, s.material);
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
}

export function renderPrints() {
    printList.replaceChildren();

    const all = Object.entries(state.prints).filter(([, p]) => isObject(p));
    $('prints-toolbar').hidden = all.length === 0;

    if (all.length === 0) {
        $('prints-sub').textContent = 'Everything you have printed.';
        printList.appendChild(emptyState_('No prints yet! Click the + to start a new print!',
            'Each print subtracts its filament from the spools you pick.'));
        return;
    }

    const query = printSearch.value.trim().toLowerCase();
    const filter = printFilter.value;
    let entries = all.filter(([, p]) => {
        if (filter === 'success' && !p.result) return false;
        if (filter === 'failure' && p.result) return false;
        return query === '' || printSearchText(p).includes(query);
    });

    const byDate = (a, b) => String(a[1].date || '').localeCompare(String(b[1].date || ''));
    switch (printSort.value) {
        case 'oldest': entries.sort(byDate); break;
        case 'name': entries.sort((a, b) => String(a[1].name || '').localeCompare(String(b[1].name || ''), undefined, { sensitivity: 'base' })); break;
        case 'grams': entries.sort((a, b) => totalGramsOfPrint(b[1]) - totalGramsOfPrint(a[1])); break;
        case 'time': entries.sort((a, b) => (Number(b[1].minutes) || 0) - (Number(a[1].minutes) || 0)); break;
        default: entries.sort((a, b) => byDate(b, a));
    }

    const filtered = entries.length !== all.length;
    $('prints-sub').textContent = filtered
        ? `Showing ${entries.length} of ${plural(all.length, 'print')}`
        : plural(all.length, 'print') + ' logged';

    if (entries.length === 0) {
        printList.appendChild(emptyState_('No prints match your search or filter.', 'Try a different word or reset the filters.'));
        return;
    }
    for (const [id, print] of entries) printList.appendChild(buildPrintCard(id, print));
}

export function buildPrintCard(id, p) {
    const card = h('article', 'row-card print-card');
    card.dataset.id = id;
    card.classList.add(p.result ? 'is-success' : 'is-failure');

    const head = h('div', 'card-head');
    const title = h('h2', 'card-title', p.name || 'Untitled print');
    head.appendChild(title);
    head.appendChild(makeBadge(p.result ? 'Success' : 'Failure', p.result ? 'green' : 'red'));
    card.appendChild(head);

    const reason = p.result ? '' : failReasonLabel(p.failReason);
    if (reason) card.appendChild(h('p', 'card-meta card-meta-soft fail-reason', `Why it failed: ${reason}`));

    const meta = h('div', 'card-meta');
    meta.append(formatDate(p.date));
    const dur = fmtDuration(p.minutes);
    if (dur) {
        const d = h('span', 'meta-item');
        d.appendChild(icon('clock'));
        d.append(dur);
        meta.appendChild(d);
    }
    const energy = energyCostOfPrint(p);
    const wear = wearCostOfPrint(p);
    const filament = costOfPrint(p);
    const cost = filament + energy + wear;
    if (cost > 0) {
        const c = h('span', 'meta-item', `~${fmtMoney(cost)}`);
        const parts = [`Filament ${fmtMoney(filament)}`];
        if (energy > 0) parts.push(`electricity ${fmtMoney(energy)}`);
        if (wear > 0) parts.push(`machine wear ${fmtMoney(wear)}`);
        c.title = parts.length > 1 ? parts.join(' + ') : 'Estimated filament cost';
        meta.appendChild(c);
    }
    if (hasManyPrinters()) {
        const pr = h('span', 'meta-item print-printer');
        pr.appendChild(icon('cube'));
        pr.append(printerName(printerIdOf(p)));
        meta.appendChild(pr);
    }
    const safeLink = normalizeLink(p.link);
    if (safeLink) meta.appendChild(makeLink(safeLink));
    card.appendChild(meta);

    const usage = usageOf(p);
    if (usage.length > 0) {
        const chips = h('div', 'chips');
        for (const u of usage) {
            const spool = state.spools[u.spoolId];
            const name = spool ? `${spool.brand}, ${spool.color}` : 'Deleted spool';
            const chip = h('span', 'chip');
            chip.appendChild(makeSwatch(spool ? spoolHex(spool) : DEFAULT_SWATCH, 'swatch swatch-small'));
            chip.append(`${name}: ${fmtGrams(Number(u.grams) || 0)}g`);
            chips.appendChild(chip);
        }
        card.appendChild(chips);
    }

    const prof = isObject(p.profile) ? p.profile : null;
    if (prof) {
        const chips = h('div', 'chips profile-chips');
        for (const [label, value] of [['Profile', prof.name], ['Layer', prof.layer], ['Infill', prof.infill], ['Supports', prof.supports]]) {
            if (value) chips.appendChild(h('span', 'chip chip-profile', `${label}: ${value}`));
        }
        if (chips.children.length > 0) card.appendChild(chips);
    }

    if (typeof p.notes === 'string' && p.notes.trim() !== '') {
        card.appendChild(h('p', 'card-notes', p.notes.trim()));
    }

    const buttons = h('div', 'card-actions');

    const edit = h('button', 'btn btn-outline btn-small', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => openPrintPopup({ printId: id }));
    buttons.appendChild(edit);

    const again = h('button', 'btn btn-outline btn-small', 'Print again');
    again.type = 'button';
    again.title = 'Log a new print with the same details';
    again.addEventListener('click', () => openPrintPopup({ copyFromId: id }));
    buttons.appendChild(again);

    const queue = h('button', 'btn btn-outline btn-small queue-add', 'Add to queue');
    queue.type = 'button';
    queue.title = 'Put this on your queue with the same filament, print time and profile';
    queue.addEventListener('click', () => addPrintToQueue(id));
    buttons.appendChild(queue);

    const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deletePrint(id));
    buttons.appendChild(del);

    card.appendChild(buttons);
    return card;
}

/** Put a copy of a past print on the queue, keeping its filament, print time, profile, notes and printer. */
export function addPrintToQueue(id) {
    const p = state.prints[id];
    if (!isObject(p)) return;
    const link = normalizeLink(p.link);
    const item = { name: String(p.name || 'Untitled print').slice(0, 80), link: link === null ? '' : link, done: false };
    const spec = cleanQueueSpec({
        minutes: p.minutes, usage: usageOf(p).filter((u) => isObject(state.spools[u.spoolId])),
        profile: p.profile, notes: p.notes, printerId: printerIdOf(p)
    });
    if (spec) item.spec = spec;
    const queueId = uid();
    state.queue[queueId] = item;
    saveState();
    renderAll();
    notify(`Added "${item.name}" to the queue.`, {
        action: { label: 'Undo', onClick: () => { delete state.queue[queueId]; saveState(); renderAll(); } }
    });
}

export function deletePrint(id) {
    const print = state.prints[id];
    if (!print) return;
    delete state.prints[id];
    saveState();
    renderAll();
    notify(`Deleted "${print.name}".`, {
        action: {
            label: 'Undo',
            onClick: () => {
                state.prints[id] = print;
                saveState();
                renderAll();
            }
        }
    });
}
