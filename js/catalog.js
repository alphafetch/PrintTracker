// ---------- Printer catalog: brands, models, typical numbers and upkeep sets ----------
//
// Everything here is plain data that was copied from public pages (see `source` fields).
// Nothing is looked up at run time, so the app still works offline. Values that a
// manufacturer does not publish are left out instead of guessed.

export const BRANDS = [
    { key: 'bambu', label: 'Bambu Lab' },
    { key: 'flashforge', label: 'FlashForge' },
    { key: 'elegoo', label: 'ELEGOO' },
    { key: 'other', label: 'Other brand' }
];

/**
 * Per brand, the models and what we know about them.
 *   watts: average power while printing PLA, in watts (only when the maker publishes one)
 *   price: typical US store price in USD (a snapshot, not a promise)
 *   set:   which upkeep set to suggest first
 */
const BAMBU_WATTS_SOURCE = 'Bambu Lab wiki, "Power consumption" (average power in its dynamic PLA test)';
const BAMBU_PRICE_SOURCE = 'US store prices around 9 Oct 2026 (bambuhub.net price tracker)';

export const PRINTERS = {
    bambu: [
        { model: 'A1 mini', set: 'bambu-a1', watts: 80, price: 219 },
        { model: 'A1', set: 'bambu-a1', watts: 95, price: 299 },
        { model: 'A2L', set: 'bambu-a1', price: 469 },
        { model: 'P1P', set: 'bambu-p1x1', watts: 110 },
        { model: 'P1S', set: 'bambu-p1x1', watts: 105, price: 399 },
        { model: 'P2S', set: 'bambu-p1x1', price: 549 },
        { model: 'X1', set: 'bambu-p1x1', watts: 105 },
        { model: 'X1 Carbon', set: 'bambu-p1x1', watts: 105 },
        { model: 'X1E', set: 'bambu-p1x1', watts: 185 },
        { model: 'X2D', set: 'bambu-h2', price: 649 },
        { model: 'H2D', set: 'bambu-h2', watts: 197, price: 1549 },
        { model: 'H2D Pro', set: 'bambu-h2' },
        { model: 'H2S', set: 'bambu-h2', price: 1199 },
        { model: 'H2C', set: 'bambu-h2', price: 2199 },
        { model: 'Other', set: 'bambu-p1x1' }
    ],
    flashforge: [
        { model: 'Adventurer 5M', set: 'flashforge-ad5m' },
        {
            model: 'Adventurer 5M Pro', set: 'flashforge-ad5m',
            wattsHint: 'FlashForge lists 350 W as the rated power. That is a ceiling, not an average.'
        },
        { model: 'Adventurer 5X', set: 'flashforge-ad5m' },
        { model: 'Other', set: 'flashforge-ad5m' }
    ],
    elegoo: [
        { model: 'Centauri Carbon', set: 'elegoo-cc' },
        { model: 'Centauri Carbon 2', set: 'elegoo-cc' },
        { model: 'Centauri', set: 'elegoo-cc' },
        { model: 'Neptune 4', set: 'elegoo-cc' },
        { model: 'Neptune 4 Pro', set: 'elegoo-cc' },
        { model: 'Neptune 4 Plus', set: 'elegoo-cc' },
        { model: 'Neptune 4 Max', set: 'elegoo-cc' },
        { model: 'Other', set: 'elegoo-cc' }
    ],
    other: []
};

export const WATTS_SOURCE = {
    bambu: { text: BAMBU_WATTS_SOURCE, url: 'https://wiki.bambulab.com/en/general/power-consumption' }
};
export const PRICE_SOURCE = {
    bambu: { text: BAMBU_PRICE_SOURCE, url: 'https://bambuhub.net/bambu-price-tracking' }
};

/** Typical household electricity prices, per kWh, for currencies where we have a number. */
export const KWH_DEFAULTS = {
    '$': {
        value: 0.182,
        note: 'US average residential price in 2026 (EIA Short-Term Energy Outlook, Oct 2026)',
        url: 'https://www.eia.gov/outlooks/steo/report/elec_coal_renew.php'
    },
    '£': {
        value: 0.2632,
        note: 'UK price cap average, 1 Oct to 31 Dec 2026, before VAT (Ofgem)',
        url: 'https://ofgem.gov.uk/news/changes-energy-price-cap-between-1-october-and-31-december-2026'
    }
};

export function modelsFor(brand) {
    return Object.prototype.hasOwnProperty.call(PRINTERS, brand) ? PRINTERS[brand] : [];
}

export function findPrinter(brand, model) {
    return modelsFor(brand).find((p) => p.model === model) || null;
}

/** Bambu models were saved without a brand before FlashForge and ELEGOO existed. */
export function brandOfLegacyModel(model) {
    return findPrinter('bambu', model) ? 'bambu' : '';
}

