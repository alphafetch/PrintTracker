import { MAX_SAVED_VIEWS } from './constants.js';
import { clearSpoolFilter, printFilter, printSearch, printSort, printTagFilter, renderPrints } from './prints.js';
import { saveState, state } from './state.js';
import { $, clearError, h, notify, showError } from './util.js';

// ---------- Saved filters on the Prints tab ----------

const DEFAULTS = { search: '', result: 'all', tag: 'all', sort: 'newest' };

/** What the Prints toolbar is set to right now. */
export function currentFilters() {
    return { search: printSearch.value.trim(), result: printFilter.value, tag: printTagFilter.value, sort: printSort.value };
}

const same = (a, b) => a.search.toLowerCase() === b.search.toLowerCase() && a.result === b.result && a.tag === b.tag && a.sort === b.sort;
const isDefault = (f) => same(f, DEFAULTS);

/** Show a saved view: set every control and redraw the list. */
export function applyView(view) {
    clearSpoolFilter();
    printSearch.value = view.search;
    printFilter.value = view.result;
    printTagFilter.value = view.tag;
    if (printTagFilter.value !== view.tag) printTagFilter.value = 'all';   // that tag no longer exists
    printSort.value = view.sort;
    renderPrints();
}

/** Keep the drop-down in step with the saved views, and select the one that matches the toolbar. */
export function renderViews() {
    const select = $('view-select');
    const bar = $('views-bar');
    const hasPrints = Object.keys(state.prints).length > 0;
    bar.hidden = !hasPrints;
    select.replaceChildren();
    const none = h('option', 'option-input', state.ui.savedViews.length === 0 ? 'None saved yet' : 'Choose...');
    none.value = '';
    select.appendChild(none);
    for (const v of state.ui.savedViews) {
        const o = h('option', 'option-input', v.name);
        o.value = v.name;
        select.appendChild(o);
    }
    select.disabled = state.ui.savedViews.length === 0;
    const now = currentFilters();
    const hit = state.ui.savedViews.find((v) => same(v, now));
    select.value = hit ? hit.name : '';
    $('view-delete').hidden = !hit;
}

function saveCurrent() {
    const error = $('view-error');
    clearError(error);
    const name = $('view-name').value.trim().replace(/\s+/g, ' ').slice(0, 30);
    const now = currentFilters();
    if (name === '') return showError(error, 'Give these filters a name.');
    if (isDefault(now)) return showError(error, 'Nothing to save yet: type a search, or pick a result, tag or sort first.');
    const views = state.ui.savedViews;
    const at = views.findIndex((v) => v.name.toLowerCase() === name.toLowerCase());
    if (at === -1 && views.length >= MAX_SAVED_VIEWS) return showError(error, `You can keep ${MAX_SAVED_VIEWS} saved filters. Delete one first.`);
    const view = { name, ...now };
    if (at === -1) views.push(view); else views[at] = view;
    saveState();
    closeForm();
    renderViews();
    notify(at === -1 ? `Saved "${name}".` : `Updated "${name}".`);
    return true;
}

function closeForm() {
    $('view-save-form').hidden = true;
    $('view-save-open').hidden = false;
    $('view-name').value = '';
    clearError($('view-error'));
}

function deleteSelected() {
    const name = $('view-select').value;
    const at = state.ui.savedViews.findIndex((v) => v.name === name);
    if (at === -1) return;
    const [removed] = state.ui.savedViews.splice(at, 1);
    saveState();
    renderViews();
    notify(`Deleted "${removed.name}".`, {
        action: { label: 'Undo', onClick: () => { state.ui.savedViews.splice(at, 0, removed); saveState(); renderViews(); } }
    });
}

export function setupViews() {
    $('view-select').addEventListener('change', () => {
        const view = state.ui.savedViews.find((v) => v.name === $('view-select').value);
        if (view) applyView(view); else renderViews();
    });
    $('view-save-open').addEventListener('click', () => {
        $('view-save-form').hidden = false;
        $('view-save-open').hidden = true;
        $('view-name').focus();
    });
    $('view-save').addEventListener('click', saveCurrent);
    $('view-save-cancel').addEventListener('click', closeForm);
    $('view-name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveCurrent(); } else if (e.key === 'Escape') { e.stopPropagation(); closeForm(); $('view-save-open').focus(); }
    });
    $('view-delete').addEventListener('click', deleteSelected);
}
