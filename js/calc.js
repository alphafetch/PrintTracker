import { BRANDS, autoAmsPrice, autoKwh, autoPrice, autoWatts } from './catalog.js';
import { state } from './state.js';
import { isObject, isValidDate, materialKey, todayLocal, validMinutes } from './util.js';

// ---------- Calculations ----------

export function usageOf(print) {
    return print && Array.isArray(print.usage) ? print.usage.filter(isObject) : [];
}

/** Total grams logged against a spool (failed prints count too). */
export function gramsUsedOfSpool(spoolId, excludePrintId = null) {
    let total = 0;
    for (const [printId, print] of Object.entries(state.prints)) {
        if (printId === excludePrintId) continue;
        for (const u of usageOf(print)) {
            if (u.spoolId === spoolId) total += Number(u.grams) || 0;
        }
    }
    return total;
}

export function printsUsingSpool(spoolId) {
    return Object.values(state.prints).filter((p) => usageOf(p).some((u) => u.spoolId === spoolId)).length;
}

export function activeSpools() {
    return Object.entries(state.spools).filter(([, s]) => isObject(s) && !s.archived);
}

export function lowFraction() {
    return state.settings.lowPercent / 100;
}

export function warnFraction() {
    return Math.max(0.5, lowFraction() + 0.15);
}

// ---------- Printers ----------

/** The main printer is id '' ; extra printers (Settings > Printer) have their own ids. */
export function extraPrinters() {
    return isObject(state.settings.printers) ? state.settings.printers : {};
}

export function hasManyPrinters() {
    return Object.keys(extraPrinters()).length > 0;
}

export function printerIds() {
    return ['', ...Object.keys(extraPrinters())];
}

/** All-time stats for one printer; with a single printer that is simply everything. */
export function printerStats(id) {
    return hasManyPrinters() ? calcStats('all', id) : calcStats();
}

/** The settings for a printer id; an unknown id falls back to the main printer. */
export function printerCfg(id) {
    const extra = extraPrinters();
    return id && Object.prototype.hasOwnProperty.call(extra, id) ? extra[id] : state.settings.printer;
}

/** Which printer a print was made on ('' = main; unknown ids count as main). */
export function printerIdOf(print) {
    const id = print && print.printerId;
    return typeof id === 'string' && id !== '' && Object.prototype.hasOwnProperty.call(extraPrinters(), id) ? id : '';
}

/** A readable name: nickname, else "Brand Model", else a generic one. */
export function printerName(id) {
    const cfg = printerCfg(id);
    if (cfg.nickname) return cfg.nickname;
    const brand = BRANDS.find((b) => b.key === cfg.brand);
    const brandName = brand && brand.key !== 'other' ? brand.label : '';
    const model = cfg.model && cfg.model !== 'Other' ? `${brandName} ${cfg.model}`.trim() : brandName;
    if (model) return model;
    return id === '' ? 'Main printer' : 'Extra printer';
}

/**
 * The three printer numbers can be the person's own (stored) or automatic (from the catalog).
 * Each returns { value, auto, note, url } or null when there is nothing to use.
 * `p` is a printer's settings (the main printer when left out).
 */
export function effectiveWatts(p = state.settings.printer) {
    if (p.watts !== null) return { value: p.watts, auto: false };
    const a = autoWatts(p.brand, p.model);
    return a ? { ...a, auto: true } : null;
}

export function effectiveKwh(p = state.settings.printer) {
    if (p.kwhPrice !== null) return { value: p.kwhPrice, auto: false };
    const a = autoKwh(state.settings.currency);
    return a ? { value: a.value, note: a.note, url: a.url, auto: true } : null;
}

export function effectivePrice(p = state.settings.printer) {
    if (p.price !== null) return { value: p.price, auto: false };
    const a = autoPrice(p.brand, p.model, state.settings.currency);
    return a ? { ...a, auto: true } : null;
}