/** Automatic average watts for a printer, or null. */
export function autoWatts(brand, model) {
    const p = findPrinter(brand, model);
    return p && Number.isFinite(p.watts) ? { value: p.watts, note: BAMBU_WATTS_SOURCE, url: WATTS_SOURCE.bambu.url } : null;
}

/** Hint text when a maker publishes only a rated (maximum) wattage. */
export function wattsHint(brand, model) {
    const p = findPrinter(brand, model);
    return p && p.wattsHint ? p.wattsHint : '';
}

/** Automatic price (USD only) for a printer, or null. */
export function autoPrice(brand, model, currency) {
    const p = findPrinter(brand, model);
    if (!p || !Number.isFinite(p.price) || currency !== '$') return null;
    return { value: p.price, note: BAMBU_PRICE_SOURCE, url: PRICE_SOURCE.bambu.url };
}

export function autoKwh(currency) {
    return Object.prototype.hasOwnProperty.call(KWH_DEFAULTS, currency) ? KWH_DEFAULTS[currency] : null;
}

// ---------- Upkeep sets ----------
//
// Units: 'hours' (print hours), 'days', 'prints', 'spools' (1 spool = 1 kg of filament printed,
// the same idea as the "rolls" in Bambu's docs).
// src: 'official' means the manufacturer's own page gives that interval (months are 30 days).
//      'suggested' means the maker gives no interval; it is a starting point to adjust.

export const MAINT_SETS = [
    {
        key: 'bambu-a1',
        label: 'Bambu Lab A1 series',
        source: { text: 'Bambu Lab wiki: A1 basic maintenance', url: 'https://wiki.bambulab.com/en/a1/maintenance/basic-maintenance' },
        items: [
            { name: 'Clean and oil the X rail', unit: 'days', every: 30, src: 'official' },
            { name: 'Clean and oil the Y rail', unit: 'days', every: 30, src: 'official' },
            { name: 'Grease the Z lead screw', unit: 'days', every: 90, src: 'official' },
            { name: 'Oil the X and Y idler pulleys', unit: 'days', every: 90, src: 'official' },
            { name: 'Clean the hotend heating assembly', unit: 'days', every: 30, src: 'official' },
            { name: 'Clean the part-cooling and hotend fans', unit: 'days', every: 7, src: 'official' },
            { name: 'Check the filament cutter blade', unit: 'spools', every: 3, src: 'official' },
            { name: 'Replace the PTFE tube', unit: 'spools', every: 6, src: 'official' }
        ]
    },
    {
        key: 'bambu-p1x1',
        label: 'Bambu Lab P1 / P2 / X1 series',
        source: { text: 'Bambu Lab wiki: X1 basic maintenance', url: 'https://wiki.bambulab.com/en/x1/maintenance/basic-maintenance' },
        items: [
            { name: 'Check the X-axis carbon rods for dust', unit: 'days', every: 30, src: 'official' },
            { name: 'Grease the Z lead screws', unit: 'days', every: 90, src: 'official' },
            { name: 'Check and clean the Y and Z linear rods', unit: 'days', every: 30, src: 'official' },
            { name: 'Anti-rust treatment on the Y and Z rods', unit: 'days', every: 90, src: 'official' },
            { name: 'Check and clean the extruder gear', unit: 'days', every: 7, src: 'official' },
            { name: 'Check the cooling fans for debris', unit: 'days', every: 7, src: 'official' },
            { name: 'Check the filament cutter blade', unit: 'spools', every: 3, src: 'official' },
            { name: 'Check the PTFE tube', unit: 'spools', every: 10, src: 'official' }
        ]
    },
    {
        key: 'bambu-h2',
        label: 'Bambu Lab H2 series',
        source: { text: 'Bambu Lab wiki: H2 X-axis lubrication', url: 'https://wiki.bambulab.com/en/h2/maintenance/x-axis-lubrication' },
        items: [
            { name: 'Clean and lubricate the X-axis rail', unit: 'days', every: 30, src: 'official' },
            { name: 'Clean and lubricate the Y-axis rods', unit: 'days', every: 90, src: 'official' },
            { name: 'Check and lubricate the Z lead screws', unit: 'days', every: 90, src: 'official' }
        ]
    },
    {
        key: 'flashforge-ad5m',
        label: 'FlashForge Adventurer 5M series',
        source: { text: 'FlashForge: how to clean your Adventurer 5M', url: 'https://uk.flashforge.com/blogs/news/how-to-clean-your-3d-printer-flashforge-adventurer-5m' },
        items: [
            { name: 'Clear debris out of the chamber', unit: 'prints', every: 5, src: 'official' },
            { name: 'Wipe the X, Y and Z linear shafts', unit: 'hours', every: 1000, src: 'official' },
            { name: 'Lubricate the rails and Z lead screw', unit: 'days', every: 90, src: 'suggested' },
            { name: 'Wash the build plate', unit: 'prints', every: 10, src: 'suggested' },
            { name: 'Brush residue off the nozzle', unit: 'prints', every: 10, src: 'suggested' },
            { name: 'Replace the HEPA filter', unit: 'days', every: 90, src: 'suggested' }
        ]
    },
    {
        key: 'elegoo-cc',
        label: 'ELEGOO printers',
        source: { text: 'ELEGOO wiki (gives no intervals)', url: 'https://wiki.elegoo.com/Centauri-carbon' },
        items: [
            { name: 'Wipe dust off the printer body', unit: 'days', every: 30, src: 'suggested' },
            { name: 'Clean filament residue off the nozzle', unit: 'prints', every: 10, src: 'suggested' },
            { name: 'Wash the build plate', unit: 'prints', every: 10, src: 'suggested' },
            { name: 'Lubricate the linear rails and lead screw', unit: 'days', every: 90, src: 'suggested' }
        ]
    }
];

