import { DEFAULT_SWATCH, KNOWN_MATERIALS } from './constants.js';
import { updateBodyLock } from './printPopup.js';
import { renderAll } from './render.js';
import { saveState, state } from './state.js';
import { $, clearError, guessHex, isHex, isValidDate, showError, spoolHex, todayLocal, uid } from './util.js';

// ---------- Spool popup ----------

export const spoolPopup = $('filament-add-popup');
export const brandInput = $('brand-tinput');
export const materialDropdown = $('material-dropdown');
export const colorInput = $('color-tinput');
export const hexInput = $('hex-input');
export const gramsInput = $('grams-ninput');
export const priceInput = $('price-ninput');
export const spoolDateInput = $('date-dinput');
export const driedInput = $('dried-dinput');
export const spoolError = $('spool-error');

export let hexTouched = false;   // true once the person picks a swatch color by hand
let spoolReturn = null;   // what had focus before the popup opened
export let editingSpoolId = null; // null means "add a new spool"
let startColor = '';              // the color text the popup opened with
let startHex = '';                // and the swatch that went with it
let startExplicit = '';           // the opened spool's own saved swatch ('' if none)

export function openSpoolPopup({ copyFromId = null, editId = null } = {}) {
    const editing = editId ? state.spools[editId] : null;
    const source = editing || (copyFromId ? state.spools[copyFromId] : null);
    editingSpoolId = editing ? editId : null;
    $('spool-popup-title').textContent = editing ? 'Edit Spool' : 'Add Spool';
    $('add-spool-button').textContent = editing ? 'Save Changes' : 'Add Spool';

    brandInput.value = source ? source.brand : '';
    materialDropdown.value = source && KNOWN_MATERIALS.includes(String(source.material).toLowerCase())
        ? String(source.material).toLowerCase()
        : (source ? 'other' : state.settings.defaultMaterial);
    colorInput.value = source ? source.color : '';
    hexInput.value = source ? spoolHex(source) : DEFAULT_SWATCH;
    // The swatch follows the color name until you pick one by hand, so "Buy again" with a new color gets a new swatch.
    hexTouched = false;
    startColor = colorInput.value.trim().toLowerCase();
    startHex = hexInput.value;
    startExplicit = source && isHex(source.hex) ? source.hex.toLowerCase() : '';
    gramsInput.value = source ? String(source.startGrams)
        : (state.settings.defaultSpoolGrams > 0 ? String(state.settings.defaultSpoolGrams) : '');
    priceInput.value = source && Number.isFinite(source.price) ? String(source.price) : '';
    spoolDateInput.value = editing && isValidDate(editing.date) ? editing.date : todayLocal();
    driedInput.value = editing && isValidDate(editing.driedDate) ? editing.driedDate : '';
    clearError(spoolError);
    spoolReturn = document.activeElement;
    spoolPopup.style.display = 'block';
    spoolPopup.scrollTop = 0;
    updateBodyLock();
    (source ? gramsInput : brandInput).focus();
}

export function closeSpoolPopup() {
    editingSpoolId = null;
    spoolPopup.style.display = 'none';
    if (spoolReturn && typeof spoolReturn.focus === 'function' && document.contains(spoolReturn)) spoolReturn.focus();
    spoolReturn = null;
    updateBodyLock();
}

colorInput.addEventListener('input', () => {
    if (hexTouched) return;
    const text = colorInput.value.trim().toLowerCase();
    hexInput.value = text === startColor && startColor !== '' ? startHex : (guessHex(colorInput.value) || DEFAULT_SWATCH);
});
hexInput.addEventListener('input', () => { hexTouched = true; });

export function saveSpool() {
    const brand = brandInput.value.trim();
    const color = colorInput.value.trim();
    const grams = gramsInput.valueAsNumber;
    const hasPriceText = priceInput.value.trim() !== '';
    const price = priceInput.valueAsNumber;

    if (brand === '') return showError(spoolError, 'Enter a brand.');
    if (color === '') return showError(spoolError, 'Enter a color.');
    if (!Number.isFinite(grams) || grams <= 0) return showError(spoolError, 'Enter the spool weight in grams (above 0).');
    if (hasPriceText && (!Number.isFinite(price) || price < 0)) return showError(spoolError, 'The price must be 0 or more, or left empty.');
    if (!isValidDate(spoolDateInput.value)) return showError(spoolError, 'Pick a valid date.');
    if (driedInput.value !== '' && !isValidDate(driedInput.value)) return showError(spoolError, 'Pick a valid "last dried" date, or clear it.');

    // Swatch: a hand-picked color wins; else keep the opened spool's own color if the name did not change;
    // else guess from the name.
    const picked = isHex(hexInput.value) ? hexInput.value.toLowerCase() : '';
    const hex = hexTouched ? picked
        : (color.toLowerCase() === startColor ? startExplicit : (guessHex(color) || ''));
    const id = editingSpoolId && state.spools[editingSpoolId] ? editingSpoolId : uid();
    const wasArchived = Boolean(editingSpoolId && state.spools[id] && state.spools[id].archived);
    state.spools[id] = {
        brand,
        material: materialDropdown.value,
        color,
        hex,
        startGrams: grams,
        price: hasPriceText ? price : null,
        date: spoolDateInput.value,
        driedDate: driedInput.value,
        archived: wasArchived
    };

    saveState();
    closeSpoolPopup();
    renderAll();
    return true;
}

$('add-spool-button').addEventListener('click', saveSpool);
$('cancel-spool-button').addEventListener('click', closeSpoolPopup);
