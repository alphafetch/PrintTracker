import { effectiveWatts, remainingOf } from './calc.js';
import { dashPanel } from './dashboard.js';
import { state } from './state.js';
import { fmtNum, h, icon, isObject, isValidDate, spoolHex } from './util.js';

// ---------- Achievements ----------
//
// Each one has: title, desc, group, done, and optionally progress { value, target, unit }
// so locked ones can show how close you are.

export const ACHIEVEMENT_GROUPS = ['Prints', 'Filament', 'Time', 'Quality', 'Collection', 'Workflow', 'Printer and AMS'];

function monthCounts(prints) {
    const byMonth = {};
    for (const p of prints) if (isValidDate(p.date)) byMonth[p.date.slice(0, 7)] = (byMonth[p.date.slice(0, 7)] || 0) + 1;
    return byMonth;
}

function isWeekend(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return day === 0 || day === 6;
}

export function achievementList(stats) {
    const prints = Object.values(state.prints).filter(isObject)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const spools = Object.entries(state.spools).filter(([, s]) => isObject(s));
    let streak = 0;
    let best = 0;
    for (const p of prints) {
        streak = p.result ? streak + 1 : 0;
        best = Math.max(best, streak);
    }
    const materials = Object.entries(stats.byMaterial).filter(([m, g]) => g > 0 && m !== 'unknown').length;
    const queue = Object.values(state.queue).filter(isObject);
    const queueDone = queue.filter((q) => q.done).length;
    const months = monthCounts(prints);
    const monthKeys = Object.keys(months);
    const busiest = Math.max(0, ...Object.values(months));
    const longest = Math.max(0, ...prints.map((p) => Number(p.minutes) || 0));
    const withLinks = prints.filter((p) => p.link).length;
    const withNotes = prints.filter((p) => typeof p.notes === 'string' && p.notes.trim() !== '').length;
    const weekend = prints.filter((p) => isValidDate(p.date) && isWeekend(p.date)).length;
    const multiColor = prints.some((p) => Array.isArray(p.usage) && new Set(p.usage.filter(isObject).map((u) => u.spoolId)).size >= 2);
    const lesson = prints.some((p) => !p.result && typeof p.notes === 'string' && p.notes.trim() !== '');
    const colors = new Set(spools.map(([, s]) => spoolHex(s).toLowerCase())).size;
    const emptied = spools.some(([id, s]) => Number(s.startGrams) > 0 && remainingOf(id, s) <= 0);
    const archived = spools.some(([, s]) => s.archived);
    const rate = stats.total > 0 ? stats.succeeded / stats.total : 0;
    const pr = state.settings.printer;
    const tasks = Object.keys(state.maintenance).length;
    const overdue = stats.minutes >= 0 && Object.values(state.maintenance).length > 0
        ? Object.values(state.maintenance).some((t) => {
            const used = t.unit === 'hours' ? stats.minutes / 60 - t.atHours
                : t.unit === 'prints' ? stats.total - t.atPrints
                : t.unit === 'spools' ? (stats.grams - t.atGrams) / 1000
                : (Date.now() - new Date(t.lastDate + 'T00:00:00').getTime()) / 86400000;
            return used >= t.every;
        }) : false;
    const amsUnits = Object.values(state.ams);
    const amsLoaded = amsUnits.reduce((n, u) => n + u.slots.filter(Boolean).length, 0);
    const amsFull = amsUnits.some((u) => u.slots.length >= 4 && u.slots.every(Boolean));

    const g = (group, title, desc, done, progress) => ({ group, title, desc, done, progress });
    const p = (value, target, unit) => ({ value: Math.min(value, target), target, unit });

    return [
        g('Prints', 'It\'s Alive!', 'Log your first print', stats.total >= 1, p(stats.total, 1, 'prints')),
        g('Prints', 'Just One More Print', 'Log 5 prints', stats.total >= 5, p(stats.total, 5, 'prints')),
        g('Prints', 'Double-Digit Dabbler', 'Log 10 prints', stats.total >= 10, p(stats.total, 10, 'prints')),
        g('Prints', 'Farmer\'s Market', 'Log 50 prints', stats.total >= 50, p(stats.total, 50, 'prints')),
        g('Prints', 'Benchy Centurion', 'Log 100 prints', stats.total >= 100, p(stats.total, 100, 'prints')),
        g('Prints', 'Touch Grass? Never.', 'Log 250 prints', stats.total >= 250, p(stats.total, 250, 'prints')),
        g('Prints', 'The Nozzle Never Sleeps', 'Log 10 prints in one month', busiest >= 10, p(busiest, 10, 'prints')),
        g('Prints', 'Creature of Habit', 'Print in 3 different months', monthKeys.length >= 3, p(monthKeys.length, 3, 'months')),
        g('Prints', 'Weekends Are for Printing', 'Log 5 prints made on a weekend', weekend >= 5, p(weekend, 5, 'prints')),

        g('Filament', 'One Kilo of Questionable Decisions', 'Use 1 kg of filament', stats.grams >= 1000, p(stats.grams / 1000, 1, 'kg')),
        g('Filament', 'Spool Goblin', 'Use 5 kg of filament', stats.grams >= 5000, p(stats.grams / 1000, 5, 'kg')),
        g('Filament', 'Plastic Fantastic', 'Use 10 kg of filament', stats.grams >= 10000, p(stats.grams / 1000, 10, 'kg')),
        g('Filament', 'Mount Filament', 'Use 25 kg of filament', stats.grams >= 25000, p(stats.grams / 1000, 25, 'kg')),
        g('Filament', 'Down to the Cardboard', 'Use a spool all the way up', emptied),
        g('Filament', 'Plastic Sommelier', 'Print with 3 materials', materials >= 3, p(materials, 3, 'materials')),
        g('Filament', 'Mad Materials Scientist', 'Print with 5 materials', materials >= 5, p(materials, 5, 'materials')),

        g('Time', 'Day Shift, Night Shift, Print Shift', 'Log 24 hours of print time', stats.minutes >= 24 * 60, p(stats.minutes / 60, 24, 'h')),
        g('Time', 'Marathon Runner (Printer Edition)', 'Log 100 hours of print time', stats.minutes >= 100 * 60, p(stats.minutes / 60, 100, 'h')),
        g('Time', 'Printer Whisperer', 'Log 500 hours of print time', stats.minutes >= 500 * 60, p(stats.minutes / 60, 500, 'h')),
        g('Time', 'Sleeping Next to a Printer', 'Finish a single print of 8 hours or more', longest >= 480, p(longest / 60, 8, 'h')),
        g('Time', 'Are We There Yet?', 'Finish a single print of 24 hours or more', longest >= 1440, p(longest / 60, 24, 'h')),

        g('Quality', 'Hot Streak', '5 successful prints in a row', best >= 5, p(best, 5, 'in a row')),
        g('Quality', 'Nothing Can Go Wrong (Famous Last Words)', '10 successful prints in a row', best >= 10, p(best, 10, 'in a row')),
        g('Quality', 'Calibration Cult Member', '90% success rate over at least 20 prints', stats.total >= 20 && rate >= 0.9,
            stats.total >= 20 ? p(Math.round(rate * 100), 90, '%') : p(stats.total, 20, 'prints')),
        g('Quality', 'Failure Is a Feature', 'Add a note to a failed print', lesson),
        g('Quality', 'Dear Diary, It Warped Again', 'Add notes to 10 prints', withNotes >= 10, p(withNotes, 10, 'prints')),
        g('Quality', 'Bookmark Hoarder', 'Save a link on 5 prints', withLinks >= 5, p(withLinks, 5, 'links')),
        g('Quality', 'Two-Spool Tango', 'Use 2 spools in one print', multiColor),

        g('Collection', 'Shelf Life', 'Own 5 spools', stats.spoolCount >= 5, p(stats.spoolCount, 5, 'spools')),
        g('Collection', 'It\'s Not Hoarding, It\'s Stock', 'Own 10 spools', stats.spoolCount >= 10, p(stats.spoolCount, 10, 'spools')),
        g('Collection', 'Taste the Rainbow', 'Own spools in 6 different colors', colors >= 6, p(colors, 6, 'colors')),
        g('Collection', 'Marie Kondo\'d It', 'Archive a finished spool', archived),

        g('Workflow', 'Crossed It Off', 'Finish an item from the queue', queueDone >= 1, p(queueDone, 1, 'items')),
        g('Workflow', 'Backlog Slayer', 'Finish 5 queue items', queueDone >= 5, p(queueDone, 5, 'items')),
        g('Workflow', 'Responsible Adult', 'Export a backup', Boolean(state.lastExported)),
        g('Workflow', 'Watt\'s Up?', 'Have electricity costs counted in your prints', stats.energyCost > 0),

        g('Printer and AMS', 'Meet the Family', 'Pick your printer brand and model in Settings', Boolean(pr.brand && pr.model)),
        g('Printer and AMS', 'Oil Can Optimist', 'Set up 3 upkeep reminders', tasks >= 3, p(tasks, 3, 'tasks')),
        g('Printer and AMS', 'Squeaky Clean (and Quiet)', 'Have 3 or more upkeep reminders and none overdue', tasks >= 3 && !overdue),
        g('Printer and AMS', 'Multicolor Menace', 'Add an AMS', amsUnits.length >= 1),
        g('Printer and AMS', 'Full House', 'Fill every slot of a 4-slot AMS', amsFull),
        g('Printer and AMS', 'Spool Hotel, No Vacancy', 'Have 8 spools loaded in AMS slots', amsLoaded >= 8, p(amsLoaded, 8, 'spools')),
        g('Printer and AMS', 'Know Thy Watts', 'Know your printer\'s power draw', Boolean(effectiveWatts())),
        g('Printer and AMS', 'Print Farm', 'Add a second printer', Object.keys(state.settings.printers).length >= 1)
    ];
}