/** Estimated electricity cost of one print (needs a print time, watts and a kWh price). */
export function energyCostOfPrint(print) {
    const cfg = printerCfg(printerIdOf(print));
    const w = effectiveWatts(cfg);
    const k = effectiveKwh(cfg);
    const minutes = validMinutes(Number(print && print.minutes));
    if (!minutes || !w || !k || !(w.value > 0) || !(k.value > 0)) return 0;
    return (minutes / 60) * (w.value / 1000) * k.value;
}

/** Machine wear cost of one print: the wear rate (money per print hour) times the print time. */
export function wearCostOfPrint(print) {
    const rate = printerCfg(printerIdOf(print)).wear;
    const minutes = validMinutes(Number(print && print.minutes));
    if (!minutes || !(rate > 0)) return 0;
    return (minutes / 60) * rate;
}

export function remainingOf(id, spool) {
    return (Number(spool.startGrams) || 0) - gramsUsedOfSpool(id);
}

export function totalGramsOfPrint(print) {
    return usageOf(print).reduce((sum, u) => sum + (Number(u.grams) || 0), 0);
}

/** Estimated material cost of one print, from the prices of the spools it used. */
export function costOfPrint(print) {
    let cost = 0;
    for (const u of usageOf(print)) {
        const spool = state.spools[u.spoolId];
        if (spool && Number.isFinite(spool.price) && Number(spool.startGrams) > 0) {
            cost += (Number(u.grams) || 0) * (spool.price / spool.startGrams);
        }
    }
    return cost;
}

// ---------- Date ranges ----------

function parseIso(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
}

