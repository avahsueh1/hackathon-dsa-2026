#!/usr/bin/env python3
"""Sanity checks for the raw data bundle in data/raw/.

Run this before touching the pipeline. It answers three questions:

  1. Did we actually get the files, or did we get HTML pretending to be CSV?
  2. Do the row counts match HEATMAP_SPEC.md section 1?
  3. Does the persons formula reconcile to the published area totals
     (spec section 2.2 -- acceptance test #1)?

Standard library only, deliberately: no pandas, no venv, nothing to install.
Exits non-zero on any failure so it can gate a build.

    python3 scripts/check_data.py
"""

import csv
import json
import os
import sys

RAW = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw")

# Spec section 1. 2025_HIC.csv has no published row count and is Layer 3
# territory (spec section 10), so it is checked for existence only.
EXPECTED_ROWS = {
    "DowntownCounts_Monthly.csv": 2880,
    "BlockLevel_Counts.csv": 3737,
    "BlockLevel_Counts_Panel261.csv": 3132,
    "Downtown_BlockGrid.csv": 382,
    "Area_Crosswalk.csv": 24,
    "Methodology_Periods.csv": 4,
}
EXPECTED_FEATURES = 382
OPTIONAL = {"2025_HIC.csv"}

# Spec section 2.2. month -> (published, from_blocks, sum_abs_error).
# NOTE: sum_abs_error is the sum of per-area absolute errors, not the error
# of the totals -- per-area errors partly cancel when summed downtown-wide.
# Compare 2024-01: published 1019, blocks 1019.0 (delta 0.0) but abs err 8.6.
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
TOLERANCE = 0.5

# Spec section 5.1 -- the DSDP reporting gap. Must stay null, never zero.
KNOWN_GAP_MONTHS = ["2025-07", "2025-08", "2025-10", "2025-11"]

failures = []
notes = []


def fail(msg):
    failures.append(msg)
    print("  FAIL  " + msg)


def ok(msg):
    print("  ok    " + msg)


def note(msg):
    notes.append(msg)
    print("  note  " + msg)


def looks_like_html(path):
    """Drive serves a sign-in page or a virus-scan interstitial that saves
    happily as .csv. Catch it here rather than three steps into a parse."""
    with open(path, "rb") as fh:
        head = fh.read(1024).lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html") or b"<title>" in head[:512]


def month_of(value):
    """Normalize a date or report_month cell to YYYY-MM."""
    value = (value or "").strip()
    return value[:7] if len(value) >= 7 else ""


