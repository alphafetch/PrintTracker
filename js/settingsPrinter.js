import { effectiveKwh, effectiveWatts, hardwareCost } from './calc.js';
import { BRANDS, autoAmsPrice, autoKwh, autoPrice, autoWatts, findPrinter, modelsFor, wattsHint } from './catalog.js';
import { NOZZLES } from './constants.js';
import { renderAll } from './render.js';
import { saveState, state } from './state.js';
import { fmtMoney, h } from './util.js';

import { commitSettings, addSync, settingRow, settingCard, selectField, numberField, textField, dateField, autoValueField } from './settingsKit.js';

// ---------- Settings: printer ----------

function modelField(id) {
    const select = h('select', 'dropdown');
    select.id = id;
    select.addEventListener('change', () => commitSettings((st) => { st.printer.model = select.value; }));
    addSync(() => {
        const { brand, model } = state.settings.printer;
        select.replaceChildren();
        const none = h('option', null, brand ? 'Not set' : 'Pick a brand first');
        none.value = '';
        select.appendChild(none);
        for (const p of modelsFor(brand)) {
            const o = h('option', null, p.model);
            o.value = p.model;
            select.appendChild(o);
        }
        select.disabled = modelsFor(brand).length === 0;
        select.value = model;
    });
    return select;
}

/**
 * A number that is filled in automatically when we know it, with a pencil to override it.
 *   get()  -> the person's own value, or null
 *   auto() -> { value, note, url } or null
 */

export function buildPrinterSettings(root) {
    const printer = settingCard('Your printer', 'Shown on the dashboard. Everything here is optional.');
    const set = (fn) => commitSettings((st) => fn(st.printer));
    printer.appendChild(settingRow('set-printer-brand', 'Brand', null,
        selectField('set-printer-brand', [['', 'Not set'], ...BRANDS.map((b) => [b.key, b.label])],
            () => state.settings.printer.brand,
            (v) => set((p) => { p.brand = v; if (!findPrinter(v, p.model)) p.model = ''; }))));
    printer.appendChild(settingRow('set-printer-model', 'Model', null, modelField('set-printer-model')));
    printer.appendChild(settingRow('set-printer-name', 'Nickname', 'Something to call it, like "Benchy HQ".',
        textField('set-printer-name', { maxlength: 40, placeholder: 'e.g., Workhorse' },
            () => state.settings.printer.nickname, (v) => set((p) => { p.nickname = v; }))));
    printer.appendChild(settingRow('set-printer-nozzle', 'Nozzle size', null,
        selectField('set-printer-nozzle', NOZZLES.map((n) => [n, `${n} mm`]),
            () => state.settings.printer.nozzle, (v) => set((p) => { p.nozzle = v; }))));
    printer.appendChild(settingRow('set-printer-date', 'Arrival or purchase date', 'A future date becomes a countdown on the dashboard.',
        dateField('set-printer-date', () => state.settings.printer.date, (v) => set((p) => { p.date = v; }))));
    printer.appendChild(settingRow('set-printer-price', 'Price paid', null,
        autoValueField('set-printer-price', {
            label: 'price paid', min: 0, max: 10000000, step: 0.01,
            get: () => state.settings.printer.price,
            auto: () => { const { brand, model } = state.settings.printer; return autoPrice(brand, model, state.settings.currency); },
            set: (v) => set((p) => { p.price = v; }),
            unit: () => state.settings.currency,
            format: (v) => fmtMoney(v),
            emptyNote: () => 'Not filled in automatically. Tap the pencil and enter what you paid. Typical prices are only known for some Bambu Lab models, in US dollars.'
        })));
    root.appendChild(printer);

    const power = settingCard('Electricity', 'Used to estimate the energy cost of prints that have a print time.');
    power.appendChild(settingRow('set-printer-watts', 'Average power while printing', null,
        autoValueField('set-printer-watts', {
            label: 'average power', min: 0, max: 5000, step: 1,
            get: () => state.settings.printer.watts,
            auto: () => { const { brand, model } = state.settings.printer; return autoWatts(brand, model); },
            set: (v) => set((p) => { p.watts = v; }),
            unit: 'W',
            format: (v) => `${v} W`,
            emptyNote: () => {
                const { brand, model } = state.settings.printer;
                return wattsHint(brand, model) ||
                    'No official average for this printer. Use a plug-in power meter, or tap the pencil to enter a number.';
            }
        })));
    power.appendChild(settingRow('set-printer-kwh', 'Electricity price', 'Per kilowatt-hour, in your currency.',
        autoValueField('set-printer-kwh', {
            label: 'electricity price', min: 0, max: 100, step: 0.0001,
            get: () => state.settings.printer.kwhPrice,
            auto: () => autoKwh(state.settings.currency),
            set: (v) => set((p) => { p.kwhPrice = v; }),
            unit: () => `${state.settings.currency} per kWh`,
            format: (v) => `${fmtMoney(v, v < 1 ? 3 : 2)} per kWh`,
            emptyNote: () => 'Check your power bill, then tap the pencil. Typical prices are only built in for $ and £.'
        })));
    const preview = h('p', 'secondary-text small');
    preview.id = 'energy-preview';
    power.appendChild(preview);
    addSync(() => {
        const w = effectiveWatts();
        const k = effectiveKwh();
        preview.textContent = w && k && w.value > 0 && k.value > 0
            ? `A 5 hour print would use about ${fmtMoney(5 * (w.value / 1000) * k.value)} of electricity.`
            : 'Fill in both values to see an example.';
    });
    root.appendChild(power);

    const wear = settingCard('Machine wear', 'Nozzles, build plates and AMS parts wear out. Enter what that costs per hour of printing and it is added to each print\'s cost. Leave it empty to ignore wear.');
    wear.appendChild(settingRow('set-printer-wear', 'Wear cost per print hour', 'For example, a $20 nozzle that lasts 200 hours is $0.10 per hour.',
        numberField('set-printer-wear', { min: 0, max: 10000, step: 'any', placeholder: 'e.g., 0.10', unit: 'per hour' },
            () => state.settings.printer.wear, (v) => set((p) => { p.wear = v; }))));
    const wearPreview = h('p', 'secondary-text small');
    wearPreview.id = 'wear-preview';
    wear.appendChild(wearPreview);
    addSync(() => {
        const rate = state.settings.printer.wear;
        wearPreview.textContent = rate > 0
            ? `A 5 hour print would add about ${fmtMoney(5 * rate)} of machine wear.`
            : 'Not counted in print costs right now.';
    });
    root.appendChild(wear);

    root.appendChild(buildCostCard());
}

