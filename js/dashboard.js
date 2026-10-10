import { buildAchievementsPanel } from './achievements.js';
import { findMaterial } from './catalog.js';
import { calcStats, describeDays, hardwareCost, spoolForecast, totalGramsOfPrint } from './calc.js';
import { failReasonLabel, MATERIAL_COLORS, MONTHS, RANGES, Sections } from './constants.js';
import { openPrintPopup } from './printPopup.js';
import { emptyState_, makeBadge, plural } from './render.js';
import { openSpoolPopup } from './spoolPopup.js';
import { saveState, state } from './state.js';
import { showTab } from './tabs.js';
import { $, fmtDuration, fmtGrams, fmtMoney, formatDate, h, isObject, makeLink, makeSwatch, materialKey, normalizeLink, spoolHex, svgEl, todayLocal } from './util.js';
import { buildGuidePanel } from './guide.js';
import { buildHeatmapPanel } from './heatmap.js';
import { buildRunningPanel, openStartPopup } from './running.js';
import { openSummaryPopup } from './summary.js';
import { buildBackupBanner, buildPrinterPanels } from './widgets.js';

// ---------- Rendering: dashboard ----------

export function statCard(label, value, sub, extraClass) {
    const card = h('div', extraClass ? `stat-card ${extraClass}` : 'stat-card');
    card.appendChild(h('p', 'stat-label', label));
    card.appendChild(h('p', 'stat-value', value));
    if (sub) card.appendChild(h('p', 'stat-sub', sub));
    return card;
}

export function ringChart(fraction) {
    const r = 15.9155;   // circumference ~ 100
    const svg = svgEl('svg', { viewBox: '0 0 36 36', class: 'ring', 'aria-hidden': 'true' });
    svg.appendChild(svgEl('circle', { class: 'ring-track', cx: 18, cy: 18, r, fill: 'none', 'stroke-width': 3.6 }));
    svg.appendChild(svgEl('circle', {
        class: 'ring-fill', cx: 18, cy: 18, r, fill: 'none', 'stroke-width': 3.6, 'stroke-linecap': 'round',
        'stroke-dasharray': `${Math.max(0, Math.min(1, fraction)) * 100} 100`,
        transform: 'rotate(-90 18 18)'
    }));
    return svg;
}

export function dashPanel(title, extraClass) {
    const panel = h('div', extraClass ? `panel ${extraClass}` : 'panel');
    panel.appendChild(h('h3', 'panel-title', title));
    return panel;
}

/** Month columns ending at the latest month that has data: at least 6, at most 12. */
export function monthSeries(byMonth) {
    const keys = Object.keys(byMonth).sort();
    if (keys.length === 0) return [];
    const [lastY, lastM] = keys[keys.length - 1].split('-').map(Number);
    const series = [];
    for (let i = 0; i < 12; i++) {
        const idx = lastY * 12 + (lastM - 1) - i;
        const y = Math.floor(idx / 12);
        const m = (idx % 12) + 1;
        const key = `${y}-${String(m).padStart(2, '0')}`;
        series.unshift({ key, y, m, n: byMonth[key] || 0 });
        if (key <= keys[0] && series.length >= 6) break;
    }
    return series;
}

/** Column chart. `label(n)` is the short number over a bar, `title(s)` the hover text. */
export function columnChart(series, label, title) {
    const max = Math.max(...series.map((s) => s.n), 1);
    const chart = h('div', 'col-chart');
    for (const s of series) {
        const col = h('div', 'col');
        col.appendChild(h('span', 'col-value', s.n > 0 ? label(s.n) : ''));
        const track = h('div', 'col-track');
        const bar = h('div', s.n > 0 ? 'col-bar' : 'col-bar col-empty');
        bar.style.height = Math.max(s.n > 0 ? 6 : 2, Math.round((s.n / max) * 100)) + '%';
        track.appendChild(bar);
        col.appendChild(track);
        col.appendChild(h('span', 'col-label', MONTHS[s.m - 1]));
        col.title = title(s);
        chart.appendChild(col);
    }
    return chart;
}

/** 1200 -> "1.2k", 42.4 -> "42" (no currency sign, so it fits over a narrow bar). */
export function shortNumber(n) {
    return n >= 1000 ? `${(Math.round(n / 100) / 10).toString()}k` : String(Math.round(n));
}