def load_csv(name):
    with open(os.path.join(RAW, name), newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def num(value):
    """Parse a nullable numeric cell. Empty stays None -- never coerced to 0."""
    value = (value or "").strip()
    if value == "" or value.upper() in ("NA", "NAN", "NULL"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def check_presence():
    print("\n[1] files present and not HTML")
    missing = []
    for name in list(EXPECTED_ROWS) + sorted(OPTIONAL) + ["Downtown_BlockGrid.geojson"]:
        path = os.path.join(RAW, name)
        if not os.path.exists(path):
            missing.append(name)
            fail("%s is absent" % name)
            continue
        size = os.path.getsize(path)
        if size == 0:
            fail("%s is empty (0 bytes)" % name)
        elif looks_like_html(path):
            fail("%s is HTML, not data (%d bytes) -- Drive auth page?" % (name, size))
        else:
            ok("%s (%s bytes)" % (name, format(size, ",")))
    return not missing


def check_row_counts():
    print("\n[2] row counts vs spec section 1")
    for name, expected in sorted(EXPECTED_ROWS.items()):
        try:
            actual = len(load_csv(name))
        except Exception as exc:
            fail("%s could not be parsed: %s" % (name, exc))
            continue
        if actual == expected:
            ok("%-34s %s rows" % (name, format(actual, ",")))
        else:
            fail("%-34s %s rows, expected %s (delta %+d)"
                 % (name, format(actual, ","), format(expected, ","), actual - expected))

    print("\n[3] geojson feature count")
    try:
        with open(os.path.join(RAW, "Downtown_BlockGrid.geojson"), encoding="utf-8") as fh:
            gj = json.load(fh)
        feats = gj.get("features", [])
        if len(feats) == EXPECTED_FEATURES:
            ok("Downtown_BlockGrid.geojson  %d features" % len(feats))
        else:
            fail("Downtown_BlockGrid.geojson  %d features, expected %d"
                 % (len(feats), EXPECTED_FEATURES))
        return gj
    except Exception as exc:
        fail("Downtown_BlockGrid.geojson could not be parsed: %s" % exc)
        return None


def check_coverage():
    """The currency question: how far forward does the level series run?"""
    print("\n[4] temporal coverage of DowntownCounts_Monthly.csv")
    rows = load_csv("DowntownCounts_Monthly.csv")
    level = [r for r in rows
             if r.get("area_type") == "neighborhood" and r.get("component") == "total"]
    months = sorted({month_of(r.get("date")) for r in level} - {""})
    if not months:
        fail("no neighborhood/total rows found -- check column contracts")
        return
    areas = sorted({r.get("area") for r in level if r.get("area")})
    ok("level series: %d months, %s to %s" % (len(months), months[0], months[-1]))
    ok("%d areas: %s" % (len(areas), ", ".join(areas)))
    note("LATEST MONTH PRESENT: %s" % months[-1])

    # Contiguity: which months are absent from the index entirely?
    def step(m):
        y, mm = int(m[:4]), int(m[5:7])
        return y * 12 + (mm - 1)

    span = set(months)
    expected_span = set()
    cur, end = step(months[0]), step(months[-1])
    while cur <= end:
        expected_span.add("%04d-%02d" % (cur // 12, cur % 12 + 1))
        cur += 1
    absent = sorted(expected_span - span)

    # Months present as rows but with every count null.
    null_months = []
    for m in months:
        counts = [num(r.get("count")) for r in level if month_of(r.get("date")) == m]
        if counts and all(c is None for c in counts):
            null_months.append(m)

    if absent:
        note("months with NO rows at all: %s" % ", ".join(absent))
    if null_months:
        note("months present but all counts null: %s" % ", ".join(null_months))

    gap = sorted(set(absent) | set(null_months))
    if gap == KNOWN_GAP_MONTHS:
        ok("reporting gap matches spec section 5.1 exactly: %s" % ", ".join(gap))
    elif gap:
        note("observed gap %s vs spec section 5.1 %s -- reconcile before building"
             % (", ".join(gap), ", ".join(KNOWN_GAP_MONTHS)))
    else:
        note("no gap months detected; spec section 5.1 expects %s"
             % ", ".join(KNOWN_GAP_MONTHS))

    zero_counts = [r for r in level
                   if month_of(r.get("date")) in KNOWN_GAP_MONTHS and num(r.get("count")) == 0.0]
    if zero_counts:
        fail("%d gap-month rows carry count=0; spec section 5.1 requires null, not zero"
             % len(zero_counts))


def check_orphans(gj):
    """Acceptance test #4 -- 382 both ways, 0 orphans."""
    print("\n[5] block_id join integrity (acceptance test #4)")
    if gj is None:
        note("skipped -- geojson unavailable")
        return
    geo_ids = {f.get("properties", {}).get("block_id") for f in gj.get("features", [])}
    geo_ids.discard(None)
    grid_ids = {r.get("block_id") for r in load_csv("Downtown_BlockGrid.csv")}
    grid_ids.discard(None)
    count_ids = {r.get("block_id") for r in load_csv("BlockLevel_Counts.csv")}
    count_ids.discard(None)

    for label, other in (("grid csv", grid_ids), ("block counts", count_ids)):
        only_geo = geo_ids - other
        only_other = other - geo_ids
        if not only_geo and not only_other:
            ok("geojson <-> %-13s %d ids, 0 orphans" % (label, len(geo_ids)))
        else:
            fail("geojson <-> %s: %d only in geojson, %d only in %s (e.g. %s)"
                 % (label, len(only_geo), len(only_other), label,
                    sorted(only_geo | only_other)[:3]))


def check_reconciliation():
    """Acceptance test #1 -- the primary correctness gate (spec section 2.2)."""
    print("\n[6] reconciliation, spec section 2.2 (acceptance test #1)")
    monthly = load_csv("DowntownCounts_Monthly.csv")

    # Multiplier regime per month. Inlined per-row in the monthly file;
    # spec section 0 rule 2 -- join these, never hardcode.
    mult = {}
    for r in monthly:
        m = month_of(r.get("date"))
        t, v = num(r.get("tent_multiplier")), num(r.get("vehicle_multiplier"))
        if m and t is not None and v is not None:
            mult.setdefault(m, (t, v))

    published = {}
    for r in monthly:
        if r.get("area_type") == "neighborhood" and r.get("component") == "total":
            c = num(r.get("count"))
            if c is not None:
                published[(month_of(r.get("date")), r.get("area"))] = c

    blocks = load_csv("BlockLevel_Counts.csv")
    grid_area = {r.get("block_id"): r.get("area") for r in load_csv("Downtown_BlockGrid.csv")}

    from_blocks = {}
    skipped_na = 0
    for r in blocks:
        m = month_of(r.get("report_month"))          # section 1.1: NOT count_date
        area = grid_area.get(r.get("block_id")) or r.get("area")
        if not m or not area or m not in mult:
            continue
        ind, tents, veh = num(r.get("individuals")), num(r.get("tents_structures")), num(r.get("vehicles"))
        if ind is None or tents is None or veh is None:
            skipped_na += 1                          # section 1.1: never fill with 0
            continue
        tm, vm = mult[m]
        from_blocks[(m, area)] = from_blocks.get((m, area), 0.0) + ind + tm * tents + vm * veh

    if skipped_na:
        note("%d block-date row(s) skipped for null components (spec section 1.1 expects 1)" % skipped_na)

    print("    %-9s %10s %12s %10s %10s" % ("month", "published", "from blocks", "delta", "abs err"))
    for month in sorted(RECONCILIATION):
        exp_pub, exp_blocks, exp_abs = RECONCILIATION[month]
        areas = {a for (m, a) in published if m == month}
        if not areas:
            fail("%s absent from the level series" % month)
            continue
        got_pub = sum(published[(month, a)] for a in areas)
        got_blocks = sum(from_blocks.get((month, a), 0.0) for a in areas)
        abs_err = sum(abs(from_blocks.get((month, a), 0.0) - published[(month, a)]) for a in areas)
        print("    %-9s %10.0f %12.1f %10.1f %10.1f" % (month, got_pub, got_blocks, got_blocks - got_pub, abs_err))

        if abs(got_pub - exp_pub) > TOLERANCE:
            fail("%s published %.1f, spec says %d" % (month, got_pub, exp_pub))
        if abs(got_blocks - exp_blocks) > TOLERANCE:
            fail("%s from-blocks %.1f, spec says %.1f" % (month, got_blocks, exp_blocks))
        if abs(abs_err - exp_abs) > TOLERANCE:
            fail("%s abs-error %.1f, spec says %.1f" % (month, abs_err, exp_abs))

    # Spec section 2.2 spot check, per area.
    for area, expected in (("East Village", 435.0), ("Gaslamp", 41.0), ("Marina", 17.0)):
        got = from_blocks.get(("2025-01", area))
        if got is None:
            fail("2025-01 %s missing from block sums" % area)
        elif abs(got - expected) > 1.0:
            fail("2025-01 %s = %.1f, spec says ~%.0f" % (area, got, expected))
        else:
            ok("2025-01 %-13s %.1f vs published %.0f" % (area, got, expected))


def main():
    print("checking %s" % RAW)
    if not os.path.isdir(RAW):
        print("\ndata/raw does not exist.")
        return 2

    complete = check_presence()
    if failures:
        print("\n" + "=" * 60)
        print("STOPPED: %d file-level problem(s). Nothing parsed." % len(failures))
        print("If files are HTML, the Drive folder still needs link-sharing.")
        print("=" * 60)
        return 1
    if not complete:
        return 1

    gj = check_row_counts()
    check_coverage()
    check_orphans(gj)
    check_reconciliation()

    print("\n" + "=" * 60)
    if failures:
        print("FAILED -- %d problem(s):" % len(failures))
        for f in failures:
            print("  - " + f)
        print("=" * 60)
        return 1
    print("All checks passed.")
    for n in notes:
        print("  note: " + n)
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