let costListEl = null;
let costSummaryEl = null;

/** Printer + AMS prices and the total spent on the setup. Rebuilt on every render. */
export function buildCostCard() {
    const card = settingCard('AMS and total cost', 'Add what you paid for each AMS to see what the whole setup has cost. Add AMS units on the Filament tab.');
    costListEl = h('div', 'cost-list');
    costListEl.id = 'ams-prices';
    costSummaryEl = h('ul', 'fact-list cost-summary');
    costSummaryEl.id = 'cost-summary';
    card.append(costListEl, costSummaryEl);
    renderCostCard();
    return card;
}

export function renderCostCard() {
    if (!costListEl) return;
    costListEl.replaceChildren();
    const units = Object.entries(state.ams);
    if (units.length === 0) {
        costListEl.appendChild(h('p', 'secondary-text small', 'No AMS added yet.'));
    }
    for (const [id, unit] of units) {
        const field = autoValueField('ams-price-' + id, {
            label: `price of ${unit.name}`, min: 0, max: 10000000, step: 0.01,
            get: () => (Number.isFinite(unit.price) ? unit.price : null),
            auto: () => autoAmsPrice(unit.type, state.settings.currency),
            set: (v) => { unit.price = v === null ? null : Math.round(v * 100) / 100; saveState(); renderAll(); },
            unit: () => state.settings.currency,
            format: (v) => fmtMoney(v),
            emptyNote: () => 'No typical price known for this one. Tap the pencil and enter what you paid.'
        }, { sync: false });
        costListEl.appendChild(settingRow(null, unit.name, null, field));
    }

    const c = hardwareCost();
    costSummaryEl.replaceChildren();
    const line = (text) => costSummaryEl.appendChild(h('li', null, text));
    line(c.printer === null ? 'Printer: no price set' : `Printer: ${fmtMoney(c.printer)}${c.estimate ? ' (typical store price)' : ''}`);
    if (c.amsUnits > 0) line(`AMS: ${fmtMoney(c.ams)}${c.amsEstimate ? ' (includes typical store prices)' : ''}${c.amsPriced < c.amsUnits ? ` (${c.amsUnits - c.amsPriced} without a price)` : ''}`);
    line(`Printer and AMS: ${fmtMoney(c.hardware)}`);
    line(`Filament bought: ${fmtMoney(c.filament)}`);
    const total = h('li', 'cost-total');
    total.id = 'cost-total';
    total.textContent = `Total spent on the setup: ${fmtMoney(c.total)}`;
    costSummaryEl.appendChild(total);
}

