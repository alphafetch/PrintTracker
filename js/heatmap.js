import { addDays, printsPerDay, weekStart, weekStreaks } from './calc.js';
import { MONTHS } from './constants.js';
import { plural } from './render.js';
import { formatDate, h, todayLocal } from './util.js';

// ---------- Print calendar (dashboard) ----------

export const HEAT_WEEKS = 53;

/** 0 for no prints, then 1 to 4 for 1, 2, 3 and 4 or more prints that day. */
export function heatLevel(n) {
    return n <= 0 ? 0 : Math.min(4, n);
}

/** Wide calendar of the last year, one square per day, like a contribution graph. Null until there is a print. */
export function buildHeatmapPanel(dashPanel) {
    const days = printsPerDay();
    const dates = Object.keys(days);
    if (dates.length === 0) return null;

    const today = todayLocal();
    const first = addDays(weekStart(today), -(HEAT_WEEKS - 1) * 7);
    const panel = dashPanel('Print calendar', 'heat-panel');
    panel.id = 'heat-panel';

    let total = 0;
    let active = 0;
    let busiest = null;
    for (const [date, n] of Object.entries(days)) {
        if (date < first || date > today) continue;
        total += n;
        active++;
        if (!busiest || n > busiest.n || (n === busiest.n && date < busiest.date)) busiest = { date, n };
    }
    const streaks = weekStreaks(days, today);
    const parts = [`${plural(total, 'print')} on ${plural(active, 'day')} in the last year`];
    if (busiest && busiest.n > 1) parts.push(`busiest day ${formatDate(busiest.date)} (${busiest.n} prints)`);
    if (streaks.longest > 0) parts.push(`${streaks.current > 0 ? `${plural(streaks.current, 'week')} in a row now` : 'no print this week yet'}, best run ${plural(streaks.longest, 'week')}`);
    const summary = parts.join(' · ');

    const scroll = h('div', 'heat-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'group');
    scroll.setAttribute('aria-label', 'Print calendar for the last year. Scroll sideways to see earlier weeks.');
    const board = h('div', 'heat-board');

    // month names above the first column of each month
    const months = h('div', 'heat-months');
    months.setAttribute('aria-hidden', 'true');
    let lastMonth = -1;
    for (let w = 0; w < HEAT_WEEKS; w++) {
        const monday = addDays(first, w * 7);
        const month = Number(monday.slice(5, 7)) - 1;
        const label = h('span', 'heat-month', month !== lastMonth ? MONTHS[month] : '');
        if (month !== lastMonth) lastMonth = month;
        months.appendChild(label);
    }
    board.appendChild(months);

    const body = h('div', 'heat-body');
    const dayNames = h('div', 'heat-days');
    dayNames.setAttribute('aria-hidden', 'true');
    ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((t) => dayNames.appendChild(h('span', 'heat-day', t)));
    body.appendChild(dayNames);

    const grid = h('div', 'heat-grid');
    grid.id = 'heat-grid';
    grid.setAttribute('role', 'img');
    grid.setAttribute('aria-label', summary);
    for (let w = 0; w < HEAT_WEEKS; w++) {
        for (let d = 0; d < 7; d++) {
            const date = addDays(first, w * 7 + d);
            const cell = h('span', 'heat-cell');
            if (date > today) {
                cell.classList.add('heat-future');
            } else {
                const n = days[date] || 0;
                cell.classList.add(`heat-${heatLevel(n)}`);
                cell.dataset.date = date;
                cell.dataset.count = String(n);
                cell.title = n === 0 ? `${formatDate(date)}: no prints` : `${formatDate(date)}: ${plural(n, 'print')}`;
            }
            grid.appendChild(cell);
        }
    }
    body.appendChild(grid);
    board.appendChild(body);
    scroll.appendChild(board);
    panel.appendChild(scroll);

    const legend = h('div', 'heat-legend');
    legend.setAttribute('aria-hidden', 'true');
    legend.append('Fewer');
    for (let i = 0; i <= 4; i++) legend.appendChild(h('span', `heat-cell heat-${i}`));
    legend.append('More');
    panel.appendChild(legend);

    const line = h('p', 'panel-total-line', summary + '.');
    line.id = 'heat-summary';
    panel.appendChild(line);

    // show the newest weeks first
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { scroll.scrollLeft = scroll.scrollWidth; });
    return panel;
}
