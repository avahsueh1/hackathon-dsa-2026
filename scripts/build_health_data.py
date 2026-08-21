#!/usr/bin/env python3
"""Downtown health facilities from the California HCAI licensed-facility file.

Input
  data/raw/health_facility_locations.csv   15,097 facilities statewide

Filters to San Diego County, status OPEN, geocoded, then keeps everything
within CONTEXT_KM of the downtown centroid. Facilities inside the block grid
get drawn on the map; the rest are retained as context, because the acute-care
hospitals that actually serve downtown sit 4-5 km outside the frame and
pretending otherwise would misrepresent the coverage picture.

Like the shelter layer this is additive (spec section 10 puts health/services
in Layer 3): it writes its own data/out/health.json and touches nothing else.

    python3 scripts/build_health_data.py
"""

import csv
import json
import math
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "out")
SRC = os.path.join(RAW, "health_facility_locations.csv")

COUNTY = "SAN DIEGO"
CONTEXT_KM = 10.0     # keep this much around downtown, for the "nearest" answer
ON_MAP_M = 400.0      # distance to the nearest BLOCK, not to the bbox -- see below

# HCAI FAC_FDR values collapsed into classes the map can encode by shape/size.
# Anything unlisted falls through to "other" rather than being dropped, so a
# new HCAI category shows up instead of silently disappearing.
CLASS_OF = {
    "GENERAL ACUTE CARE HOSPITAL": "hospital",
    "ACUTE PSYCHIATRIC HOSPITAL": "psychiatric",
    "PSYCHIATRIC HEALTH FACILITY": "psychiatric",
    "CHEMICAL DEPENDENCY RECOVERY HOSPITAL": "psychiatric",
    "PRIMARY CARE CLINIC": "clinic",
    "SURGICAL CLINIC": "clinic",
    "REHABILITATION CLINIC": "clinic",
    "PSYCHOLOGY CLINIC": "clinic",
    "CHRONIC DIALYSIS CLINIC": "clinic",
    "SKILLED NURSING FACILITY": "nursing",
    "INTERMEDIATE CARE FACILITY": "nursing",
    "CONGREGATE LIVING HEALTH FACILITY": "nursing",
    "HOSPICE": "hospice",
    "HOSPICE FACILITY": "hospice",
    "HOME HEALTH AGENCY": "home_health",
}


def km_between(lon1, lat1, lon2, lat2):
    return math.hypot((lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)) * 111.32,
                      (lat2 - lat1) * 110.57)


if not os.path.exists(SRC):
    sys.exit("missing %s" % SRC)

geom_path = os.path.join(OUT, "geometry.json")
if not os.path.exists(geom_path):
    sys.exit("missing geometry.json -- run scripts/build_heatmap_data.py first")

with open(geom_path, encoding="utf-8") as fh:
    GEO = json.load(fh)
bbox = GEO["bbox"]
cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2

# "On the map" is proximity to an actual block, NOT containment in the bbox.
# The bbox is a lon/lat rectangle and downtown sits on a bay, so the rectangle
# also covers open water and part of Coronado -- a bbox test puts Sharp
# Coronado on the map, 1.5 km offshore from the nearest block.
BLOCKS = [(b["id"], b["centroid"][0], b["centroid"][1]) for b in GEO["blocks"]]


def clean(s):
    return (s or "").strip()


def title(s):
    """HCAI ships names in caps. Title-case, but keep short acronyms intact."""
    out = []
    for w in clean(s).split():
        if len(w) <= 3 and w.isalpha() and w.upper() in (
                "UC", "UCSD", "APH", "SNF", "DP", "LLC", "INC", "VA", "MD"):
            out.append(w.upper())
        elif "/" in w or "-" in w and len(w) <= 4:
            out.append(w)
        else:
            out.append(w.capitalize())
    return " ".join(out)


with open(SRC, newline="", encoding="utf-8-sig") as fh:
    rows = list(csv.DictReader(fh))

print("%d facilities statewide" % len(rows))

