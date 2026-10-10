// ---------- Read print time and filament weight from a slicer file ----------
// Handles Bambu / Orca ".gcode.3mf" (a zip with Metadata/slice_info.config) and plain ".gcode"
// (the slicer writes its estimates as comments). Everything happens in the browser; nothing is uploaded.

const HEAD_BYTES = 300 * 1024;
const TAIL_BYTES = 300 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

/** The bytes of a Blob/File (older browsers and test environments may lack Blob.arrayBuffer). */
function blobBuffer(blob) {
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
        reader.readAsArrayBuffer(blob);
    });
}

async function readBytes(blob, start, end) {
    return new Uint8Array(await blobBuffer(blob.slice(start, end)));
}

const decode = (bytes) => new TextDecoder('utf-8').decode(bytes);

async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
        throw new Error('This browser cannot open .3mf files. Export plain G-code from the slicer instead.');
    }
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const reader = stream.readable.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_ENTRY_BYTES) throw new Error('A file inside the 3MF is too large to read.');
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
}

/** Pull named files out of a zip. Returns { name: Uint8Array } for the ones found. Zip64 is not supported. */
export async function readZipEntries(blob, names) {
    const size = blob.size;
    const tail = await readBytes(blob, Math.max(0, size - 65557), size);
    const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
        if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This file is not a valid 3MF (zip) file.');
    const count = tv.getUint16(eocd + 10, true);
    const cdSize = tv.getUint32(eocd + 12, true);
    const cdOffset = tv.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff || cdOffset + cdSize > size) throw new Error('This 3MF file is too large or damaged to read.');

    const cd = await readBytes(blob, cdOffset, cdOffset + cdSize);
    const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
    const found = {};
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        const method = dv.getUint16(p + 10, true);
        const compSize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const localOffset = dv.getUint32(p + 42, true);
        const name = decode(cd.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        const key = wanted.get(name.toLowerCase());
        if (!key || (method !== 0 && method !== 8) || compSize > MAX_ENTRY_BYTES) continue;
        const lh = await readBytes(blob, localOffset, localOffset + 30);
        const lv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
        if (lv.getUint32(0, true) !== 0x04034b50) continue;
        const dataStart = localOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
        const data = await readBytes(blob, dataStart, dataStart + compSize);
        found[key] = method === 0 ? data : await inflateRaw(data);
    }
    return found;
}

// ---------- Parsing ----------

/** "1d 8h 29m 45s" -> minutes (rounded; at least 1 for any time above zero). Returns null if nothing readable. */
export function parseDurationMinutes(text) {
    if (typeof text !== 'string') return null;
    let seconds = 0;
    let any = false;
    for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])\b/gi)) {
        any = true;
        const v = Number(m[1]);
        seconds += v * { d: 86400, h: 3600, m: 60, s: 1 }[m[2].toLowerCase()];
    }
    if (!any || !(seconds > 0)) return null;
    return Math.max(1, Math.round(seconds / 60));
}

const secondsToMinutes = (s) => {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n / 60)) : null;
};

const num = (v) => {
    const n = Number(String(v).trim());
    return Number.isFinite(n) && n >= 0 ? n : null;
};

