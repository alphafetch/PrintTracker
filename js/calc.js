import { autoAmsPrice, autoKwh, autoPrice, autoWatts } from './catalog.js';
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

/**
 * The three printer numbers can be the person's own (stored) or automatic (from the catalog).
 * Each returns { value, auto, note, url } or null when there is nothing to use.
 */
export function effectiveWatts() {
    const p = state.settings.printer;
    if (p.watts !== null) return { value: p.watts, auto: false };
    const a = autoWatts(p.brand, p.model);
    return a ? { ...a, auto: true } : null;
}

export function effectiveKwh() {
    const p = state.settings.printer;
    if (p.kwhPrice !== null) return { value: p.kwhPrice, auto: false };
    const a = autoKwh(state.settings.currency);
    return a ? { value: a.value, note: a.note, url: a.url, auto: true } : null;
}

export function effectivePrice() {
    const p = state.settings.printer;
    if (p.price !== null) return { value: p.price, auto: false };
    const a = autoPrice(p.brand, p.model, state.settings.currency);
    return a ? { ...a, auto: true } : null;
}

/** Estimated electricity cost of one print (needs a print time, watts and a kWh price). */
export function energyCostOfPrint(print) {
    const w = effectiveWatts();
    const k = effectiveKwh();
    const minutes = validMinutes(Number(print && print.minutes));
    if (!minutes || !w || !k || !(w.value > 0) || !(k.value > 0)) return 0;
    return (minutes / 60) * (w.value / 1000) * k.value;
}

/** Machine wear cost of one print: the wear rate (money per print hour) times the print time. */
export function wearCostOfPrint(print) {
    const rate = state.settings.printer.wear;
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
 */
export function calcStats(range = 'all') {
    const prints = Object.values(state.prints).filter(isObject).filter((p) => inRange(p.date, range));
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

/** An AMS unit's own price, or the automatic one for its type: { value, auto, note, url } or null. */
export function amsUnitPrice(unit) {
    if (Number.isFinite(unit.price)) return { value: unit.price, auto: false };
    const a = autoAmsPrice(unit.type, state.settings.currency);
    return a ? { ...a, auto: true } : null;
}

/** What the printer and its AMS units cost, plus filament bought. `estimate` is true when the printer price is automatic. */
export function hardwareCost() {
    const printer = effectivePrice();
    const units = Object.values(state.ams);
    const prices = units.map(amsUnitPrice);
    const ams = prices.reduce((sum, p) => sum + (p ? p.value : 0), 0);
    const printerValue = printer ? printer.value : 0;
    const filament = calcStats().spent;
    return {
        printer: printer ? printer.value : null, estimate: Boolean(printer && printer.auto),
        ams, amsUnits: units.length, amsPriced: prices.filter(Boolean).length,
        amsEstimate: prices.some((p) => p && p.auto),
        hardware: printerValue + ams,
        filament,
        total: printerValue + ams + filament
    };
}
