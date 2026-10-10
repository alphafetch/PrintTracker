import { hasManyPrinters, printerIds, printerName } from './calc.js';
import { openPrintPopup, updateBodyLock } from './printPopup.js';
import { renderAll } from './render.js';
import { cleanQueueSpec, MAX_RUNNING, saveState, state } from './state.js';
import { clearError, fmtDuration, h, isObject, normalizeLink, notify, showError, uid, validMinutes } from './util.js';

// ---------- "Printing now": a timer for prints that are running ----------

const TICK_MS = 30000;

/** [id, run] for every running print, oldest first. */
export function runningList() {
    return Object.entries(state.running || {}).filter(([, r]) => isObject(r)).sort((a, b) => a[1].startedAt - b[1].startedAt);
}

/** Whole minutes since the print started (never negative). */
export function elapsedMinutes(run, now = Date.now()) {
    return Math.max(0, Math.floor((now - run.startedAt) / 60000));
}

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "Started 2:14 PM" or "Started Tue 2:14 PM" when it was not today. */
export function startedText(run, now = Date.now()) {
    const d = new Date(run.startedAt);
    const sameDay = d.toDateString() === new Date(now).toDateString();
    return `Started ${sameDay ? '' : d.toLocaleDateString([], { weekday: 'short' }) + ' '}${clock(run.startedAt)}`;
}

/** What to show for one run: elapsed text, optional progress (0 to 1) and a time-left line. */
export function runProgress(run, now = Date.now()) {
    const elapsed = elapsedMinutes(run, now);
    const out = { elapsed, elapsedText: elapsed < 1 ? 'just started' : `${fmtDuration(elapsed)} so far`, fraction: null, leftText: '' };
    if (run.minutes) {
        out.fraction = Math.min(1, (now - run.startedAt) / (run.minutes * 60000));
        const left = run.minutes - elapsed;
        out.leftText = left > 0
            ? `About ${fmtDuration(left)} left, done around ${clock(run.startedAt + run.minutes * 60000)}`
            : `The estimate (${fmtDuration(run.minutes)}) is up. It should be done about now.`;
    }
    return out;
}

function cancelRun(id) {
    const run = state.running[id];
    if (!run) return;
    delete state.running[id];
    saveState();
    renderAll();
    notify(`Stopped the timer for "${run.name}".`, {
        action: { label: 'Undo', onClick: () => { state.running[id] = run; saveState(); renderAll(); } }
    });
}

/** Open the print form for a finished (or failed) run. The timer is removed when the print is saved. */
export function finishRun(id, failed) {
    const run = state.running[id];
    if (!run) return;
    const elapsed = Math.max(1, elapsedMinutes(run));
    const spec = { ...(run.spec || {}), minutes: failed ? elapsed : (run.minutes || elapsed), printerId: run.printerId };
    openPrintPopup({ name: run.name, link: run.link, queueId: run.queueId || null, spec, runningId: id, failed });
}

function buildRun(id, run) {
    const info = runProgress(run);
    const card = h('div', 'run-card');
    card.dataset.id = id;
    const top = h('div', 'run-top');
    top.appendChild(h('span', 'run-name', run.name));
    const where = hasManyPrinters() && printerIds().includes(run.printerId) ? ` · ${printerName(run.printerId)}` : (hasManyPrinters() ? ` · ${printerName('')}` : '');
    top.appendChild(h('span', 'run-sub', `${startedText(run)}${where}`));
    card.appendChild(top);
    card.appendChild(h('p', 'run-elapsed', info.elapsedText.charAt(0).toUpperCase() + info.elapsedText.slice(1)));
    if (info.fraction !== null) {
        const pct = Math.round(info.fraction * 100);
        const bar = h('div', 'bar');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', String(pct));
        bar.setAttribute('aria-label', `Progress of ${run.name}`);
        const fill = h('div', 'bar-fill');
        fill.style.width = pct + '%';
        bar.appendChild(fill);
        card.appendChild(bar);
        card.appendChild(h('p', 'run-left', info.leftText));
    }
    const actions = h('div', 'card-actions');
    const done = h('button', 'btn btn-primary btn-small', 'Finished');
    done.type = 'button';
    done.title = 'Log it as a print';
    done.addEventListener('click', () => finishRun(id, false));
    const failed = h('button', 'btn btn-outline btn-small', 'Failed');
    failed.type = 'button';
    failed.title = 'Log it as a failed print';
    failed.addEventListener('click', () => finishRun(id, true));
    const stop = h('button', 'btn btn-danger-ghost btn-small', 'Stop timer');
    stop.type = 'button';
    stop.title = 'Forget this timer without logging a print';
    stop.addEventListener('click', () => cancelRun(id));
    actions.append(done, failed, stop);
    card.appendChild(actions);
    return card;
}

