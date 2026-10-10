import { daysOpen, gramsUsedOfSpool, lowFraction, needsDrying, printsUsingSpool, remainingOf, warnFraction } from './calc.js';
import { unloadSpool } from './ams.js';
import { emptyState_, makeBadge, plural, renderAll } from './render.js';
import { openSpoolPopup } from './spoolPopup.js';
import { saveState, state } from './state.js';
import { $, fmtGrams, fmtMoney, formatDate, h, icon, isObject, isValidDate, makeSwatch, materialKey, notify, spoolHex, todayLocal } from './util.js';

// ---------- Rendering: spools ----------

export const spoolList = $('spools');
export const archiveOffBox = $('archive-off-checkbox');
export const materialFilter = $('spool-material-filter');

export function setupSpoolToolbar() {
    const plus = h('button', 'acc-buttons btn btn-primary');
    plus.type = 'button';
    plus.setAttribute('aria-label', 'Add a spool');
    plus.appendChild(icon('plus'));
    plus.appendChild(h('span', 'btn-text', 'Add spool'));
    plus.addEventListener('click', () => openSpoolPopup());
    $('fila-actions').appendChild(plus);

    archiveOffBox.addEventListener('change', () => {
        state.hideArchived = archiveOffBox.checked;
        saveState();
        renderSpools();
    });
    materialFilter.addEventListener('change', renderSpools);
}

export function renderSpools() {
    spoolList.replaceChildren();
    archiveOffBox.checked = state.hideArchived;

    const all = Object.entries(state.spools).filter(([, s]) => isObject(s));
    $('fila-toolbar').hidden = all.length === 0;

    const active = all.filter(([, s]) => !s.archived);
    const left = active.reduce((sum, [id, s]) => sum + Math.max(0, remainingOf(id, s)), 0);
    $('fila-sub').textContent = all.length === 0
        ? 'Your spools and how much is left on each.'
        : `${plural(active.length, 'active spool')} · ~${fmtGrams(left)}g left in total`;

    if (all.length === 0) {
        spoolList.appendChild(emptyState_('No spools yet! Click the + to add a spool!',
            'Add each spool you buy. Prints subtract from it automatically.'));
        return;
    }

    const visible = all.filter(([, s]) => {
        if (s.archived && state.hideArchived) return false;
        return materialFilter.value === 'all' || materialKey(s) === materialFilter.value;
    });
    if (visible.length === 0) {
        const allArchivedHidden = state.hideArchived && all.every(([, s]) => s.archived);
        spoolList.appendChild(allArchivedHidden
            ? emptyState_("All spools are archived. Uncheck 'Hide archived' to see them, or click the + to add a new spool.")
            : emptyState_('No spools match this filter.', 'Pick another material or show archived spools.'));
        return;
    }

    // Active spools first (newest first), archived last
    visible.sort((a, b) => {
        const arch = Number(Boolean(a[1].archived)) - Number(Boolean(b[1].archived));
        return arch !== 0 ? arch : String(b[1].date || '').localeCompare(String(a[1].date || ''));
    });
    for (const [id, spool] of visible) spoolList.appendChild(buildSpoolCard(id, spool));
}

