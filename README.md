# clickbot

Browser automation for repetitive work across two web apps at once.

## Task 1: Allocate drivers to trucks

The bot keeps **both apps open** and loops this flow:

1. **Dispatch app** — read the truck number (fixed spot on the page)
2. **Fleet app** — search that truck, read the driver name (fixed spot)
3. **Dispatch app** — paste the driver name
4. If the name is missing or invalid → paste **`Driver Unknown`**

## Setup

```bash
npm install
npm run install-browsers
cp config/local.example.json config/local.json
```

Edit `config/local.json` with your real app URLs and CSS selectors:

| Field | Purpose |
| --- | --- |
| `apps.dispatch.url` | First web app (truck list / allocation) |
| `apps.dispatch.selectors.truckNumber` | Where the truck number is shown |
| `apps.dispatch.selectors.driverNameInput` | Where to type the driver name |
| `apps.dispatch.selectors.submitButton` | Optional save/submit button |
| `apps.dispatch.selectors.nextItemButton` | Optional control to move to next truck |
| `apps.fleet.url` | Second web app (driver lookup) |
| `apps.fleet.selectors.searchInput` | Search box for the truck number |
| `apps.fleet.selectors.searchButton` | Optional search button (uses Enter if empty) |
| `apps.fleet.selectors.driverNameResult` | Where the driver name appears |
| `apps.fleet.selectors.resultReady` | Optional element that means results loaded |

Tip: in Chrome, right-click an element → Inspect → right-click the DOM node → Copy → Copy selector.

## Run

```bash
npm run allocate
```

Or:

```bash
npm start
```

The browser opens both pages. Leave it running; press `Ctrl+C` to stop.

### Useful config knobs

- `headless: false` — keep the browser visible (recommended while setting selectors)
- `loop.maxRuns` — `0` means run forever; set e.g. `10` for a short test
- `loop.delayBetweenRunsMs` — pause between trucks
- `defaultDriverName` — fallback when lookup fails (default: `Driver Unknown`)

## Project layout

```
config/
  default.json          # shared defaults
  local.example.json    # template — copy to local.json
  local.json            # your secrets/selectors (gitignored)
src/
  index.js              # entrypoint / task router
  browser.js            # open both apps, shared page helpers
  tasks/
    allocateDrivers.js  # task 1 loop
  utils/
    driverName.js       # name validation + fallback
```

More tasks can be added under `src/tasks/` and wired in `src/index.js`.