export function buildAchievementsPanel(stats) {
    const list = achievementList(stats);
    const earned = list.filter((a) => a.done).length;
    const panel = dashPanel(`Achievements (${earned} of ${list.length})`, 'achievements-panel');
    panel.id = 'achievements';

    const total = h('div', 'bar bar-thin achv-total');
    const fill = h('div', 'bar-fill');
    fill.style.width = Math.round((earned / list.length) * 100) + '%';
    total.appendChild(fill);
    panel.appendChild(total);

    for (const group of ACHIEVEMENT_GROUPS) {
        const items = list.filter((a) => a.group === group);
        if (items.length === 0) continue;
        const done = items.filter((a) => a.done).length;
        const head = h('h4', 'subhead achv-group', `${group} (${done}/${items.length})`);
        panel.appendChild(head);
        const grid = h('div', 'achv-grid');
        for (const a of items) {
            const tile = h('div', a.done ? 'achv earned' : 'achv');
            tile.appendChild(icon(a.done ? 'star' : 'lock'));
            const text = h('div', 'achv-text');
            text.appendChild(h('span', 'achv-title', a.title));
            text.appendChild(h('span', 'achv-desc', a.desc));
            if (!a.done && a.progress) {
                const bar = h('div', 'bar bar-thin achv-bar');
                const f = h('div', 'bar-fill');
                f.style.width = Math.round((a.progress.value / a.progress.target) * 100) + '%';
                bar.appendChild(f);
                text.appendChild(bar);
                text.appendChild(h('span', 'achv-desc', `${fmtNum(a.progress.value)} of ${fmtNum(a.progress.target)} ${a.progress.unit}`));
            }
            tile.appendChild(text);
            tile.title = a.done ? 'Earned' : 'Not earned yet';
            grid.appendChild(tile);
        }
        panel.appendChild(grid);
    }
    return panel;
}
