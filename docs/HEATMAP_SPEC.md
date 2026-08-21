# Downtown SD Homelessness — Block-Level Heat Map

## Implementation handoff spec (Layer 2 of 4)

**Status:** ready to build · **Owner of this doc:** analysis lead · **Audience:** the agent/engineer coding the map
**Depends on:** Layer 1 (area-level forecast) — but this layer is buildable and demoable *today* using observed counts alone. Build it standalone first.
**Feeds:** Layer 3 (shelter-gap + siting optimizer) consumes this layer's output JSON verbatim.

## 0. TL;DR for the implementer

Build a **choropleth of 382 downtown San Diego blocks**, colored by estimated unsheltered persons, with a **time slider across 102 months (2017-01 → 2025-12)**.

The catch, and the whole reason this spec exists: **we have monthly counts for 7 _areas_, but block-level counts for only 12 _dates_.** You cannot interpolate 382 blocks × 102 months from 12 observations. So:

**Area totals supply the LEVEL (per month, from published data). Block counts supply the SHAPE (a static-ish within-area spatial weight). Multiply them.**

Every month's map = `area_total[month] × block_share[block]`. Observed months render observed values; everything else renders the disaggregation. **The UI must visibly distinguish the two.** That honesty is a scoring criterion, not a nicety.

Two hard rules that will bite you if ignored:

1. **Never sum `total` together with `individual`/`tent`/`vehicle`** in DowntownCounts_Monthly.csv. They are the same people at two representations. You will roughly double the population.
2. **Multipliers change by era.** A tent is 2.00 persons before Apr-2017, 1.75 after. A vehicle is 2.00 → 1.66 → 2.03. Join them from the data, never hardcode one pair.

## 1. Input files

All live in the Claude Project `homelessness downtown`. Copy into `data/raw/` before starting.

| File | Rows | Role in this layer |
|---|---|---|
| DowntownCounts_Monthly.csv | 2,880 | **Level source.** Monthly published totals per area, 2017-01 → 2025-12 |
| BlockLevel_Counts.csv | 3,737 | **Shape source.** 382 blocks × 12 dates (382 blocks only from 2022-01; 261 before) |
| BlockLevel_Counts_Panel261.csv | 3,132 | Balanced panel — 261 blocks present on *all* 12 dates. Use for any across-time comparison |
| Downtown_BlockGrid.geojson | 382 features | **Geometry.** Polygons, EPSG:4326 / CRS84 |
| Downtown_BlockGrid.csv | 382 | **Join table.** Has `area`; the GeoJSON does **not** — see §2.1 |
| Area_Crosswalk.csv | 24 | Label → canonical area mapping |
| Methodology_Periods.csv | 4 | Multiplier regimes (also inlined per-row in the monthly file) |

### 1.1 Column contracts

**DowntownCounts_Monthly.csv**

```
date, year, month_num, month, area, area_source_label, area_type, parent_area,
component, count, method, tent_multiplier, vehicle_multiplier, fellowship_month, flag
```

- Filter to `area_type == 'neighborhood'` **and** `component == 'total'` → 7 areas × 102 months. This is the level series. Nothing else in this file is needed for the map.
- `count` is **nullable**. 140 rows are missing; see §5.1.
- `method` ∈ {PRE2017, APR2017, MAY2018, POST2020}.

**BlockLevel_Counts.csv / ..._Panel261.csv**

```
block_id, neighborhood_source, area, count_date, report_month,
individuals, tents_structures, vehicles [, in_panel_261]
```

- **Join on `report_month`, NOT `count_date`.** The sweep dated 2022-03-01 is the *February 2022* count. `report_month` already encodes this; `count_date` is the raw field date.
- `tents_structures` is nullable Int64 — exactly **one** null (16TH_ST_C_ST, 2020-01-31). Do **not** fill it with 0; that fabricates an observation. Exclude the block-date or propagate NA.
- 55.5% of rows are all-zero. **This is real**, not missing data. 116 of 382 blocks are never non-zero on any date.

