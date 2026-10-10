import { spoolCostGroups } from './calc.js';
import { ANALYSIS_GROUPS } from './constants.js';
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
}