export function buildSpoolCard(id, s) {
    const card = h('article', s.archived ? 'row-card spool-card is-archived' : 'row-card spool-card');
    card.dataset.id = id;

    const start = Number(s.startGrams) || 0;
    const used = gramsUsedOfSpool(id);
    const remaining = start - used;
    const fraction = start > 0 ? remaining / start : 0;
    const pct = Math.max(0, Math.round(fraction * 100));
    const level = fraction > warnFraction() ? 'ok' : fraction > lowFraction() ? 'warn' : 'fail';

    const top = h('div', 'spool-top');
    top.appendChild(makeSwatch(spoolHex(s), 'swatch swatch-large'));
    const heading = h('div', 'spool-heading');
    const title = h('h2', 'card-title', `${s.brand}, ${s.color}`);
    heading.appendChild(title);
    const badges = h('div', 'badge-row');
    badges.appendChild(makeBadge(String(s.material || 'other').toUpperCase()));
    if (s.archived) badges.appendChild(makeBadge('Archived', 'purple'));
    if (!s.archived && fraction <= lowFraction()) {
        badges.appendChild(makeBadge(remaining <= 0 ? 'Empty!' : 'Filament Low!', 'red'));
    }
    if (needsDrying(id, s)) {
        const b = makeBadge('Needs drying?', 'amber');
        b.title = 'Open for a while without being dried. Plastics like PETG, nylon and TPU soak up moisture.';
        badges.appendChild(b);
    }
    heading.appendChild(badges);
    top.appendChild(heading);
    card.appendChild(top);

    const line = h('p', 'spool-line');
    line.textContent = remaining >= 0
        ? `~${fmtGrams(remaining)}g remaining of ${fmtGrams(start)}g `
        : `Over by ~${fmtGrams(-remaining)}g (${fmtGrams(used)}g logged of ${fmtGrams(start)}g) `;
    line.appendChild(h('span', `pct pct-${level}`, `(~${pct}% remaining)`));
    card.appendChild(line);

    const bar = h('div', 'bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.min(100, pct)));
    bar.setAttribute('aria-label', 'Filament remaining');
    const fill = h('div', level === 'ok' ? 'bar-fill' : level === 'warn' ? 'bar-fill warn' : 'bar-fill fail');
    fill.style.width = Math.min(100, pct) + '%';
    bar.appendChild(fill);
    card.appendChild(bar);

    const hasPrice = Number.isFinite(s.price);
    const perGram = hasPrice && start > 0 ? s.price / start : null;
    card.appendChild(h('div', 'card-meta',
        [
            hasPrice ? fmtMoney(s.price) : 'No price',
            formatDate(s.date),
            perGram ? `~${fmtMoney(perGram, 3)}/g` : '-'
        ].join(' | ')));

    const uses = printsUsingSpool(id);
    card.appendChild(h('div', 'card-meta card-meta-soft',
        uses === 0 ? 'Not used yet' : `Used in ${plural(uses, 'print')} · ${fmtGrams(used)}g logged`));

    if (!s.archived) {
        const days = daysOpen(id, s);
        const dried = isValidDate(s.driedDate);
        if (dried || days !== null) {
            card.appendChild(h('div', 'card-meta card-meta-soft dry-line',
                dried ? `Dried ${formatDate(s.driedDate)} (${plural(days, 'day')} ago)` : `Open for ${plural(days, 'day')}, never dried`));
        }
    }

    const buttons = h('div', 'card-actions');

    const archive = h('button', 'btn btn-outline btn-small', s.archived ? 'Unarchive' : 'Archive');
    archive.type = 'button';
    archive.addEventListener('click', () => archiveSpool(id));
    buttons.appendChild(archive);

    if (!s.archived) {
        const dry = h('button', 'btn btn-outline btn-small', 'Dried today');
        dry.type = 'button';
        dry.title = 'Log that you dried this spool today';
        dry.addEventListener('click', () => {
            s.driedDate = todayLocal();
            saveState();
            renderAll();
            notify(`Logged: ${s.brand}, ${s.color} was dried today.`);
        });
        buttons.appendChild(dry);
    }

    const edit = h('button', 'btn btn-outline btn-small', 'Edit');
    edit.type = 'button';
    edit.title = 'Change this spool\'s details';
    edit.addEventListener('click', () => openSpoolPopup({ editId: id }));
    buttons.appendChild(edit);

    const again = h('button', 'btn btn-outline btn-small', 'Buy again');
    again.type = 'button';
    again.title = 'Add a new spool with the same details';
    again.addEventListener('click', () => openSpoolPopup({ copyFromId: id }));
    buttons.appendChild(again);

    const del = h('button', 'btn btn-danger-ghost btn-small', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deleteSpool(id));
    buttons.appendChild(del);

    card.appendChild(buttons);
    return card;
}

export function archiveSpool(id) {
    const spool = state.spools[id];
    if (!spool) return;
    spool.archived = !spool.archived;
    if (spool.archived) unloadSpool(id);
    saveState();
    renderAll();
}

export function deleteSpool(id) {
    const spool = state.spools[id];
    if (!spool) return;
    const uses = printsUsingSpool(id);
    if (uses > 0) {
        alert(`This spool is used in ${uses} print${uses === 1 ? '' : 's'}. Archive it instead.`);
        return;
    }
    if (!confirm(`Delete this spool?: "${spool.brand}, ${spool.color}" This cannot be undone.`)) return;
    delete state.spools[id];
    unloadSpool(id);
    saveState();
    renderAll();
}