**Downtown_BlockGrid.geojson** — properties are `lon, lat, neighborhood, block_id, st_north, st_east, st_south, st_west`. Note it carries `neighborhood` (10 raw values) but **not** `area` (7 canonical values).

## 2. Validated facts you can build on

Computed against the real files. Treat as regression targets — if your pipeline disagrees, your pipeline is wrong.

### 2.1 The area join

| GeoJSON `neighborhood` | → canonical `area` | blocks |
|---|---|---|
| City Center | City Center | 50 |
| Columbia | Columbia | 22 |
| Cortez | Cortez | 42 |
| Gaslamp | Gaslamp | 17 |
| Marina | Marina | 27 |
| East Village | East Village | 48 |
| South East Village | East Village | 55 |
| Barrio Logan | Outside Perimeter | 35 |
| Golden Hill | Outside Perimeter | 52 |
| Sherman Heights | Outside Perimeter | 34 |

→ East Village = **103** blocks, Outside Perimeter = **121** blocks. 382 total. **Do the join through `Downtown_BlockGrid.csv`, not by string-matching `neighborhood`.**

### 2.2 The persons formula reconciles — this is your unit test

```
persons = individuals + tent_multiplier × tents_structures + vehicle_multiplier × vehicles
```

Summing block persons within an area reproduces the **published** area total to within ~1%:

| report_month | tentM | vehM | Σ published | Σ from blocks | Σ abs error |
|---|---|---|---|---|---|
| 2018-01 | 1.75 | 1.66 | 804 | 804.5 | 2.3 |
| 2018-02 | 1.75 | 1.66 | 862 | 854.4 | 8.0 |
| 2019-01 | 1.75 | 2.03 | 898 | 891.2 | 7.3 |
| 2020-01 | 1.75 | 2.03 | 789 | 786.9 | 4.8 |
| 2020-02 | 1.75 | 2.03 | 744 | 743.0 | 1.4 |
| 2021-01 | 1.75 | 2.03 | 715 | 702.6 | 12.4 |
| 2021-02 | 1.75 | 2.03 | 668 | 671.4 | 9.4 |
| 2022-01 | 1.75 | 2.03 | 1409 | 1408.5 | 2.5 |
| 2022-02 | 1.75 | 2.03 | 1445 | 1392.5 | 52.6 |
| 2023-01 | 1.75 | 2.03 | 1938 | 1955.1 | 18.1 |
| 2024-01 | 1.75 | 2.03 | 1019 | 1019.0 | 8.6 |
| 2025-01 | 1.75 | 2.03 | 843 | 847.3 | 6.8 |

Jan-2025 per area: East Village blocks 435.1 vs published **435**; Gaslamp 41.0 vs **41**; Marina 17.0 vs **17**.

**Acceptance test #1:** your pipeline must reproduce this table to ±0.5.

### 2.3 The 12 observed block-level dates

2018-01, 2018-02, 2019-01, 2020-01, 2020-02, 2021-01, 2021-02, 2022-01, 2022-02, 2023-01, 2024-01, 2025-01 (as `report_month`). Blocks per date: **261** for 2018-01 → 2021-02; **382** for 2022-01 → 2025-01.

### 2.4 Concentration — the headline insight

Using recency-weighted shares over the 261-block panel:

- Top **10** blocks = **29.7%** of all downtown unsheltered persons
- Top **25** blocks = **47.7%**
- Top **50** blocks = **66.2%**
- 17TH_ST_K_ST alone = **8.1%** of the entire downtown count

**Put this on screen.**

Top 3 blocks per area (within-area share):

| Area | 1st | 2nd | 3rd |
|---|---|---|---|
| City Center | 03RD_AV_A_ST (19.6%) | 10TH_AV_C_ST (6.1%) | 11TH_AV_C_ST (5.2%) |
| Columbia | UNION_ST_W_ASH_ST (20.5%) | UNION_ST_W_C_ST (18.2%) | INDIA_ST_W_B_ST (15.9%) |
| Cortez | 02ND_AV_I-5_SB (24.2%) | 03RD_AV_I-5_SB (17.2%) | 05TH_AV_CEDAR_ST (13.1%) |
| East Village | 17TH_ST_K_ST (15.2%) | PARK_BL_J_ST (6.2%) | 09TH_AV_E_ST (5.6%) |
| Gaslamp | 05TH_AV_BROADWAY (20.7%) | 06TH_AV_BROADWAY (11.2%) | 06TH_AV_F_ST (8.6%) |
| Marina | KETTNER_BL_W_E_ST (21.0%) | 04TH_AV_G_ST (13.5%) | 03RD_AV_J_ST (9.5%) |