const firstHex = (v) => {
    const m = typeof v === 'string' ? v.match(/#[0-9a-f]{6}/i) : null;
    return m ? m[0].toLowerCase() : '';
};

/** Value of a "; key = value" (or "; key: value") comment line. */
function commentValue(text, key) {
    const re = new RegExp(`^;\\s*${key}\\s*[=:]\\s*(.*?)\\s*$`, 'im');
    const m = text.match(re);
    return m ? m[1] : null;
}

const cleanValue = (v) => String(v || '').replace(/^"|"$/g, '').trim().slice(0, 60);

/** Print profile bits shared by G-code comments and 3MF settings. All optional. */
function profileFrom(get) {
    const profile = {};
    const name = cleanValue(get('print_settings_id'));
    if (name) profile.name = name;
    const layer = cleanValue(get('layer_height'));
    if (layer && Number.isFinite(Number(layer))) profile.layer = `${Number(layer)} mm`;
    const infill = cleanValue(get('sparse_infill_density') || get('fill_density'));
    if (infill) profile.infill = /%$/.test(infill) ? infill : (Number.isFinite(Number(infill)) ? `${infill}%` : infill);
    const support = cleanValue(get('enable_support') || get('support_material'));
    if (support === '1' || support === 'true') profile.supports = 'yes';
    else if (support === '0' || support === 'false') profile.supports = 'none';
    return profile;
}

/** Read slicer comments from G-code text. */
export function parseGcode(text) {
    const result = { kind: 'G-code', minutes: null, filaments: [], profile: {}, note: '' };

    const total = text.match(/total estimated time:\s*([^;\r\n]+)/i);
    const normal = commentValue(text, 'estimated printing time \\(normal mode\\)');
    const model = text.match(/model printing time:\s*([^;\r\n]+)/i);
    const cura = text.match(/^;TIME:(\d+(?:\.\d+)?)/im);
    result.minutes = (total && parseDurationMinutes(total[1]))
        || (normal && parseDurationMinutes(normal))
        || (model && parseDurationMinutes(model[1]))
        || (cura && secondsToMinutes(cura[1]))
        || null;

    let grams = [];
    const perFilament = commentValue(text, 'filament used \\[g\\]');
    if (perFilament !== null) {
        grams = perFilament.split(/[,;]/).map(num);
    } else {
        const single = commentValue(text, 'total filament (?:used|weight) \\[g\\]');
        if (single !== null) grams = [num(single)];
    }
    const types = (commentValue(text, 'filament_type') || '').split(/[;,]/).map(cleanValue);
    const colours = (commentValue(text, 'filament_colou?r') || '').split(/[;,]/).map(firstHex);
    grams.forEach((g, i) => {
        if (g !== null && g > 0) result.filaments.push({ grams: g, material: types[i] || '', color: colours[i] || '' });
    });

    result.profile = profileFrom((key) => commentValue(text, key));
    return result;
}

/** Read Bambu / Orca slice_info.config (XML) and, when present, project_settings.config (JSON). */
export function parseSliceInfo(xmlText, settingsText = '') {
    const result = { kind: 'Bambu 3MF', minutes: null, filaments: [], profile: {}, note: '' };
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('The slice information in this 3MF could not be read.');
    const plates = Array.from(doc.getElementsByTagName('plate'));
    if (plates.length === 0) throw new Error('This 3MF has no slice results. Slice it first, then export the plate as a .gcode.3mf.');
    const meta = (plate, key) => {
        for (const m of Array.from(plate.getElementsByTagName('metadata'))) {
            if (m.getAttribute('key') === key) return m.getAttribute('value');
        }
        return null;
    };
    const plate = plates.find((p) => secondsToMinutes(meta(p, 'prediction'))) || plates[0];
    result.minutes = secondsToMinutes(meta(plate, 'prediction'));
    for (const f of Array.from(plate.getElementsByTagName('filament'))) {
        const g = num(f.getAttribute('used_g'));
        if (g !== null && g > 0) {
            result.filaments.push({ grams: g, material: cleanValue(f.getAttribute('type')), color: firstHex(f.getAttribute('color')) });
        }
    }
    if (result.filaments.length === 0) {
        const w = num(meta(plate, 'weight'));
        if (w !== null && w > 0) result.filaments.push({ grams: w, material: '', color: '' });
    }
    if (plates.length > 1) result.note = `This file has ${plates.length} plates; the first sliced plate was used.`;

    if (settingsText) {
        try {
            const settings = JSON.parse(settingsText);
            const get = (key) => {
                const v = settings && settings[key];
                return typeof v === 'string' || typeof v === 'number' ? String(v) : (Array.isArray(v) && typeof v[0] === 'string' ? v[0] : '');
            };
            result.profile = profileFrom(get);
        } catch {
            // the profile is optional; ignore a settings file that is not JSON
        }
    }
    return result;
}

/** A print name from a file name: no extension, underscores as spaces. */
export function nameFromFile(fileName) {
    return String(fileName || '')
        .replace(/\.(gcode\.3mf|gcode|gco|3mf|g|txt)$/i, '')
        .replace(/_+/g, ' ')
        .trim()
        .slice(0, 80);
}

/** Read a File. Resolves to { kind, name, minutes, filaments[{grams,material,color}], profile, note } or throws an Error with a plain message. */
export async function readSlicerFile(file) {
    const name = nameFromFile(file.name);
    const head4 = await readBytes(file, 0, 4);
    let info;
    if (head4[0] === 0x50 && head4[1] === 0x4b) {
        const entries = await readZipEntries(file, ['Metadata/slice_info.config', 'Metadata/project_settings.config']);
        const slice = entries['Metadata/slice_info.config'];
        if (!slice) throw new Error('This 3MF has no slice results. Slice it first, then export the plate as a .gcode.3mf.');
        const settings = entries['Metadata/project_settings.config'];
        info = parseSliceInfo(decode(slice), settings ? decode(settings) : '');
    } else {
        if (/^GCDE/.test(String.fromCharCode(...head4)) || /\.bgcode$/i.test(file.name)) {
            throw new Error('Binary G-code (.bgcode) is not supported. Export plain .gcode, or turn off "Binary G-code" in the slicer.');
        }
        let text;
        if (file.size <= HEAD_BYTES + TAIL_BYTES) {
            text = decode(await readBytes(file, 0, file.size));
        } else {
            // Slicers write estimates at the top (Bambu) or the bottom (Prusa, Orca), so read both ends.
            text = decode(await readBytes(file, 0, HEAD_BYTES)) + '\n' + decode(await readBytes(file, file.size - TAIL_BYTES, file.size));
        }
        if (text.includes('\u0000')) throw new Error('This does not look like a G-code or 3MF file.');
        info = parseGcode(text);
    }
    return { ...info, name };
}
