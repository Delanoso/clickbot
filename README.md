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
| `npm run demo` | **App 2:** [Webfleet](https://www.webfleet.com/webfleet/products/login/?application=webfleet) (configured) |
| | CSS selectors for truck #, search, driver name, paste field |
| | Logins (manual in browser, or env vars in `.env`) |

### Progress

- [x] App 1 URL: Lytx (`https://login.lytx.com` → Assign Drivers)
- [x] App 2 URL: Webfleet (`live-wf.webfleet.com/web/map`)
- [x] Login forms for both apps
- [x] Workflow from screenshots: read VEHICLE → Webfleet DRIVER name → Lytx Assign modal
- [ ] Live selector fine-tuning after first real run (Angular/Material DOM can vary)

### Real workflow (from your screenshots)

1. **Lytx** `Assign Drivers` — read truck id from the **VEHICLE** column (e.g. `TH2239`)
2. **Webfleet** map — search that truck under **VEHICLES**, open it, copy **DRIVER → Name** (phones stripped)
3. **Lytx** — filter/select that vehicle’s events, open **Assign Driver**, paste into **Search Name or ID**, click **Assign**
4. If Webfleet has no usable name → paste **`Driver Unknown`**

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

Open both apps (manual login by default):

```bash
npm run explore
```

With `login.manual: true` (default), the browser opens **Lytx** and **Webfleet** and waits for you to sign in on each. Set credentials in `.env` and `"manual": false` to automate:

- Lytx: `LYTX_USERNAME`, `LYTX_PASSWORD`
- Webfleet: `WEBFLEET_ACCOUNT`, `WEBFLEET_USERNAME`, `WEBFLEET_PASSWORD`

`config/local.example.json` is already filled from your screenshots. Key fields:

| Field | Purpose |
| --- | --- |
| `apps.dispatch.workUrl` | Lytx Assign Drivers page |
| `apps.dispatch.selectors.firstVehicleCell` | VEHICLE column cell to read |
| `apps.dispatch.selectors.vehicleSearchInput` | Filter by vehicle (`Search Vehicle Name`) |
| `apps.dispatch.selectors.assignSelectedButton` | Opens bulk Assign Driver modal |
| `apps.dispatch.selectors.driverNameInput` | Modal field `Search Name or ID` |
| `apps.fleet.workUrl` | Webfleet map |
| `apps.fleet.selectors.searchInput` | Vehicles search box |
| `apps.fleet.selectors.driverNameResult` | Optional; otherwise DRIVER Name is auto-detected |

Tip: if a click misses in the real apps, right-click the element → Inspect → Copy selector and put it in `config/local.json`.

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
  default.json          # shared defaults (Lytx + Webfleet)
  local.example.json    # template — copy to local.json
  local.json            # your overrides (gitignored)
  demo.json             # local fake apps for npm run demo
src/
  index.js              # entrypoint / task router
  browser.js            # open both apps + login
  apps/
    lytx.js             # Assign Drivers page actions
    webfleet.js         # map search + driver lookup
  tasks/
    allocateDrivers.js  # task 1 loop
  utils/
    driverName.js       # name cleanup + fallback
```

More tasks can be added under `src/tasks/` and wired in `src/index.js`.
