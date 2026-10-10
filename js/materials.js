import { MATERIAL_GUIDE, MATERIAL_SOURCES } from './catalog.js';
import { state } from './state.js';
import { $, h, isObject, makeLink, materialKey } from './util.js';

// ---------- Material guide (reference table on the Filament tab) ----------

/** Rebuilt on every render; the <details> element itself stays, so it keeps its open/closed state. */
export function renderMaterialGuide() {
    const root = $('material-guide');
    let details = root.querySelector('details');
    if (!details) {
        details = h('details', 'panel material-panel');
        details.id = 'material-details';
        root.appendChild(details);
    }
    const summary = h('summary', 'panel-title', 'Material guide');
    details.replaceChildren(summary);

    details.appendChild(h('p', 'secondary-text small',
        'Typical settings and drying advice from Bambu Lab\'s wiki. They are for Bambu filament; other brands differ, so the label on your spool wins. Temperatures are in °C.'));

    const owned = new Set(Object.values(state.spools).filter(isObject).filter((s) => !s.archived).map((s) => materialKey(s)));
    const wrap = h('div', 'table-scroll');
    const table = h('table', 'data-table material-table');
    table.id = 'material-table';
    const head = h('tr');
    for (const text of ['Material', 'Nozzle', 'Bed (PEI plates)', 'Dry in an oven', 'Dry on the heatbed', 'Printer', 'AMS']) {
        const th = h('th', null, text);
        th.scope = 'col';
        head.appendChild(th);
    }
    const thead = h('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    const body = h('tbody');
    for (const m of MATERIAL_GUIDE) {
        const tr = h('tr');
        tr.dataset.material = m.key;
        const name = h('th', 'row-head', m.label);
        name.scope = 'row';
        if (owned.has(m.key)) name.appendChild(h('span', 'chip chip-mini', 'you have it'));
        tr.appendChild(name);
        for (const c of [m.nozzle, m.bed, `${m.oven}${m.dry === 'Required' ? ' (required)' : ''}`, m.heatbed, m.enclosure, m.ams ? 'Yes' : 'No']) tr.appendChild(h('td', null, c));
        body.appendChild(tr);
    }
    table.appendChild(body);
    wrap.appendChild(table);
    details.appendChild(wrap);

    const notes = h('ul', 'fact-list');
    notes.appendChild(h('li', null, 'Heatbed drying only works on enclosed printers (for example P1S and X1). Open printers like the A1, A1 mini and P1P cannot do it.'));
    notes.appendChild(h('li', null, 'Nozzle temperatures have a margin of about ±10 °C. Bed ranges depend on the plate and on glue.'));
    details.appendChild(notes);

    const src = h('p', 'setting-hint');
    src.append('Sources: ');
    MATERIAL_SOURCES.forEach((s, i) => {
        if (i > 0) src.append('; ');
        src.appendChild(makeLink(s.url, s.text));
    });
    details.appendChild(src);
}