### 2.5 How stable are shares? (drives the uncertainty UI)

Spearman rank correlation of block shares between consecutive observed dates: **0.41 – 0.60**. Pearson: **0.60 – 0.92**.

Read: **hot blocks stay hot, but the exact ordering churns.** Defensible for "where is need concentrated", **not** for "this block will have 14 people in March." The UI must reflect that — see §6.4.

## 3. The algorithm

### 3.1 Step A — era-aware persons per block-date

```python
mult = (monthly[['date','tent_multiplier','vehicle_multiplier']]
        .drop_duplicates('date').set_index('date'))
blocks = blocks.merge(mult, left_on='report_month', right_index=True, how='left')
blocks['persons'] = (blocks.individuals
                     + blocks.tent_multiplier * blocks.tents_structures
                     + blocks.vehicle_multiplier * blocks.vehicles)
```

Leave NA as NA for the one null tent row.

### 3.2 Step B — within-area block share (recency-weighted)

Half-life = 3 observations:

```python
dates = sorted(blocks.report_month.unique())          # 12 values
w = {d: 0.5 ** ((len(dates) - 1 - i) / 3.0) for i, d in enumerate(dates)}
blocks['w'] = blocks.report_month.map(w)
blocks['wp'] = blocks.persons * blocks.w
num = blocks.groupby(['area','block_id']).wp.sum()
den = blocks.groupby('area').wp.sum()
share = (num / den)                                    # sums to 1.0 within each area
```

**Constraint:** `share.groupby('area').sum()` must equal 1.0 for every area (±1e-9).

**Zero-share handling.** 8 of 261 panel blocks (and more of the 382) have share exactly 0. Do **not** floor them to an epsilon — a block never non-zero across 12 sweeps genuinely reads as zero, and a floor invents need where none was observed. Render as the ramp's lightest step with `observed_zero: true` in the tooltip.

**Outside Perimeter caveat.** Its 121 blocks are only observed from 2022-01 onward (4 of 12 dates). Compute its shares from those 4 dates only, and set `share_confidence: "low"` for the whole area. Its published monthly total is also the most volatile in the dataset (48 → 253 within eight months of 2024–25), so it deserves a visible caveat.

### 3.3 Step C — disaggregate every month

```
estimate[block, month] = area_total[area(block), month] × share[block]
```

`area_total` from DowntownCounts_Monthly (`area_type=='neighborhood'`, `component=='total'`). For future months, substitute Layer 1's forecast — formula identical.

### 3.4 Step D — observed override

For the 12 observed months, **replace the estimate with the actual block `persons`** and mark `is_observed: true`. Do not blend. A judge asking "is this real data or your model?" must get a crisp answer per cell.

### 3.5 Step E — uncertainty band

```python
share_by_date = persons_by_block_date / area_total_by_date
cv = share_by_date.std() / share_by_date.mean()   # coefficient of variation
```

Bucket: low (cv < 0.5), medium (0.5–1.0), high (> 1.0). Surface as hatch overlay + tooltip. Blocks observed on fewer than 6 dates are automatically high.

## 4. Precompute pipeline

Everything precomputed to static JSON. **No runtime computation, no server, no fetch to an external host.**

```
scripts/build_heatmap_data.py
  ├─ load 6 raw files
  ├─ Step A: era-aware persons
  ├─ Step B: shares  (assert sums == 1.0)
  ├─ Step C: 102 months × 382 blocks
  ├─ Step D: observed override
  ├─ Step E: cv buckets
  ├─ run acceptance tests (§7) — fail loudly
  └─ write data/out/*.json
```

### 4.1 Output: geometry.json