export function isoOf(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDays(iso, n) {
    const d = parseIso(iso);
    d.setDate(d.getDate() + n);
    return isoOf(d);
}

/** Whole days from one ISO date to another (later minus earlier). */
export function daysBetween(fromIso, toIso) {
    return Math.round((parseIso(toIso) - parseIso(fromIso)) / 86400000);
}

/** First day (ISO) of a range, or null for "all time". */
export function rangeStart(range, today = todayLocal()) {
    switch (range) {
        case 'month': return today.slice(0, 7) + '-01';
        case '30': return addDays(today, -29);
        case '90': return addDays(today, -89);
        case 'year': return today.slice(0, 4) + '-01-01';
        default: return null;
    }
}

export function inRange(iso, range) {
    const start = rangeStart(range);
    return start === null || (isValidDate(iso) && iso >= start);
}

// ---------- Drying ----------

/** The day a spool was opened: the day it was dried, or else its first print. Null when never used. */
export function openedSince(spoolId, spool) {
    if (isValidDate(spool.driedDate)) return spool.driedDate;
    let first = null;
    for (const print of Object.values(state.prints)) {
        if (!isObject(print) || !isValidDate(print.date)) continue;
        if (usageOf(print).some((u) => u.spoolId === spoolId) && (first === null || print.date < first)) first = print.date;
    }
    return first;
}

/** Days since the spool was dried or opened (null if unknown), for the "needs drying" nudge. */
export function daysOpen(spoolId, spool) {
    const since = openedSince(spoolId, spool);
    return since === null ? null : Math.max(0, daysBetween(since, todayLocal()));
}

export function needsDrying(spoolId, spool) {
    const limit = state.settings.dryDays;
    if (!(limit > 0) || spool.archived || remainingOf(spoolId, spool) <= 0) return false;
    const days = daysOpen(spoolId, spool);
    return days !== null && days >= limit;
}

// ---------- Statistics ----------

/**
 * Totals for the dashboard. `range` ('all', 'month', '30', '90', 'year') limits what is counted from
 * prints (and the money spent on spools bought in that time). Stock levels are always current.
 * `printerId` ('' = main printer) counts only that printer's prints; null counts them all.
 */
export function calcStats(range = 'all', printerId = null) {
    const prints = Object.values(state.prints).filter(isObject).filter((p) => inRange(p.date, range))
        .filter((p) => printerId === null || printerIdOf(p) === printerId);
    const spools = Object.entries(state.spools).filter(([, s]) => isObject(s));

    const total = prints.length;
    const succeeded = prints.filter((p) => p.result).length;

    let grams = 0;
    let usedCost = 0;
    let energyCost = 0;
    let wearCost = 0;
    let minutes = 0;
    let timedPrints = 0;
    const byMaterial = {};
    const byMonth = {};
    const failReasons = {};
    let wastedGrams = 0;
    let wastedCost = 0;

    for (const p of prints) {
        const mins = validMinutes(Number(p.minutes));
        if (mins) { minutes += mins; timedPrints++; }
        energyCost += energyCostOfPrint(p);
        wearCost += wearCostOfPrint(p);
        for (const u of usageOf(p)) {
            const g = Number(u.grams) || 0;
            grams += g;
            const spool = state.spools[u.spoolId];
            const material = spool ? materialKey(spool) : 'unknown';
            byMaterial[material] = (byMaterial[material] || 0) + g;
            if (spool && Number.isFinite(spool.price) && Number(spool.startGrams) > 0) {
                usedCost += g * (spool.price / spool.startGrams);
            }
        }
        if (isValidDate(p.date)) {
            const key = p.date.slice(0, 7);
            byMonth[key] = (byMonth[key] || 0) + 1;
        }
        if (!p.result) {
            const key = typeof p.failReason === 'string' ? p.failReason : '';
            const entry = failReasons[key] || (failReasons[key] = { count: 0, grams: 0 });
            entry.count++;
            const g = totalGramsOfPrint(p);
            entry.grams += g;
            wastedGrams += g;
            wastedCost += costOfPrint(p);
        }
    }

    let spent = 0;
    let spentInRange = 0;
    let pricedGrams = 0;
    const spendByMonth = {};
    for (const [, s] of spools) {
        if (Number.isFinite(s.price)) {
            spent += s.price;
            pricedGrams += Number(s.startGrams) || 0;
            if (inRange(s.date, range)) {
                spentInRange += s.price;
                if (isValidDate(s.date)) {
                    const key = s.date.slice(0, 7);
                    spendByMonth[key] = (spendByMonth[key] || 0) + s.price;
                }
            }
        }
    }

    const active = spools.filter(([, s]) => !s.archived);
    let gramsLeft = 0;
    const lowSpools = [];
    const healthy = {};   // material -> number of active spools that are not low
    for (const [id, s] of active) {
        const start = Number(s.startGrams) || 0;
        const left = start - gramsUsedOfSpool(id);
        gramsLeft += Math.max(0, left);
        const low = start > 0 && left / start <= lowFraction();
        if (low) lowSpools.push({ id, spool: s, left });
        else if (left > 0) healthy[materialKey(s)] = (healthy[materialKey(s)] || 0) + 1;
    }
    lowSpools.sort((a, b) => a.left - b.left);
    // Reorder alert: nothing else of this material is in stock
    for (const entry of lowSpools) entry.reorder = !healthy[materialKey(entry.spool)];

    const drySpools = [];
    for (const [id, s] of active) {
        if (needsDrying(id, s)) drySpools.push({ id, spool: s, days: daysOpen(id, s), dried: isValidDate(s.driedDate) });
    }
    drySpools.sort((a, b) => b.days - a.days);

    return {
        range, total, succeeded, failed: total - succeeded,
        grams, usedCost, energyCost, wearCost, spent, spentInRange, minutes, timedPrints, gramsLeft,
        costPerGram: pricedGrams > 0 ? spent / pricedGrams : null,
        hasPrices: spools.some(([, s]) => Number.isFinite(s.price)),
        byMaterial, byMonth, spendByMonth, failReasons, wastedGrams, wastedCost,
        lowSpools, drySpools,
        spoolCount: spools.length, activeCount: active.length, lowCount: lowSpools.length
    };
}

/**
 * Cost analysis per group of spools. For each group:
 *   perKg    what you paid per kg (priced spools only)
 *   wastePct share of the filament used that went into failed prints
 *   trueKg   perKg divided by the share that ended up in good prints: what a kilo of *useful* filament costs
 */
export function spoolCostGroups(groupBy = 'brand-material') {
    const groups = new Map();
    const keyOf = (s) => {
        const brand = String(s.brand || 'Unknown').trim();
        const material = String(s.material || 'other').toUpperCase();
        switch (groupBy) {
            case 'material': return [material, material];
            case 'brand': return [brand.toLowerCase(), brand];
            case 'spool': return [null, `${brand}, ${s.color} (${material})`];
            default: return [`${brand.toLowerCase()}|${material}`, `${brand} ${material}`];
        }
    };
    const spoolGroup = {};
    for (const [id, s] of Object.entries(state.spools)) {
        if (!isObject(s)) continue;
        const [k, label] = keyOf(s);
        const key = k === null ? id : k;
        if (!groups.has(key)) {
            groups.set(key, { key, label, spools: 0, spent: 0, pricedGrams: 0, used: 0, failed: 0, prints: 0, left: 0 });
        }
        const g = groups.get(key);
        g.spools++;
        if (Number.isFinite(s.price)) { g.spent += s.price; g.pricedGrams += Number(s.startGrams) || 0; }
        if (!s.archived) g.left += Math.max(0, remainingOf(id, s));
        spoolGroup[id] = g;
    }
    for (const p of Object.values(state.prints)) {
        if (!isObject(p)) continue;
        const touched = new Set();
        for (const u of usageOf(p)) {
            const g = spoolGroup[u.spoolId];
            if (!g) continue;
            const grams = Number(u.grams) || 0;
            g.used += grams;
            if (!p.result) g.failed += grams;
            touched.add(g);
        }
        for (const g of touched) g.prints++;
    }
    return Array.from(groups.values()).map((g) => {
        const perKg = g.pricedGrams > 0 ? (g.spent / g.pricedGrams) * 1000 : null;
        const wastePct = g.used > 0 ? g.failed / g.used : null;
        const trueKg = perKg !== null && wastePct !== null && wastePct < 1 ? perKg / (1 - wastePct) : null;
        return { ...g, perKg, wastePct, trueKg };
    }).sort((a, b) => b.spent - a.spent || a.label.localeCompare(b.label));
}

/** An AMS unit's own price, or the automatic one for its type: { value, auto, note, url } or null. */
export function amsUnitPrice(unit) {
    if (Number.isFinite(unit.price)) return { value: unit.price, auto: false };
    const a = autoAmsPrice(unit.type, state.settings.currency);
    return a ? { ...a, auto: true } : null;
}

/**
 * What the printers and their AMS units cost, plus filament bought. `printer` is the main printer's price
 * and `estimate` is true when that price is automatic; `printers` is every printer together.
 */
export function hardwareCost() {
    const printer = effectivePrice();
    const extra = Object.values(extraPrinters()).map((p) => effectivePrice(p));
    const units = Object.values(state.ams);
    const prices = units.map(amsUnitPrice);
    const ams = prices.reduce((sum, p) => sum + (p ? p.value : 0), 0);
    const printersValue = (printer ? printer.value : 0) + extra.reduce((sum, p) => sum + (p ? p.value : 0), 0);
    const filament = calcStats().spent;
    return {
        printer: printer ? printer.value : null, estimate: Boolean(printer && printer.auto) || extra.some((p) => p && p.auto),
        printers: printersValue, printerCount: 1 + extra.length,
        ams, amsUnits: units.length, amsPriced: prices.filter(Boolean).length,
        amsEstimate: prices.some((p) => p && p.auto),
        hardware: printersValue + ams,
        filament,
        total: printersValue + ams + filament
    };
}


// ---------- Forecast: when will a spool run out? ----------

export const PACE_DAYS = 60;   // how far back "your recent pace" looks
export const SOON_DAYS = 21;   // a spool that runs out within this many days goes on the shopping list

function paceFor(matches, today) {
    const start = addDays(today, -(PACE_DAYS - 1));
    let grams = 0;
    let first = null;
    for (const print of Object.values(state.prints)) {
        if (!isObject(print) || !isValidDate(print.date) || print.date < start || print.date > today) continue;
        let g = 0;
        for (const u of usageOf(print)) if (matches(u.spoolId)) g += Number(u.grams) || 0;
        if (g > 0) {
            grams += g;
            if (first === null || print.date < first) first = print.date;
        }
    }
    if (grams <= 0) return null;
    // A pace measured over fewer than 7 days would swing wildly, so it counts as at least a week.
    const days = Math.min(PACE_DAYS, Math.max(7, daysBetween(first, today) + 1));
    return { grams, days, perDay: grams / days, perWeek: (grams / days) * 7 };
}

/** Grams per week a spool has been used at over the last 60 days, or null when it was not used. */
export function spoolPace(spoolId, today = todayLocal()) {
    return paceFor((id) => id === spoolId, today);
}

/** { left, perWeek, daysLeft, date } for an active spool that was used recently, else null. */
export function spoolForecast(id, spool, today = todayLocal()) {
    if (!isObject(spool) || spool.archived) return null;
    const left = remainingOf(id, spool);
    if (left <= 0) return null;
    const pace = spoolPace(id, today);
    if (!pace) return null;
    const daysLeft = Math.ceil(left / pace.perDay);
    return { left, perWeek: pace.perWeek, daysLeft, date: addDays(today, daysLeft) };
}

/** The same for a whole material: all its active stock against all the grams of it printed lately. */
export function materialForecast(material, today = todayLocal()) {
    const ids = new Set(Object.entries(state.spools).filter(([, s]) => isObject(s) && materialKey(s) === material).map(([id]) => id));
    const pace = paceFor((id) => ids.has(id), today);
    if (!pace) return null;
    let left = 0;
    for (const [id, s] of activeSpools()) if (ids.has(id) && materialKey(s) === material) left += Math.max(0, remainingOf(id, s));
    const daysLeft = Math.ceil(left / pace.perDay);
    return { left, perWeek: pace.perWeek, daysLeft, date: addDays(today, daysLeft) };
}

/** "about 3 weeks", "about 5 days", "over a year". */
export function describeDays(days) {
    if (days > 365) return 'over a year';
    if (days < 14) return `about ${days} ${days === 1 ? 'day' : 'days'}`;
    if (days < 60) return `about ${Math.round(days / 7)} weeks`;
    return `about ${Math.round(days / 30)} months`;
}

// ---------- Shopping list ----------

const FAVORITE_DAYS = 90;
const FAVORITE_PRINTS = 2;

const colorKey = (s) => `${String(s.brand || '').trim().toLowerCase()}|${materialKey(s)}|${String(s.color || '').trim().toLowerCase()}`;

/**
 * What to buy next. Each item: { kind, id, spool, key, left, forecast, prints, reorder }
 *   low       at or under the low-stock limit (or empty); `reorder` when no other spool of that material is in stock
 *   soon      not low yet, but will run out within SOON_DAYS at the recent pace
 *   favorite  a colour used in 2+ prints in the last 90 days with nothing of it left in stock
 */
export function shoppingList(today = todayLocal()) {
    const stats = calcStats();
    const items = [];
    const seen = new Set();
    for (const { id, spool, left, reorder } of stats.lowSpools) {
        const key = colorKey(spool);
        seen.add(key);
        items.push({ kind: 'low', id, spool, key, left, reorder, forecast: spoolForecast(id, spool, today) });
    }
    const lowIds = new Set(stats.lowSpools.map((l) => l.id));
    for (const [id, spool] of activeSpools()) {
        if (lowIds.has(id)) continue;
        const forecast = spoolForecast(id, spool, today);
        if (forecast && forecast.daysLeft <= SOON_DAYS) {
            const key = colorKey(spool);
            seen.add(key);
            items.push({ kind: 'soon', id, spool, key, left: forecast.left, reorder: false, forecast });
        }
    }

    // colours you keep coming back to
    const start = addDays(today, -(FAVORITE_DAYS - 1));
    const counts = new Map();
    for (const print of Object.values(state.prints)) {
        if (!isObject(print) || !isValidDate(print.date) || print.date < start || print.date > today) continue;
        const touched = new Set();
        for (const u of usageOf(print)) {
            const spool = state.spools[u.spoolId];
            if (isObject(spool)) touched.add(colorKey(spool));
        }
        for (const key of touched) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const inStock = new Set();
    for (const [id, s] of activeSpools()) if (remainingOf(id, s) > 0) inStock.add(colorKey(s));
    const newest = new Map();   // colour key -> its most recently bought spool
    for (const [id, s] of Object.entries(state.spools)) {
        if (!isObject(s)) continue;
        const key = colorKey(s);
        const cur = newest.get(key);
        if (!cur || String(s.date || '') >= String(cur.spool.date || '')) newest.set(key, { id, spool: s });
    }
    for (const [key, n] of counts) {
        if (n < FAVORITE_PRINTS || inStock.has(key) || seen.has(key) || !newest.has(key)) continue;
        const { id, spool } = newest.get(key);
        items.push({ kind: 'favorite', id, spool, key, left: 0, prints: n, reorder: false, forecast: null });
    }

    const order = { low: 0, soon: 1, favorite: 2 };
    items.sort((a, b) => order[a.kind] - order[b.kind] || Number(b.reorder) - Number(a.reorder) || a.left - b.left
        || String(a.spool.brand).localeCompare(String(b.spool.brand)));
    return items;
}


// ---------- Activity (calendar and streaks) ----------

/** Monday of the week a date is in (weeks run Monday to Sunday). */
export function weekStart(iso) {
    const d = parseIso(iso);
    return addDays(iso, -((d.getDay() + 6) % 7));
}

/** { 'YYYY-MM-DD': number of prints } for every day with at least one print. */
export function printsPerDay() {
    const days = {};
    for (const p of Object.values(state.prints)) {
        if (isObject(p) && isValidDate(p.date)) days[p.date] = (days[p.date] || 0) + 1;
    }
    return days;
}

/**
 * Weeks in a row with at least one print. `current` still counts if this week has no print yet but last week did,
 * so the streak does not "break" on a Monday. `longest` is the best run ever.
 */
export function weekStreaks(days = printsPerDay(), today = todayLocal()) {
    const weeks = new Set(Object.keys(days).map(weekStart));
    if (weeks.size === 0) return { current: 0, longest: 0, weeks: 0 };
    const sorted = Array.from(weeks).sort();
    let longest = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
        run = daysBetween(sorted[i - 1], sorted[i]) === 7 ? run + 1 : 1;
        if (run > longest) longest = run;
    }
    let cursor = weekStart(today);
    if (!weeks.has(cursor)) cursor = addDays(cursor, -7);
    let current = 0;
    while (weeks.has(cursor)) {
        current++;
        cursor = addDays(cursor, -7);
    }
    return { current, longest, weeks: weeks.size };
}

// ---------- Summary for a period ----------

/** Everything the recap shows for prints dated from `start` to `end` (both ISO, inclusive). */
export function summarize(start, end) {
    const prints = Object.values(state.prints).filter((p) => isObject(p) && isValidDate(p.date) && p.date >= start && p.date <= end);
    const out = {
        start, end, total: prints.length, succeeded: 0, failed: 0, minutes: 0, grams: 0,
        filamentCost: 0, energyCost: 0, wearCost: 0, wastedGrams: 0, wastedCost: 0,
        byMaterial: {}, longest: null, heaviest: null, busiest: null, daysActive: 0,
        topSpool: null, topReason: null, bought: { count: 0, spent: 0 }, printers: []
    };
    const perDay = {};
    const perSpool = {};
    const reasons = {};
    const perPrinter = {};
    for (const p of prints) {
        if (p.result) out.succeeded++; else out.failed++;
        const mins = validMinutes(Number(p.minutes)) || 0;
        const grams = totalGramsOfPrint(p);
        const cost = costOfPrint(p);
        out.minutes += mins;
        out.grams += grams;
        out.filamentCost += cost;
        out.energyCost += energyCostOfPrint(p);
        out.wearCost += wearCostOfPrint(p);
        if (!p.result) {
            out.wastedGrams += grams;
            out.wastedCost += cost;
            const reason = typeof p.failReason === 'string' ? p.failReason : '';
            if (reason) reasons[reason] = (reasons[reason] || 0) + 1;
        }
        if (mins > 0 && (!out.longest || mins > out.longest.minutes)) out.longest = { name: p.name, minutes: mins };
        if (grams > 0 && (!out.heaviest || grams > out.heaviest.grams)) out.heaviest = { name: p.name, grams };
        perDay[p.date] = (perDay[p.date] || 0) + 1;
        const pid = printerIdOf(p);
        const row = perPrinter[pid] || (perPrinter[pid] = { id: pid, prints: 0, minutes: 0 });
        row.prints++;
        row.minutes += mins;
        for (const u of usageOf(p)) {
            const g = Number(u.grams) || 0;
            const spool = state.spools[u.spoolId];
            const material = spool ? materialKey(spool) : 'unknown';
            out.byMaterial[material] = (out.byMaterial[material] || 0) + g;
            if (spool) perSpool[u.spoolId] = (perSpool[u.spoolId] || 0) + g;
        }
    }
    out.daysActive = Object.keys(perDay).length;
    for (const [date, n] of Object.entries(perDay)) {
        if (!out.busiest || n > out.busiest.n || (n === out.busiest.n && date < out.busiest.date)) out.busiest = { date, n };
    }
    const top = Object.entries(perSpool).sort((a, b) => b[1] - a[1])[0];
    if (top) out.topSpool = { id: top[0], spool: state.spools[top[0]], grams: top[1] };
    const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
    if (topReason) out.topReason = { key: topReason[0], count: topReason[1] };
    for (const s of Object.values(state.spools)) {
        if (isObject(s) && isValidDate(s.date) && s.date >= start && s.date <= end) {
            out.bought.count++;
            if (Number.isFinite(s.price)) out.bought.spent += s.price;
        }
    }
    out.printers = hasManyPrinters() ? printerIds().map((id) => perPrinter[id] || { id, prints: 0, minutes: 0 }) : [];
    return out;
}


// ---------- Tags ----------

/** A print's tags (older prints have none). */
export function tagsOf(print) {
    return print && Array.isArray(print.tags) ? print.tags.filter((t) => typeof t === 'string' && t !== '') : [];
}

export const tagKey = (tag) => String(tag).toLowerCase();

/** Every tag in use with what its prints add up to, busiest first. Tags that differ only in case are one tag. */
export function tagTotals() {
    const map = new Map();
    for (const p of Object.values(state.prints)) {
        if (!isObject(p)) continue;
        const grams = totalGramsOfPrint(p);
        const cost = costOfPrint(p) + energyCostOfPrint(p) + wearCostOfPrint(p);
        const mins = validMinutes(Number(p.minutes)) || 0;
        for (const tag of new Set(tagsOf(p).map(tagKey))) {
            const shown = tagsOf(p).find((t) => tagKey(t) === tag);
            const row = map.get(tag) || { key: tag, tag: shown, prints: 0, failed: 0, minutes: 0, grams: 0, cost: 0 };
            row.prints++;
            if (!p.result) row.failed++;
            row.minutes += mins;
            row.grams += grams;
            row.cost += cost;
            map.set(tag, row);
        }
    }
    return Array.from(map.values()).sort((a, b) => b.prints - a.prints || a.tag.localeCompare(b.tag));
}
