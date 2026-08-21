#!/usr/bin/env python3
"""Precompute the block-level heat map data into data/out/*.json.

Implements Steps A-E of HEATMAP_SPEC.md section 3:

  A  era-aware persons per block-date
  B  within-area block share, recency-weighted (half-life 3 observations)
  C  disaggregate every month: area_total * share
  D  observed override on the counted months
  E  coefficient-of-variation buckets

Acceptance tests 1-7 (spec section 7) plus test 8 (the handoff section 7
concentration headline) run at the end and FAIL the build.
Nothing here is a warning: a wrong number that ships is worse than no build.

Standard library only, same rule as check_data.py: no pandas, nothing to
install. The heavy lifting is groupby-sums and a weighted mean, which is a
dict and a loop.

    python3 scripts/build_heatmap_data.py
"""

import csv
import json
import math
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "out")

HALF_LIFE = 3.0          # spec section 3.2, in observations not months
COORD_DP = 6             # spec section 4.1, ~11 cm -- lossless at this scale
VALUE_DP = 2

# Spec section 2.2. month -> (published, from_blocks). Regression targets.
RECONCILIATION = {
    "2018-01": (804, 804.5), "2018-02": (862, 854.4), "2019-01": (898, 891.2),
    "2020-01": (789, 786.9), "2020-02": (744, 743.0), "2021-01": (715, 702.6),
    "2021-02": (668, 671.4), "2022-01": (1409, 1408.5), "2022-02": (1445, 1392.5),
    "2023-01": (1938, 1955.1), "2024-01": (1019, 1019.0), "2025-01": (843, 847.3),
}
# Spec section 2.1 -- blocks per canonical area, after the join.
EXPECTED_AREA_BLOCKS = {
    "City Center": 50, "Columbia": 22, "Cortez": 42, "Gaslamp": 17,
    "Marina": 27, "East Village": 103, "Outside Perimeter": 121,
}
GAP_MONTHS = {"2025-07", "2025-08", "2025-10", "2025-11"}

# HANDOFF.md section 7, "the one number to protect". Asserted as test 8 rather
# than left as prose.
#
# These reproduce only on an EQUAL-weighted mean of each date's downtown share,
# not on the recency-weighted share of spec section 3.2 -- section 2.4 quotes
# two different estimators side by side. The per-area top-3 table in the same
# section IS recency-weighted and matches Step B exactly (all 18 rows, <=0.1pp),
# which is what pins the disaggregation weight. So both numbers are right about
# different things; neither pipeline half is wrong. Recency-weighting the same
# panel gives 33.2 / 51.8 / 70.2 -- concentration has intensified in recent
# counts, which strengthens the claim rather than contradicting it.
CONCENTRATION_TARGET = {"top10": 29.7, "top25": 47.7, "top50": 66.2}
TOP_BLOCK_TARGET = ("17TH_ST_K_ST", 8.1)
CONCENTRATION_TOL = 0.2

failures = []


def fail(msg):
    failures.append(msg)
    print("  FAIL  " + msg)


def ok(msg):
    print("  ok    " + msg)


def note(msg):
    print("  note  " + msg)


