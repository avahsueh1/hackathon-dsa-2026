#!/usr/bin/env python3
"""Take a new data file and fold it into data/raw/.

This is the front door of the pipeline. Someone finishes a street count, or
DSDP publishes another month, and the numbers need to reach the map without
anyone hand-editing a CSV.

    python3 scripts/ingest.py path/to/new_counts.csv
    python3 scripts/ingest.py path/to/file.csv --type blocks --dry-run

What it does
  1. Works out which dataset the file is (from its columns, not its name).
  2. Checks the required columns are present and the values parse.
  3. Merges on that dataset's natural key: rows with a key that already exists
     REPLACE the old row, genuinely new rows are appended. So the same file can
     be ingested twice without duplicating anything, and a correction to
     February is just February re-sent.
  4. Backs the old file up to data/raw/_backups/ before writing.
  5. Tells you exactly what changed, then what to run next.

It deliberately does NOT rebuild. Ingest and rebuild are separate so a bad
file can be reverted before it reaches the map -- run scripts/rebuild_all.py
when you are happy with the summary.
"""

import argparse
import csv
import datetime
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
BACKUPS = os.path.join(RAW, "_backups")

# dataset -> required columns, natural key, destination filename.
# The key is what makes re-ingesting safe: same key means same row.
DATASETS = {
    "blocks": {
        "file": "BlockLevel_Counts.csv",
        "required": ["block_id", "report_month", "individuals",
                     "tents_structures", "vehicles"],
        "key": ["block_id", "report_month"],
        "numeric": ["individuals", "tents_structures", "vehicles"],
        "label": "block-level counts",
    },
    "monthly": {
        "file": "DowntownCounts_Monthly.csv",
        "required": ["date", "area", "area_type", "component", "count"],
        "key": ["date", "area", "area_type", "component"],
        "numeric": ["count"],
        "label": "monthly area totals",
    },
    "panel": {
        "file": "BlockLevel_Counts_Panel261.csv",
        "required": ["block_id", "report_month", "individuals"],
        "key": ["block_id", "report_month"],
        "numeric": ["individuals"],
        "label": "balanced 261-block panel",
    },
    "grid": {
        "file": "Downtown_BlockGrid.csv",
        "required": ["block_id", "area", "lon", "lat"],
        "key": ["block_id"],
        "numeric": ["lon", "lat"],
        "label": "block join table",
    },
    "hic": {
        "file": "2025_HIC.csv",
        "required": ["Project_Name_1", "Total_Beds", "X", "Y"],
        "key": ["Project_Name_1", "Address"],
        "numeric": ["Total_Beds"],
        "label": "shelter inventory (HIC)",
    },
    "health": {
        "file": "health_facility_locations.csv",
        "required": ["FACNAME", "LATITUDE", "LONGITUDE", "COUNTY_NAME"],
        "key": ["FACID"],
        "numeric": [],
        "label": "licensed health facilities",
    },
}


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        r = csv.DictReader(fh)
        return list(r), (r.fieldnames or [])


def detect(fields):
    """Pick the dataset whose required columns are all present. Most specific
    match wins, so 'blocks' beats 'panel' when both would fit."""
    have = set(f.strip() for f in fields)
    hits = []
    for name, spec in DATASETS.items():
        if set(spec["required"]).issubset(have):
            hits.append((len(spec["required"]), name))
    if not hits:
        return None
    hits.sort(reverse=True)
    return hits[0][1]


