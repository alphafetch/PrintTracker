import { addDays, summarize } from './calc.js';
import { failReasonLabel } from './constants.js';
import { downloadBlob } from './data.js';
import { updateBodyLock } from './printPopup.js';
import { copyText, fmtDuration, fmtGrams, fmtMoney, formatDate, h, notify, todayLocal } from './util.js';
import { printerName } from './calc.js';
import { plural } from './render.js';

// ---------- Print summary (a recap you can copy, print or save) ----------

export const PERIODS = [
    ['week', 'Last 7 days'],
    ['month', 'This month'],
    ['lastmonth', 'Last month'],
    ['30', 'Last 30 days'],
    ['year', 'This year']
];

let popup = null;
let periodEl = null;
let bodyEl = null;
let summaryReturn = null;
let lastText = '';

/** { start, end, label } for a period key. */
export function periodRange(key, today = todayLocal()) {
    switch (key) {
        case 'week': return { start: addDays(today, -6), end: today };
        case 'lastmonth': {
            const first = today.slice(0, 7) + '-01';
            const end = addDays(first, -1);
            return { start: end.slice(0, 7) + '-01', end };
        }
        case '30': return { start: addDays(today, -29), end: today };
        case 'year': return { start: today.slice(0, 4) + '-01-01', end: today };
        default: return { start: today.slice(0, 7) + '-01', end: today };
    }
}

/** The recap as [heading, value] rows. Only rows that have something to say are included. */
export function summaryRows(sum) {
    const rows = [];
    if (sum.total === 0) {
        rows.push(['Prints', 'None in this period']);
    } else {
        const rate = Math.round((sum.succeeded / sum.total) * 100);
        rows.push(['Prints', `${sum.total} (${sum.succeeded} succeeded, ${sum.failed} failed, ${rate}% success)`]);
        rows.push(['Days printing', `${sum.daysActive}`]);
        if (sum.minutes > 0) rows.push(['Print time', fmtDuration(sum.minutes)]);
        const materials = Object.entries(sum.byMaterial).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1])
            .map(([m, g]) => `${m.toUpperCase()} ${fmtGrams(g)}g`).join(', ');
        rows.push(['Filament used', `${fmtGrams(sum.grams)}g${materials ? ` (${materials})` : ''}`]);
        const cost = sum.filamentCost + sum.energyCost + sum.wearCost;
        if (cost > 0) {
            const bits = [`filament ${fmtMoney(sum.filamentCost)}`];
            if (sum.energyCost > 0) bits.push(`electricity ${fmtMoney(sum.energyCost)}`);
            if (sum.wearCost > 0) bits.push(`wear ${fmtMoney(sum.wearCost)}`);
            rows.push(['Cost of prints', `${fmtMoney(cost)} (${bits.join(', ')})`]);
        }
        if (sum.failed > 0) {
            const money = sum.wastedCost > 0 ? `, about ${fmtMoney(sum.wastedCost)}` : '';
            const why = sum.topReason ? `. Most common reason: ${failReasonLabel(sum.topReason.key)}` : '';
            rows.push(['Wasted', `${fmtGrams(sum.wastedGrams)}g${money}${why}`]);
        }
        if (sum.longest) rows.push(['Longest print', `${sum.longest.name} (${fmtDuration(sum.longest.minutes)})`]);
        if (sum.heaviest) rows.push(['Most filament', `${sum.heaviest.name} (${fmtGrams(sum.heaviest.grams)}g)`]);
        if (sum.busiest && sum.busiest.n > 1) rows.push(['Busiest day', `${formatDate(sum.busiest.date)} (${plural(sum.busiest.n, 'print')})`]);
        if (sum.topSpool) rows.push(['Most used spool', `${sum.topSpool.spool.brand}, ${sum.topSpool.spool.color} (${fmtGrams(sum.topSpool.grams)}g)`]);
        if (sum.printers.length > 1) {
            rows.push(['By printer', sum.printers.map((p) => `${printerName(p.id)}: ${plural(p.prints, 'print')}${p.minutes > 0 ? `, ${fmtDuration(p.minutes)}` : ''}`).join('; ')]);
        }
    }
    if (sum.bought.count > 0) {
        rows.push(['Filament bought', `${plural(sum.bought.count, 'spool')}${sum.bought.spent > 0 ? `, ${fmtMoney(sum.bought.spent)}` : ''}`]);
    }
    return rows;
}