function fillPanel(panel) {
    panel.replaceChildren(h('h3', 'panel-title', 'Printing now'));
    for (const [id, run] of runningList()) panel.appendChild(buildRun(id, run));
}

/** The "Printing now" panel for the dashboard, or null when nothing is running. */
export function buildRunningPanel() {
    if (runningList().length === 0) return null;
    const panel = h('div', 'panel running-panel');
    panel.id = 'running-panel';
    fillPanel(panel);
    return panel;
}

/** Refresh the elapsed times in place. Called every half minute. */
export function refreshRunning() {
    const panel = document.getElementById('running-panel');
    if (panel && runningList().length > 0) fillPanel(panel);
}

setInterval(() => { if (!document.hidden) refreshRunning(); }, TICK_MS);

// ---------- Start popup ----------

let popup = null;
let nameEl = null;
let hoursEl = null;
let minutesEl = null;
let printerEl = null;
let printerField = null;
let errorEl = null;
let startReturn = null;
let startContext = null;   // { link, queueId, spec }

function field(labelText, control, id) {
    const wrap = h('div', 'field');
    const label = h('label', null, labelText);
    label.htmlFor = id;
    wrap.append(label, control);
    return wrap;
}

function buildPopup() {
    popup = h('div', 'popup');
    popup.id = 'start-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-labelledby', 'start-popup-title');
    const content = h('div', 'popup-content start-popup-content');
    const title = h('h3', 'popup-title', 'Start a print');
    title.id = 'start-popup-title';
    content.appendChild(title);
    content.appendChild(h('p', 'secondary-text small', 'Starts a timer on the dashboard. When the print is done, press Finished to log it.'));

    nameEl = h('input', 'text-input');
    nameEl.type = 'text';
    nameEl.id = 'start-name';
    nameEl.maxLength = 80;
    nameEl.spellcheck = false;
    nameEl.placeholder = 'e.g., Plate Scraper';
    content.appendChild(field('Name', nameEl, 'start-name'));

    const durationLabel = h('span', 'label-text', 'Estimated time (optional)');
    durationLabel.id = 'start-duration-label';
    const inline = h('div', 'inline-fields');
    inline.setAttribute('role', 'group');
    inline.setAttribute('aria-labelledby', 'start-duration-label');
    hoursEl = h('input', 'number-input');
    hoursEl.type = 'number'; hoursEl.min = '0'; hoursEl.max = '9999'; hoursEl.step = '1'; hoursEl.id = 'start-hours'; hoursEl.placeholder = '0';
    hoursEl.setAttribute('aria-label', 'Hours');
    minutesEl = h('input', 'number-input');
    minutesEl.type = 'number'; minutesEl.min = '0'; minutesEl.max = '59'; minutesEl.step = '1'; minutesEl.id = 'start-minutes'; minutesEl.placeholder = '0';
    minutesEl.setAttribute('aria-label', 'Minutes');
    inline.append(hoursEl, h('span', 'unit', 'h'), minutesEl, h('span', 'unit', 'min'));
    const durationField = h('div', 'field');
    durationField.append(durationLabel, inline);
    content.appendChild(durationField);

    printerEl = h('select', 'dropdown');
    printerEl.id = 'start-printer';
    printerField = field('Printer', printerEl, 'start-printer');
    content.appendChild(printerField);

    errorEl = h('p', 'error-text');
    errorEl.id = 'start-error';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    content.appendChild(errorEl);

    const actions = h('div', 'popup-actions');
    const go = h('button', 'btn btn-primary', 'Start timer');
    go.type = 'button';
    go.id = 'start-go';
    const cancel = h('button', 'btn btn-outline', 'Cancel');
    cancel.type = 'button';
    cancel.id = 'start-cancel';
    actions.append(go, cancel);
    content.appendChild(actions);
    popup.appendChild(content);
    document.body.appendChild(popup);

    go.addEventListener('click', startRun);
    cancel.addEventListener('click', closeStartPopup);
    nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') startRun(); });
    popup.addEventListener('click', (e) => { if (e.target === popup) closeStartPopup(); });
}

