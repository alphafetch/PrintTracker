import { tagTotals } from './calc.js';
import { Sections } from './constants.js';
import { updateBodyLock } from './printPopup.js';
import { clearSpoolFilter, filterByTag, printFilter, printSearch, printSearchText } from './prints.js';
import { renderAll } from './render.js';
import { saveState, state } from './state.js';
import { showTab } from './tabs.js';
import { $, formatDate, h, icon, isObject, locationOf } from './util.js';

// ---------- Search everything: prints, spools, queue items and tags in one box ----------

export const MAX_PER_GROUP = 6;

let popup = null;
let input = null;
let resultsEl = null;
let returnTo = null;

const words = (query) => query.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (haystack, terms) => terms.every((t) => haystack.includes(t));

/**
 * Everything that matches every word in `query`. Returns { prints, spools, queue, tags }, each a list of
 * { id, title, sub }. Nothing is changed.
 */
export function searchAll(query) {
    const terms = words(query);
    const out = { prints: [], spools: [], queue: [], tags: [] };
    if (terms.length === 0) return out;

    for (const [id, p] of Object.entries(state.prints)) {
        if (isObject(p) && matches(printSearchText(p), terms)) {
            out.prints.push({ id, title: p.name || 'Untitled print', sub: `${formatDate(p.date)} · ${p.result ? 'Success' : 'Failure'}`, date: p.date || '' });
        }
    }
    out.prints.sort((a, b) => b.date.localeCompare(a.date));

    for (const [id, s] of Object.entries(state.spools)) {
        if (!isObject(s)) continue;
        const hay = [s.brand, s.color, s.material, locationOf(s), s.archived ? 'archived' : 'active', s.date, formatDate(s.date)].filter(Boolean).join(' ').toLowerCase();
        if (matches(hay, terms)) {
            out.spools.push({ id, title: `${s.brand}, ${s.color}`, sub: [String(s.material || 'other').toUpperCase(), locationOf(s), s.archived ? 'archived' : ''].filter(Boolean).join(' · ') });
        }
    }

    for (const [id, item] of Object.entries(state.queue)) {
        if (isObject(item) && matches([item.name, item.link].filter(Boolean).join(' ').toLowerCase(), terms)) {
            out.queue.push({ id, title: item.name || 'Untitled', sub: item.done ? 'done' : 'waiting' });
        }
    }

    for (const t of tagTotals()) {
        if (matches(t.tag.toLowerCase(), terms)) out.tags.push({ id: t.key, title: t.tag, sub: `${t.prints} ${t.prints === 1 ? 'print' : 'prints'}` });
    }
    return out;
}

/** Scroll to an element and outline it for a moment so the eye finds it. */
function flash(el) {
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    el.classList.add('found');
    setTimeout(() => el.classList.remove('found'), 2600);
}

function jumpToPrint(id) {
    const p = state.prints[id];
    clearSpoolFilter();
    printFilter.value = 'all';
    filterByTag('all');
    printSearch.value = p ? String(p.name || '') : '';
    showTab(Sections.PRINTS);
    printSearch.dispatchEvent(new Event('input', { bubbles: true }));
    flash(document.querySelector(`#print-list [data-id="${id}"]`));
}

function jumpToSpool(id) {
    const s = state.spools[id];
    if (s && s.archived && state.hideArchived) { state.hideArchived = false; saveState(); }
    for (const sel of [$('spool-material-filter'), $('spool-location-filter')]) sel.value = 'all';
    showTab(Sections.FILA);
    renderAll();
    flash(document.querySelector(`#spools [data-id="${id}"]`));
}

function jumpToQueue(id) {
    showTab(Sections.QUEUE);
    flash(document.querySelector(`#queue-list [data-id="${id}"], .queue-item[data-id="${id}"]`));
}