function buildRangeBar(range) {
    const bar = h('div', 'range-bar');
    const label = h('label', null, 'Show stats for');
    label.htmlFor = 'dash-range';
    const select = h('select', 'dropdown');
    select.id = 'dash-range';
    for (const [key, text] of RANGES) {
        const o = h('option', 'option-input', text);
        o.value = key;
        o.selected = key === range;
        select.appendChild(o);
    }
    select.addEventListener('change', () => {
        state.ui.range = select.value;
        saveState();
        renderDashboard();
    });
    bar.append(label, select);
    const start = h('button', 'btn btn-outline btn-small', 'Start a print');
    start.type = 'button';
    start.id = 'start-button';
    start.title = 'Start a timer for a print that is running';
    start.addEventListener('click', () => openStartPopup());
    bar.appendChild(start);
    const recap = h('button', 'btn btn-outline btn-small', 'Summary');
    recap.type = 'button';
    recap.id = 'summary-button';
    recap.title = 'A recap of a week or month that you can copy, print or save';
    recap.addEventListener('click', openSummaryPopup);
    bar.appendChild(recap);
    if (range !== 'all') {
        const note = h('p', 'range-note', 'Counts prints and filament bought in this range. Stock, upkeep and achievements always use everything.');
        note.id = 'dash-range-note';
        bar.appendChild(note);
    }
    return bar;
}

function buildFailurePanel(stats) {
    const panel = dashPanel('Why prints fail');
    panel.id = 'fail-panel';
    const rows = Object.entries(stats.failReasons).sort((a, b) => b[1].count - a[1].count);
    const wrap = h('div', 'fail-bars');
    for (const [key, entry] of rows) {
        const row = h('div', 'fail-bar-row');
        row.dataset.reason = key;
        row.appendChild(h('span', null, failReasonLabel(key) || 'No reason logged'));
        row.appendChild(h('span', 'fail-bar-value', `${entry.count}x \u00B7 ${fmtGrams(entry.grams)}g`));
        const track = h('div', 'fail-bar-track');
        const fill = h('div', 'fail-bar-fill');
        fill.style.width = Math.max(4, Math.round((entry.count / stats.failed) * 100)) + '%';
        track.appendChild(fill);
        row.appendChild(track);
        wrap.appendChild(row);
    }
    panel.appendChild(wrap);
    const money = stats.wastedCost > 0 ? ` (about ${fmtMoney(stats.wastedCost)} of filament)` : '';
    const total = h('p', 'panel-total-line', `Wasted on failed prints: ${fmtGrams(stats.wastedGrams)}g${money}.`);
    total.id = 'wasted-line';
    panel.appendChild(total);
    return panel;
}

function buildSpendPanel(stats) {
    const series = monthSeries(stats.spendByMonth);
    const panel = dashPanel(`Filament spending per month (${state.settings.currency})`);
    panel.id = 'spend-panel';
    let running = 0;
    const before = {};
    // Running total of filament bought up to and including each month (all spools in range)
    for (const s of series) {
        before[s.key] = running;
        running += s.n;
    }
    panel.appendChild(columnChart(series, shortNumber, (s) =>
        `${MONTHS[s.m - 1]} ${s.y}: ${fmtMoney(s.n)} (running total ${fmtMoney(before[s.key] + s.n)})`));
    const c = hardwareCost();
    const hw = c.printer === null && c.ams === 0 ? '' : ` + printer and AMS ${fmtMoney(c.hardware)}`;
    const line = h('p', 'panel-total-line', `Whole setup so far: ${fmtMoney(c.total)} (filament ${fmtMoney(c.filament)}${hw}).`);
    line.id = 'setup-total-line';
    panel.appendChild(line);
    return panel;
}

