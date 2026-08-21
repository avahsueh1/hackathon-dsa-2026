# StreetShift SD

StreetShift SD is a focused policy-period evidence map for Downtown San Diego.
It compares the same 261 blocks on the organizer-labeled count dates **January
31, 2023** and **January 25, 2024**, places the two 2023 Safe Sleeping sites on
the map, and overlays privacy-reduced clusters of police-recorded Unsafe
Camping Ordinance offenses.

The product answers one question: **where did observed street conditions change
across the 2023 rollout window, and what can the available evidence actually
support?** It does not include the earlier integrity dashboard or forecast.

## What the demo shows

- A real 261-block difference map. Switch among weighted observed change,
  individual marks, tent/structure marks, and vehicle marks.
- Exact fieldwork dates from `count_date`, distinct from the normalized monthly
  `report_month` label.
- Clickable block evidence with raw before, after, and change values.
- Official locations, opening dates, and initial capacities for 20th & B and O
  Lot Safe Sleeping sites. Both are explicitly marked outside the fixed panel.
- Six rounded NIBRS clusters representing seven police-recorded SDMC §63.0404
  offense records within 500 m of the study area during the comparison window.
- A five-event timeline: the before count, both site openings, ordinance
  enforcement beginning July 31, 2023, and the after count.
- A clear evidence boundary: the map cannot track people, isolate a causal
  policy effect, or identify cleanup/abatement locations.

## Main result

The Clean & Safe people-equivalent reconstruction falls from **1,314.49 to
981.80**, or **−25.31%**. That headline needs decomposition:

- recorded individuals: 425 → 510 (**+20.0%**)
- tent/structure marks: 470 → 258 (**−45.1%**)
- vehicle marks: 33 → 10 (**−69.7%**)

The weighted decline was therefore driven by fewer tent/structure and vehicle
marks while direct individual marks increased. It should not be presented as
“homelessness fell 25%.” East Village accounts for 85.2% of the net weighted
decline; Cortez moves in the opposite direction.

## Map definitions

Every block color is:

```text
January 25, 2024 observation − January 31, 2023 observation
```

The weighted layer uses the organizer's POST2020 / Clean & Safe formula:

```text
individuals + 1.75 × tents / structures + 2.03 × vehicles
```

It is a **difference map**, not a movement map. The observations are two
single-night snapshots 359 days apart, and the data contains no identities or
person-to-person linkage.

## Ordinance-record layer

The derived file at `data/derived/ordinance_offense_clusters.json` comes from
the City's 2023 and 2024 Police NIBRS offense CSVs. The filter is:

```text
code_section starts with 63.0404
AND occured_on is 2023-07-31 through 2024-01-25 inclusive
```

There are 29 qualifying offense records citywide; seven lie within 500 meters
of the organizer's panel and become six clusters after coordinates are rounded
to three decimals. Case identifiers and hundred-block addresses are omitted.

These points are **not raids, removals, citations, arrests, outreach contacts,
or one person per dot**. They are ordinance offenses in SDPD case reports. The
City publishes no downloadable event-level cleanup/abatement log, so the demo
does not invent one. Get It Done locations are resident reports and are also not
relabeled as enforcement.

## Run locally

```bash
./scripts/setup.sh   # first run only; requires Python 3 and pnpm
./scripts/dev.sh
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The focused API contract
is `GET /api/policy-map`; API documentation is at
[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

Inside the team repository, the backend reuses the organizer files in the
shared root `data/raw/` directory. For a standalone copy, place
`BlockLevel_Counts_Panel261.csv` and `Downtown_BlockGrid.geojson` under
`data/organizer/` inside this folder.

## Verify

```bash
PYTHONPATH=. .venv/bin/pytest -q
cd web
pnpm run build
pnpm run lint
```

## Sources

- [Organizer block digitization repository](https://github.com/sandiegodata-projects/downtown-partnership)
- [San Diego Police NIBRS offenses](https://data.sandiego.gov/datasets/police-nibrs/)
- [Unsafe Camping Ordinance timeline](https://www.sandiego.gov/police/services/neighborhood-policing-division/unsafe-camping)
- [20th & B Safe Sleeping opening](https://www.sandiego.gov/outreach2-article/mayor-gloria-announces-opening-first-safe-sleeping-site-san-diegans-experiencing)
- [O Lot Safe Sleeping opening](https://www.sandiego.gov/mayor/mayor-gloria-opens-second-safe-sleeping-site-unsheltered-san-diegans)
- [City Auditor 2026 performance audit](https://www.sandiego.gov/sites/default/files/2026-04/performance-audit-of-the-city-s-response-to-homeless-encampments-since-the-unsafe-camping-ordinance.pdf)
- [Get It Done reporting caveats](https://data.sandiego.gov/help/articles/tips-getitdone-311-requests/)

The Auditor could not determine specific geographic movement and found that
Downtown Get It Done encampment reports rose 45% in the two years after the
ordinance versus the two years before. That counterpoint is displayed in the
product so fewer weighted street observations are not mistaken for a proven
reduction in need.
