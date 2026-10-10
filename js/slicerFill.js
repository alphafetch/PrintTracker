import { activeSpools } from './calc.js';
import { SIMILAR } from './colors.js';
import { addFilamentRow, hoursInput, minutesInput, nameInput, profileInputs, rowList, updateRowControls } from './printPopup.js';
import { readSlicerFile } from './slicerFile.js';
import { $, colorDistance, fmtDuration, fmtGrams, isHex, spoolHex } from './util.js';

// ---------- "Fill from slicer file" button in the print popup ----------

const fileInput = $('slicer-file');
const fileButton = $('slicer-file-button');
const noteEl = $('slicer-note');

function showNote(text, isError = false) {
    noteEl.textContent = text;
    noteEl.hidden = text === '';
    noteEl.classList.toggle('error-text', isError);
    noteEl.classList.toggle('secondary-text', !isError);
}

/** How far apart (delta E) a slicer colour and a spool colour may be and still count as a match.
 * Slicer colours are exact, spool swatches are often rough guesses from the colour name, so this is lenient
 * when the material also matches and strict when it is unknown. */
const MATCH_WITH_MATERIAL = 35;

/** The spool that best matches a filament (same material, close colour), not already taken. */
export function matchSpool(filament, taken) {
    if (!isHex(filament.color)) return null;
    const material = String(filament.material || '').toLowerCase().split(/[-+ ]/)[0];
    let best = null;
    let bestDistance = Infinity;
    for (const [id, spool] of activeSpools()) {
        if (taken.has(id)) continue;
        if (material && String(spool.material || '').toLowerCase() !== material) continue;
        const d = colorDistance(filament.color, spoolHex(spool));
        if (d < bestDistance) { best = id; bestDistance = d; }
    }
    return bestDistance <= (material ? MATCH_WITH_MATERIAL : SIMILAR) ? best : null;
}

/** Put what the file said into the print form. Returns the sentence shown to the person. */
export function applySlicerInfo(info) {
    const bits = [];
    if (!nameInput.value.trim() && info.name) nameInput.value = info.name;
    if (info.minutes) {
        hoursInput.value = String(Math.floor(info.minutes / 60));
        minutesInput.value = String(info.minutes % 60);
        bits.push(fmtDuration(info.minutes));
    }
    let guessed = 0;
    if (info.filaments.length > 0) {
        const limit = activeSpools().length;
        const used = info.filaments.slice(0, limit);
        rowList.replaceChildren();
        const taken = new Set();
        for (const f of used) {
            const matched = matchSpool(f, taken);
            if (!matched) guessed++;
            addFilamentRow({ spoolId: matched || null, grams: String(Math.round(f.grams * 10) / 10) });
            const rows = rowList.querySelectorAll('.filament-row');
            taken.add(rows[rows.length - 1].querySelector('select').value);
        }
        updateRowControls();
        bits.push(used.map((f) => `${fmtGrams(f.grams)}g`).join(' + '));
        if (info.filaments.length > used.length) bits.push(`${info.filaments.length - used.length} more filament(s) skipped: not enough spools`);
    }
    for (const [key, value] of Object.entries(info.profile || {})) {
        if (profileInputs[key] && profileInputs[key].value.trim() === '') profileInputs[key].value = value;
    }
    if (bits.length === 0) return 'No print time or filament weight was found in this file. Fill them in by hand.';
    let text = `Read from the ${info.kind}: ${bits.join(', ')}.`;
    if (info.filaments.length > 0) text += guessed > 0 ? ' Check which spool each row uses.' : ' Spools were matched by material and colour.';
    if (info.note) text += ` ${info.note}`;
    return text;
}

fileButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    showNote(`Reading ${file.name}...`);
    try {
        const info = await readSlicerFile(file);
        const text = applySlicerInfo(info);
        showNote(text, !info.minutes && info.filaments.length === 0);
    } catch (error) {
        showNote(error && error.message ? error.message : 'Could not read this file.', true);
    }
});