```json
{
  "bbox": [-117.17110776, 32.69482809, -117.13374677, 32.72390291],
  "blocks": [
    {
      "id": "17TH_ST_K_ST",
      "area": "East Village",
      "neighborhood_source": "East Village",
      "streets": {"n":"K_ST","e":"17TH_ST","s":"L_ST","w":"16TH_ST"},
      "centroid": [-117.1512, 32.7098],
      "rings": [[[x,y],[x,y]]]
    }
  ]
}
```

**9,304 vertices across 382 features** (mean 24, max 901). Round to 6 dp (~11 cm) — lossless here, halves file size. Do **not** simplify topology: polygons are validated (0 self-intersections, 0 overlaps, 0 unclosed rings).

### 4.2 Output: values.json

Column-oriented, block order matching geometry.json.

```json
{
  "months": ["2017-01", "..."],
  "block_ids": ["17TH_ST_K_ST", "..."],
  "observed_months": ["2018-01","2018-02","2019-01","2020-01","2020-02",
                      "2021-01","2021-02","2022-01","2022-02","2023-01",
                      "2024-01","2025-01"],
  "values": [[0.0, 1.4]],
  "is_observed": [[false]],
  "share": [0.0809],
  "share_within_area": [0.1518],
  "cv_bucket": ["low","high"],
  "n_observations": [12, 12, 4],
  "area_totals": { "East Village": [110.0] },
  "missing_months": ["2025-07","2025-08","2025-10","2025-11"]
}
```

~500 KB uncompressed. Acceptable inline.

### 4.3 Output: insights.json

Precomputed callouts: top-N concentration, top blocks per area, biggest movers month-over-month, the §2.4 numbers.

## 5. Data landmines — read before coding

### 5.1 Missing months are missing, not zero

| What | Rows | Cause |
|---|---|---|
| All components, **Jul / Aug / Oct / Nov 2025** | 116 | **True reporting gap** — DSDP published no report |
| Components (not total), Nov 2018 | 18 | Breakdown table absent from source |
| Sept 2021 City Center; Dec 2021 Marina | 6 | Absent from source |
| Outside Perimeter, Jan–Mar 2021 | 3 | Area not yet in program (flag = not_in_program) |

The slider must **skip or gray out** the four 2025 gap months. Rendering them as an all-white map reads as "homelessness went to zero" — a catastrophic misread in a demo. Show an explicit *"No count published for this month"* state.

### 5.2 Scope: neighborhood detail starts 2017

Downtown-wide monthly totals for 2012–2016 exist in source PDFs but carry no area detail and are **not** in this bundle. Do not promise a 2012 start.

### 5.3 Core → City Center

Same area, relabeled by DSDP in 2019 and applied retroactively. `area` is already canonicalized; `area_source_label` preserves the original. Use `area`.

### 5.4 Duplicate street-corner names

Two blocks carry a `__2` suffix (22ND_ST_BROADWAY__2, FRONT_ST_W_MARKET_ST__2). **`block_id` is the key. Never key on street labels.**

### 5.5 Use polygons, not centroids, for spatial joins

Two centroids fall outside their own polygon (22ND_ST_SR-94_EB_ON_RA by 12 m, 22ND_ST_BROADWAY by 7 m). Centroids are fine for label placement; use geometry for anything spatial.

### 5.6 The bounding-street fields are labels, not a graph

6.6% of N–S and 8.5% of E–W adjacency pairs disagree with actual geometry. Don't build a neighbor graph from `st_*`.

### 5.7 Known component/total contradictions

25 area-months carry `flag = component_total_mismatch`. `total` is published-and-verified; components are a map-digitization product, so **the components are the suspect side.** This layer keys off `total` and is largely immune. Largest residuals: East Village 2023-12 (−57), 2019-12 (−46); Gaslamp 2019-12 (−27).

## 6. Front-end spec

### 6.1 Rendering approach — inline SVG, no map library

**Zero external dependencies.** No CDN, no tile server, no npm runtime. Must render offline and survive a strict CSP.

