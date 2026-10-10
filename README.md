# Print Tracker

A personal 3D print and filament tracker for a Bambu printer. Plain HTML, CSS and JavaScript, no build step, no dependencies. Data lives in your browser's localStorage and can be exported/imported as JSON.

**Status:** v1.0 feature-complete (personal use)

## Features

- **Dashboard:** total prints, success rate, print time, filament used and left, money spent, cost of prints (including electricity), a "running low" alert, filament-by-material donut chart, prints-per-month chart, recent prints, queue, a printer card and achievements. A reminder appears when your last backup is old.
- **Prints:** add, edit and delete prints with date, result, optional print time, link, notes and one or more filament usages. Search, filter by result and sort. "Print again" copies a previous print. Deletes can be undone.
- **Filament:** add spools by hand (brand, material, colour with swatch, weight, price, date). Remaining grams are always calculated from your prints, never stored. Archive spools, hide archived, filter by material, "Buy again" to re-add a spool.
- **Queue:** keep a list of things to print, and turn an item into a logged print in one click.
- **Data:** export/import JSON (validated, with confirmation before replacing), export prints as CSV for spreadsheets, and delete all data.
- **Settings:**
  - *Printer:* model, nickname, nozzle, arrival/purchase date (a future date becomes a countdown), price, power draw and electricity price, and upkeep reminders counted in print hours, days or prints.
  - *Appearance:* dark/light/auto theme, six accent colours, background styles (layer lines, honeycomb, blueprint, dot grid, glow, plain), intensity, animation on/off and card spacing.
  - *Preferences:* currency, date format, low-filament threshold, default material and spool weight, backup reminder, keyboard shortcuts.
- Works on a phone (bottom tab bar).

## Keyboard shortcuts

`1`-`6` switch tabs, `N` new print, `S` add a spool, `/` search prints, `T` toggle theme, `?` open the shortcut list. They can be turned off in Settings.

## Notes

- Failed prints still use filament, so they count toward a spool's usage.
- Going over a spool's weight is a warning, not a block (shown as "Over by ~Xg").
- Everything is saved in the browser it was entered in. Export regularly if you want a backup or want to move devices.
- Upkeep intervals are suggestions you set yourself, not manufacturer schedules.

## Running it

The app uses an ES module, so open it through a local server instead of `file://`:

```
python -m http.server 8000
```

Then visit http://localhost:8000.

## Project structure

```
index.html
css/styles.css
js/main.js
```