export function findSet(key) {
    return MAINT_SETS.find((s) => s.key === key) || null;
}

/** The upkeep set to show first for the printer in Settings. */
export function defaultSetFor(brand, model) {
    const p = findPrinter(brand, model);
    if (p) return p.set;
    if (brand === 'bambu') return 'bambu-p1x1';
    if (brand === 'flashforge') return 'flashforge-ad5m';
    if (brand === 'elegoo') return 'elegoo-cc';
    return MAINT_SETS[0].key;
}

/**
 * Bambu Lab AMS units and how many spools each holds.
 * price: US store price in USD where Bambu's own store page shows one (AMS and AMS lite pages show none).
 */
export const AMS_TYPES = [
    { key: 'ams', label: 'AMS', slots: 4 },
    { key: 'ams-lite', label: 'AMS lite', slots: 4 },
    { key: 'ams-2-pro', label: 'AMS 2 Pro', slots: 4, price: 359, url: 'https://us.store.bambulab.com/products/ams-2-pro' },
    { key: 'ams-ht', label: 'AMS HT', slots: 1, price: 149, url: 'https://us.store.bambulab.com/products/ams-ht' }
];

/** Automatic price for an AMS unit type (USD only), or null. */
export function autoAmsPrice(type, currency) {
    const t = AMS_TYPES.find((x) => x.key === type);
    if (!t || !Number.isFinite(t.price) || currency !== '$') return null;
    return { value: t.price, note: `Bambu Lab US store price for the ${t.label}`, url: t.url };
}

// ---------- Material guide ----------
//
// Copied from Bambu Lab's own wiki (see MATERIAL_SOURCES). These are Bambu's numbers for Bambu filament;
// other brands differ, and the label on your spool wins. Materials the wiki does not cover are left out.

export const MATERIAL_GUIDE = [
    { key: 'pla', label: 'PLA', nozzle: '190-240', bed: '45-65', oven: '55 °C, 8 h', heatbed: '65-75 °C, 12 h', ovenC: 55, ovenH: 8, enclosure: 'Open or enclosed', ams: true, dry: 'Recommended' },
    { key: 'petg', label: 'PETG', nozzle: '240-270', bed: '60-80', oven: '70 °C, 8 h', heatbed: '75-85 °C, 12 h', ovenC: 70, ovenH: 8, enclosure: 'Enclosed preferred', ams: true, dry: 'Recommended' },
    { key: 'abs', label: 'ABS', nozzle: '240-280', bed: '90-100', oven: '80 °C, 8 h', heatbed: '90-100 °C, 12 h', ovenC: 80, ovenH: 8, enclosure: 'Enclosed recommended', ams: true, dry: 'Recommended' },
    { key: 'asa', label: 'ASA', nozzle: '240-280', bed: '90-100', oven: '80 °C, 8 h', heatbed: '90-100 °C, 12 h', ovenC: 80, ovenH: 8, enclosure: 'Enclosed recommended', ams: true, dry: 'Recommended' },
    { key: 'tpu', label: 'TPU', nozzle: '200-250', bed: '35-45', oven: '70 °C, 8 h', heatbed: '80-90 °C, 12 h', ovenC: 70, ovenH: 8, enclosure: 'Open or enclosed', ams: false, dry: 'Required' }
];

export const MATERIAL_SOURCES = [
    { text: 'Bambu Lab wiki: filament guide material table', url: 'https://wiki.bambulab.com/en/general/filament-guide-material-table' },
    { text: 'Bambu Lab wiki: drying filament on the heatbed', url: 'https://wiki.bambulab.com/en/general/bambu-filament-drying-cover' }
];

export function findMaterial(key) {
    return MATERIAL_GUIDE.find((m) => m.key === String(key).toLowerCase()) || null;
}

/** One sentence of drying advice for a material, or '' when the guide has none. */
export function dryingAdvice(key) {
    const m = findMaterial(key);
    return m ? `Bambu Lab suggests drying ${m.label} at ${m.ovenC} °C for ${m.ovenH} h in a drying oven.` : '';
}
