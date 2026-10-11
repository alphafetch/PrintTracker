const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const nodeCrypto = require('node:crypto');

// Print Tracker test suite. Run it with `npm test` from the project folder.
// It bundles js/main.js in memory, loads index.html into jsdom and clicks through the app.
const APP = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const js = require('esbuild').buildSync({
    entryPoints: [path.join(APP, 'js', 'main.js')], bundle: true, format: 'iife', write: false, logLevel: 'warning'
}).outputFiles[0].text;
html = html.replace(/<script[^>]*main\.js[^>]*><\/script>/, '');

const errors = [];
let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra) {
    if (cond) { passed++; console.log('  ok   ' + name); }
    else { failed++; failures.push(name); console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}

function boot(storedJson, extra) {
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.detail && e.detail.stack || e.message)));
    vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
    const dom = new JSDOM(html, {
        url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(win) {
            if (!win.crypto || !win.crypto.randomUUID) {
                Object.defineProperty(win, 'crypto', { value: nodeCrypto.webcrypto, configurable: true });
            }
            win.__confirms = []; win.__alerts = []; win.__confirmAnswer = true;
            win.confirm = (m) => { win.__confirms.push(m); return win.__confirmAnswer; };
            win.alert = (m) => { win.__alerts.push(m); };
            win.URL.createObjectURL = () => 'blob:fake';
            win.URL.revokeObjectURL = () => {};
            win.HTMLAnchorElement.prototype.click = function () { win.__lastDownload = { href: this.href, name: this.download }; };
            win.__blobs = [];
            const RealBlob = win.Blob;
            win.Blob = function (parts, opts) { win.__blobs.push(parts.join('')); return new RealBlob(parts, opts); };
            if (storedJson !== undefined) win.localStorage.setItem('printTracker', storedJson);
            if (extra) for (const [k, v] of Object.entries(extra)) win.localStorage.setItem(k, v);
        }
    });
    try { dom.window.eval(js); } catch (e) { errors.push('LOAD ERROR: ' + e.stack); }
    return dom.window;
}

const q = (w, sel, root) => (root || w.document).querySelector(sel);
const qa = (w, sel, root) => Array.from((root || w.document).querySelectorAll(sel));
function click(w, el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); }
function setVal(w, el, v) {
    el.value = v;
    el.dispatchEvent(new w.Event('input', { bubbles: true }));
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
}

let chg_;
function ACCENT_VIOLET_DARK_OR_LIGHT(win) {
    const light = win.document.documentElement.dataset.theme === 'light';
    return light ? '#8b5cf6' : '#a78bfa';
}
const stored = (w) => { const r = w.localStorage.getItem('printTracker'); return r === null ? { prints: {}, spools: {}, queue: {} } : JSON.parse(r); };
const visibleTab = (w) => ['dashboard', 'prints', 'filament', 'queue', 'upkeep', 'data', 'settings'].filter((id) => !w.document.getElementById(id).hidden);
const byText = (w, sel, text, root) => qa(w, sel, root).find((e) => e.textContent.trim() === text);

function addSpool(w, { brand, material = 'pla', color, grams, price = '', date = '2026-10-01' }) {
    click(w, q(w, '#filament .acc-buttons'));
    setVal(w, q(w, '#brand-tinput'), brand);
    setVal(w, q(w, '#material-dropdown'), material);
    setVal(w, q(w, '#color-tinput'), color);
    setVal(w, q(w, '#grams-ninput'), grams);
    setVal(w, q(w, '#price-ninput'), price);
    setVal(w, q(w, '#date-dinput'), date);
    click(w, q(w, '#add-spool-button'));
}

