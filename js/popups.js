import { Sections, TABS } from './constants.js';
import { closeLabelPopup, labelPopupEl, labelPopupOpen } from './labels.js';
import { closePrintPopup, openPrintPopup, printPopup } from './printPopup.js';
import { openSettings } from './settings.js';
import { closeSpoolPopup, openSpoolPopup, spoolPopup } from './spoolPopup.js';
import { state } from './state.js';
import { closeSummaryPopup, summaryPopupEl, summaryPopupOpen } from './summary.js';
import { showTab, toggleTheme } from './tabs.js';
import { closeSearchPopup, openSearchPopup, searchPopupEl, searchPopupOpen } from './search.js';
import { closeCustomizePopup, customizePopupEl, customizePopupOpen } from './customize.js';
import { closeLeftoverPopup, leftoverPopupEl, leftoverPopupOpen } from './leftover.js';
import { closeStartPopup, startPopupEl, startPopupOpen } from './running.js';
import { closeWeighPopup, weighPopupEl, weighPopupOpen } from './weigh.js';

// ---------- Popups: Escape, backdrop click and Tab focus loop ----------

export function trapFocus(popup, e) {
    const focusable = Array.from(popup.querySelectorAll('input, select, textarea, button, a[href]'))
        .filter((el) => !el.disabled && !el.hidden && el.type !== 'hidden' && el.offsetParent !== null && el.type !== 'radio');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

/** Wire up Escape, backdrop clicks, Tab looping and shortcuts. Called once at startup. */
export function setupPopups() {
    printPopup.addEventListener('click', (e) => { if (e.target === printPopup) closePrintPopup(); });
    spoolPopup.addEventListener('click', (e) => { if (e.target === spoolPopup) closeSpoolPopup(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closePrintPopup();
            closeSpoolPopup();
            closeLabelPopup();
            closeSummaryPopup();
            closeWeighPopup();
            closeStartPopup();
            closeLeftoverPopup();
            closeCustomizePopup();
            closeSearchPopup();
        } else if (e.key === 'Tab') {
            if (printPopup.style.display === 'block') trapFocus(printPopup, e);
            else if (spoolPopup.style.display === 'block') trapFocus(spoolPopup, e);
            else if (labelPopupOpen()) trapFocus(labelPopupEl(), e);
            else if (summaryPopupOpen()) trapFocus(summaryPopupEl(), e);
            else if (weighPopupOpen()) trapFocus(weighPopupEl(), e);
            else if (startPopupOpen()) trapFocus(startPopupEl(), e);
            else if (leftoverPopupOpen()) trapFocus(leftoverPopupEl(), e);
            else if (customizePopupOpen()) trapFocus(customizePopupEl(), e);
            else if (searchPopupOpen()) trapFocus(searchPopupEl(), e);
        } else {
            handleShortcut(e);
        }
    });
}

export const SHORTCUTS = [
    ['1 - 7', 'Switch tabs'],
    ['N', 'New print'],
    ['S', 'Add a spool'],
    ['/', 'Search everything'],
    ['T', 'Toggle theme'],
    ['?', 'Open these shortcuts']
];

export function handleShortcut(e) {
    if (!state.settings.shortcuts || e.ctrlKey || e.metaKey || e.altKey) return;
    if (printPopup.style.display === 'block' || spoolPopup.style.display === 'block' || labelPopupOpen() || summaryPopupOpen() || weighPopupOpen() || startPopupOpen() || leftoverPopupOpen() || customizePopupOpen() || searchPopupOpen()) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;

    const key = e.key.toLowerCase();
    const tabIndex = '1234567'.indexOf(key);
    if (key.length === 1 && tabIndex !== -1) {
        showTab(TABS[tabIndex].section);
    } else if (key === 'n') {
        e.preventDefault();
        showTab(Sections.PRINTS);
        openPrintPopup();
    } else if (key === 's') {
        e.preventDefault();
        showTab(Sections.FILA);
        openSpoolPopup();
    } else if (key === '/') {
        e.preventDefault();
        openSearchPopup();
    } else if (key === 't') {
        toggleTheme();
    } else if (key === '?') {
        openSettings('preferences');
    }
}