```js
// Equirectangular, adequate at this scale (~3.5 km × 3.2 km)
const [minLon, minLat, maxLon, maxLat] = bbox;
const latRad = (minLat + maxLat) / 2 * Math.PI / 180;
const kx = Math.cos(latRad);                    // lon compression at this latitude
const w = (maxLon - minLon) * kx, h = (maxLat - minLat);
const scale = Math.min(width / w, height / h);
const px = lon => (lon - minLon) * kx * scale + padX;
const py = lat => height - ((lat - minLat) * scale) + padY;   // flip Y
```

One `<path>` per block into a single `<svg viewBox=...>`. Recolor on slider move by mutating `fill` only — never rebuild paths. Pan/zoom via a transform on a wrapping `<g>`.

*(A MapLibre + street basemap version is a nice-to-have if time allows and a self-hosted style is available. Do not start there — a broken tile fetch during a live demo costs more than a basemap gains.)*

### 6.2 Color — sequential, single hue, light→dark

| step | hex | | step | hex |
|---|---|---|---|---|
| 100 | #cde2fb | | 400 | #3987e5 |
| 150 | #b7d3f6 | | 450 | #2a78d6 |
| 200 | #9ec5f4 | | 500 | #256abf |
| 250 | #86b6ef | | 550 | #1c5cab |
| 300 | #6da7ec | | 600 | #184f95 |
| 350 | #5598e7 | | 650 | #104281 |
| | | | 700 | #0d366b |

Define as CSS custom properties; reference by role. Ship a **selected** dark mode — re-step from the same ramp against the dark surface, do not auto-invert. Light surface #fcfcfb, dark #1a1a19.

**Binning.** Do **not** use a linear scale — the distribution is severely right-skewed. Use **fixed, human-readable breaks** so color means the same thing in every month (a per-month quantile scale is an anti-pattern here — the whole point of the slider is comparing months):

```
0        → surface (empty), thin outline only
0 – 2    → step 150
2 – 5    → step 250
5 – 10   → step 350
10 – 20  → step 450
20 – 40  → step 550
40 – 80  → step 650
80+      → step 700
```

Validate before shipping: `node scripts/validate_palette.js "<hex,…>" --mode light` (and `--mode dark`). Don't eyeball it.

### 6.3 Marks & anatomy

- Block outline: 0.5px, `--border-subtle`. At zoom > 3×, raise to 1px.
- Hover: 2px surface-colored ring (never a hue change — hue carries magnitude).
- Selected block: 2px `--text-primary` outline, persists until deselected.
- **Legend always present**, horizontal, above the map, numeric breaks labeled. Non-negotiable.
- Text in text tokens, never in a ramp color.

### 6.4 Distinguishing observed from estimated — required

This is the credibility feature. Judges will ask.

- **Observed months** (the 12): solid fill. Slider tick as a filled dot. Header badge: **"Observed count — Jan 2025"**.
- **Estimated months**: same fill plus a subtle 45° hatch over the whole map (SVG `<pattern>`, ~8% opacity). Header badge: **"Estimated — Mar 2023 · area total × block share"**.
- **High-cv blocks**: small corner dot marker regardless of month; tooltip explains the share varies a lot across counts.
- **Missing months**: neutral gray fill, centered overlay *"No count published — DSDP reporting gap."*

Permanent caption under the map:

*Block-level estimates distribute each area's published monthly total across its blocks using spatial patterns from 12 physical counts (2018–2025). Blocks are indicative of where need concentrates, not exact per-block headcounts.*

### 6.5 Interaction

**Time slider** (primary control)
- 102 steps, snapping to month. Play/pause at ~4 months/sec.
- Observed months get distinct ticks; missing months grayed.
- Keyboard: ←/→ step, shift+←/→ jump 12 months, space toggles play.

**Tooltip** (hover any block) — required, not optional

```
17TH_ST_K_ST · East Village
K_ST / 17TH_ST / L_ST / 16TH_ST
─────────────────────────────
Est. 66 persons            ← or "Counted 71 persons" when observed
15.2% of East Village · 8.1% of downtown
Share confidence: medium (12 counts)
```

