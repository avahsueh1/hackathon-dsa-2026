#!/usr/bin/env python3
"""Precompute pipeline for the block-level heat map.

Currently implements HEATMAP_SPEC.md sections 3.1 and 3.2 only:

    Step A  era-aware persons per block-date
    Step B  within-area recency-weighted block share

with acceptance tests 1, 2 and 4 from section 7 as hard assertions. Steps C-E
and the JSON writers are not written yet -- spec section 9 says get the numbers
right before anything renders.

Assertions fail the build. They do not warn.

Standard library only: no pandas, no venv, nothing to install.

    python3 scripts/build_heatmap_data.py
"""

import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")

HALF_LIFE = 3.0          # observations, spec section 3.2
SHARE_EPS = 1e-9         # spec section 3.2 constraint
RECON_TOL = 0.5          # spec section 2.2 / acceptance test 1
N_BLOCKS = 382

# Spec section 2.2: month -> (published, from_blocks, sum_abs_error).
# sum_abs_error is the sum of PER-AREA absolute errors, not the error of the
# totals -- per-area errors partly cancel downtown-wide. 2024-01 is the tell:
# delta 0.0 but abs error 8.6. Asserting only on totals would let a badly
# wrong per-area fit pass.
RECONCILIATION = {
    "2018-01": (804, 804.5, 2.3),
    "2018-02": (862, 854.4, 8.0),
    "2019-01": (898, 891.2, 7.3),
    "2020-01": (789, 786.9, 4.8),
    "2020-02": (744, 743.0, 1.4),
    "2021-01": (715, 702.6, 12.4),
    "2021-02": (668, 671.4, 9.4),
    "2022-01": (1409, 1408.5, 2.5),
    "2022-02": (1445, 1392.5, 52.6),
    "2023-01": (1938, 1955.1, 18.1),
    "2024-01": (1019, 1019.0, 8.6),
    "2025-01": (843, 847.3, 6.8),
}


class AcceptanceError(AssertionError):
    """An acceptance test from spec section 7 failed. The build stops."""