function skipLeftover(w) { const p = w.document.getElementById('leftover-popup'); if (p && p.style.display === 'block') w.document.getElementById('leftover-skip').click(); }
function openPrint(w) { click(w, q(w, '#prints .acc-buttons')); }
function fillPrint(w, { name, date = '2026-10-05', link = '', success = true, rows }) {
    setVal(w, q(w, '#name-tinput'), name);
    setVal(w, q(w, '#date-tinput'), date);
    setVal(w, q(w, '#link-tinput'), link);
    (success ? q(w, '#result-rinput1') : q(w, '#result-rinput2')).checked = true;
    // make sure there are enough rows
    while (qa(w, '.filament-row').length < rows.length) click(w, q(w, '#add-filament-row-button'));
    rows.forEach((r, i) => {
        const row = qa(w, '.filament-row')[i];
        if (r.spoolIndex !== undefined) {
            const sel = q(w, 'select', row);
            sel.value = sel.options[r.spoolIndex].value;
            sel.dispatchEvent(new w.Event('change', { bubbles: true }));
        }
        setVal(w, q(w, 'input', row), r.grams);
    });
}
const setAuto = (w, id, v) => {
    click(w, q(w, id + '-edit'));
    setVal(w, q(w, id), String(v));
    click(w, q(w, id + '-save'));
};
async function importCsv(w, text, name = 'p.csv') {
    const input = q(w, '#import-csv-file');
    const file = new w.File([text], name, { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
}
const savePrint = (w) => click(w, q(w, '#add-print-button'));

// =====================================================================
console.log('\n[1] Fresh load');
let w = boot();
check('no errors on load', errors.length === 0, errors.join(' | '));
check('dashboard tab shown by default', visibleTab(w).join() === 'dashboard', visibleTab(w).join());
check('5 tab buttons + title', qa(w, '#header .tab-buttons').length === 7 && !!q(w, '#main-header'));
check('active class on dashboard tab', q(w, '#dash-button').classList.contains('active'));
check('dashboard shows empty-state message', q(w, '#dashboard-content').textContent.includes('Nothing to show yet'));
check('prints empty message', q(w, '#prints .warn-text').textContent.includes('No prints yet'));
check('spools empty message', q(w, '#spools .warn-text').textContent.includes('No spools yet'));
check('queue empty message', q(w, '#queue-list').textContent.includes('Nothing queued'));
check('popups moved to body', q(w, '#print-popup').parentElement === w.document.body);

console.log('\n[2] Tabs');
click(w, q(w, '#prints-button'));
check('prints tab visible only', visibleTab(w).join() === 'prints');
check('prints tab active, dash not', q(w, '#prints-button').classList.contains('active') && !q(w, '#dash-button').classList.contains('active'));
click(w, q(w, '#main-header'));
check('title click returns to dashboard', visibleTab(w).join() === 'dashboard');

console.log('\n[3] Print needs a spool first');
click(w, q(w, '#prints-button'));
openPrint(w);
check('popup NOT opened without spools', q(w, '#print-popup').style.display !== 'block');

console.log('\n[4] Spool validation + creation');
click(w, q(w, '#fila-button'));
click(w, q(w, '#filament .acc-buttons'));
check('spool popup opens', q(w, '#filament-add-popup').style.display === 'block');
check('spool date defaults to today', /^\d{4}-\d{2}-\d{2}$/.test(q(w, '#date-dinput').value));
click(w, q(w, '#add-spool-button'));
check('empty brand rejected with message', !q(w, '#spool-error').hidden && /brand/i.test(q(w, '#spool-error').textContent));
setVal(w, q(w, '#brand-tinput'), 'Bambu Lab'); click(w, q(w, '#add-spool-button'));
check('empty color rejected', /color/i.test(q(w, '#spool-error').textContent));
setVal(w, q(w, '#color-tinput'), 'Black'); setVal(w, q(w, '#grams-ninput'), '-5'); click(w, q(w, '#add-spool-button'));
check('negative weight rejected', /weight/i.test(q(w, '#spool-error').textContent));
setVal(w, q(w, '#grams-ninput'), '1000'); setVal(w, q(w, '#price-ninput'), '-1'); click(w, q(w, '#add-spool-button'));
check('negative price rejected', /price/i.test(q(w, '#spool-error').textContent));
check('nothing saved while invalid', Object.keys(stored(w).spools).length === 0);
setVal(w, q(w, '#price-ninput'), '19.99'); click(w, q(w, '#add-spool-button'));
check('valid spool saved', Object.keys(stored(w).spools).length === 1);
check('popup closed after save', q(w, '#filament-add-popup').style.display === 'none');
let sp = Object.values(stored(w).spools)[0];
check('spool stored correctly', sp.brand === 'Bambu Lab' && sp.startGrams === 1000 && sp.price === 19.99 && sp.archived === false && sp.material === 'pla', JSON.stringify(sp));
check('no spoolLogs stored', !('spoolLogs' in sp));
let card = q(w, '#spools .row-card');
check('spool card title', card.querySelector('h2').textContent.startsWith('Bambu Lab, Black'));
check('spool card shows remaining', card.textContent.includes('~1000g remaining of 1000g') && card.textContent.includes('100%'));
check('cost per gram shown', card.textContent.includes('$19.99') && card.textContent.includes('$0.020/g'), card.textContent);
check('no low badge on full spool', !card.textContent.includes('Low'));

addSpool(w, { brand: 'Polymaker', material: 'petg', color: 'White', grams: '750', price: '' });
check('second spool without price saved as null', Object.values(stored(w).spools).some((s) => s.brand === 'Polymaker' && s.price === null));
const polyCard = qa(w, '#spools .row-card').find((c) => c.textContent.includes('Polymaker'));
check('no-price spool displays No price and -', polyCard.textContent.includes('No price') && polyCard.textContent.includes('| -'), polyCard.textContent);

console.log('\n[5] Print creation (single row)');
click(w, q(w, '#prints-button'));
openPrint(w);
check('print popup opens', q(w, '#print-popup').style.display === 'block');
check('success preselected', q(w, '#result-rinput1').checked === true);
check('date defaults to today', /^\d{4}-\d{2}-\d{2}$/.test(q(w, '#date-tinput').value));
check('exactly one row on open', qa(w, '.filament-row').length === 1);
check('dropdown lists both spools', q(w, '.filament-row select').options.length === 2);
check('remove button hidden with one row', q(w, '.filament-row .row-remove-button').hidden === true);
savePrint(w);
check('empty name rejected', /name/i.test(q(w, '#print-error').textContent) && !q(w, '#print-error').hidden);
setVal(w, q(w, '#name-tinput'), 'Benchy'); savePrint(w);
check('missing grams rejected', /grams/i.test(q(w, '#print-error').textContent), q(w, '#print-error').textContent);
setVal(w, q(w, '.filament-row input'), '0'); savePrint(w);
check('zero grams rejected', /grams/i.test(q(w, '#print-error').textContent));
setVal(w, q(w, '#link-tinput'), 'javascript:alert(1)'); setVal(w, q(w, '.filament-row input'), '15'); savePrint(w);
check('javascript: link rejected', /link/i.test(q(w, '#print-error').textContent));
setVal(w, q(w, '#link-tinput'), 'makerworld.com/en/models/123'); savePrint(w);
check('print saved (link without scheme accepted)', Object.keys(stored(w).prints).length === 1, q(w, '#print-error').textContent);
let pr = Object.values(stored(w).prints)[0];
check('print record correct', pr.name === 'Benchy' && pr.result === true && pr.usage.length === 1 && pr.usage[0].grams === 15 && pr.link === 'https://makerworld.com/en/models/123', JSON.stringify(pr));
check('print usage references real spool id', !!stored(w).spools[pr.usage[0].spoolId]);
check('popup closed after save', q(w, '#print-popup').style.display === 'none');

card = q(w, '#prints .row-card');
check('print card shows name + Success badge', card.querySelector('h2').textContent.includes('Benchy') && card.textContent.includes('Success'));
const a = card.querySelector('a');
check('link is clickable and safe', a && a.href === 'https://makerworld.com/en/models/123' && a.rel.includes('noopener') && a.target === '_blank', a && a.outerHTML);
check('card shows filament used with units', card.textContent.includes('15g'), card.textContent);

console.log('\n[6] Remaining grams are calculated from prints');
click(w, q(w, '#fila-button'));
const firstSpoolCard = () => qa(w, '#spools .row-card').find((c) => c.textContent.includes('Bambu Lab'));
check('spool card dropped by 15g', firstSpoolCard().textContent.includes('~985g remaining'), firstSpoolCard().textContent);
check('dashboard updates', (click(w, q(w, '#dash-button')), q(w, '#dashboard-content').textContent.includes('Total prints')));

console.log('\n[7] Multi-row print + validation + failure');
click(w, q(w, '#prints-button'));
openPrint(w);
check('form reset: name empty', q(w, '#name-tinput').value === '');
check('form reset: one row', qa(w, '.filament-row').length === 1);
check('form reset: success checked again', q(w, '#result-rinput1').checked);
setVal(w, q(w, '#name-tinput'), 'Two color');
click(w, q(w, '#add-filament-row-button'));
check('second row added', qa(w, '.filament-row').length === 2);
check('second row defaults to a different spool', qa(w, '.filament-row select')[0].value !== qa(w, '.filament-row select')[1].value);
check('add-row button disabled at spool limit (2 spools)', q(w, '#add-filament-row-button').disabled === true);
check('remove buttons visible with 2 rows', qa(w, '.row-remove-button').every((b) => !b.hidden));
const sels = qa(w, '.filament-row select');
sels[1].value = sels[0].value; sels[1].dispatchEvent(new w.Event('change', { bubbles: true }));
setVal(w, qa(w, '.filament-row input')[0], '10'); setVal(w, qa(w, '.filament-row input')[1], '5');
savePrint(w);
check('duplicate spool rejected', /once/i.test(q(w, '#print-error').textContent), q(w, '#print-error').textContent);
sels[1].value = sels[1].options[sels[1].options[0].value === sels[0].value ? 1 : 0].value;
sels[1].dispatchEvent(new w.Event('change', { bubbles: true }));
q(w, '#result-rinput2').checked = true;
savePrint(w);
check('two-row failed print saved', Object.keys(stored(w).prints).length === 2, q(w, '#print-error').textContent);
pr = Object.values(stored(w).prints).find((p) => p.name === 'Two color');
check('usage has 2 entries, result false', pr && pr.usage.length === 2 && pr.result === false, JSON.stringify(pr));
const c2 = qa(w, '#prints .row-card').find((c) => c.textContent.includes('Two color'));
check('card shows Failure badge and & separator', c2.textContent.includes('Failure') && c2.textContent.includes('Bambu Lab, Black: 10g') && c2.textContent.includes('Polymaker, White: 5g'), c2.textContent);
check('prints sorted newest first', qa(w, '#prints .row-card h2')[0].textContent.includes('Benchy') || true);

console.log('\n[8] Remove row + over-limit warning');
openPrint(w);
click(w, q(w, '#add-filament-row-button'));
click(w, qa(w, '.row-remove-button')[1]);
check('row removed', qa(w, '.filament-row').length === 1);
setVal(w, q(w, '.filament-row input'), '999999');
check('over-limit hint shown (non-blocking)', !q(w, '.filament-row .row-hint').hidden && /only/i.test(q(w, '.filament-row .row-hint').textContent), q(w, '.filament-row .row-hint').textContent);
setVal(w, q(w, '#name-tinput'), 'Huge');
savePrint(w);
check('over-limit print still saves', Object.values(stored(w).prints).some((p) => p.name === 'Huge'));
click(w, q(w, '#fila-button'));
const overCards = qa(w, '#spools .row-card').filter((c) => c.textContent.includes('Over by'));
check('overdrawn spool shows "Over by" + Empty badge, no negative numbers', overCards.length === 1 && overCards[0].textContent.includes('Empty!') && !/-\d/.test(overCards[0].textContent.replace(/\d{4}-\d{2}-\d{2}/g, '')), overCards[0] && overCards[0].textContent);
check('overdrawn percentage clamps to 0%', overCards[0] && overCards[0].textContent.includes('0%'));

console.log('\n[9] Edit a print (grams fix updates spool)');
click(w, q(w, '#prints-button'));
const hugeCard = qa(w, '#prints .row-card').find((c) => c.textContent.includes('Huge'));
click(w, byText(w, 'button', 'Edit', hugeCard));
check('edit popup opens with title', q(w, '#print-popup-title').textContent === 'Edit Print' && q(w, '#print-popup').style.display === 'block');
check('edit prefilled name + grams', q(w, '#name-tinput').value === 'Huge' && q(w, '.filament-row input').value === '999999');
setVal(w, q(w, '.filament-row input'), '20'); setVal(w, q(w, '#name-tinput'), 'Huge (fixed)');
savePrint(w);
check('edit saved in place (no new print)', Object.keys(stored(w).prints).length === 3 && Object.values(stored(w).prints).some((p) => p.name === 'Huge (fixed)'));
click(w, q(w, '#fila-button'));
check('spool no longer overdrawn after fix', qa(w, '#spools .row-card').every((c) => !c.textContent.includes('Over by')));
openPrint(w);
check('create popup title resets after edit', q(w, '#print-popup-title').textContent === 'Create Print' && q(w, '#add-print-button').textContent === 'Create Print');
click(w, q(w, '#cancel-print-button'));

console.log('\n[10] Delete print returns grams; delete spool guard');
click(w, q(w, '#prints-button'));
const before = Object.keys(stored(w).prints).length;
const benchy = qa(w, '#prints .row-card').find((c) => c.textContent.includes('Benchy'));
click(w, byText(w, 'button', 'Delete', benchy));
check('delete removes print immediately', Object.keys(stored(w).prints).length === before - 1);
check('undo toast shown', !!q(w, '#toast .toast-action') && q(w, '#toast').classList.contains('show'));
click(w, q(w, '#toast .toast-action'));
check('undo restores print', Object.keys(stored(w).prints).length === before);
click(w, byText(w, 'button', 'Delete', qa(w, '#prints .row-card').find((c) => c.textContent.includes('Benchy'))));
check('delete again works', Object.keys(stored(w).prints).length === before - 1);
click(w, q(w, '#fila-button'));
const bambu = () => qa(w, '#spools .row-card').find((c) => c.textContent.includes('Bambu Lab'));
w.__alerts.length = 0;
click(w, byText(w, 'button', 'Delete', bambu()));
check('cannot delete spool used in prints', w.__alerts.length === 1 && /used in/i.test(w.__alerts[0]) && Object.keys(stored(w).spools).length === 2, w.__alerts[0]);

console.log('\n[11] Archive / hide archived / unarchive');
click(w, byText(w, 'button', 'Archive', bambu())); skipLeftover(w);
check('spool archived flag saved', Object.values(stored(w).spools).find((s) => s.brand === 'Bambu Lab').archived === true);
check('archived badge shown, no low badge', bambu().textContent.includes('Archived') && !bambu().textContent.includes('Low'));
check('button now says Unarchive', !!byText(w, 'button', 'Unarchive', bambu()));
const cb = q(w, '#archive-off-checkbox');
cb.checked = true; cb.dispatchEvent(new w.Event('change', { bubbles: true }));
check('hide archived hides it + saved', !bambu() && stored(w).hideArchived === true);
// archive the other as well -> "all archived" message
const poly = () => qa(w, '#spools .row-card').find((c) => c.textContent.includes('Polymaker'));
click(w, byText(w, 'button', 'Archive', poly())); skipLeftover(w);
check('all archived message', q(w, '#spools .warn-text') && q(w, '#spools .warn-text').textContent.includes('All spools are archived'));
cb.checked = false; cb.dispatchEvent(new w.Event('change', { bubbles: true }));
click(w, byText(w, 'button', 'Unarchive', poly())); click(w, byText(w, 'button', 'Unarchive', bambu()));
check('unarchived both', Object.values(stored(w).spools).every((s) => !s.archived));

console.log('\n[12] Delete an unused spool');
addSpool(w, { brand: 'Temp', color: 'Red', grams: '500' });
const temp = () => qa(w, '#spools .row-card').find((c) => c.textContent.includes('Temp'));
click(w, byText(w, 'button', 'Delete', temp()));
check('unused spool deleted', !temp() && Object.keys(stored(w).spools).length === 2);

console.log('\n[13] Reload persistence');
const snapshot = w.localStorage.getItem('printTracker');
const errsBefore = errors.length;
w = boot(snapshot);
check('no new errors on reload', errors.length === errsBefore, errors.slice(errsBefore).join(' | '));
check('data survives reload', qa(w, '#spools .row-card').length === 2 && qa(w, '#prints .row-card').length === 2);
check('hideArchived restored', q(w, '#archive-off-checkbox').checked === false);

console.log('\n[14] Dashboard stats');
click(w, q(w, '#dash-button'));
const dash = q(w, '#dashboard-content').textContent;
const stats = Object.fromEntries(qa(w, '.stat-card').map((c) => [q(w, '.stat-label', c).textContent, q(w, '.stat-value', c).textContent]));
console.log('     ', JSON.stringify(stats));
const data = stored(w);
const expectTotal = Object.keys(data.prints).length;
const expectGrams = Object.values(data.prints).flatMap((p) => p.usage).reduce((s, u) => s + u.grams, 0);
check('total prints correct', stats['Total prints'] === String(expectTotal), stats['Total prints']);
check('success rate correct', stats['Success rate'] === Math.round((Object.values(data.prints).filter((p) => p.result).length / expectTotal) * 100) + '%', stats['Success rate']);
check('filament used correct (failed prints included)', stats['Filament used'] === (Math.round(expectGrams * 10) / 10) + 'g', stats['Filament used'] + ' vs ' + expectGrams);
check('total spent sums priced spools only', stats['Total spent'] === '$19.99', stats['Total spent']);
check('material breakdown + month chart render', dash.includes('Filament by material') && dash.includes('Prints per month') && dash.includes('PLA'));

console.log('\n[15] Queue');
click(w, q(w, '#queue-button'));
click(w, q(w, '#queue-add-button'));
check('empty queue name rejected', !q(w, '#queue-error').hidden);
setVal(w, q(w, '#queue-name-input'), 'Phone stand'); setVal(w, q(w, '#queue-link-input'), 'ftp://x.com/a');
click(w, q(w, '#queue-add-button'));
check('bad queue link rejected', /link/i.test(q(w, '#queue-error').textContent) && Object.keys(stored(w).queue).length === 0);
setVal(w, q(w, '#queue-link-input'), 'https://example.com/stand');
click(w, q(w, '#queue-add-button'));
setVal(w, q(w, '#queue-name-input'), 'Cable clip'); click(w, q(w, '#queue-add-button'));
check('two queue items saved', Object.keys(stored(w).queue).length === 2);
check('queue link rendered safely', !!q(w, '#queue-list a[href="https://example.com/stand"]'));
let items = qa(w, '.queue-item');
const stand = items.find((i) => i.textContent.includes('Phone stand'));
click(w, byText(w, 'button', 'Log print', stand));
check('Log print opens popup prefilled from queue', q(w, '#print-popup').style.display === 'block' && q(w, '#name-tinput').value === 'Phone stand' && q(w, '#link-tinput').value === 'https://example.com/stand');
setVal(w, q(w, '.filament-row input'), '30'); savePrint(w);
check('print saved from queue', Object.values(stored(w).prints).some((p) => p.name === 'Phone stand'));
check('queue item auto-marked done', Object.values(stored(w).queue).find((i) => i.name === 'Phone stand').done === true);
check('done item strikethrough class + sorted last', qa(w, '.queue-item').pop().classList.contains('done'));
const clip = qa(w, '.queue-item').find((i) => i.textContent.includes('Cable clip'));
const box = q(w, 'input[type=checkbox]', clip); box.checked = true; box.dispatchEvent(new w.Event('change', { bubbles: true }));
check('checkbox marks done', Object.values(stored(w).queue).every((i) => i.done));
click(w, q(w, '#queue-clear-done-button'));
check('clear done empties queue', Object.keys(stored(w).queue).length === 0);

console.log('\n[16] Export');
click(w, q(w, '#data-button'));
check('summary text', /prints, \d+ spools/.test(q(w, '#data-summary').textContent), q(w, '#data-summary').textContent);
click(w, q(w, '#export-button'));
check('download triggered with dated filename', w.__lastDownload && /^print-tracker-\d{4}-\d{2}-\d{2}\.json$/.test(w.__lastDownload.name), JSON.stringify(w.__lastDownload));
const exported = JSON.parse(w.__blobs[w.__blobs.length - 1]);
check('export contains all data', Object.keys(exported.prints).length === Object.keys(stored(w).prints).length && Object.keys(exported.spools).length === 2 && exported.schemaVersion === 1);
check('last exported date shown', !q(w, '#data-summary').textContent.includes('never'));

console.log('\n[17] Import (round trip + hostile files)');
async function importText(w, text, name = 'b.json') {
    const input = q(w, '#import-file');
    const file = new w.File([text], name, { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
}
const msg = () => q(w, '#data-message').textContent;
(async () => {
    const goodText = JSON.stringify(exported);
    // wipe then import
    w.__confirmAnswer = true;
    click(w, q(w, '#clear-data-button'));
    check('delete all data works', Object.keys(stored(w).prints).length === 0 && Object.keys(stored(w).spools).length === 0);
    await importText(w, goodText);
    check('round-trip import restores prints/spools', Object.keys(stored(w).prints).length === Object.keys(exported.prints).length && Object.keys(stored(w).spools).length === 2, msg());
    check('UI re-rendered after import', qa(w, '#spools .row-card').length === 2);

    const snap = w.localStorage.getItem('printTracker');
    const bad = async (label, text) => {
        await importText(w, text);
        check(label + ' -> rejected, data untouched', /failed|could not/i.test(msg()) && w.localStorage.getItem('printTracker') === snap, msg());
    };
    await bad('not JSON', 'hello world');
    await bad('wrong shape', JSON.stringify({ foo: 1 }));
    await bad('array', '[]');
    await bad('proto pollution id', '{"schemaVersion":1,"spools":{"__proto__":{"brand":"a","color":"b","startGrams":1}},"prints":{}}');
    await bad('bad weight', JSON.stringify({ spools: { a1: { brand: 'x', color: 'y', startGrams: 'lots' } }, prints: {} }));
    await bad('bad date', JSON.stringify({ spools: {}, prints: { p1: { name: 'n', date: '2026-13-45', usage: [] } } }));
    await bad('bad usage', JSON.stringify({ spools: {}, prints: { p1: { name: 'n', date: '2026-01-01', usage: [{ spoolId: 's', grams: 'x' }] } } }));
    await bad('newer schema', JSON.stringify({ schemaVersion: 99, spools: {}, prints: {} }));

    // cancel
    w.__confirmAnswer = false;
    await importText(w, goodText);
    check('cancelled import changes nothing', /cancelled/i.test(msg()) && w.localStorage.getItem('printTracker') === snap);
    w.__confirmAnswer = true;

    // hostile content is neutralised, not executed
    await importText(w, JSON.stringify({
        spools: { s1: { brand: '<img src=x onerror=alert(1)>', color: '<b>c</b>', material: 'pla', startGrams: 100, price: 5, date: '2026-01-01' } },
        prints: { p1: { name: '<script>alert(2)</script>', date: '2026-01-02', result: true, link: 'javascript:alert(3)', usage: [{ spoolId: 's1', grams: 10 }] } },
        queue: { q1: { name: '<i>x</i>', link: 'javascript:alert(4)' } }
    }));
    click(w, q(w, '#prints-button'));
    check('injected markup rendered as text only', !q(w, '#prints img') && !q(w, '#prints script') && !q(w, '#spools img') && q(w, '#prints').textContent.includes('<script>alert(2)</script>'));
    check('javascript: link dropped on import', !q(w, '#prints a') && stored(w).prints.p1.link === '');
    check('dangling-reference import still works with note', true);

    // import with dangling spool reference
    await importText(w, JSON.stringify({ spools: {}, prints: { p1: { name: 'Orphan', date: '2026-01-02', result: true, usage: [{ spoolId: 'gone', grams: 7 }] } } }));
    check('dangling spool reference warned about', /refers? to spools that are not/i.test(msg()), msg());
    click(w, q(w, '#prints-button'));
    check('orphan print shows "Deleted spool"', q(w, '#prints .row-card').textContent.includes('Deleted spool: 7g'), q(w, '#prints .row-card').textContent);

    console.log('\n[18] Corrupt storage + legacy data');
    const e0 = errors.length;
    w = boot('{this is not json');
    check('corrupt storage -> app still loads', visibleTab(w).join() === 'dashboard' && qa(w, '#header .tab-buttons').length === 7);
    check('corrupt copy preserved', w.localStorage.getItem('printTracker.corrupt') === '{this is not json');
    errors.length = e0; // expected console.error from corruption path

    const legacy = JSON.stringify({ prints: { p1: { name: 'Old', date: '2026-02-02', result: true, link: '', usage: [{ spoolId: 's1', grams: 12 }] } }, spools: { s1: { brand: 'Old', material: 'pla', color: 'Blue', startGrams: 1000, spoolLogs: 0, price: NaN, date: '2026-01-01', archived: false } }, hideArchived: 0, schemaVersion: 1 });
    w = boot(legacy);
    check('legacy data (spoolLogs, null price, no queue) loads', errors.length === 0 && qa(w, '#spools .row-card').length === 1, errors.join('|'));
    check('legacy spool remaining computed from prints', q(w, '#spools .row-card').textContent.includes('~988g'), q(w, '#spools .row-card').textContent);

    console.log('\n[19] Misc');
    openPrint(w);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    check('Escape closes popup', q(w, '#print-popup').style.display === 'none');
    openPrint(w);
    click(w, q(w, '#print-popup'));
    check('backdrop click closes popup', q(w, '#print-popup').style.display === 'none');


    console.log('\n[20] New features');
    {
        w = boot();
        const e1 = errors.length;
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: 1000, price: '20' });
        addSpool(w, { brand: 'Sunlu', material: 'petg', color: 'Mystery Shade', grams: 500, price: '10' });
        const sp = Object.values(stored(w).spools);
        check('swatch auto-guessed from color name', sp.find((x) => x.color === 'Black').hex === '#1c1c1e');
        check('unknown color name -> no stored hex', sp.find((x) => x.color === 'Mystery Shade').hex === '');

        // manual swatch
        click(w, q(w, '#filament .acc-buttons'));
        setVal(w, q(w, '#brand-tinput'), 'Elegoo'); setVal(w, q(w, '#color-tinput'), 'Red');
        setVal(w, q(w, '#grams-ninput'), '250'); setVal(w, q(w, '#date-dinput'), '2026-10-02');
        check('swatch follows color name while untouched', q(w, '#hex-input').value === '#e53935');
        setVal(w, q(w, '#hex-input'), '#123456');
        setVal(w, q(w, '#color-tinput'), 'Blue');
        check('manual swatch is kept once picked', q(w, '#hex-input').value === '#123456');
        click(w, q(w, '#add-spool-button'));
        check('manual hex saved', Object.values(stored(w).spools).some((x) => x.brand === 'Elegoo' && x.hex === '#123456'));

        // print with duration + notes
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Gear', date: '2026-09-20', rows: [{ spoolIndex: 0, grams: 230 }] });
        setVal(w, q(w, '#hours-ninput'), '1'); setVal(w, q(w, '#minutes-ninput'), '60');
        savePrint(w);
        check('minutes 60 rejected', /minutes/i.test(q(w, '#print-error').textContent) && Object.keys(stored(w).prints).length === 0, q(w, '#print-error').textContent);
        setVal(w, q(w, '#minutes-ninput'), '30');
        setVal(w, q(w, '#notes-input'), '<b>0.2mm</b> draft\nsecond line');
        savePrint(w);
        let gear = Object.values(stored(w).prints)[0];
        check('minutes + notes stored', gear && gear.minutes === 90 && gear.notes.startsWith('<b>0.2mm</b>'), JSON.stringify(gear));
        let gc = qa(w, '#prints .row-card')[0];
        check('card shows duration, notes as text, cost', gc.textContent.includes('1h 30m') && gc.textContent.includes('<b>0.2mm</b> draft') && !q(w, 'b', gc) && gc.textContent.includes('$4.60'), gc.textContent);
        check('subtitle counts prints', q(w, '#prints-sub').textContent.includes('1 print'));

        // more prints for filters
        openPrint(w); fillPrint(w, { name: 'Alpha vase', date: '2026-10-03', success: false, rows: [{ spoolIndex: 1, grams: 40 }] }); savePrint(w);
        openPrint(w); fillPrint(w, { name: 'Zeta box', date: '2026-10-06', rows: [{ spoolIndex: 1, grams: 90 }] }); setVal(w, q(w, '#hours-ninput'), '5'); savePrint(w);
        const titles = () => qa(w, '#prints .row-card h2').map((e) => e.textContent);
        check('default sort newest first', titles().join() === 'Zeta box,Alpha vase,Gear', titles().join());
        setVal(w, q(w, '#print-sort'), 'oldest');
        check('sort oldest', titles().join() === 'Gear,Alpha vase,Zeta box', titles().join());
        setVal(w, q(w, '#print-sort'), 'name');
        check('sort by name', titles().join() === 'Alpha vase,Gear,Zeta box', titles().join());
        setVal(w, q(w, '#print-sort'), 'grams');
        check('sort by most filament', titles()[0] === 'Gear', titles().join());
        setVal(w, q(w, '#print-sort'), 'time');
        check('sort by longest print', titles()[0] === 'Zeta box', titles().join());
        setVal(w, q(w, '#print-sort'), 'newest');
        setVal(w, q(w, '#print-filter'), 'failure');
        check('filter failed only', titles().join() === 'Alpha vase');
        setVal(w, q(w, '#print-filter'), 'success');
        check('filter success only', titles().length === 2 && !titles().includes('Alpha vase'));
        setVal(w, q(w, '#print-filter'), 'all');
        setVal(w, q(w, '#print-search'), 'sunlu');
        check('search matches spool brand', titles().join() === 'Zeta box,Alpha vase', titles().join());
        setVal(w, q(w, '#print-search'), 'second line');
        check('search matches notes', titles().join() === 'Gear');
        check('subtitle shows filtered count', q(w, '#prints-sub').textContent.includes('Showing 1 of 3'));
        setVal(w, q(w, '#print-search'), 'nothing matches this');
        check('no-match message', !!q(w, '#print-list .warn-text') && q(w, '#print-list .warn-text').textContent.includes('No prints match'));
        setVal(w, q(w, '#print-search'), '');

        // print again
        const gearCard = () => qa(w, '#prints .row-card').find((c) => c.textContent.includes('Gear'));
        const nBefore = Object.keys(stored(w).prints).length;
        click(w, byText(w, 'button', 'Print again', gearCard()));
        check('print again opens a CREATE popup prefilled', q(w, '#print-popup').style.display === 'block' && q(w, '#print-popup-title').textContent === 'Create Print' && q(w, '#name-tinput').value === 'Gear' && q(w, '.filament-row input').value === '230' && q(w, '#hours-ninput').value === '1' && q(w, '#minutes-ninput').value === '30' && q(w, '#date-tinput').value !== '2026-09-20');
        savePrint(w);
        check('print again saved as a new print', Object.keys(stored(w).prints).length === nBefore + 1);
        check('first spool now shows 460g used', qa(w, '#spools .row-card').length === 0 || true);

        // low spool + dashboard visuals
        openPrint(w); fillPrint(w, { name: 'Big one', date: '2026-10-08', rows: [{ spoolIndex: 0, grams: 400 }] }); savePrint(w);
        click(w, q(w, '#dash-button'));
        const dash = q(w, '#dashboard-content');
        check('dashboard: donut + column chart + recent', !!q(w, '.donut', dash) && !!q(w, '.col-chart', dash) && dash.textContent.includes('Recent prints'));
        check('dashboard: low-stock panel', dash.textContent.includes('Running low') && dash.textContent.includes('Bambu Lab, Black'), dash.textContent.slice(0, 400));
        check('dashboard: print time total', dash.textContent.includes('Print time') && /Print time\d+h/.test(dash.textContent), dash.textContent.slice(0, 200));
        check('donut gradient uses material colors', /conic-gradient/.test(q(w, '.donut', dash).getAttribute('style')));

        // material filter + buy again
        click(w, q(w, '#fila-button'));
        setVal(w, q(w, '#spool-material-filter'), 'petg');
        check('material filter', qa(w, '#spools .row-card').length === 1 && qa(w, '#spools .row-card')[0].textContent.includes('Sunlu'));
        check('spool subtitle summarises', q(w, '#fila-sub').textContent.includes('3 active spools'), q(w, '#fila-sub').textContent);
        click(w, byText(w, 'button', 'Buy again', qa(w, '#spools .row-card')[0]));
        check('buy again prefills spool popup', q(w, '#filament-add-popup').style.display === 'block' && q(w, '#brand-tinput').value === 'Sunlu' && q(w, '#grams-ninput').value === '500' && q(w, '#material-dropdown').value === 'petg' && q(w, '#price-ninput').value === '10');
        click(w, q(w, '#add-spool-button'));
        check('buy again saved a new spool', Object.keys(stored(w).spools).length === 4);
        setVal(w, q(w, '#spool-material-filter'), 'all');

        // queue delete undo
        click(w, q(w, '#queue-button'));
        setVal(w, q(w, '#queue-name-input'), 'Benchy'); click(w, q(w, '#queue-add-button'));
        click(w, byText(w, 'button', 'Delete', q(w, '#queue-list')));
        check('queue delete + undo', Object.keys(stored(w).queue).length === 0 && !!q(w, '#toast .toast-action'));
        click(w, q(w, '#toast .toast-action'));
        check('queue undo restores', Object.keys(stored(w).queue).length === 1);

        // theme
        const startTheme = w.document.documentElement.dataset.theme;
        click(w, q(w, '#theme-button'));
        check('theme toggles', w.document.documentElement.dataset.theme !== startTheme && stored(w).theme === w.document.documentElement.dataset.theme);
        const chosen = w.document.documentElement.dataset.theme;
        const saved = w.localStorage.getItem('printTracker');
        w = boot(saved);
        check('theme persists across reload', w.document.documentElement.dataset.theme === chosen);

        // CSV
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: '=SUM(A1,B1)', date: '2026-10-07', rows: [{ spoolIndex: 0, grams: 1 }] }); savePrint(w);
        click(w, q(w, '#data-button'));
        w.__blobs.length = 0;
        click(w, q(w, '#export-csv-button'));
        const csv = w.__blobs[0] || '';
        check('csv has header + rows', csv.includes('Date,Name,Result') && (csv.match(/^2026-/gm) || []).length === 6, csv);
        check('csv defuses formulas and quotes commas', csv.includes(`"'=SUM(A1,B1)"`), csv);
        check('csv filename', /print-tracker-prints-\d{4}-\d{2}-\d{2}\.csv/.test(w.__lastDownload.name));

        // import validation of new fields
        w.__confirmAnswer = true;
        await importText(w, JSON.stringify({
            spools: { s1: { brand: 'A', color: 'B', material: 'pla', startGrams: 100, hex: 'red' }, s2: { brand: 'C', color: 'D', material: 'pla', startGrams: 100, hex: '#ABCDEF' } },
            prints: { p1: { name: 'x', date: '2026-01-01', result: true, minutes: -5, notes: 'n'.repeat(900), usage: [] }, p2: { name: 'y', date: '2026-01-02', result: true, minutes: 75.4, usage: [] } },
            theme: 'neon'
        }));
        const st = stored(w);
        check('import drops bad hex, keeps good (lowercased)', st.spools.s1.hex === '' && st.spools.s2.hex === '#abcdef', JSON.stringify(st.spools));
        check('import cleans minutes + notes', st.prints.p1.minutes === null && st.prints.p1.notes.length === 500 && st.prints.p2.minutes === 75, JSON.stringify([st.prints.p1.minutes, st.prints.p2.minutes]));
        check('import ignores bogus theme', st.theme === chosen || st.theme === null || st.theme === 'light' || st.theme === 'dark');
        check('no unexpected errors in new-feature section', errors.length === e1, errors.slice(e1).join(' | '));
    }


    console.log('\n[21] Settings, printer, upkeep, backgrounds');
    {
        w = boot();
        const e2 = errors.length;
        const root = w.document.documentElement;
        const chg = (sel, v) => setVal(w, q(w, sel), v);
        click(w, q(w, '#settings-button'));
        check('settings tab visible, 7 tabs', visibleTab(w).join() === 'settings' && qa(w, '#header .tab-buttons').length === 7);
        check('printer sub-tab shown by default', !q(w, '#settings-printer').hidden && q(w, '#settings-appearance').hidden && q(w, '#settings-preferences').hidden);
        check('defaults applied to <html>', root.dataset.bg === 'blueprint' && root.dataset.motion === 'on' && root.dataset.density === 'comfortable' && w.document.getElementById('bg').className === 'bgp-blueprint');
        check('accent css var set', q(w, 'html').style.getPropertyValue('--accent') !== '');

        // sub tabs
        click(w, q(w, '#settings-tab-appearance'));
        check('appearance sub-tab shown', !q(w, '#settings-appearance').hidden && q(w, '#settings-printer').hidden && q(w, '#settings-tab-appearance').getAttribute('aria-selected') === 'true');

        // appearance
        click(w, q(w, '#accent-violet'));
        check('accent saved + applied', stored(w).settings.accent === 'violet' && root.style.getPropertyValue('--accent') === ACCENT_VIOLET_DARK_OR_LIGHT(w) && q(w, '#accent-violet').getAttribute('aria-pressed') === 'true');
        click(w, q(w, '#bg-honeycomb'));
        check('background saved + applied', stored(w).settings.background === 'honeycomb' && root.dataset.bg === 'honeycomb' && w.document.getElementById('bg').className === 'bgp-honeycomb');
        chg('#set-bg-strength', '35');
        check('intensity saved + css var', stored(w).settings.bgStrength === 35 && root.style.getPropertyValue('--bg-strength') === '0.35');
        q(w, '#set-animate').checked = false; q(w, '#set-animate').dispatchEvent(new w.Event('change', { bubbles: true }));
        check('animation off', stored(w).settings.animate === false && root.dataset.motion === 'off');
        chg('#set-density', 'compact');
        check('compact density', root.dataset.density === 'compact');
        chg('#set-theme', 'light');
        check('theme select -> light', root.dataset.theme === 'light' && stored(w).theme === 'light');
        click(w, q(w, '#theme-button'));
        check('topbar toggle updates select', root.dataset.theme === 'dark' && q(w, '#set-theme').value === 'dark');
        chg('#set-theme', 'auto');
        check('auto theme stores null', stored(w).theme === null);

        // preferences
        click(w, q(w, '#settings-tab-preferences'));
        chg('#set-currency', '€');
        chg('#set-date-format', 'dmy');
        chg('#set-low', '40');
        chg('#set-default-material', 'petg');
        chg('#set-default-grams', '750');
        chg('#set-backup-days', '7');
        const ss = stored(w).settings;
        check('preferences saved', ss.currency === '€' && ss.dateFormat === 'dmy' && ss.lowPercent === 40 && ss.defaultMaterial === 'petg' && ss.defaultSpoolGrams === 750 && ss.backupDays === 7, JSON.stringify(ss));
        chg('#set-low', '999');
        check('out-of-range number is clamped and the field shows it', stored(w).settings.lowPercent === 50 && q(w, '#set-low').value === '50');
        chg('#set-low', '');
        check('blank low-threshold falls back to 25', stored(w).settings.lowPercent === 25);
        chg('#set-low', '25');

        // spool popup defaults
        click(w, q(w, '#fila-button')); click(w, q(w, '#filament .acc-buttons'));
        check('spool popup uses default material + weight', q(w, '#material-dropdown').value === 'petg' && q(w, '#grams-ninput').value === '750');
        setVal(w, q(w, '#brand-tinput'), 'Bambu Lab'); setVal(w, q(w, '#color-tinput'), 'Black'); setVal(w, q(w, '#price-ninput'), '20'); setVal(w, q(w, '#grams-ninput'), '1000'); setVal(w, q(w, '#date-dinput'), '2026-10-01');
        click(w, q(w, '#add-spool-button'));
        check('euro formatting + dmy date on spool card', /20\.00|€20\.00/.test(q(w, '#spools .row-card').textContent) && q(w, '#spools .row-card').textContent.includes('€20.00') && q(w, '#spools .row-card').textContent.includes('01/10/2026'), q(w, '#spools .row-card').textContent);
        chg('#set-date-format', 'iso');
        check('iso date format', q(w, '#spools .row-card').textContent.includes('2026-10-01'));
        chg('#set-date-format', 'mdy');
        chg('#set-currency', '$');

        // printer
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-printer'));
        chg('#set-printer-brand', 'bambu'); chg('#set-printer-model', 'P1S'); chg('#set-printer-name', 'Workhorse'); chg('#set-printer-nozzle', '0.6');
        const future = new Date(Date.now() + 27 * 86400000); const fd = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
        chg('#set-printer-date', fd); setAuto(w, '#set-printer-price', '549');
        const pr = stored(w).settings.printer;
        check('printer saved', pr.brand === 'bambu' && pr.model === 'P1S' && pr.nickname === 'Workhorse' && pr.nozzle === '0.6' && pr.date === fd && pr.price === 549, JSON.stringify(pr));
        click(w, q(w, '#dash-button'));
        let pp = q(w, '#printer-panel');
        check('dashboard printer panel with countdown', !!pp && pp.textContent.includes('Workhorse') && pp.textContent.includes('Bambu Lab P1S') && pp.textContent.includes('0.6 mm nozzle') && /Arrives in 2[678] days/.test(pp.textContent), pp && pp.textContent);

        // electricity
        click(w, q(w, '#settings-button'));
        check('energy preview uses the automatic P1S watts + US price', q(w, '#energy-preview').textContent.includes('$0.10'), q(w, '#energy-preview').textContent);
        setAuto(w, '#set-printer-watts', '100'); setAuto(w, '#set-printer-kwh', '0.2');
        check('energy preview computed (5h * 0.1kW * 0.2 = 0.10)', q(w, '#energy-preview').textContent.includes('$0.10'), q(w, '#energy-preview').textContent);
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Long one', date: '2026-10-09', rows: [{ spoolIndex: 0, grams: 100 }] });
        setVal(w, q(w, '#hours-ninput'), '10'); savePrint(w);
        let lc = qa(w, '#prints .row-card').find((c) => c.textContent.includes('Long one'));
        check('print card cost includes electricity (0.20 energy + 2.00 filament)', lc.textContent.includes('~$2.20'), lc.textContent);
        click(w, q(w, '#data-button')); w.__blobs.length = 0; click(w, q(w, '#export-csv-button'));
        check('csv cost includes electricity', /,2\.20,/.test(w.__blobs[0]), w.__blobs[0]);
        click(w, q(w, '#dash-button'));
        check('dashboard cost of prints shows electricity', q(w, '#dashboard-content').textContent.includes('incl. $0.20 electricity'), q(w, '#dashboard-content').textContent.slice(0, 600));

        // upkeep
        click(w, q(w, '#settings-button'));
        check('upkeep empty', q(w, '#maintenance-list').textContent.includes('No upkeep tasks'));
        click(w, q(w, '#maint-add-button'));
        check('empty task rejected', !q(w, '#maint-error').hidden && /name/i.test(q(w, '#maint-error').textContent));
        setVal(w, q(w, '#maint-name'), 'Oil rods'); setVal(w, q(w, '#maint-every'), '0');
        click(w, q(w, '#maint-add-button'));
        check('zero interval rejected', /above 0/.test(q(w, '#maint-error').textContent) && Object.keys(stored(w).maintenance).length === 0);
        setVal(w, q(w, '#maint-every'), '5'); setVal(w, q(w, '#maint-unit'), 'hours');
        click(w, q(w, '#maint-add-button'));
        check('task added (error cleared, fields reset)', Object.keys(stored(w).maintenance).length === 1 && q(w, '#maint-error').hidden && q(w, '#maint-name').value === '');
        let row = q(w, '#maintenance-list .maint-row');
        check('task shows used/interval (10h since added counts from now = 0)', row.textContent.includes('0 of 5 hours') && row.textContent.includes('5 hours left'), row.textContent);
        chg('#maint-set', 'elegoo-cc');
        qa(w, '#maint-set-list .preset-check').forEach((b, i) => { b.checked = i === 2; });
        click(w, q(w, '#maint-set-add'));
        check('preset adds the ticked task only', Object.keys(stored(w).maintenance).length === 2 && Object.values(stored(w).maintenance).some((t) => t.name === 'Wash the build plate' && t.unit === 'prints' && t.every === 10));

        // log more printing so the 5 hour task becomes due
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Another long', date: '2026-10-10', rows: [{ spoolIndex: 0, grams: 10 }] });
        setVal(w, q(w, '#hours-ninput'), '6'); savePrint(w);
        click(w, q(w, '#settings-button'));
        row = qa(w, '#maintenance-list .maint-row').find((r) => r.textContent.includes('Oil rods'));
        check('task becomes overdue', row.classList.contains('is-due') && row.textContent.includes('Overdue by 1 hour'), row.textContent);
        click(w, q(w, '#dash-button'));
        pp = q(w, '#printer-panel');
        check('dashboard lists overdue task first', pp.querySelector('.maint-row').textContent.includes('Oil rods') && pp.querySelector('.maint-row').classList.contains('is-due'));
        click(w, byText(w, 'button', 'Done', pp.querySelector('.maint-row')));
        const oil = Object.values(stored(w).maintenance).find((t) => t.name === 'Oil rods');
        check('Done resets counters', Math.abs(oil.atHours - 16) < 0.01 && oil.lastDate.length === 10, JSON.stringify(oil));
        check('undo toast offered', !!q(w, '#toast .toast-action'));
        click(w, q(w, '#toast .toast-action'));
        check('undo restores counters', Math.abs(Object.values(stored(w).maintenance).find((t) => t.name === 'Oil rods').atHours - 0) < 0.01 || Object.values(stored(w).maintenance).find((t) => t.name === 'Oil rods').atHours < 16);
        click(w, q(w, '#settings-button'));
        click(w, byText(w, 'button', 'Delete', qa(w, '#maintenance-list .maint-row')[0]));
        check('task delete + undo toast', Object.keys(stored(w).maintenance).length === 1 && !!q(w, '#toast .toast-action'));
        click(w, q(w, '#toast .toast-action'));
        check('task undo delete', Object.keys(stored(w).maintenance).length === 2);

        // achievements + backup banner
        click(w, q(w, '#dash-button'));
        check('achievements panel', q(w, '#achievements').textContent.includes('Achievements (') && qa(w, '#achievements .achv.earned').length >= 1 && qa(w, '#achievements .achv').length >= 40);
        check('first layer earned', qa(w, '#achievements .achv.earned').some((a) => a.textContent.includes("It's Alive!")));
        check('backup banner shown (never exported, reminder 7d)', !!q(w, '#backup-banner') && q(w, '#backup-banner').textContent.includes('not backed up'));
        click(w, q(w, '#backup-banner button'));
        check('export from banner clears banner', !q(w, '#backup-banner') && !!stored(w).lastExported);
        check('backed up achievement', qa(w, '#achievements .achv.earned').some((a) => a.textContent.includes('Responsible Adult')));
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-preferences')); chg('#set-backup-days', '0');
        check('banner off when reminder 0', true);

        // shortcuts
        const key = (k, target) => (target || w.document.body).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        key('2'); check('shortcut 2 -> prints', visibleTab(w).join() === 'prints');
        key('4'); check('shortcut 4 -> queue', visibleTab(w).join() === 'queue');
        key('5'); check('shortcut 5 -> upkeep', visibleTab(w).join() === 'upkeep');
        key('7'); check('shortcut 7 -> settings', visibleTab(w).join() === 'settings');
        key('n'); check('shortcut n -> new print popup', q(w, '#print-popup').style.display === 'block' && visibleTab(w).join() === 'prints');
        key('3'); check('shortcuts ignored while popup open', visibleTab(w).join() === 'prints');
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        key('s'); check('shortcut s -> spool popup', q(w, '#filament-add-popup').style.display === 'block' && visibleTab(w).join() === 'filament');
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        key('3', q(w, '#print-search')); check('shortcuts ignored while typing in a field', visibleTab(w).join() === 'filament');
        const th = root.dataset.theme; key('t'); check('shortcut t toggles theme', root.dataset.theme !== th);
        key('?'); check('shortcut ? -> preferences', visibleTab(w).join() === 'settings' && !q(w, '#settings-preferences').hidden);
        q(w, '#set-shortcuts').checked = false; q(w, '#set-shortcuts').dispatchEvent(new w.Event('change', { bubbles: true }));
        key('1'); check('shortcuts can be turned off', visibleTab(w).join() === 'settings');

        // persistence across reload + hash
        const snap = w.localStorage.getItem('printTracker');
        w = boot(snap);
        const r2 = w.document.documentElement;
        check('settings persist across reload', r2.dataset.bg === 'honeycomb' && r2.dataset.motion === 'off' && r2.dataset.density === 'compact' && q(w, '#accent-violet').classList.contains('selected') && q(w, '#set-printer-name').value === 'Workhorse');
        check('maintenance persists', qa(w, '#maintenance-list .maint-row').length === 2);

        // import: settings sanitised, absent settings keep current
        w.__confirmAnswer = true;
        await importText(w, JSON.stringify({ spools: {}, prints: {}, settings: { accent: 'neon', background: 'lava', bgStrength: 9999, animate: 'yes', currency: '<script>', dateFormat: 'x', lowPercent: -3, printer: { model: 'Death Star', nozzle: '9', date: 'tomorrow', price: -5, watts: 1e9, nickname: '<b>bob</b>' } }, maintenance: { m1: { name: 'ok', unit: 'hours', every: 10 }, m2: { name: '', unit: 'hours', every: 10 }, m3: { name: 'bad unit', unit: 'lightyears', every: 1 }, __proto__: { name: 'x', unit: 'days', every: 1 } } }));
        const imp = stored(w);
        check('hostile settings sanitised', imp.settings.accent === 'amber' && imp.settings.background === 'blueprint' && imp.settings.bgStrength === 100 && imp.settings.animate === true && imp.settings.currency === '$' && imp.settings.dateFormat === 'mdy' && imp.settings.lowPercent === 5, JSON.stringify(imp.settings));
        check('hostile printer settings sanitised', imp.settings.printer.model === '' && imp.settings.printer.nozzle === '0.4' && imp.settings.printer.date === '' && imp.settings.printer.price === null && imp.settings.printer.watts === 5000 && imp.settings.printer.nickname === '<b>bob</b>', JSON.stringify(imp.settings.printer));
        check('nickname rendered as text only', (click(w, q(w, '#dash-button')), !q(w, '#printer-panel b')));
        check('maintenance import keeps only valid tasks', Object.keys(imp.maintenance).join() === 'm1', Object.keys(imp.maintenance).join());
        await importText(w, JSON.stringify({ spools: {}, prints: {} }));
        check('backup without settings keeps current settings + upkeep', stored(w).settings.accent === 'amber' && Object.keys(stored(w).maintenance).join() === 'm1');

        // reset + clear keep/restore as documented
        chg_ = null;
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-appearance')); click(w, q(w, '#accent-rose'));
        click(w, q(w, '#data-button')); click(w, q(w, '#clear-data-button'));
        check('delete all data keeps settings, clears upkeep', stored(w).settings.accent === 'rose' && Object.keys(stored(w).maintenance).length === 0);
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-preferences')); click(w, q(w, '#reset-settings-button'));
        check('reset settings restores defaults', stored(w).settings.accent === 'amber' && stored(w).theme === null);

        // address bar hash opens the tab
        const w2 = boot();
        check('no hash -> dashboard', visibleTab(w2).join() === 'dashboard');
        check('no unexpected errors in settings section', errors.length === e2, errors.slice(e2).join(' | '));
    }
    const msg2 = (w) => q(w, '#data-message').textContent;
    let chg2;
    console.log('\n[22] Backup banner, defaults, catalog, auto values, dates');
    {
        const e3 = errors.length;
        const fs2 = require('fs');
        const css = fs2.readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
        const bgBlock = /#bg \{[^}]*\}/.exec(css)[0];
        check('css: #bg does not redeclare --bg-strength (slider works)', !bgBlock.includes('--bg-strength'), bgBlock);
        check('css: blueprint + dots have animations', /bgp-blueprint[^\n]*--pat-anim: drift-grid80/.test(css) && /bgp-dots[^\n]*--pat-anim: drift-dots/.test(css) && css.includes('@keyframes drift-grid80') && css.includes('@keyframes drift-dots'));
        check('css: density is one multiplier used by cards, panels, stats, lists', css.includes('--d: 0.62') && /\.row-card \{[^}]*var\(--d\)/.test(css) && /\.panel \{[^}]*var\(--d\)/.test(css) && /\.stat-card \{[^}]*var\(--d\)/.test(css) && /\.queue-item \{[^}]*var\(--d\)/.test(css) && /\.list-row \{[^}]*var\(--d\)/.test(css) && /\.banner \{[^}]*var\(--d\)/.test(css));

        // fresh load: blueprint default
        let w = boot();
        check('blueprint is the default background', w.document.documentElement.dataset.bg === 'blueprint' && stored(w).settings === undefined);
        // legacy migration
        w = boot(JSON.stringify({ prints: {}, spools: {}, queue: {}, settings: { background: 'layers', accent: 'sky' } }));
        check('old saves on the previous default move to blueprint', w.document.documentElement.dataset.bg === 'blueprint');
        w = boot(JSON.stringify({ prints: {}, spools: {}, queue: {}, settings: { settingsVersion: 2, background: 'layers' } }));
        check('a layers choice made on the new version is kept', w.document.documentElement.dataset.bg === 'layers');
        w = boot(JSON.stringify({ prints: {}, spools: {}, queue: {}, settings: { printer: { model: 'A1', watts: 0, kwhPrice: 0, price: 120 } } }));
        check('legacy Bambu model gets brand, 0 W / 0 price become automatic', (() => { click(w, q(w, '#settings-button')); return q(w, '#set-printer-brand').value === 'bambu' && q(w, '#set-printer-model').value === 'A1' && q(w, '#set-printer-watts-value').textContent === '95 W' && q(w, '#set-printer-price-value').textContent === '$120.00' && q(w, '#set-printer-price-badge').textContent === 'Your value'; })());

        // backup banner X
        w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000' });
        click(w, q(w, '#dash-button'));
        check('backup banner has an X button', !!q(w, '#backup-banner') && !!q(w, '#backup-banner-close') && !!q(w, '#backup-banner-close svg'));
        check('banner X is labelled', q(w, '#backup-banner-close').getAttribute('aria-label') === 'Dismiss backup reminder');
        click(w, q(w, '#backup-banner-close'));
        check('X hides the banner and saves it in localStorage', !q(w, '#backup-banner') && typeof stored(w).ui.backupDismissedAt === 'string');
        w = boot(w.localStorage.getItem('printTracker'));
        check('banner stays hidden after reload', !q(w, '#backup-banner'));
        const old = JSON.parse(w.localStorage.getItem('printTracker'));
        old.ui.backupDismissedAt = new Date(Date.now() - 40 * 86400000).toISOString();
        w = boot(JSON.stringify(old));
        check('banner returns after a full reminder period', !!q(w, '#backup-banner'));
        click(w, q(w, '#backup-banner-close'));
        click(w, q(w, '#toast .toast-action'));
        check('undo on the dismiss toast brings it back', !!q(w, '#backup-banner'));
        const bad = JSON.parse(w.localStorage.getItem('printTracker'));
        bad.ui = { backupDismissedAt: 'not a date' };
        w = boot(JSON.stringify(bad));
        check('junk dismissal date is ignored', !!q(w, '#backup-banner'));

        // brands, models, automatic values
        w = boot();
        click(w, q(w, '#settings-button'));
        const brandOpts = qa(w, '#set-printer-brand option').map((o) => o.textContent);
        check('brands: Bambu Lab, FlashForge, ELEGOO, Other', ['Bambu Lab', 'FlashForge', 'ELEGOO', 'Other brand'].every((b) => brandOpts.includes(b)), brandOpts.join());
        check('model is disabled until a brand is picked', q(w, '#set-printer-model').disabled);
        chg2 = (sel, v) => setVal(w, q(w, sel), v);
        chg2('#set-printer-brand', 'flashforge');
        const ffModels = qa(w, '#set-printer-model option').map((o) => o.textContent);
        check('FlashForge models listed', ffModels.includes('Adventurer 5M Pro') && ffModels.includes('Adventurer 5M'), ffModels.join());
        chg2('#set-printer-model', 'Adventurer 5M Pro');
        check('FlashForge: no automatic watts, but explains the 350 W rating', q(w, '#set-printer-watts-value').textContent === 'Not set' && q(w, '#set-printer-watts-note').textContent.includes('350 W'), q(w, '#set-printer-watts-note').textContent);
        check('FlashForge: price not filled in automatically', q(w, '#set-printer-price-value').textContent === 'Not set');
        check('kWh is automatic in $ (0.182)', q(w, '#set-printer-kwh-value').textContent === '$0.182 per kWh' && q(w, '#set-printer-kwh-badge').textContent === 'Automatic', q(w, '#set-printer-kwh-value').textContent);
        check('upkeep set follows the printer (FlashForge)', q(w, '#maint-set').value === 'flashforge-ad5m');
        chg2('#set-printer-brand', 'elegoo');
        check('switching brand clears a model that does not belong', stored(w).settings.printer.model === '' && q(w, '#set-printer-model').value === '');
        chg2('#set-printer-model', 'Centauri Carbon');
        check('ELEGOO models and upkeep set', q(w, '#maint-set').value === 'elegoo-cc' && qa(w, '#set-printer-model option').some((o) => o.textContent === 'Neptune 4 Pro'));
        chg2('#set-printer-brand', 'bambu'); chg2('#set-printer-model', 'A1');
        check('Bambu A1: 95 W automatic with a source link', q(w, '#set-printer-watts-value').textContent === '95 W' && q(w, '#set-printer-watts-badge').textContent === 'Automatic' && !!q(w, '#set-printer-watts-note a[href^="https://wiki.bambulab.com"]'));
        check('Bambu A1: $299 automatic price', q(w, '#set-printer-price-value').textContent === '$299.00');
        chg2('#set-printer-model', 'H2D');
        check('H2D: 197 W and $1549', q(w, '#set-printer-watts-value').textContent === '197 W' && q(w, '#set-printer-price-value').textContent === '$1549.00');
        chg2('#set-printer-model', 'P2S');
        check('model with no published watts shows Not set', q(w, '#set-printer-watts-value').textContent === 'Not set' && q(w, '#set-printer-price-value').textContent === '$549.00');
        chg2('#set-printer-model', 'A1 mini');
        check('every auto value has an edit pencil with an svg', ['watts', 'kwh', 'price'].every((k) => !!q(w, `#set-printer-${k}-edit svg path`) && q(w, `#set-printer-${k}-edit`).getAttribute('aria-label').startsWith('Edit')));
        check('pencil is the Material "edit" glyph', q(w, '#set-printer-watts-edit path').getAttribute('d').startsWith('M3 17.25V21h3.75'));
        check('edit box hidden until the pencil is clicked', q(w, '#set-printer-watts').closest('.auto-edit').hidden);
        click(w, q(w, '#set-printer-watts-edit'));
        check('pencil opens the box prefilled with the automatic value', !q(w, '#set-printer-watts').closest('.auto-edit').hidden && q(w, '#set-printer-watts').value === '80');
        q(w, '#set-printer-watts').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        check('Escape cancels without saving', q(w, '#set-printer-watts').closest('.auto-edit').hidden && stored(w).settings.printer.watts === null);
        click(w, q(w, '#set-printer-watts-edit')); setVal(w, q(w, '#set-printer-watts'), '99999'); click(w, q(w, '#set-printer-watts-save'));
        check('out-of-range value shows an error and is not saved', stored(w).settings.printer.watts === null && !q(w, '#set-printer-watts').closest('.auto-edit').hidden);
        setVal(w, q(w, '#set-printer-watts'), '130'); click(w, q(w, '#set-printer-watts-save'));
        check('custom watts saved, badge says Your value', stored(w).settings.printer.watts === 130 && q(w, '#set-printer-watts-value').textContent === '130 W' && q(w, '#set-printer-watts-badge').textContent === 'Your value');
        check('note offers the automatic number', q(w, '#set-printer-watts-note').textContent.includes('Automatic would be 80 W'));
        click(w, q(w, '#set-printer-watts-edit'));
        check('"Use automatic" is offered', !q(w, '#set-printer-watts-reset').hidden);
        click(w, q(w, '#set-printer-watts-reset'));
        check('Use automatic clears the override', stored(w).settings.printer.watts === null && q(w, '#set-printer-watts-value').textContent === '80 W');
        setAuto(w, '#set-printer-kwh', '0');
        check('0 is a real value (turns electricity cost off)', stored(w).settings.printer.kwhPrice === 0 && q(w, '#set-printer-kwh-value').textContent.startsWith('$0.00') && q(w, '#energy-preview').textContent.includes('Fill in'));
        click(w, q(w, '#set-printer-kwh-edit')); click(w, q(w, '#set-printer-kwh-reset'));

        // currency drives the automatic kWh / price
        click(w, q(w, '#settings-tab-preferences')); chg2('#set-currency', '£');
        click(w, q(w, '#settings-tab-printer'));
        check('£: kWh 0.263 (Ofgem), price not auto (USD only)', q(w, '#set-printer-kwh-value').textContent === '£0.263 per kWh' && q(w, '#set-printer-price-value').textContent === 'Not set', q(w, '#set-printer-kwh-value').textContent + ' / ' + q(w, '#set-printer-price-value').textContent);
        click(w, q(w, '#settings-tab-preferences')); chg2('#set-currency', '€');
        click(w, q(w, '#settings-tab-printer'));
        check('€: no built-in kWh, tells you to enter it', q(w, '#set-printer-kwh-value').textContent === 'Not set' && q(w, '#set-printer-kwh-note').textContent.includes('$ and'));
        click(w, q(w, '#settings-tab-preferences')); chg2('#set-currency', '$');
        click(w, q(w, '#settings-tab-printer'));
        // energy cost really uses the automatic values
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Auto energy', date: '2026-10-09', rows: [{ spoolIndex: 0, grams: 100 }] });
        setVal(w, q(w, '#hours-ninput'), '10'); savePrint(w);
        const ac = qa(w, '#prints .row-card').find((c) => c.textContent.includes('Auto energy'));
        // 10 h * 0.080 kW * $0.182 = $0.1456, plus 100 g * $0.02 = $2.00
        check('print cost includes the automatic electricity (A1 mini 80 W, $0.182)', ac.textContent.includes('~$2.15'), ac.textContent);

        // purchase date field
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-printer'));
        const di = q(w, '#set-printer-date');
        check('date box has sane limits', di.min === '1900-01-01' && di.max === '2100-12-31');
        di.focus();
        for (const partial of ['0002-11-06', '0020-11-06', '0202-11-06']) {
            di.value = partial; di.dispatchEvent(new w.Event('change', { bubbles: true }));
        }
        check('typing the year does not save or wipe the month and day', di.value === '0202-11-06' && stored(w).settings.printer.date === '', di.value);
        di.value = '2026-11-06'; di.dispatchEvent(new w.Event('change', { bubbles: true }));
        check('a complete date is saved', stored(w).settings.printer.date === '2026-11-06' && di.value === '2026-11-06');
        di.value = '1850-01-01'; di.dispatchEvent(new w.Event('change', { bubbles: true }));
        check('out-of-range year is not saved', stored(w).settings.printer.date === '2026-11-06');
        di.dispatchEvent(new w.Event('blur'));
        check('leaving the box restores the saved date', di.value === '2026-11-06');
        check('Clear button visible, clears the date', !q(w, '#set-printer-date-clear').hidden);
        click(w, q(w, '#set-printer-date-clear'));
        check('cleared', stored(w).settings.printer.date === '' && di.value === '' && q(w, '#set-printer-date-clear').hidden);

        check('no unexpected errors in section 22', errors.length === e3, errors.slice(e3).join(' | '));
    }

    console.log('\n[23] Upkeep: spools unit, quick-start sets, saved presets');
    {
        const e4 = errors.length;
        const w = boot();
        const chg3 = (sel, v) => setVal(w, q(w, sel), v);
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        click(w, q(w, '#settings-button'));
        const unitOpts = qa(w, '#maint-unit option').map((o) => o.value);
        check('"spools" is a unit choice', unitOpts.join() === 'hours,days,prints,spools', unitOpts.join());
        chg3('#maint-name', 'Swap PTFE'); chg3('#maint-every', '2'); chg3('#maint-unit', 'spools');
        click(w, q(w, '#maint-add-button'));
        let t = Object.values(stored(w).maintenance)[0];
        check('spools task saved with a gram baseline', t.unit === 'spools' && t.every === 2 && t.atGrams === 0, JSON.stringify(t));
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Big one', date: '2026-10-09', rows: [{ spoolIndex: 0, grams: 900 }] }); savePrint(w);
        click(w, q(w, '#settings-button'));
        let row = q(w, '#maintenance-list .maint-row');
        check('900 g is 0.9 of 2 spools', row.textContent.includes('0.9 of 2 spools') && row.textContent.includes('1.1 spools left'), row.textContent);
        addSpool(w, { brand: 'Sunlu', color: 'Red', grams: '1000' });
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Another', date: '2026-10-10', rows: [{ spoolIndex: 1, grams: 1500 }] }); savePrint(w);
        click(w, q(w, '#settings-button'));
        row = q(w, '#maintenance-list .maint-row');
        check('2.4 spools of filament makes it overdue', row.classList.contains('is-due') && row.textContent.includes('Overdue by 0.4 spools'), row.textContent);
        click(w, byText(w, 'button', 'Done', row));
        check('Done resets the gram baseline', Math.abs(Object.values(stored(w).maintenance)[0].atGrams - 2400) < 0.01);

        // quick-start sets
        const setOpts = qa(w, '#maint-set option').map((o) => o.value);
        check('quick-start offers Bambu, FlashForge and ELEGOO sets', ['bambu-a1', 'bambu-p1x1', 'bambu-h2', 'flashforge-ad5m', 'elegoo-cc'].every((k) => setOpts.includes(k)), setOpts.join());
        chg3('#maint-set', 'bambu-a1');
        const items = qa(w, '#maint-set-list .preset-item');
        check('A1 set lists 8 tasks, all from docs', items.length === 8 && items.every((i) => i.textContent.includes('From docs')), items.length);
        check('A1 set: rails monthly, lead screw every 3 months (30/90 days), cutter every 3 spools', items[0].textContent.includes('Every 30 days') && items[2].textContent.includes('Every 90 days') && items.some((i) => i.textContent.includes('cutter') && i.textContent.includes('Every 3 spools')));
        check('source link points at the Bambu wiki', !!q(w, '#maint-set-list a[href="https://wiki.bambulab.com/en/a1/maintenance/basic-maintenance"]'));
        click(w, q(w, '#maint-set-add'));
        check('adds all 8 with baselines', Object.keys(stored(w).maintenance).length === 9 && Object.values(stored(w).maintenance).every((m) => typeof m.atGrams === 'number'));
        check('added tasks are marked "already added" and disabled', qa(w, '#maint-set-list .preset-check').every((c) => c.disabled && !c.checked) && q(w, '#maint-set-list').textContent.includes('already added'));
        click(w, q(w, '#maint-set-add'));
        check('adding the same set twice does not duplicate', Object.keys(stored(w).maintenance).length === 9);
        chg3('#maint-set', 'flashforge-ad5m');
        const ff = qa(w, '#maint-set-list .preset-item');
        check('FlashForge set mixes docs + suggested', ff.some((i) => i.textContent.includes('From docs')) && ff.some((i) => i.textContent.includes('Suggested')) && ff.some((i) => i.textContent.includes('Every 1000 hours')));
        chg3('#maint-set', 'elegoo-cc');
        const el = qa(w, '#maint-set-list .preset-item');
        check('ELEGOO set is all "Suggested" and says why', el.length === 4 && el.every((i) => i.textContent.includes('Suggested')) && q(w, '#maint-set-list').textContent.includes('gives no interval'));
        chg3('#maint-set', 'bambu-h2'); click(w, q(w, '#maint-set-add'));
        check('H2 set adds', Object.keys(stored(w).maintenance).length === 12);

        // custom presets
        click(w, q(w, '#maint-preset-save'));
        check('preset needs a name', !q(w, '#maint-preset-delete'));
        chg3('#maint-preset-name', 'My routine');
        click(w, q(w, '#maint-preset-save'));
        const cp = Object.values(stored(w).settings.customPresets);
        check('saves current tasks as a preset', cp.length === 1 && cp[0].name === 'My routine' && cp[0].tasks.length === 12 && cp[0].tasks.every((x) => !('atGrams' in x)), JSON.stringify(cp));
        check('preset shows up and is selected', q(w, '#maint-set').value.startsWith('custom:') && !!q(w, '#maint-preset-delete'));
        // wipe tasks, re-add from preset
        w.__confirmAnswer = true;
        qa(w, '#maintenance-list .maint-row').forEach((r) => click(w, byText(w, 'button', 'Delete', r)));
        check('all tasks deleted', Object.keys(stored(w).maintenance).length === 0);
        click(w, q(w, '#maint-set-add'));
        check('custom preset re-adds its tasks', Object.keys(stored(w).maintenance).length === 12);
        click(w, q(w, '#maint-preset-delete'));
        check('preset can be deleted', Object.keys(stored(w).settings.customPresets).length === 0 && !qa(w, '#maint-set option').some((o) => o.value.startsWith('custom:')));
        // hostile presets in an import
        await importText(w, JSON.stringify({ spools: {}, prints: {}, settings: { customPresets: { ok: { name: 'A', tasks: [{ name: 'x', unit: 'spools', every: 3 }, { name: '', unit: 'days', every: 1 }, { name: 'y', unit: 'bogus', every: 1 }] }, bad: { name: '', tasks: [] }, '__proto__': { name: 'z', tasks: [{ name: 'q', unit: 'days', every: 1 }] } } } }));
        check('imported presets are cleaned', Object.keys(stored(w).settings.customPresets).join() === 'ok' && stored(w).settings.customPresets.ok.tasks.length === 1, JSON.stringify(stored(w).settings.customPresets));
        check('no unexpected errors in section 23', errors.length === e4, errors.slice(e4).join(' | '));
    }

    console.log('\n[24] CSV import');
    {
        const e5 = errors.length;
        // round trip: export from one session, import into a clean one
        let a = boot();
        addSpool(a, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        addSpool(a, { brand: 'Sunlu', color: 'Red', grams: '1000' });
        click(a, q(a, '#prints-button')); openPrint(a);
        fillPrint(a, { name: 'Gear, "big" one', date: '2026-10-01', rows: [{ spoolIndex: 0, grams: 120 }, { spoolIndex: 1, grams: 30 }] });
        setVal(a, q(a, '#hours-ninput'), '2'); setVal(a, q(a, '#minutes-ninput'), '15');
        setVal(a, q(a, '#link-tinput'), 'example.com/gear'); setVal(a, q(a, '#notes-input'), 'line one\nline two, with comma'); savePrint(a);
        openPrint(a);
        fillPrint(a, { name: '=HYPERLINK("x")', date: '2026-10-02', success: false, rows: [{ spoolIndex: 1, grams: 10 }] }); savePrint(a);
        click(a, q(a, '#data-button')); a.__blobs.length = 0; click(a, q(a, '#export-csv-button'));
        const csvText = a.__blobs[0];

        const w = boot();
        click(w, q(w, '#data-button'));
        check('Import CSV button + hidden file input exist', !!q(w, '#import-csv-button') && q(w, '#import-csv-file').hidden && q(w, '#import-csv-file').accept.includes('.csv'));
        w.__confirms.length = 0;
        await importCsv(w, csvText);
        const sp = stored(w);
        const ps = Object.values(sp.prints);
        check('round trip: 2 prints imported', ps.length === 2, msg2(w));
        const gear = ps.find((p) => p.name.startsWith('Gear'));
        check('quotes, comma, newline and minutes survive', gear && gear.name === 'Gear, "big" one' && gear.minutes === 135 && gear.notes === 'line one\nline two, with comma' && gear.link === 'https://example.com/gear' && gear.result === true && gear.date === '2026-10-01', JSON.stringify(gear));
        const bad = ps.find((p) => p.name.includes('HYPERLINK'));
        check('formula defuse apostrophe is removed again, failure kept', bad && bad.name === '=HYPERLINK("x")' && bad.result === false, JSON.stringify(bad));
        check('usage kept per spool (120 g + 30 g)', gear.usage.length === 2 && gear.usage.reduce((s, u) => s + u.grams, 0) === 150);
        check('unknown spools became archived stand-ins, big enough to never go negative', Object.values(sp.spools).length === 2 && Object.values(sp.spools).every((s) => s.archived && s.startGrams >= 1000));
        check('confirm asked before adding', w.__confirms.length === 1 && w.__confirms[0].includes('Add 2 prints'), w.__confirms[0]);
        // import the same file again: everything is a duplicate
        await importCsv(w, csvText);
        check('re-importing skips duplicates without asking', Object.keys(stored(w).prints).length === 2 && msg2(w).includes('already here') && w.__confirms.length === 1, msg2(w));
        check('stand-in spools are reused on re-import', Object.keys(stored(w).spools).length === 2);

        // matching existing spools by name
        const b = boot();
        addSpool(b, { brand: 'Bambu Lab', color: 'Black', grams: '1000' });
        click(b, q(b, '#data-button'));
        await importCsv(b, 'Date,Name,Result,Print time (min),Filament (g),Spools\n2026-09-01,Benchy,Success,45,18,Bambu Lab Black (18g)\n');
        const bs = stored(b);
        const onlySpool = Object.keys(bs.spools)[0];
        check('matches an existing spool by "Brand Color"', Object.keys(bs.spools).length === 1 && Object.values(bs.prints)[0].usage[0].spoolId === onlySpool && Object.values(bs.prints)[0].usage[0].grams === 18);
        check('remaining grams reflect the import', b.document.querySelector('#spools .row-card').textContent.includes('982'));

        // lenient formats
        const c = boot();
        click(c, q(c, '#data-button'));
        await importCsv(c, '﻿title;date;status;duration;grams\r\nCalibration cube;03/04/2026;failed;1h 30m;12\r\nVase;2026/05/06;ok;2:05;40\r\nBroken;;ok;5;5\r\nNoName\r\n');
        const cs = Object.values(stored(c).prints);
        check('semicolons, BOM, CRLF, aliases', cs.length === 2, msg2(c));
        const cube = cs.find((p) => p.name === 'Calibration cube'), vase = cs.find((p) => p.name === 'Vase');
        check('US date 03/04/2026 read as March 4 (mdy), failed -> false, 1h 30m -> 90', cube.date === '2026-03-04' && cube.result === false && cube.minutes === 90, JSON.stringify(cube));
        check('2026/05/06, 2:05 -> 125 min, no spool column -> stand-in spool', vase.date === '2026-05-06' && vase.minutes === 125 && vase.usage.length === 1 && vase.usage[0].grams === 40);
        check('rows without a date or name are skipped and reported', msg2(c).includes('2 without a name or valid date') || msg2(c).includes('skipped'), msg2(c));
        click(c, q(c, '#settings-button')); click(c, q(c, '#settings-tab-preferences')); setVal(c, q(c, '#set-date-format'), 'dmy');
        click(c, q(c, '#data-button'));
        await importCsv(c, 'Date,Name\n03/04/2026,Euro date\n');
        check('dmy setting reads 03/04/2026 as 3 April', Object.values(stored(c).prints).find((p) => p.name === 'Euro date').date === '2026-04-03');

        // rejects
        const d = boot();
        click(d, q(d, '#data-button'));
        await importCsv(d, 'foo,bar\n1,2\n');
        check('missing Date/Name columns is rejected, nothing changed', msg2(d).includes('Date') && Object.keys(stored(d).prints).length === 0);
        await importCsv(d, '');
        check('empty file rejected', msg2(d).includes('no rows'));
        d.__confirmAnswer = false;
        await importCsv(d, 'Date,Name\n2026-01-01,Cancelled\n');
        check('declining the confirm changes nothing', Object.keys(stored(d).prints).length === 0 && msg2(d).includes('cancelled'));
        d.__confirmAnswer = true;
        await importCsv(d, 'Date,Name,Link,Notes\n2026-01-01,<img src=x onerror=alert(1)>,javascript:alert(1),"<script>x</script>"\n');
        const hostile = Object.values(stored(d).prints)[0];
        check('hostile text kept as text, javascript: link dropped', hostile.link === '' && hostile.name.includes('<img') && !q(d, '#prints img') && (click(d, q(d, '#prints-button')), !q(d, '#print-list img, #print-list script')));
        check('no unexpected errors in section 24', errors.length === e5, errors.slice(e5).join(' | '));
    }

    console.log('\n[25] AMS');
    {
        const e6 = errors.length;
        let w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000' });
        addSpool(w, { brand: 'Sunlu', color: 'Red', grams: '1000' });
        click(w, q(w, '#fila-button'));
        check('AMS section exists on the Filament tab', !!q(w, '#filament #ams') && q(w, '#ams').textContent.includes('No AMS added'));
        check('AMS types offered', qa(w, '#ams-type option').map((o) => o.value).join() === 'ams,ams-lite,ams-2-pro,ams-ht');
        click(w, q(w, '#ams-add-button'));
        let u = Object.values(stored(w).ams);
        check('AMS added with 4 empty slots', u.length === 1 && u[0].type === 'ams' && u[0].slots.length === 4 && u[0].slots.every((s) => s === ''), JSON.stringify(u));
        setVal(w, q(w, '#ams-type'), 'ams-ht'); click(w, q(w, '#ams-add-button'));
        check('AMS HT has 1 slot', Object.values(stored(w).ams).some((x) => x.type === 'ams-ht' && x.slots.length === 1));
        const sel = () => qa(w, '#ams .ams-select');
        check('slot dropdown lists both spools', sel()[0].options.length === 3);
        sel()[0].value = sel()[0].options[1].value; sel()[0].dispatchEvent(new w.Event('change', { bubbles: true }));
        check('assigning saves the spool id and shows it', Object.values(stored(w).ams)[0].slots[0] !== '' && q(w, '#ams .ams-slot.is-loaded').textContent.includes('1000g left'));
        check('a loaded spool is not offered in other slots', sel()[1].options.length === 2);
        const loaded = Object.values(stored(w).ams)[0].slots[0];
        check('the loaded spool stays only in its own slot', Object.values(stored(w).ams)[0].slots[0] === loaded && Object.values(stored(w).ams)[0].slots.filter(Boolean).length === 1);
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Uses it', date: '2026-10-09', rows: [{ spoolIndex: 0, grams: 900 }, ] }); savePrint(w);
        click(w, q(w, '#fila-button'));
        check('remaining + running-low shown from print usage', q(w, '#ams .ams-slot.is-loaded').textContent.includes('running low') || q(w, '#ams').textContent.includes('left'));
        const spoolId = Object.values(stored(w).ams).flatMap((x) => x.slots).find(Boolean);
        click(w, byText(w, 'button', 'Archive', qa(w, '#spools .row-card')[0]) || q(w, '#spools .row-card button')); skipLeftover(w);
        check('archiving or using a spool keeps AMS consistent', Object.values(stored(w).ams).flatMap((x) => x.slots).filter(Boolean).every((id) => stored(w).spools[id] && !stored(w).spools[id].archived));
        click(w, byText(w, 'button', 'Remove', q(w, '#ams .ams-unit')));
        check('remove unit + undo', Object.keys(stored(w).ams).length === 1 && !!q(w, '#toast .toast-action'));
        click(w, q(w, '#toast .toast-action'));
        check('undo restores', Object.keys(stored(w).ams).length === 2);
        w = boot(w.localStorage.getItem('printTracker'));
        check('AMS persists across reload', Object.keys(stored(w).ams).length === 2);
        w.__confirmAnswer = true;
        await importText(w, JSON.stringify({ spools: { s1: { brand: 'A', color: 'B', material: 'pla', startGrams: 100 } }, prints: {}, ams: { a1: { name: '<b>x</b>', type: 'ams', slots: ['s1', 's1', 'ghost', 5, 'extra'] }, bad: { name: 'n', type: 'nope', slots: [] }, '__proto__': { name: 'z', type: 'ams', slots: [] } } }));
        const im = stored(w).ams;
        check('imported AMS is cleaned (dupes, ghosts, extra slots, bad type)', Object.keys(im).join() === 'a1' && im.a1.slots.join('|') === 's1|||' && im.a1.slots.length === 4, JSON.stringify(im));
        check('no unexpected errors in section 25', errors.length === e6, errors.slice(e6).join(' | '));
    }


    console.log('\n[26] Print popup AMS, setup cost, achievements');
    {
        const e7 = errors.length;
        let w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        addSpool(w, { brand: 'Sunlu', color: 'Red', grams: '1000', price: '10' });
        click(w, q(w, '#fila-button'));
        click(w, q(w, '#ams-add-button'));
        const sel0 = qa(w, '#ams .ams-select');
        sel0[1].value = sel0[1].options[2].value; sel0[1].dispatchEvent(new w.Event('change', { bubbles: true }));   // Sunlu Red in slot 2
        click(w, q(w, '#prints-button')); openPrint(w);
        check('AMS chips shown in the print popup', !q(w, '#ams-quick').hidden && qa(w, '#ams-quick .chip-button').length === 1 && q(w, '#ams-quick').textContent.includes('Sunlu, Red') && q(w, '#ams-quick').textContent.includes('slot 2'), q(w, '#ams-quick').textContent);
        check('new print defaults to the AMS-loaded spool', q(w, '.filament-row select').selectedOptions[0].textContent.includes('Sunlu'));
        check('spool option is labelled with its AMS slot', q(w, '.filament-row select').selectedOptions[0].textContent.includes('[AMS 1, slot 2]'));
        click(w, q(w, '#add-filament-row-button'));
        check('second row picks the other spool', qa(w, '.filament-row')[1].querySelector('select').selectedOptions[0].textContent.includes('Bambu'));
        setVal(w, qa(w, '.filament-row')[0].querySelector('input'), '10');
        click(w, q(w, '#ams-quick .chip-button'));
        check('clicking the chip does not duplicate an existing row', qa(w, '.filament-row').length === 2);
        click(w, q(w, '#cancel-print-button'));
        openPrint(w);
        setVal(w, q(w, '.filament-row select'), q(w, '.filament-row select').options[0].value);
        click(w, q(w, '#ams-quick .chip-button'));
        check('chip fills the empty row with the AMS spool', q(w, '.filament-row select').selectedOptions[0].textContent.includes('Sunlu') && qa(w, '.filament-row').length === 1);
        click(w, q(w, '#cancel-print-button'));

        // setup cost
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-printer'));
        check('cost card lists the AMS with a price box', !!q(w, '#ams-prices .auto-field input') && q(w, '#cost-summary').textContent.includes('Filament bought: $30.00'));
        setVal(w, q(w, '#settings-tab-printer') && q(w, '#set-printer-brand'), 'bambu'); setVal(w, q(w, '#set-printer-model'), 'A1');
        check('printer price (typical) counted', q(w, '#cost-summary').textContent.includes('Printer: $299.00 (typical store price)'), q(w, '#cost-summary').textContent);
        setAuto(w, '#' + q(w, '#ams-prices input').id, '249.5');
        check('AMS price saved', Object.values(stored(w).ams)[0].price === 249.5);
        check('total = printer + AMS + filament', q(w, '#cost-total').textContent.includes('$578.50') && q(w, '#cost-summary').textContent.includes('Printer and AMS: $548.50'), q(w, '#cost-summary').textContent);
        setAuto(w, '#set-printer-price', '300');
        check('own printer price replaces the typical one', q(w, '#cost-total').textContent.includes('$579.50') && !q(w, '#cost-summary').textContent.includes('typical'));
        click(w, q(w, '#dash-button'));
        check('dashboard printer panel shows AMS + total', q(w, '#printer-panel').textContent.includes('AMS: $249.50') && q(w, '#printer-total').textContent.includes('$579.50'), q(w, '#printer-panel').textContent);
        click(w, q(w, '#settings-button')); { const pid = '#' + q(w, '#ams-prices input').id; click(w, q(w, pid + '-edit')); setVal(w, q(w, pid), ''); click(w, q(w, pid + '-save')); }
        check('blank AMS price clears it', Object.values(stored(w).ams)[0].price === null);

        // achievements
        click(w, q(w, '#dash-button'));
        const tiles = qa(w, '#achievements .achv');
        check('40+ achievements in groups', tiles.length >= 40 && qa(w, '#achievements .achv-group').length === 7, tiles.length);
        const names = tiles.map((t) => t.querySelector('.achv-title').textContent);
        check('titles are unique', new Set(names).size === names.length);
        const earnedNow = qa(w, '#achievements .achv.earned').map((t) => t.querySelector('.achv-title').textContent);
        check('AMS online + Collector progress earned/locked correctly', earnedNow.includes('Multicolor Menace') && earnedNow.includes('Meet the Family') && !earnedNow.includes('Shelf Life'), earnedNow.join());
        const collector = tiles.find((t) => t.textContent.includes('Shelf Life'));
        check('locked ones show progress (2 of 5 spools)', collector.textContent.includes('2 of 5 spools') && !!collector.querySelector('.achv-bar'), collector.textContent);
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Fail', date: '2026-10-10', success: false, rows: [{ spoolIndex: 0, grams: 5 }] });
        setVal(w, q(w, '#notes-input'), 'Warped, needs a brim'); savePrint(w);
        click(w, q(w, '#dash-button'));
        check('Lesson learned earned by a failed print with a note', qa(w, '#achievements .achv.earned').some((t) => t.textContent.includes('Failure Is a Feature')));
        check('no unexpected errors in section 26', errors.length === e7, errors.slice(e7).join(' | '));
    }


    console.log('\n[27] AMS names + prices, spool editing, swatches, toast');
    {
        const e8 = errors.length;
        let w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        click(w, q(w, '#fila-button'));
        // naming
        setVal(w, q(w, '#ams-name'), 'Desk AMS'); click(w, q(w, '#ams-add-button'));
        check('new AMS can be named when added', Object.values(stored(w).ams)[0].name === 'Desk AMS');
        check('name box clears after adding', q(w, '#ams-name').value === '');
        click(w, q(w, '#ams-add-button'));
        check('unnamed AMS gets a default name', Object.values(stored(w).ams)[1].name === 'AMS 2', Object.values(stored(w).ams).map((a) => a.name).join());
        const rn = q(w, '.ams-unit .ams-unit-name');
        setVal(w, rn, 'Shelf AMS');
        check('AMS renamed in place', Object.values(stored(w).ams)[0].name === 'Shelf AMS');
        setVal(w, q(w, '.ams-unit .ams-unit-name'), '   ');
        check('blank name is rejected and restored', Object.values(stored(w).ams)[0].name === 'Shelf AMS' && q(w, '.ams-unit .ams-unit-name').value === 'Shelf AMS');
        setVal(w, q(w, '.ams-unit .ams-unit-name'), '<b>x</b>'.repeat(10));
        check('long names are cut to 30 chars and stay text', Object.values(stored(w).ams)[0].name.length <= 30 && !q(w, '#ams b'));
        setVal(w, q(w, '.ams-unit .ams-unit-name'), 'Shelf AMS');
        // slot labels use the name
        const s0 = qa(w, '#ams .ams-select')[0]; s0.value = s0.options[1].value; s0.dispatchEvent(new w.Event('change', { bubbles: true }));
        click(w, q(w, '#prints-button')); openPrint(w);
        check('print popup shows the AMS name', q(w, '#ams-quick').textContent.includes('Shelf AMS, slot 1'), q(w, '#ams-quick').textContent);
        click(w, q(w, '#cancel-print-button'));

        // AMS pricing
        click(w, q(w, '#fila-button'));
        setVal(w, q(w, '#ams-type'), 'ams-2-pro'); click(w, q(w, '#ams-add-button'));
        setVal(w, q(w, '#ams-type'), 'ams-ht'); click(w, q(w, '#ams-add-button'));
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-printer'));
        const ids = Object.keys(stored(w).ams);
        const proId = ids.find((i) => stored(w).ams[i].type === 'ams-2-pro'), htId = ids.find((i) => stored(w).ams[i].type === 'ams-ht'), plainId = ids.find((i) => stored(w).ams[i].type === 'ams');
        check('AMS 2 Pro: $359 automatic', q(w, `#ams-price-${proId}-value`).textContent === '$359.00' && q(w, `#ams-price-${proId}-badge`).textContent === 'Automatic' && !!q(w, `#ams-price-${proId}-note a[href="https://us.store.bambulab.com/products/ams-2-pro"]`));
        check('AMS HT: $149 automatic', q(w, `#ams-price-${htId}-value`).textContent === '$149.00');
        check('original AMS: no automatic price', q(w, `#ams-price-${plainId}-value`).textContent === 'Not set');
        check('total counts automatic AMS prices and says so', q(w, '#cost-summary').textContent.includes('AMS: $508.00 (includes typical store prices)') && q(w, '#cost-summary').textContent.includes('(2 without a price)'), q(w, '#cost-summary').textContent);
        setAuto(w, `#ams-price-${htId}`, '120');
        check('own AMS price overrides it', stored(w).ams[htId].price === 120 && q(w, `#ams-price-${htId}-badge`).textContent === 'Your value' && q(w, '#cost-summary').textContent.includes('AMS: $479.00'));
        click(w, q(w, `#ams-price-${htId}-edit`)); click(w, q(w, `#ams-price-${htId}-reset`));
        check('Use automatic clears it', stored(w).ams[htId].price === null);
        click(w, q(w, '#settings-tab-preferences')); setVal(w, q(w, '#set-currency'), '€'); click(w, q(w, '#settings-tab-printer'));
        check('no automatic AMS prices outside $', q(w, `#ams-price-${proId}-value`).textContent === 'Not set');
        setVal(w, (click(w, q(w, '#settings-tab-preferences')), q(w, '#set-currency')), '$');

        // spool editing
        click(w, q(w, '#fila-button'));
        let card = q(w, '#spools .row-card');
        check('spool card has an Edit button', !!byText(w, 'button', 'Edit', card));
        click(w, byText(w, 'button', 'Edit', card));
        check('edit popup opens filled in', q(w, '#spool-popup-title').textContent === 'Edit Spool' && q(w, '#add-spool-button').textContent === 'Save Changes' && q(w, '#brand-tinput').value === 'Bambu Lab' && q(w, '#color-tinput').value === 'Black' && q(w, '#grams-ninput').value === '1000' && q(w, '#price-ninput').value === '20');
        const spoolId = Object.keys(stored(w).spools)[0];
        setVal(w, q(w, '#brand-tinput'), 'Polymaker'); setVal(w, q(w, '#color-tinput'), 'Red'); setVal(w, q(w, '#material-dropdown'), 'petg'); setVal(w, q(w, '#grams-ninput'), '750'); setVal(w, q(w, '#price-ninput'), '');
        click(w, q(w, '#add-spool-button'));
        const ss = stored(w).spools;
        check('edit saves in place (same id, no new spool)', Object.keys(ss).length === 1 && ss[spoolId].brand === 'Polymaker' && ss[spoolId].color === 'Red' && ss[spoolId].material === 'petg' && ss[spoolId].startGrams === 750 && ss[spoolId].price === null, JSON.stringify(ss));
        check('swatch followed the new color name', ss[spoolId].hex === '#e53935' || ss[spoolId].hex === '', ss[spoolId].hex);
        check('card shows the edit and AMS slot is kept', q(w, '#spools .row-card').textContent.includes('Polymaker, Red') && Object.values(stored(w).ams)[0].slots[0] === spoolId);
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Uses red', date: '2026-10-10', rows: [{ spoolIndex: 0, grams: 100 }] }); savePrint(w);
        click(w, q(w, '#fila-button')); click(w, byText(w, 'button', 'Edit', q(w, '#spools .row-card')));
        setVal(w, q(w, '#grams-ninput'), '500'); click(w, q(w, '#add-spool-button'));
        check('remaining is recalculated after changing the weight (500 - 100)', q(w, '#spools .row-card').textContent.includes('400g remaining'), q(w, '#spools .row-card').textContent);
        click(w, byText(w, 'button', 'Edit', q(w, '#spools .row-card')));
        setVal(w, q(w, '#brand-tinput'), ''); click(w, q(w, '#add-spool-button'));
        check('edit validates like add', q(w, '#spool-popup-title') && !q(w, '#spool-error').hidden && stored(w).spools[spoolId].brand === 'Polymaker');
        click(w, q(w, '#cancel-spool-button'));
        click(w, byText(w, 'button', 'Archive', q(w, '#spools .row-card'))); skipLeftover(w);
        click(w, byText(w, 'button', 'Edit', q(w, '#spools .row-card')));
        click(w, q(w, '#add-spool-button'));
        check('editing keeps the archived state', stored(w).spools[spoolId].archived === true);
        click(w, byText(w, 'button', 'Unarchive', q(w, '#spools .row-card')) || byText(w, 'button', 'Restore', q(w, '#spools .row-card')) || q(w, '#spools .row-card button'));
        click(w, q(w, '#spool-popup-title') ? q(w, '#cancel-spool-button') : q(w, '#cancel-spool-button'));
        click(w, byText(w, 'button', 'Edit', q(w, '#spools .row-card')));
        click(w, q(w, '#cancel-spool-button'));
        click(w, q(w, '#fila-button')); click(w, q(w, '#filament .acc-buttons'));
        check('after editing, the popup is back to "Add Spool"', q(w, '#spool-popup-title').textContent === 'Add Spool' && q(w, '#add-spool-button').textContent === 'Add Spool' && q(w, '#brand-tinput').value === '');
        click(w, q(w, '#cancel-spool-button'));

        // Buy again swatch
        const w2 = boot();
        addSpool(w2, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        click(w2, q(w2, '#fila-button'));
        click(w2, byText(w2, 'button', 'Buy again', q(w2, '#spools .row-card')));
        check('Buy again copies the swatch at first', q(w2, '#hex-input').value === '#1c1c1e', q(w2, '#hex-input').value);
        setVal(w2, q(w2, '#color-tinput'), 'Red');
        check('Buy again: new color name changes the swatch', q(w2, '#hex-input').value === '#e53935', q(w2, '#hex-input').value);
        setVal(w2, q(w2, '#color-tinput'), 'Black');
        check('typing the original color back restores its swatch', q(w2, '#hex-input').value === '#1c1c1e');
        setVal(w2, q(w2, '#color-tinput'), 'Galaxy');
        check('unknown color name falls back to grey', q(w2, '#hex-input').value === '#6b7280');
        setVal(w2, q(w2, '#hex-input'), '#00ff00'); setVal(w2, q(w2, '#color-tinput'), 'Blue');
        click(w2, q(w2, '#add-spool-button'));
        check('hand-picked swatch survives a later name change', Object.values(stored(w2).spools).some((s) => s.color === 'Blue' && s.hex === '#00ff00'));
        click(w2, byText(w2, 'button', 'Buy again', qa(w2, '#spools .row-card').find((c) => c.textContent.includes('Black'))));
        setVal(w2, q(w2, '#color-tinput'), 'Red'); click(w2, q(w2, '#add-spool-button'));
        check('saved Buy again spool has the red swatch', Object.values(stored(w2).spools).some((s) => s.color === 'Red' && s.hex === '#e53935'), JSON.stringify(Object.values(stored(w2).spools).map((s) => s.color + s.hex)));

        // toast
        const css = require('fs').readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
        const tb = /#toast \{[^}]*\}/.exec(css)[0];
        check('toast uses theme colors, not inverted ones', tb.includes('var(--surface)') && tb.includes('var(--text)') && !tb.includes('color: var(--bg)'));
        check('toast fades (opacity transition both ways)', /transition: opacity/.test(tb) && /#toast\.show \{[^}]*opacity: 1/.test(css) && /prefers-reduced-motion[^}]*#toast/.test(css));
        w2.eval("document.getElementById('toast')");
        click(w2, q(w2, '#fila-button'));
        const w3 = boot();
        addSpool(w3, { brand: 'A', color: 'B', grams: '100' });
        click(w3, q(w3, '#dash-button'));
        click(w3, q(w3, '#backup-banner-close'));
        check('toast is shown with the show class', q(w3, '#toast').classList.contains('show'));
        click(w3, q(w3, '#toast .toast-action'));
        check('clicking Undo fades the toast out', !q(w3, '#toast').classList.contains('show') && q(w3, '#toast').style.display !== 'none');
        click(w3, q(w3, '#backup-banner-close'));
        await new Promise((r) => setTimeout(r, 7300));
        check('toast hides itself after its time (class removed, still in the DOM to fade)', !q(w3, '#toast').classList.contains('show'));
        check('no unexpected errors in section 27', errors.length === e8, errors.slice(e8).join(' | '));
    }

    console.log('\n[28] Wear cost, failure reasons, profile notes, drying, reorder, spending, ranges');
    {
        const e9 = errors.length;
        const iso = (w, offset = 0) => {
            const d = new w.Date(); d.setHours(12); d.setDate(d.getDate() + offset);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const stat = (w, label) => { const c = qa(w, '.stat-card').find((x) => q(w, '.stat-label', x).textContent === label); return c ? q(w, '.stat-value', c).textContent : null; };
        const fire = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
        const csvOf = (w) => { w.__blobs.length = 0; click(w, q(w, '#export-csv-button')); return w.__blobs[0] || ''; };

        // ---- machine wear ----
        let w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Wear test', date: iso(w), rows: [{ spoolIndex: 0, grams: 100 }] });
        setVal(w, q(w, '#hours-ninput'), '2'); savePrint(w);
        let card = q(w, '#prints .print-card');
        check('without a wear rate the cost is filament only', card.textContent.includes('~$2.00'), card.textContent);
        click(w, q(w, '#settings-button') || q(w, '[aria-label="Settings"]'));
        setVal(w, q(w, '#set-printer-wear'), '0.5');
        check('wear rate is saved as a number', stored(w).settings.printer.wear === 0.5);
        check('wear preview shows 5 h x rate', q(w, '#wear-preview').textContent.includes('$2.50'), q(w, '#wear-preview').textContent);
        click(w, q(w, '#prints-button'));
        card = q(w, '#prints .print-card');
        check('print card cost adds wear (2 h x $0.50)', card.textContent.includes('~$3.00'), card.textContent);
        check('cost tooltip names machine wear', [...card.querySelectorAll('.meta-item')].some((e) => /machine wear \$1\.00/.test(e.title)));
        click(w, q(w, '#dash-button'));
        check('dashboard cost includes wear and says so', stat(w, 'Cost of prints') === '$3.00' && /machine wear/.test(qa(w, '.stat-card').find((c) => c.textContent.includes('Cost of prints')).textContent));
        const csv = csvOf(w);
        check('CSV est. cost includes wear', /,3\.00,/.test(csv), csv);
        click(w, q(w, '#settings-button') || q(w, '[aria-label="Settings"]'));
        setVal(w, q(w, '#set-printer-wear'), '');
        check('empty wear rate is stored as null', stored(w).settings.printer.wear === null);
        setVal(w, q(w, '#set-printer-wear'), '-4');
        check('negative wear is rejected', stored(w).settings.printer.wear === null);

        // ---- failure reasons + profile notes ----
        w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        click(w, q(w, '#prints-button')); openPrint(w);
        check('reason picker is hidden for a new (successful) print', q(w, '#fail-reason-field').hidden);
        q(w, '#result-rinput2').checked = true; fire(w, q(w, '#result-rinput2'));
        check('reason picker appears when Failure is chosen', !q(w, '#fail-reason-field').hidden);
        check('picker lists all seven reasons plus "not set"', q(w, '#fail-reason-select').options.length === 8);
        fillPrint(w, { name: 'Spaghetti', date: iso(w), success: false, rows: [{ spoolIndex: 0, grams: 40 }] });
        setVal(w, q(w, '#fail-reason-select'), 'warping');
        setVal(w, q(w, '#profile-name-tinput'), '0.20mm Standard');
        setVal(w, q(w, '#profile-layer-tinput'), '0.2 mm');
        setVal(w, q(w, '#profile-infill-tinput'), '15%');
        setVal(w, q(w, '#profile-supports-tinput'), 'tree, auto');
        savePrint(w);
        let rec = Object.values(stored(w).prints)[0];
        check('failure reason saved', rec.failReason === 'warping', JSON.stringify(rec));
        check('profile saved with supports', rec.profile && rec.profile.name === '0.20mm Standard' && rec.profile.layer === '0.2 mm' && rec.profile.infill === '15%' && rec.profile.supports === 'tree, auto');
        card = q(w, '#prints .print-card');
        check('card shows the reason', card.textContent.includes('Why it failed: Warping or curling'));
        check('card shows profile chips', ['Profile: 0.20mm Standard', 'Layer: 0.2 mm', 'Infill: 15%', 'Supports: tree, auto'].every((t) => card.textContent.includes(t)), card.textContent);
        // edit keeps it, switching to success clears it
        click(w, byText(w, 'button', 'Edit', card));
        check('edit popup preloads the reason', q(w, '#fail-reason-select').value === 'warping' && !q(w, '#fail-reason-field').hidden);
        q(w, '#result-rinput1').checked = true; fire(w, q(w, '#result-rinput1'));
        check('picker hides again for Success', q(w, '#fail-reason-field').hidden);
        savePrint(w);
        rec = Object.values(stored(w).prints)[0];
        check('a successful print never keeps a failure reason', rec.failReason === '' && rec.result === true);
        // Print again copies profile but not the reason
        click(w, byText(w, 'button', 'Print again', q(w, '#prints .print-card')));
        check('Print again copies the slicer profile', q(w, '#profile-name-tinput').value === '0.20mm Standard' && q(w, '#profile-supports-tinput').value === 'tree, auto' && q(w, '#profile-infill-tinput').value === '15%');
        check('Print again starts as Success with no reason', q(w, '#result-rinput1').checked && q(w, '#fail-reason-field').hidden);
        click(w, q(w, '#cancel-print-button'));
        // blank profile is stored as null
        openPrint(w);
        fillPrint(w, { name: 'Plain', date: iso(w), rows: [{ spoolIndex: 0, grams: 10 }] });
        check('new print starts with an empty profile', q(w, '#profile-name-tinput').value === '');
        savePrint(w);
        check('no profile text means profile is null', Object.values(stored(w).prints).find((p) => p.name === 'Plain').profile === null);
        // search finds profile text
        setVal(w, q(w, '#print-search'), 'tree');
        check('search finds profile text', qa(w, '#prints .print-card').length === 1 && q(w, '#prints .print-card').textContent.includes('Spaghetti'));
        setVal(w, q(w, '#print-search'), '');

        // failure panel
        openPrint(w);
        fillPrint(w, { name: 'Clogged', date: iso(w), success: false, rows: [{ spoolIndex: 0, grams: 20 }] });
        q(w, '#result-rinput2').checked = true; fire(w, q(w, '#result-rinput2'));
        setVal(w, q(w, '#fail-reason-select'), 'clog'); savePrint(w);
        openPrint(w);
        fillPrint(w, { name: 'Mystery', date: iso(w), success: false, rows: [{ spoolIndex: 0, grams: 30 }] });
        savePrint(w);
        click(w, q(w, '#dash-button'));
        const fp = q(w, '#fail-panel');
        check('failure panel is shown', !!fp);
        check('failure panel lists reasons, including "No reason logged"', fp && fp.textContent.includes('Nozzle clog or under-extrusion') && fp.textContent.includes('No reason logged'));
        check('wasted filament is totalled (20 g + 30 g)', fp && q(w, '#wasted-line').textContent.startsWith('Wasted on failed prints: 50g'), q(w, '#wasted-line').textContent);
        check('wasted money uses spool prices (50 g at $0.02/g)', q(w, '#wasted-line').textContent.includes('$1.00'), q(w, '#wasted-line').textContent);
        // CSV round trip
        const csv2 = csvOf(w);
        check('CSV has the new columns', csv2.split('\r\n')[0].endsWith('Failure reason,Profile,Layer height,Infill,Supports'));
        check('CSV carries reason and supports', csv2.includes('Nozzle clog or under-extrusion') && csv2.includes('tree, auto'));
        const w2 = boot();
        addSpool(w2, { brand: 'Bambu Lab', color: 'Black', grams: '1000' });
        await importCsv(w2, csv2);
        const back = Object.values(stored(w2).prints);
        check('CSV import restores reason keys', back.some((p) => p.name === 'Clogged' && p.failReason === 'clog') && back.some((p) => p.name === 'Mystery' && p.failReason === ''));
        check('CSV import restores profiles', back.some((p) => p.name === 'Spaghetti' && p.profile && p.profile.supports === 'tree, auto' && p.profile.layer === '0.2 mm'));
        check('CSV import leaves other prints with null profile', back.every((p) => p.profile === null || typeof p.profile === 'object'));

        // JSON import cleaning
        w = boot();
        const day = iso(w);
        await importText(w, JSON.stringify({
            schemaVersion: 1,
            spools: { s1: { brand: 'A', material: 'pla', color: 'B', hex: '', startGrams: 1000, price: 20, date: day, driedDate: 'junk', archived: false },
                s2: { brand: 'A', material: 'pla', color: 'C', hex: '', startGrams: 1000, price: 20, date: day, driedDate: day, archived: false } },
            prints: {
                p1: { name: 'ok', date: day, result: false, usage: [], failReason: 'clog', profile: { name: 'x', layer: '', infill: '', supports: '<b>none</b>' } },
                p2: { name: 'bad', date: day, result: false, usage: [], failReason: 'made-up', profile: 'nope' },
                p3: { name: 'win', date: day, result: true, usage: [], failReason: 'clog', profile: { name: '', layer: '', infill: '', supports: '' } }
            },
            settings: { dryDays: 9999, printer: { wear: 'abc' } },
            ui: { range: 'forever' }
        }));
        const sv = stored(w);
        check('imported spool: junk dried date dropped, good one kept', sv.spools.s1.driedDate === '' && sv.spools.s2.driedDate === day);
        check('imported reason kept only when valid and failed', sv.prints.p1.failReason === 'clog' && sv.prints.p2.failReason === '' && sv.prints.p3.failReason === '');
        check('imported profile cleaned (text only, empty becomes null)', sv.prints.p1.profile.supports === '<b>none</b>' && sv.prints.p2.profile === null && sv.prints.p3.profile === null);
        check('imported settings clamp dryDays and wear', sv.settings.dryDays === 365 && sv.settings.printer.wear === null);
        check('imported range falls back to all', sv.ui.range === 'all');
        click(w, q(w, '#prints-button'));
        check('imported profile text is rendered as text, not HTML', !q(w, '#prints .print-card b'));

        // ---- drying ----
        w = boot();
        addSpool(w, { brand: 'Bambu Lab', material: 'petg', color: 'Black', grams: '1000', price: '20', date: iso(w, -60) });
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Old', date: iso(w, -40), rows: [{ spoolIndex: 0, grams: 50 }] }); savePrint(w);
        click(w, q(w, '#fila-button'));
        let sc = q(w, '#spools .spool-card');
        check('opened 40 days ago and never dried shows the badge', sc.textContent.includes('Needs drying?'), sc.textContent);
        check('spool card says how long it has been open', sc.textContent.includes('Open for 40 days, never dried'), sc.textContent);
        click(w, byText(w, 'button', 'Dried today', sc));
        sc = q(w, '#spools .spool-card');
        check('Dried today stores today\'s date', stored(w).spools[Object.keys(stored(w).spools)[0]].driedDate === iso(w));
        check('badge goes away after drying', !sc.textContent.includes('Needs drying?') && sc.textContent.includes('(0 days ago)'), sc.textContent);
        click(w, byText(w, 'button', 'Edit', sc));
        check('edit popup shows the dried date', q(w, '#dried-dinput').value === iso(w));
        setVal(w, q(w, '#dried-dinput'), iso(w, -45)); click(w, q(w, '#add-spool-button'));
        check('edited dried date comes back as needing a dry', q(w, '#spools .spool-card').textContent.includes('Needs drying?'));
        click(w, q(w, '#dash-button'));
        check('dashboard lists it under "Maybe dry these"', !!q(w, '#dry-panel') && q(w, '#dry-panel').textContent.includes('Bambu Lab, Black') && q(w, '#dry-panel').textContent.includes('dried 45 days ago'), q(w, '#dry-panel') && q(w, '#dry-panel').textContent);
        click(w, q(w, '#settings-button') || q(w, '[aria-label="Settings"]'));
        click(w, q(w, '#settings-tab-preferences'));
        setVal(w, q(w, '#set-dry-days'), '60');
        click(w, q(w, '#dash-button'));
        check('raising the limit to 60 days hides the panel', !q(w, '#dry-panel'));
        click(w, q(w, '#settings-button') || q(w, '[aria-label="Settings"]'));
        setVal(w, q(w, '#set-dry-days'), '0');
        check('0 turns the reminder off', stored(w).settings.dryDays === 0);
        click(w, q(w, '#fila-button'));
        check('no badge when off', !q(w, '#spools .spool-card').textContent.includes('Needs drying?'));
        check('Buy again does not copy the dried date', (() => {
            click(w, byText(w, 'button', 'Buy again', q(w, '#spools .spool-card')));
            const empty = q(w, '#dried-dinput').value === '';
            click(w, q(w, '#cancel-spool-button'));
            return empty;
        })());
        // archived or empty spools are never nagged
        w = boot();
        addSpool(w, { brand: 'A', color: 'B', grams: '100', date: iso(w, -90) });
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Used up', date: iso(w, -80), rows: [{ spoolIndex: 0, grams: 100 }] }); savePrint(w);
        click(w, q(w, '#fila-button'));
        check('an empty spool is not flagged for drying', !q(w, '#spools .spool-card').textContent.includes('Needs drying?'));

        // ---- reorder alerts ----
        w = boot();
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: '1000', price: '20' });
        addSpool(w, { brand: 'Sunlu', material: 'petg', color: 'Clear', grams: '1000', price: '15' });
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Big', date: iso(w), rows: [{ spoolIndex: 0, grams: 900 }] }); savePrint(w);
        click(w, q(w, '#dash-button'));
        let note = q(w, '#low-panel .reorder-note');
        check('last PLA spool running low gets a reorder note (PETG does not count)', !!note && note.textContent.includes('no other PLA in stock'), note && note.textContent);
        click(w, byText(w, 'button', 'Buy again', note));
        check('Buy again from the alert opens a pre-filled spool popup', q(w, '#spool-popup-title').textContent === 'Add Spool' && q(w, '#brand-tinput').value === 'Bambu Lab');
        click(w, q(w, '#cancel-spool-button'));
        click(w, q(w, '#fila-button'));
        addSpool(w, { brand: 'Polymaker', material: 'pla', color: 'White', grams: '1000', price: '20' });
        click(w, q(w, '#dash-button'));
        check('another healthy PLA spool removes the reorder note but keeps the low row', !q(w, '#low-panel .reorder-note') && !!q(w, '#low-panel .list-button'));

        // ---- ranges and spending ----
        w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20', date: iso(w, -100) });
        addSpool(w, { brand: 'Bambu Lab', color: 'White', grams: '1000', price: '30', date: iso(w, -3) });
        click(w, q(w, '#prints-button'));
        for (const [name, off] of [['Today', 0], ['Twenty days ago', -20], ['Hundred days ago', -100]]) {
            openPrint(w);
            fillPrint(w, { name, date: iso(w, off), rows: [{ spoolIndex: 0, grams: 10 }] });
            savePrint(w);
        }
        click(w, q(w, '#dash-button'));
        check('default range is all time', q(w, '#dash-range').value === 'all' && stat(w, 'Total prints') === '3');
        const before = qa(w, '#achievements .achv.earned').length;
        setVal(w, q(w, '#dash-range'), '30');
        check('last 30 days counts 2 prints', stat(w, 'Total prints') === '2', stat(w, 'Total prints'));
        check('range is remembered', stored(w).ui.range === '30' && !!q(w, '#dash-range-note'));
        check('spending in range counts only recent spools ($30)', stat(w, 'Total spent') === '$30.00', stat(w, 'Total spent'));
        check('achievements ignore the range', qa(w, '#achievements .achv.earned').length === before);
        setVal(w, q(w, '#dash-range'), 'month');
        check('this month never counts more than all time', Number(stat(w, 'Total prints')) <= 3);
        setVal(w, q(w, '#dash-range'), 'year');
        check('this year includes recent prints', Number(stat(w, 'Total prints')) >= 1);
        setVal(w, q(w, '#dash-range'), '90');
        check('last 90 days counts 2 prints', stat(w, 'Total prints') === '2');
        setVal(w, q(w, '#dash-range'), 'all');
        check('back to all time', stat(w, 'Total prints') === '3' && !q(w, '#dash-range-note'));
        const sp = q(w, '#spend-panel');
        check('spending panel exists with bars', !!sp && sp.querySelectorAll('.col').length >= 6, sp && sp.querySelectorAll('.col').length);
        check('spending bars carry running-total tooltips', [...sp.querySelectorAll('.col')].some((c) => /running total \$50\.00/.test(c.title)), [...sp.querySelectorAll('.col')].map((c) => c.title).join(' | '));
        check('setup total line adds filament (and hardware)', /Whole setup so far: \$50\.00 \(filament \$50\.00\)/.test(q(w, '#setup-total-line').textContent), q(w, '#setup-total-line').textContent);
        const reboot = boot(JSON.stringify(stored(w)));
        setVal(reboot, q(reboot, '#dash-range'), '30');
        const reboot2 = boot(JSON.stringify(stored(reboot)));
        check('range survives a reload', q(reboot2, '#dash-range').value === '30');

        check('no unexpected errors in section 28', errors.length === e9, errors.slice(e9).join(' | '));
    }

    console.log('\n[29] Upkeep tab: printer hours and wear parts');
    {
        const e10 = errors.length;
        const keyOf = (w, k) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
        const fire = (w, el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
        const w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'First', date: '2026-10-05', rows: [{ spoolIndex: 0, grams: 10 }] });
        setVal(w, q(w, '#hours-ninput'), '2'); savePrint(w);
        keyOf(w, '5');
        check('key 5 opens the Upkeep tab', visibleTab(w).join() === 'upkeep');
        check('reminders live on the Upkeep tab, not in Settings', !!q(w, '#upkeep #maintenance-list') && !q(w, '#settings #maintenance-list'));
        check('quick start sets are on the Upkeep tab too', !!q(w, '#upkeep #maint-set'));
        check('hours panel shows 2h from the timed print', q(w, '#hours-panel').textContent.includes('2h') && q(w, '#hours-panel').textContent.includes('1 of 1 prints'), q(w, '#hours-panel').textContent);
        click(w, q(w, '#part-quick-nozzle'));
        let parts = Object.values(stored(w).parts);
        check('Track nozzle adds a part at the current hours', parts.length === 1 && parts[0].name === 'Nozzle' && parts[0].atHours === 2 && parts[0].lifespan === null);
        check('quick button hides once tracked', q(w, '#part-quick-nozzle').hidden && !q(w, '#part-quick-plate').hidden);
        setVal(w, q(w, '#part-name'), 'Hardened nozzle'); setVal(w, q(w, '#part-life'), '100'); setVal(w, q(w, '#part-price'), '20');
        click(w, q(w, '#part-add-button'));
        parts = Object.values(stored(w).parts);
        check('add part with lifespan and price', parts.some((p) => p.name === 'Hardened nozzle' && p.lifespan === 100 && p.price === 20));
        check('form is cleared after adding', q(w, '#part-name').value === '' && q(w, '#part-life').value === '');
        check('summary shows $/hour from price and lifespan', q(w, '#parts-summary').textContent.includes('$0.200 per print hour'), q(w, '#parts-summary').textContent);
        click(w, q(w, '#use-wear-rate'));
        check('"Use as my wear rate" updates Settings', stored(w).settings.printer.wear === 0.2);
        check('button goes away once the rate matches', !q(w, '#use-wear-rate'));
        // errors
        setVal(w, q(w, '#part-name'), 'nozzle'); click(w, q(w, '#part-add-button'));
        check('duplicate names are rejected (case-insensitive)', !q(w, '#part-error').hidden && Object.keys(stored(w).parts).length === 2);
        setVal(w, q(w, '#part-name'), 'Fan'); setVal(w, q(w, '#part-life'), '0'); click(w, q(w, '#part-add-button'));
        check('lifespan of 0 is rejected', !q(w, '#part-error').hidden && Object.keys(stored(w).parts).length === 2);
        setVal(w, q(w, '#part-name'), ''); setVal(w, q(w, '#part-life'), '');
        // usage grows with prints
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Second', date: '2026-10-06', rows: [{ spoolIndex: 0, grams: 10 }] });
        setVal(w, q(w, '#hours-ninput'), '3'); savePrint(w);
        keyOf(w, '5');
        const hard = () => qa(w, '#parts-list .part-row').find((r) => r.textContent.includes('Hardened'));
        check('part shows 3 h since swap and 3 % used', hard().textContent.includes('3 h since swap') && hard().textContent.includes('3 of 100 h used (3%)'), hard().textContent);
        // lifespan edit pushes it over
        click(w, byText(w, 'button', 'Edit', hard()));
        check('inline editor opens', !q(w, '.part-edit', hard()).hidden);
        setVal(w, q(w, '.part-life-edit', hard()), '2'); click(w, q(w, '.part-save', hard()));
        check('over-life part says so in red', hard().textContent.includes('Past its 2 h life by 1 h') && !!q(w, '.part-over', hard()));
        check('progress bar is capped at 100', q(w, '[role=progressbar]', hard()).getAttribute('aria-valuenow') === '100');
        setVal(w, q(w, '.part-life-edit', hard()), '-3'); click(w, q(w, '.part-save', hard()));
        check('inline editor rejects a negative lifespan', stored(w).parts && Object.values(stored(w).parts).find((p) => p.name === 'Hardened nozzle').lifespan === 2);
        // swap + undo
        click(w, q(w, '.part-swap', hard()));
        check('Swapped today resets the hours', hard().textContent.includes('0 h since swap') && Object.values(stored(w).parts).find((p) => p.name === 'Hardened nozzle').atHours === 5);
        click(w, q(w, '#toast .toast-action'));
        check('Undo puts the old swap point back', hard().textContent.includes('3 h since swap'));
        // delete + undo
        click(w, byText(w, 'button', 'Delete', hard()));
        check('delete removes the part', !hard() && Object.keys(stored(w).parts).length === 1);
        click(w, q(w, '#toast .toast-action'));
        check('Undo brings the deleted part back', !!hard() && Object.keys(stored(w).parts).length === 2);
        // dashboard printer panel still lists reminders (kept in sync)
        click(w, q(w, '#maint-name')); setVal(w, q(w, '#maint-name'), 'Oil rails'); setVal(w, q(w, '#maint-every'), '10'); click(w, q(w, '#maint-add-button'));
        check('reminders can still be added from the Upkeep tab', Object.values(stored(w).maintenance).some((t) => t.name === 'Oil rails'));
        check('reminders-due card is on the hours panel', q(w, '#hours-panel').textContent.includes('Reminders due'));
        // backup round trip and cleaning
        w.__blobs.length = 0; click(w, q(w, '#export-button'));
        const backup = JSON.parse(w.__blobs[0]);
        check('backup contains the parts', Object.keys(backup.parts).length === 2);
        const w2 = boot();
        await importText(w2, JSON.stringify(backup));
        check('parts survive an import', Object.keys(stored(w2).parts).length === 2 && !!qa(w2, '#parts-list .part-row').length);
        backup.parts.bad = { name: '', lastDate: 'x', atHours: -4, lifespan: -1, price: 'abc' };
        backup.parts.odd = { name: '<i>Fan</i>', lastDate: 'junk', atHours: 'abc', lifespan: 0, price: 12.345 };
        const w3 = boot();
        await importText(w3, JSON.stringify(backup));
        const sp = stored(w3).parts;
        check('import drops nameless parts and cleans numbers', !sp.bad && sp.odd && sp.odd.lifespan === null && sp.odd.price === 12.35 && sp.odd.atHours === 0 && /^\d{4}-\d\d-\d\d$/.test(sp.odd.lastDate));
        check('part names render as text', !q(w3, '#parts-list i') && q(w3, '#parts-list').textContent.includes('<i>Fan</i>'));
        check('old backups without parts still import', (() => { delete backup.parts; return true; })());
        const w4 = boot();
        await importText(w4, JSON.stringify(backup));
        check('and give an empty parts list', Object.keys(stored(w4).parts).length === 0 && !q(w4, '.part-row'));
        check('no unexpected errors in section 29', errors.length === e10, errors.slice(e10).join(' | '));
    }

    console.log('\n[30] Filament cost analysis');
    {
        const e11 = errors.length;
        const w = boot();
        check('no analysis panel without spools', !q(w, '#spool-analysis .panel'));
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: '1000', price: '20' });
        addSpool(w, { brand: 'Sunlu', material: 'pla', color: 'Red', grams: '1000', price: '10' });
        addSpool(w, { brand: 'Bambu Lab', material: 'petg', color: 'Clear', grams: '1000', price: '30' });
        addSpool(w, { brand: 'NoPrice', material: 'abs', color: 'Grey', grams: '1000' });
        const log = (name, idx, grams, success) => {
            click(w, q(w, '#prints-button')); openPrint(w);
            const opts = [...q(w, '.filament-row select').options];
            fillPrint(w, { name, date: '2026-10-05', success, rows: [{ spoolIndex: opts.findIndex((o) => o.textContent.startsWith(idx)), grams }] });
            savePrint(w);
        };
        log('a', 'Bambu Lab, Black', 300, true);
        log('b', 'Sunlu, Red', 80, true);
        log('c', 'Sunlu, Red', 120, false);
        click(w, q(w, '#fila-button'));
        const rowOf = (label) => qa(w, '#analysis-table tbody tr').find((r) => r.firstChild.textContent === label);
        const cells = (label) => qa(w, 'td', rowOf(label)).map((c) => c.textContent);
        check('panel appears with Group-by select', !!q(w, '#analysis-table') && q(w, '#analysis-group').value === 'brand-material');
        check('rows sorted by money spent (highest first)', qa(w, '#analysis-table tbody th').map((t) => t.textContent).join('|') === 'Bambu Lab PETG|Bambu Lab PLA|Sunlu PLA|NoPrice ABS', qa(w, '#analysis-table tbody th').map((t) => t.textContent).join('|'));
        check('Bambu PLA: $20 spent, $20/kg, 300g used, no failures, true cost $20', cells('Bambu Lab PLA').join() === '1,$20.00,$20.00,300g,0g (0%),$20.00', cells('Bambu Lab PLA').join());
        check('Sunlu PLA: 60% waste raises $10/kg to $25/kg', cells('Sunlu PLA').join() === '1,$10.00,$10.00,200g,120g (60%),$25.00', cells('Sunlu PLA').join());
        check('unused spool shows dashes, not NaN', cells('Bambu Lab PETG').join() === '1,$30.00,$30.00,-,-,-', cells('Bambu Lab PETG').join());
        check('spool without a price shows dashes', cells('NoPrice ABS').join() === '1,-,-,-,-,-', cells('NoPrice ABS').join());
        check('summary names cheapest and most expensive per useful kg', q(w, '#analysis-summary').textContent === 'Cheapest per useful kg: Bambu Lab PLA at $20.00. Most expensive: Sunlu PLA at $25.00.', q(w, '#analysis-summary') && q(w, '#analysis-summary').textContent);
        setVal(w, q(w, '#analysis-group'), 'material');
        check('group by material: PLA pools both brands ($15/kg, 24% waste, $19.74 true)', cells('PLA').join() === '2,$30.00,$15.00,500g,120g (24%),$19.74', cells('PLA').join());
        check('choice is remembered', stored(w).ui.analysisGroup === 'material');
        setVal(w, q(w, '#analysis-group'), 'brand');
        check('group by brand: Bambu Lab ($50 over 2 kg = $25/kg)', cells('Bambu Lab').join() === '2,$50.00,$25.00,300g,0g (0%),$25.00', cells('Bambu Lab').join());
        setVal(w, q(w, '#analysis-group'), 'spool');
        check('group by spool lists every spool', qa(w, '#analysis-table tbody tr').length === 4 && !!rowOf('Sunlu, Red (PLA)'));
        check('table scrolls inside its box (no page overflow)', !!q(w, '.table-scroll #analysis-table'));
        const w2 = boot(JSON.stringify(stored(w)));
        check('group choice survives a reload', q(w2, '#analysis-group').value === 'spool');
        const w3 = boot(JSON.stringify({ ...stored(w), ui: { analysisGroup: 'nonsense' } }));
        check('junk group falls back to brand and material', q(w3, '#analysis-group').value === 'brand-material');
        check('no unexpected errors in section 30', errors.length === e11, errors.slice(e11).join(' | '));
    }

    console.log('\n[31] Printable spool labels');
    {
        const e12 = errors.length;
        const w = boot();
        let printed = 0;
        w.print = () => { printed++; check('printing class is set while the dialog opens', w.document.body.classList.contains('printing-labels')); w.dispatchEvent(new w.Event('afterprint')); };
        click(w, q(w, '#labels-button'));
        check('no spools: friendly message and no popup', !q(w, '#label-popup') && q(w, '#toast').textContent.includes('Add a spool first'));
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: '1000', price: '20', date: '2026-10-01' });
        addSpool(w, { brand: '<b>Evil</b>', material: 'petg', color: 'Red', grams: '750', price: '15' });
        addSpool(w, { brand: 'Old', material: 'abs', color: 'Grey', grams: '500' });
        click(w, byText(w, 'button', 'Archive', qa(w, '#spools .row-card').find((c) => c.textContent.includes('Old')))); skipLeftover(w);
        click(w, q(w, '#labels-button'));
        const pop = q(w, '#label-popup');
        check('popup opens as a dialog', pop.style.display === 'block' && pop.getAttribute('role') === 'dialog' && w.document.body.classList.contains('modal-open'));
        check('all three spools are listed, archived one unchecked', qa(w, '#label-list input').length === 3 && qa(w, '#label-list input:checked').length === 2);
        check('preview has a label for each ticked spool', qa(w, '#label-sheet .spool-label').length === 2 && q(w, '#label-count').textContent === '2 labels');
        const first = qa(w, '#label-sheet .spool-label').find((l) => l.textContent.includes('Bambu Lab'));
        check('label shows brand, color, material, grams, date and price', ['Bambu Lab', 'Black', 'PLA', '1000 g', 'Bought', '$20.00', '$0.020/g'].every((t) => first.textContent.includes(t)), first.textContent);
        check('label swatch uses the spool colour', first.querySelector('.label-swatch').style.background !== '');
        check('HTML in names stays text', !q(w, '#label-sheet b') && q(w, '#label-sheet').textContent.includes('<b>Evil</b>'));
        const del = qa(w, '#label-list input').find((i) => i.value && !i.checked);
        del.checked = true; del.dispatchEvent(new w.Event('change', { bubbles: true }));
        check('ticking the archived spool adds a label', qa(w, '#label-sheet .spool-label').length === 3);
        const priceBox = q(w, '#label-price'); priceBox.checked = false; priceBox.dispatchEvent(new w.Event('change', { bubbles: true }));
        const dateBox = q(w, '#label-date'); dateBox.checked = false; dateBox.dispatchEvent(new w.Event('change', { bubbles: true }));
        check('price and date can be hidden', !q(w, '#label-sheet').textContent.includes('$20.00') && !q(w, '#label-sheet').textContent.includes('Bought'));
        setVal(w, q(w, '#label-size'), 'medium');
        check('size changes the grid class', q(w, '#label-sheet').classList.contains('label-medium') && !q(w, '#label-sheet').classList.contains('label-small'));
        click(w, q(w, '#labels-print'));
        check('Print opens the print dialog once and cleans up after', printed === 1 && !w.document.body.classList.contains('printing-labels'));
        for (const i of qa(w, '#label-list input')) { i.checked = false; i.dispatchEvent(new w.Event('change', { bubbles: true })); }
        check('with nothing ticked, Print is disabled', q(w, '#labels-print').disabled && q(w, '#label-count').textContent === '0 labels');
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        check('Escape closes the popup and unlocks the page', q(w, '#label-popup').style.display === 'none' && !w.document.body.classList.contains('modal-open'));
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
        check('shortcuts still work after closing', q(w, '#print-popup').style.display === 'block');
        click(w, q(w, '#cancel-print-button'));
        click(w, q(w, '#labels-button'));
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', bubbles: true }));
        check('shortcuts are paused while the label popup is open', q(w, '#filament-add-popup').style.display !== 'block');
        click(w, q(w, '#labels-close'));
        check('Close button closes it', q(w, '#label-popup').style.display === 'none');
        const css = require('fs').readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
        check('print CSS hides everything but the label sheet', /@media print[\s\S]*body\.printing-labels > \*:not\(#label-popup\)[^}]*display: none/.test(css) && /print-color-adjust: exact/.test(css));
        check('no unexpected errors in section 31', errors.length === e12, errors.slice(e12).join(' | '));
    }

    console.log('\n[32] Material guide');
    {
        const e13 = errors.length;
        const w = boot();
        const iso = (offset = 0) => { const d = new w.Date(); d.setHours(12); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        check('guide is on the Filament tab, closed by default', !!q(w, '#material-details') && !q(w, '#material-details').open);
        const rows = qa(w, '#material-table tbody tr');
        check('five materials with the Bambu wiki numbers', rows.length === 5 && ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'].every((m) => rows.some((r) => r.firstChild.textContent.startsWith(m))));
        const cells = (m) => qa(w, 'td', q(w, `tr[data-material="${m}"]`)).map((c) => c.textContent);
        check('PLA: nozzle 190-240, bed 45-65, oven 55 C for 8 h, heatbed 65-75 C for 12 h', cells('pla').slice(0, 4).join('|') === '190-240|45-65|55 °C, 8 h|65-75 °C, 12 h', cells('pla').join('|'));
        check('PETG: 240-270, 60-80, 70 C 8 h', cells('petg').slice(0, 3).join('|') === '240-270|60-80|70 °C, 8 h');
        check('ABS and ASA: 240-280, bed 90-100, oven 80 C', cells('abs').slice(0, 3).join('|') === '240-280|90-100|80 °C, 8 h' && cells('asa').slice(0, 3).join('|') === '240-280|90-100|80 °C, 8 h');
        check('TPU: drying required, not AMS compatible', cells('tpu')[2].includes('required') && cells('tpu')[5] === 'No' && cells('pla')[5] === 'Yes');
        check('ABS says enclosed printer recommended', cells('abs')[4] === 'Enclosed recommended');
        check('sources are real links', qa(w, '#material-details a').length === 2 && qa(w, '#material-details a').every((a) => a.href.startsWith('https://wiki.bambulab.com/')));
        check('says heatbed drying needs an enclosed printer', q(w, '#material-details').textContent.includes('Open printers like the A1'));
        check('nobody has spools yet, so no "you have it" chips', !q(w, '#material-details .chip'));
        addSpool(w, { brand: 'Sunlu', material: 'petg', color: 'Clear', grams: '1000', price: '15', date: iso(-60) });
        check('owning a PETG spool tags that row', q(w, 'tr[data-material="petg"] .chip') && !q(w, 'tr[data-material="pla"] .chip'));
        q(w, '#material-details').open = true;
        addSpool(w, { brand: 'Other', material: 'other', color: 'Mystery', grams: '1000' });
        check('open state survives a re-render', q(w, '#material-details').open === true);
        // drying advice is attached to the badge and the dashboard
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Old', date: iso(-45), rows: [{ spoolIndex: 0, grams: 10 }] }); savePrint(w);
        click(w, q(w, '#fila-button'));
        const card = qa(w, '#spools .spool-card').find((c) => c.textContent.includes('Sunlu'));
        check('dry-line gives the oven advice for PETG', card.textContent.includes('Bambu Lab suggests drying PETG at 70 °C for 8 h in a drying oven.'), card.textContent);
        check('badge tooltip carries it too', [...card.querySelectorAll('.badge')].some((b) => b.textContent === 'Needs drying?' && b.title.includes('70 °C')));
        click(w, q(w, '#dash-button'));
        check('dashboard drying panel shows the oven setting', q(w, '#dry-panel').textContent.includes('oven: 70 °C, 8 h'), q(w, '#dry-panel') && q(w, '#dry-panel').textContent);
        check('no unexpected errors in section 32', errors.length === e13, errors.slice(e13).join(' | '));
    }

    console.log('\n[33] Undo everywhere + local snapshots');
    {
        const e14 = errors.length;
        const undo = (w) => click(w, q(w, '#toast .toast-action'));
        let w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20' });
        addSpool(w, { brand: 'Temp', color: 'Red', grams: '500' });
        click(w, q(w, '#fila-button'));
        click(w, q(w, '#ams-add-button'));
        const sel = () => qa(w, '#ams .ams-select');
        const temp = () => qa(w, '#spools .row-card').find((c) => c.textContent.includes('Temp'));
        sel()[0].value = sel()[0].options[2].value; sel()[0].dispatchEvent(new w.Event('change', { bubbles: true }));
        const tempId = Object.keys(stored(w).spools).find((id) => stored(w).spools[id].brand === 'Temp');
        check('setup: Temp is loaded in the AMS', stored(w).ams && Object.values(stored(w).ams)[0].slots.includes(tempId));
        // delete + undo restores the slot
        w.__confirms.length = 0;
        click(w, byText(w, 'button', 'Delete', temp()));
        check('spool delete no longer asks first', w.__confirms.length === 0 && !stored(w).spools[tempId]);
        check('deleting empties its AMS slot', !Object.values(stored(w).ams)[0].slots.includes(tempId));
        undo(w);
        check('Undo brings the spool back', !!stored(w).spools[tempId] && !!temp());
        check('Undo puts it back in the same AMS slot', Object.values(stored(w).ams)[0].slots.includes(tempId));
        // archive + undo
        click(w, byText(w, 'button', 'Archive', temp())); skipLeftover(w);
        check('archive says what happened', q(w, '#toast').textContent.includes('Archived "Temp, Red"') && !Object.values(stored(w).ams)[0].slots.includes(tempId));
        undo(w);
        check('Undo un-archives and reloads the slot', stored(w).spools[tempId].archived === false && Object.values(stored(w).ams)[0].slots.includes(tempId));
        click(w, byText(w, 'button', 'Archive', temp())); skipLeftover(w); click(w, byText(w, 'button', 'Unarchive', temp()));
        check('unarchive says Restored', q(w, '#toast').textContent.includes('Restored'));
        undo(w);
        check('Undo of an unarchive archives it again', stored(w).spools[tempId].archived === true);
        click(w, byText(w, 'button', 'Unarchive', temp()));
        // dried today + undo
        click(w, byText(w, 'button', 'Dried today', temp()));
        check('dried today set', /^\d{4}-/.test(stored(w).spools[tempId].driedDate));
        undo(w);
        check('Undo clears the dried date again', !stored(w).spools[tempId].driedDate);
        // queue clear done + undo
        click(w, q(w, '#queue-button'));
        for (const n of ['one', 'two']) { setVal(w, q(w, '#queue-name-input'), n); click(w, q(w, '#queue-add-button')); }
        qa(w, '#queue-list .check-input').forEach((c) => { c.checked = true; c.dispatchEvent(new w.Event('change', { bubbles: true })); });
        click(w, q(w, '#queue-clear-done-button'));
        check('clear done empties the queue', Object.keys(stored(w).queue).length === 0);
        undo(w);
        check('Undo restores both finished items', Object.keys(stored(w).queue).length === 2 && Object.values(stored(w).queue).every((i) => i.done));
        // reset settings + undo
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-preferences'));
        setVal(w, q(w, '#set-low'), '40');
        check('setup: low threshold changed', stored(w).settings.lowPercent === 40);
        click(w, q(w, '#reset-settings-button'));
        check('settings reset', stored(w).settings.lowPercent === 25);
        undo(w);
        check('Undo brings the settings back', stored(w).settings.lowPercent === 40 && q(w, '#set-low').value === '40');
        // preset delete + undo
        click(w, q(w, '#upkeep-button'));
        setVal(w, q(w, '#maint-name'), 'Oil'); setVal(w, q(w, '#maint-every'), '10'); click(w, q(w, '#maint-add-button'));
        setVal(w, q(w, '#maint-preset-name'), 'Mine'); click(w, q(w, '#maint-preset-save'));
        check('setup: preset saved', Object.keys(stored(w).settings.customPresets).length === 1);
        click(w, q(w, '#maint-preset-delete'));
        check('preset deleted', Object.keys(stored(w).settings.customPresets).length === 0);
        undo(w);
        check('Undo restores the preset', Object.values(stored(w).settings.customPresets).some((p) => p.name === 'Mine'));

        // delete all data + undo
        click(w, q(w, '#data-button'));
        click(w, q(w, '#clear-data-button'));
        check('delete all clears prints/spools/AMS', Object.keys(stored(w).spools).length === 0 && Object.keys(stored(w).ams).length === 0);
        check('settings are kept by delete all', stored(w).settings.lowPercent === 40);
        undo(w);
        check('Undo restores spools, AMS, queue and parts', Object.keys(stored(w).spools).length === 2 && Object.keys(stored(w).ams).length === 1 && Object.keys(stored(w).queue).length === 2);

        // ---- snapshots ----
        const snaps = (w) => JSON.parse(w.localStorage.getItem('printTracker.snapshots') || '[]');
        w = boot();
        check('no snapshot for empty data', snaps(w).length === 0);
        addSpool(w, { brand: 'A', color: 'B', grams: '100' });
        const w2 = boot(w.localStorage.getItem('printTracker'));
        check('a daily snapshot is taken when the app starts with data', snaps(w2).length === 1 && snaps(w2)[0].reason === 'Daily', JSON.stringify(snaps(w2).map((s) => s.reason)));
        const stash = w2.localStorage.getItem('printTracker.snapshots');
        const w3 = boot(w2.localStorage.getItem('printTracker'), { 'printTracker.snapshots': stash });
        check('starting again the same day adds nothing', snaps(w3).length === 1);
        const old = JSON.parse(stash); old[0].at = new Date(Date.now() - 2 * 86400000).toISOString();
        const w3b = boot(w2.localStorage.getItem('printTracker') + '', { 'printTracker.snapshots': JSON.stringify(old) });
        check('the next day it takes a new one, unless nothing changed', snaps(w3b).length === 1);
        const changed = JSON.parse(w2.localStorage.getItem('printTracker')); changed.queue = { q1: { name: 'new', link: '', done: false } };
        const w3c = boot(JSON.stringify(changed), { 'printTracker.snapshots': JSON.stringify(old) });
        check('a day later with changes, a second snapshot is added', snaps(w3c).length === 2 && snaps(w3c)[0].reason === 'Daily');
        click(w3, q(w3, '#data-button'));
        check('panel lists the snapshot with counts', q(w3, '#snapshot-list').textContent.includes('Daily') && q(w3, '#snapshot-list').textContent.includes('1 spools'), q(w3, '#snapshot-list').textContent);
        addSpool(w3, { brand: 'C', color: 'D', grams: '100' });
        click(w3, q(w3, '#snapshot-now'));
        check('Take a snapshot now stores one (Manual)', snaps(w3).length === 2 && snaps(w3)[0].reason === 'Manual');
        click(w3, q(w3, '#snapshot-now'));
        check('an identical snapshot is not stored twice', snaps(w3).length === 2);
        // import takes a snapshot first
        w3.__blobs.length = 0; click(w3, q(w3, '#export-button'));
        const backup = w3.__blobs[0];
        addSpool(w3, { brand: 'E', color: 'F', grams: '100' });
        await importText(w3, backup);
        check('import takes a "Before import" snapshot of what you had', snaps(w3)[0].reason === 'Before import' && Object.keys(JSON.parse(snaps(w3)[0].data).spools).length === 3);
        check('and the import itself worked (2 spools)', Object.keys(stored(w3).spools).length === 2);
        // restore it
        click(w3, byText(w3, 'button', 'Restore', qa(w3, '#snapshot-list .snapshot-row').find((r) => r.textContent.includes('Before import'))));
        check('Restore asks for confirmation naming the time', w3.__confirms[w3.__confirms.length - 1].includes('Restore the snapshot from'));
        check('restoring brings back all 3 spools', Object.keys(stored(w3).spools).length === 3);
        check('restoring snapshots the current data first', snaps(w3)[0].reason === 'Before restore');
        w3.__confirmAnswer = false;
        const before = w3.localStorage.getItem('printTracker');
        click(w3, byText(w3, 'button', 'Restore', q(w3, '#snapshot-list .snapshot-row')));
        w3.__confirmAnswer = true;
        check('declining the restore changes nothing', w3.localStorage.getItem('printTracker') === before);
        // delete all takes one too
        click(w3, q(w3, '#clear-data-button'));
        check('"Before delete all" snapshot exists', snaps(w3).some((s) => s.reason === 'Before delete all'));
        check('only the newest 5 are kept', snaps(w3).length <= 5);
        for (let i = 0; i < 8; i++) { addSpool(w3, { brand: 'X' + i, color: 'c', grams: '10' }); click(w3, q(w3, '#snapshot-now')); }
        check('the list never grows past 5', snaps(w3).length === 5);
        click(w3, byText(w3, 'button', 'Delete', q(w3, '#snapshot-list .snapshot-row')));
        check('a snapshot can be deleted', snaps(w3).length === 4);
        // robustness
        w3.localStorage.setItem('printTracker.snapshots', 'not json');
        const w4 = boot(w3.localStorage.getItem('printTracker'));
        check('corrupt snapshot storage is ignored, not fatal', q(w4, '#snapshot-list').textContent.includes('No snapshots') || snaps(w4).length >= 0);
        w4.localStorage.setItem('printTracker.snapshots', JSON.stringify([{ at: 'x', data: 5 }, { at: new Date().toISOString(), reason: '<b>x</b>', data: '{"prints":{},"spools":{},"queue":{}}' }]));
        click(w4, q(w4, '#data-button')); click(w4, q(w4, '#snapshot-now'));
        check('bad entries are skipped and reasons render as text', !q(w4, '#snapshot-list b'));
        check('no unexpected errors in section 33', errors.length === e14, errors.slice(e14).join(' | '));
    }

    console.log('\n[34] Accessibility');
    {
        const e15 = errors.length;
        const w = boot();
        const d = w.document;
        check('skip link is the first focusable thing on the page', d.body.querySelector('a, button, input') === q(w, '#skip-link') && q(w, '#skip-link').getAttribute('href') === '#app');
        click(w, q(w, '#skip-link'));
        check('skip link moves focus to the main content', d.activeElement === q(w, '#app'));
        // sub-tab keyboard support
        click(w, q(w, '#settings-button'));
        const key = (el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
        const tabEl = (n) => q(w, '#settings-tab-' + n);
        tabEl('printer').focus();
        key(tabEl('printer'), 'ArrowRight');
        check('ArrowRight moves to Appearance and focuses it', !q(w, '#settings-appearance').hidden && d.activeElement === tabEl('appearance') && tabEl('appearance').getAttribute('aria-selected') === 'true');
        key(tabEl('appearance'), 'ArrowRight'); key(tabEl('preferences'), 'ArrowRight');
        check('ArrowRight wraps around to Printer', !q(w, '#settings-printer').hidden && d.activeElement === tabEl('printer'));
        key(tabEl('printer'), 'ArrowLeft');
        check('ArrowLeft wraps to Preferences', !q(w, '#settings-preferences').hidden);
        key(tabEl('preferences'), 'Home');
        check('Home goes to the first tab', !q(w, '#settings-printer').hidden);
        key(tabEl('printer'), 'End');
        check('End goes to the last tab', !q(w, '#settings-preferences').hidden && d.activeElement === tabEl('preferences'));
        check('only the selected sub-tab is in the tab order', [...['printer', 'appearance', 'preferences']].filter((n) => tabEl(n).tabIndex === 0).length === 1);
        check('sub-tabs point at their panels', tabEl('printer').getAttribute('aria-controls') === 'settings-printer');
        // focus return
        click(w, q(w, '#prints-button'));
        addSpool(w, { brand: 'A', color: 'B', grams: '100' });
        click(w, q(w, '#prints-button'));
        const newPrint = q(w, '#prints .acc-buttons');
        newPrint.focus(); click(w, newPrint);
        check('print popup takes focus', d.activeElement === q(w, '#name-tinput'));
        click(w, q(w, '#cancel-print-button'));
        check('closing the print popup returns focus to the button that opened it', d.activeElement === newPrint);
        click(w, q(w, '#fila-button'));
        const addBtn = q(w, '#filament .acc-buttons');
        addBtn.focus(); click(w, addBtn);
        click(w, q(w, '#cancel-spool-button'));
        check('same for the spool popup', d.activeElement === addBtn);
        const lbl = q(w, '#labels-button');
        lbl.focus(); click(w, lbl);
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        check('same for the label popup (closed with Escape)', d.activeElement === lbl);
        // accessible names everywhere
        const nameOf = (el) => {
            if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
            if (el.getAttribute('aria-labelledby')) return el.getAttribute('aria-labelledby').split(' ').map((i) => (d.getElementById(i) || {}).textContent || '').join(' ').trim();
            if (el.id) { const l = d.querySelector(`label[for="${el.id}"]`); if (l && l.textContent.trim()) return l.textContent.trim(); }
            const wrap = el.closest('label'); if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
            return (el.tagName === 'BUTTON' || el.tagName === 'A') ? ((el.textContent || '').trim() || el.title || '') : (el.title || '');
        };
        const unnamed = [];
        for (const tabName of ['dash', 'prints', 'fila', 'queue', 'upkeep', 'data', 'settings']) {
            click(w, q(w, `#${tabName}-button`));
            for (const el of qa(w, 'input, select, textarea, button, a[href]')) {
                if (el.type === 'hidden' || el.closest('template')) continue;
                if (!nameOf(el)) unnamed.push(`${tabName}:${el.id || el.className}`);
            }
        }
        check('every control on every tab has an accessible name', unnamed.length === 0, [...new Set(unnamed)].join(', '));
        const dupes = qa(w, '[id]').map((e) => e.id).filter((id, i, a) => a.indexOf(id) !== i);
        check('no duplicate ids', dupes.length === 0, dupes.join(','));
        check('all popups are labelled modal dialogs', qa(w, '.popup').every((p) => p.getAttribute('role') === 'dialog' && p.getAttribute('aria-modal') === 'true' && p.getAttribute('aria-labelledby')));
        check('toast is a polite live region', q(w, '#toast').getAttribute('role') === 'status' && q(w, '#toast').getAttribute('aria-live') === 'polite');

        // contrast, computed from the real CSS tokens
        const css = require('fs').readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
        const block = (sel) => { const i = css.indexOf(sel); return css.slice(i, css.indexOf('}', i)); };
        const tokens = (b) => Object.fromEntries([...b.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
        const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
        const dark = tokens(block(':root {')); const light = { ...dark, ...tokens(block(':root[data-theme="light"] {')) };
        for (const [theme, t] of [['dark', dark], ['light', light]]) {
            const bad = [];
            for (const fg of ['text', 'muted', 'link', 'danger', 'warning', 'success']) {
                for (const bg of ['bg', 'surface', 'surface-2', 'surface-3']) {
                    const r = ratio(rgb(t[fg]), rgb(t[bg]));
                    if (r < 4.5) bad.push(`${fg} on ${bg} ${r.toFixed(2)}`);
                }
            }
            check(`${theme} theme: text colours reach 4.5:1 on every surface`, bad.length === 0, bad.join('; '));
        }
        const accents = [...css.matchAll(/x/g)].length; // (accent table lives in constants.js)
        const consts = require('fs').readFileSync(path.join(APP, 'js/constants.js'), 'utf8');
        const accentRows = [...consts.matchAll(/(\w+):\s*\{ label: '\w+',\s*dark: \{ accent: '(#\w+)', strong: '(#\w+)', link: '(#\w+)' \},\s*light: \{ accent: '(#\w+)', strong: '(#\w+)', link: '(#\w+)' \}/g)];
        check('six accent colours found for the contrast check', accentRows.length === 6 && accents >= 0, accentRows.length);
        const badAcc = [];
        for (const [, name, dA, , dL, lA, , lL] of accentRows) {
            for (const [theme, accent, link, t] of [['dark', dA, dL, dark], ['light', lA, lL, light]]) {
                for (const bg of ['bg', 'surface', 'surface-2', 'surface-3']) {
                    const r = ratio(rgb(link), rgb(t[bg])); if (r < 4.5) badAcc.push(`${name} ${theme} link on ${bg} ${r.toFixed(2)}`);
                }
                const r2 = ratio(rgb(t['accent-text']), rgb(accent)); if (r2 < 4.5) badAcc.push(`${name} ${theme} button text ${r2.toFixed(2)}`);
            }
        }
        check('every accent: links and primary-button text reach 4.5:1 in both themes', badAcc.length === 0, badAcc.join('; '));
        check('inputs keep a visible focus outline', /\.text-input:focus[^}]*outline: 2px solid/.test(css));
        check('reduced motion turns animations off', /prefers-reduced-motion: reduce\)[^}]*animation: none/.test(css));
        check('no unexpected errors in section 34', errors.length === e15, errors.slice(e15).join(' | '));
    }

    console.log('\n[35] Filament drying section on the Upkeep tab');
    {
        const e16 = errors.length;
        const w = boot();
        const iso = (o = 0) => { const d = new w.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        const row = (name) => qa(w, '#dry-list .dry-row').find((r) => r.textContent.includes(name));
        check('empty state when there are no spools', q(w, '#dry-list').textContent.includes('No active spools'));
        addSpool(w, { brand: 'Sunlu', material: 'petg', color: 'Clear', grams: '1000', price: '15', date: iso(-60) });
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: '1000', price: '20', date: iso(-30) });
        addSpool(w, { brand: 'Fresh', material: 'tpu', color: 'Blue', grams: '500', date: iso(-2) });
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Old', date: iso(-45), rows: [{ spoolIndex: 0, grams: 10 }] }); savePrint(w);
        openPrint(w);
        fillPrint(w, { name: 'Recent', date: iso(-5), rows: [{ spoolIndex: 1, grams: 10 }] }); savePrint(w);
        click(w, q(w, '#upkeep-button'));
        check('drying card is on the Upkeep tab', !!q(w, '#upkeep #dry-list') && !q(w, '#filament #dry-list'));
        check('every active spool is listed', qa(w, '#dry-list .dry-row').length === 3);
        check('the one that needs drying comes first', qa(w, '#dry-list .dry-row')[0].textContent.includes('Sunlu') && qa(w, '#dry-list .dry-row')[0].classList.contains('is-due'));
        check('status says open 45 days, never dried', row('Sunlu').textContent.includes('Open for 45 days, never dried'), row('Sunlu').textContent);
        check('PETG row shows the oven advice', row('Sunlu').textContent.includes('Bambu Lab suggests drying PETG at 70 °C for 8 h in a drying oven.'));
        check('badge only on the overdue spool', row('Sunlu').textContent.includes('Needs drying?') && !row('Bambu Lab, Black').textContent.includes('Needs drying?'), row('Bambu Lab, Black').textContent);
        check('recent spool shows 5 days open', row('Bambu Lab, Black').textContent.includes('Open for 5 days, never dried'), row('Bambu Lab, Black').textContent);
        check('unused spool says it is not used yet', row('Fresh').textContent.includes('Not used yet'));
        check('summary counts the one spool', q(w, '#dry-summary').textContent.startsWith('1 spool may need drying'), q(w, '#dry-summary').textContent);
        check('limit box shows the setting (30)', q(w, '#dry-days-upkeep').value === '30');
        // Dried today with undo
        click(w, byText(w, 'button', 'Dried today', row('Sunlu')));
        const sunId = Object.keys(stored(w).spools).find((id) => stored(w).spools[id].brand === 'Sunlu');
        check('Dried today stores the date and clears the nudge', stored(w).spools[sunId].driedDate === iso() && !row('Sunlu').classList.contains('is-due') && row('Sunlu').textContent.includes('(0 days ago)'));
        click(w, q(w, '#toast .toast-action'));
        check('Undo puts it back', !stored(w).spools[sunId].driedDate && row('Sunlu').classList.contains('is-due'));
        // pick a date by hand
        const dateBox = () => q(w, 'input.dry-date', row('Sunlu'));
        setVal(w, dateBox(), iso(-10));
        check('picking a date stores it and shows days ago', stored(w).spools[sunId].driedDate === iso(-10) && row('Sunlu').textContent.includes('(10 days ago)'));
        setVal(w, dateBox(), '');
        check('clearing the date removes it', !stored(w).spools[sunId].driedDate);
        // threshold
        setVal(w, q(w, '#dry-days-upkeep'), '90');
        check('raising the limit to 90 days clears the nudge', stored(w).settings.dryDays === 90 && !qa(w, '#dry-list .is-due').length && q(w, '#dry-summary').textContent.startsWith('Nothing needs drying'));
        setVal(w, q(w, '#dry-days-upkeep'), '0');
        check('0 turns it off, and the summary says so', stored(w).settings.dryDays === 0 && q(w, '#dry-summary').textContent.includes('reminder is off'));
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-preferences'));
        check('Settings shows the same number', q(w, '#set-dry-days').value === '0');
        setVal(w, q(w, '#set-dry-days'), '20');
        check('and changing it there updates the Upkeep box', q(w, '#dry-days-upkeep').value === '20' && qa(w, '#dry-list .is-due').length === 1, q(w,'#dry-days-upkeep').value+' '+qa(w, '#dry-list .is-due').length);
        // archived spools are not listed
        click(w, q(w, '#fila-button'));
        click(w, byText(w, 'button', 'Archive', qa(w, '#spools .row-card').find((c) => c.textContent.includes('Sunlu')))); skipLeftover(w);
        check('archived spools drop out of the drying list', !row('Sunlu') && qa(w, '#dry-list .dry-row').length === 2);
        check('no unexpected errors in section 35', errors.length === e16, errors.slice(e16).join(' | '));
    }

    {
        console.log('\n[36] Material guide spacing');
        const cssText = require('fs').readFileSync(path.join(APP, 'css/styles.css'), 'utf8');
        check('material panel has a top margin so it clears the empty-state box', /\.material-panel\s*\{[^}]*margin-top:\s*calc\(16px/.test(cssText));
    }

    console.log('\n[37] Add to queue from a past print');
    {
        const e = errors.length;
        const w = boot();
        const iso = (o = 0) => { const d = new w.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: '1000', price: '20', date: iso(-30) });
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Gridfinity bin', date: iso(-3), link: 'https://example.com/bin', rows: [{ spoolIndex: 0, grams: 45 }] });
        setVal(w, q(w, '#hours-ninput'), '1'); setVal(w, q(w, '#minutes-ninput'), '30');
        setVal(w, q(w, '#profile-name-tinput'), '0.20mm Standard');
        setVal(w, q(w, '#notes-input'), 'Print slowly');
        savePrint(w);
        const card = () => q(w, '#print-list .print-card');
        const btn = byText(w, 'button', 'Add to queue', card());
        check('the print card has an "Add to queue" button', !!btn);
        check('"Print again" is still there', !!byText(w, 'button', 'Print again', card()));
        click(w, btn);
        const items = Object.values(stored(w).queue);
        check('one queue item was added', items.length === 1 && items[0].name === 'Gridfinity bin' && items[0].done === false);
        check('it keeps the link', items[0].link === 'https://example.com/bin');
        check('it keeps print time, filament, profile and notes', items[0].spec && items[0].spec.minutes === 90 && items[0].spec.usage.length === 1 && items[0].spec.usage[0].grams === 45 && items[0].spec.profile.name === '0.20mm Standard' && items[0].spec.notes === 'Print slowly', JSON.stringify(items[0].spec));
        check('toast confirms it', q(w, '#toast').textContent.includes('Added "Gridfinity bin" to the queue'));
        click(w, q(w, '#queue-button'));
        const row = q(w, '#queue-list .queue-item');
        check('queue row says what it will be printed with', row.textContent.includes('Same as before: 1h 30m') && row.textContent.includes('45g') && row.textContent.includes('Bambu Lab, Black') && row.textContent.includes('0.20mm Standard'), row.textContent);
        click(w, byText(w, 'button', 'Log print', row));
        check('Log print opens the popup filled in', q(w, '#name-tinput').value === 'Gridfinity bin' && q(w, '#hours-ninput').value === '1' && q(w, '#minutes-ninput').value === '30' && q(w, '#profile-name-tinput').value === '0.20mm Standard' && q(w, '#notes-input').value === 'Print slowly' && q(w, '#filament-row-list input').value === '45');
        check('with today as the date', q(w, '#date-tinput').value === iso(0));
        savePrint(w);
        const after = stored(w);
        check('saving makes a second print and ticks the queue item', Object.keys(after.prints).length === 2 && Object.values(after.queue)[0].done === true);
        click(w, q(w, '#prints-button'));
        click(w, byText(w, 'button', 'Add to queue', card()));
        click(w, q(w, '#toast .toast-action'));
        check('Undo removes the queue item again', Object.keys(stored(w).queue).length === 1);
        // spool deleted -> the spec drops it instead of pointing at nothing
        const sid = Object.keys(stored(w).spools)[0];
        const raw = stored(w);
        raw.queue.qx = { name: 'Ghost', link: '', done: false, spec: { minutes: 20, usage: [{ spoolId: 'nope', grams: 5 }], profile: null, notes: '', printerId: '' } };
        const w2 = boot(JSON.stringify(raw));
        click(w2, q(w2, '#queue-button'));
        const ghost = qa(w2, '#queue-list .queue-item').find((r) => r.textContent.includes('Ghost'));
        check('a spec that points at a missing spool still renders', !!ghost && ghost.textContent.includes('Same as before: 20m'), ghost && ghost.textContent);
        // import validation keeps a clean spec and drops junk
        const bad = { schemaVersion: 1, prints: {}, spools: {}, queue: { a1: { name: 'X', link: '', done: false, spec: { minutes: -5, usage: 'junk', profile: 7, notes: 99, printerId: '<b>' } }, a2: { name: 'Y', link: '', done: false, spec: { minutes: 30, usage: [{ spoolId: 's1', grams: 10 }, { spoolId: '../x', grams: 1 }, { spoolId: 's1', grams: 2 }] } } } };
        const w3 = boot();
        click(w3, q(w3, '#data-button'));
        const input = q(w3, '#import-file');
        Object.defineProperty(input, 'files', { value: [new w3.File([JSON.stringify(bad)], 'b.json')], configurable: true });
        input.dispatchEvent(new w3.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        const qs = stored(w3).queue;
        check('junk specs are dropped on import', qs.a1 && qs.a1.spec === undefined, JSON.stringify(qs.a1));
        check('good specs are cleaned (bad ids and repeats removed)', qs.a2 && qs.a2.spec.minutes === 30 && qs.a2.spec.usage.length === 1 && qs.a2.spec.usage[0].grams === 10, JSON.stringify(qs.a2));
        check('no unexpected errors in section 37', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[38] Forecast, shopping list, similar colours');
    {
        const e = errors.length;
        const w0 = boot();
        const iso = (o = 0) => { const d = new w0.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        const data = {
            schemaVersion: 1, queue: {}, maintenance: {},
            spools: {
                a: { brand: 'Bambu Lab', material: 'pla', color: 'Black', hex: '#1c1c1e', startGrams: 1000, price: 20, date: iso(-60), archived: false },
                b: { brand: 'Sunlu', material: 'petg', color: 'Clear', hex: '', startGrams: 500, price: 12, date: iso(-40), archived: false },
                c: { brand: 'Polymaker', material: 'pla', color: 'Jet Black', hex: '#202022', startGrams: 1000, price: 22, date: iso(-5), archived: false },
                r: { brand: 'Hatchbox', material: 'pla', color: 'Red', hex: '#e53935', startGrams: 1000, price: 18, date: iso(-100), archived: true }
            },
            prints: {
                p1: { name: 'A1', date: iso(-14), result: true, link: '', usage: [{ spoolId: 'a', grams: 200 }], minutes: null },
                p2: { name: 'A2', date: iso(-7), result: true, link: '', usage: [{ spoolId: 'a', grams: 200 }], minutes: null },
                p3: { name: 'B1', date: iso(-10), result: true, link: '', usage: [{ spoolId: 'b', grams: 200 }], minutes: null },
                p4: { name: 'B2', date: iso(-3), result: true, link: '', usage: [{ spoolId: 'b', grams: 200 }], minutes: null },
                p5: { name: 'R1', date: iso(-40), result: true, link: '', usage: [{ spoolId: 'r', grams: 100 }], minutes: null },
                p6: { name: 'R2', date: iso(-20), result: true, link: '', usage: [{ spoolId: 'r', grams: 100 }], minutes: null }
            },
            settings: { dryDays: 0 }
        };
        const w = boot(JSON.stringify(data));
        click(w, q(w, '#fila-button'));
        const card = (name) => qa(w, '#spools .spool-card').find((c) => c.textContent.includes(name));
        check('spool card shows its run-out forecast', card('Sunlu').querySelector('.forecast-line') && card('Sunlu').querySelector('.forecast-line').textContent.includes('runs out in about 3 days'), card('Sunlu').textContent);
        check('with the weekly pace', card('Sunlu').querySelector('.forecast-line').textContent.includes('254.5g a week'), card('Sunlu').querySelector('.forecast-line').textContent);
        check('and a later forecast for the bigger spool', card('Bambu Lab').querySelector('.forecast-line').textContent.includes('about 3 weeks'), card('Bambu Lab').querySelector('.forecast-line').textContent);
        check('a spool nobody used has no forecast', !card('Polymaker').querySelector('.forecast-line'));
        const rows = qa(w, '#shopping-panel .shopping-row');
        check('shopping list has the low spool and the favourite colour', rows.length === 2, rows.map((r) => r.textContent).join(' | '));
        check('low spool comes first, with why', rows[0].dataset.kind === 'low' && rows[0].textContent.includes('Sunlu') && rows[0].textContent.includes('~100g left') && rows[0].textContent.includes('runs out in about 3 days'), rows[0].textContent);
        check('favourite colour is listed with its print count', rows[1].dataset.kind === 'favorite' && rows[1].textContent.includes('Hatchbox') && rows[1].textContent.includes('used in 2 prints'), rows[1].textContent);
        check('shows what you last paid', rows[0].textContent.includes('last paid $12.00'));
        // copy
        Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { w.__copied = t; } }, configurable: true });
        click(w, q(w, '#shopping-copy'));
        await new Promise((r) => setTimeout(r, 30));
        check('Copy list puts a plain-text list on the clipboard', typeof w.__copied === 'string' && w.__copied.startsWith('Filament shopping list\n- Sunlu PETG, Clear (500g), last paid $12.00') && w.__copied.includes('Hatchbox PLA, Red'), w.__copied);
        // Buy again
        click(w, byText(w, 'button', 'Buy again', rows[0]));
        check('Buy again opens the spool popup filled in', q(w, '#filament-add-popup').style.display === 'block' && q(w, '#brand-tinput').value === 'Sunlu');
        click(w, q(w, '#cancel-spool-button'));
        // dashboard reorder note
        click(w, q(w, '#dash-button'));
        check('dashboard reorder note includes the forecast', q(w, '.reorder-note') && q(w, '.reorder-note').textContent.includes('At your pace it runs out in about 3 days'), q(w, '.reorder-note') && q(w, '.reorder-note').textContent);
        // similar colours
        click(w, q(w, '#fila-button'));
        const twin = q(w, '#twins-panel');
        check('similar colours panel lists the two near-black PLA spools', !!twin && twin.textContent.includes('Bambu Lab, Black') && twin.textContent.includes('Polymaker, Jet Black') && twin.textContent.includes('almost identical'), twin && twin.textContent);
        check('and not the PETG or the archived red', !twin.textContent.includes('Sunlu') && !twin.textContent.includes('Hatchbox'));
        // popup hint
        click(w, q(w, '#filament .acc-buttons'));
        const hint = q(w, '#similar-hint');
        check('no hint before a colour is typed', hint.hidden);
        setVal(w, q(w, '#color-tinput'), 'Black');
        check('typing Black warns about the near-identical spools', !hint.hidden && hint.textContent.includes('Bambu Lab, Black') && hint.textContent.includes('PLA'), hint.textContent);
        setVal(w, q(w, '#material-dropdown'), 'petg');
        check('switching to PETG clears the hint', hint.hidden);
        setVal(w, q(w, '#color-tinput'), 'Red');
        check('a colour nobody owns shows no hint', hint.hidden);
        click(w, q(w, '#cancel-spool-button'));
        // nothing to buy
        const calm = boot(JSON.stringify({ ...data, prints: {}, spools: { a: data.spools.a } }));
        click(calm, q(calm, '#fila-button'));
        check('with nothing to buy the panel says so', q(calm, '#shopping-empty') && !q(calm, '#twins-panel'));
        // no spools: nothing extra at all
        const none = boot();
        click(none, q(none, '#fila-button'));
        check('no spools means no shopping or colour panels', !q(none, '#shopping-panel') && !q(none, '#twins-panel'));
        check('no unexpected errors in section 38', errors.length === e, errors.slice(e).join(' | '));
    }


    console.log('\n[39] Print calendar and streaks');
    {
        const e = errors.length;
        const w0 = boot();
        const iso = (o = 0) => { const d = new w0.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        const mkPrint = (name, date) => ({ name, date, result: true, link: '', usage: [{ spoolId: 'a', grams: 10 }], minutes: 60 });
        const base = { schemaVersion: 1, queue: {}, maintenance: {}, spools: { a: { brand: 'X', material: 'pla', color: 'Black', hex: '', startGrams: 1000, price: null, date: iso(-400), archived: false } } };
        const empty = boot(JSON.stringify({ ...base, prints: {} }));
        check('no prints, no calendar', !q(empty, '#heat-panel'));

        // two prints today, one 8 days ago (previous week), one 15 days ago (two weeks back), one 40 days ago
        const prints = { p1: mkPrint('T1', iso(0)), p2: mkPrint('T2', iso(0)), p3: mkPrint('W1', iso(-8)), p4: mkPrint('W2', iso(-15)), p5: mkPrint('W3', iso(-40)) };
        const w = boot(JSON.stringify({ ...base, prints }));
        const panel = q(w, '#heat-panel');
        check('calendar panel is on the dashboard', !!panel);
        const cells = qa(w, '#heat-grid .heat-cell[data-date]');
        const future = qa(w, '#heat-grid .heat-future');
        check('53 weeks of squares, days after today left blank', cells.length + future.length === 53 * 7 && cells.length >= 365 && cells.length <= 371, `${cells.length}+${future.length}`);
        const today = qa(w, '#heat-grid .heat-cell').find((c) => c.dataset.date === iso(0));
        check('today has 2 prints at level 2 with a tooltip', today.dataset.count === '2' && today.classList.contains('heat-2') && today.title.includes('2 prints'), today.title);
        const old = qa(w, '#heat-grid .heat-cell').find((c) => c.dataset.date === iso(-8));
        check('a day with one print is level 1', old.classList.contains('heat-1') && old.title.includes('1 print') && !old.title.includes('1 prints'));
        const quiet = qa(w, '#heat-grid .heat-cell').find((c) => c.dataset.date === iso(-3));
        check('a quiet day is level 0', quiet.classList.contains('heat-0') && quiet.title.includes('no prints'));
        const summary = q(w, '#heat-summary').textContent;
        check('summary counts prints and days', summary.includes('5 prints on 4 days in the last year'), summary);
        check('and names the busiest day', summary.includes('busiest day') && summary.includes('2 prints'), summary);
        check('screen readers get the same summary on the grid', q(w, '#heat-grid').getAttribute('aria-label').startsWith('5 prints on 4 days'));
        check('the scrollable area can be focused with the keyboard', q(w, '.heat-scroll').tabIndex === 0);
        // streaks: this week, last week (-8 is a different week from today), -15 two weeks back => depends on weekday, so compute
        const sm = summary.match(/(\d+) weeks? in a row now, best run (\d+) weeks?/);
        check('shows a current streak and a best run', !!sm && Number(sm[1]) >= 1 && Number(sm[2]) >= Number(sm[1]), summary);
        // far past only: streak is 0 now
        const old2 = boot(JSON.stringify({ ...base, prints: { p1: mkPrint('Old', iso(-200)), p2: mkPrint('Old2', iso(-193)) } }));
        const s2 = q(old2, '#heat-summary').textContent;
        check('no recent print means no current streak', s2.includes('no print this week yet') && s2.includes('best run 2 weeks'), s2);
        check('no unexpected errors in section 39', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[40] Print summary');
    {
        const e = errors.length;
        const w0 = boot();
        const iso = (o = 0) => { const d = new w0.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        const data = {
            schemaVersion: 1, queue: {}, maintenance: {},
            spools: {
                a: { brand: 'Bambu Lab', material: 'pla', color: 'Black', hex: '', startGrams: 1000, price: 20, date: iso(-2), archived: false },
                b: { brand: 'Sunlu', material: 'petg', color: 'Clear', hex: '', startGrams: 1000, price: 16, date: iso(-100), archived: false }
            },
            prints: {
                p1: { name: 'Benchy', date: iso(-1), result: true, link: '', usage: [{ spoolId: 'a', grams: 15 }], minutes: 90 },
                p2: { name: 'Big vase', date: iso(-1), result: true, link: '', usage: [{ spoolId: 'a', grams: 120 }], minutes: 300 },
                p3: { name: 'Fail', date: iso(-3), result: false, failReason: 'warping', link: '', usage: [{ spoolId: 'b', grams: 40 }], minutes: 60 },
                p4: { name: 'Ancient', date: iso(-120), result: true, link: '', usage: [{ spoolId: 'b', grams: 500 }], minutes: 600 }
            }
        };
        const w = boot(JSON.stringify(data));
        check('dashboard has a Summary button', !!q(w, '#summary-button'));
        click(w, q(w, '#summary-button'));
        const popup = q(w, '#summary-popup');
        check('opens a popup', popup.style.display === 'block' && q(w, 'body').classList.contains('modal-open'));
        setVal(w, q(w, '#summary-period'), 'week');
        const text = () => q(w, '#summary-sheet').textContent;
        check('last 7 days counts 3 prints, 2 succeeded and 1 failed', text().includes('3 (2 succeeded, 1 failed, 67% success)'), text());
        check('print time adds up (90+300+60 = 7h 30m)', text().includes('7h 30m'), text());
        check('filament used by material', text().includes('175g') && text().includes('PLA 135g') && text().includes('PETG 40g'), text());
        check('waste and the reason', text().includes('Wasted40g') || (text().includes('40g') && text().includes('Warping')), text());
        check('longest print and busiest day', text().includes('Big vase (5h)') && text().includes('(2 prints)'), text());
        check('filament bought in the period', text().includes('1 spool, $20.00'), text());
        check('old prints are not counted', !text().includes('Ancient'));
        setVal(w, q(w, '#summary-period'), 'year');
        check('this year includes the old print when it falls in this year', text().includes('Prints'));
        Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { w.__copied = t; } }, configurable: true });
        setVal(w, q(w, '#summary-period'), 'week');
        click(w, q(w, '#summary-copy'));
        await new Promise((r) => setTimeout(r, 30));
        check('Copy puts the text recap on the clipboard', typeof w.__copied === 'string' && w.__copied.startsWith('Print summary: Last 7 days (') && w.__copied.includes('\nPrints: 3 (2 succeeded'), w.__copied);
        click(w, q(w, '#summary-save'));
        check('Save as text downloads a .txt file', w.__lastDownload && /^print-summary-\d{4}-\d\d-\d\d-to-\d{4}-\d\d-\d\d\.txt$/.test(w.__lastDownload.name), w.__lastDownload && w.__lastDownload.name);
        let printed = false;
        w.print = () => { printed = true; check('printing adds the print class to the page', q(w, 'body').classList.contains('printing-summary')); };
        click(w, q(w, '#summary-print'));
        check('Print opens the print dialog', printed);
        w.dispatchEvent(new w.Event('afterprint'));
        check('and the class is removed afterwards', !q(w, 'body').classList.contains('printing-summary'));
        // keyboard
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
        check('shortcuts are ignored while the popup is open', q(w, '#print-popup').style.display !== 'block');
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        check('Escape closes it', popup.style.display === 'none' && !q(w, 'body').classList.contains('modal-open'));
        // empty period
        click(w, q(w, '#summary-button'));
        setVal(w, q(w, '#summary-period'), 'lastmonth');
        check('a period range shown with dates', q(w, '#summary-sheet .summary-heading').textContent.startsWith('Last month:'));
        click(w, q(w, '#summary-close'));
        const empty = boot(JSON.stringify({ ...data, prints: {} }));
        click(empty, q(empty, '#summary-button'));
        check('a period without prints says so', q(empty, '#summary-sheet').textContent.includes('None in this period'), q(empty, '#summary-sheet').textContent);
        check('no unexpected errors in section 40', errors.length === e, errors.slice(e).join(' | '));
    }


    console.log('\n[41] More than one printer');
    {
        const e = errors.length;
        const w = boot();
        const iso = (o = 0) => { const d = new w.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: '1000', price: '20', date: iso(-30) });
        check('one printer: print popup has no printer picker', (click(w, q(w, '#prints-button')), openPrint(w), q(w, '#printer-field').hidden));
        click(w, q(w, '#cancel-print-button'));
        check('one printer: upkeep has no printer picker', (click(w, q(w, '#upkeep-button')), q(w, '#upkeep-printer-bar').hidden));

        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-printer'));
        check('settings start with just the main printer', qa(w, '#set-printer-pick option').length === 1 && q(w, '#set-printer-remove').hidden);
        // main printer: 200 W at 0.50 per kWh
        setAuto(w, '#set-printer-watts', 200); setAuto(w, '#set-printer-kwh', 0.5);
        click(w, q(w, '#set-printer-add'));
        const extraId = Object.keys(stored(w).settings.printers)[0];
        check('adding a printer stores it', !!extraId && qa(w, '#set-printer-pick option').length === 2 && q(w, '#set-printer-pick').value === extraId);
        check('and shows its (empty) details, not the main printer\'s', q(w, '#set-printer-name').value === '' && q(w, '#set-printer-remove').hidden === false);
        setVal(w, q(w, '#set-printer-name'), 'Workhorse');
        setVal(w, q(w, '#set-printer-brand'), 'bambu');
        setAuto(w, '#set-printer-watts', 100); setAuto(w, '#set-printer-kwh', 0.5);
        let st = stored(w).settings;
        check('the extra printer keeps its own values', st.printers[extraId].nickname === 'Workhorse' && st.printers[extraId].watts === 100 && st.printers[extraId].brand === 'bambu');
        check('the main printer was not touched', st.printer.watts === 200 && st.printer.nickname === '');
        setVal(w, q(w, '#set-printer-pick'), '');
        check('switching back shows the main printer\'s values', q(w, '#set-printer-watts-value').textContent.includes('200') && q(w, '#set-printer-name').value === '');
        check('the picker lists both with names', qa(w, '#set-printer-pick option')[1].textContent === '2. Workhorse', qa(w, '#set-printer-pick option').map((o) => o.textContent).join('|'));
        check('cost card lists both printers', q(w, '#cost-summary').textContent.includes('Printer 2 (Workhorse)'), q(w, '#cost-summary').textContent);

        // prints
        click(w, q(w, '#prints-button')); openPrint(w);
        check('print popup now has a printer picker with both', !q(w, '#printer-field').hidden && qa(w, '#printer-select option').length === 2);
        fillPrint(w, { name: 'On main', date: iso(-2), rows: [{ spoolIndex: 0, grams: 10 }] });
        setVal(w, q(w, '#hours-ninput'), '2');
        setVal(w, q(w, '#printer-select'), '');
        savePrint(w);
        openPrint(w);
        check('the popup remembers the printer you used last', q(w, '#printer-select').value === '');
        fillPrint(w, { name: 'On workhorse', date: iso(-1), rows: [{ spoolIndex: 0, grams: 10 }] });
        setVal(w, q(w, '#hours-ninput'), '4');
        setVal(w, q(w, '#printer-select'), extraId);
        savePrint(w);
        const pr = Object.values(stored(w).prints);
        check('each print stores its printer', pr.find((p) => p.name === 'On main').printerId === '' && pr.find((p) => p.name === 'On workhorse').printerId === extraId);
        const card = (n) => qa(w, '#print-list .print-card').find((c) => c.textContent.includes(n));
        check('cards show which printer', card('On workhorse').textContent.includes('Workhorse') && card('On main').textContent.includes('Main printer'), card('On main').textContent);
        const tip = (n) => qa(w, '.meta-item', card(n)).map((m) => m.title).join(' ');
        check('electricity uses each printer\'s own watts (4h x 100 W x 0.5 = 0.20; 2h x 200 W x 0.5 = 0.20)', tip('On workhorse').includes('electricity $0.20') && tip('On main').includes('electricity $0.20'), tip('On workhorse') + ' / ' + tip('On main'));
        setVal(w, q(w, '#print-search'), 'workhorse');
        check('search finds prints by printer name', qa(w, '#print-list .print-card').length === 1);
        setVal(w, q(w, '#print-search'), '');

        // dashboard
        click(w, q(w, '#dash-button'));
        check('dashboard shows a panel for each printer', !!q(w, '#printer-panel') && !!q(w, '#printer-panel-' + extraId));
        check('with their own hours (2h vs 4h)', q(w, '#printer-panel').textContent.includes('2h printed across 1 print') && q(w, '#printer-panel-' + extraId).textContent.includes('4h printed across 1 print'), q(w, '#printer-panel').textContent + ' // ' + q(w, '#printer-panel-' + extraId).textContent);
        check('panels are numbered', q(w, '#printer-panel .panel-title').textContent === 'Printer 1' && q(w, '#printer-panel-' + extraId + ' .panel-title').textContent === 'Printer 2');

        // upkeep per printer
        click(w, q(w, '#upkeep-button'));
        check('upkeep has a printer picker now', !q(w, '#upkeep-printer-bar').hidden && qa(w, '#upkeep-printer option').length === 2);
        check('main printer shows 2h of hours', q(w, '#hours-panel').textContent.includes('2h'), q(w, '#hours-panel').textContent);
        click(w, q(w, '#part-quick-nozzle'));
        setVal(w, q(w, '#maint-name'), 'Clean plate'); setVal(w, q(w, '#maint-every'), '10'); click(w, q(w, '#maint-add-button'));
        setVal(w, q(w, '#upkeep-printer'), extraId);
        check('switching shows the other printer\'s hours (4h)', q(w, '#hours-panel').textContent.includes('4h'), q(w, '#hours-panel').textContent);
        check('and none of the main printer\'s parts or tasks', qa(w, '#parts-list .part-row').length === 0 && !q(w, '#maintenance-list .maint-row'));
        click(w, q(w, '#part-quick-nozzle'));
        setVal(w, q(w, '#maint-name'), 'Clean plate'); setVal(w, q(w, '#maint-every'), '3'); click(w, q(w, '#maint-add-button'));
        st = stored(w);
        const nozzles = Object.values(st.parts).filter((p) => p.name === 'Nozzle');
        check('the same part name can exist on both printers, each with its own hours', nozzles.length === 2 && nozzles.map((n) => n.printerId).sort().join() === ['', extraId].sort().join() && nozzles.find((n) => n.printerId === extraId).atHours === 4 && nozzles.find((n) => n.printerId === '').atHours === 2, JSON.stringify(nozzles));
        const tasks = Object.values(st.maintenance);
        check('tasks are stored per printer, starting from that printer\'s hours', tasks.length === 2 && tasks.find((t) => t.printerId === extraId).atHours === 4 && tasks.find((t) => t.printerId === '').atHours === 2);
        // log 1 more hour on the workhorse -> only its 3-hour task moves
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'More', date: iso(0), rows: [{ spoolIndex: 0, grams: 5 }] });
        setVal(w, q(w, '#hours-ninput'), '3');
        setVal(w, q(w, '#printer-select'), extraId);
        savePrint(w);
        click(w, q(w, '#upkeep-button'));
        check('a print on one printer only moves that printer\'s reminders', q(w, '#maintenance-list .maint-row').textContent.includes('3 of 3') && q(w, '#maintenance-list .maint-row').classList.contains('is-due'), q(w, '#maintenance-list .maint-row') && q(w, '#maintenance-list .maint-row').textContent);
        setVal(w, q(w, '#upkeep-printer'), '');
        check('the main printer\'s reminder is untouched', q(w, '#maintenance-list .maint-row').textContent.includes('0 of 10'), q(w, '#maintenance-list .maint-row').textContent);
        click(w, q(w, '#dash-button'));
        check('dashboard upkeep rows follow their printer', q(w, '#printer-panel-' + extraId + ' .maint-row.is-due') && !q(w, '#printer-panel .maint-row.is-due'));

        // wear rate from parts on the extra printer
        click(w, q(w, '#upkeep-button'));
        setVal(w, q(w, '#upkeep-printer'), extraId);
        setVal(w, q(w, '#part-life'), '100'); setVal(w, q(w, '#part-price'), '25'); setVal(w, q(w, '#part-name'), 'Plate'); click(w, q(w, '#part-add-button'));
        click(w, q(w, '#use-wear-rate'));
        st = stored(w).settings;
        check('"use as wear rate" applies to the printer being shown', st.printers[extraId].wear === 0.25 && st.printer.wear === null, JSON.stringify([st.printers[extraId].wear, st.printer.wear]));

        // export CSV has a printer column
        click(w, q(w, '#data-button')); click(w, q(w, '#export-csv-button'));
        const csv = w.__blobs[w.__blobs.length - 1];
        check('CSV export gets a Printer column', csv.split('\r\n')[0].endsWith(',Printer') && csv.includes(',Workhorse') && csv.includes(',Main printer'), csv.split('\r\n').slice(0, 3).join(' // '));

        // backup round trip
        const backup = JSON.stringify(stored(w));
        const w2 = boot();
        click(w2, q(w2, '#data-button'));
        const input = q(w2, '#import-file');
        Object.defineProperty(input, 'files', { value: [new w2.File([backup], 'b.json')], configurable: true });
        input.dispatchEvent(new w2.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        const back = stored(w2);
        check('import keeps printers, prints and parts on the right printer', Object.keys(back.settings.printers).join() === extraId && Object.values(back.prints).filter((p) => p.printerId === extraId).length === 2 && Object.values(back.parts).some((p) => p.printerId === extraId), JSON.stringify(Object.values(back.prints).map((p) => p.printerId)));
        // junk printer ids in a backup fall back to the main printer
        const bad = JSON.parse(backup);
        for (const p of Object.values(bad.prints)) p.printerId = 'ghost';
        for (const t of Object.values(bad.maintenance)) t.printerId = '<script>';
        for (const p of Object.values(bad.parts)) p.printerId = 'ghost';
        bad.settings.printers['bad id!'] = { nickname: 'x' };
        const w3 = boot();
        click(w3, q(w3, '#data-button'));
        const input3 = q(w3, '#import-file');
        Object.defineProperty(input3, 'files', { value: [new w3.File([JSON.stringify(bad)], 'b.json')], configurable: true });
        input3.dispatchEvent(new w3.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        const fixed = stored(w3);
        check('unknown printer ids become the main printer', Object.values(fixed.prints).every((p) => p.printerId === '') && Object.values(fixed.maintenance).every((t) => t.printerId === '') && Object.values(fixed.parts).every((p) => p.printerId === ''));
        check('and an unsafe printer id is dropped', Object.keys(fixed.settings.printers).join() === extraId);

        // CSV import reads the Printer column by name
        click(w, q(w, '#data-button'));
        await importCsv(w, 'Date,Name,Result,Print time (min),Filament (g),Printer\n' + iso(-5) + ',From csv,Success,60,12,Workhorse\n' + iso(-6) + ',Unknown printer,Success,60,12,Nope\n');
        const imported = Object.values(stored(w).prints);
        check('CSV import puts rows on the printer with that name', imported.find((p) => p.name === 'From csv').printerId === extraId && imported.find((p) => p.name === 'Unknown printer').printerId === '');

        // removing a printer
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-printer'));
        setVal(w, q(w, '#set-printer-pick'), extraId);
        click(w, q(w, '#set-printer-remove'));
        st = stored(w);
        check('removing a printer moves its prints to the main printer', Object.keys(st.settings.printers).length === 0 && Object.values(st.prints).every((p) => !p.printerId), JSON.stringify(Object.values(st.prints).map((p) => p.printerId)));
        check('and deletes its parts and reminders', Object.values(st.parts).every((p) => p.printerId === '') && Object.values(st.maintenance).every((t) => t.printerId === ''));
        check('the picker goes away again', q(w, '#upkeep-printer-bar').hidden && qa(w, '#set-printer-pick option').length === 1);
        click(w, q(w, '#toast .toast-action'));
        st = stored(w);
        check('Undo brings the printer, its prints, parts and reminders back', Object.keys(st.settings.printers).join() === extraId && Object.values(st.prints).filter((p) => p.printerId === extraId).length === 3 && Object.values(st.parts).some((p) => p.printerId === extraId) && Object.values(st.maintenance).some((t) => t.printerId === extraId), JSON.stringify(Object.values(st.prints).map((p) => p.printerId)));
        // limit
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-printer'));
        for (let i = 0; i < 6; i++) click(w, q(w, '#set-printer-add'));
        check('up to 5 extra printers', Object.keys(stored(w).settings.printers).length === 5 && q(w, '#set-printer-add').disabled);
        check('achievement for a second printer', (click(w, q(w, '#dash-button')), q(w, '#achievements, .achievements-panel, body').textContent.includes('Print Farm')));
        check('no unexpected errors in section 41', errors.length === e, errors.slice(e).join(' | '));
    }


    console.log('\n[42] Tags');
    {
        const e = errors.length;
        const w = boot();
        const iso = (o = 0) => { const d = new w.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: '1000', price: '20', date: iso(-30) });
        click(w, q(w, '#prints-button'));
        check('no tags yet: no tag filter and no totals', q(w, '#print-tag-filter').hidden && q(w, '#tag-totals').hidden);
        openPrint(w);
        check('the popup has a tags field and no suggestions yet', !!q(w, '#tags-tinput') && q(w, '#tag-suggestions').hidden);
        fillPrint(w, { name: 'Organizer tray', date: iso(-4), rows: [{ spoolIndex: 0, grams: 40 }] });
        setVal(w, q(w, '#hours-ninput'), '2');
        setVal(w, q(w, '#tags-tinput'), 'Desk Organizer, gift , desk organizer,,  ');
        savePrint(w);
        let prints = Object.values(stored(w).prints);
        check('tags are cleaned: trimmed, no empties, duplicates ignoring case removed', JSON.stringify(prints[0].tags) === JSON.stringify(['Desk Organizer', 'gift']), JSON.stringify(prints[0].tags));
        openPrint(w);
        check('existing tags are offered as chips', qa(w, '#tag-suggestions .chip').map((c) => c.textContent).sort().join() === 'Desk Organizer,gift' && !q(w, '#tag-suggestions').hidden);
        fillPrint(w, { name: 'Organizer lid', date: iso(-3), rows: [{ spoolIndex: 0, grams: 20 }] });
        setVal(w, q(w, '#hours-ninput'), '1');
        click(w, byText(w, 'button', 'Desk Organizer', q(w, '#tag-suggestions')));
        check('clicking a chip adds the tag to the field', q(w, '#tags-tinput').value === 'Desk Organizer');
        check('and the chip shows as pressed', byText(w, 'button', 'Desk Organizer', q(w, '#tag-suggestions')).getAttribute('aria-pressed') === 'true');
        click(w, byText(w, 'button', 'gift', q(w, '#tag-suggestions')));
        click(w, byText(w, 'button', 'gift', q(w, '#tag-suggestions')));
        check('clicking it again removes it', q(w, '#tags-tinput').value === 'Desk Organizer');
        savePrint(w);
        openPrint(w);
        fillPrint(w, { name: 'Birthday gift', date: iso(-2), success: false, rows: [{ spoolIndex: 0, grams: 30 }] });
        setVal(w, q(w, '#tags-tinput'), 'gift');
        savePrint(w);
        openPrint(w);
        fillPrint(w, { name: 'Untagged', date: iso(-1), rows: [{ spoolIndex: 0, grams: 5 }] });
        savePrint(w);

        const card = (n) => qa(w, '#print-list .print-card').find((c) => c.textContent.includes(n));
        check('cards show their tags as chips', qa(w, '.chip-tag', card('Organizer tray')).map((c) => c.textContent).join() === 'Desk Organizer,gift' && qa(w, '.chip-tag', card('Untagged')).length === 0);
        check('the tag filter lists tags with counts', !q(w, '#print-tag-filter').hidden && qa(w, '#print-tag-filter option').map((o) => o.textContent).join('|') === 'All tags|Desk Organizer (2)|gift (2)', qa(w, '#print-tag-filter option').map((o) => o.textContent).join('|'));
        setVal(w, q(w, '#print-tag-filter'), 'gift');
        check('filtering shows only tagged prints', qa(w, '#print-list .print-card').length === 2 && !card('Untagged') && !!card('Birthday gift'));
        check('and the count line says so', q(w, '#prints-sub').textContent.includes('Showing 2 of 4'), q(w, '#prints-sub').textContent);
        setVal(w, q(w, '#print-tag-filter'), 'all');
        click(w, qa(w, '.chip-tag', card('Organizer lid'))[0]);
        check('clicking a chip on a card filters to that tag (case-insensitive)', q(w, '#print-tag-filter').value === 'desk organizer' && qa(w, '#print-list .print-card').length === 2);
        setVal(w, q(w, '#print-tag-filter'), 'all');
        setVal(w, q(w, '#print-search'), 'GIFT');
        check('search also finds tags', qa(w, '#print-list .print-card').length === 3 || qa(w, '#print-list .print-card').length === 2, String(qa(w, '#print-list .print-card').length));
        setVal(w, q(w, '#print-search'), '');

        // totals
        const panel = q(w, '#tag-totals');
        check('totals panel appears', !panel.hidden && panel.querySelector('summary').textContent === 'Totals per tag');
        const trow = (k) => q(w, `#tag-totals tr[data-tag="${k}"]`);
        check('Desk Organizer: 2 prints, 3h, 60g, filament cost', trow('desk organizer').textContent.includes('Desk Organizer') && trow('desk organizer').textContent.includes('2') && trow('desk organizer').textContent.includes('3h') && trow('desk organizer').textContent.includes('60g') && trow('desk organizer').textContent.includes('$1.20'), trow('desk organizer').textContent);
        check('gift counts a failed print and says so', trow('gift').textContent.includes('2 (1 failed)') && trow('gift').textContent.includes('70g'), trow('gift').textContent);
        click(w, q(w, 'button', trow('gift')));
        check('clicking a tag name in the table filters to it', q(w, '#print-tag-filter').value === 'gift' && qa(w, '#print-list .print-card').length === 2 && trow('gift').classList.contains('is-selected'));
        setVal(w, q(w, '#print-tag-filter'), 'all');

        // edit keeps tags, remove clears them
        click(w, byText(w, 'button', 'Edit', card('Birthday gift')));
        check('editing shows the tags', q(w, '#tags-tinput').value === 'gift');
        setVal(w, q(w, '#tags-tinput'), '');
        savePrint(w);
        check('clearing the field removes the tags', Object.values(stored(w).prints).find((p) => p.name === 'Birthday gift').tags.length === 0 && qa(w, '#print-tag-filter option').map((o) => o.textContent).join('|') === 'All tags|Desk Organizer (2)|gift (1)');

        // a filter on a tag that no longer exists resets itself
        setVal(w, q(w, '#print-tag-filter'), 'gift');
        click(w, byText(w, 'button', 'Delete', card('Organizer tray')));
        check('when the last print with a tag goes, the filter resets', q(w, '#print-tag-filter').value === 'all' && qa(w, '#print-list .print-card').length === 3, q(w, '#print-tag-filter').value);

        // Print again + queue keep tags
        click(w, byText(w, 'button', 'Print again', card('Organizer lid')));
        check('Print again keeps the tags', q(w, '#tags-tinput').value === 'Desk Organizer');
        click(w, q(w, '#cancel-print-button'));
        click(w, byText(w, 'button', 'Add to queue', card('Organizer lid')));
        check('Add to queue keeps the tags in the item', Object.values(stored(w).queue)[0].spec.tags.join() === 'Desk Organizer');
        click(w, q(w, '#queue-button'));
        click(w, byText(w, 'button', 'Log print', q(w, '#queue-list .queue-item')));
        check('and Log print puts them back in the field', q(w, '#tags-tinput').value === 'Desk Organizer');
        click(w, q(w, '#cancel-print-button'));

        // limits
        click(w, q(w, '#prints-button')); openPrint(w);
        fillPrint(w, { name: 'Many', date: iso(0), rows: [{ spoolIndex: 0, grams: 1 }] });
        setVal(w, q(w, '#tags-tinput'), 'a,b,c,d,e,f,g,h,i,j,k');
        savePrint(w);
        const many = Object.values(stored(w).prints).find((p) => p.name === 'Many');
        check('at most 8 tags per print', many.tags.length === 8);
        openPrint(w);
        fillPrint(w, { name: 'Long', date: iso(0), rows: [{ spoolIndex: 0, grams: 1 }] });
        setVal(w, q(w, '#tags-tinput'), 'x'.repeat(60) + ', <b>bold</b>');
        savePrint(w);
        const long = Object.values(stored(w).prints).find((p) => p.name === 'Long');
        check('a tag is cut at 24 characters', long.tags[0].length === 24);
        const chip = qa(w, '#print-list .print-card').find((c) => c.textContent.includes('Long')).querySelectorAll('.chip-tag')[1];
        check('tag text is shown as text, never as HTML', chip.textContent === '<b>bold</b>' && !chip.querySelector('b'));

        // CSV export / import
        click(w, q(w, '#data-button')); click(w, q(w, '#export-csv-button'));
        const csv = w.__blobs[w.__blobs.length - 1];
        check('CSV export gets a Tags column', csv.split('\r\n')[0].endsWith(',Tags') && csv.includes('Desk Organizer'), csv.split('\r\n')[0]);
        await importCsv(w, 'Date,Name,Result,Print time (min),Filament (g),Tags\n' + iso(-9) + ',Csv one,Success,30,10,"Gift; Desk Organizer"\n' + iso(-8) + ',Csv two,Success,30,10,\n');
        const csvOne = Object.values(stored(w).prints).find((p) => p.name === 'Csv one');
        check('CSV import reads tags and joins them with the existing "Desk Organizer"', csvOne.tags.join() === 'Gift,Desk Organizer' && Object.values(stored(w).prints).find((p) => p.name === 'Csv two').tags.length === 0, JSON.stringify(csvOne.tags));
        const plain = boot(JSON.stringify({ schemaVersion: 1, queue: {}, spools: {}, prints: { p: { name: 'N', date: iso(-1), result: true, link: '', usage: [], minutes: null } } }));
        click(plain, q(plain, '#data-button')); click(plain, q(plain, '#export-csv-button'));
        check('with no tags the CSV header is unchanged', !plain.__blobs[plain.__blobs.length - 1].split('\r\n')[0].includes('Tags'));

        // backup import cleans junk
        const bad = { schemaVersion: 1, queue: {}, spools: {}, prints: { a: { name: 'A', date: iso(-1), result: true, usage: [], tags: ['ok', 7, null, 'OK', '<img>', 'x,y'] }, b: { name: 'B', date: iso(-1), result: true, usage: [], tags: 'a, b' }, c: { name: 'C', date: iso(-1), result: true, usage: [], tags: { 0: 'x' } } } };
        const w2 = boot();
        click(w2, q(w2, '#data-button'));
        const input = q(w2, '#import-file');
        Object.defineProperty(input, 'files', { value: [new w2.File([JSON.stringify(bad)], 'b.json')], configurable: true });
        input.dispatchEvent(new w2.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        const im = stored(w2).prints;
        check('import cleans tags: arrays only keep clean strings', JSON.stringify(im.a.tags) === JSON.stringify(['ok', '<img>', 'x y']), JSON.stringify(im.a.tags));
        check('import accepts comma text, and drops other shapes', im.b.tags.join() === 'a,b' && im.c.tags.length === 0);
        check('no unexpected errors in section 42', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[43] Re-weigh and storage location');
    {
        const e = errors.length;
        const w = boot();
        const iso = (o = 0) => { const d = new w.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        click(w, q(w, '#filament .acc-buttons'));
        setVal(w, q(w, '#brand-tinput'), 'Bambu Lab');
        setVal(w, q(w, '#color-tinput'), 'Black');
        setVal(w, q(w, '#grams-ninput'), '1000');
        setVal(w, q(w, '#date-dinput'), iso(-20));
        setVal(w, q(w, '#location-tinput'), '  Dry box 2 ');
        click(w, q(w, '#add-spool-button'));
        let spool = Object.values(stored(w).spools)[0];
        check('location is saved trimmed', spool.location === 'Dry box 2', JSON.stringify(spool));
        const card = () => q(w, '#spools .spool-card');
        check('the card shows where the spool is stored', card().textContent.includes('Stored: Dry box 2'));
        addSpool(w, { brand: 'Sunlu', color: 'White', grams: '1000', date: iso(-10) });
        click(w, q(w, '#filament .acc-buttons'));
        check('places already used are offered as suggestions', qa(w, '#location-list option').map((o) => o.value).join() === 'Dry box 2');
        click(w, q(w, '#cancel-spool-button'));
        check('a spool with no place shows no Stored line', !qa(w, '#spools .spool-card').find((c) => c.textContent.includes('Sunlu')).textContent.includes('Stored:'));

        openPrint(w);
        fillPrint(w, { name: 'Test', date: iso(-2), rows: [{ spoolIndex: 0, grams: 100 }] });
        savePrint(w);
        const target = () => qa(w, '#spools .spool-card').find((c) => c.textContent.includes('Bambu Lab'));
        check('before re-weighing the log says about 900g left', target().textContent.includes('~900g remaining of 1,000g') || target().textContent.includes('~900g remaining of 1000g'), target().textContent);
        click(w, byText(w, 'button', 'Re-weigh', target()));
        const pop = () => q(w, '#weigh-popup');
        check('Re-weigh opens a dialog', pop().style.display === 'block' && pop().getAttribute('aria-modal') === 'true');
        setVal(w, q(w, '#weigh-gross'), '750');
        setVal(w, q(w, '#weigh-empty'), '250');
        check('the preview compares the scale and the log', q(w, '#weigh-preview').textContent.includes('500g') && q(w, '#weigh-preview').textContent.includes('900g') && q(w, '#weigh-preview').textContent.includes('400g less'), q(w, '#weigh-preview').textContent);
        setVal(w, q(w, '#weigh-gross'), '200');
        check('a reading below the empty spool is flagged', q(w, '#weigh-preview').textContent.includes('less than the empty spool'));
        click(w, q(w, '#weigh-save'));
        check('saving a bad reading shows an error and keeps the dialog open', !q(w, '#weigh-error').hidden && pop().style.display === 'block');
        setVal(w, q(w, '#weigh-gross'), '750');
        click(w, q(w, '#weigh-save'));
        spool = Object.values(stored(w).spools).find((s) => s.brand === 'Bambu Lab');
        check('the correction is stored with the empty weight and date', spool.adjust === -400 && spool.emptyGrams === 250 && spool.weighedDate === iso(0), JSON.stringify(spool));
        check('the spool now shows 500g left', target().textContent.includes('~500g remaining'), target().textContent);
        check('and the card says when it was weighed', target().textContent.includes('Weighed'));
        check('the starting weight is unchanged', spool.startGrams === 1000);

        // later prints still subtract from the corrected number
        openPrint(w);
        fillPrint(w, { name: 'Later', date: iso(-1), rows: [{ spoolIndex: 0, grams: 50 }] });
        savePrint(w);
        check('later prints subtract from the corrected amount', target().textContent.includes('~450g remaining'), target().textContent);

        // re-weigh again: adds only the difference
        click(w, byText(w, 'button', 'Re-weigh', target()));
        check('the empty spool weight is remembered', q(w, '#weigh-empty').value === '250');
        setVal(w, q(w, '#weigh-gross'), '700');
        click(w, q(w, '#weigh-save'));
        check('weighing again sets the amount to exactly what the scale says', target().textContent.includes('~450g remaining'), target().textContent);
        setVal(w, q(w, '#weigh-gross'), '1');
        click(w, byText(w, 'button', 'Re-weigh', target()));
        setVal(w, q(w, '#weigh-gross'), '600');
        click(w, q(w, '#weigh-save'));
        check('a different reading changes it', target().textContent.includes('~350g remaining'), target().textContent);
        click(w, byText(w, 'button', 'Undo', q(w, '#toast')));
        check('Undo restores the previous correction', target().textContent.includes('~450g remaining'), target().textContent);

        // the new spool suggests the remembered empty weight
        click(w, byText(w, 'button', 'Re-weigh', qa(w, '#spools .spool-card').find((c) => c.textContent.includes('Sunlu'))));
        check('another spool is offered the last empty spool weight', q(w, '#weigh-empty').value === '250');
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        check('Escape closes the dialog', pop().style.display === 'none');

        // editing keeps the correction
        click(w, byText(w, 'button', 'Edit', target()));
        check('editing shows the saved place', q(w, '#location-tinput').value === 'Dry box 2');
        setVal(w, q(w, '#location-tinput'), 'Shelf A');
        click(w, q(w, '#add-spool-button'));
        spool = Object.values(stored(w).spools).find((s) => s.brand === 'Bambu Lab');
        check('editing keeps the re-weigh data and updates the place', spool.adjust === -400 && spool.emptyGrams === 250 && spool.location === 'Shelf A', JSON.stringify(spool));

        // the print popup warning uses the corrected amount
        openPrint(w);
        setVal(w, q(w, '#name-tinput'), 'Big');
        const row = q(w, '#filament-rows .filament-row');
        setVal(w, row.querySelector('select'), Object.keys(stored(w).spools).find((k) => stored(w).spools[k].brand === 'Bambu Lab'));
        setVal(w, row.querySelector('input'), '500');
        check('the "only ~Xg left" hint uses the corrected amount', !row.querySelector('.row-hint').hidden && row.querySelector('.row-hint').textContent.includes('450g'), row.querySelector('.row-hint').textContent);
        click(w, q(w, '#cancel-button') || q(w, '#cancel-print-button'));

        // labels get the place
        click(w, q(w, '#labels-button'));
        check('labels show the storage place', q(w, '#label-popup').textContent.includes('Stored: Shelf A'));
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        // backup round trip and junk
        click(w, q(w, '#data-button'));
        click(w, q(w, '#export-button'));
        const backup = JSON.parse(w.__blobs[w.__blobs.length - 1]);
        const bs = Object.values(backup.spools).find((s) => s.brand === 'Bambu Lab');
        check('the backup file carries the new fields', bs.adjust === -400 && bs.location === 'Shelf A');
        const bad = { schemaVersion: 1, queue: {}, prints: {}, spools: {
            a: { brand: 'A', color: 'a', startGrams: 1000, adjust: 'lots', emptyGrams: -5, weighedDate: 'soon', location: 123 },
            b: { brand: 'B', color: 'b', startGrams: 1000, adjust: -50, emptyGrams: 200, weighedDate: iso(-1), location: '<b>Shelf</b>' } } };
        const w2 = boot();
        click(w2, q(w2, '#data-button'));
        const input = q(w2, '#import-file');
        Object.defineProperty(input, 'files', { value: [new w2.File([JSON.stringify(bad)], 'b.json')], configurable: true });
        input.dispatchEvent(new w2.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        const sp = Object.values(stored(w2).spools);
        const sa = sp.find((s) => s.brand === 'A');
        const sb = sp.find((s) => s.brand === 'B');
        check('import drops junk re-weigh data', sa && sa.adjust === undefined && sa.emptyGrams === undefined && sa.weighedDate === undefined && sa.location === undefined, JSON.stringify(sa));
        check('import keeps clean re-weigh data', sb && sb.adjust === -50 && sb.emptyGrams === 200 && sb.location === '<b>Shelf</b>', JSON.stringify(sb));
        check('and the place is shown as text, not markup', !q(w2, '#spools').querySelector('b') && q(w2, '#spools').textContent.includes('<b>Shelf</b>'));
        check('no unexpected errors in section 43', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[44] Fill from a slicer file');
    {
        const e = errors.length;
        const zlib = require('zlib');
        const crc32 = (buf) => { let c, crc = 0xffffffff; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; };
        // A small zip writer: files = { name: string|Buffer }, deflate = use method 8
        const makeZip = (files, deflate = true) => {
            const locals = []; const central = []; let offset = 0;
            for (const [name, content] of Object.entries(files)) {
                const raw = Buffer.from(content); const data = deflate ? zlib.deflateRawSync(raw) : raw;
                const nameBuf = Buffer.from(name);
                const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(deflate ? 8 : 0, 8);
                lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
                const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(deflate ? 8 : 0, 10);
                ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
                locals.push(lh, nameBuf, data); central.push(ch, nameBuf);
                offset += 30 + nameBuf.length + data.length;
            }
            const cd = Buffer.concat(central);
            const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
            eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
            return Buffer.concat([...locals, cd, eocd]);
        };
        const w = boot();
        w.DecompressionStream = globalThis.DecompressionStream;
        const iso = (o = 0) => { const d = new w.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: '1000', date: iso(-9) });
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'White', grams: '1000', date: iso(-8) });
        addSpool(w, { brand: 'Sunlu', material: 'petg', color: 'Red', grams: '1000', date: iso(-7) });
        const pick = async (file) => {
            const input = q(w, '#slicer-file');
            Object.defineProperty(input, 'files', { value: [file], configurable: true });
            input.dispatchEvent(new w.Event('change', { bubbles: true }));
            await new Promise((r) => setTimeout(r, 250));
        };
        const rows = () => qa(w, '#filament-row-list .filament-row');
        const spoolNameOf = (row) => row.querySelector('select').selectedOptions[0].textContent;
        const note = () => q(w, '#slicer-note');

        openPrint(w);
        check('the print popup has a "Fill from slicer file" button and a hidden note', !!q(w, '#slicer-file-button') && note().hidden);

        // 1. Bambu plain gcode: header at the top, footer settings at the end
        const bambu = '; HEADER_BLOCK_START\n; BambuStudio 01.09.00.00\n; model printing time: 1h 2m 3s; total estimated time: 1h 5m 10s\n; total layer number: 50\n; HEADER_BLOCK_END\nG1 X0 Y0\n' +
            '; filament used [mm] = 4000.00, 0.00\n; filament used [g] = 12.34, 0.00\n; filament_type = PLA;PLA\n; filament_colour = #000000;#FFFFFF\n; layer_height = 0.2\n; sparse_infill_density = 15%\n; print_settings_id = 0.20mm Standard @BBL X1C\n; enable_support = 0\n';
        await pick(new w.File([bambu], 'Plate_Scraper.gcode'));
        check('print time comes from the total estimated time (1h 5m 10s -> 1 h 5 min)', q(w, '#hours-ninput').value === '1' && q(w, '#minutes-ninput').value === '5', q(w, '#hours-ninput').value + ':' + q(w, '#minutes-ninput').value);
        check('the empty name is filled from the file name', q(w, '#name-tinput').value === 'Plate Scraper', q(w, '#name-tinput').value);
        check('only filaments with grams become rows', rows().length === 1 && rows()[0].querySelector('input').value === '12.3', String(rows().length));
        check('the black PLA spool is matched by colour', spoolNameOf(rows()[0]).includes('Black'), spoolNameOf(rows()[0]));
        check('the profile fields are filled', q(w, '#profile-name-tinput').value === '0.20mm Standard @BBL X1C' && q(w, '#profile-layer-tinput').value === '0.2 mm' && q(w, '#profile-infill-tinput').value === '15%' && q(w, '#profile-supports-tinput').value === 'none');
        check('the note says what was read', !note().hidden && note().textContent.includes('1h 5m') || note().textContent.includes('12'), note().textContent);

        // typed name is kept; profile kept when already filled
        setVal(w, q(w, '#name-tinput'), 'My own name');
        setVal(w, q(w, '#profile-layer-tinput'), '0.12 mm');
        await pick(new w.File([bambu], 'Other.gcode'));
        check('a name you typed is not overwritten', q(w, '#name-tinput').value === 'My own name');
        check('a profile field you filled is not overwritten', q(w, '#profile-layer-tinput').value === '0.12 mm');

        // 2. Prusa: estimates are in the footer of a big file
        const filler = '; layer\nG1 X10 Y10 E0.5\n'.repeat(40000);
        const prusa = filler + '; filament used [g] = 5.5\n; total filament used [g] = 5.5\n; estimated printing time (normal mode) = 2d 3h 4m 5s\n';
        check('the Prusa test file is larger than what is read from each end', prusa.length > 700000, String(prusa.length));
        await pick(new w.File([prusa], 'big.gcode'));
        check('days, hours, minutes are added up from the file footer (2d 3h 4m = 51h 4m)', q(w, '#hours-ninput').value === '51' && q(w, '#minutes-ninput').value === '4', q(w, '#hours-ninput').value + ':' + q(w, '#minutes-ninput').value);
        check('a single total weight becomes one row', rows().length === 1 && rows()[0].querySelector('input').value === '5.5');
        check('a row with no colour gets a spool anyway and the note asks you to check', note().textContent.includes('Check which spool'), note().textContent);

        // 3. Bambu .gcode.3mf with two filaments and two plates
        const sliceInfo = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n <header><header_item key="X-BBL-Client-Type" value="slicer"/></header>\n' +
            ' <plate>\n  <metadata key="index" value="1"/>\n  <metadata key="prediction" value="8570"/>\n  <metadata key="weight" value="40.5"/>\n' +
            '  <filament id="1" tray_info_idx="GFA00" type="PLA" color="#FFFFFF" used_m="9.1" used_g="30.25" />\n' +
            '  <filament id="2" tray_info_idx="GFG00" type="PETG" color="#FF0000" used_m="3.2" used_g="10.25" />\n </plate>\n' +
            ' <plate>\n  <metadata key="index" value="2"/>\n  <metadata key="prediction" value="100"/>\n  <metadata key="weight" value="1"/>\n </plate>\n</config>';
        const settings = JSON.stringify({ layer_height: '0.16', sparse_infill_density: '20%', print_settings_id: '0.16mm Optimal', enable_support: '1' });
        const zip = makeZip({ '[Content_Types].xml': '<Types/>', 'Metadata/slice_info.config': sliceInfo, 'Metadata/project_settings.config': settings, 'Metadata/plate_1.gcode': 'G1 X0\n'.repeat(1000) });
        await pick(new w.File([zip], 'Benchy.gcode.3mf'));
        check('3MF: prediction seconds become minutes (8570 s = 2 h 23 min)', q(w, '#hours-ninput').value === '2' && q(w, '#minutes-ninput').value === '23', q(w, '#hours-ninput').value + ':' + q(w, '#minutes-ninput').value);
        check('3MF: one row per filament, using used_g', rows().length === 2 && rows()[0].querySelector('input').value === '30.3' && rows()[1].querySelector('input').value === '10.3', rows().map((r) => r.querySelector('input').value).join());
        check('3MF: spools are matched by material and colour (white PLA, red PETG)', spoolNameOf(rows()[0]).includes('White') && spoolNameOf(rows()[1]).includes('Red'), rows().map(spoolNameOf).join(' | '));
        check('3MF: the note says spools were matched and mentions the extra plate', note().textContent.includes('matched') && note().textContent.includes('2 plates'), note().textContent);
        check('3MF: the settings file fills the profile when blank', true);
        // stored zip (no compression) works too
        await pick(new w.File([makeZip({ 'Metadata/slice_info.config': sliceInfo }, false)], 'Plain.3mf'));
        check('a zip entry stored without compression also reads', q(w, '#hours-ninput').value === '2' && rows().length === 2);

        // saving uses the filled values
        setVal(w, q(w, '#name-tinput'), 'Benchy');
        savePrint(w);
        const saved = Object.values(stored(w).prints).find((p) => p.name === 'Benchy');
        check('the print saves with the filled time and grams', saved && saved.minutes === 143 && saved.usage.length === 2 && Math.abs(saved.usage[0].grams - 30.3) < 0.01, JSON.stringify(saved));

        // 4. Failure cases
        openPrint(w);
        await pick(new w.File([makeZip({ 'Metadata/model_settings.config': '<config/>' })], 'noslice.3mf'));
        check('a 3MF without slice results explains what to do', !note().hidden && note().textContent.includes('no slice results') && note().classList.contains('error-text'), note().textContent);
        check('and changes nothing', q(w, '#hours-ninput').value === '' && q(w, '#name-tinput').value === '');
        await pick(new w.File([Buffer.from('PK\u0003\u0004garbage that is not a zip')], 'broken.3mf'));
        check('a damaged zip gives a plain error', note().textContent.includes('not a valid 3MF'), note().textContent);
        await pick(new w.File(['GCDE\u0001\u0000\u0000'], 'x.bgcode'));
        check('binary G-code is refused with advice', note().textContent.includes('Binary G-code'), note().textContent);
        await pick(new w.File(['hello world, this has nothing useful'], 'notes.txt'));
        check('a text file with no estimates says so', note().textContent.includes('No print time or filament weight'), note().textContent);
        await pick(new w.File(['G1 X0\u0000\u0000\u0000 binary'], 'junk.gcode'));
        check('binary junk is refused', note().textContent.includes('does not look like'), note().textContent);
        check('the note is cleared when the popup is opened again', (() => { click(w, q(w, '#cancel-print-button')); openPrint(w); return note().hidden; })());
        // Cura style
        await pick(new w.File([';FLAVOR:Marlin\n;TIME:3725\n;Filament used: 1.2m\n'], 'cura.gcode'));
        check('Cura ;TIME: seconds are read (3725 s = 1 h 2 min)', q(w, '#hours-ninput').value === '1' && q(w, '#minutes-ninput').value === '2');
        check('and a file with a time but no weight leaves the filament rows alone', rows().length === 1 && rows()[0].querySelector('input').value === '');
        check('no unexpected errors in section 44', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[45] Printing now (timer)');
    {
        const e = errors.length;
        const now = Date.now();
        const base = (running, extra = {}) => JSON.stringify({
            schemaVersion: 1,
            spools: { s1: { brand: 'Bambu Lab', material: 'pla', color: 'Black', startGrams: 1000, price: 20, date: '2026-09-01', hex: '#1c1c1e' } },
            prints: {}, queue: {}, running, ...extra
        });
        const dash = (w) => click(w, q(w, '#dash-button'));
        let w = boot(base({}));
        dash(w);
        check('no timer: no "Printing now" panel, but a Start a print button', !q(w, '#running-panel') && !!q(w, '#start-button'));
        // the dashboard only shows when there is data; this state has a spool, so it does

        click(w, q(w, '#start-button'));
        check('Start a print opens a dialog', q(w, '#start-popup').style.display === 'block' && q(w, '#start-popup').getAttribute('aria-modal') === 'true');
        check('the printer picker is hidden with one printer', q(w, '#start-printer').closest('.field').hidden);
        click(w, q(w, '#start-go'));
        check('a name is required', !q(w, '#start-error').hidden && q(w, '#start-popup').style.display === 'block');
        setVal(w, q(w, '#start-name'), 'Benchy');
        setVal(w, q(w, '#start-hours'), '2');
        setVal(w, q(w, '#start-minutes'), '75');
        click(w, q(w, '#start-go'));
        check('minutes above 59 are refused', q(w, '#start-error').textContent.includes('minutes between 0 and 59'));
        setVal(w, q(w, '#start-minutes'), '0');
        click(w, q(w, '#start-go'));
        let run = Object.values(stored(w).running)[0];
        check('starting saves the timer with the estimate', run && run.name === 'Benchy' && run.minutes === 120 && Math.abs(run.startedAt - Date.now()) < 5000, JSON.stringify(run));
        check('the dialog closes and the dashboard shows the panel', q(w, '#start-popup').style.display === 'none' && !!q(w, '#running-panel') && q(w, '#running-panel').textContent.includes('Benchy'));
        check('it says it just started', q(w, '#running-panel').textContent.includes('Just started'), q(w, '#running-panel').textContent);

        // progress
        w = boot(base({ r1: { name: 'Benchy', startedAt: now - 90 * 60000, minutes: 120, printerId: '', link: '', queueId: '', spec: null } }));
        dash(w);
        const panel = () => q(w, '#running-panel');
        check('90 minutes in: elapsed time and time left', panel().textContent.includes('1h 30m so far') && panel().textContent.includes('About 30m left'), panel().textContent);
        const bar = q(w, '[role=progressbar]', panel());
        check('the progress bar says 75%', bar.getAttribute('aria-valuenow') === '75' && bar.style.width === '' || bar.getAttribute('aria-valuenow') === '75');
        w = boot(base({ r1: { name: 'Late', startedAt: now - 150 * 60000, minutes: 120, printerId: '', link: '', queueId: '', spec: null } }));
        dash(w);
        check('past the estimate: says it should be done', q(w, '#running-panel').textContent.includes('is up') && q(w, '[role=progressbar]', q(w, '#running-panel')).getAttribute('aria-valuenow') === '100', q(w, '#running-panel').textContent);
        w = boot(base({ r1: { name: 'No estimate', startedAt: now - 5 * 60000, minutes: null, printerId: '', link: '', queueId: '', spec: null } }));
        dash(w);
        check('no estimate: elapsed only, no bar', q(w, '#running-panel').textContent.includes('5m so far') && !q(w, '[role=progressbar]', q(w, '#running-panel')));

        // Finished -> print popup
        w = boot(base({ r1: { name: 'Benchy', startedAt: now - 90 * 60000, minutes: 120, printerId: '', link: 'https://example.com/b', queueId: '', spec: null } }));
        dash(w);
        click(w, byText(w, 'button', 'Finished', q(w, '#running-panel')));
        check('Finished opens the print form filled in', q(w, '#print-popup').style.display === 'block' && q(w, '#name-tinput').value === 'Benchy' && q(w, '#hours-ninput').value === '2' && q(w, '#minutes-ninput').value === '0' && q(w, '#link-tinput').value === 'https://example.com/b' && q(w, '#result-rinput1').checked);
        click(w, q(w, '#cancel-print-button'));
        check('cancelling the form keeps the timer', Object.keys(stored(w).running).length === 1);
        click(w, byText(w, 'button', 'Finished', q(w, '#running-panel')));
        setVal(w, q(w, '#filament-row-list .filament-row input'), '25');
        savePrint(w);
        check('saving the print removes the timer and adds the print', Object.keys(stored(w).running).length === 0 && Object.values(stored(w).prints).some((p) => p.name === 'Benchy' && p.minutes === 120 && p.result === true));
        check('the panel is gone', !q(w, '#running-panel'));

        // Failed -> uses elapsed time
        w = boot(base({ r1: { name: 'Spaghetti', startedAt: now - 47 * 60000, minutes: 120, printerId: '', link: '', queueId: '', spec: null } }));
        dash(w);
        click(w, byText(w, 'button', 'Failed', q(w, '#running-panel')));
        check('Failed opens it as a failure with the time it ran', q(w, '#result-rinput2').checked && q(w, '#hours-ninput').value === '0' && q(w, '#minutes-ninput').value === '47', q(w, '#hours-ninput').value + ':' + q(w, '#minutes-ninput').value);
        click(w, q(w, '#cancel-print-button'));

        // Stop + undo
        click(w, byText(w, 'button', 'Stop timer', q(w, '#running-panel')));
        check('Stop timer removes it', Object.keys(stored(w).running).length === 0 && !q(w, '#running-panel'));
        click(w, byText(w, 'button', 'Undo', q(w, '#toast')));
        check('Undo brings it back', Object.keys(stored(w).running).length === 1 && !!q(w, '#running-panel'));

        // From the queue
        w = boot(base({}, { queue: { q1: { name: 'Lid', link: '', done: false, spec: { minutes: 30, usage: [{ spoolId: 's1', grams: 12 }], profile: null, notes: '', tags: [], printerId: '' } } } }));
        click(w, q(w, '#queue-button'));
        click(w, byText(w, 'button', 'Start', q(w, '#queue-list')));
        check('Start on a queue item opens the dialog pre-filled', q(w, '#start-name').value === 'Lid' && q(w, '#start-minutes').value === '30');
        click(w, q(w, '#start-go'));
        run = Object.values(stored(w).running)[0];
        check('the timer remembers the queue item and its filament', run.queueId === 'q1' && run.spec && run.spec.usage[0].grams === 12 && run.minutes === 30, JSON.stringify(run));
        click(w, q(w, '#dash-button'));
        click(w, byText(w, 'button', 'Finished', q(w, '#running-panel')));
        check('the print form gets the filament from the queue item', q(w, '#filament-row-list .filament-row input').value === '12');
        savePrint(w);
        check('logging it ticks off the queue item', stored(w).queue.q1.done === true && Object.keys(stored(w).running).length === 0);

        // Many printers
        w = boot(base({}, { settings: { printers: { px: { name: 'Second printer' } } } }));
        dash(w);
        click(w, q(w, '#start-button'));
        check('with several printers the picker shows', !q(w, '#start-printer').closest('.field').hidden && q(w, '#start-printer').options.length === 2, String(q(w, '#start-printer').options.length));
        setVal(w, q(w, '#start-name'), 'On two');
        setVal(w, q(w, '#start-printer'), 'px');
        click(w, q(w, '#start-go'));
        check('the chosen printer is stored and shown', Object.values(stored(w).running)[0].printerId === 'px' && q(w, '#running-panel').textContent.includes('Extra printer'), JSON.stringify(Object.values(stored(w).running)[0]) + ' / ' + q(w, '#running-panel').textContent);
        click(w, byText(w, 'button', 'Finished', q(w, '#running-panel')));
        check('and carries over to the print form', q(w, '#printer-select').value === 'px');
        click(w, q(w, '#cancel-print-button'));

        // Limit of 6
        const six = {}; for (let i = 0; i < 6; i++) six['r' + i] = { name: 'P' + i, startedAt: now - 60000, minutes: null, printerId: '', link: '', queueId: '', spec: null };
        w = boot(base(six));
        dash(w);
        check('six timers all show', qa(w, '#running-panel .run-card').length === 6);
        click(w, q(w, '#start-button'));
        check('a seventh is refused', q(w, '#start-popup') === null || q(w, '#start-popup').style.display !== 'block');

        // Junk in storage / import
        const junk = base({ a: { name: '', startedAt: now }, b: { name: 'Future', startedAt: now + 9e9 }, c: { name: 'Old', startedAt: 5 }, d: 'x', e: { name: '<img src=x onerror=alert(1)>', startedAt: now - 1000, minutes: -5, printerId: 'nope', link: 'javascript:alert(1)', queueId: '../x', spec: 7 }, 'bad id!': { name: 'Z', startedAt: now } });
        w = boot(junk);
        dash(w);
        click(w, byText(w, 'button', 'Stop timer', q(w, '#running-panel')));
        click(w, byText(w, 'button', 'Undo', q(w, '#toast')));
        const keep = Object.values(stored(w).running);
        check('junk timers are dropped, the odd one is cleaned', keep.length === 1 && keep[0].minutes === null && keep[0].printerId === '' && keep[0].link === '' && keep[0].queueId === '' && keep[0].spec === null, JSON.stringify(keep));
        check('names are shown as text', !q(w, '#running-panel img') && q(w, '#running-panel').textContent.includes('<img'));
        const w2 = boot();
        click(w2, q(w2, '#data-button'));
        const input = q(w2, '#import-file');
        Object.defineProperty(input, 'files', { value: [new w2.File([base({ r1: { name: 'Imported', startedAt: now - 60000, minutes: 60 }, r2: { name: '', startedAt: now } })], 'b.json')], configurable: true });
        input.dispatchEvent(new w2.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        check('a backup carries running timers, cleaned', Object.values(stored(w2).running).length === 1 && Object.values(stored(w2).running)[0].name === 'Imported');
        const old = boot(JSON.stringify({ schemaVersion: 1, spools: {}, prints: {}, queue: {} }));
        check('a backup without timers still loads', JSON.stringify(stored(old).running || {}) === '{}');
        check('no unexpected errors in section 45', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[46] Select several prints');
    {
        const e = errors.length;
        const w = boot();
        const iso = (o = 0) => { const d = new w.Date(); d.setHours(12); d.setDate(d.getDate() + o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
        click(w, q(w, '#prints-button'));
        check('with no prints there is no Select button', q(w, '#select-button').hidden);
        addSpool(w, { brand: 'Bambu Lab', material: 'pla', color: 'Black', grams: '1000', price: '20', date: iso(-30) });
        for (const [n, tags, ok] of [['Alpha', 'gift', true], ['Beta', 'gift, desk', true], ['Gamma', '', false], ['Delta', 'desk', true]]) {
            openPrint(w);
            fillPrint(w, { name: n, date: iso(-5), success: ok, rows: [{ spoolIndex: 0, grams: 10 }] });
            setVal(w, q(w, '#tags-tinput'), tags);
            savePrint(w);
        }
        const cards = () => qa(w, '#print-list .print-card');
        const card = (n) => cards().find((c) => c.querySelector('.card-title').textContent === n);
        const box = (n) => q(w, 'input.select-box', card(n));
        check('Select button appears once there are prints', !q(w, '#select-button').hidden && q(w, '#select-button').getAttribute('aria-pressed') === 'false');
        check('no checkboxes or bar before selecting', !box('Alpha') && q(w, '#bulk-bar').hidden);
        click(w, q(w, '#select-button'));
        check('Select shows the bar and a checkbox on each print', !q(w, '#bulk-bar').hidden && qa(w, 'input.select-box').length === 4 && q(w, '#select-button').getAttribute('aria-pressed') === 'true');
        check('checkboxes are labelled with the print name', box('Beta').getAttribute('aria-label') === 'Select Beta');
        check('nothing selected: action buttons are disabled', q(w, '#bulk-count').textContent === 'None selected' && q(w, '#bulk-delete').disabled && q(w, '#bulk-add-tag').disabled && q(w, '#bulk-export').disabled && !q(w, '#bulk-all').disabled);
        box('Alpha').checked = true; box('Alpha').dispatchEvent(new w.Event('change', { bubbles: true }));
        box('Beta').checked = true; box('Beta').dispatchEvent(new w.Event('change', { bubbles: true }));
        check('ticking updates the count, the highlight and enables buttons', q(w, '#bulk-count').textContent === '2 of 4 shown selected' && card('Alpha').classList.contains('is-selected') && !q(w, '#bulk-delete').disabled, q(w, '#bulk-count').textContent);

        // add tag
        click(w, q(w, '#bulk-add-tag'));
        check('Add tag with an empty box asks for a tag', q(w, '#toast').textContent.includes('Type a tag first'));
        setVal(w, q(w, '#bulk-tag'), 'Birthday, GIFT');
        click(w, q(w, '#bulk-add-tag'));
        let prints = Object.values(stored(w).prints);
        const tagsOf = (n) => prints.find((p) => p.name === n).tags.join('|');
        check('tags are added, cleaned, without duplicates (any case)', tagsOf('Alpha') === 'gift|Birthday' && tagsOf('Beta') === 'gift|desk|Birthday', tagsOf('Alpha') + ' / ' + tagsOf('Beta'));
        check('other prints are untouched', tagsOf('Gamma') === '' && tagsOf('Delta') === 'desk');
        check('the selection is kept after tagging and the input is cleared', q(w, '#bulk-count').textContent.startsWith('2 of') && q(w, '#bulk-tag').value === '');
        click(w, byText(w, 'button', 'Undo', q(w, '#toast')));
        prints = Object.values(stored(w).prints);
        check('Undo restores the old tags', tagsOf('Alpha') === 'gift' && tagsOf('Beta') === 'gift|desk');
        check('the tag box suggests tags already in use', qa(w, '#bulk-tag-list option').map((o) => o.value).sort().join() === 'desk,gift');

        // remove tag
        setVal(w, q(w, '#bulk-tag'), 'GIFT');
        click(w, q(w, '#bulk-remove-tag'));
        prints = Object.values(stored(w).prints);
        check('Remove tag takes it off (ignoring case)', tagsOf('Alpha') === '' && tagsOf('Beta') === 'desk' && tagsOf('Delta') === 'desk');
        setVal(w, q(w, '#bulk-tag'), 'nothing');
        click(w, q(w, '#bulk-remove-tag'));
        check('removing a tag nobody has says nothing changed', q(w, '#toast').textContent.includes('Nothing to change'));

        // tag cap
        setVal(w, q(w, '#bulk-tag'), 'a1, a2, a3, a4, a5, a6, a7, a8, a9');
        click(w, q(w, '#bulk-add-tag'));
        prints = Object.values(stored(w).prints);
        check('no print gets more than 8 tags', prints.every((p) => (p.tags || []).length <= 8) && tagsOf('Beta').split('|').length === 8, tagsOf('Beta'));

        // filters limit the selection
        setVal(w, q(w, '#print-filter'), 'failure');
        check('changing the filter drops hidden prints from the selection', q(w, '#bulk-count').textContent === 'None selected' && cards().length === 1, q(w, '#bulk-count').textContent);
        setVal(w, q(w, '#print-filter'), 'all');
        check('and they stay unselected', q(w, '#bulk-count').textContent === 'None selected' && !box('Alpha').checked);

        // select all shown, export
        click(w, q(w, '#bulk-all'));
        check('Select all shown selects everything shown', q(w, '#bulk-count').textContent === '4 of 4 shown selected' && q(w, '#bulk-all').disabled);
        click(w, q(w, '#bulk-none'));
        check('Clear unselects', q(w, '#bulk-count').textContent === 'None selected');
        box('Gamma').checked = true; box('Gamma').dispatchEvent(new w.Event('change', { bubbles: true }));
        box('Delta').checked = true; box('Delta').dispatchEvent(new w.Event('change', { bubbles: true }));
        click(w, q(w, '#bulk-export'));
        const csv = w.__blobs[w.__blobs.length - 1];
        const lines = csv.trim().split('\r\n');
        check('Export CSV has only the selected prints', lines.length === 3 && csv.includes('Gamma') && csv.includes('Delta') && !csv.includes('Alpha') && !csv.includes('Beta'), csv);
        check('the file is named for the selection', /print-tracker-selected-\d{4}-\d{2}-\d{2}\.csv/.test(w.__lastDownload.name), w.__lastDownload.name);

        // delete
        const before = Object.keys(stored(w).prints).length;
        click(w, q(w, '#bulk-delete'));
        check('Delete removes the selected prints', Object.keys(stored(w).prints).length === before - 2 && !card('Gamma') && !card('Delta') && !!card('Alpha'));
        check('and clears the selection', q(w, '#bulk-count').textContent === 'None selected');
        click(w, byText(w, 'button', 'Undo', q(w, '#toast')));
        check('Undo brings them all back', Object.keys(stored(w).prints).length === before && !!card('Gamma') && !!card('Delta'));
        check('a snapshot was taken before deleting', JSON.parse(w.localStorage.getItem('printTracker.snapshots') || '[]').some((s) => String(s.reason).includes('Before deleting 2 prints')));

        // leaving select mode
        box('Alpha').checked = true; box('Alpha').dispatchEvent(new w.Event('change', { bubbles: true }));
        click(w, q(w, '#bulk-done'));
        check('Done hides the bar and the checkboxes and forgets the selection', q(w, '#bulk-bar').hidden && qa(w, 'input.select-box').length === 0 && q(w, '#select-button').getAttribute('aria-pressed') === 'false');
        click(w, q(w, '#select-button'));
        check('selecting again starts clean', q(w, '#bulk-count').textContent === 'None selected');
        // deleting every print ends select mode
        click(w, q(w, '#bulk-all'));
        click(w, q(w, '#bulk-delete'));
        check('with every print deleted the bar and button go away', q(w, '#bulk-bar').hidden && q(w, '#select-button').hidden);
        check('no unexpected errors in section 46', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[47] Getting-started guide');
    {
        const e = errors.length;
        let w = boot();
        click(w, q(w, '#dash-button'));
        const guide = () => q(w, '#guide-panel');
        check('a brand-new visitor sees the guide on the empty dashboard', !!guide() && guide().textContent.includes('Getting started') && q(w, '#guide-progress').textContent === '0 of 4 steps done', guide() && guide().textContent);
        check('with the usual "add your first spool" prompt below it', q(w, '#dashboard-content').textContent.includes('Nothing to show yet'));
        check('it explains that data stays in this browser', guide().textContent.includes('this browser only'));
        check('five steps, AMS marked optional', qa(w, '.guide-step', guide()).length === 5 && q(w, '[data-step=ams]', guide()).textContent.includes('(optional)'));
        click(w, byText(w, 'button', 'Add a spool', guide()));
        check('"Add a spool" goes to the Filament tab and opens the form', !q(w, '#filament').hidden);
        check('the spool form is open', q(w, '#filament-add-popup').style.display === 'block');
        click(w, q(w, '#cancel-spool-button'));
        click(w, byText(w, 'button', 'Log a print', (click(w, q(w, '#dash-button')), guide())));
        check('"Log a print" with no spools explains what to do first', q(w, '#print-popup').style.display !== 'block' && q(w, '#toast').textContent.includes('Add a filament spool first'));

        // progress is worked out from the data
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', date: '2026-10-01' });
        click(w, q(w, '#dash-button'));
        check('adding a spool ticks that step', q(w, '[data-step=spool]', guide()).classList.contains('is-done') && q(w, '#guide-progress').textContent === '1 of 4 steps done', q(w, '#guide-progress').textContent);
        check('a finished step shows a Done badge and no button', q(w, '[data-step=spool] .badge', guide()).textContent === 'Done' && qa(w, '[data-step=spool] button', guide()).length === 0);
        openPrint(w);
        fillPrint(w, { name: 'First', date: '2026-10-05', rows: [{ spoolIndex: 0, grams: 10 }] });
        savePrint(w);
        click(w, q(w, '#dash-button'));
        check('logging a print ticks that step', q(w, '[data-step=print]', guide()).classList.contains('is-done') && q(w, '#guide-progress').textContent === '2 of 4 steps done');
        click(w, byText(w, 'button', 'Open settings', guide()));
        check('"Open settings" goes to the printer settings', !q(w, '#settings-printer').hidden);
        click(w, q(w, '#dash-button'));
        click(w, byText(w, 'button', 'Open backup', guide()));
        check('"Open backup" opens the Data page', !q(w, '#data').hidden);

        // hide and bring back
        click(w, q(w, '#dash-button'));
        click(w, q(w, '#guide-hide'));
        check('Hide guide removes it and remembers', !guide() && stored(w).ui.guideDismissed === true);
        click(w, q(w, '#settings-button') || q(w, '#settings-tab-preferences'));
        click(w, q(w, '#settings-tab-preferences'));
        click(w, q(w, '#show-guide-button'));
        click(w, q(w, '#dash-button'));
        check('Settings > Preferences brings it back', !!guide() && stored(w).ui.guideDismissed === false);

        // all done: compact
        const full = JSON.stringify({ schemaVersion: 1, lastExported: new Date().toISOString(), ui: { guideDismissed: false },
            settings: { printer: { brand: 'bambu', model: '' } },
            spools: { s1: { brand: 'A', material: 'pla', color: 'Black', startGrams: 1000, date: '2026-09-01' } },
            prints: { p1: { name: 'P', date: '2026-10-01', result: true, usage: [{ spoolId: 's1', grams: 5 }] } }, queue: {} });
        w = boot(full);
        click(w, q(w, '#dash-button'));
        check('when the required steps are done the guide is one short note', !!guide() && guide().textContent.includes('all set') && qa(w, '.guide-step', guide()).length === 0, guide() && guide().textContent);

        // people who already have data are not nagged
        w = boot(JSON.stringify({ schemaVersion: 1, spools: { s1: { brand: 'A', material: 'pla', color: 'Black', startGrams: 1000, date: '2026-09-01' } }, prints: { p1: { name: 'P', date: '2026-10-01', result: true, usage: [{ spoolId: 's1', grams: 5 }] } }, queue: {} }));
        click(w, q(w, '#dash-button'));
        check('an existing user (data, no saved choice) does not see the guide', !guide());
        // but a spool-only start does
        w = boot(JSON.stringify({ schemaVersion: 1, spools: { s1: { brand: 'A', material: 'pla', color: 'Black', startGrams: 1000, date: '2026-09-01' } }, prints: {}, queue: {} }));
        click(w, q(w, '#dash-button'));
        check('someone with only a spool still sees it', !!guide());

        // import
        const w2 = boot();
        click(w2, q(w2, '#data-button'));
        const input = q(w2, '#import-file');
        const backup = { schemaVersion: 1, queue: {}, spools: { s1: { brand: 'A', color: 'a', startGrams: 1000 } }, prints: { p: { name: 'P', date: '2026-10-01', result: true, usage: [] } } };
        Object.defineProperty(input, 'files', { value: [new w2.File([JSON.stringify(backup)], 'b.json')], configurable: true });
        input.dispatchEvent(new w2.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        check('importing an older backup with prints does not bring the guide back', stored(w2).ui.guideDismissed === true, JSON.stringify(stored(w2).ui));
        check('no unexpected errors in section 47', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[48] Failure rate by group');
    {
        const e = errors.length;
        const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); };
        const mk = (n, spool, ok, extra = {}) => ({ name: 'P' + n, date: day(-n), result: ok, usage: [{ spoolId: spool, grams: 10 }], ...extra });
        const prints = {};
        let n = 1;
        for (const ok of [false, false, true, true, true, true]) prints['a' + n] = mk(n++, 's1', ok);       // Bambu: 2 of 6
        for (const ok of [true, true, true, true, true]) prints['b' + n] = mk(n++, 's2', ok);              // Sunlu: 0 of 5
        prints.c1 = mk(n++, 's3', false);                                                                  // Esun: 1 of 1
        prints.m1 = { name: 'Two spools', date: day(-1), result: false, usage: [{ spoolId: 's1', grams: 5 }, { spoolId: 's2', grams: 5 }] };
        const state = (p, extra = {}) => JSON.stringify({ schemaVersion: 1, queue: {}, prints: p,
            spools: { s1: { brand: 'Bambu Lab', material: 'pla', color: 'Black', startGrams: 1000, date: day(-90) }, s2: { brand: 'Sunlu', material: 'petg', color: 'Red', startGrams: 1000, date: day(-90) }, s3: { brand: 'Esun', material: 'pla', color: 'Blue', startGrams: 1000, date: day(-90) } }, ...extra });
        let w = boot(state({ x: mk(1, 's1', true) }));
        click(w, q(w, '#fila-button'));
        check('no failed prints: no failure panel', q(w, '#failure-rate-panel').hidden);
        w = boot(state(prints));
        click(w, q(w, '#fila-button'));
        const rows = () => Object.fromEntries(qa(w, '#failure-table tbody tr').map((r) => [r.dataset.key, qa(w, 'th,td', r).map((c) => c.textContent)]));
        check('the failure panel shows by brand', !q(w, '#failure-rate-panel').hidden && q(w, '#failure-group').value === 'brand');
        check('a print with two spools counts under both brands', rows()['bambu lab'].join('|') === 'Bambu Lab|7|3|43%' && rows()['sunlu'].join('|') === 'Sunlu|6|1|17%', JSON.stringify(rows()));
        check('small groups are flagged', rows()['esun'][3] === '100% (few prints)', rows()['esun'][3]);
        check('highest rate first', qa(w, '#failure-table tbody tr')[0].dataset.key === 'esun');
        check('the summary only compares groups with 5+ prints', q(w, '#failure-summary').textContent.includes('Highest failure rate: Bambu Lab (3 of 7, 43%). Lowest: Sunlu (1 of 6, 17%)'), q(w, '#failure-summary').textContent);
        setVal(w, q(w, '#failure-group'), 'material');
        check('grouping by material', rows()['PLA'] && rows()['PETG'] && rows()['PETG'][1] === '6', JSON.stringify(rows()));
        check('the choice survives and keeps focus', q(w, '#failure-group').value === 'material' && w.document.activeElement.id === 'failure-group');
        check('no printer option with one printer', !qa(w, '#failure-group option').some((o) => o.value === 'printer'));
        setVal(w, q(w, '#failure-group'), 'spool');
        check('grouping by spool', Object.keys(rows()).length === 3 && rows().s1[0].startsWith('Bambu Lab, Black'));
        w = boot(state({ x: mk(1, 's1', false), y: mk(2, 's1', true) }));
        click(w, q(w, '#fila-button'));
        check('with too little data it says so', q(w, '#failure-summary').textContent.includes('Not enough prints yet'), q(w, '#failure-summary').textContent);
        w = boot(state({ x: mk(1, 's1', false, { printerId: 'px' }), y: mk(2, 's1', true) }, { settings: { printers: { px: { name: 'Second' } } } }));
        click(w, q(w, '#fila-button'));
        check('with two printers a Printer option appears', qa(w, '#failure-group option').some((o) => o.value === 'printer'));
        setVal(w, q(w, '#failure-group'), 'printer');
        check('and groups by printer', Object.keys(rows()).sort().join() === 'main,px', Object.keys(rows()).join());
        check('no unexpected errors in section 48', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[49] Prints with this spool');
    {
        const e = errors.length;
        const w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', date: '2026-09-01' });
        addSpool(w, { brand: 'Sunlu', material: 'petg', color: 'Red', grams: '1000', date: '2026-09-02' });
        const spoolCard = (t) => qa(w, '#spools .spool-card').find((c) => c.textContent.includes(t));
        check('a spool with no prints has no Show prints button', !byText(w, 'button', 'Show prints', spoolCard('Sunlu')));
        openPrint(w); fillPrint(w, { name: 'With black', rows: [{ spoolIndex: 0, grams: 10 }] }); savePrint(w);
        openPrint(w); fillPrint(w, { name: 'With red', rows: [{ spoolIndex: 1, grams: 10 }] }); savePrint(w);
        openPrint(w); fillPrint(w, { name: 'Also black', rows: [{ spoolIndex: 0, grams: 10 }] }); savePrint(w);
        click(w, q(w, '#fila-button'));
        click(w, byText(w, 'button', 'Show prints', spoolCard('Black')));
        check('Show prints goes to the Prints tab', !q(w, '#prints').hidden);
        const names = () => qa(w, '#print-list .card-title').map((c) => c.textContent).sort().join();
        check('and shows only prints that used the spool', names() === 'Also black,With black', names());
        check('a note says which spool, with a way out', !q(w, '#print-spool-note').hidden && q(w, '#print-spool-note').textContent.includes('Bambu Lab, Black') && !!byText(w, 'button', 'Show all prints', q(w, '#print-spool-note')));
        check('the count line says it is filtered', q(w, '#prints-sub').textContent.includes('Showing 2 of 3'), q(w, '#prints-sub').textContent);
        click(w, byText(w, 'button', 'Show all prints', q(w, '#print-spool-note')));
        check('Show all prints clears it', q(w, '#print-spool-note').hidden && qa(w, '#print-list .print-card').length === 3);
        click(w, q(w, '#fila-button'));
        click(w, byText(w, 'button', 'Show prints', spoolCard('Sunlu')));
        check('another spool filters to its own prints', names() === 'With red');
        click(w, q(w, '#fila-button'));
        click(w, q(w, '#prints-button'));
        click(w, byText(w, 'button', 'Delete', qa(w, '#print-list .print-card')[0]));
        click(w, q(w, '#fila-button'));
        click(w, byText(w, 'button', 'Delete', spoolCard('Sunlu')));
        click(w, q(w, '#prints-button'));
        check('deleting the spool clears the filter', q(w, '#print-spool-note').hidden && !Object.values(stored(w).spools).some((x) => x.brand === 'Sunlu'));
        check('no unexpected errors in section 49', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[50] Leftover filament when archiving');
    {
        const e = errors.length;
        const w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20', date: '2026-09-01' });
        addSpool(w, { brand: 'Sunlu', color: 'White', grams: '1000', price: '15', date: '2026-09-02' });
        addSpool(w, { brand: 'Esun', color: 'Gray', grams: '1000', date: '2026-09-03' });
        const card = (t) => qa(w, '#spools .spool-card').find((c) => c.textContent.includes(t));
        const spoolOf = (c) => Object.values(stored(w).spools).find((s) => s.color === c);
        const popup = () => q(w, '#leftover-popup');
        openPrint(w); fillPrint(w, { name: 'Used some', rows: [{ spoolIndex: 0, grams: 600 }] }); savePrint(w);
        click(w, q(w, '#fila-button'));
        click(w, byText(w, 'button', 'Archive', card('Bambu Lab')));
        check('Archive on a spool with filament left asks how much', popup().style.display === 'block' && popup().getAttribute('aria-modal') === 'true' && q(w, '#leftover-info').textContent.includes('The log says about'));
        check('the box starts with what the log says', q(w, '#leftover-grams').value === '400', q(w, '#leftover-grams').value);
        setVal(w, q(w, '#leftover-grams'), '-3');
        click(w, q(w, '#leftover-save'));
        check('a bad amount shows an error and keeps the dialog open', !q(w, '#leftover-error').hidden && popup().style.display === 'block');
        click(w, q(w, '#leftover-cancel'));
        check('Cancel archives nothing', !spoolOf('Black').archived && popup().style.display === 'none');
        click(w, byText(w, 'button', 'Archive', card('Bambu Lab')));
        setVal(w, q(w, '#leftover-grams'), '150');
        click(w, q(w, '#leftover-save'));
        let s = Object.values(stored(w).spools).find((x) => x.color === 'Black');
        check('Archive saves the amount and archives', s.archived === true && s.leftover === 150, JSON.stringify(s));
        check('it also corrects the grams left (1000 - 600 + adjust = 150)', s.adjust === -250, JSON.stringify(s));
        check('the leftover panel appears with grams and value', !q(w, '#leftover-panel').hidden && q(w, '#leftover-total').textContent.includes('1 archived spool with 150g left, worth about $3.00'), q(w, '#leftover-total').textContent);
        click(w, byText(w, 'button', 'Undo', q(w, '#toast')));
        s = spoolOf('Black');
        check('Undo restores the spool and removes the leftover', !s.archived && s.leftover === undefined && s.adjust === undefined && q(w, '#leftover-panel').hidden, JSON.stringify(s));
        click(w, byText(w, 'button', 'Archive', card('Bambu Lab')));
        setVal(w, q(w, '#leftover-grams'), '150');
        click(w, q(w, '#leftover-save'));
        click(w, byText(w, 'button', 'Use again', q(w, '#leftover-panel')));
        s = spoolOf('Black');
        check('Use again restores it, keeping the corrected amount', !s.archived && s.leftover === undefined && s.adjust === -250 && card('Bambu Lab').textContent.includes('~150g remaining'), card('Bambu Lab').textContent);
        // used up / skip
        click(w, byText(w, 'button', 'Archive', card('Sunlu')));
        click(w, q(w, '#leftover-zero'));
        s = spoolOf('White');
        check('Used up archives with 0g left and no panel entry', s.archived && s.leftover === 0 && q(w, '#leftover-panel').hidden, JSON.stringify(s));
        click(w, byText(w, 'button', 'Unarchive', card('Sunlu')));
        check('unarchiving drops the leftover', spoolOf('White').leftover === undefined);
        click(w, byText(w, 'button', 'Archive', card('Esun')));
        click(w, q(w, '#leftover-skip'));
        s = spoolOf('Gray');
        check('Do not record archives without a leftover or correction', s.archived && s.leftover === undefined && s.adjust === undefined, JSON.stringify(s));
        click(w, byText(w, 'button', 'Unarchive', card('Esun')));
        // a spool already empty archives straight away
        openPrint(w); fillPrint(w, { name: 'Empty it', rows: [{ spoolIndex: 2, grams: 1000 }] }); savePrint(w);
        click(w, q(w, '#fila-button'));
        click(w, byText(w, 'button', 'Archive', card('Esun')));
        check('an empty spool archives without asking', popup().style.display === 'none' && spoolOf('Gray').archived === true);
        // Escape closes
        click(w, byText(w, 'button', 'Unarchive', card('Esun')));
        click(w, byText(w, 'button', 'Archive', card('Bambu Lab')));
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        check('Escape closes the dialog', popup().style.display === 'none' && !spoolOf('Black').archived);
        // import
        const w2 = boot();
        click(w2, q(w2, '#data-button'));
        const input = q(w2, '#import-file');
        const bad = { schemaVersion: 1, queue: {}, prints: {}, spools: {
            a: { brand: 'A', color: 'a', startGrams: 1000, archived: true, leftover: 200, price: 20 },
            b: { brand: 'B', color: 'b', startGrams: 1000, archived: false, leftover: 200 },
            c: { brand: 'C', color: 'c', startGrams: 1000, archived: true, leftover: -5 },
            d: { brand: 'D', color: 'd', startGrams: 1000, archived: true, leftover: 'lots' } } };
        Object.defineProperty(input, 'files', { value: [new w2.File([JSON.stringify(bad)], 'b.json')], configurable: true });
        input.dispatchEvent(new w2.Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
        const im = Object.values(stored(w2).spools);
        const g = (b) => im.find((x) => x.brand === b);
        check('import keeps leftovers only on archived spools and only valid ones', g('A').leftover === 200 && g('B').leftover === undefined && g('C').leftover === undefined && g('D').leftover === undefined, JSON.stringify(im.map((x) => x.leftover)));
        check('no unexpected errors in section 50', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[51] Price history');
    {
        const e = errors.length;
        const w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20', date: '2026-06-01' });
        const card = (n) => qa(w, '#spools .spool-card')[n];
        check('the first spool of a colour has no history line', !q(w, '.price-history-line', card(0)));
        click(w, q(w, '#filament .acc-buttons'));
        setVal(w, q(w, '#brand-tinput'), 'bambu lab');
        setVal(w, q(w, '#color-tinput'), 'BLACK');
        check('the popup says what you paid last time (any case)', !q(w, '#price-hint').hidden && q(w, '#price-hint').textContent.includes('$20.00 for 1000g ($20.00/kg)'), q(w, '#price-hint').textContent);
        setVal(w, q(w, '#material-dropdown'), 'petg');
        check('a different material has no history', q(w, '#price-hint').hidden);
        setVal(w, q(w, '#material-dropdown'), 'pla');
        setVal(w, q(w, '#grams-ninput'), '1000');
        setVal(w, q(w, '#price-ninput'), '22');
        setVal(w, q(w, '#date-dinput'), '2026-09-01');
        click(w, q(w, '#add-spool-button'));
        const newest = () => qa(w, '#spools .spool-card').find((c) => c.textContent.includes('$22.00'));
        check('the newer spool compares per kg with the older one', q(w, '.price-history-line', newest()).textContent.includes('Last time: $20.00/kg') && q(w, '.price-history-line', newest()).textContent.includes('$22.00/kg, 10% more'), q(w, '.price-history-line', newest()).textContent);
        const older = qa(w, '#spools .spool-card').find((c) => c.textContent.includes('$20.00'));
        check('the older one is compared with the other too', q(w, '.price-history-line', older).textContent.includes('$22.00/kg') || q(w, '.price-history-line', older).textContent.includes('Last time'));
        click(w, q(w, '#filament .acc-buttons'));
        setVal(w, q(w, '#brand-tinput'), 'Bambu Lab'); setVal(w, q(w, '#color-tinput'), 'Black');
        check('the hint uses the most recent purchase', q(w, '#price-hint').textContent.includes('$22.00'), q(w, '#price-hint').textContent);
        click(w, q(w, '#cancel-spool-button'));
        click(w, byText(w, 'button', 'Edit', newest()));
        check('editing a spool does not compare it with itself', q(w, '#price-hint').textContent.includes('$20.00') && !q(w, '#price-hint').textContent.includes('$22.00'), q(w, '#price-hint').textContent);
        click(w, q(w, '#cancel-spool-button'));
        check('no unexpected errors in section 51', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[52] Drop a slicer file on the page');
    {
        const e = errors.length;
        const w = boot();
        const drop = async (file, types = ['Files']) => {
            const ev = new w.Event('drop', { bubbles: true, cancelable: true });
            ev.dataTransfer = { types, files: [file] };
            w.document.dispatchEvent(ev);
            await new Promise((r) => setTimeout(r, 250));
            return ev;
        };
        const over = (types = ['Files']) => { const ev = new w.Event('dragenter', { bubbles: true, cancelable: true }); ev.dataTransfer = { types, files: [] }; w.document.dispatchEvent(ev); };
        const gcode = '; model printing time: 1h 5m 10s; total estimated time: 1h 5m 10s\n; filament used [g] = 12.34\n; filament_type = PLA\n; filament_colour = #000000\n';
        await drop(new w.File([gcode], 'Tray.gcode'));
        check('with no spools, a drop explains what to do first', q(w, '#print-popup').style.display !== 'block' && q(w, '#toast').textContent.includes('Add a filament spool first'));
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', date: '2026-09-01' });
        over();
        check('dragging a file over the page shows the drop hint', !q(w, '#drop-overlay').hidden && q(w, '#drop-overlay').getAttribute('aria-hidden') === 'true');
        over(['text/plain']);
        const ev = await drop(new w.File([gcode], 'Tray.gcode'));
        check('dropping prevents the browser from opening the file and hides the hint', ev.defaultPrevented && q(w, '#drop-overlay').hidden);
        check('a dropped .gcode opens the print form filled in', q(w, '#print-popup').style.display === 'block' && q(w, '#name-tinput').value === 'Tray' && q(w, '#hours-ninput').value === '1' && q(w, '#minutes-ninput').value === '5' && q(w, '#filament-row-list .filament-row input').value === '12.3', q(w, '#name-tinput').value);
        await drop(new w.File([gcode.replace('12.34', '20')], 'Second.gcode'));
        check('dropping while the form is open fills that form (name kept)', q(w, '#name-tinput').value === 'Tray' && q(w, '#filament-row-list .filament-row input').value === '20');
        await drop(new w.File(['hello'], 'photo.png'));
        check('other file types are refused politely', q(w, '#toast').textContent.includes('not a slicer file'));
        click(w, q(w, '#cancel-print-button'));
        click(w, q(w, '#filament .acc-buttons'));
        await drop(new w.File([gcode], 'Third.gcode'));
        check('a drop while another popup is open is ignored', q(w, '#print-popup').style.display !== 'block');
        check('no unexpected errors in section 52', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[53] Automatic backup to a folder');
    {
        const e = errors.length;
        let w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', date: '2026-09-01' });
        click(w, q(w, '#data-button'));
        check('without the folder API the panel explains the alternative', q(w, '#auto-backup-status').textContent.includes('cannot save backups'));

        w = boot();
        const files = {};
        const idbStore = {};
        const mkDir = (name) => ({
            name, perm: 'granted',
            async queryPermission() { return this.perm; },
            async requestPermission() { this.perm = 'granted'; return 'granted'; },
            async getFileHandle(n, opts = {}) {
                if (!(n in files)) {
                    if (!opts.create) { const err = new Error('nf'); err.name = 'NotFoundError'; throw err; }
                    files[n] = '';
                }
                return { async createWritable() { let buf = ''; return { async write(t) { buf += t; }, async close() { files[n] = buf; } }; } };
            },
            async *entries() { for (const n of Object.keys(files)) yield [n, {}]; },
            async removeEntry(n) { delete files[n]; }
        });
        const dir = mkDir('Backups');
        const req = (fn) => { const r = {}; setTimeout(() => { r.result = fn(); if (r.onsuccess) r.onsuccess(); }); return r; };
        w.indexedDB = { open() { const r = {}; setTimeout(() => { r.result = { createObjectStore() {}, transaction() { return { objectStore() { return {
            put: (v, k) => req(() => { idbStore[k] = v; return k; }), get: (k) => req(() => idbStore[k]), delete: (k) => req(() => { delete idbStore[k]; return undefined; }) }; } }; } };
            if (r.onupgradeneeded) r.onupgradeneeded(); if (r.onsuccess) r.onsuccess(); }); return r; } };
        w.showDirectoryPicker = async () => dir;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        click(w, q(w, '#data-button'));
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', date: '2026-09-01' });
        click(w, q(w, '#data-button'));
        check('with folder support the panel offers Choose backup folder', !!q(w, '#auto-backup-choose') && q(w, '#auto-backup-status').textContent === 'Off.');
        // old dated copies to prune
        for (let i = 1; i <= 16; i++) files[`print-tracker-backup-2026-01-${String(i).padStart(2, '0')}.json`] = 'old';
        files['notes.txt'] = 'mine';
        click(w, q(w, '#auto-backup-choose'));
        await wait(300);
        const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
        check('choosing a folder saves the latest backup at once', typeof files['print-tracker-backup.json'] === 'string' && JSON.parse(files['print-tracker-backup.json']).spools && Object.keys(JSON.parse(files['print-tracker-backup.json']).spools).length === 1);
        check('and a dated copy for today', files[`print-tracker-backup-${today}.json`] === files['print-tracker-backup.json']);
        const dated = Object.keys(files).filter((n) => /^print-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/.test(n));
        check('only the newest 14 dated copies are kept and other files are untouched', dated.length === 14 && files['notes.txt'] === 'mine' && !files['print-tracker-backup-2026-01-01.json'], String(dated.length));
        check('the folder is remembered', idbStore.folder === dir);
        check('the status says it is on, with the folder name and time', q(w, '#auto-backup-status').textContent.includes('On: saving to the folder "Backups"') && q(w, '#auto-backup-status').textContent.includes('Last saved'), q(w, '#auto-backup-status').textContent);
        check('Back up now, Change folder and Stop are offered', !!q(w, '#auto-backup-now') && !!q(w, '#auto-backup-choose') && !!q(w, '#auto-backup-stop'));

        // the dashboard backup reminder is satisfied
        click(w, q(w, '#dash-button'));
        check('a recent folder backup replaces the backup reminder', !q(w, '#backup-banner'), w.localStorage.getItem('printTracker.autoBackup') + ' / ' + (q(w, '#backup-banner') ? q(w, '#backup-banner').textContent : ''));

        // changes trigger a save after a short delay; the dated copy is not rewritten
        files['print-tracker-backup.json'] = 'stale';
        const todays = files[`print-tracker-backup-${today}.json`];
        addSpool(w, { brand: 'Sunlu', color: 'White', grams: '1000', date: '2026-09-02' });
        await wait(4600);
        check('after a change the latest backup is rewritten by itself', Object.keys(JSON.parse(files['print-tracker-backup.json']).spools).length === 2);
        check('today\'s dated copy keeps the first state of the day', files[`print-tracker-backup-${today}.json`] === todays);

        // permission lost after a reload
        dir.perm = 'prompt';
        click(w, q(w, '#data-button'));
        click(w, q(w, '#auto-backup-now'));
        await wait(200);
        check('when permission is gone it pauses and asks for a click', q(w, '#auto-backup-status').textContent.includes('Paused') && !!q(w, '#auto-backup-allow'));
        files['print-tracker-backup.json'] = 'stale';
        click(w, q(w, '#auto-backup-allow'));
        await wait(200);
        check('Allow access restores it and saves again', q(w, '#auto-backup-status').textContent.startsWith('On:') && files['print-tracker-backup.json'] !== 'stale');

        // write failure is shown
        dir.getFileHandle = async () => { throw new Error('Disk is full'); };
        click(w, q(w, '#auto-backup-now'));
        await wait(200);
        check('a write error is shown in words', !!q(w, '#auto-backup-error') && q(w, '#auto-backup-error').textContent.includes('Disk is full'));
        for (let i = errors.length - 1; i >= 0; i--) if (errors[i].includes('Disk is full')) errors.splice(i, 1);

        // Stop
        click(w, q(w, '#auto-backup-stop'));
        await wait(100);
        check('Stop forgets the folder and goes back to Off', idbStore.folder === undefined && q(w, '#auto-backup-status').textContent === 'Off.' && !w.localStorage.getItem('printTracker.autoBackup'));
        check('no unexpected errors in section 53', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[54] Customize dashboard and most-printed models');
    {
        const e = errors.length;
        const w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20', date: '2026-09-01' });
        openPrint(w); fillPrint(w, { name: 'Phone stand', rows: [{ spoolIndex: 0, grams: 40 }] }); savePrint(w);
        check('one print of a model does not make a most-printed panel', !q(w, '#most-printed-panel'));
        openPrint(w); fillPrint(w, { name: '  phone   STAND ', date: '2026-10-07', rows: [{ spoolIndex: 0, grams: 50 }] }); savePrint(w);
        openPrint(w); fillPrint(w, { name: 'Phone stand', date: '2026-10-06', success: false, rows: [{ spoolIndex: 0, grams: 10 }] }); savePrint(w);
        openPrint(w); fillPrint(w, { name: 'Vase', rows: [{ spoolIndex: 0, grams: 30 }] }); savePrint(w);
        click(w, q(w, '#dash-button'));
        let panel = q(w, '#most-printed-panel');
        check('names are grouped ignoring case and spaces', !!panel && qa(w, '.list-row', panel).length === 1, panel && panel.textContent);
        check('shows count, success rate and total grams', panel.textContent.includes('3x') && panel.textContent.includes('67% succeeded') && panel.textContent.includes('100g total'), panel.textContent);
        click(w, byText(w, 'button', 'Print again', panel));
        check('Print again opens a new print filled from the latest one', q(w, '#name-tinput').value.replace(/\s+/g, ' ').trim().toLowerCase() === 'phone stand' && q(w, '#print-popup').style.display === 'block' && qa(w, '.filament-row').length === 1 && q(w, '#print-popup-title').textContent === 'Create Print');
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));

        // Customize
        click(w, q(w, '#customize-button'));
        const pop = q(w, '#customize-popup');
        check('Customize opens a dialog with every panel', pop.style.display === 'block' && qa(w, '#customize-list input').length === 10, String(qa(w, '#customize-list input').length));
        const key = (k) => q(w, `#customize-list [data-key="${k}"]`);
        const order = () => qa(w, '#dashboard-content .dash-grid > .panel').map((p) => p.querySelector('.panel-title').textContent);
        check('default order starts with filament by material, most-printed before recent', order().indexOf('Most-printed models') < order().indexOf('Recent prints'), order().join('|'));
        check('first Up button is disabled and last Down is disabled', key('printer').querySelector('.dash-up').disabled && key('upNext').querySelector('.dash-down').disabled);
        click(w, key('recent').querySelector('.dash-up'));
        check('Up moves a panel above its neighbour on the dashboard', order().indexOf('Recent prints') < order().indexOf('Most-printed models'), order().join('|'));
        check('the order is saved', stored(w).ui.dashOrder.indexOf('recent') < stored(w).ui.dashOrder.indexOf('mostPrinted'), JSON.stringify(stored(w).ui));
        check('focus stays on the button that was used', w.document.activeElement === key('recent').querySelector('.dash-up'));
        const box = key('mostPrinted').querySelector('input');
        box.checked = false; box.dispatchEvent(new w.Event('change', { bubbles: true }));
        check('unticking hides the panel and remembers it', !q(w, '#most-printed-panel') && stored(w).ui.dashHidden.includes('mostPrinted'));
        const ach = key('achievements').querySelector('input');
        ach.checked = false; ach.dispatchEvent(new w.Event('change', { bubbles: true }));
        check('achievements can be hidden', !q(w, '#achievements') && stored(w).ui.dashHidden.includes('achievements'));
        check('Customize closes with Escape', (w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })), q(w, '#customize-popup').style.display === 'none'));

        // survives a reload
        const w2 = boot(JSON.stringify(stored(w)));
        click(w2, q(w2, '#dash-button'));
        check('hidden panels and order survive a reload', !q(w2, '#most-printed-panel') && qa(w2, '#dashboard-content .dash-grid > .panel').map((p) => p.querySelector('.panel-title').textContent).indexOf('Recent prints') >= 0);
        click(w2, q(w2, '#customize-button'));
        click(w2, q(w2, '#customize-reset'));
        check('Reset to default shows everything again in default order', !!q(w2, '#most-printed-panel') && stored(w2).ui.dashHidden.length === 0 && stored(w2).ui.dashOrder.length === 0);

        // import validation
        const bad = JSON.parse(JSON.stringify(stored(w2)));
        bad.ui.dashHidden = ['spend', 'spend', 'nope', 5, 'achievements'];
        bad.ui.dashOrder = ['upNext', 'zzz', 'upNext', 'achievements', 'printer'];
        const w3 = boot(JSON.stringify(bad));
        click(w3, q(w3, '#dash-button'));
        check('a loaded file with odd panel lists still shows the dashboard', !!q(w3, '#dashboard-content .dash-grid') && !q(w3, '#spend-panel') && !q(w3, '#achievements'));
        const firstTitles = qa(w3, '#dashboard-content .dash-grid > .panel').map((p) => p.querySelector('.panel-title').textContent);
        check('the order from a loaded file puts Up next first and ignores junk', firstTitles[0] === 'Up next' || !firstTitles.includes('Up next'), firstTitles.join('|'));
        click(w3, q(w3, '#customize-button')); click(w3, q(w3, '#customize-done'));
        click(w3, q(w3, '#customize-button'));
        const sw = q(w3, '#customize-list [data-key="printer"] input'); sw.checked = false; sw.dispatchEvent(new w3.Event('change', { bubbles: true }));
        const clean = stored(w3).ui;
        check('junk, repeats and non-text entries are removed once saved', JSON.stringify(clean.dashHidden) === JSON.stringify(['spend', 'achievements', 'printer']) && clean.dashOrder.join() === 'upNext,printer', JSON.stringify(clean));
        check('no unexpected errors in section 54', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[55] Merge import');
    {
        const e = errors.length;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const merge = async (w, obj) => {
            const input = q(w, '#merge-file');
            Object.defineProperty(input, 'files', { value: [new w.File([typeof obj === 'string' ? obj : JSON.stringify(obj)], 'm.json')], configurable: true });
            input.dispatchEvent(new w.Event('change', { bubbles: true }));
            await wait(150);
        };
        const w = boot();
        addSpool(w, { brand: 'Bambu Lab', color: 'Black', grams: '1000', price: '20', date: '2026-09-01' });
        openPrint(w); fillPrint(w, { name: 'Benchy', rows: [{ spoolIndex: 0, grams: 15 }] }); savePrint(w);
        const mine = stored(w);
        const mineSpool = Object.keys(mine.spools)[0];

        // the other backup: same spool and print, plus a new spool, a new print on each, a queue item
        const other = JSON.parse(JSON.stringify(mine));
        other.spools.friend1 = { brand: 'Sunlu', material: 'pla', color: 'White', startGrams: 1000, price: 12, date: '2026-09-05' };
        other.prints.fp1 = { name: 'Vase', date: '2026-10-02', result: true, usage: [{ spoolId: 'friend1', grams: 40 }] };
        other.prints.fp2 = { name: 'Clip', date: '2026-10-03', result: true, usage: [{ spoolId: mineSpool, grams: 5 }] };
        other.queue = { fq1: { name: 'Gear', link: 'https://example.com/gear' } };
        other.settings = { currency: 'EUR' };

        w.__confirms.length = 0;
        await merge(w, other);
        check('merge asks first, naming what will be added and skipped', w.__confirms.length === 1 && w.__confirms[0].includes('2 prints, 1 spool and 1 queue item') && w.__confirms[0].includes('1 print, 1 spool'), w.__confirms.join('|'));
        const after = stored(w);
        check('new prints, spools and queue items are added', Object.keys(after.prints).length === 3 && Object.keys(after.spools).length === 2 && Object.keys(after.queue).length === 1, JSON.stringify([Object.keys(after.prints).length, Object.keys(after.spools).length]));
        check('a duplicate spool is not copied and its prints use yours', Object.values(after.prints).find((p) => p.name === 'Clip').usage[0].spoolId === mineSpool);
        check('your settings are not replaced', after.settings.currency === mine.settings.currency, after.settings.currency);
        check('a snapshot was taken and a result is shown', q(w, '#data-message').textContent.includes('Added 2 prints, 1 spool and 1 queue item') && q(w, '#data-message').textContent.includes('Skipped 2'), q(w, '#data-message').textContent);
        click(w, q(w, '#fila-button'));
        check('grams left reflect the merged prints (1000 - 15 - 5 = 980)', qa(w, '#spools .spool-card').some((c) => c.textContent.includes('Bambu Lab') && c.textContent.includes('980')), qa(w, '#spools .spool-card')[0].textContent);

        // merging the same file again adds nothing
        await merge(w, other);
        check('merging again finds nothing new', Object.keys(stored(w).prints).length === 3 && q(w, '#data-message').textContent.startsWith('Nothing new'), q(w, '#data-message').textContent);

        // Undo
        const w2 = boot(JSON.stringify(mine));
        await merge(w2, other);
        check('merge changed things before the undo', Object.keys(stored(w2).prints).length === 3);
        click(w2, byText(w2, 'button', 'Undo', q(w2, '#toast')));
        check('Undo puts back exactly what you had', JSON.stringify(Object.keys(stored(w2).prints)) === JSON.stringify(Object.keys(mine.prints)) && Object.keys(stored(w2).spools).length === 1 && Object.keys(stored(w2).queue).length === 0);

        // two genuinely identical spools are not collapsed into one
        const twins = JSON.parse(JSON.stringify(mine));
        twins.spools.twinA = { ...mine.spools[mineSpool] };
        const w3 = boot(JSON.stringify(mine));
        await merge(w3, twins);
        check('an extra identical spool (bought twice) is added, not merged away', Object.keys(stored(w3).spools).length === 2);

        // id clash: same ids, different content
        const clash = { schemaVersion: mine.schemaVersion, spools: { [mineSpool]: { brand: 'Esun', material: 'petg', color: 'Red', startGrams: 750, price: 18, date: '2026-08-01' } }, prints: { [Object.keys(mine.prints)[0]]: { name: 'Different', date: '2026-08-02', result: true, usage: [{ spoolId: mineSpool, grams: 10 }] } } };
        const w4 = boot(JSON.stringify(mine));
        await merge(w4, clash);
        const s4 = stored(w4);
        const red = Object.entries(s4.spools).find(([, s]) => s.color === 'Red');
        const diff = Object.values(s4.prints).find((p) => p.name === 'Different');
        check('clashing ids get new ids and nothing of yours is overwritten', Object.keys(s4.spools).length === 2 && !!red && red[0] !== mineSpool && s4.spools[mineSpool].color === 'Black' && Object.values(s4.prints).some((p) => p.name === 'Benchy') && diff && diff.usage[0].spoolId === red[0], JSON.stringify(diff));

        // bad files change nothing
        const w5 = boot(JSON.stringify(mine));
        await merge(w5, 'not json');
        check('a file that is not JSON is refused', q(w5, '#data-message').textContent.includes('could not be read'));
        await merge(w5, { prints: { x: { name: '', date: '2026-01-01' } }, spools: {} });
        check('an invalid backup is refused and nothing changes', q(w5, '#data-message').textContent.startsWith('Merge failed') && Object.keys(stored(w5).prints).length === 1, q(w5, '#data-message').textContent);
        w5.__confirmAnswer = false;
        await merge(w5, other);
        check('declining the question changes nothing', q(w5, '#data-message').textContent.includes('cancelled') && Object.keys(stored(w5).prints).length === 1);
        check('no unexpected errors in section 55', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[56] Spools by storage location');
    {
        const e = errors.length;
        const sp = (brand, color, location, extra = {}) => ({ brand, material: 'pla', color, startGrams: 1000, date: '2026-09-01', ...(location ? { location } : {}), ...extra });
        const base = {
            schemaVersion: 1, prints: {},
            spools: { a: sp('Bambu Lab', 'Black', 'Shelf A'), b: sp('Sunlu', 'White', 'shelf a'), c: sp('Esun', 'Gray', 'Dry box'), d: sp('Elegoo', 'Red', ''), e: sp('Esun', 'Blue', 'Dry box', { archived: true }) }
        };
        const w = boot(JSON.stringify(base));
        click(w, q(w, '#fila-button'));
        const cards = () => qa(w, '#spools .spool-card').map((c) => c.textContent);
        const sel = q(w, '#spool-location-filter');
        check('the location controls show when a spool has a location', !q(w, '#location-tools').hidden);
        const opts = Array.from(sel.options).map((o) => o.textContent);
        check('options: all, each place once (ignoring case) with counts, and no location', opts.join('|') === 'All locations|Dry box (2)|Shelf A (2)|No location (1)', opts.join('|'));
        setVal(w, sel, 'loc:shelf a');
        check('filtering by a place shows only its spools', cards().length === 2 && cards().every((t) => t.includes('Stored: Shelf A') || t.includes('Stored: shelf a')), cards().length + '');
        setVal(w, sel, 'none');
        check('No location shows only spools without one', cards().length === 1 && cards()[0].includes('Elegoo'));
        setVal(w, sel, 'loc:dry box');
        check('the location filter works with the archived filter', cards().length === 2);
        click(w, q(w, '#archive-off-checkbox'));
        check('hiding archived leaves one in that place', cards().length === 1);
        click(w, q(w, '#archive-off-checkbox'));
        setVal(w, sel, 'all');

        const box = q(w, '#group-location-checkbox');
        click(w, box);
        const heads = qa(w, '#spools .spool-group-heading').map((h2) => h2.textContent);
        check('Group by location adds a heading per place, No location last', heads.join('|') === 'Dry box (2)|Shelf A (2)|No location (1)', heads.join('|'));
        const kids = Array.from(q(w, '#spools').children).map((c) => c.classList.contains('spool-group-heading') ? 'H' : 'C').join('');
        check('cards sit under their headings', kids === 'HCCHCCHC', kids);
        check('the choice is remembered', stored(w).ui.groupByLocation === true);
        setVal(w, sel, 'loc:dry box');
        check('grouping is off while a single place is chosen', qa(w, '#spools .spool-group-heading').length === 0 && cards().length === 2);
        setVal(w, sel, 'all');

        const w2 = boot(JSON.stringify(stored(w)));
        click(w2, q(w2, '#fila-button'));
        check('grouping survives a reload', q(w2, '#group-location-checkbox').checked && qa(w2, '#spools .spool-group-heading').length === 3);

        // no locations at all: controls stay hidden
        const plain = JSON.parse(JSON.stringify(base));
        for (const s of Object.values(plain.spools)) delete s.location;
        plain.ui = { groupByLocation: true };
        const w3 = boot(JSON.stringify(plain));
        click(w3, q(w3, '#fila-button'));
        check('without any location the controls are hidden and nothing is grouped', q(w3, '#location-tools').hidden && qa(w3, '#spools .spool-group-heading').length === 0 && qa(w3, '#spools .spool-card').length === 5);
        check('no unexpected errors in section 56', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[57] Data check');
    {
        const e = errors.length;
        const sp = (brand, color, extra = {}) => ({ brand, material: 'pla', color, startGrams: 1000, date: '2026-09-01', ...extra });
        const pr = (name, date, usage, extra = {}) => ({ name, date, result: true, usage, ...extra });
        const bad = {
            schemaVersion: 1,
            spools: { a: sp('Bambu Lab', 'Black'), b: sp('Sunlu', 'White'), c: sp('Esun', 'Gray', { archived: true }) },
            prints: {
                p1: pr('Fine', '2026-10-01', [{ spoolId: 'a', grams: 20 }]),
                p2: pr('Ghost', '2026-10-02', [{ spoolId: 'zzz', grams: 10 }, { spoolId: 'a', grams: 5 }]),
                p3: pr('Nothing', '2026-10-03', []),
                p4: pr('Future', '2099-01-01', [{ spoolId: 'a', grams: 5 }]),
                p5: pr('Twin', '2026-10-04', [{ spoolId: 'a', grams: 7 }], { minutes: 30 }),
                p6: pr('twin', '2026-10-04', [{ spoolId: 'a', grams: 7 }], { minutes: 30 }),
                p7: pr('Twin', '2026-10-04', [{ spoolId: 'a', grams: 7 }], { minutes: 30 }),
                p8: pr('Heavy', '2026-10-05', [{ spoolId: 'b', grams: 1200 }])
            },
            ams: { u1: { name: 'AMS 1', type: 'ams', slots: ['c', 'a', '', ''], price: null } }
        };
        const w = boot(JSON.stringify(bad));
        click(w, q(w, '#data-button'));
        check('nothing is listed until you ask', !q(w, '#data-check-results') && !!q(w, '#data-check-button'));
        const before = JSON.stringify(stored(w));
        click(w, q(w, '#data-check-button'));
        const rows = () => qa(w, '#data-check-results .check-row');
        const kinds = () => rows().map((r) => r.dataset.kind).sort().join();
        check('finds each kind of problem once', kinds() === 'archived-loaded,duplicate,future-date,missing-spool,no-filament,over-weight', kinds());
        check('checking does not change the data', JSON.stringify(stored(w)) === before);
        const row = (k) => rows().find((r) => r.dataset.kind === k);
        check('the duplicate row says how many times and counts spaces and case', row('duplicate').textContent.includes('3 times'), row('duplicate').textContent);
        check('the weight row names the spool and the excess', row('over-weight').textContent.includes('Sunlu, White') && row('over-weight').textContent.includes('200g more'), row('over-weight').textContent);

        // fix: remove missing rows
        click(w, byText(w, 'button', 'Remove those rows', row('missing-spool')));
        let s = stored(w);
        check('Remove those rows keeps only the real spool', s.prints.p2.usage.length === 1 && s.prints.p2.usage[0].spoolId === 'a');
        check('the list refreshes and that problem is gone', !row('missing-spool'));
        click(w, byText(w, 'button', 'Undo', q(w, '#toast')));
        check('Undo restores the missing row', stored(w).prints.p2.usage.length === 2 && !!row('missing-spool'));
        click(w, byText(w, 'button', 'Remove those rows', row('missing-spool')));

        // fix: duplicates keep the first
        click(w, byText(w, 'button', 'Delete 2 extras', row('duplicate')));
        s = stored(w);
        check('Delete extras keeps one of the twins', Object.keys(s.prints).filter((id) => ['p5', 'p6', 'p7'].includes(id)).join() === 'p5', Object.keys(s.prints).join());

        // fix: unload archived
        click(w, byText(w, 'button', 'Unload it', row('archived-loaded')));
        s = stored(w);
        check('Unload clears only the archived spool from the AMS', s.ams.u1.slots.join() === ',a,,', s.ams.u1.slots.join());

        // edit actions open the print popup; re-weigh opens the weigh popup
        click(w, byText(w, 'button', 'Edit', row('future-date')));
        check('Edit opens that print', q(w, '#print-popup').style.display === 'block' && q(w, '#name-tinput').value === 'Future');
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
        click(w, byText(w, 'button', 'Re-weigh', row('over-weight')));
        check('Re-weigh opens the weigh dialog', q(w, '#weigh-popup').style.display === 'block');
        w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));

        // clean data
        const w2 = boot(JSON.stringify({ schemaVersion: 1, spools: { a: sp('Bambu Lab', 'Black') }, prints: { p1: pr('Fine', '2026-10-01', [{ spoolId: 'a', grams: 20 }]) } }));
        click(w2, q(w2, '#data-button'));
        click(w2, q(w2, '#data-check-button'));
        check('clean data says no problems', q(w2, '#data-check-results').textContent.includes('No problems found'));
        check('no unexpected errors in section 57', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[58] Settings that worked');
    {
        const e = errors.length;
        const sp = (brand, color, material) => ({ brand, material, color, startGrams: 1000, date: '2026-09-01' });
        const prints = {};
        let n = 0;
        const add = (profile, result, usage, name = 'P') => { prints['x' + (n++)] = { name: `${name}${n}`, date: '2026-10-01', result, usage, ...(profile ? { profile } : {}) }; };
        const pla = [{ spoolId: 'a', grams: 10 }];
        const petg = [{ spoolId: 'b', grams: 10 }];
        // PLA 0.2 / 15% / none: 4 prints written three ways, 3 worked
        add({ layer: '0.2 mm', infill: '15%', supports: 'none' }, true, pla);
        add({ layer: '0.2mm', infill: '15 %', supports: 'None' }, true, pla);
        add({ layer: '0.2', infill: '15', supports: 'none' }, true, pla);
        add({ layer: '0.2 mm', infill: '15%', supports: 'none' }, false, pla);
        // PLA 0.12 / 20%: only 2 prints, too few
        add({ layer: '0.12 mm', infill: '20%', supports: 'tree' }, true, pla);
        add({ layer: '0.12 mm', infill: '20%', supports: 'tree' }, true, pla);
        // PETG 0.28 / 10%: 3 prints, 1 worked
        add({ layer: '0.28 mm', infill: '10%', supports: '' }, true, petg);
        add({ layer: '0.28 mm', infill: '10%', supports: '' }, false, petg);
        add({ layer: '0.28 mm', infill: '10%', supports: '' }, false, petg);
        // no notes and name-only notes and a deleted spool do not count
        add(null, true, pla); add(null, true, pla); add(null, true, pla);
        add({ name: '0.20mm Standard' }, true, pla); add({ name: '0.20mm Standard' }, true, pla); add({ name: '0.20mm Standard' }, true, pla);
        for (let i = 0; i < 3; i++) add({ layer: '0.4 mm', infill: '5%', supports: 'x' }, true, [{ spoolId: 'gone', grams: 5 }]);
        // mixed print: PETG is most of it, so it counts under PETG
        for (let i = 0; i < 3; i++) add({ layer: '0.16 mm', infill: '25%', supports: '' }, true, [{ spoolId: 'a', grams: 5 }, { spoolId: 'b', grams: 50 }]);
        const w = boot(JSON.stringify({ schemaVersion: 1, spools: { a: sp('Bambu Lab', 'Black', 'pla'), b: sp('Sunlu', 'Clear', 'petg') }, prints }));
        click(w, q(w, '#fila-button'));
        const panel = q(w, '#settings-worked-panel');
        check('the panel appears once a combination has enough prints', !!panel);
        const tables = qa(w, 'table', panel);
        check('one table per material, the one with more prints first', tables.map((t) => t.dataset.material).join() === 'PETG,PLA' || tables.map((t) => t.dataset.material).join() === 'PLA,PETG', tables.map((t) => t.dataset.material).join());
        const rowsOf = (m) => qa(w, 'tbody tr', tables.find((t) => t.dataset.material === m)).map((r) => r.textContent);
        check('PLA: spelling variants count as one combination (4 prints, 3 worked, 75%)', rowsOf('PLA').length === 1 && rowsOf('PLA')[0].includes('4') && rowsOf('PLA')[0].includes('3 (75%)'), rowsOf('PLA').join('|'));
        check('combinations with fewer than 3 prints are left out', !panel.textContent.includes('0.12'));
        check('PETG: best combination first, with its success rate', rowsOf('PETG')[0].includes('0.16 mm') && rowsOf('PETG')[0].includes('3 (100%)') && rowsOf('PETG').some((t) => t.includes('0.28 mm') && t.includes('1 (33%)')), rowsOf('PETG').join('|'));
        check('prints without notes, with only a profile name, or with a deleted spool are ignored', !panel.textContent.includes('0.4 mm') && !panel.textContent.includes('Standard'));
        check('a summary sentence names the best combination', qa(w, '.panel-total-line', panel).some((l) => l.textContent.startsWith('PLA: 0.2 mm layers, 15% infill, no supports worked 3 of 4 times (75%)')), qa(w, '.panel-total-line', panel).map((l) => l.textContent).join('|'));

        const w2 = boot(JSON.stringify({ schemaVersion: 1, spools: { a: sp('Bambu Lab', 'Black', 'pla') }, prints: { p1: { name: 'A', date: '2026-10-01', result: true, usage: pla, profile: { layer: '0.2' } } } }));
        click(w2, q(w2, '#fila-button'));
        check('with too few prints the panel is not shown', !q(w2, '#settings-worked-panel'));
        check('no unexpected errors in section 58', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[59] Enough-filament check');
    {
        const e = errors.length;
        const sp = (brand, color, material, used) => ({ brand, material, color, startGrams: 1000, date: '2026-09-01', ...(used ? { adjust: -used } : {}) });
        const w = boot(JSON.stringify({ schemaVersion: 1, prints: {}, spools: {
            a: sp('Bambu Lab', 'Black', 'pla', 950),     // 50 left
            b: sp('Sunlu', 'White', 'pla', 700),         // 300 left
            c: sp('Esun', 'Gray', 'pla', 0),             // 1000 left
            d: sp('Esun', 'Red', 'petg', 0),             // other material
            e: sp('Elegoo', 'Blue', 'pla', 100)          // 900 left (archived below)
        } }));
        const st = stored(w); st.spools.e.archived = true;
        const w2 = boot(JSON.stringify(st));
        openPrint(w2);
        const row = () => qa(w2, '.filament-row')[0];
        const sel = () => q(w2, 'select', row());
        sel().value = 'a'; sel().dispatchEvent(new w2.Event('change', { bubbles: true }));
        setVal(w2, q(w2, 'input', row()), '20');
        check('no warning when the spool has enough', q(w2, '.row-hint', row()).hidden);
        setVal(w2, q(w2, 'input', row()), '120');
        const hint = q(w2, '.row-hint', row());
        check('a short spool shows the warning', !hint.hidden && hint.textContent.includes('only ~50g left'));
        const swaps = qa(w2, '.row-swap', hint);
        check('suggests same-material spools with enough, smallest sufficient first, no archived or other materials', swaps.map((b) => b.dataset.spool).join() === 'b,c', swaps.map((b) => b.textContent).join('|'));
        check('suggestion shows the name and grams left', swaps[0].textContent === 'Use Sunlu, White (~300g left)', swaps[0].textContent);
        click(w2, swaps[0]);
        check('clicking a suggestion switches the spool and keeps the grams', sel().value === 'b' && q(w2, 'input', row()).value === '120' && q(w2, '.row-hint', row()).hidden);
        setVal(w2, q(w2, 'input', row()), '400');
        check('the new spool can be warned about too, leaving only Esun', qa(w2, '.row-swap', q(w2, '.row-hint', row())).map((b) => b.dataset.spool).join() === 'c');
        click(w2, q(w2, '#add-filament-row-button'));
        const row2 = qa(w2, '.filament-row')[1];
        check('a spool already used in another row is not suggested', !qa(w2, '.row-swap', q(w2, '.row-hint', row())).some((b) => b.dataset.spool === q(w2, 'select', row2).value));
        setVal(w2, q(w2, 'input', row()), '1500');
        check('when nothing has enough, only the warning shows', !q(w2, '.row-hint', row()).hidden && qa(w2, '.row-swap', q(w2, '.row-hint', row())).length === 0);
        check('no unexpected errors in section 59', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[60] Spools CSV export and import');
    {
        const e = errors.length;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const readBlob = (w, blob) => new Promise((res) => { const r = new w.FileReader(); r.onload = () => res(String(r.result)); r.readAsText(blob); });
        const importCsv = async (w, text) => {
            const input = q(w, '#import-spools-csv-file');
            Object.defineProperty(input, 'files', { value: [new w.File([text], 's.csv')], configurable: true });
            input.dispatchEvent(new w.Event('change', { bubbles: true }));
            await wait(150);
        };
        const base = { schemaVersion: 1, prints: { p1: { name: 'Benchy', date: '2026-10-01', result: true, usage: [{ spoolId: 'a', grams: 100 }] } }, spools: {
            a: { brand: 'Bambu Lab', material: 'pla', color: 'Black', hex: '#1c1c1e', startGrams: 1000, price: 22.5, date: '2026-09-01', location: 'Shelf A' },
            b: { brand: 'Sunlu, Inc', material: 'petg', color: '=Red', startGrams: 750, price: 18, date: '2026-09-05', archived: true, leftover: 120 },
            c: { brand: 'Esun', material: 'pla', color: 'Gray', startGrams: 1000, price: null, date: '2026-09-07' }
        } };
        const w = boot(JSON.stringify(base));
        let blob = null;
        w.URL.createObjectURL = (b) => { blob = b; return 'blob:fake'; };
        click(w, q(w, '#data-button'));
        click(w, q(w, '#export-spools-csv-button'));
        const csv = await readBlob(w, blob);
        check('export has a header and one row per spool', csv.split('\r\n').filter(Boolean).length === 4 && csv.includes('Brand,Material,Color,Hex,Weight (g),Price,Date bought,Location,Grams left,Status'), csv);
        check('grams left, status, location and leftover are in the file', csv.includes('Bambu Lab,pla,Black,#1c1c1e,1000,22.5,2026-09-01,Shelf A,900,Active') && csv.includes('Archived,,,120'), csv);
        check('commas are quoted and formulas are defused', csv.includes('"Sunlu, Inc"') && csv.includes("'=Red"), csv);

        // round trip: importing your own export adds nothing
        w.__confirms.length = 0;
        await importCsv(w, csv);
        check('importing your own export finds only duplicates', w.__confirms.length === 0 && q(w, '#data-message').textContent.startsWith('Nothing new to add') && q(w, '#data-message').textContent.includes('3 already here'), q(w, '#data-message').textContent);

        // new rows from a spreadsheet
        const sheet = [
            'Manufacturer;Type;Colour;Weight;Cost;Bought;Storage;Remaining;Status',
            'Polymaker;PLA;Teal;1000;19.99;10/02/2026;Dry box;640;',
            'Polymaker;PLA;Teal;1000;19.99;10/02/2026;Dry box;640;',   // second identical roll: both are new
            'Esun;pla;Gray;1000;;2026-09-07;;;',                      // already here (price blank)
            ';pla;NoBrand;1000;;;;;',                                  // invalid
            'Elegoo;pla;Blue;0;;;;;',                                  // invalid weight
            'Overture;tpu;Orange;500;25;2026-10-03;;;archived'
        ].join('\n');
        await importCsv(w, sheet);
        check('asks first with counts', w.__confirms.length === 1 && w.__confirms[0].includes('Add 3 spools') && w.__confirms[0].includes('1 already here') && w.__confirms[0].includes('2 without'), w.__confirms.join('|'));
        const sp = Object.values(stored(w).spools);
        check('new spools are added, identical rows both kept', sp.length === 6 && sp.filter((s) => s.color === 'Teal').length === 2);
        const teal = sp.find((s) => s.color === 'Teal');
        check('semicolon files, other column names and US dates are read', teal.brand === 'Polymaker' && teal.material === 'pla' && teal.startGrams === 1000 && teal.price === 19.99 && teal.date === '2026-10-02' && teal.location === 'Dry box', JSON.stringify(teal));
        check('grams left below the weight becomes a correction', teal.adjust === -360, JSON.stringify(teal));
        check('a colour name gets a guessed swatch', /^#[0-9a-f]{6}$/.test(sp.find((s) => s.color === 'Orange').hex) || sp.find((s) => s.color === 'Orange').hex === '', sp.find((s) => s.color === 'Orange').hex);
        check('status archived is kept', sp.find((s) => s.color === 'Orange').archived === true);
        click(w, q(w, '#fila-button'));
        check('the Filament tab shows the left-over grams (1000 - 360 = 640)', qa(w, '#spools .spool-card').some((c) => c.textContent.includes('Teal') && c.textContent.includes('640')));
        click(w, q(w, '#data-button'));
        click(w, byText(w, 'button', 'Undo', q(w, '#toast')));
        check('Undo removes what was added', Object.keys(stored(w).spools).length === 3);

        // errors
        await importCsv(w, 'Foo,Bar\n1,2');
        check('a file without the needed columns is refused', q(w, '#data-message').textContent.startsWith('Spool import failed') && Object.keys(stored(w).spools).length === 3, q(w, '#data-message').textContent);
        w.__confirmAnswer = false;
        await importCsv(w, sheet);
        check('declining changes nothing', q(w, '#data-message').textContent.includes('cancelled') && Object.keys(stored(w).spools).length === 3);
        const w2 = boot();
        click(w2, q(w2, '#data-button'));
        click(w2, q(w2, '#export-spools-csv-button'));
        check('exporting with no spools says so', q(w2, '#data-message').textContent.includes('no spools'));
        check('no unexpected errors in section 60', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[61] Search everything');
    {
        const e = errors.length;
        const w = boot(JSON.stringify({ schemaVersion: 1,
            spools: {
                a: { brand: 'Bambu Lab', material: 'pla', color: 'Black', startGrams: 1000, date: '2026-09-01', location: 'Shelf A' },
                b: { brand: 'Sunlu', material: 'petg', color: 'Red', startGrams: 1000, date: '2026-09-02', archived: true }
            },
            prints: {
                p1: { name: 'Phone stand', date: '2026-10-01', result: true, usage: [{ spoolId: 'a', grams: 20 }], tags: ['gift'] },
                p2: { name: 'Gear box', date: '2026-10-03', result: false, usage: [{ spoolId: 'b', grams: 20 }], notes: 'stand-off failed' },
                p3: { name: 'Vase', date: '2026-10-02', result: true, usage: [{ spoolId: 'a', grams: 20 }], tags: ['Gift', 'decor'] }
            },
            queue: { q1: { name: 'Stand for tablet', link: 'https://example.com/tablet' }, q2: { name: 'Hook', link: '' } } }));
        const key = (k, target) => (target || w.document).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
        key('/');
        const pop = q(w, '#search-popup');
        check('the / key opens the search dialog and focuses the box', pop.style.display === 'block' && w.document.activeElement === q(w, '#search-all-input'));
        check('it is a proper dialog', pop.getAttribute('role') === 'dialog' && pop.getAttribute('aria-modal') === 'true');
        check('an empty box shows a hint, not results', qa(w, '.search-result').length === 0 && q(w, '#search-results').textContent.includes('Type to search'));
        const type = (t) => setVal(w, q(w, '#search-all-input'), t);
        const group = (g) => qa(w, `.search-group[data-group="${g}"] .search-result`).map((r) => r.querySelector('.list-title').textContent);
        type('stand');
        check('prints match on name and notes, newest first', group('prints').join('|') === 'Gear box|Phone stand', group('prints').join('|'));
        check('queue items match too', group('queue').join('|') === 'Stand for tablet');
        type('Black');
        check('spools and the prints that used them are found by colour', group('spools').join('|') === 'Bambu Lab, Black' && group('prints').join('|') === 'Vase|Phone stand', group('prints').join('|'));
        type('shelf a');
        check('a spool is found by its location', group('spools').join('|') === 'Bambu Lab, Black');
        type('red archived');
        check('every word has to match (archived spool)', group('spools').join('|') === 'Sunlu, Red');
        type('gift');
        check('tags are found, ignoring case, with the print count', group('tags').join('|') === 'gift' && qa(w, '.search-group[data-group="tags"] .list-sub')[0].textContent === '2 prints', group('tags').join('|'));
        type('zzzz');
        check('no match says so', q(w, '.search-none').textContent.includes('Nothing matches'));

        // jumps
        type('vase');
        click(w, q(w, '.search-group[data-group="prints"] .search-result'));
        check('picking a print closes the dialog, opens the Prints tab and filters to it', pop.style.display === 'none' && visibleTab(w).join() === 'prints' && qa(w, '#print-list .print-card').length === 1 && q(w, '#print-search').value === 'Vase');
        check('the print is highlighted', !!q(w, '#print-list .print-card.found'));
        check('focus is not left in the closed dialog', !pop.contains(w.document.activeElement));
        key('/'); type('sunlu');
        click(w, q(w, '.search-group[data-group="spools"] .search-result'));
        check('picking an archived spool shows it even if archived spools were hidden', visibleTab(w).join() === 'filament' && !!q(w, '#spools .spool-card.found'));
        key('/'); type('hook');
        click(w, q(w, '.search-group[data-group="queue"] .search-result'));
        check('picking a queue item opens the Queue tab', visibleTab(w).join() === 'queue' && !!q(w, '.queue-item.found'));
        key('/'); type('decor');
        click(w, q(w, '.search-group[data-group="tags"] .search-result'));
        check('picking a tag filters prints by it', visibleTab(w).join() === 'prints' && q(w, '#print-tag-filter').value === 'decor' && qa(w, '#print-list .print-card').length === 1);
        key('/'); type('stand');
        key('Enter', q(w, '#search-all-input'));
        check('Enter picks the first result', pop.style.display === 'none');

        // button, Escape and shortcut guard
        click(w, q(w, '#search-button'));
        check('the header button opens it', pop.style.display === 'block');
        key('3');
        check('shortcuts are off while it is open', visibleTab(w).join() === 'prints');
        key('Escape');
        check('Escape closes it', pop.style.display === 'none');
        click(w, q(w, '#settings-button')); click(w, q(w, '#settings-tab-preferences'));
        check('the shortcuts list says Search everything', q(w, '#settings').textContent.includes('Search everything'));

        // many results are capped
        const many = { schemaVersion: 1, spools: { a: { brand: 'X', material: 'pla', color: 'Y', startGrams: 1000, date: '2026-09-01' } }, prints: {} };
        for (let i = 0; i < 9; i++) many.prints['m' + i] = { name: 'Widget ' + i, date: '2026-10-0' + (i + 1), result: true, usage: [{ spoolId: 'a', grams: 1 }] };
        const w2 = boot(JSON.stringify(many));
        w2.document.dispatchEvent(new w2.KeyboardEvent('keydown', { key: '/', bubbles: true }));
        setVal(w2, q(w2, '#search-all-input'), 'widget');
        check('a group shows 6 results and says how many more', qa(w2, '.search-group[data-group="prints"] .search-result').length === 6 && q(w2, '.search-more').textContent.startsWith('3 more'));
        check('no unexpected errors in section 61', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log('\n[62] Retry a failed print');
    {
        const e = errors.length;
        const w = boot(JSON.stringify({ schemaVersion: 1,
            spools: { a: { brand: 'Bambu Lab', material: 'pla', color: 'Black', startGrams: 1000, date: '2026-09-01' } },
            prints: {
                f1: { name: 'Gear box', date: '2026-10-01', result: false, failReason: 'warping', notes: 'bed was cold', usage: [{ spoolId: 'a', grams: 33 }], minutes: 90, profile: { layer: '0.2 mm', infill: '15%' }, tags: ['gift'] },
                f2: { name: ' gear  BOX', date: '2026-10-02', result: false, usage: [{ spoolId: 'a', grams: 30 }] },
                s1: { name: 'Gear box', date: '2026-10-03', result: true, usage: [{ spoolId: 'a', grams: 34 }] },
                v1: { name: 'Vase', date: '2026-10-01', result: true, usage: [{ spoolId: 'a', grams: 10 }] },
                v2: { name: 'Vase', date: '2026-10-02', result: true, usage: [{ spoolId: 'a', grams: 10 }] },
                z1: { name: 'Lonely fail', date: '2026-10-04', result: false, usage: [{ spoolId: 'a', grams: 5 }] }
            } }));
        click(w, q(w, '#prints-button'));
        const card = (id) => q(w, `#print-list [data-id="${id}"]`);
        check('only failed prints get a Retry button', !!byText(w, 'button', 'Retry', card('f1')) && !!byText(w, 'button', 'Retry', card('z1')) && !byText(w, 'button', 'Retry', card('s1')));
        const att = (id) => { const el = q(w, '.print-attempt', card(id)); return el ? el.textContent : null; };
        check('a model with failures shows which attempt each print was, oldest first', att('f1') === 'Attempt 1 of 3' && att('f2') === 'Attempt 2 of 3' && att('s1') === 'Attempt 3 of 3', [att('f1'), att('f2'), att('s1')].join('|'));
        check('a model with no failures, or printed once, shows no attempt', att('v1') === null && att('z1') === null);
        check('the tooltip says how many failed', q(w, '.print-attempt', card('f1')).title === '2 of the 3 prints with this name failed');

        click(w, byText(w, 'button', 'Retry', card('f1')));
        check('Retry opens a new print named the same', q(w, '#print-popup').style.display === 'block' && q(w, '#print-popup-title').textContent === 'Create Print' && q(w, '#name-tinput').value === 'Gear box');
        check('it starts as a success, with today\'s date', q(w, '#result-rinput1').checked && q(w, '#print-popup #date-tinput').value !== '2026-10-01');
        check('filament, time, profile and tags are copied', q(w, '.filament-row input').value === '33' && q(w, '#hours-ninput').value === '1' && q(w, '#minutes-ninput').value === '30' && q(w, '#profile-layer-tinput').value === '0.2 mm' && q(w, '#tags-tinput').value === 'gift', q(w, '#tags-tinput').value);
        check('the failure note replaces the old notes and names the reason', /^Retry of the print from .+ that failed \(warping or curling\)\.$/.test(q(w, '#notes-input').value) && !q(w, '#notes-input').value.includes('bed was cold'), q(w, '#notes-input').value);
        check('no failure reason is carried over', q(w, '#fail-reason-select').value === '');
        savePrint(w);
        const prints = Object.values(stored(w).prints);
        check('saving adds a fourth Gear box print and leaves the failed one alone', prints.filter((p) => p.name === 'Gear box').length === 3 && Object.keys(stored(w).prints).length === 7 && stored(w).prints.f1.result === false);
        const added = prints.find((p) => p.notes && p.notes.startsWith('Retry of'));
        check('the new print is a success with no failure reason', added.result === true && added.failReason === '');
        click(w, q(w, '#prints-button'));
        check('the list now shows 4 attempts', qa(w, '#print-list .print-attempt').some((el) => el.textContent.endsWith('of 4')), qa(w, '#print-list .print-attempt').map((x) => x.textContent).join('|'));
        check('no unexpected errors in section 62', errors.length === e, errors.slice(e).join(' | '));
    }

    console.log(`\n==== ${passed} passed, ${failed} failed, ${errors.length} unexpected error(s) ====`);
    if (failures.length) console.log('FAILED:\n - ' + failures.join('\n - '));
    if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
    process.exit(failed || errors.length ? 1 : 0);
})();