export function renderDashboard() {
    const root = $('dashboard-content');
    root.replaceChildren();

    const all = calcStats();
    const range = state.ui.range;
    const stats = range === 'all' ? all : calcStats(range);

    const guide = buildGuidePanel();
    if (all.total === 0 && all.spoolCount === 0) {
        if (guide) root.appendChild(guide);
        const box = emptyState_('Nothing to show yet.', 'Add a spool in the Filament tab, then log your first print.');
        const go = h('button', 'btn btn-primary', 'Add your first spool');
        go.type = 'button';
        go.addEventListener('click', () => { showTab(Sections.FILA); openSpoolPopup(); });
        box.appendChild(go);
        root.appendChild(box);
        return;
    }

    const running = buildRunningPanel();
    if (running) root.appendChild(running);
    if (guide) root.appendChild(guide);
    const banner = buildBackupBanner();
    if (banner) root.appendChild(banner);
    root.appendChild(buildRangeBar(range));

    // --- Stat cards ---
    const rate = stats.total > 0 ? stats.succeeded / stats.total : 0;
    const grid = h('div', 'stat-grid');

    const thisMonth = all.byMonth[todayLocal().slice(0, 7)] || 0;
    grid.appendChild(statCard('Total prints', String(stats.total), `${thisMonth} this month`));

    const rateCard = statCard('Success rate', stats.total > 0 ? Math.round(rate * 100) + '%' : '-',
        `${stats.succeeded} succeeded, ${stats.failed} failed`, 'stat-with-ring');
    if (stats.total > 0) rateCard.appendChild(ringChart(rate));
    grid.appendChild(rateCard);

    grid.appendChild(statCard('Print time', stats.minutes > 0 ? fmtDuration(stats.minutes) : '-',
        stats.timedPrints > 0 ? `~${fmtDuration(stats.minutes / stats.timedPrints)} per timed print` : 'Log print time to track it'));
    grid.appendChild(statCard('Filament used', fmtGrams(stats.grams) + 'g',
        stats.total > 0 ? `~${fmtGrams(stats.grams / stats.total)}g per print` : 'Includes failed prints'));
    grid.appendChild(statCard('Filament left', fmtGrams(stats.gramsLeft) + 'g',
        `across ${plural(stats.activeCount, 'active spool')}`));
    grid.appendChild(statCard('Total spent', stats.hasPrices ? fmtMoney(stats.spentInRange) : 'No prices',
        stats.costPerGram !== null ? `~${fmtMoney(stats.costPerGram, 3)} per gram` : 'Add prices to spools'));
    const totalCost = stats.usedCost + stats.energyCost + stats.wearCost;
    const extras = [];
    if (stats.energyCost > 0) extras.push(`${fmtMoney(stats.energyCost)} electricity`);
    if (stats.wearCost > 0) extras.push(`${fmtMoney(stats.wearCost)} machine wear`);
    grid.appendChild(statCard('Cost of prints', totalCost > 0 ? fmtMoney(totalCost) : '-',
        extras.length > 0 ? `incl. ${extras.join(' and ')}`
            : totalCost > 0 && stats.total > 0 ? `~${fmtMoney(totalCost / stats.total)} per print` : 'Estimated from spool prices'));
    grid.appendChild(statCard('Spools', `${stats.activeCount} active`,
        `${stats.lowCount} low, ${stats.spoolCount - stats.activeCount} archived`));
    root.appendChild(grid);

    // --- Needs attention (low or empty spools) ---
    if (stats.lowSpools.length > 0) {
        const panel = dashPanel('Running low', 'panel-alert');
        panel.id = 'low-panel';
        for (const { id, spool, left, reorder } of stats.lowSpools) {
            const row = h('button', 'list-row list-button');
            row.type = 'button';
            row.dataset.id = id;
            row.appendChild(makeSwatch(spoolHex(spool)));
            const text = h('span', 'list-main');
            text.appendChild(h('span', 'list-title', `${spool.brand}, ${spool.color}`));
            text.appendChild(h('span', 'list-sub', String(spool.material || 'other').toUpperCase()));
            row.appendChild(text);
            row.appendChild(makeBadge(left <= 0 ? 'Empty' : `~${fmtGrams(left)}g left`, 'red'));
            row.addEventListener('click', () => showTab(Sections.FILA));
            panel.appendChild(row);
            if (reorder) {
                const fc = spoolForecast(id, spool);
                const pace = fc && fc.daysLeft <= 365 ? ` At your pace it runs out in ${describeDays(fc.daysLeft)}.` : '';
                const note = h('p', 'reorder-note', `Time to reorder: you have no other ${String(spool.material || 'other').toUpperCase()} in stock.${pace}`);
                note.dataset.id = id;
                const buy = h('button', 'btn btn-outline btn-small', 'Buy again');
                buy.type = 'button';
                buy.addEventListener('click', () => openSpoolPopup({ copyFromId: id }));
                note.appendChild(buy);
                panel.appendChild(note);
            }
        }
        root.appendChild(panel);
    }

    // --- Spools that may need drying ---
    if (stats.drySpools.length > 0) {
        const panel = dashPanel('Maybe dry these');
        panel.id = 'dry-panel';
        for (const { id, spool, days, dried } of stats.drySpools) {
            const row = h('button', 'list-row list-button');
            row.type = 'button';
            row.dataset.id = id;
            row.appendChild(makeSwatch(spoolHex(spool)));
            const text = h('span', 'list-main');
            text.appendChild(h('span', 'list-title', `${spool.brand}, ${spool.color}`));
            text.appendChild(h('span', 'list-sub', `${String(spool.material || 'other').toUpperCase()} \u00B7 ${dried ? 'dried' : 'opened'} ${plural(days, 'day')} ago` +
                (findMaterial(materialKey(spool)) ? ` \u00B7 oven: ${findMaterial(materialKey(spool)).oven}` : '')));
            row.appendChild(text);
            row.appendChild(makeBadge('Needs drying?', 'amber'));
            row.addEventListener('click', () => showTab(Sections.FILA));
            panel.appendChild(row);
        }
        root.appendChild(panel);
    }

    const cols = h('div', 'dash-grid');
    for (const panel of buildPrinterPanels(all)) cols.appendChild(panel);

    // --- Filament by material (donut) ---
    const materials = Object.entries(stats.byMaterial).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1]);
    if (materials.length > 0) {
        const panel = dashPanel('Filament by material');
        const wrap = h('div', 'donut-wrap');
        const donut = h('div', 'donut');
        let acc = 0;
        const stops = [];
        for (const [material, g] of materials) {
            const from = (acc / stats.grams) * 100;
            acc += g;
            const to = (acc / stats.grams) * 100;
            const color = MATERIAL_COLORS[material] || MATERIAL_COLORS.other;
            stops.push(`${color} ${from.toFixed(2)}% ${to.toFixed(2)}%`);
        }
        donut.style.background = `conic-gradient(${stops.join(', ')})`;
        const hole = h('div', 'donut-hole');
        hole.appendChild(h('strong', 'donut-total', fmtGrams(stats.grams) + 'g'));
        hole.appendChild(h('span', 'donut-caption', 'total'));
        donut.appendChild(hole);
        wrap.appendChild(donut);

        const legend = h('ul', 'legend');
        for (const [material, g] of materials) {
            const li = h('li', 'legend-row');
            const dot = h('span', 'legend-dot');
            dot.style.background = MATERIAL_COLORS[material] || MATERIAL_COLORS.other;
            li.appendChild(dot);
            li.appendChild(h('span', 'legend-name', material.toUpperCase()));
            const share = stats.grams > 0 ? Math.round((g / stats.grams) * 100) : 0;
            li.appendChild(h('span', 'legend-value', `${fmtGrams(g)}g (${share}%)`));
            legend.appendChild(li);
        }
        wrap.appendChild(legend);
        panel.appendChild(wrap);
        cols.appendChild(panel);
    }

    // --- Prints per month (columns, with empty months filled in) ---
    const printSeries = monthSeries(stats.byMonth);
    if (printSeries.length > 0) {
        const panel = dashPanel('Prints per month');
        panel.appendChild(columnChart(printSeries, String, (c) => `${MONTHS[c.m - 1]} ${c.y}: ${plural(c.n, 'print')}`));
        cols.appendChild(panel);
    }

    const heat = buildHeatmapPanel(dashPanel);
    if (heat) cols.appendChild(heat);

    if (stats.failed > 0) cols.appendChild(buildFailurePanel(stats));
    if (Object.keys(stats.spendByMonth).length > 0) cols.appendChild(buildSpendPanel(stats));

    // --- Recent prints ---
    const recent = Object.entries(state.prints).filter(([, p]) => isObject(p))
        .sort((a, b) => String(b[1].date || '').localeCompare(String(a[1].date || ''))).slice(0, 5);
    if (recent.length > 0) {
        const panel = dashPanel('Recent prints');
        for (const [id, p] of recent) {
            const row = h('button', 'list-row list-button');
            row.type = 'button';
            row.dataset.id = id;
            const text = h('span', 'list-main');
            text.appendChild(h('span', 'list-title', p.name || 'Untitled print'));
            const bits = [formatDate(p.date), `${fmtGrams(totalGramsOfPrint(p))}g`];
            const dur = fmtDuration(p.minutes);
            if (dur) bits.push(dur);
            text.appendChild(h('span', 'list-sub', bits.join(' · ')));
            row.appendChild(text);
            row.appendChild(makeBadge(p.result ? 'Success' : 'Failure', p.result ? 'green' : 'red'));
            row.addEventListener('click', () => showTab(Sections.PRINTS));
            panel.appendChild(row);
        }
        cols.appendChild(panel);
    }

    // --- Up next (queue) ---
    const upNext = Object.entries(state.queue).filter(([, q]) => isObject(q) && !q.done).slice(0, 4);
    if (upNext.length > 0) {
        const panel = dashPanel('Up next');
        for (const [id, item] of upNext) {
            const row = h('div', 'list-row');
            const text = h('span', 'list-main');
            text.appendChild(h('span', 'list-title', item.name || 'Untitled'));
            const safeLink = normalizeLink(item.link);
            if (safeLink) {
                const sub = h('span', 'list-sub');
                sub.appendChild(makeLink(safeLink));
                text.appendChild(sub);
            }
            row.appendChild(text);
            const log = h('button', 'btn btn-outline btn-small', 'Log print');
            log.type = 'button';
            log.addEventListener('click', () => openPrintPopup({ name: item.name, link: item.link || '', queueId: id, spec: item.spec }));
            row.appendChild(log);
            panel.appendChild(row);
        }
        cols.appendChild(panel);
    }

    if (cols.children.length > 0) root.appendChild(cols);

    root.appendChild(buildAchievementsPanel(all));
}