facilities = []
for r in rows:
    if clean(r.get("COUNTY_NAME")).upper() != COUNTY:
        continue
    if clean(r.get("FAC_STATUS_TYPE_CODE")).upper() != "OPEN":
        continue
    lat, lon = clean(r.get("LATITUDE")), clean(r.get("LONGITUDE"))
    if not lat or not lon:
        continue
    try:
        lat, lon = float(lat), float(lon)
    except ValueError:
        continue

    d = km_between(cx, cy, lon, lat)
    if d > CONTEXT_KM:
        continue

    fdr = clean(r.get("FAC_FDR")).upper()
    cap = clean(r.get("CAPACITY"))
    try:
        cap = int(float(cap))
    except ValueError:
        cap = None

    near_id, near_m = None, float("inf")
    for bid, blon, blat in BLOCKS:
        m = km_between(lon, lat, blon, blat) * 1000.0
        if m < near_m:
            near_m, near_id = m, bid

    facilities.append({
        "name": title(r.get("FACNAME")),
        "type": title(r.get("FAC_FDR")),
        "cls": CLASS_OF.get(fdr, "other"),
        "capacity": cap,
        "address": title(r.get("ADDRESS")),
        "city": title(r.get("CITY")),
        "zip": clean(r.get("ZIP")),
        "lonlat": [round(lon, 6), round(lat, 6)],
        "km_from_downtown": round(d, 2),
        "trauma": clean(r.get("TRAUMA_CTR")) or None,
        "type_of_care": clean(r.get("TYPE_OF_CARE")) or None,
        "nearest_block": near_id,
        "nearest_block_m": round(near_m),
        "in_view": near_m <= ON_MAP_M,
        # Coronado is an island city: 2.2 km from downtown in a straight line,
        # but across the bay and reachable only by bridge or ferry. Straight-line
        # distance would name it the nearest hospital, which is true and useless.
        "across_bay": clean(r.get("CITY")).upper() == "CORONADO",
    })

facilities.sort(key=lambda f: f["km_from_downtown"])

in_view = [f for f in facilities if f["in_view"]]
print("  %d open facilities within %.0f km of downtown centre"
      % (len(facilities), CONTEXT_KM))
print("  %d inside the block grid (drawn on the map)" % len(in_view))

print("\n  on-map mix:")
for cls, n in Counter(f["cls"] for f in in_view).most_common():
    beds = sum(f["capacity"] or 0 for f in in_view if f["cls"] == cls)
    print("    %-13s %3d  (%d licensed beds)" % (cls, n, beds))

# The acute and psychiatric hospitals, wherever they are. These are the answer
# to "where would someone downtown actually be taken", and none is on the map.
hospitals = [f for f in facilities if f["cls"] in ("hospital", "psychiatric")]
print("\n  nearest hospitals (none are inside the map frame):")
for f in hospitals[:6]:
    print("    %-46s %5.1f km  cap %-5s %s"
          % (f["name"][:46], f["km_from_downtown"],
             f["capacity"] if f["capacity"] is not None else "-",
             f["trauma"] or ""))

psych_beds = sum(f["capacity"] or 0 for f in facilities if f["cls"] == "psychiatric")
print("\n  acute psychiatric beds within %.0f km: %d" % (CONTEXT_KM, psych_beds))

# The two that actually answer "where does someone downtown get taken".
mainland = [f for f in hospitals if not f["across_bay"]]
trauma = [f for f in hospitals if f["trauma"]]
if mainland:
    print("  nearest hospital not across the bay: %s (%.1f km)"
          % (mainland[0]["name"], mainland[0]["km_from_downtown"]))
if trauma:
    print("  nearest trauma centre: %s, %s (%.1f km)"
          % (trauma[0]["name"], trauma[0]["trauma"], trauma[0]["km_from_downtown"]))

payload = {
    "attribution": "Licensed health facilities: California Department of Health "
                   "Care Access and Information (HCAI), facility listing "
                   "(data date %s)." % clean(rows[0].get("DATA_DATE")),
    "context_km": CONTEXT_KM,
    "totals": {
        "within_context": len(facilities),
        "in_view": len(in_view),
        "in_view_licensed_beds": sum(f["capacity"] or 0 for f in in_view),
        "hospitals_within_context": len(hospitals),
        "psychiatric_beds_within_context": psych_beds,
        "hospitals_in_view": sum(1 for f in in_view
                                 if f["cls"] in ("hospital", "psychiatric")),
        "nearest_hospital_km": hospitals[0]["km_from_downtown"] if hospitals else None,
        "nearest_hospital": hospitals[0]["name"] if hospitals else None,
        "nearest_mainland_hospital": mainland[0]["name"] if mainland else None,
        "nearest_mainland_hospital_km": (mainland[0]["km_from_downtown"]
                                         if mainland else None),
        "nearest_trauma": trauma[0]["name"] if trauma else None,
        "nearest_trauma_km": trauma[0]["km_from_downtown"] if trauma else None,
        "nearest_trauma_level": trauma[0]["trauma"] if trauma else None,
    },
    "facilities": facilities,
    "nearest_hospitals": hospitals[:8],
}

os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, "health.json")
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, separators=(",", ":"), allow_nan=False)
print("\n  wrote data/out/health.json  %.1f KB" % (os.path.getsize(path) / 1024))
