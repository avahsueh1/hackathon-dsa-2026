#!/usr/bin/env python3
"""Run the whole pipeline, in order, and stop at the first thing that breaks.

    python3 scripts/rebuild_all.py
    python3 scripts/rebuild_all.py --accept-new-data     # after an ingest

This is the one command to run after data changes. It goes:

    check_data  ->  heatmap  ->  transit  ->  shelters  ->  health
                ->  siting   ->  page

Steps marked optional are skipped with a note if their inputs are missing, so
the heat map still builds on a machine that has not downloaded the GTFS feed
or the health facility file. Required steps stop the run.

--accept-new-data relaxes the frozen regression numbers to warnings. Those
numbers were computed against the original bundle; ingesting new counts is
supposed to move them, and the run tells you which ones moved.
"""

import argparse
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
RAW = os.path.join(ROOT, "data", "raw")

# (script, label, required, [inputs that must exist])
STEPS = [
    ("check_data.py", "validate the raw data", True, []),
    ("build_heatmap_data.py", "block estimates + acceptance tests", True, []),
    ("build_transit_data.py", "trolley lines and stations", False,
     ["mts_google_transit.zip"]),
    ("build_shelter_data.py", "shelter beds, funding, gap", False, ["2025_HIC.csv"]),
    ("build_health_data.py", "clinics and hospitals", False,
     ["health_facility_locations.csv"]),
    ("build_siting_model.py", "where the next shelters go", False, ["2025_HIC.csv"]),
    ("build_zones.py", "delivery zones + need model", True, []),
    ("build_page.py", "inline everything into index.html", True, []),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--accept-new-data", action="store_true",
                    help="report frozen-baseline drift instead of failing")
    ap.add_argument("--quiet", action="store_true",
                    help="only show each step's last few lines")
    args = ap.parse_args()

    env = dict(os.environ)
    if args.accept_new_data:
        env["HEATMAP_ACCEPT_NEW_DATA"] = "1"
        print("running with --accept-new-data: frozen numbers are reported, not enforced")

    started = time.time()
    ran, skipped = [], []

    for script, label, required, inputs in STEPS:
        missing = [f for f in inputs if not os.path.exists(os.path.join(RAW, f))]
        if missing:
            if required:
                sys.exit("STOP: %s needs data/raw/%s" % (script, ", ".join(missing)))
            skipped.append((label, missing[0]))
            print("\n--- skip  %-34s (no data/raw/%s)" % (label, missing[0]))
            continue

        print("\n--- run   %s" % label)
        t0 = time.time()
        proc = subprocess.run([sys.executable, os.path.join(SCRIPTS, script)],
                              cwd=ROOT, env=env, capture_output=True, text=True)
        out = (proc.stdout or "").rstrip()
        if args.quiet:
            tail = out.splitlines()[-4:]
            print("\n".join("    " + l for l in tail))
        elif out:
            print("\n".join("    " + l for l in out.splitlines()))
        if proc.returncode != 0:
            if proc.stderr:
                print("\n" + proc.stderr.rstrip())
            print("\n" + "=" * 62)
            print("PIPELINE STOPPED at %s" % script)
            if not args.accept_new_data:
                print("If you have just ingested new data, the frozen regression")
                print("numbers are expected to move. Re-run with:")
                print("    python3 scripts/rebuild_all.py --accept-new-data")
            print("=" * 62)
            sys.exit(proc.returncode)
        ran.append((label, time.time() - t0))

    print("\n" + "=" * 62)
    print("PIPELINE OK  (%.1fs)" % (time.time() - started))
    for label, dt in ran:
        print("  ok    %-40s %.1fs" % (label, dt))
    for label, why in skipped:
        print("  skip  %-40s missing %s" % (label, why))
    print("\n  open index.html -- no server needed")
    print("=" * 62)


if __name__ == "__main__":
    main()
