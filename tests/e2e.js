// Real-browser test: opens the app in Chromium and clicks through the main flows.
// Run with `npm run test:e2e`. The first time, install the browser once with `npx playwright install chromium`.
// (`npm test` is the fast jsdom suite; this one checks what jsdom can't: real layout, real file inputs and dialogs.)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

/** A tiny static server for the project folder (ES modules don't load from file://). */
function serve() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
        if (!file.startsWith(ROOT) || file.includes(`${path.sep}node_modules${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404); res.end('Not found'); return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let passed = 0, failed = 0;
function check(name, ok, detail) {
    if (ok) passed++;
    else { failed++; console.log(`  FAIL: ${name}${detail ? ' (' + detail + ')' : ''}`); }
}

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

async function run() {
    const server = await serve();
    const base = `http://127.0.0.1:${server.address().port}/`;
    let browser;
    try {
        // E2E_CHROMIUM lets you point at an already-installed Chrome or Chromium instead of Playwright's own.
        browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
    } catch (error) {
        server.close();
        console.error('Could not start Chromium. Install it once with:  npx playwright install chromium\n');
        console.error(String(error.message).split('\n')[0]);
        process.exit(2);
    }

    const problems = [];
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push('page error: ' + e.message));
    page.on('console', (m) => {
        // the blocked font requests below also log an error; they are not the app's fault
        if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url)) problems.push('console error: ' + m.text());
    });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());   // no network needed
    page.on('dialog', (d) => d.accept());   // the app confirms merges and imports with window.confirm

    const tab = async (id) => { await page.click(`#${id}-button`); };
    const toast = () => page.locator('#toast').textContent();

    console.log('[1] Fresh start');
    await page.goto(base);
    check('the dashboard is the first thing shown', await page.locator('#dashboard').isVisible());
    check('there are no saved prints or spools yet', await page.evaluate(() => localStorage.getItem('printTracker') === null));

    console.log('[2] Add a spool');
    await tab('fila');
    await page.click('#filament .acc-buttons');
    await page.fill('#brand-tinput', 'Bambu Lab');
    await page.selectOption('#material-dropdown', 'pla');
    await page.fill('#color-tinput', 'Black');
    await page.fill('#grams-ninput', '1000');
    await page.fill('#price-ninput', '20');
    await page.fill('#date-dinput', day(-10));
    await page.click('#add-spool-button');
    const card = page.locator('#spools .spool-card').first();
    check('the spool shows as a card', (await card.textContent()).includes('Bambu Lab, Black'));
    check('with its full weight left', /1,?000g remaining/.test(await card.textContent()), await card.textContent());

    console.log('[3] Log a print');
    await tab('prints');
    await page.click('#prints .acc-buttons');
    await page.fill('#name-tinput', 'Benchy');
    await page.fill('#date-tinput', day(-1));
    await page.check('#result-rinput1');
    await page.locator('.filament-row input').first().fill('250');
    await page.click('#add-print-button');
    const printCard = page.locator('#print-list .print-card').first();
    check('the print shows as a card', (await printCard.textContent()).includes('Benchy'));
    await tab('fila');
    check('and its filament came off the spool (1000g - 250g)', /750g remaining/.test(await page.locator('#spools .spool-card').first().textContent()));

    console.log('[4] Search everything');
    await page.click('#search-button');
    await page.fill('#search-all-input', 'benchy');
    check('the search finds the print', (await page.locator('#search-results').textContent()).includes('Benchy'));
    await page.keyboard.press('Escape');
    check('Escape closes the search', !(await page.locator('#search-popup').isVisible()));
    await page.keyboard.press('/');
    check('the / key opens it again', await page.locator('#search-popup').isVisible());
    await page.keyboard.press('Escape');

    console.log('[5] Saved filters');
    await tab('prints');
    await page.fill('#print-search', 'benchy');
    await page.click('#view-save-open');
    await page.fill('#view-name', 'Just benchies');
    await page.click('#view-save');
    await page.fill('#print-search', '');
    await page.selectOption('#view-select', { label: 'Just benchies' });
    check('choosing a saved filter fills the search box again', (await page.inputValue('#print-search')) === 'benchy');

    console.log('[6] Select several spools');
    await tab('fila');
    await page.click('#spool-select-button');
    await page.locator('#spools input.select-box').first().check();
    await page.fill('#spool-bulk-place', 'Dry box 1');
    await page.click('#spool-bulk-move');
    check('moving the selected spool sets its storage place', (await page.locator('#spools .spool-card').first().textContent()).includes('Stored: Dry box 1'));
    await page.click('#spool-bulk-done');

    console.log('[7] Import spools from a CSV');
    await tab('data');
    const csv = ['Brand,Material,Color,Weight (g),Price,Date bought', `Sunlu,petg,White,1000,18,${day(-3)}`, `Esun,abs,Gray,750,15,${day(-2)}`].join('\n');
    await page.setInputFiles('#import-spools-csv-file', { name: 'spools.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForFunction(() => document.getElementById('data-message').textContent.includes('Added 2 spools'));
    check('both rows were added', (await page.locator('#data-message').textContent()).includes('Added 2 spools'));

    console.log('[8] Merge a backup');
    const backup = {
        schemaVersion: 1,
        spools: { m1: { brand: 'Overture', material: 'tpu', color: 'Red', startGrams: 500, price: 25, date: day(-5) } },
        prints: { p9: { name: 'Merged Vase', date: day(-4), result: true, usage: [{ spoolId: 'm1', grams: 40 }], minutes: 90 } }
    };
    await page.setInputFiles('#merge-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => /^Added /.test(document.getElementById('data-message').textContent));
    await tab('prints');
    await page.fill('#print-search', '');
    check('the merged print is there next to the old one', (await page.locator('#print-list').textContent()).includes('Merged Vase') && (await page.locator('#print-list').textContent()).includes('Benchy'));
    await tab('data');
    await page.setInputFiles('#merge-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => document.getElementById('data-message').textContent.includes('Nothing new'));
    check('merging the same backup again adds nothing', (await page.locator('#data-message').textContent()).includes('Nothing new'));

    console.log('[9] Undo last change');
    await tab('data');
    await page.click('#undo-last');
    await tab('prints');
    await page.fill('#print-search', '');
    check('Undo last change takes the merged print back out', !(await page.locator('#print-list').textContent()).includes('Merged Vase'));

    console.log('[10] Everything survives a reload');
    await page.reload();
    await tab('fila');
    const text = await page.locator('#spools').textContent();
    check('spools are still there', text.includes('Bambu Lab, Black') && text.includes('Sunlu, White') && text.includes('Esun, Gray'));

    console.log('[11] Phone-sized screen');
    await page.setViewportSize({ width: 375, height: 800 });
    for (const id of ['dash', 'prints', 'fila', 'queue', 'upkeep', 'data']) {
        await tab(id);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`no sideways scrolling on the ${id} tab`, overflow <= 0, `${overflow}px too wide`);
    }

    check('no errors in the browser console', problems.length === 0, problems.join(' | '));
    await browser.close();
    server.close();
    console.log(`\n==== e2e: ${passed} passed, ${failed} failed ====`);
    process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => { console.error(error); process.exit(1); });
