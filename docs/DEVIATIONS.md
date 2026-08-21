# Deviations from HEATMAP_SPEC.md

Where the spec and the data disagree, **the data wins** — but the disagreement
gets written down here rather than silently worked around.

Every item below was verified against the files in `data/raw/` by
`scripts/check_data.py` and the assertions in `scripts/build_heatmap_data.py`.
Re-run either to reproduce.

---

## D1. The series is 108 months, not 102

**Spec says:** 102 months, in §0, §3.3, §4.2 and §6.5 ("102 steps").
**Data says:** **108 months**, `2017-01` → `2025-12`, all present.

`2017-01` → `2025-12` inclusive *is* 108 months. The spec's own stated date
range contradicts its own count — 102 months would end at `2025-06`. The date
range is the half that matches reality.

**Resolution: the pipeline emits 108 months.**

Of those 108, **104 carry data** and 4 are the reporting gap in D2.

**Consequences:**
- The time slider has **108 steps**, not 102. If a judge asks why it isn't 102,
  this is the answer.
- `values.json` → `months` has length 108, and `values` is 108 × 382.
- **Layer 3 note:** §11 makes `months` the shared spine between layers, so this
  length change is an interface fact, not a private implementation detail.
  Layer 3 should read the array's length rather than assuming 102.

## D2. 143 null count rows, not 140

**Spec says:** "140 rows are missing" (§1.1 prose).
**Data says:** **143**.

§5.1's own itemisation adds to 143, and matches the data category by category:

| Category | Spec §5.1 | Actual |
|---|---|---|
| All components, Jul/Aug/Oct/Nov 2025 | 116 | 116 |
| Components (not total), Nov 2018 | 18 | 18 |
| Sept 2021 City Center; Dec 2021 Marina | 6 | 6 |
| Outside Perimeter, Jan–Mar 2021 (`not_in_program`) | 3 | 3 |
| **Total** | **143** | **143** |

So §5.1's table is correct and §1.1's prose figure is the error. The detailed
breakdown is the part the pipeline depends on, so this is a benign
inconsistency.

**Resolution: no behavioural change.** Noted for anyone checking the number.

## D3. Outside Perimeter has no level data before 2021-01 — the spec never says so

**Spec says:** §5.1 lists Outside Perimeter Jan–Mar 2021 as `not_in_program`
(3 rows), implying the area is otherwise present.
**Data says:** Outside Perimeter appears in `DowntownCounts_Monthly.csv` for
**60 months only** (`2021-01` → `2025-12`). The other six areas have all 108.

**There is no `area_total` for Outside Perimeter for the 48 months
`2017-01` → `2020-12`.**

This is the most consequential deviation. §3.3's Step C is
`area_total × block_share`, so with no area total there is nothing to
disaggregate: **121 blocks — 32% of the map — have no estimate for 48 of the
108 slider positions**, i.e. the first four years.

**Resolution: an explicit "not yet in the counting program" state**, rendered
like the §6.4 missing-month treatment (neutral fill, no ramp colour) because
the semantics match — *not measured*, not zero.

**But the tooltip reason must be distinguishable from D4's**, because these are
different facts about the world:

| State | Tooltip | Means |
|---|---|---|
| Reporting gap (D4) | "No count published — DSDP reporting gap." | The count was due and skipped |
| Not in program (D3) | "Area not yet in the counting program." | It was never being measured |

A judge who notices a third of the map grey for the first four years will ask
which of the two it is. The honest answer is the second, and the UI should say
so without being asked.

**Never render either state as 0.** An all-white or zero-valued map reads as
"homelessness went to zero" — the same catastrophic misread §5.1 warns about.

## D4. The 2025 reporting gap is present-as-null, not absent

**Spec says:** §5.1 — Jul/Aug/Oct/Nov 2025 are a true reporting gap.
**Data says:** confirmed, and — importantly — **the rows exist with an empty
`count`** rather than being absent from the file.

This is the favourable case: the months stay in the index, so they cannot
silently vanish from the slider, and the null is explicit rather than inferred
from a missing row.

**Resolution: matches the spec.** Recorded only because "absent" and
"present-but-null" need different handling and the spec doesn't say which it is.

## D5. Outside Perimeter is observed on 5 block-level dates, not 4

**Spec says:** §3.2 — "only observed from 2022-01 onward (4 of 12 dates)".
**Data says:** **5 of 12** — `2022-01`, `2022-02`, `2023-01`, `2024-01`,
`2025-01`.

The five 382-block dates are exactly the dates on which the 121 Outside
Perimeter blocks appear. Cleanly confirmed: the 121 blocks outside the 261-block
panel *are* precisely the Outside Perimeter set.

**Resolution: no behavioural change.** §3.5 makes any block observed on fewer
than 6 dates automatically high-uncertainty, and 5 < 6 just as 4 < 6, so the
correct outcome is reached either way. §3.2's `share_confidence: "low"` for the
area still applies. Recorded so the count in the UI copy is right.

---

## Not deviations — verified matches

Checked and confirmed identical to the spec, listed so it's clear the bundle is
the one the spec was written against:

- §2.2 reconciliation, all 12 observed months, within ±0.5 on published,
  from-blocks *and* summed-absolute-error
- §2.1 area join — 103 East Village, 121 Outside Perimeter, 382 total
- §2.3's 12 observed dates, and the 261 → 382 split on the correct dates
- §4.1 bbox, identical to 8 decimal places; **9,304 vertices** exactly
- Exactly one null `tents_structures` — `16TH_ST_C_ST`, 2020-01
- 55.5% all-zero rows; 116 blocks never non-zero across all 12 sweeps
- All §1 row counts, and 382 GeoJSON features with 0 join orphans both ways
- The three multiplier regimes: (2.00, 2.00) → (1.75, 1.66) → (1.75, 2.03)

## Data currency

Recorded because it is the first question anyone asks, and it is a property of
the bundle rather than of the code:

- Latest **area-level** month: **`2025-12`** (a real published figure, not null)
- Latest **block-level** `report_month`: **`2025-01`**
- Nothing in the bundle covers 2026

Block counts are conducted roughly annually in January, so the 2025-01
block-level date is the expected cadence rather than a lapse. Any "as of" label
in the UI should cite `2025-12` for area totals and `2025-01` for the observed
block shape.