export function summaryText(label, sum) {
    const lines = [`Print summary: ${label} (${formatDate(sum.start)} to ${formatDate(sum.end)})`];
    for (const [k, v] of summaryRows(sum)) lines.push(`${k}: ${v}`);
    return lines.join('\n');
}

function currentLabel() {
    const found = PERIODS.find(([k]) => k === periodEl.value);
    return found ? found[1] : '';
}

export function renderSummary() {
    if (!popup) return;
    const range = periodRange(periodEl.value);
    const sum = summarize(range.start, range.end);
    bodyEl.replaceChildren();
    bodyEl.appendChild(h('h4', 'summary-heading', `${currentLabel()}: ${formatDate(range.start)} to ${formatDate(range.end)}`));
    const list = h('dl', 'summary-list');
    for (const [k, v] of summaryRows(sum)) {
        list.appendChild(h('dt', null, k));
        list.appendChild(h('dd', null, v));
    }
    bodyEl.appendChild(list);
    lastText = summaryText(currentLabel(), sum);
}

function buildPopup() {
    popup = h('div', 'popup');
    popup.id = 'summary-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-labelledby', 'summary-popup-title');
    const content = h('div', 'popup-content summary-popup-content');
    const title = h('h3', 'popup-title', 'Print summary');
    title.id = 'summary-popup-title';
    content.appendChild(title);

    const field = h('div', 'field');
    const label = h('label', null, 'Period');
    label.htmlFor = 'summary-period';
    periodEl = h('select', 'dropdown');
    periodEl.id = 'summary-period';
    for (const [key, text] of PERIODS) {
        const o = h('option', 'option-input', text);
        o.value = key;
        periodEl.appendChild(o);
    }
    periodEl.value = 'month';
    field.append(label, periodEl);
    content.appendChild(field);

    bodyEl = h('div', 'summary-sheet');
    bodyEl.id = 'summary-sheet';
    content.appendChild(bodyEl);

    const actions = h('div', 'popup-actions');
    const copy = h('button', 'btn btn-primary', 'Copy');
    copy.type = 'button';
    copy.id = 'summary-copy';
    const save = h('button', 'btn btn-outline', 'Save as text');
    save.type = 'button';
    save.id = 'summary-save';
    const print = h('button', 'btn btn-outline', 'Print');
    print.type = 'button';
    print.id = 'summary-print';
    const close = h('button', 'btn btn-outline', 'Close');
    close.type = 'button';
    close.id = 'summary-close';
    actions.append(copy, save, print, close);
    content.appendChild(actions);
    popup.appendChild(content);
    document.body.appendChild(popup);

    periodEl.addEventListener('change', renderSummary);
    popup.addEventListener('click', (e) => { if (e.target === popup) closeSummaryPopup(); });
    close.addEventListener('click', closeSummaryPopup);
    copy.addEventListener('click', async () => {
        const ok = await copyText(lastText);
        notify(ok ? 'Summary copied.' : 'Could not copy. Use "Save as text" instead.', !ok);
    });
    save.addEventListener('click', () => {
        const range = periodRange(periodEl.value);
        downloadBlob(new Blob([lastText + '\n'], { type: 'text/plain;charset=utf-8' }), `print-summary-${range.start}-to-${range.end}.txt`);
    });
    print.addEventListener('click', printSummary);
}

export function printSummary() {
    document.body.classList.add('printing-summary');
    const done = () => document.body.classList.remove('printing-summary');
    window.addEventListener('afterprint', done, { once: true });
    try {
        window.print();
    } catch (error) {
        console.error(error);
        notify('Could not open the print dialog.', true);
    }
    setTimeout(done, 60000);
}

export function openSummaryPopup() {
    if (!popup) buildPopup();
    renderSummary();
    summaryReturn = document.activeElement;
    popup.style.display = 'block';
    popup.scrollTop = 0;
    updateBodyLock();
    periodEl.focus();
}

export function closeSummaryPopup() {
    if (!popup) return;
    const wasOpen = popup.style.display === 'block';
    popup.style.display = 'none';
    updateBodyLock();
    if (wasOpen && summaryReturn && document.contains(summaryReturn)) summaryReturn.focus();
    summaryReturn = null;
}

export function summaryPopupOpen() {
    return Boolean(popup) && popup.style.display === 'block';
}

export function summaryPopupEl() {
    return popup;
}

