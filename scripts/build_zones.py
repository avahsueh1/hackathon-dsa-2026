#!/usr/bin/env python3
"""Delivery zones and the need model behind Surplus -> Street.

Inputs
  data/out/geometry.json   382 blocks
  data/out/values.json     people per block per month
  data/out/shelters.json   existing meal/bed capacity   (optional)
  data/out/health.json     clinics in the zone          (optional)

Output
  data/out/zones.json

WHY ZONES AND NOT BLOCKS
    The analysis map is block-level because that is what makes the siting
    model work. The app must not be. It is handed to restaurant staff and
    volunteers, and a public map of the exact blocks where people sleep is
    surveillance of people who cannot consent to it.

    So the app reads THIS file and only this file. It carries:
      - a need BAND (high / medium / low), not a headcount
      - a rounded "expected tonight" figure, never an exact one
      - zone geography, never per-block values

    The 10 zones are not invented. They are the neighborhoods already in the
    source data (neighborhood_source), so a driver can navigate to one.

THE NEED MODEL
    need_tonight = expected_people(zone) - meals_already_claimed(zone)

    expected_people is the mean of the most recent RECENT_MONTHS published
    months for the blocks in that zone. The mean rather than the latest
    single month because a single month swings hard -- downtown went 1,938 to
    1,019 in one year -- and a delivery plan should not.

    meals_already_claimed comes from the app at runtime, not from here.

    python3 scripts/build_zones.py
"""

import csv
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "out")
BACKEND = os.path.join(ROOT, "data", "backend")

RECENT_MONTHS = 3        # months averaged for "expected tonight"
BAND_HIGH = 40           # brief: "High need - 40+ expected"
BAND_MEDIUM = 15
ROUND_TO = 5             # expected figures are rounded, never exact


def load(name, required=True):
    path = os.path.join(OUT, name)
    if not os.path.exists(path):
        if required:
            sys.exit("missing %s -- run scripts/build_heatmap_data.py first" % path)
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def meters(lon1, lat1, lon2, lat2):
    return math.hypot((lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2)) * 111320.0,
                      (lat2 - lat1) * 110570.0)


