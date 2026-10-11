# Print Tracker

A personal 3D print and filament tracker for Bambu Lab, FlashForge and ELEGOO printers. Plain HTML, CSS and JavaScript (ES modules), no build step, no dependencies to run it (the test suite has its own dev dependencies, see Tests). Data lives in your browser's localStorage and can be exported/imported as JSON.

> **Disclaimer:** this whole project was written by an AI (Claude) from plain-English requests, with me steering and testing it. It is a hobby tool, not professionally engineered software. Costs, power figures and upkeep intervals are estimates, and the code may have bugs. Export a backup regularly.

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
- **Add to queue:** every print card has an "Add to queue" button. The queued item remembers the filament, print time, profile and notes, and "Log print" fills them in again.
- **Tags:** give a print one or more tags (up to 8, 24 characters each) such as "desk organizer" or "gift". The popup offers your existing tags as one-click chips, cards show them, clicking one filters the list, and a Prints-tab table totals prints, time, filament and cost per tag. Tags are in the CSV export/import and in "Print again" and the queue.
- **Run-out forecast:** each spool shows when it should run out at your pace over the last 60 days (at least a week of data is assumed, so a brand-new spool does not give wild numbers). The reorder note on the dashboard uses it too.
- **Shopping list:** on the Filament tab: low spools, spools that run out within 3 weeks, and colours used in 2+ prints in the last 90 days with none left. Buy again, or copy the list as text.
- **Similar colours:** the spool popup warns when you already own a close colour in the same material, and the Filament tab lists near-duplicates in stock (CIE76 colour distance).
- **Print summary:** a recap of the last 7 or 30 days, this or last month, or this year. Copy it, save it as text, or print it.
- **Print calendar:** a year of squares on the dashboard (one per day, darker with more prints) with weekly streaks.
- **More than one printer:** Settings > Printer can add up to 5 more printers. Each has its own details, electricity, wear, hours, wear parts and reminders; every print records which printer made it (the picker only appears once you have two). AMS units stay shared. Removing a printer moves its prints to the main one and deletes its parts and reminders (Undo restores them).
- **Getting started guide:** a short checklist at the top of the dashboard for anyone new (pick the printer, add a spool, optionally set up an AMS, log a print, back up). Steps tick themselves off from your data, and it explains that data stays in this browser. Hide it any time; bring it back in Settings > Preferences. People who already have prints are not shown it.
- **Printing now:** start a timer for a print that is running (from the dashboard, or "Start" on a queue item), with an optional estimate. The dashboard shows time so far, a progress bar and the time left. "Finished" opens the print form filled in (and ticks off the queue item); "Failed" fills in a failure with the time it ran; "Stop timer" forgets it (Undo restores it). Up to 6 timers can run at once.
- **Re-weigh a spool:** put a spool on a scale, enter the reading and the empty-spool weight, and the app corrects its grams-left (prints logged afterwards still subtract). The empty weight is remembered. Spools can also record where they are stored ("Dry box 2"), shown on the card and on labels, with suggestions from places you already used.
- **Fill from a slicer file:** in the print popup, pick a `.gcode.3mf` (Bambu Studio / Orca) or a `.gcode` file to fill in the name, print time, grams per filament, the matching spool (by material and colour) and the profile. The file is read in your browser and never uploaded. The `.gcode.3mf` format is documented; the weight and time comments in plain `.gcode` differ by slicer and were written from memory of Bambu, Orca and Prusa output (Cura gives time only), so check the numbers it fills in. Binary G-code (`.bgcode`) is not supported.
- **Select several prints:** the Select button on the Prints tab adds checkboxes. Tag or untag the selected prints, export just them as a CSV, or delete them (Undo restores them, and a snapshot is taken first). Selections only ever include prints currently shown by your search and filters.
- **Automatic backup (Chrome and Edge):** on the Data tab, pick a folder once (a OneDrive or Dropbox folder is ideal). After you change something the app saves `print-tracker-backup.json` there, plus one dated copy per day for the last 14 days, so wiping your data by mistake cannot overwrite the only good copy (nothing is written while the app has no data). Restore with Import JSON. After a reload the browser may ask permission again, which needs one click ("Allow access"). A recent folder backup replaces the dashboard backup reminder. Other browsers lack the folder API and keep the manual export. I could only test this against a simulated folder, not a real folder picker, so check that a file appears the first time.
- **Failure rate:** on the Filament tab, how often prints fail by brand, material, spool or printer (a print using two spools counts under both). Groups under 5 prints are marked and left out of the "highest / lowest" comparison.
- **Leftover filament:** archiving a spool that still has filament asks how much is really left (Archive with an amount, Used up, or Do not record). The amount also corrects the spool's grams, so "Use again" later starts from the real number, and a Leftover filament panel adds up grams and value across archived spools.
- **Price history:** the spool popup says what you paid last time for the same brand, material and colour, and a spool card compares its price per kg with the previous purchase.
- **Prints with this spool:** a "Show prints" button on each spool card filters the Prints tab to prints that used it.
- **Drop a slicer file:** drag a `.gcode` or `.gcode.3mf` onto the page and the print form opens already filled in.
- **Customize the dashboard:** the Customize button next to Summary lets you hide panels or move them up and down (Reset puts them back). Running timers, warnings and the stat cards always show. It is remembered and included in backups.
- **Most-printed models:** a dashboard panel grouping prints by name (ignoring case and extra spaces) for anything printed twice or more, with success rate, grams, time, cost and a Print again button.
- **Merge JSON:** on the Data tab, adds the prints, spools and queue items from another backup (a friend's, or your other browser) without replacing anything. Spools that match one you have (brand, material, colour, date, weight, price) are not copied and their prints use yours; matching prints and queue items are skipped; clashing ids get new ones. It asks first, takes a snapshot and offers Undo. Settings, AMS, upkeep and timers from the other backup are not merged.
- **Spools by location:** once a spool has a storage location, the Filament tab gets a location filter (including "No location") and a Group by location view.
- **Spool sorting:** a sort box on the Filament tab (newest or oldest first, most or least left, cheapest or priciest per kg, brand). The default is the old order, archived spools always come last, and spools without a price go after priced ones when sorting by price. It is remembered.
- **Saved filters:** on the Prints tab, "Save these filters" stores the current search, result filter, tag and sort under a name (up to 12; saving under an existing name updates it). Pick one from the list to set everything at once; the list highlights a saved filter whenever the toolbar matches it. There is no date-range filter on prints, so "this month" is not something a saved filter can hold. Delete has Undo. They are kept in this browser and in backups.
- **Compare backup:** on the Data tab, pick a backup file and see how it differs from this browser without changing anything: a table of what is the same, only in the file, only here, and changed (a changed print or spool is one with the same id but different details, such as a result, notes, filament or location). Settings, AMS, upkeep and timers are not compared. Use Merge JSON to bring in what is only in the file.
- **Data check:** the Data tab can look for prints that use deleted spools, spools logged past their weight, archived spools still in the AMS, prints with no filament or a future date, and exact duplicate prints. Each has one fix or an Edit/Re-weigh shortcut, and fixes can be undone.
- **Settings that worked:** on the Filament tab, how often each layer height, infill and supports combination succeeded per material (a print counts under the material it used the most of; only combinations with 3 or more prints are shown, and "0.2" and "0.2 mm" count as the same).
- **Enough-filament check:** when a filament row in the print form uses more grams than the spool has left, the warning offers up to two other active spools of the same material that have enough (the nearest fit first). One click switches the row. This also applies to prints started from the queue.
- **Spools CSV:** the Data tab exports your spools (brand, material, colour, weight, price, date, location, grams left, status...) and imports spools from a spreadsheet. It reads this app's own export and common column names (Manufacturer, Colour, Cost...), commas, semicolons or tabs. Rows matching a spool you already have (brand, material, colour, date, weight, price) are skipped, and nothing existing is changed. On a new spool, a "Grams left" below the weight becomes a correction. Undo is offered.
- **Search everything:** the magnifier in the header (or `/`) searches prints, spools, queue items and tags at once. Every word must match; picking a result jumps to it and highlights it.
- **Retry a failed print:** a failed print gets a Retry button that opens a new print with the same filament, time, profile and tags, started as a success, with a note about the failure in place of the old notes. Models that have failed at least once show "Attempt 2 of 3" on each print card.
- **Undo and snapshots:** deleting a spool, archiving, clearing the queue, deleting all data and resetting settings can all be undone from the toast. The last 5 versions of your data are also kept in this browser (daily, and before an import or delete-all) and can be restored from the Data tab. They are not a real backup.
- **Accessibility:** skip link, keyboard navigation for tabs and popups, focus returns after popups close, visible focus, and text contrast of at least 4.5:1 in both themes and every accent.
- **Achievements:** 44 of them in seven groups, with progress bars and silly names.
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

`1`-`7` switch tabs, `N` new print, `S` add a spool, `/` search everything, `T` toggle theme, `?` shortcut list. Turn off in Settings.

## Running it

Open it through a local server (ES modules do not work from `file://`):

```
python -m http.server 8000
```

Then visit http://localhost:8000.

## Tests

The app has no build step, but there is a test suite that loads the real page in jsdom and clicks through it. You need Node 18 or newer.

```
npm install
npm test          # run the tests
npm run lint      # ESLint over js/ and tests/
```

On every push GitHub also runs both (`.github/workflows/test.yml`). `tests/run.js` bundles `js/main.js` with esbuild in memory, loads `index.html` into jsdom, and checks the behaviour of every tab, popup, import and export path, along with accessibility basics (names on controls, focus handling) and a few CSS rules. It prints `ok` or `FAIL` for each check and exits with an error code if any fail.

## Project structure

```
index.html
css/styles.css
tests/run.js      the test suite (see Tests)
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
js/shopping.js  js/colors.js  js/summary.js  js/heatmap.js   shopping list, colour matching, recap, calendar
js/weigh.js       re-weigh a spool
js/slicerFile.js  js/slicerFill.js   read .gcode / .gcode.3mf and fill the print form
js/running.js     "Printing now" timers and the start popup
js/bulk.js        select several prints
js/guide.js       getting-started checklist
js/autoBackup.js  automatic backup to a folder
js/leftover.js    ask how much is left when archiving a spool
js/customize.js   show, hide and reorder dashboard panels
js/merge.js       merge another backup into this one
js/check.js       data check with fixes
js/spoolsCsv.js   spools to and from CSV
js/search.js      search everything
js/snapshots.js  js/snapshotPanel.js
js/popups.js
```
