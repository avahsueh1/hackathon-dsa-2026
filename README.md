# Downtown SD Homelessness — Block-Level Heat Map

Block-level heat map of estimated unsheltered persons across **382 downtown San
Diego blocks**, with a time slider spanning **102 months (2017-01 → 2025-12)**.

Built for the San Diego DSA hackathon, "Downtown Homelessness" challenge.

## The hard constraint

> **The deliverable must render offline with zero external dependencies.**
> No CDN. No tile server. No npm runtime. No fetch to any external host.
> The final artifact is a **single self-contained `index.html`** with the JSON
> inlined, and it must survive a strict CSP.

This is [`HEATMAP_SPEC.md`](docs/HEATMAP_SPEC.md) §0 and §6.1, and it shapes
every downstream choice: the map is inline SVG with a hand-rolled
equirectangular projection rather than a mapping library, and all data is
precomputed to static JSON rather than computed at runtime. A broken tile fetch
during a live demo costs more than a basemap gains.

The build tooling follows the same rule where it can — `scripts/check_data.py`
is standard-library-only Python, so it runs with no virtualenv and nothing to
install.

## Where this sits: 4 layers

| Layer | What | Status |
|---|---|---|
| 1 | Area-level forecast | separate |
| **2** | **Block-level heat map — this repo** | **in progress** |
| 3 | Shelter-gap + siting optimizer | separate, consumes Layer 2's output JSON verbatim |
| 4 | EyePop / computer-vision integration | separate |

Layer 2 is buildable and demoable standalone using observed counts alone — it
does not block on Layer 1. Layer 3 imports `values.json` and `geometry.json`
as-is, so their schema is a contract (spec §11).

## The core idea

There are monthly published counts for **7 areas**, but block-level counts for
only **12 dates**. 382 blocks × 102 months cannot be interpolated from 12
observations. So:

**Area totals supply the LEVEL. Block counts supply the SHAPE. Multiply them.**

```
estimate[block, month] = area_total[area(block), month] × block_share[block]
```

For the 12 observed months, the actual counted values replace the estimate
outright — no blending. **The UI must visibly distinguish observed from
estimated**; per the spec that honesty is a scoring criterion, not a nicety.

## File tree

Per spec §8, rooted at the repo root:

```
.
├── data/
│   ├── raw/                  # source files, unmodified — see "Getting the data"
│   └── out/                  # generated, git-ignored
│       ├── geometry.json
│       ├── values.json
│       └── insights.json
├── scripts/
│   ├── check_data.py         # row-count + reconciliation checks — run first
│   ├── build_heatmap_data.py # the precompute pipeline (not written yet)
│   └── validate_palette.js   # color-ramp validator (not written yet)
├── docs/
│   └── HEATMAP_SPEC.md       # authoritative implementation spec
├── index.html                # self-contained: inline CSS + JS + data (not written yet)
└── README.md
```

`data/out/` is git-ignored — it is fully reproducible from `data/raw/`.

## Getting the data

Seven source files go in `data/raw/` (an eighth, `2025_HIC.csv`, is Layer 3
territory and unused here). Expected sizes, from spec §1:

| File | Rows | Role |
|---|---|---|
| `DowntownCounts_Monthly.csv` | 2,880 | Level source — monthly totals per area |
| `BlockLevel_Counts.csv` | 3,737 | Shape source — 382 blocks × 12 dates |
| `BlockLevel_Counts_Panel261.csv` | 3,132 | Balanced panel for across-time comparison |
| `Downtown_BlockGrid.geojson` | 382 features | Geometry, EPSG:4326 / CRS84 |
| `Downtown_BlockGrid.csv` | 382 | Join table — carries `area`, which the GeoJSON lacks |
| `Area_Crosswalk.csv` | 24 | Label → canonical area mapping |
| `Methodology_Periods.csv` | 4 | Multiplier regimes |

These live in Ava's Google Drive and require link-sharing to be enabled on the
folder. Without it, Drive returns an HTML sign-in page that saves happily as a
`.csv` and parses as garbage — `check_data.py` checks the first bytes of every
file specifically to catch this.

## How to rebuild

```bash
# 1. Verify the raw data before anything else. Exits non-zero on any problem.
python3 scripts/check_data.py

# 2. Precompute the static JSON into data/out/. (not written yet)
python3 scripts/build_heatmap_data.py

# 3. Open the result. No server needed — that is the point.
open index.html
```

Step 1 gates step 2 deliberately. Per spec §9: *get the numbers right first —
polish on wrong numbers is worth nothing.*

## Two rules that will bite you

Both from spec §0:

1. **Never sum `total` together with `individual`/`tent`/`vehicle`** in
   `DowntownCounts_Monthly.csv`. They are the same people at two
   representations; summing them roughly doubles the population.
2. **Multipliers change by era.** A tent is 2.00 persons before Apr-2017 and
   1.75 after; a vehicle goes 2.00 → 1.66 → 2.03. Join them from the data,
   never hardcode a pair.

And one from §5.1: the four 2025 reporting-gap months (**Jul, Aug, Oct, Nov**)
must render as *"No count published"* — **never as zero**. An all-white map
reads as "homelessness went to zero," which is a catastrophic misread in a
demo.

## Provenance

Fresh-code rule: all work in this repo is created during the hacking window.
No imported prior work.