def read_csv(name):
    with open(os.path.join(RAW, name), newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def num(s):
    """CSV cell -> float or None. Empty, NA and NaN all mean 'not counted'."""
    if s is None:
        return None
    s = s.strip()
    if s == "" or s.upper() in ("NA", "NAN", "NULL", "NONE"):
        return None
    return float(s)


def ym(date_str):
    """A '2025-01-01' date string down to its month. The month is the identity."""
    return date_str.strip()[:7]


# ---------------------------------------------------------------- load

print("loading " + RAW)

monthly = read_csv("DowntownCounts_Monthly.csv")
blocks_raw = read_csv("BlockLevel_Counts.csv")
grid = read_csv("Downtown_BlockGrid.csv")
with open(os.path.join(RAW, "Downtown_BlockGrid.geojson"), encoding="utf-8") as fh:
    geojson = json.load(fh)

# The join table, NOT the geojson's `neighborhood` (spec section 2.1, landmine 3).
# grid.csv carries the 7 canonical areas; the geojson carries 10 raw labels, and
# joining on those silently drops the 121 Outside Perimeter blocks.
block_area = {r["block_id"]: r["area"] for r in grid}
block_hood = {r["block_id"]: r["neighborhood_source"] for r in grid}
block_streets = {
    r["block_id"]: {"n": r["st_north"], "e": r["st_east"],
                    "s": r["st_south"], "w": r["st_west"]}
    for r in grid
}
block_centroid = {r["block_id"]: (float(r["lon"]), float(r["lat"])) for r in grid}

# The level series: area_type == neighborhood AND component == total.
# Nothing else in the monthly file belongs in this layer -- mixing `total` with
# the components is landmine 1 and roughly doubles the population.
level_rows = [r for r in monthly
              if r["area_type"] == "neighborhood" and r["component"] == "total"]

months = sorted({ym(r["date"]) for r in level_rows})
areas = sorted({r["area"] for r in level_rows})
month_idx = {m: i for i, m in enumerate(months)}

area_totals = {a: [None] * len(months) for a in areas}
for r in level_rows:
    area_totals[r["area"]][month_idx[ym(r["date"])]] = num(r["count"])

# Era multipliers, joined per-row from the data (landmine 2): a tent is 2.00
# persons before Apr-2017 and 1.75 after, a vehicle goes 2.00 -> 1.66 -> 2.03.
tent_mult, veh_mult = {}, {}
for r in monthly:
    m = ym(r["date"])
    t, v = num(r["tent_multiplier"]), num(r["vehicle_multiplier"])
    if t is not None:
        tent_mult[m] = t
    if v is not None:
        veh_mult[m] = v

print("  %d months (%s -> %s), %d areas, %d blocks"
      % (len(months), months[0], months[-1], len(areas), len(grid)))

# The spec (section 0) says 102 months; the delivered data carries more.
# Working agreement: the data wins, but say so out loud rather than silently.
if len(months) != 102:
    note("spec section 0 says 102 months; data has %d (%s -> %s). Using the data."
         % (len(months), months[0], months[-1]))


# ------------------------------------------- Step A: persons per block-date

# persons = individuals + tentM*tents + vehM*vehicles, multipliers by era.
# The one null tents_structures row (16TH_ST_C_ST, 2020-01) stays NA rather
# than becoming 0 -- filling it would fabricate an observation.
persons = {}                       # (block_id, month) -> float
obs_dates = sorted({ym(r["report_month"]) for r in blocks_raw})
skipped_na = 0

for r in blocks_raw:
    bid, m = r["block_id"], ym(r["report_month"])
    ind = num(r["individuals"])
    tents = num(r["tents_structures"])
    veh = num(r["vehicles"])
    if ind is None or tents is None or veh is None:
        skipped_na += 1
        continue
    persons[(bid, m)] = ind + tent_mult[m] * tents + veh_mult[m] * veh

print("\n[A] persons per block-date")
print("  %d block-date observations across %d dates" % (len(persons), len(obs_dates)))
if skipped_na:
    note("%d block-date row(s) held as NA for null components (spec section 1.1)"
         % skipped_na)

# Which dates does each block actually appear on? Drives n_observations and,
# for Outside Perimeter, the whole share basis.
block_obs_dates = defaultdict(list)
for (bid, m) in persons:
    block_obs_dates[bid].append(m)
for bid in block_obs_dates:
    block_obs_dates[bid].sort()

by_area_dates = defaultdict(set)
for bid, ds in block_obs_dates.items():
    by_area_dates[block_area[bid]].update(ds)
for a in sorted(by_area_dates):
    n = len(by_area_dates[a])
    if n < len(obs_dates):
        note("%s observed on %d of %d block-level dates (%s onward)"
             % (a, n, len(obs_dates), min(by_area_dates[a])))


# --------------------------------------- Step B: recency-weighted shares

# Half-life of 3 observations over the date axis. An area observed on a subset
# of dates (Outside Perimeter) simply weights the dates it has -- the relative
# recency ordering is preserved and the share still normalises to 1.
weight = {d: 0.5 ** ((len(obs_dates) - 1 - i) / HALF_LIFE)
          for i, d in enumerate(obs_dates)}

wp_block = defaultdict(float)      # block -> recency-weighted persons
wp_area = defaultdict(float)       # area  -> recency-weighted persons
for (bid, m), p in persons.items():
    w = weight[m] * p
    wp_block[bid] += w
    wp_area[block_area[bid]] += w

block_ids = sorted(block_area)     # stable order -- the Layer 3 contract
bid_idx = {b: i for i, b in enumerate(block_ids)}

share_within_area = {}
for bid in block_ids:
    den = wp_area[block_area[bid]]
    share_within_area[bid] = (wp_block[bid] / den) if den else 0.0

print("\n[B] within-area shares, half-life %.0f observations" % HALF_LIFE)
zero_share = [b for b in block_ids if share_within_area[b] == 0.0]
print("  %d blocks with share exactly 0 -- kept at 0, not floored (spec section 3.2)"
      % len(zero_share))

# Downtown-wide share, on the balanced-panel basis so it reproduces the
# section 2.4 headline (17TH_ST_K_ST = 8.1% of downtown). Blocks outside the
# panel are measured against the same denominator, so the full 382 sum runs
# slightly over 1 -- reported below rather than hidden.
panel_ids = {r["block_id"] for r in read_csv("BlockLevel_Counts_Panel261.csv")}
panel_wp_total = sum(wp_block[b] for b in block_ids if b in panel_ids)
share_downtown = {b: (wp_block[b] / panel_wp_total if panel_wp_total else 0.0)
                  for b in block_ids}
print("  downtown share basis: %d-block panel; all 382 blocks sum to %.3f"
      % (len(panel_ids), sum(share_downtown.values())))

# Second, EQUAL-weighted downtown share: each counted date contributes its own
# share once, then average across dates. This is a different estimator from the
# recency-weighted one above, and it is the basis behind the section 2.4
# concentration headline -- see the note on CONCENTRATION_TARGET below. Kept
# separate rather than reconciled, because the two answer different questions:
# recency-weighted = "where is need now", equal-weighted = "where has it been".
downtown_by_date = defaultdict(float)
for (bid, m), p in persons.items():
    if bid in panel_ids:
        downtown_by_date[m] += p
share_equal = defaultdict(float)
for (bid, m), p in persons.items():
    if bid in panel_ids and downtown_by_date[m]:
        share_equal[bid] += (p / downtown_by_date[m]) / len(obs_dates)
share_equal = {b: share_equal.get(b, 0.0) for b in block_ids}


# -------------------------------- Step C + D: disaggregate, then override

# estimate[block, month] = area_total[area(block), month] * share_within_area[block]
# For the counted months the observed persons REPLACE the estimate outright.
# No blending: "is this real data or your model?" needs a crisp per-cell answer.
n_m, n_b = len(months), len(block_ids)
values = [[None] * n_b for _ in range(n_m)]
estimates = [[None] * n_b for _ in range(n_m)]   # pre-override, for test 3
is_observed = [[False] * n_b for _ in range(n_m)]

for bi, bid in enumerate(block_ids):
    sh = share_within_area[bid]
    totals = area_totals[block_area[bid]]
    for mi in range(n_m):
        t = totals[mi]
        if t is None:
            continue                      # missing stays missing, never 0
        estimates[mi][bi] = t * sh
        values[mi][bi] = t * sh

for (bid, m), p in persons.items():
    if m not in month_idx:
        continue
    mi, bi = month_idx[m], bid_idx[bid]
    values[mi][bi] = p
    is_observed[mi][bi] = True

observed_months = [m for m in obs_dates if m in month_idx]

n_obs_cells = sum(sum(1 for x in row if x) for row in is_observed)
n_null_cells = sum(sum(1 for x in row if x is None) for row in values)
print("\n[C/D] disaggregation + observed override")
print("  %d months x %d blocks = %d cells" % (n_m, n_b, n_m * n_b))
print("  %d observed, %d estimated, %d null"
      % (n_obs_cells, n_m * n_b - n_obs_cells - n_null_cells, n_null_cells))

missing_months = [m for i, m in enumerate(months)
                  if all(v is None for v in values[i])]
print("  missing months (null, NOT zero): " + ", ".join(missing_months))


# ----------------------------------------------------- Step E: cv buckets

# share_by_date = persons / published area total that date; cv = std / mean.
# Blocks seen on fewer than 6 dates are forced high regardless of their spread:
# a stable-looking share from 5 observations is not evidence of stability.
cv_bucket, cv_value, n_obs = {}, {}, {}
for bid in block_ids:
    ds = block_obs_dates.get(bid, [])
    n_obs[bid] = len(ds)
    ratios = []
    for d in ds:
        t = area_totals[block_area[bid]][month_idx[d]] if d in month_idx else None
        if t:
            ratios.append(persons[(bid, d)] / t)
    if len(ratios) > 1:
        mean = sum(ratios) / len(ratios)
        var = sum((x - mean) ** 2 for x in ratios) / (len(ratios) - 1)
        cv = (math.sqrt(var) / mean) if mean > 0 else 0.0
    else:
        cv = 0.0
    cv_value[bid] = cv
    if len(ds) < 6:
        cv_bucket[bid] = "high"
    elif cv < 0.5:
        cv_bucket[bid] = "low"
    elif cv <= 1.0:
        cv_bucket[bid] = "medium"
    else:
        cv_bucket[bid] = "high"

print("\n[E] uncertainty buckets")
for b in ("low", "medium", "high"):
    print("  %-7s %d blocks" % (b, sum(1 for x in cv_bucket.values() if x == b)))


# ------------------------------------------------------ acceptance tests

print("\n" + "=" * 62)
print("acceptance tests (spec section 7)")
print("=" * 62)

print("\n[1] reconciliation vs spec section 2.2")
for m in sorted(RECONCILIATION):
    pub, expect = RECONCILIATION[m]
    got = sum(p for (b, d), p in persons.items() if d == m)
    if abs(got - expect) > 0.5:
        fail("%s: blocks sum %.1f, spec says %.1f" % (m, got, expect))
    else:
        ok("%s  published %-5d blocks %8.1f  (spec %.1f)" % (m, pub, got, expect))

print("\n[2] shares sum to 1.0 within every area")
for a in sorted(EXPECTED_AREA_BLOCKS):
    n = sum(1 for b in block_ids if block_area[b] == a)
    s = sum(share_within_area[b] for b in block_ids if block_area[b] == a)
    if abs(s - 1.0) > 1e-9:
        fail("%s shares sum to %.12f" % (a, s))
    else:
        ok("%-18s sum %.12f  (%d blocks)" % (a, s, n))

print("\n[3] disaggregation preserves the level")
worst, worst_at = 0.0, None
for a in areas:
    idxs = [bid_idx[b] for b in block_ids if block_area[b] == a]
    for mi in range(n_m):
        t = area_totals[a][mi]
        if t is None:
            continue
        s = sum(estimates[mi][i] for i in idxs)
        if abs(s - t) > worst:
            worst, worst_at = abs(s - t), (a, months[mi])
if worst > 0.01:
    fail("worst level drift %.6f at %s %s" % (worst, worst_at[0], worst_at[1]))
else:
    ok("worst drift over all area-months: %.2e" % worst)

print("\n[4] no orphan block_ids")
gj_ids = {f["properties"]["block_id"] for f in geojson["features"]}
count_ids = {b for (b, _) in persons}
for label, s in (("geojson", gj_ids), ("grid csv", set(block_area)),
                 ("counts", count_ids)):
    if len(s) != 382:
        fail("%s has %d block_ids, expected 382" % (label, len(s)))
if gj_ids != set(block_area) or gj_ids != count_ids:
    fail("block_id sets disagree across geojson / grid / counts")
else:
    ok("382 ids in geojson, grid and counts; 0 orphans either way")
area_mismatch = False
for a, n in sorted(EXPECTED_AREA_BLOCKS.items()):
    got = sum(1 for b in block_ids if block_area[b] == a)
    if got != n:
        fail("%s has %d blocks, spec section 2.1 says %d" % (a, got, n))
        area_mismatch = True
if not area_mismatch:
    ok("area block counts match spec section 2.1")

print("\n[5] geometry integrity")
bbox = [180.0, 90.0, -180.0, -90.0]
vertices, unclosed = 0, 0
for f in geojson["features"]:
    for ring in f["geometry"]["coordinates"]:
        if ring[0] != ring[-1]:
            unclosed += 1
        vertices += len(ring)
        for lon, lat in ring:
            bbox[0], bbox[1] = min(bbox[0], lon), min(bbox[1], lat)
            bbox[2], bbox[3] = max(bbox[2], lon), max(bbox[3], lat)
if unclosed:
    fail("%d unclosed rings" % unclosed)
else:
    ok("382 features, %d vertices, 0 unclosed rings" % vertices)
ok("bbox [%.8f, %.8f, %.8f, %.8f]" % tuple(bbox))

print("\n[6] the 2025 reporting gap stays null")
for m in sorted(GAP_MONTHS):
    if m not in month_idx:
        fail("%s absent from the month axis" % m)
    elif any(v is not None for v in values[month_idx[m]]):
        fail("%s emitted a number; it must be null" % m)
    else:
        ok("%s  all %d blocks null" % (m, n_b))
if set(missing_months) != GAP_MONTHS:
    fail("missing_months is %s, expected the 4 gap months" % missing_months)

print("\n[7] no double counting")
bad = 0
for a in areas:
    idxs = [bid_idx[b] for b in block_ids if block_area[b] == a]
    for mi in range(n_m):
        t = area_totals[a][mi]
        if not t:
            continue
        s = sum(v for v in (values[mi][i] for i in idxs) if v is not None)
        if s > 1.5 * t:
            bad += 1
            fail("%s %s: blocks sum %.1f vs published %.1f (over 1.5x)"
                 % (a, months[mi], s, t))
if not bad:
    ok("no area-month exceeds 1.5x its published total")

print("\n[8] concentration headline (HANDOFF section 7)")
_eq_ranked = sorted((b for b in block_ids if b in panel_ids),
                    key=lambda b: share_equal[b], reverse=True)


def _eq_cum(n):
    return 100.0 * sum(share_equal[b] for b in _eq_ranked[:n])


for label, target in sorted(CONCENTRATION_TARGET.items()):
    got = _eq_cum(int(label[3:]))
    if abs(got - target) > CONCENTRATION_TOL:
        fail("%s = %.1f%%, handoff section 7 says %.1f%%" % (label, got, target))
    else:
        ok("%-6s %5.1f%%  (handoff %.1f%%)" % (label, got, target))
_tb, _tpct = TOP_BLOCK_TARGET
_got_pct = 100.0 * share_equal[_eq_ranked[0]]
if _eq_ranked[0] != _tb or abs(_got_pct - _tpct) > CONCENTRATION_TOL:
    fail("top block is %s at %.1f%%, handoff section 7 says %s at %.1f%%"
         % (_eq_ranked[0], _got_pct, _tb, _tpct))
else:
    ok("%-6s %5.1f%%  (handoff %.1f%%)" % (_tb, _got_pct, _tpct))

if failures:
    print("\n" + "=" * 62)
    print("BUILD FAILED -- %d assertion(s)" % len(failures))
    for f in failures:
        print("  " + f)
    print("=" * 62)
    sys.exit(1)


# -------------------------------------------------------------- insights

def rounded(x, dp=VALUE_DP):
    return None if x is None else round(x, dp)


ranked = sorted(block_ids, key=lambda b: share_downtown[b], reverse=True)
panel_ranked = [b for b in ranked if b in panel_ids]


def cum(n):
    return sum(share_downtown[b] for b in panel_ranked[:n])


top_by_area = {}
for a in areas:
    ba = sorted((b for b in block_ids if block_area[b] == a),
                key=lambda b: share_within_area[b], reverse=True)[:3]
    top_by_area[a] = [{"block_id": b,
                       "share_within_area": round(share_within_area[b], 4)}
                      for b in ba]

# Biggest month-over-month movers, on the latest two months that carry a count.
last_mi = max(i for i in range(n_m) if any(v is not None for v in values[i]))
prev_mi = max(i for i in range(last_mi) if any(v is not None for v in values[i]))
movers = []
for bi, bid in enumerate(block_ids):
    a, b = values[prev_mi][bi], values[last_mi][bi]
    if a is None or b is None:
        continue
    movers.append({"block_id": bid, "area": block_area[bid],
                   "from": rounded(a), "to": rounded(b), "delta": rounded(b - a)})
movers.sort(key=lambda r: abs(r["delta"]), reverse=True)

downtown_series = []
for mi in range(n_m):
    vals = [v for v in values[mi] if v is not None]
    downtown_series.append(rounded(sum(vals)) if vals else None)

insights = {
    "generated_from": "data/raw, %s -> %s" % (months[0], months[-1]),
    # Headline on the equal-weighted basis, which is what section 2.4 quotes.
    # The recency-weighted variant sits alongside it rather than replacing it:
    # the gap between them IS the finding (concentration is rising).
    "concentration": {
        "basis": "equal-weighted mean of each counted date's downtown share, "
                 "over the %d-block balanced panel (spec section 2.4, "
                 "handoff section 7)" % len(panel_ids),
        "top10_pct": round(_eq_cum(10), 1),
        "top25_pct": round(_eq_cum(25), 1),
        "top50_pct": round(_eq_cum(50), 1),
        "top_block": {
            "block_id": _eq_ranked[0],
            "area": block_area[_eq_ranked[0]],
            "pct_of_downtown": round(100.0 * share_equal[_eq_ranked[0]], 1),
        },
        "recency_weighted": {
            "basis": "recency-weighted shares (spec section 3.2), the same "
                     "weights that drive the map",
            "top10_pct": round(cum(10) * 100, 1),
            "top25_pct": round(cum(25) * 100, 1),
            "top50_pct": round(cum(50) * 100, 1),
            "top_block_pct": round(share_downtown[panel_ranked[0]] * 100, 1),
            "reading": "Concentration is higher on recent counts than on the "
                       "all-dates average: the hot blocks have got hotter.",
        },
    },
    "top_blocks_downtown": [
        {"block_id": b, "area": block_area[b],
         "pct_of_downtown": round(share_downtown[b] * 100, 2),
         "share_within_area": round(share_within_area[b], 4)}
        for b in ranked[:25]
    ],
    "top_blocks_by_area": top_by_area,
    "biggest_movers": {
        "from_month": months[prev_mi], "to_month": months[last_mi],
        "blocks": movers[:10],
    },
    "downtown_series": {"months": months, "total": downtown_series},
    "share_confidence": {
        "low": ["Outside Perimeter"],
        "reason": "Outside Perimeter blocks are counted on only %d of %d "
                  "block-level dates, and its published monthly total is the "
                  "most volatile in the dataset."
                  % (len(by_area_dates["Outside Perimeter"]), len(obs_dates)),
    },
}

# ----------------------------------------------------------------- write

os.makedirs(OUT, exist_ok=True)

geom_by_id = {f["properties"]["block_id"]: f["geometry"]["coordinates"]
              for f in geojson["features"]}
geometry = {
    "bbox": [round(v, 8) for v in bbox],
    "blocks": [
        {
            "id": b,
            "area": block_area[b],
            "neighborhood_source": block_hood[b],
            "streets": block_streets[b],
            "centroid": [round(block_centroid[b][0], COORD_DP),
                         round(block_centroid[b][1], COORD_DP)],
            "rings": [[[round(x, COORD_DP), round(y, COORD_DP)] for x, y in ring]
                      for ring in geom_by_id[b]],
        }
        for b in block_ids
    ],
}

values_out = {
    "months": months,
    "block_ids": block_ids,
    "observed_months": observed_months,
    "missing_months": missing_months,
    "values": [[rounded(v) for v in row] for row in values],
    "is_observed": is_observed,
    "share": [round(share_downtown[b], 6) for b in block_ids],
    "share_equal_weight": [round(share_equal[b], 6) for b in block_ids],
    "share_within_area": [round(share_within_area[b], 6) for b in block_ids],
    "cv": [round(cv_value[b], 4) for b in block_ids],
    "cv_bucket": [cv_bucket[b] for b in block_ids],
    "n_observations": [n_obs[b] for b in block_ids],
    "area_totals": {a: [rounded(v) for v in area_totals[a]] for a in areas},
    "area_share_confidence": {
        a: ("low" if len(by_area_dates[a]) < len(obs_dates) else "medium")
        for a in areas
    },
}

print()
for name, payload in (("geometry.json", geometry),
                      ("values.json", values_out),
                      ("insights.json", insights)):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), allow_nan=False)
    print("  wrote data/out/%-15s %8.1f KB" % (name, os.path.getsize(path) / 1024))

print("\n" + "=" * 62)
print("BUILD OK -- all 8 acceptance tests passed")
print("  top 10 blocks = %.1f%% of downtown" % insights["concentration"]["top10_pct"])
print("  top 25 blocks = %.1f%%" % insights["concentration"]["top25_pct"])
print("  top 50 blocks = %.1f%%" % insights["concentration"]["top50_pct"])
print("  %s alone = %.1f%%" % (insights["concentration"]["top_block"]["block_id"],
                               insights["concentration"]["top_block"]["pct_of_downtown"]))
print("=" * 62)
