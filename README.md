# Print Tracker

A personal 3D print and filament tracker for Bambu Lab, FlashForge and ELEGOO printers. Plain HTML, CSS and JavaScript (ES modules), no build step, no dependencies. Data lives in your browser's localStorage and can be exported/imported as JSON.

> **Vibe-coded disclaimer:** this whole project was written by an AI (Claude) from plain-English requests, with me steering and testing it. It is a hobby tool, not professionally engineered software. Costs, power figures and upkeep intervals are estimates, and the code may have bugs. Export a backup regularly, and double-check any numbers.

## Features

- **Dashboard:** totals, success rate, print time, filament used and left, money spent, cost of prints (including electricity), low-filament alert, charts, recent prints, queue, printer card and achievements. A backup reminder appears when your last backup is old; the X hides it for one reminder period (your "Backup reminder" setting).
- **Prints / Filament / Queue:** log prints with one or more filament usages, track spools (remaining grams are always calculated; spools can be edited, archived or bought again), keep a to-print list.
- **AMS:** add Bambu AMS units (AMS, AMS lite, AMS 2 Pro, AMS HT), name them, load spools into slots, and add them to the setup cost. The print popup offers the loaded spools as one-click chips.
- **Failure tracking:** mark a print as a failure and pick why (spaghetti, warping, clog, layer shift, adhesion, stringing, other). The dashboard shows "Why prints fail" with counts and filament wasted.
- **Slicer profile notes:** per print, record the profile name, layer height, infill and supports. "Print again" copies them.
- **Drying log:** "Dried today" button and a last-dried date per spool. A spool open for 30+ days (setting; 0 turns it off) gets a "Needs drying?" badge and a dashboard panel.
- **Reorder alerts:** when a spool is low and you have no other healthy spool of that material, the "Running low" panel says to reorder and offers Buy again.
- **Machine wear:** an optional cost per print hour (nozzles, plates, AMS parts) is added to each print's cost, next to filament and electricity.
- **Spending:** monthly filament-spend chart plus the running total for the whole setup (printer, AMS and filament).
- **Date ranges:** the dashboard can show all time, this month, last 30 or 90 days, or this year. It affects print counts, cost and spending; stock levels, upkeep and achievements always use everything.
- **Upkeep tab:** print hours, wear parts (nozzle, build plate and others, counted in print hours since the last swap, with optional lifespan and price, and a button to turn their cost into your wear rate), a **filament drying** section (status per spool, Dried today, pick a date, reminder threshold, Bambu's oven settings per material) and the upkeep reminders.
- **Cost analysis:** on the Filament tab, grouped by brand and material, material, brand or spool: money spent, price per kg, grams used and failed, and the "true cost per kg" once failed prints are counted.
- **Spool labels:** print a sheet of labels (colour swatch, brand, material, weight, date, price) in two sizes. No QR code, because the app is local-only.
- **Material guide:** typical nozzle and bed temperatures and drying settings for PLA, PETG, ABS, ASA and TPU, from Bambu Lab's wiki.
- **Undo and snapshots:** deleting a spool, archiving, clearing the queue, deleting all data and resetting settings can all be undone from the toast. The last 5 versions of your data are also kept in this browser (daily, and before an import or delete-all) and can be restored from the Data tab. They are not a real backup.
- **Accessibility:** skip link, keyboard navigation for tabs and popups, focus returns after popups close, visible focus, and text contrast of at least 4.5:1 in both themes and every accent.
- **Achievements:** 43 of them in seven groups, with progress bars and silly names.
- **Data:** export/import JSON (validated, confirms before replacing), export prints as CSV, **import prints from a CSV** (adds only; skips duplicates; reads this app's own CSV plus common column names), delete all data.
- **Settings:**
  - *Printer:* brand and model (Bambu Lab, FlashForge, ELEGOO, other), nickname, nozzle, arrival date. Average power, electricity price, price paid and AMS prices are filled in automatically when a source exists, each with a pencil button to override it. Also machine wear and the total cost of the setup.
  - *Upkeep reminders:* counted in print hours, days, prints or spools (1 spool = 1 kg printed). Quick-start sets for Bambu A1, P1/P2/X1, H2, FlashForge Adventurer 5M and ELEGOO; you can save your own tasks as a preset.
  - *Appearance:* theme, accent, backgrounds (blueprint is the default), intensity, animation, card spacing.
  - *Preferences:* currency, date format, thresholds, defaults, shortcuts.

## Where the automatic numbers come from

- **Power:** Bambu Lab wiki "Power consumption" (average watts in its PLA test). FlashForge and ELEGOO publish no average, so those stay blank.
- **Price:** typical US store prices (USD only, about 9 Oct 2026, bambuhub.net price tracker) for some Bambu models; AMS 2 Pro and AMS HT from Bambu's US store. Sales and combos differ, so edit it to what you paid.
- **Electricity:** US average residential 18.2 cents/kWh in 2026 (EIA STEO, Oct 2026); UK 26.32 p/kWh price-cap average, before VAT (Ofgem, Oct-Dec 2026). Other currencies: enter your own.
- **Material guide:** Bambu Lab wiki, [filament guide material table](https://wiki.bambulab.com/en/general/filament-guide-material-table) and [drying on the heatbed](https://wiki.bambulab.com/en/general/bambu-filament-drying-cover). These are Bambu's numbers for Bambu filament; other brands differ.
- **Upkeep:** intervals marked "From docs" come from the Bambu Lab wiki or FlashForge's own cleaning guide (months are 30 days). "Suggested" items have no published interval (ELEGOO's docs give none) and are starting points.

## Keyboard shortcuts

`1`-`7` switch tabs, `N` new print, `S` add a spool, `/` search prints, `T` toggle theme, `?` shortcut list. Turn off in Settings.

## Running it locally

Open it through a local server (ES modules do not work from `file://`):

```
python -m http.server 8000
```

Then visit http://localhost:8000.

Or, use the GitHub pages link on the right sidebar.

## Project structure

```
index.html
css/styles.css
js/main.js        start-up
js/ams.js         AMS units and slots
js/achievements.js  achievements
js/constants.js   fixed lists, icons
js/catalog.js     printers, power/price numbers, upkeep sets
js/util.js        small helpers
js/state.js       saved data, cleaning and migration
js/calc.js        stats and costs
js/theme.js  js/tabs.js  js/render.js
js/dashboard.js  js/widgets.js
js/prints.js  js/printPopup.js  js/spools.js  js/spoolPopup.js  js/queue.js
js/data.js  js/csv.js   export, import, CSV
js/settings.js  js/settingsKit.js  js/settingsPrinter.js  js/settingsAppearance.js  js/settingsPrefs.js
js/upkeep.js      Upkeep tab: hours, wear parts, drying, reminders
js/analysis.js  js/labels.js  js/materials.js
js/snapshots.js  js/snapshotPanel.js
js/popups.js
```
