#!/usr/bin/env python3
"""Pull the backend repo's zone model into data/backend/.

The two repos stay independent -- separate pipelines, separate histories,
neither blocking the other. This is the one seam between them: their zone
model is authoritative, and this fetches the current version of it.

    python3 scripts/sync_backend.py              # fetch, diff, write
    python3 scripts/sync_backend.py --dry-run    # show what would change
    python3 scripts/sync_backend.py --from ../dsa-hackathon-2026   # local clone

Then rebuild:

    python3 scripts/rebuild_all.py

The files are committed here as well, so this repo builds with no network. The
sync is how you take their updates, not a dependency of the build.

It refuses to write a file that has lost a column the app depends on. A zone
model that silently changes shape would produce a plausible-looking map with
wrong numbers on it, which is the worst possible failure for this project.
"""

import argparse
import csv
import io
import json
import os
import shutil
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, "data", "backend")

REPO = "siapatodia8/dsa-hackathon-2026"
BRANCH = "main"
RAW = "https://raw.githubusercontent.com/%s/%s/data/derived/%%s" % (REPO, BRANCH)

FILES = ["zone_need.csv", "zones.geojson", "validation_report.json"]

# Columns scripts/build_zones.py reads. If one disappears, stop.
REQUIRED_COLUMNS = [
    "zone_id", "zone_name", "need_score", "need_tier",
    "baseline_predicted", "recent_311_count", "recent_311_adjustment",
    "block_count", "source_block_ids",
]


def fetch(name, source_dir):
    if source_dir:
        path = os.path.join(source_dir, "data", "derived", name)
        if not os.path.exists(path):
            raise IOError("not found: %s" % path)
        with open(path, "rb") as fh:
            return fh.read()
    with urllib.request.urlopen(RAW % name, timeout=60) as r:
        return r.read()


def summarise(raw):
    """Zone count and scores, for the before/after diff."""
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
    return rows, {r["zone_id"]: (r.get("zone_name", ""),
                                 float(r.get("need_score") or 0),
                                 r.get("need_tier", "")) for r in rows}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from", dest="source", default=None,
                    help="path to a local clone of the backend repo")
    args = ap.parse_args()

    where = args.source or ("github.com/" + REPO + " @ " + BRANCH)
    print("syncing from %s" % where)

    fetched = {}
    for name in FILES:
        try:
            fetched[name] = fetch(name, args.source)
            print("  got %-24s %8.1f KB" % (name, len(fetched[name]) / 1024.0))
        except Exception as exc:
            sys.exit("could not fetch %s: %s" % (name, exc))

    # --- guard: the shape the app depends on
    try:
        rows, new_scores = summarise(fetched["zone_need.csv"])
    except Exception as exc:
        sys.exit("zone_need.csv did not parse: %s" % exc)

    if not rows:
        sys.exit("zone_need.csv has no rows")

    missing = [c for c in REQUIRED_COLUMNS if c not in rows[0]]
    if missing:
        print("\nSTOP: their zone model no longer has column(s) the app reads:")
        for c in missing:
            print("  " + c)
        print("\nNothing written. Either they renamed something, or the model")
        print("changed shape. Fix scripts/build_zones.py to match, then re-run.")
        sys.exit(1)

    total_blocks = sum(int(r.get("block_count") or 0) for r in rows)
    print("\n  %d zones, %d blocks, %d 311 reports"
          % (len(rows), total_blocks,
             sum(int(float(r.get("recent_311_count") or 0)) for r in rows)))
    if total_blocks != 382:
        print("  WARNING: covers %d blocks, expected 382" % total_blocks)

    # --- diff against what we already have
    old_path = os.path.join(BACKEND, "zone_need.csv")
    if os.path.exists(old_path):
        with open(old_path, "rb") as fh:
            _, old_scores = summarise(fh.read())
        added = [z for z in new_scores if z not in old_scores]
        gone = [z for z in old_scores if z not in new_scores]
        moved = [(z, old_scores[z][1], new_scores[z][1]) for z in new_scores
                 if z in old_scores and abs(new_scores[z][1] - old_scores[z][1]) > 0.005]
        if not (added or gone or moved):
            print("\n  no change since the last sync")
        else:
            print("\n  changes:")
            for z in added:
                print("    + %-24s new zone (%.1f)" % (z, new_scores[z][1]))
            for z in gone:
                print("    - %-24s gone" % z)
            for z, a, b in moved:
                print("    ~ %-24s %.1f -> %.1f (%+.1f)" % (z, a, b, b - a))
    else:
        print("\n  first sync")

    if args.dry_run:
        print("\ndry run, nothing written.")
        return

    os.makedirs(BACKEND, exist_ok=True)
    for name, raw in fetched.items():
        with open(os.path.join(BACKEND, name), "wb") as fh:
            fh.write(raw)
    print("\n  wrote %d file(s) to data/backend/" % len(fetched))
    print("\nnext:")
    print("  python3 scripts/rebuild_all.py")


if __name__ == "__main__":
    main()