/** Open the start form. `name`, `link`, `spec` and `queueId` pre-fill it from a queue item. */
export function openStartPopup({ name = '', link = '', queueId = null, spec = null } = {}) {
    if (runningList().length >= MAX_RUNNING) {
        notify(`You can time up to ${MAX_RUNNING} prints at once. Finish or stop one first.`, true);
        return;
    }
    if (!popup) buildPopup();
    const clean = cleanQueueSpec(spec);
    startContext = { link: normalizeLink(link) || '', queueId, spec: clean };
    nameEl.value = name;
    const minutes = clean ? clean.minutes : null;
    hoursEl.value = minutes ? String(Math.floor(minutes / 60)) : '';
    minutesEl.value = minutes ? String(minutes % 60) : '';
    printerField.hidden = !hasManyPrinters();
    printerEl.replaceChildren();
    printerIds().forEach((id, i) => {
        const o = h('option', 'option-input', `${i + 1}. ${printerName(id)}`);
        o.value = id;
        printerEl.appendChild(o);
    });
    printerEl.value = clean && printerIds().includes(clean.printerId) ? clean.printerId : '';
    clearError(errorEl);
    startReturn = document.activeElement;
    popup.style.display = 'block';
    popup.scrollTop = 0;
    updateBodyLock();
    nameEl.focus();
}

function readEstimate() {
    const hText = hoursEl.value.trim();
    const mText = minutesEl.value.trim();
    if (hText === '' && mText === '') return { minutes: null };
    const hrs = hText === '' ? 0 : hoursEl.valueAsNumber;
    const mins = mText === '' ? 0 : minutesEl.valueAsNumber;
    if (!Number.isInteger(hrs) || !Number.isInteger(mins) || hrs < 0 || mins < 0 || hrs > 9999 || mins > 59) {
        return { error: 'Estimated time: use whole hours (0 or more) and minutes between 0 and 59.' };
    }
    return { minutes: validMinutes(hrs * 60 + mins) };
}

export function startRun() {
    const name = nameEl.value.trim();
    if (name === '') return showError(errorEl, 'Give the print a name.');
    const estimate = readEstimate();
    if (estimate.error) return showError(errorEl, estimate.error);
    if (runningList().length >= MAX_RUNNING) return showError(errorEl, `You can time up to ${MAX_RUNNING} prints at once.`);
    const ctx = startContext || { link: '', queueId: null, spec: null };
    state.running[uid()] = {
        name,
        startedAt: Date.now(),
        minutes: estimate.minutes,
        printerId: hasManyPrinters() && printerIds().includes(printerEl.value) ? printerEl.value : '',
        link: ctx.link,
        queueId: ctx.queueId || '',
        spec: ctx.spec ? { ...ctx.spec, minutes: estimate.minutes } : null
    };
    saveState();
    closeStartPopup();
    renderAll();
    notify(`Timer started for "${name}".`);
    return true;
}

export function closeStartPopup() {
    if (!popup) return;
    const wasOpen = popup.style.display === 'block';
    popup.style.display = 'none';
    startContext = null;
    updateBodyLock();
    if (wasOpen && startReturn && document.contains(startReturn)) startReturn.focus();
    startReturn = null;
}

export function startPopupOpen() {
    return Boolean(popup) && popup.style.display === 'block';
}

export function startPopupEl() {
    return popup;
}

