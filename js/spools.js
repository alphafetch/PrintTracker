import { adjustOf, daysOpen, priceHistory, pricePerKg, describeDays, gramsUsedOfSpool, lowFraction, needsDrying, printsUsingSpool, remainingOf, spoolForecast, warnFraction } from './calc.js';
import { restoreSlots, slotsHolding, unloadSpool } from './ams.js';
import { dryingAdvice } from './catalog.js';
import { setupLabelsButton } from './labels.js';
import { emptyState_, makeBadge, plural, renderAll } from './render.js';
import { filterBySpool } from './prints.js';
import { openSpoolPopup } from './spoolPopup.js';
import { openLeftoverPopup } from './leftover.js';
import { openWeighPopup } from './weigh.js';
import { saveState, state } from './state.js';
import { $, fmtGrams, fmtMoney, formatDate, h, icon, isObject, isValidDate, locationOf, makeSwatch, materialKey, notify, spoolHex, todayLocal } from './util.js';

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
    setupLabelsButton($('fila-actions'));

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
    const remaining = remainingOf(id, s);
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
        b.title = ['Open for a while without being dried.', dryingAdvice(materialKey(s))].filter(Boolean).join(' ');
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

    const earlier = priceHistory(s, id);
    if (earlier.length > 0 && !s.archived) {
        const last = earlier[0];
        const now = pricePerKg(s);
        let text = `Last time: ${fmtMoney(last.perKg)}/kg${last.date ? ` (${formatDate(last.date)})` : ''}`;
        if (now !== null) {
            const pct = Math.round(((now - last.perKg) / last.perKg) * 100);
            text += Math.abs(pct) < 1 ? '. Same price per kg.' : `. This spool is ${fmtMoney(now)}/kg, ${pct > 0 ? `${pct}% more` : `${-pct}% less`}.`;
        }
        card.appendChild(h('div', 'card-meta card-meta-soft price-history-line', text));
    }

    const where = locationOf(s);
    const weighed = isValidDate(s.weighedDate) ? `Weighed ${formatDate(s.weighedDate)}` : '';
    if (where || weighed) {
        card.appendChild(h('div', 'card-meta card-meta-soft where-line',
            [where ? `Stored: ${where}` : '', weighed].filter(Boolean).join(' · ')));
    }

    const forecast = spoolForecast(id, s);
    if (forecast) {
        const pace = `${fmtGrams(forecast.perWeek)}g a week`;
        const line = forecast.daysLeft > 365
            ? `At your pace (${pace}) this spool will last over a year.`
            : `At your pace (${pace}) it runs out in ${describeDays(forecast.daysLeft)}, around ${formatDate(forecast.date)}.`;
        card.appendChild(h('div', 'card-meta card-meta-soft forecast-line', line));
    }

    if (!s.archived) {
        const days = daysOpen(id, s);
        const dried = isValidDate(s.driedDate);
        if (dried || days !== null) {
            card.appendChild(h('div', 'card-meta card-meta-soft dry-line',
                (dried ? `Dried ${formatDate(s.driedDate)} (${plural(days, 'day')} ago)` : `Open for ${plural(days, 'day')}, never dried`) +
                (needsDrying(id, s) && dryingAdvice(materialKey(s)) ? `. ${dryingAdvice(materialKey(s))}` : '')));
        }
    }

    const buttons = h('div', 'card-actions');

    const archive = h('button', 'btn btn-outline btn-small', s.archived ? 'Unarchive' : 'Archive');
    archive.type = 'button';
    archive.addEventListener('click', () => {
        if (!s.archived && remainingOf(id, s) >= 1) openLeftoverPopup(id);
        else archiveSpool(id);
    });
    buttons.appendChild(archive);

    if (!s.archived) {
        const dry = h('button', 'btn btn-outline btn-small', 'Dried today');
        dry.type = 'button';
        dry.title = 'Log that you dried this spool today';
        dry.addEventListener('click', () => markDried(id));
        buttons.appendChild(dry);
    }

    if (uses > 0) {
        const shown = h('button', 'btn btn-outline btn-small', 'Show prints');
        shown.type = 'button';
        shown.title = 'See the prints that used this spool';
        shown.addEventListener('click', () => filterBySpool(id));
        buttons.appendChild(shown);
    }

    if (!s.archived) {
        const weigh = h('button', 'btn btn-outline btn-small', 'Re-weigh');
        weigh.type = 'button';
        weigh.title = 'Correct the grams left using a scale';
        weigh.addEventListener('click', () => openWeighPopup(id));
        buttons.appendChild(weigh);
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

/** Log that a spool was dried today (with Undo). */
export function markDried(id) {
    const s = state.spools[id];
    if (!s) return;
    const before = s.driedDate;
    s.driedDate = todayLocal();
    saveState();
    renderAll();
    notify(`Logged: ${s.brand}, ${s.color} was dried today.`, {
        action: { label: 'Undo', onClick: () => { s.driedDate = before; saveState(); renderAll(); } }
    });
}

/**
 * Archive or restore a spool. When archiving, `leftover` (grams actually left) may be given;
 * it is remembered and also corrects the spool's grams-left, so restoring it later starts from the real amount.
 */
export function archiveSpool(id, leftover = null) {
    const spool = state.spools[id];
    if (!spool) return;
    const was = Boolean(spool.archived);
    const places = slotsHolding(id);
    const before = { adjust: spool.adjust, leftover: spool.leftover };
    spool.archived = !was;
    if (spool.archived) {
        unloadSpool(id);
        if (Number.isFinite(leftover) && leftover >= 0) {
            spool.adjust = adjustOf(spool) + (leftover - remainingOf(id, spool));
            spool.leftover = Math.round(leftover * 10) / 10;
        }
    } else {
        delete spool.leftover;
    }
    saveState();
    renderAll();
    notify(`${spool.archived ? 'Archived' : 'Restored'} "${spool.brand}, ${spool.color}".`, {
        action: {
            label: 'Undo',
            onClick: () => {
                if (!state.spools[id]) return;
                state.spools[id].archived = was;
                for (const [k, v] of Object.entries(before)) {
                    if (v === undefined) delete state.spools[id][k];
                    else state.spools[id][k] = v;
                }
                if (!was) restoreSlots(id, places);
                saveState();
                renderAll();
            }
        }
    });
}

export function deleteSpool(id) {
    const spool = state.spools[id];
    if (!spool) return;
    const uses = printsUsingSpool(id);
    if (uses > 0) {
        alert(`This spool is used in ${uses} print${uses === 1 ? '' : 's'}. Archive it instead.`);
        return;
    }
    const places = slotsHolding(id);
    delete state.spools[id];
    unloadSpool(id);
    saveState();
    renderAll();
    notify(`Deleted "${spool.brand}, ${spool.color}".`, {
        action: {
            label: 'Undo',
            onClick: () => {
                state.spools[id] = spool;
                restoreSlots(id, places);
                saveState();
                renderAll();
            }
        }
    });
}
