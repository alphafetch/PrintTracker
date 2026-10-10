import { activeSpools, remainingOf } from './calc.js';
import { $, colorDistance, h, makeSwatch, materialKey, spoolHex } from './util.js';

// ---------- Colour matching ----------

/** Delta E under this looks like "the same colour" to most people; under SIMILAR it is "close". */
export const NEAR_SAME = 6;
export const SIMILAR = 12;

/** In-stock spools whose colour is close to `hex`, closest first. */
export function similarSpools(hex, { excludeId = null, material = null, limit = 3, within = SIMILAR } = {}) {
    const found = [];
    for (const [id, spool] of activeSpools()) {
        if (id === excludeId || remainingOf(id, spool) <= 0) continue;
        if (material && materialKey(spool) !== material) continue;
        const distance = colorDistance(hex, spoolHex(spool));
        if (distance <= within) found.push({ id, spool, distance });
    }
    return found.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

/** Pairs of in-stock spools of the same material whose colours are close. */
export function similarPairs(within = SIMILAR) {
    const stock = activeSpools().filter(([id, s]) => remainingOf(id, s) > 0);
    const pairs = [];
    for (let i = 0; i < stock.length; i++) {
        for (let j = i + 1; j < stock.length; j++) {
            const [, a] = stock[i];
            const [, b] = stock[j];
            if (materialKey(a) !== materialKey(b)) continue;
            const distance = colorDistance(spoolHex(a), spoolHex(b));
            if (distance <= within) pairs.push({ a: stock[i], b: stock[j], distance });
        }
    }
    return pairs.sort((x, y) => x.distance - y.distance);
}

const label = (s) => `${s.brand} ${s.color}`;

/** The hint under the colour field in the spool popup. */
export function similarHintText(hex, material, excludeId) {
    const found = similarSpools(hex, { excludeId, material, limit: 2 });
    if (found.length === 0) return '';
    const names = found.map((f) => `${label(f.spool)} (${f.distance <= NEAR_SAME ? 'almost identical' : 'similar'})`).join(', ');
    return `You already have a ${String(material).toUpperCase()} in a close colour: ${names}.`;
}

/** Panel on the Filament tab: spools you could be double-buying. */
export function renderTwins() {
    const root = $('color-twins');
    root.replaceChildren();
    const pairs = similarPairs();
    if (pairs.length === 0) return;
    const panel = h('div', 'panel fila-panel');
    panel.id = 'twins-panel';
    panel.appendChild(h('h3', 'panel-title', 'Similar colours in stock'));
    panel.appendChild(h('p', 'secondary-text small',
        'These spools are the same material and close in colour. Use up one before you buy another.'));
    const list = h('div', 'twin-list');
    for (const { a, b, distance } of pairs.slice(0, 8)) {
        const row = h('div', 'twin-row');
        row.appendChild(makeSwatch(spoolHex(a[1])));
        row.appendChild(makeSwatch(spoolHex(b[1])));
        const text = h('div', 'twin-text');
        text.appendChild(h('span', 'list-title', `${label(a[1])} and ${label(b[1])}`));
        text.appendChild(h('span', 'list-sub', `${String(a[1].material || 'other').toUpperCase()} \u00B7 ${distance <= NEAR_SAME ? 'almost identical' : 'similar'}`));
        row.appendChild(text);
        list.appendChild(row);
    }
    panel.appendChild(list);
    root.appendChild(panel);
}