def is_number(v):
    v = (v or "").strip()
    if v == "" or v.upper() in ("NA", "NAN", "NULL", "NONE"):
        return True          # blank is a legitimate "not counted"
    try:
        float(v)
        return True
    except ValueError:
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", help="the CSV to ingest")
    ap.add_argument("--type", choices=sorted(DATASETS), default=None,
                    help="override the auto-detected dataset")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change, write nothing")
    args = ap.parse_args()

    if not os.path.exists(args.path):
        sys.exit("no such file: %s" % args.path)

    incoming, fields = read_csv(args.path)
    if not incoming:
        sys.exit("%s has no data rows" % args.path)

    kind = args.type or detect(fields)
    if not kind:
        print("Could not tell what this file is. Its columns are:")
        print("  " + ", ".join(fields[:20]) + (" ..." if len(fields) > 20 else ""))
        print("\nExpected one of:")
        for name, spec in sorted(DATASETS.items()):
            print("  %-8s %s" % (name, ", ".join(spec["required"])))
        sys.exit("\nPass --type to force it.")

    spec = DATASETS[kind]
    print("detected: %s (%s)" % (kind, spec["label"]))
    print("  %d rows in %s" % (len(incoming), os.path.basename(args.path)))

    missing = [c for c in spec["required"] if c not in fields]
    if missing:
        sys.exit("missing required column(s): %s" % ", ".join(missing))

    # validate before touching anything
    problems = []
    for i, row in enumerate(incoming, 2):
        for col in spec["numeric"]:
            if col in row and not is_number(row[col]):
                problems.append("row %d: %s = %r is not a number" % (i, col, row[col]))
        for col in spec["key"]:
            if col in fields and not (row.get(col) or "").strip():
                problems.append("row %d: %s is blank, but it is part of the key" % (i, col))
        if len(problems) > 8:
            break
    if problems:
        print("\nrefusing to ingest, %d problem(s):" % len(problems))
        for p in problems[:8]:
            print("  " + p)
        sys.exit(1)

    dest = os.path.join(RAW, spec["file"])
    key_cols = [c for c in spec["key"] if c in fields]

    def key_of(row):
        return tuple((row.get(c) or "").strip() for c in key_cols)

    if os.path.exists(dest):
        existing, dest_fields = read_csv(dest)
    else:
        existing, dest_fields = [], fields
        print("  %s does not exist yet, creating it" % spec["file"])

    new_cols = [c for c in fields if c not in dest_fields]
    if new_cols and existing:
        print("  note: incoming file adds column(s): %s" % ", ".join(new_cols))

    index = {}
    for i, row in enumerate(existing):
        index[key_of(row)] = i

    replaced = added = 0
    for row in incoming:
        k = key_of(row)
        if k in index:
            merged = dict(existing[index[k]])
            merged.update({c: row.get(c, "") for c in fields})
            existing[index[k]] = merged
            replaced += 1
        else:
            existing.append(row)
            index[k] = len(existing) - 1
            added += 1

    out_fields = list(dest_fields) + new_cols
    print("\nmerge on %s:" % " + ".join(key_cols))
    print("  %d row(s) replaced, %d new row(s) added" % (replaced, added))
    print("  %s goes from %d to %d rows"
          % (spec["file"], len(existing) - added, len(existing)))

    if kind in ("blocks", "panel"):
        months = sorted({(r.get("report_month") or "")[:7] for r in existing if r.get("report_month")})
        print("  count dates now: %d (%s to %s)" % (len(months), months[0], months[-1]))
    if kind == "monthly":
        dates = sorted({(r.get("date") or "")[:7] for r in existing if r.get("date")})
        print("  months now: %d (%s to %s)" % (len(dates), dates[0], dates[-1]))

    if args.dry_run:
        print("\ndry run, nothing written.")
        return

    if os.path.exists(dest):
        os.makedirs(BACKUPS, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = os.path.join(BACKUPS, "%s.%s.bak" % (spec["file"], stamp))
        shutil.copy2(dest, backup)
        print("\n  backed up to data/raw/_backups/%s" % os.path.basename(backup))

    with open(dest, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=out_fields, extrasaction="ignore")
        w.writeheader()
        for row in existing:
            w.writerow(row)
    print("  wrote data/raw/%s" % spec["file"])

    print("\nnext:")
    print("  python3 scripts/rebuild_all.py --accept-new-data")
    print("\nThe frozen regression numbers were computed against the original")
    print("bundle, so changing the inputs is expected to move them. That flag")
    print("reports the drift instead of failing the build.")


if __name__ == "__main__":
    main()