def load_backend_model():
    """Read the backend repo's zone model, if it has been synced in.

    The backend team's model is the better one and should win: it works from
    the block-level panel directly rather than from disaggregated monthly
    area totals, and it carries the 311 'Get It Done' encampment signal, which
    is the live input this side never had. Their eight zones also merge
    Columbia+Cortez and Gaslamp+Marina, which is an operational call about how
    many drop-offs a volunteer can cover -- not something to second-guess from
    the data side.

    So when data/backend/zone_need.csv is present it is authoritative, and the
    neighbourhood grouping below is only the fallback for a machine that has
    not synced it.
    """
    csv_path = os.path.join(BACKEND, "zone_need.csv")
    if not os.path.exists(csv_path):
        return None
    with open(csv_path, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        return None

    geo = {}
    geo_path = os.path.join(BACKEND, "zones.geojson")
    if os.path.exists(geo_path):
        with open(geo_path, encoding="utf-8") as fh:
            for f in json.load(fh).get("features", []):
                geo[f["properties"]["zone_id"]] = f["geometry"]
    return rows, geo


def zones_from_backend(rows, geo, blocks):
    """Their zone rows -> the shape the app renders."""
    by_id = {b["id"]: i for i, b in enumerate(blocks)}
    out = []
    for r in rows:
        try:
            block_ids = json.loads(r.get("source_block_ids") or "[]")
        except ValueError:
            block_ids = []
        idxs = [by_id[b] for b in block_ids if b in by_id]

        # The app publishes a rounded figure, never an exact one.
        score = float(r.get("need_score") or 0)
        rounded = int(round(score / ROUND_TO) * ROUND_TO)

        if idxs:
            cx = sum(blocks[i]["centroid"][0] for i in idxs) / len(idxs)
            cy = sum(blocks[i]["centroid"][1] for i in idxs) / len(idxs)
            mid = min(idxs, key=lambda i: meters(cx, cy, blocks[i]["centroid"][0],
                                                 blocks[i]["centroid"][1]))
            st = blocks[mid]["streets"]
            landmark = {"a": st["e"], "b": st["n"]}
        else:
            cx = cy = 0.0
            landmark = {"a": "", "b": ""}

        out.append({
            "id": r["zone_id"],
            "name": r["zone_name"],
            "area": (json.loads(r["source_areas"])[0]
                     if r.get("source_areas") else ""),
            "block_ids": block_ids,
            "block_count": int(r.get("block_count") or len(block_ids)),
            "expected_tonight": rounded,
            "band": {"high": "high", "medium": "medium", "low": "low"}.get(
                (r.get("need_tier") or "low").lower(), "low"),
            "centroid": [round(cx, 6), round(cy, 6)],
            "landmark": landmark,
            "trend_pct": None,
            "services": {"shelters": 0, "shelter_beds": 0, "clinics": 0},
            # provenance, so the app can show its working
            "model": {
                "need_score": score,
                "baseline_predicted": float(r.get("baseline_predicted") or 0),
                "recent_311_count": int(float(r.get("recent_311_count") or 0)),
                "recent_311_adjustment": float(r.get("recent_311_adjustment") or 0),
                "baseline_confidence": r.get("baseline_confidence") or "",
                "baseline_observation_count": int(float(
                    r.get("baseline_observation_count") or 0)),
                "grouping_reason": r.get("grouping_reason") or "",
                "as_of": r.get("model_as_of") or "",
            },
            # Their zone MultiPolygons stay in data/backend/zones.geojson.
            # The app shades member blocks instead, which reads the same and
            # keeps this file small -- carrying them here added 368 KB of
            # geometry nothing renders.
        })
    return out

GEO = load("geometry.json")
V = load("values.json")
SH = load("shelters.json", False)
HE = load("health.json", False)

blocks = GEO["blocks"]

# ------------------------------------------------------------------ months
# The most recent months that actually carry a published count.
have = [i for i, m in enumerate(V["months"])
        if any(v is not None for v in V["values"][i])]
recent = have[-RECENT_MONTHS:]
recent_names = [V["months"][i] for i in recent]
print("expected-tonight basis: mean of %s" % ", ".join(recent_names))

# ------------------------------------------------------------------- zones

backend = load_backend_model()
if backend:
    rows, geo = backend
    zones = zones_from_backend(rows, geo, blocks)
    covered = sum(z["block_count"] for z in zones)
    print("using the BACKEND zone model: %d zones, %d blocks" % (len(zones), covered))
    if covered != len(blocks):
        print("  WARNING: covers %d of %d blocks" % (covered, len(blocks)))
    with_311 = [z for z in zones if z["model"]["recent_311_count"]]
    print("  %d zones carry a 311 signal, %d reports total"
          % (len(with_311), sum(z["model"]["recent_311_count"] for z in zones)))
else:
    zones = None
    print("no data/backend/zone_need.csv -- falling back to neighbourhood grouping")

groups = {}
for i, b in enumerate(blocks):
    groups.setdefault(b["neighborhood_source"], []).append(i)

if zones is None:
  print("%d zones from the neighborhoods already in the data" % len(groups))

  zones = []
  for name in sorted(groups):
      idxs = groups[name]

      # Mean over the recent months of the zone's total.
      per_month = []
      for mi in recent:
          row = V["values"][mi]
          vals = [row[i] for i in idxs if row[i] is not None]
          if vals:
              per_month.append(sum(vals))
      expected = sum(per_month) / len(per_month) if per_month else 0.0

      # Rounded, so the app never publishes an exact headcount.
      rounded = int(round(expected / ROUND_TO) * ROUND_TO)
      band = "high" if rounded >= BAND_HIGH else ("medium" if rounded >= BAND_MEDIUM else "low")

      cx = sum(blocks[i]["centroid"][0] for i in idxs) / len(idxs)
      cy = sum(blocks[i]["centroid"][1] for i in idxs) / len(idxs)

      # A landmark a driver can actually navigate to: the streets of the block
      # nearest the zone's middle.
      mid = min(idxs, key=lambda i: meters(cx, cy, blocks[i]["centroid"][0],
                                           blocks[i]["centroid"][1]))
      st = blocks[mid]["streets"]

      # A year ago, for the trend arrow.
      year_ago = None
      if len(have) > 12:
          mi = have[max(0, len(have) - 13)]
          row = V["values"][mi]
          vals = [row[i] for i in idxs if row[i] is not None]
          if vals:
              year_ago = sum(vals)

      services = {"shelters": 0, "shelter_beds": 0, "clinics": 0}
      if SH:
          for s in SH["shelters"]:
              d = min(meters(s["lonlat"][0], s["lonlat"][1],
                             blocks[i]["centroid"][0], blocks[i]["centroid"][1])
                      for i in idxs)
              if d <= 250:
                  services["shelters"] += 1
                  services["shelter_beds"] += s["beds"]
      if HE:
          for f in HE["facilities"]:
              if not f["in_view"]:
                  continue
              d = min(meters(f["lonlat"][0], f["lonlat"][1],
                             blocks[i]["centroid"][0], blocks[i]["centroid"][1])
                      for i in idxs)
              if d <= 250:
                  services["clinics"] += 1

      zones.append({
          "id": name.lower().replace(" ", "-"),
          "name": name,
          "area": blocks[idxs[0]]["area"],
          "block_ids": [blocks[i]["id"] for i in idxs],
          "block_count": len(idxs),
          "expected_tonight": rounded,
          "band": band,
          "centroid": [round(cx, 6), round(cy, 6)],
          "landmark": {"a": st["e"], "b": st["n"]},
          "trend_pct": (round((expected - year_ago) / year_ago * 100)
                        if year_ago else None),
          "services": services,
      })

# What is already in each zone. Useful to a driver ("there is a shelter here"),
# and computed the same way whichever zone model produced the list.
by_id = {b["id"]: i for i, b in enumerate(blocks)}
for z in zones:
    idxs = [by_id[b] for b in z["block_ids"] if b in by_id]
    if not idxs:
        continue
    svc = {"shelters": 0, "shelter_beds": 0, "clinics": 0}
    if SH:
        for s_ in SH["shelters"]:
            d = min(meters(s_["lonlat"][0], s_["lonlat"][1],
                           blocks[i]["centroid"][0], blocks[i]["centroid"][1])
                    for i in idxs)
            if d <= 250:
                svc["shelters"] += 1
                svc["shelter_beds"] += s_["beds"]
    if HE:
        for f in HE["facilities"]:
            if not f["in_view"]:
                continue
            d = min(meters(f["lonlat"][0], f["lonlat"][1],
                           blocks[i]["centroid"][0], blocks[i]["centroid"][1])
                    for i in idxs)
            if d <= 250:
                svc["clinics"] += 1
    z["services"] = svc

zones.sort(key=lambda z: -z["expected_tonight"])

total = sum(z["expected_tonight"] for z in zones)
print()
print("%-22s %6s %8s %7s %s" % ("zone", "blocks", "expected", "band", "services"))
for z in zones:
    print("%-22s %6d %8d %7s  %d shelters, %d clinics"
          % (z["name"], z["block_count"], z["expected_tonight"], z["band"],
             z["services"]["shelters"], z["services"]["clinics"]))
print()
print("total expected across zones: %d people" % total)
highs = [z for z in zones if z["band"] == "high"]
print("%d high-need zones carry %d of them (%d%%)"
      % (len(highs), sum(z["expected_tonight"] for z in highs),
         round(100.0 * sum(z["expected_tonight"] for z in highs) / total) if total else 0))

payload = {
    "as_of": recent_names[-1],
    "basis": "Mean of the %d most recent published months (%s). Rounded to the "
             "nearest %d, so no exact headcount is published."
             % (len(recent_names), ", ".join(recent_names), ROUND_TO),
    "bands": {"high": BAND_HIGH, "medium": BAND_MEDIUM},
    "privacy": "Zone-level only. This file carries no per-block figures, no "
               "exact counts and no individual locations. It is what the "
               "coordination app reads.",
    "total_expected": total,
    "zones": zones,
}

path = os.path.join(OUT, "zones.json")
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, separators=(",", ":"), allow_nan=False)
print("\n  wrote data/out/zones.json  %.1f KB" % (os.path.getsize(path) / 1024))