const GROUPS = [
    ['prints', 'Prints', jumpToPrint],
    ['spools', 'Spools', jumpToSpool],
    ['queue', 'Queue', jumpToQueue],
    ['tags', 'Tags', (key) => { showTab(Sections.PRINTS); filterByTag(key); }]
];

function renderResults() {
    resultsEl.replaceChildren();
    const query = input.value.trim();
    if (query === '') {
        resultsEl.appendChild(h('p', 'secondary-text small', 'Type to search prints, spools, queue items and tags. Every word has to match.'));
        return;
    }
    const found = searchAll(query);
    let total = 0;
    for (const [key, title, jump] of GROUPS) {
        const list = found[key];
        if (list.length === 0) continue;
        total += list.length;
        const section = h('div', 'search-group');
        section.dataset.group = key;
        section.appendChild(h('h4', 'search-group-title', `${title} (${list.length})`));
        for (const item of list.slice(0, MAX_PER_GROUP)) {
            const row = h('button', 'list-row list-button search-result');
            row.type = 'button';
            row.dataset.id = item.id;
            const text = h('span', 'list-main');
            text.appendChild(h('span', 'list-title', item.title));
            if (item.sub) text.appendChild(h('span', 'list-sub', item.sub));
            row.appendChild(text);
            row.addEventListener('click', () => { closeSearchPopup(); jump(item.id); });
            section.appendChild(row);
        }
        if (list.length > MAX_PER_GROUP) {
            const more = h('p', 'secondary-text small search-more', `${list.length - MAX_PER_GROUP} more. Add another word to narrow it down.`);
            section.appendChild(more);
        }
        resultsEl.appendChild(section);
    }
    if (total === 0) resultsEl.appendChild(h('p', 'body-text search-none', `Nothing matches "${query}".`));
}

function buildPopup() {
    popup = h('div', 'popup');
    popup.id = 'search-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-labelledby', 'search-popup-title');
    const content = h('div', 'popup-content search-popup-content');
    const title = h('h3', 'popup-title', 'Search everything');
    title.id = 'search-popup-title';
    content.appendChild(title);
    input = h('input', 'text-input');
    input.type = 'search';
    input.id = 'search-all-input';
    input.placeholder = 'A print, spool, queue item or tag';
    input.setAttribute('aria-label', 'Search prints, spools, queue items and tags');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', renderResults);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const first = resultsEl.querySelector('.search-result');
            if (first) first.click();
        }
    });
    content.appendChild(input);
    resultsEl = h('div', 'search-results');
    resultsEl.id = 'search-results';
    resultsEl.setAttribute('aria-live', 'polite');
    content.appendChild(resultsEl);
    const actions = h('div', 'popup-actions');
    const close = h('button', 'btn btn-outline', 'Close');
    close.type = 'button';
    close.id = 'search-close';
    close.addEventListener('click', closeSearchPopup);
    actions.appendChild(close);
    content.appendChild(actions);
    popup.appendChild(content);
    document.body.appendChild(popup);
    popup.addEventListener('click', (e) => { if (e.target === popup) closeSearchPopup(); });
}

export function openSearchPopup() {
    if (!popup) buildPopup();
    returnTo = document.activeElement;
    input.value = '';
    renderResults();
    popup.style.display = 'block';
    popup.scrollTop = 0;
    updateBodyLock();
    input.focus();
}

export function closeSearchPopup() {
    if (!popup) return;
    const was = popup.style.display === 'block';
    if (popup.contains(document.activeElement)) document.activeElement.blur();
    popup.style.display = 'none';
    updateBodyLock();
    if (was && returnTo && document.contains(returnTo)) returnTo.focus();
    returnTo = null;
}

export function searchPopupOpen() {
    return Boolean(popup) && popup.style.display === 'block';
}

export function searchPopupEl() {
    return popup;
}

export function setupSearch() {
    const button = $('search-button');
    button.replaceChildren(icon('search'));
    button.addEventListener('click', openSearchPopup);
}
