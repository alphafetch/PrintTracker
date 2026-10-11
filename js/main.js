import { Sections } from './constants.js';
import { setupPopups } from './popups.js';
import { printPopup } from './printPopup.js';
import './merge.js';
import './compare.js';
import './spoolsCsv.js';
import './slicerFill.js';
import { initAutoBackup } from './autoBackup.js';
import { setupBulk } from './bulk.js';
import { setupBulkSpools } from './bulkSpools.js';
import { setupSearch } from './search.js';
import { setupViews } from './views.js';
import { setupPrintsToolbar } from './prints.js';
import { renderAll } from './render.js';
import { dailySnapshot } from './snapshots.js';
import { buildSettings } from './settings.js';
import { buildUpkeepTab } from './upkeep.js';
import { spoolPopup } from './spoolPopup.js';
import { setupSpoolToolbar } from './spools.js';
import { buildHeader, showTab } from './tabs.js';
import { applyTheme } from './theme.js';

// ---------- Start ----------

// Popups live at the top level of the page so they still show when opened from another tab
// (for example "Log print" on the Queue tab).
document.body.appendChild(printPopup);
document.body.appendChild(spoolPopup);

setupPopups();
document.getElementById('skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('app').focus();
});
buildHeader();
setupPrintsToolbar();
setupBulk();
setupBulkSpools();
setupSearch();
setupViews();
initAutoBackup();
setupSpoolToolbar();
buildSettings();
buildUpkeepTab();
dailySnapshot();
applyTheme();
renderAll();
{
    const fromAddress = (typeof location !== 'undefined' ? location.hash : '').replace('#', '');
    showTab(Object.values(Sections).includes(fromAddress) ? fromAddress : Sections.DASH, { updateAddress: false });
}
