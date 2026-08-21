# Downtown SD Homelessness — Block-Level Heat Map

Block-level heat map of estimated unsheltered persons across **382 downtown San
Diego blocks**, with a time slider spanning **108 months (2017-01 → 2025-12)**.
(The spec says 102; the delivered data carries 108 — see "Three places the
data disagreed with the spec".)

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
only **12 dates**. 382 blocks × 108 months cannot be interpolated from 12
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
│   ├── check_data.py          # row-count + reconciliation checks — run first
│   ├── build_heatmap_data.py  # the precompute pipeline (Steps A–E + tests 1–8)
│   ├── build_transit_data.py  # MTS trolley lines/stations, clipped to downtown
│   ├── build_shelter_data.py  # HIC beds + FY25 funding + siting gap model
│   ├── build_health_data.py   # HCAI licensed health facilities near downtown
│   └── build_page.py          # inlines data/out/*.json into index.html
├── docs/
│   └── HEATMAP_SPEC.md       # authoritative implementation spec
├── index.html                # self-contained: inline CSS + JS + data
└── README.md
```

`data/out/` also carries `transit.json`, `shelters.json` and `health.json`. All
three are optional — `build_page.py` hides those layers and still builds if any
is missing.

`data/out/` is git-ignored — it is fully reproducible from `data/raw/`.

## Getting the data

Seven source files go in `data/raw/` for the heat map itself. `2025_HIC.csv` and
`health_facility_locations.csv` feed the shelter and health layers instead —
spec §10 puts those in Layer 3, so they are additive and never touch
`geometry.json` or `values.json`. Expected sizes, from spec §1:

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

# 2. Precompute the static JSON into data/out/. Fails the build on any of the
#    8 acceptance tests, rather than warning.
python3 scripts/build_heatmap_data.py

# 3. Optional overlays. build_transit_data.py needs mts_google_transit.zip in
#    data/raw/ (see "Outside data" below); both are skippable.
python3 scripts/build_transit_data.py
python3 scripts/build_shelter_data.py
python3 scripts/build_health_data.py

# 4. Inline everything into index.html.
python3 scripts/build_page.py

# 5. Open the result. No server needed — that is the point.
open index.html
```

Step 1 gates step 2 deliberately. Per spec §9: *get the numbers right first —
polish on wrong numbers is worth nothing.*

`build_page.py` is idempotent: it rewrites only the region between
`/*__DATA_BEGIN__*/` and `/*__DATA_END__*/`, so `index.html` is both the source
you edit and the artifact you ship.

## What the page does

| Control | Behaviour |
|---|---|
| Time slider | 108 months. Play at ~4/sec, ←/→ steps, shift+←/→ jumps a year, space plays. Observed months get tall ticks, gap months orange. |
| Blocks / Heat | Choropleth on fixed breaks, or a blurred kernel-density layer. Both share the same breaks, so switching never changes what a colour means. |
| Trolley / Shelters / Health | MTS rail lines and stations; HIC shelters as circles sized by bed count, red at ≥95% full; HCAI health facilities as squares coloured by class. Shape carries the category, so the two never rely on colour alone. Hover any of them for detail. |
| **Select area** | Drag a box over the map for aggregate stats on just those blocks — persons, share of downtown, beds inside, unmet gap and its annual cost, plus health facilities inside it and a 108-month sparkline of the selection. Follows the slider and stays pinned through zoom/pan. |
| Zoom / pan | Scroll and drag. Street labels counter-scale; minor streets appear past ~2.2×. |

Box-select includes a block when the box **overlaps its polygon**, not merely
its centroid — spec §5.5 notes two centroids fall outside their own block.

## Outside data

Sources beyond the heat map's own seven files. Anything fetched from the network
is fetched at **build time only** and baked into `index.html`, so the delivered
page still makes zero network requests and satisfies §0.

| Source | Used for | Provenance |
|---|---|---|
| MTS GTFS feed | 5 trolley lines, 30 downtown stations | [MTS developer feed](https://www.sdmts.com/business-center/app-developers), `google_transit.zip` |
| 2025 HIC | 21 downtown shelters, 1,516 beds | already in the bundle as `2025_HIC.csv` |
| CA HCAI facility file | 21 on-map health facilities, 205 within 10 km | `health_facility_locations.csv`, 15,097 rows statewide |
| City IBA report 24-24 REV | FY25 per-program shelter funding | [FY 2025 Homelessness Programs and Funding](https://www.sandiego.gov/sites/default/files/2024-09/24-24-rev-fy-2025-homelessness-programs-and-funding_rev.pdf), Attachment I Table 1 |

The GTFS zip is not committed. To refresh it:

```bash
curl -L -o data/raw/mts_google_transit.zip \
  https://www.sdmts.com/google_transit_files/google_transit.zip
```

## Three places the data disagreed with the spec

Per the handoff working agreement — the data wins, but say so out loud.

1. **108 months, not 102.** `DowntownCounts_Monthly.csv` runs 2017-01 → 2025-12
   inclusive. The pipeline uses all 108 and prints a note.
2. **Outside Perimeter is observed on 5 block-level dates, not 4** (§3.2), and
   has *no published area total at all* before 2021-04 — 55 null months. Those
   blocks render as "no data" grey, never as zero, and are never hatched:
   "no published total" is a different claim from "estimated".
3. **§2.4 quotes two different estimators.** The per-area top-3 table is the
   recency-weighted share of §3.2 — the pipeline reproduces all 18 rows to
   ≤0.1pp. The concentration headline (29.7 / 47.7 / 66.2 / 8.1) only
   reproduces on an *equal-weighted mean of each date's downtown share*.
   Both are computed and labelled; test 8 asserts the headline. On the
   recency-weighted basis the same panel gives 33.2 / 51.8 / 70.2 —
   concentration has intensified in recent counts, which strengthens the claim
   rather than contradicting it.

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