def load_csv(name):
    with open(os.path.join(RAW, name), newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def month_of(value):
    """Normalize a date / report_month cell to YYYY-MM."""
    value = (value or "").strip()
    return value[:7] if len(value) >= 7 else ""


def num(value):
    """Parse a nullable numeric cell.

    Empty stays None and is never coerced to 0. Spec section 1.1: filling the
    one null tents_structures with 0 fabricates an observation.
    """
    value = (value or "").strip()
    if value == "" or value.upper() in ("NA", "NAN", "NULL"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


# ---------------------------------------------------------------- load

def load_inputs():
    monthly = load_csv("DowntownCounts_Monthly.csv")
    blocks = load_csv("BlockLevel_Counts.csv")
    grid = load_csv("Downtown_BlockGrid.csv")
    with open(os.path.join(RAW, "Downtown_BlockGrid.geojson"), encoding="utf-8") as fh:
        geo = json.load(fh)

    # Spec section 2.1: join through the grid CSV, never by string-matching
    # the GeoJSON's `neighborhood` (10 raw values vs 7 canonical areas).
    block_area = {r["block_id"]: r["area"] for r in grid}

    # Level series: spec section 1.1.
    area_total = {}
    for r in monthly:
        if r.get("area_type") == "neighborhood" and r.get("component") == "total":
            c = num(r.get("count"))
            if c is not None:
                area_total[(month_of(r["date"]), r["area"])] = c

    # Multiplier regime per month, inlined per-row in the monthly file.
    # Spec section 0 rule 2: join these, never hardcode a pair.
    mult = {}
    for r in monthly:
        mo = month_of(r.get("date"))
        t, v = num(r.get("tent_multiplier")), num(r.get("vehicle_multiplier"))
        if mo and t is not None and v is not None:
            mult.setdefault(mo, (t, v))

    return monthly, blocks, grid, geo, block_area, area_total, mult


# ---------------------------------------------------------------- step A

def step_a_persons(blocks, block_area, mult):
    """Era-aware persons per block-date (spec section 3.1).

        persons = individuals
                  + tent_multiplier    * tents_structures
                  + vehicle_multiplier * vehicles

    Join on report_month, NOT count_date (spec section 1.1): the sweep dated
    2022-03-01 is the February 2022 count. Nulls propagate as None.
    """
    rows, n_null = [], 0
    for r in blocks:
        mo = month_of(r["report_month"])
        area = block_area.get(r["block_id"])
        if area is None:
            raise AcceptanceError("block_id %r absent from Downtown_BlockGrid.csv" % r["block_id"])
        if mo not in mult:
            raise AcceptanceError("no multiplier regime for report_month %r" % mo)

        tm, vm = mult[mo]
        ind, tents, veh = num(r["individuals"]), num(r["tents_structures"]), num(r["vehicles"])

        if ind is None or tents is None or veh is None:
            persons = None          # propagate NA, never fill with 0
            n_null += 1
        else:
            persons = ind + tm * tents + vm * veh

        rows.append({"block_id": r["block_id"], "area": area, "month": mo,
                     "persons": persons, "tent_mult": tm, "vehicle_mult": vm})

    print("  Step A: %s block-dates, %d with null components (propagated as NA)"
          % (format(len(rows), ","), n_null))
    return rows


# ---------------------------------------------------------------- step B

def step_b_shares(persons_rows):
    """Within-area recency-weighted block share (spec section 3.2).

    Half-life of 3 observations over the 12 observed dates. Share is a ratio
    within an area, so an area observed on fewer dates (Outside Perimeter, 5 of
    12 -- see docs/DEVIATIONS.md D5) normalises correctly over just those dates
    without special-casing: numerator and denominator use the same weights.

    Zero shares are NOT floored to an epsilon. A block never non-zero across 12
    sweeps genuinely reads as zero, and a floor would invent need where none was
    observed (spec section 3.2).
    """
    dates = sorted({r["month"] for r in persons_rows})
    n = len(dates)
    weight = {d: 0.5 ** ((n - 1 - i) / HALF_LIFE) for i, d in enumerate(dates)}

    num_by_block, den_by_area, dates_by_block, area_of = {}, {}, {}, {}
    for r in persons_rows:
        area_of[r["block_id"]] = r["area"]
        dates_by_block.setdefault(r["block_id"], set()).add(r["month"])
        if r["persons"] is None:
            continue                                  # excluded, not zeroed
        wp = r["persons"] * weight[r["month"]]
        num_by_block[r["block_id"]] = num_by_block.get(r["block_id"], 0.0) + wp
        den_by_area[r["area"]] = den_by_area.get(r["area"], 0.0) + wp

    share = {}
    for block_id, area in area_of.items():
        den = den_by_area.get(area, 0.0)
        share[block_id] = (num_by_block.get(block_id, 0.0) / den) if den > 0 else 0.0

    n_zero = sum(1 for v in share.values() if v == 0.0)
    print("  Step B: %d blocks, half-life %.0f obs over %d dates, %d zero shares (not floored)"
          % (len(share), HALF_LIFE, n, n_zero))
    return share, weight, dates, dates_by_block, area_of


# ---------------------------------------------------------------- tests

def test_1_reconciliation(persons_rows, area_total):
    """Acceptance test 1 -- the primary correctness gate (spec section 2.2)."""
    print("\n[test 1] reconciliation, all 12 observed months")
    by_area_month = {}
    for r in persons_rows:
        if r["persons"] is None:
            continue
        key = (r["month"], r["area"])
        by_area_month[key] = by_area_month.get(key, 0.0) + r["persons"]

    problems = []
    print("    %-9s %10s %12s %10s %10s" % ("month", "published", "from blocks", "delta", "abs err"))
    for month in sorted(RECONCILIATION):
        exp_pub, exp_blocks, exp_abs = RECONCILIATION[month]
        areas = {a for (m, a) in area_total if m == month}
        got_pub = sum(area_total[(month, a)] for a in areas)
        got_blocks = sum(by_area_month.get((month, a), 0.0) for a in areas)
        abs_err = sum(abs(by_area_month.get((month, a), 0.0) - area_total[(month, a)]) for a in areas)
        print("    %-9s %10.0f %12.1f %10.1f %10.1f"
              % (month, got_pub, got_blocks, got_blocks - got_pub, abs_err))

        for label, got, want in (("published", got_pub, exp_pub),
                                 ("from-blocks", got_blocks, exp_blocks),
                                 ("abs-error", abs_err, exp_abs)):
            if abs(got - want) > RECON_TOL:
                problems.append("%s %s %.2f, spec says %.1f" % (month, label, got, want))

    if problems:
        raise AcceptanceError("reconciliation failed:\n    " + "\n    ".join(problems))
    print("    PASS -- 12/12 months within +/-%.1f on all three columns" % RECON_TOL)


def test_2_shares_sum_to_one(share, area_of):
    """Acceptance test 2 -- shares sum to 1.0 within every area (spec 3.2)."""
    print("\n[test 2] shares sum to 1.0 per area")
    totals = {}
    for block_id, s in share.items():
        totals[area_of[block_id]] = totals.get(area_of[block_id], 0.0) + s

    problems = []
    for area in sorted(totals):
        total = totals[area]
        n_blocks = sum(1 for b, a in area_of.items() if a == area)
        n_zero = sum(1 for b, a in area_of.items() if a == area and share[b] == 0.0)
        status = "ok" if abs(total - 1.0) <= SHARE_EPS else "FAIL"
        print("    %-18s %.15f  (%3d blocks, %2d zero)  %s" % (area, total, n_blocks, n_zero, status))
        if abs(total - 1.0) > SHARE_EPS:
            problems.append("%s sums to %.15f, off by %.2e" % (area, total, abs(total - 1.0)))

    if len(totals) != 7:
        problems.append("expected 7 areas, got %d: %s" % (len(totals), sorted(totals)))
    if problems:
        raise AcceptanceError("share normalisation failed:\n    " + "\n    ".join(problems))
    print("    PASS -- all 7 areas sum to 1.0 within %.0e" % SHARE_EPS)


def test_4_no_orphans(geo, grid, blocks):
    """Acceptance test 4 -- 382 both ways, 0 orphans (spec section 7)."""
    print("\n[test 4] block_id join integrity")
    geo_ids = {f["properties"]["block_id"] for f in geo["features"]}
    grid_ids = {r["block_id"] for r in grid}
    count_ids = {r["block_id"] for r in blocks}

    problems = []
    for label, ids in (("geojson", geo_ids), ("grid csv", grid_ids), ("block counts", count_ids)):
        print("    %-14s %d ids" % (label, len(ids)))
        if len(ids) != N_BLOCKS:
            problems.append("%s has %d ids, expected %d" % (label, len(ids), N_BLOCKS))
    for label, ids in (("grid csv", grid_ids), ("block counts", count_ids)):
        only_geo, only_other = geo_ids - ids, ids - geo_ids
        if only_geo or only_other:
            problems.append("geojson vs %s: %d/%d orphans (e.g. %s)"
                            % (label, len(only_geo), len(only_other),
                               sorted(only_geo | only_other)[:3]))

    if problems:
        raise AcceptanceError("join integrity failed:\n    " + "\n    ".join(problems))
    print("    PASS -- %d ids in all three sources, 0 orphans" % N_BLOCKS)


# ---------------------------------------------------------------- report

def report(share, area_of, dates_by_block, weight, dates):
    """Cross-checks against spec section 2.4. Informational, not assertions."""
    print("\n[report] concentration cross-check vs spec section 2.4")
    ranked = sorted(share.items(), key=lambda kv: -kv[1])

    # Section 2.4's headline figures are computed over the 261-block panel, so
    # downtown-wide shares here are area-normalised and not directly comparable.
    # Reported for shape, not as an assertion.
    top = ranked[0]
    print("    highest within-area share : %s (%s) %.1f%%"
          % (top[0], area_of[top[0]], 100 * top[1]))

    print("\n    top 3 by within-area share (spec section 2.4 table):")
    for area in sorted({a for a in area_of.values()}):
        in_area = sorted(((b, s) for b, s in share.items() if area_of[b] == area),
                         key=lambda kv: -kv[1])[:3]
        cells = "  ".join("%s (%.1f%%)" % (b, 100 * s) for b, s in in_area)
        print("      %-18s %s" % (area, cells))

    print("\n    observation coverage (drives cv bucketing in Step E):")
    buckets = {}
    for block_id, ds in dates_by_block.items():
        buckets.setdefault(len(ds), []).append(block_id)
    for n_obs in sorted(buckets):
        areas = sorted({area_of[b] for b in buckets[n_obs]})
        flag = "  <- auto high-uncertainty (spec 3.5, <6 obs)" if n_obs < 6 else ""
        print("      %2d dates: %3d blocks  %s%s" % (n_obs, len(buckets[n_obs]), ", ".join(areas), flag))

    print("\n    recency weights (half-life %.0f observations):" % HALF_LIFE)
    print("      " + "  ".join("%s=%.3f" % (d, weight[d]) for d in dates[-4:]))


def main():
    print("build_heatmap_data.py -- spec sections 3.1-3.2 (Steps A-B)")
    print("reading %s\n" % RAW)

    monthly, blocks, grid, geo, block_area, area_total, mult = load_inputs()
    print("  loaded: %s monthly rows, %s block-dates, %d grid rows, %d features"
          % (format(len(monthly), ","), format(len(blocks), ","), len(grid), len(geo["features"])))

    persons_rows = step_a_persons(blocks, block_area, mult)
    share, weight, dates, dates_by_block, area_of = step_b_shares(persons_rows)

    try:
        test_4_no_orphans(geo, grid, blocks)
        test_1_reconciliation(persons_rows, area_total)
        test_2_shares_sum_to_one(share, area_of)
    except AcceptanceError as exc:
        print("\n" + "=" * 62)
        print("BUILD FAILED -- %s" % exc)
        print("The section 2.2 reconciliation is proven to hold against these")
        print("files. A regression here is a bug in this script, not the data.")
        print("=" * 62)
        return 1

    report(share, area_of, dates_by_block, weight, dates)

    print("\n" + "=" * 62)
    print("Steps A-B complete. Acceptance tests 1, 2, 4 pass.")
    print("Steps C-E and the JSON writers are not implemented yet.")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    sys.exit(main())
