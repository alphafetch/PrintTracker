import { failureGroups, hasManyPrinters, leftoverSpools, MIN_FAILURE_SAMPLE, spoolCostGroups } from './calc.js';
import { ANALYSIS_GROUPS } from './constants.js';
import { archiveSpool } from './spools.js';
import { saveState, state } from './state.js';
import { $, fmtGrams, fmtMoney, h, isObject } from './util.js';

// ---------- Filament cost analysis ----------

/** Shown under the spool list. Needs at least one spool. */
export function renderAnalysis() {
    const root = $('spool-analysis');
    root.replaceChildren();
    if (!Object.values(state.spools).some(isObject)) return;

    const panel = h('div', 'panel analysis-panel');
    panel.appendChild(h('h3', 'panel-title', 'Cost analysis'));
    panel.appendChild(h('p', 'secondary-text small',
        'What each kind of filament really costs once failed prints are counted. "True cost per kg" is the price per kg divided by the share of filament that went into prints that worked.'));

    const bar = h('div', 'range-bar');
    const label = h('label', null, 'Group by');
    label.htmlFor = 'analysis-group';
    const select = h('select', 'dropdown');
    select.id = 'analysis-group';
    for (const [key, text] of ANALYSIS_GROUPS) {
        const o = h('option', 'option-input', text);
        o.value = key;
        o.selected = key === state.ui.analysisGroup;
        select.appendChild(o);
    }
    select.addEventListener('change', () => {
        state.ui.analysisGroup = select.value;
        saveState();
        renderAnalysis();
    });
    bar.append(label, select);
    panel.appendChild(bar);

    const rows = spoolCostGroups(state.ui.analysisGroup);
    const wrap = h('div', 'table-scroll');
    const table = h('table', 'data-table');
    table.id = 'analysis-table';
    const head = h('tr');
    for (const [text, hint] of [['Group'], ['Spools'], ['Spent'], ['Per kg'], ['Used'], ['Failed'], ['True cost per kg', 'Price per kg divided by the share of filament used in good prints']]) {
        const th = h('th', null, text);
        th.scope = 'col';
        if (hint) th.title = hint;
        head.appendChild(th);
    }
    const thead = h('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    const body = h('tbody');
    for (const g of rows) {
        const tr = h('tr');
        tr.dataset.key = g.key;
        const name = h('th', 'row-head', g.label);
        name.scope = 'row';
        tr.appendChild(name);
        const cells = [
            String(g.spools),
            g.pricedGrams > 0 ? fmtMoney(g.spent) : '-',
            g.perKg !== null ? fmtMoney(g.perKg) : '-',
            g.used > 0 ? `${fmtGrams(g.used)}g` : '-',
            g.wastePct !== null ? `${fmtGrams(g.failed)}g (${Math.round(g.wastePct * 100)}%)` : '-',
            g.trueKg !== null ? fmtMoney(g.trueKg) : '-'
        ];
        for (const c of cells) tr.appendChild(h('td', null, c));
        body.appendChild(tr);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    panel.appendChild(wrap);

    const ranked = rows.filter((g) => g.trueKg !== null);
    if (ranked.length >= 2) {
        const sorted = [...ranked].sort((a, b) => a.trueKg - b.trueKg);
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];
        const note = h('p', 'panel-total-line', `Cheapest per useful kg: ${best.label} at ${fmtMoney(best.trueKg)}. Most expensive: ${worst.label} at ${fmtMoney(worst.trueKg)}.`);
        note.id = 'analysis-summary';
        panel.appendChild(note);
    }
    panel.appendChild(h('p', 'secondary-text small', 'Failure shares from only a few prints are rough. Archived and used-up spools count too.'));
    root.appendChild(panel);
    root.appendChild(buildFailureRatePanel());
    root.appendChild(buildLeftoverPanel());
}

/** Filament still on archived spools, with its value. Hidden when nothing was recorded. */
export function buildLeftoverPanel() {
    const panel = h('div', 'panel leftover-panel');
    panel.id = 'leftover-panel';
    const list = leftoverSpools();
    panel.hidden = list.length === 0;
    if (list.length === 0) return panel;
    panel.appendChild(h('h3', 'panel-title', 'Leftover filament'));
    const grams = list.reduce((sum, l) => sum + l.grams, 0);
    const value = list.reduce((sum, l) => sum + (l.value || 0), 0);
    const total = h('p', 'panel-total-line', `${list.length} archived spool${list.length === 1 ? '' : 's'} with ${fmtGrams(grams)}g left${value > 0 ? `, worth about ${fmtMoney(value)}` : ''}.`);
    total.id = 'leftover-total';
    panel.appendChild(total);
    const rows = h('div', 'list-rows');
    for (const l of list) {
        const row = h('div', 'list-row');
        row.dataset.id = l.id;
        const text = h('div', 'list-text');
        text.appendChild(h('span', 'list-title', `${l.spool.brand}, ${l.spool.color}`));
        text.appendChild(h('span', 'list-sub', `${String(l.spool.material || 'other').toUpperCase()} \u00B7 ${fmtGrams(l.grams)}g left${l.value !== null ? ` \u00B7 about ${fmtMoney(l.value)}` : ''}`));
        row.appendChild(text);
        const use = h('button', 'btn btn-outline btn-small', 'Use again');
        use.type = 'button';
        use.title = 'Restore this spool so you can use the rest';
        use.addEventListener('click', () => archiveSpool(l.id));
        row.appendChild(use);
        rows.appendChild(row);
    }
    panel.appendChild(rows);
    return panel;
}

let failureBy = 'brand';

/** "How often do prints fail?" by brand, material, spool or printer. Hidden until some print has failed. */
export function buildFailureRatePanel() {
    const panel = h('div', 'panel failure-rate-panel');
    panel.id = 'failure-rate-panel';
    const anyFailed = Object.values(state.prints).some((p) => isObject(p) && !p.result);
    panel.hidden = !anyFailed;
    if (!anyFailed) return panel;
    panel.appendChild(h('h3', 'panel-title', 'Failure rate'));
    panel.appendChild(h('p', 'secondary-text small', `Which filament or printer your failed prints belong to. A print that used two spools counts under both. Groups under ${MIN_FAILURE_SAMPLE} prints are too small to compare.`));

    const options = [['brand', 'Brand'], ['material', 'Material'], ['spool', 'Spool'], ...(hasManyPrinters() ? [['printer', 'Printer']] : [])];
    if (!options.some(([k]) => k === failureBy)) failureBy = 'brand';
    const bar = h('div', 'range-bar');
    const label = h('label', null, 'Group by');
    label.htmlFor = 'failure-group';
    const select = h('select', 'dropdown');
    select.id = 'failure-group';
    for (const [key, text] of options) {
        const o = h('option', 'option-input', text);
        o.value = key;
        o.selected = key === failureBy;
        select.appendChild(o);
    }
    select.addEventListener('change', () => {
        failureBy = select.value;
        const fresh = buildFailureRatePanel();
        panel.replaceWith(fresh);
        const next = document.getElementById('failure-group');
        if (next) next.focus();
    });
    bar.append(label, select);
    panel.appendChild(bar);

    const rows = failureGroups(failureBy);
    const wrap = h('div', 'table-scroll');
    const table = h('table', 'data-table');
    table.id = 'failure-table';
    const head = h('tr');
    for (const text of ['Group', 'Prints', 'Failed', 'Failure rate']) {
        const th = h('th', text === 'Group' ? null : 'num', text);
        th.scope = 'col';
        head.appendChild(th);
    }
    table.appendChild(h('thead')).appendChild(head);
    const body = h('tbody');
    for (const g of rows) {
        const tr = h('tr');
        tr.dataset.key = g.key;
        const name = h('th', 'row-head', g.label);
        name.scope = 'row';
        tr.appendChild(name);
        tr.appendChild(h('td', 'num', String(g.prints)));
        tr.appendChild(h('td', 'num', String(g.failed)));
        tr.appendChild(h('td', 'num', `${Math.round(g.rate * 100)}%${g.prints < MIN_FAILURE_SAMPLE ? ' (few prints)' : ''}`));
        body.appendChild(tr);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    panel.appendChild(wrap);

    const comparable = rows.filter((g) => g.prints >= MIN_FAILURE_SAMPLE);
    const note = h('p', 'panel-total-line');
    note.id = 'failure-summary';
    if (comparable.length >= 2 && comparable[0].rate > comparable[comparable.length - 1].rate) {
        const worst = comparable[0];
        const best = comparable[comparable.length - 1];
        note.textContent = `Highest failure rate: ${worst.label} (${worst.failed} of ${worst.prints}, ${Math.round(worst.rate * 100)}%). Lowest: ${best.label} (${best.failed} of ${best.prints}, ${Math.round(best.rate * 100)}%).`;
    } else {
        note.textContent = `Not enough prints yet to compare: you need ${MIN_FAILURE_SAMPLE} or more prints in at least two groups.`;
    }
    panel.appendChild(note);
    return panel;
}
