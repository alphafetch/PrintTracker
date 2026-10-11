import { DASH_ACHIEVEMENTS, DASH_PANELS } from './constants.js';
import { renderDashboard } from './dashboard.js';
import { updateBodyLock } from './printPopup.js';
import { saveState, state } from './state.js';
import { h } from './util.js';

// ---------- Customize the dashboard: show, hide and reorder panels ----------

let popup = null;
let listEl = null;
let returnTo = null;

/** The saved order first, then any panel not mentioned in default order. */
export function effectiveDashOrder() {
    const keys = DASH_PANELS.map(([k]) => k);
    const saved = state.ui.dashOrder.filter((k) => keys.includes(k));
    return [...saved, ...keys.filter((k) => !saved.includes(k))];
}

/** Save, redraw the dashboard and the list, and put focus back on the control that was used. */
function commit(key, selector) {
    saveState();
    renderDashboard();
    renderList();
    const row = key ? listEl.querySelector(`[data-key="${key}"]`) : null;
    let el = row ? row.querySelector(selector) : document.getElementById('customize-reset');
    // A row that moved to the top or bottom has one button disabled: use the other one.
    if (row && el && el.disabled) el = row.querySelector('button:not(:disabled)');
    if (el) el.focus();
}

function toggle(key, visible) {
    const hidden = state.ui.dashHidden.filter((k) => k !== key);
    if (!visible) hidden.push(key);
    state.ui.dashHidden = hidden;
    commit(key, 'input');
}

function move(key, delta) {
    const order = effectiveDashOrder();
    const i = order.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    state.ui.dashOrder = order;
    commit(key, delta < 0 ? '.dash-up' : '.dash-down');
}

function reset() {
    state.ui.dashHidden = [];
    state.ui.dashOrder = [];
    commit(null, null);
}

function renderList() {
    const order = effectiveDashOrder();
    const names = Object.fromEntries(DASH_PANELS);
    listEl.replaceChildren();
    order.forEach((key, i) => {
        const row = h('li', 'customize-row');
        row.dataset.key = key;
        const label = h('label', 'customize-check');
        const box = h('input');
        box.type = 'checkbox';
        box.checked = !state.ui.dashHidden.includes(key);
        box.addEventListener('change', () => toggle(key, box.checked));
        label.append(box, h('span', null, names[key]));
        row.appendChild(label);
        const mk = (text, cls, aria, disabled, delta) => {
            const b = h('button', `btn btn-outline btn-small ${cls}`, text);
            b.type = 'button';
            b.setAttribute('aria-label', `${aria} ${names[key]}`);
            b.disabled = disabled;
            b.addEventListener('click', () => move(key, delta));
            return b;
        };
        row.append(mk('Up', 'dash-up', 'Move up', i === 0, -1), mk('Down', 'dash-down', 'Move down', i === order.length - 1, 1));
        listEl.appendChild(row);
    });
    const ach = h('li', 'customize-row');
    ach.dataset.key = DASH_ACHIEVEMENTS;
    const label = h('label', 'customize-check');
    const box = h('input');
    box.type = 'checkbox';
    box.checked = !state.ui.dashHidden.includes(DASH_ACHIEVEMENTS);
    box.addEventListener('change', () => toggle(DASH_ACHIEVEMENTS, box.checked));
    label.append(box, h('span', null, 'Achievements (always at the bottom)'));
    ach.appendChild(label);
    listEl.appendChild(ach);
}

function buildPopup() {
    popup = h('div', 'popup');
    popup.id = 'customize-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-labelledby', 'customize-popup-title');
    const content = h('div', 'popup-content customize-popup-content');
    const title = h('h3', 'popup-title', 'Customize dashboard');
    title.id = 'customize-popup-title';
    content.appendChild(title);
    content.appendChild(h('p', 'secondary-text small', 'Untick a panel to hide it, or move it up or down. Panels with nothing to show stay hidden on their own. Running timers, warnings and the stat cards always show. Changes apply right away and are remembered.'));
    listEl = h('ul', 'customize-list');
    listEl.id = 'customize-list';
    content.appendChild(listEl);
    const actions = h('div', 'popup-actions');
    const resetBtn = h('button', 'btn btn-outline', 'Reset to default');
    resetBtn.type = 'button';
    resetBtn.id = 'customize-reset';
    resetBtn.addEventListener('click', reset);
    const done = h('button', 'btn btn-primary', 'Done');
    done.type = 'button';
    done.id = 'customize-done';
    done.addEventListener('click', closeCustomizePopup);
    actions.append(done, resetBtn);
    content.appendChild(actions);
    popup.appendChild(content);
    document.body.appendChild(popup);
    popup.addEventListener('click', (e) => { if (e.target === popup) closeCustomizePopup(); });
}

export function openCustomizePopup() {
    if (!popup) buildPopup();
    renderList();
    returnTo = document.activeElement;
    popup.style.display = 'block';
    popup.scrollTop = 0;
    updateBodyLock();
    popup.querySelector('input').focus();
}

export function closeCustomizePopup() {
    if (!popup) return;
    const was = popup.style.display === 'block';
    popup.style.display = 'none';
    updateBodyLock();
    if (was && returnTo && document.contains(returnTo)) returnTo.focus();
    returnTo = null;
}

export function customizePopupOpen() {
    return Boolean(popup) && popup.style.display === 'block';
}

export function customizePopupEl() {
    return popup;
}
