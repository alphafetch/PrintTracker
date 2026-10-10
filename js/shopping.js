import { describeDays, shoppingList } from './calc.js';
import { openSpoolPopup } from './spoolPopup.js';
import { makeBadge, plural } from './render.js';
import { $, copyText, fmtGrams, fmtMoney, formatDate, h, isObject, makeSwatch, notify, spoolHex } from './util.js';
import { state } from './state.js';

// ---------- Shopping list (Filament tab) ----------

const KIND = {
    low: ['Running low', 'red'],
    soon: ['Runs out soon', 'amber'],
    favorite: ['Used a lot', 'purple']
};

function fullName(spool) {
    return `${spool.brand} ${String(spool.material || 'other').toUpperCase()}, ${spool.color}`;
}

/** Why an item is on the list, in one short sentence. */
export function reasonOf(item) {
    const bits = [];
    if (item.kind === 'favorite') {
        bits.push(`used in ${plural(item.prints, 'print')} in the last 90 days, none left in stock`);
    } else {
        bits.push(item.left <= 0 ? 'empty' : `~${fmtGrams(item.left)}g left`);
        if (item.forecast && item.forecast.daysLeft <= 365) bits.push(`runs out in ${describeDays(item.forecast.daysLeft)} at your pace`);
        if (item.reorder) bits.push(`no other ${String(item.spool.material || 'other').toUpperCase()} in stock`);
    }
    return bits.join(', ');
}

/** The list as plain text, ready to paste into a note or message. */
export function shoppingText(items) {
    const lines = ['Filament shopping list'];
    for (const item of items) {
        const s = item.spool;
        const grams = Number(s.startGrams) > 0 ? ` (${fmtGrams(Number(s.startGrams))}g)` : '';
        const price = Number.isFinite(s.price) ? `, last paid ${fmtMoney(s.price)}` : '';
        lines.push(`- ${fullName(s)}${grams}${price} \u2014 ${reasonOf(item)}`);
    }
    return lines.join('\n');
}

export function renderShopping() {
    const root = $('shopping');
    root.replaceChildren();
    if (!Object.values(state.spools).some(isObject)) return;

    const items = shoppingList();
    const panel = h('div', 'panel fila-panel');
    panel.id = 'shopping-panel';
    panel.appendChild(h('h3', 'panel-title', 'Shopping list'));
    panel.appendChild(h('p', 'secondary-text small',
        'Spools that are low or will run out within 3 weeks at your recent pace, plus colours you keep using that you have none of.'));

    if (items.length === 0) {
        const none = h('p', 'secondary-text', 'Nothing to buy right now.');
        none.id = 'shopping-empty';
        panel.appendChild(none);
        root.appendChild(panel);
        return;
    }

    const list = h('div', 'shopping-list');
    for (const item of items) {
        const row = h('div', 'shopping-row');
        row.dataset.id = item.id;
        row.dataset.kind = item.kind;
        row.appendChild(makeSwatch(spoolHex(item.spool)));
        const text = h('div', 'shopping-text');
        text.appendChild(h('span', 'list-title', fullName(item.spool)));
        const sub = [reasonOf(item)];
        if (Number.isFinite(item.spool.price)) sub.push(`last paid ${fmtMoney(item.spool.price)}`);
        if (item.spool.date) sub.push(`bought ${formatDate(item.spool.date)}`);
        text.appendChild(h('span', 'list-sub', sub.join(' \u00B7 ')));
        row.appendChild(text);
        const [label, kind] = KIND[item.kind];
        row.appendChild(makeBadge(label, kind));
        const buy = h('button', 'btn btn-outline btn-small', 'Buy again');
        buy.type = 'button';
        buy.title = 'Add a new spool like this one';
        buy.addEventListener('click', () => openSpoolPopup({ copyFromId: item.id }));
        row.appendChild(buy);
        list.appendChild(row);
    }
    panel.appendChild(list);

    const actions = h('div', 'data-actions');
    const copy = h('button', 'btn btn-primary btn-small', 'Copy list');
    copy.type = 'button';
    copy.id = 'shopping-copy';
    copy.addEventListener('click', async () => {
        const ok = await copyText(shoppingText(items));
        notify(ok ? `Copied ${plural(items.length, 'item')} to the clipboard.` : 'Could not copy. Select the list and copy it by hand.', !ok);
    });
    actions.appendChild(copy);
    panel.appendChild(actions);
    root.appendChild(panel);
}
