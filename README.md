# Surplus &rarr; Street
### Food-rescue coordination for Downtown San Diego

Downtown restaurants throw away good food every night while people go hungry two
blocks away. Some restaurants already drive it out — but nobody coordinates it,
so four show up at 16th & Market on a Friday and nothing arrives anywhere on a
Tuesday.

**This is the coordination layer.** Claim a zone, post how much you are bringing,
and every other restaurant sees it is covered.

| Tab | What it is |
|---|---|
| **Tonight** | The app. 10 delivery zones ranked by how much food is still needed, a zone map, and the claim flow. |
| **My drops** | Every claim you have made, exportable as a **California SB 1383** donation log. |
| **The situation** | The analysis underneath: 108 months of street counts across 382 blocks, with the shelter, health and transit context. |
| **Shelter plan** | A maximal-coverage siting model for where new shelter beds would reach the most people. |

Built for Building for Good 2026, Downtown Homelessness track.

## The need model

```
need tonight (zone) = expected people - meals already claimed
```

`expected people` is the mean of the three most recent published months for the
blocks in that zone, **rounded to the nearest 5**. `meals already claimed` comes
from the app itself, which is what stops two restaurants covering the same
corner while another goes dark.

The 10 zones are not invented — they are the neighbourhoods already present in
the source data, so a driver can navigate to one. Six of them carry 91% of the
expected need.

## Privacy is a design constraint, not a disclaimer

The app is handed to restaurant staff and volunteers. A public map of the exact
blocks where people sleep is surveillance of people who cannot consent to it, so:

- **Zones, not pinpoints.** `data/out/zones.json` is the only file the app reads.
  It carries a need *band*, a *rounded* expected figure and zone geography — no
  per-block values, no exact counts, no individual locations.
- **Every block in a zone is shaded the same colour** on the app map, so the
  picture cannot be read back down to a block.
- The block-level detail lives in **The situation** tab, which is the analyst
  view — the thing you show a city planner, not the thing a driver opens at 10pm.

> This is a resource-allocation tool, not an enforcement one.

## Reading the source

`index.html` is one self-contained file, but 85% of it is inlined JSON. For a
readable copy:

```bash
python3 scripts/extract_ui.py    # -> ui-source.html, ~154 KB, all code
```

That output is git-ignored because it is derived — edit `index.html` itself.
It is both the source and the artifact: `build_page.py` only rewrites what sits
between the `__DATA_BEGIN__` / `__DATA_END__` markers, and those survive every
build.

One gotcha: the stylesheet is global and single-file. A class name collision is
silent — `.bar` was already the map controls row, and reusing it collapsed the
comparison bars to zero width. Prefix new classes.

## Honest limits

- **Claims are stored in this browser** (`localStorage`). That demonstrates the
  loop, but the whole point of the product is that claims are *shared* — a hosted
  version needs a backend. Every read and write goes through `loadClaims` /
  `saveClaims`, so swapping in an API is one function.
- Expected need is a **model**, not a headcount. Volunteers walk the blocks twelve
  nights a year; everything between those nights is estimated from the
  neighbourhood total, and the app says so.
- One meal per expected person is a **planning assumption**, not a measurement.

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
│   ├── ingest.py              # front door: validate + merge a new data file
│   ├── rebuild_all.py         # run the whole pipeline, stop on the first break
│   ├── check_data.py          # row-count + reconciliation checks — run first
│   ├── build_heatmap_data.py  # the precompute pipeline (Steps A–E + tests 1–8)
│   ├── build_transit_data.py  # MTS trolley lines/stations, clipped to downtown
│   ├── build_shelter_data.py  # HIC beds + FY25 funding + siting gap model
│   ├── build_health_data.py   # HCAI licensed health facilities near downtown
│   ├── build_siting_model.py  # where the next shelters should go
│   ├── build_zones.py         # delivery zones + the need model the app reads
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

# 4. The siting model. Needs shelters.json; reads transit/health if present.
python3 scripts/build_siting_model.py

# 5. Delivery zones for the app.
python3 scripts/build_zones.py

# 6. Inline everything into index.html.
python3 scripts/build_page.py

# 7. Open the result. No server needed — that is the point.
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
| **Select area** | Drag a box over the map. The callout stays to a single number, and the breakdown below opens with a **plain-English sentence** ("about 313 people were sleeping outside here in Jan 2025; there are 109 beds and 27 are free, so 204 people have nowhere to go"), then three numbers, then a short list of what is in the area. Every table sits behind a *Show the full numbers* disclosure. Follows the slider, stays pinned through zoom/pan, and pressing the button again clears it. |
| Zoom / pan | Scroll and drag. Street labels counter-scale; minor streets appear past ~2.2×. |
| Blocks / Heat / **Table** | The table is the spec §6.6 fallback: the same month's numbers with no colour at all, sortable, for colour-blind readers, printing and screen readers. It follows the slider and narrows to your selection. |
| **Theme** | Auto / light / dark, remembered in `localStorage`. Dark is re-stepped from the same hue against the dark surface rather than auto-inverted (spec §6.2) — on a dark ground low values are deep navy and high values are bright, and the parcels sit *above* the street grid the way they do in light mode. |

