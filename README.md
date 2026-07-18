# clickbot

Browser automation for repetitive work across two web apps at once.

## Task 1: Allocate drivers to trucks

The bot keeps **both apps open** and loops this flow:

1. **Dispatch app** — read the truck number (fixed spot on the page)
2. **Fleet app** — search that truck, read the driver name (fixed spot)
3. **Dispatch app** — paste the driver name
4. If the name is missing or invalid → paste **`Driver Unknown`**

## What you need for it to run

| For local testing (no real apps) | For your real apps |
| --- | --- |
| Nothing else — use the built-in demo | **App 1:** [Lytx](https://login.lytx.com) (configured) |
| `npm run demo` | **App 2:** URL still needed |
| | CSS selectors for truck #, search, driver name, paste field |
| | Lytx login (manual in browser, or `LYTX_USERNAME` / `LYTX_PASSWORD`) |

### Progress

- [x] App 1 URL: `https://login.lytx.com`
- [x] Lytx login form selectors (`#username`, `#password`, `#submit-button`)
- [ ] App 1: where truck number is shown after login
- [ ] App 1: where to paste the driver name
- [ ] App 2 URL + search/result selectors

## Quick test (demo apps)

This spins up two fake local web apps and runs the bot against them (4 trucks):

```bash
npm install
npm run install-browsers
npm run demo
```

Expected results:

- `T-1001` → Alex Rivera
- `T-1002` → Sam Okonkwo
- `T-1003` → Driver Unknown (fleet returns `N/A`)
- `T-404` → Driver Unknown (no driver found)

## Real apps setup

```bash
npm install
npm run install-browsers
cp config/local.example.json config/local.json
cp .env.example .env   # optional, for automated Lytx login
```

Open Lytx so you can log in and inspect the page (selectors still TBD):

```bash
npm run explore
```

With `login.manual: true` (default), the browser opens Lytx and waits for you to sign in. Set `LYTX_USERNAME` / `LYTX_PASSWORD` in `.env` and `"manual": false` to automate sign-in.

Edit `config/local.json` with the remaining selectors:

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
