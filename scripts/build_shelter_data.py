#!/usr/bin/env python3
"""Shelter supply, cost benchmarks, and a siting gap analysis.

Inputs
  data/raw/2025_HIC.csv   Housing Inventory Count -- bed capacity and occupancy
  data/out/geometry.json  block polygons and centroids
  data/out/values.json    per-block persons

Spec section 10 puts shelters and HIC in Layer 3, not Layer 2. This script is
therefore additive: it writes its own data/out/shelters.json and does not touch
geometry.json or values.json, so the Layer 3 interface contract (spec section
11) is unchanged and the heat map still stands on its own.

Funding figures are transcribed from the City of San Diego Independent Budget
Analyst report 24-24 REV, "FY 2025 Homelessness Programs and Funding"
(2024-09-20), Attachment I Table 1. Those are PROGRAM budget lines, not HIC
rows, so each match to a shelter is labelled with a confidence and the
unmatched ones are left null rather than guessed.

    python3 scripts/build_shelter_data.py
"""

import csv
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "out")

WALK_M = 800.0        # ~10 minute walk, the catchment for both demand and supply
MARGIN = 0.006        # ~600 m beyond the block grid, to catch edge shelters

IBA = ("City of San Diego Independent Budget Analyst report 24-24 REV, "
       "\"FY 2025 Homelessness Programs and Funding\" (2024-09-20), "
       "Attachment I Table 1")

# Program budget line -> HIC Project_Name_1, with the FY2025 total in thousands
# of dollars exactly as printed in Table 1. Only unambiguous name+address
# matches are listed; everything else stays unmatched on purpose.
FUNDING = {
    "Bridge Shelter - Alpha Project I (16th & Newton)":
        ("Bridge Shelter - 16th and Newton", 7649.0, "high"),
    "Bridge Shelter - Alpha Project II (17th & Imperial)":
        ("Bridge Shelter - 17th and Imperial", 3913.3, "high"),
    "PATH - Connections Housing":
        ("Connections Interim Housing", 1130.8, "high"),
    "Father Joe’s - Bishop Maher Center":
        ("Bishops Shelter", 605.5, "high"),
    "Safe STAY Wellness Center":
        ("LGBTQ+ Youth Services and Shelter", 1969.0, "medium"),
    "Pacific Inn City HHAP - Serving Seniors":
        ("Seniors Landing Non-Congregate Shelter", 950.0, "medium"),
}

# Citywide context, same report. The Kettner & Vine line is the useful one for
# siting: a proposed 1,000-bed permanent shelter whose operation is estimated
# at $30.7M annually, which is the cleanest published marginal cost per bed.
BENCHMARKS = {
    "shelter_programs_fy25_usd": 42_203_400,
    "citywide_homelessness_fy25_usd": 315_861_600,
    "city_shelter_capacity_beds": 1998,
    "proposed_kettner_vine_beds": 1000,
    "proposed_kettner_vine_annual_usd": 30_700_000,
    "cost_per_bed_year_usd": 30700,
    "cost_per_bed_night_usd": round(30_700_000 / 1000 / 365, 2),
    "source": IBA,
}


def num(s, cast=float):
    s = (s or "").strip()
    if s == "":
        return None
    try:
        return cast(float(s))
    except ValueError:
        return None


