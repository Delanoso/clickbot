# Keeper

Local-first **Pokémon GO** collection tracker. Know what to keep, what to trade, and how your dex is growing.

## Features

- **Box inventory** — CP, IVs, shiny / lucky / shadow / purified / costume flags
- **Keep / Trade / Transfer** — automatic recommendations from IVs, specials, and duplicates (with manual overrides)
- **Progress** — national dex %, shiny species, hundos, luckies, per-generation bars
- **CSV import / export** — paste or drop exports (flexible column names) to refresh your box
- **Manual add** — log catches when you do not have a CSV
- **Stays on device** — data saved in `localStorage`

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Click **Load demo box** on the overview to explore with sample data.

## CSV format

Minimum column: `Species` or `Species ID`.

Useful columns: `CP`, `Attack IV`, `Defense IV`, `Stamina IV`, `Level`, `Shiny`, `Lucky`, `Shadow`, `Purified`, `Favorite`, `Costume`, `Nickname`.

Boolean fields accept `true` / `false` / `1` / `0` / `yes` / `no`.

## Scripts

| Command        | Action                |
|----------------|-----------------------|
| `npm run dev`  | Dev server            |
| `npm run build`| Production build      |
| `npm run preview` | Preview production |
| `npm run lint` | Lint                  |

## Notes

Pokémon GO has no official collection API, so “automatic” updates mean importing scans/exports from tools like Calcy IV or Poke Genie (or Keeper’s own CSV export). Recommendations are heuristic — always double-check meta and personal goals before transferring.