**Click a block** → side panel: sparkline of that block's 102-month series with observed months as dots, its rank downtown, its share.

**Filters** (single row above the map)
- Area multi-select (7 areas; default all)
- "Show only top N blocks" toggle (N = 10 / 25 / 50) — dims everything else
- Layer toggle: Persons (default) / Tents / Vehicles — latter two only meaningful on observed months; gray out otherwise

**Persistent stat row** above the map: downtown total for the selected month · MoM change · YoY change · top-10 concentration %. Hero numbers, not a chart.

### 6.6 Accessibility

- Identity never color-alone: legend always visible, plus a **table view toggle** (also the CVD/print fallback).
- Hatch texture works in forced-colors mode.
- Every control keyboard-reachable; slider is a native `<input type=range>` with proper `aria-valuetext`.
- Tooltip content exposed via `aria-describedby` on focus.

### 6.7 Responsive

Map `width: 100%` with fixed aspect ratio from the bbox (≈ 1.1 : 1 after latitude correction). Below 768px: stat row wraps to 2×2, filters collapse into a disclosure, side panel becomes a bottom sheet. Body must never scroll horizontally.

## 7. Acceptance tests

Ship as assertions in `build_heatmap_data.py`; fail the build, don't warn.

1. **Reconciliation** — for each of the 12 observed months, Σ block persons per area matches published area total within the §2.2 error table ±0.5.
2. **Shares sum to 1** — `share_within_area.groupby(area).sum() == 1.0 ± 1e-9`, all 7 areas.
3. **Disaggregation preserves the level** — for every month and area, Σ over blocks of estimate equals area_total ± 0.01.
4. **No orphans** — every `block_id` in the counts exists in the GeoJSON and vice versa. 382 both ways, 0 orphans.
5. **Geometry integrity** — 382 features, 0 unclosed rings, all coordinates inside the §4.1 bbox.
6. **Missing preserved** — the 4 gap months of 2025 emit null, never 0.
7. **No double counting** — assert nothing sums `total` with components. (Guard: any area-month whose computed total exceeds 1.5× its published total fails.)
8. **Render check** — screenshot the built page at 1440px and 390px and look at it. The validator checks color, not layout.

## 8. File tree

```
heatmap/
├── data/
│   ├── raw/                  # the source files, unmodified
│   └── out/
│       ├── geometry.json
│       ├── values.json
│       └── insights.json
├── scripts/
│   ├── build_heatmap_data.py
│   └── validate_palette.js
├── index.html                # self-contained: inline CSS + JS + data
└── README.md                 # how to rebuild
```

Final deliverable is a **single self-contained `index.html`** with the JSON inlined — no external requests of any kind.

## 9. Build order

1. `build_heatmap_data.py` through Step B, with tests 1, 2, 4 passing. *Nothing visual yet — get the numbers right first.*
2. Static SVG of 382 blocks colored by one month. Ugly is fine.
3. Legend + fixed breaks + tooltip.
4. Time slider across 102 months, observed/estimated badge.
5. Stat row + top-N concentration callout.
6. Side panel sparkline, filters, table view.
7. Dark mode, responsive, a11y pass, screenshot check.

**Stop after step 4 and demo it.** A working slider over a correct map is most of the score; polish on wrong numbers is worth nothing.

## 10. Explicitly out of scope for this layer

- The forecast itself (Layer 1) — this layer consumes `area_total`, wherever it comes from
- Shelter beds, HIC data, gap scoring, siting optimization (Layer 3)
- Any EyePop / computer-vision integration (Layer 4)
- Sub-area (East Village N/S/E/W) granularity — the block layer supersedes it
- 2012–2016 backfill — data not in the bundle

## 11. Interface contract for Layer 3

Layer 3 imports `values.json` and `geometry.json` as-is. Guarantees this layer must hold:

- `block_ids` order is stable and identical across both files
- `geometry.json[].centroid` present for every block (distance anchor — but per §5.5 use rings for containment)
- `values.values[month][block]` is a person-count in the same units as the published totals
- Future months, when Layer 1 lands, append to `months` and `values` with `is_observed: false`. **No schema change.**