def haversine_m(lon1, lat1, lon2, lat2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


for f in ("geometry.json", "values.json"):
    if not os.path.exists(os.path.join(OUT, f)):
        sys.exit("missing %s -- run scripts/build_heatmap_data.py first" % f)

with open(os.path.join(OUT, "geometry.json"), encoding="utf-8") as fh:
    GEO = json.load(fh)
with open(os.path.join(OUT, "values.json"), encoding="utf-8") as fh:
    V = json.load(fh)

bbox = GEO["bbox"]
W, S, E, N = bbox[0] - MARGIN, bbox[1] - MARGIN, bbox[2] + MARGIN, bbox[3] + MARGIN

# ------------------------------------------------------------------ shelters

with open(os.path.join(RAW, "2025_HIC.csv"), newline="", encoding="utf-8-sig") as fh:
    hic = list(csv.DictReader(fh))

shelters = []
for r in hic:
    lon, lat = num(r["X"]), num(r["Y"])
    if lon is None or lat is None:
        continue
    if not (W <= lon <= E and S <= lat <= N):
        continue
    beds = num(r["Total_Beds"], int) or 0
    pit = num(r["PIT_Count"], int) or 0
    name = (r["Project_Name_1"] or r["Project_Name"] or "").strip()
    fund = FUNDING.get(name)
    shelters.append({
        "name": name,
        "org": (r["Organization_Name"] or "").strip(),
        "address": (r["Address"] or "").strip(),
        "lonlat": [round(lon, 6), round(lat, 6)],
        "beds": beds,
        "occupied": pit,
        "free": max(0, beds - pit),
        "utilization": round(pit / beds, 4) if beds else None,
        "bed_type": (r["Bed_Type"] or "").strip(),
        "housing_type": (r["Housing_Type"] or "").strip(),
        "funding_fy25_usd": int(fund[1] * 1000) if fund else None,
        "funding_program": fund[0] if fund else None,
        "funding_confidence": fund[2] if fund else None,
        "cost_per_bed_year_usd": (round(fund[1] * 1000 / beds) if fund and beds else None),
    })

shelters.sort(key=lambda s: -s["beds"])
total_beds = sum(s["beds"] for s in shelters)
total_occ = sum(s["occupied"] for s in shelters)

print("%d shelters in the downtown window" % len(shelters))
print("  %d beds, %d occupied, %d free (%.1f%% utilised)"
      % (total_beds, total_occ, total_beds - total_occ,
         100.0 * total_occ / total_beds if total_beds else 0))
matched = [s for s in shelters if s["funding_fy25_usd"]]
print("  %d matched to an FY25 budget line, %.1fM total"
      % (len(matched), sum(s["funding_fy25_usd"] for s in matched) / 1e6))

# --------------------------------------------------------- siting gap model

# Demand: persons within a 10-minute walk of each block, on the most recent
# month that was physically counted (so the ranking rests on observation, not
# on the disaggregation model).
obs = V["observed_months"][-1]
mi = V["months"].index(obs)
row = V["values"][mi]
blocks = GEO["blocks"]
cent = [b["centroid"] for b in blocks]

print("\nsiting model on %s (last physically counted month)" % obs)

# Supply: beds within the same radius of the block.
supply = [0] * len(blocks)
free_supply = [0] * len(blocks)
nearest = [None] * len(blocks)
for i, (lon, lat) in enumerate(cent):
    best = None
    for s in shelters:
        d = haversine_m(lon, lat, s["lonlat"][0], s["lonlat"][1])
        if d <= WALK_M:
            supply[i] += s["beds"]
            free_supply[i] += s["free"]
        if best is None or d < best[0]:
            best = (d, s["name"])
    nearest[i] = {"m": round(best[0]), "name": best[1]} if best else None

demand = [0.0] * len(blocks)
for i, (lon, lat) in enumerate(cent):
    tot = 0.0
    for j, (lon2, lat2) in enumerate(cent):
        v = row[j]
        if v and haversine_m(lon, lat, lon2, lat2) <= WALK_M:
            tot += v
    demand[i] = tot

candidates = []
for i, b in enumerate(blocks):
    unmet = demand[i] - supply[i]
    candidates.append({
        "block_id": b["id"],
        "area": b["area"],
        "persons_here": round(row[i], 1) if row[i] is not None else None,
        "demand_800m": round(demand[i], 1),
        "beds_800m": supply[i],
        "free_beds_800m": free_supply[i],
        "unmet_800m": round(unmet, 1),
        "nearest_shelter_m": nearest[i]["m"] if nearest[i] else None,
        "nearest_shelter": nearest[i]["name"] if nearest[i] else None,
        "annual_cost_to_close_usd": int(max(0, unmet) * BENCHMARKS["cost_per_bed_year_usd"]),
    })

candidates.sort(key=lambda c: -c["unmet_800m"])
top = candidates[:15]

print("  top siting candidates by unmet demand within %dm:" % int(WALK_M))
for c in top[:6]:
    print("    %-26s %-16s demand %6.1f  beds %4d  unmet %6.1f  nearest %sm"
          % (c["block_id"], c["area"], c["demand_800m"], c["beds_800m"],
             c["unmet_800m"], c["nearest_shelter_m"]))

covered = sum(1 for i in range(len(blocks)) if supply[i] > 0)
print("  %d of %d blocks have any shelter bed within %dm"
      % (covered, len(blocks), int(WALK_M)))

# ------------------------------------------------------------------- write

payload = {
    "attribution": "Shelter capacity: 2025 Housing Inventory Count (HIC), "
                   "Regional Task Force on Homelessness. Funding: " + IBA + ".",
    "as_of_month": obs,
    "walk_radius_m": WALK_M,
    "totals": {
        "shelters": len(shelters),
        "beds": total_beds,
        "occupied": total_occ,
        "free": total_beds - total_occ,
        "utilization": round(total_occ / total_beds, 4) if total_beds else None,
    },
    "benchmarks": BENCHMARKS,
    "shelters": shelters,
    "siting_candidates": top,
    "coverage": {
        "blocks_with_beds_within_radius": covered,
        "blocks_total": len(blocks),
    },
}

path = os.path.join(OUT, "shelters.json")
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, separators=(",", ":"), allow_nan=False)
print("\n  wrote data/out/shelters.json  %.1f KB" % (os.path.getsize(path) / 1024))