Box-select includes a block when the box **overlaps its polygon**, not merely
its centroid — spec §5.5 notes two centroids fall outside their own block.
Pressing **Select area** a second time clears the box and the breakdown.

**Names are shown in plain English, not source keys.** Every `block_id` is
exactly its east street, an underscore, then its north street (verified for all
382), so `17TH_ST_K_ST` renders as "17th St & K St" from the two street fields
with no parsing. Shelter names drop the operator acronym the HIC bolts on the
front — "PATH - Connections Housing" becomes "Connections Housing", run by
People Assisting the Homeless — and known jargon is expanded (TAY →
Transition-Age Youth). The raw values stay in `shelters.json` as `raw_name`.

A **map key** in the bottom-left corner names the overlay marks, and lists only
the layers actually switched on. Shelters are circles, health facilities are
squares, so the two are distinguishable without relying on colour.

**Written for a non-technical reader.** The breakdown leads with a sentence
because a paragraph is the only format that needs no key. Jargon is gone from
every visible label — "People without a bed" rather than "unmet", "people"
rather than "persons", "Based on 12 physical counts" rather than "share
confidence" — and the dense tables are collapsed by default so the first screen
is a story, not a spreadsheet.

## Adding new data

This is meant to be used, not just demoed. New counts go in the front door:

```bash
python3 scripts/ingest.py path/to/new_counts.csv
python3 scripts/rebuild_all.py --accept-new-data
```

`ingest.py` detects the dataset from its columns, validates it, merges on the
natural key (so re-sending a file changes nothing, and a correction is just
that month re-sent), and backs up what it replaces. `rebuild_all.py` then runs
all seven stages and stops at the first real problem.

Everything downstream is derived: the slider length, which months count as
observed, block shares, the concentration stats, the shelter gap, and the
siting model — which rebases onto whatever the newest counted month is.
Verified end to end by ingesting a 13th count date.

See [`docs/UPLOADING_DATA.md`](docs/UPLOADING_DATA.md) for the schema of each
dataset and the difference between a *baseline* check (relaxable, because new
data is supposed to move it) and an *integrity* check (never relaxable).

## The siting model — how the recommendation is made

`scripts/build_siting_model.py` solves the **Maximal Covering Location Problem**
(Church & ReVelle, 1974): pick K of the 382 blocks so that the most people who
*currently have no free bed nearby* end up within walking distance of one.

Solved greedily. Coverage is submodular, so greedy is provably within
(1 − 1/e) ≈ 63% of optimal — which is why this is defensible without an ILP
solver, and an ILP solver would break the zero-dependency rule anyway.

Three choices that carry the result:

1. **Only free beds count as supply.** A 99%-full shelter next door serves
   nobody new, so it does not make a block look covered. This is why the answer
   is not just "next to the existing shelters".
2. **400 m, not 800 m.** Downtown is ~3.5 km across, so at 800 m every candidate
   site looks identical and the model collapses onto the naive answer. Measured
   lift over naive siting by radius:

   | walk | 250 m | 300 m | 400 m | 500 m | 600 m | 800 m |
   |---|---|---|---|---|---|---|
   | model beats naive by | +33% | +69% | **+38%** | +21% | +13% | +6% |

   400 m is the standard 5-minute-walk planning threshold and it discriminates.
   The full sweep ships in `plan.json` and on the Action plan tab, so the choice
   can be argued with rather than taken on trust.
3. **Cost is the city's own number**, $30,700 per bed-year, from the FY25 IBA
   report's 1,000-bed Kettner & Vine proposal at $30.7M/year.

**Result:** 847 people counted in Jan 2025, **658 with no free bed within a
5-minute walk**. Seven sites totalling 617 beds reach 616 of them — 94% — for
$18.9M a year. Naive siting reaches 445. The model finds **170 more people for
the same build**.

Two of the seven sites also come top when demand is averaged over the last three
counts instead of one, so the top of the list is the firm part and the tail is
indicative. That is stated on the page rather than buried here.

**What it cannot tell you:** demand is where people were counted *sleeping*, not
where they would accept a bed. Distances are straight-line — the bay and the
I-5 are not modelled as barriers. Land availability, zoning and community
process are not modelled at all. These are candidate areas for a siting study,
not sites.

## Working on this from a second machine

`index.html` is one big file, so **do not edit it to add a feature.** Drop files
into `src/panels/` instead and `build_page.py` inlines them automatically —
`*.html` into the page, `*.js` into the app script with all data in scope,
`*.css` into the stylesheet. Two new files merge cleanly; simultaneous edits to
`index.html` do not.

See [`docs/ADDING_A_PANEL.md`](docs/ADDING_A_PANEL.md).

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
