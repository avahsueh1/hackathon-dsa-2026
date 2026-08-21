# Adding new data

Someone finishes a street count. DSDP publishes another month. A shelter opens.
None of that should mean hand-editing a CSV.

```bash
python3 scripts/ingest.py path/to/your_file.csv
python3 scripts/rebuild_all.py --accept-new-data
```

That is the whole loop. The map, the stats, the box-select breakdown and the
siting recommendations all move to the new numbers.

## What ingest does

1. **Works out what the file is** from its columns, not its filename.
2. **Validates** — required columns present, numbers parse, no blank keys.
   Nothing is written if anything fails.
3. **Merges on the natural key.** A row whose key already exists **replaces**
   the old one; new keys are appended. So:
   - re-sending the same file twice changes nothing the second time
   - a correction to February is just February, re-sent
   - a brand new count date is just that date's rows
4. **Backs up** the file it is about to change into `data/raw/_backups/`.
5. **Reports** what changed, then stops. It does not rebuild — so a bad file
   can be reverted before it reaches the map.

## Datasets it recognises

| `--type` | Goes to | Key | Must contain |
|---|---|---|---|
| `blocks` | `BlockLevel_Counts.csv` | `block_id` + `report_month` | `block_id, report_month, individuals, tents_structures, vehicles` |
| `monthly` | `DowntownCounts_Monthly.csv` | `date` + `area` + `area_type` + `component` | `date, area, area_type, component, count` |
| `panel` | `BlockLevel_Counts_Panel261.csv` | `block_id` + `report_month` | `block_id, report_month, individuals` |
| `grid` | `Downtown_BlockGrid.csv` | `block_id` | `block_id, area, lon, lat` |
| `hic` | `2025_HIC.csv` | `Project_Name_1` + `Address` | `Project_Name_1, Total_Beds, X, Y` |
| `health` | `health_facility_locations.csv` | `FACID` | `FACNAME, LATITUDE, LONGITUDE, COUNTY_NAME` |

Detection picks the most specific match. Force it with `--type`, and use
`--dry-run` to see the summary without writing.

### The one that matters: a new block count

`report_month` is the key, **not** `count_date`. A sweep walked on 2025-03-04
that reports the February count has `report_month = 2025-02-01`. Getting this
wrong files the count under the wrong month, and nothing will warn you.

Leave a cell **blank** for "not counted". Do not write `0` — zero is a real
observation meaning nobody was there, and the pipeline treats the two
differently all the way through to the map.

## Why `--accept-new-data`

The build asserts a set of frozen numbers — the 12-month reconciliation table,
382 blocks per area, the concentration headline. Those are regression
protection: if the *same* inputs stop producing them, something broke.

New data is *supposed* to move them. `--accept-new-data` reports the drift
instead of failing:

```
BASELINE MOVED -- 3 frozen number(s) changed
  top10 = 31.4%, baseline says 29.7%
```

Read that list. It is the fastest summary of what your upload actually did.

## The checks that never relax

These are integrity, not baseline, and they fail regardless of the flag:

- **Shares sum to 1.0** within every area
- **Disaggregation preserves the level** — blocks sum to the published area total
- **No orphans** — every `block_id` exists in both the geometry and the counts
- **Gap months stay null**, never zero
- **No double counting** — no area-month where blocks exceed 1.5× the published total

That last one earns its keep. Testing this pipeline with a synthetic June sweep
copied from January, the build stopped with:

```
Columbia 2025-06: blocks sum 36.2 vs published 21.0 (over 1.5x)
Marina 2025-06: blocks sum 17.0 vs published 11.0 (over 1.5x)
```

Which was correct — June's published totals are lower than January's, so
January's block counts genuinely do not belong to June. **If you see this, your
block counts and the published area total disagree.** One of them is wrong, and
the pipeline will not average over the problem.

## What updates automatically

Everything downstream is derived, so nothing needs hand-editing:

- month axis, slider length and gap months
- which months are "counted in person" versus estimated
- block shares, per-area concentration, the headline stats
- the shelter gap and the **siting model**, which rebases onto whatever the
  newest counted month is

Verified end to end: ingesting a 13th count date moved the observed-month list
from 12 to 13 entries and the siting model rebased from `2025-01` to the new
month without a line of code changing.

## Rolling back

```bash
cp data/raw/_backups/BlockLevel_Counts.csv.<timestamp>.bak data/raw/BlockLevel_Counts.csv
python3 scripts/rebuild_all.py
```

Without `--accept-new-data`, so the frozen numbers are enforced again — which
is how you confirm you are genuinely back where you started.
