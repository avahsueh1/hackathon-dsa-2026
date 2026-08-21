#!/usr/bin/env python3
"""Extract a downtown transit layer from the MTS GTFS feed.

Source: https://www.sdmts.com/google_transit_files/google_transit.zip
        (San Diego Metropolitan Transit System, public developer feed)

This is the only part of the project that touches the network, and it does so
at BUILD time only. The result is baked into index.html by build_page.py, so
the delivered page still makes zero external requests and renders offline --
spec section 0 stays intact.

Keeps the 6 trolley lines (GTFS route_type 0), clipped to the downtown block
grid's bounding box, plus the stations inside it. The 98 bus routes are
dropped: at this scale they cover the map and bury the choropleth.

    python3 scripts/build_transit_data.py
"""

import csv
import io
import json
import os
import sys
import zipfile
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "out")
GTFS = os.path.join(RAW, "mts_google_transit.zip")

RAIL_TYPES = {"0", "1", "2"}     # tram, subway, rail. MTS trolley is 0.
MARGIN = 0.004                   # ~400 m, so lines run past the map edge
DP = 5                           # ~1 m, plenty for a route casing


def rows(z, name):
    with z.open(name) as fh:
        for r in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            yield r


if not os.path.exists(GTFS):
    sys.exit("missing %s -- download the MTS feed first" % GTFS)

geom_path = os.path.join(OUT, "geometry.json")
if not os.path.exists(geom_path):
    sys.exit("missing geometry.json -- run scripts/build_heatmap_data.py first")

with open(geom_path, encoding="utf-8") as fh:
    bbox = json.load(fh)["bbox"]

W, S, E, N = bbox[0] - MARGIN, bbox[1] - MARGIN, bbox[2] + MARGIN, bbox[3] + MARGIN


def inside(lon, lat):
    return W <= lon <= E and S <= lat <= N


z = zipfile.ZipFile(GTFS)

feed = next(rows(z, "feed_info.txt"), {})
print("MTS GTFS %s (%s to %s)"
      % (feed.get("feed_version", "?"), feed.get("feed_start_date", "?"),
         feed.get("feed_end_date", "?")))

# ------------------------------------------------------------------ routes

routes = {}
for r in rows(z, "routes.txt"):
    if r["route_type"] not in RAIL_TYPES:
        continue
    # Special-event services (the Magic: The Gathering shuttle) are real rail
    # routes in the feed but do not run on a normal schedule, so putting them
    # in a legend about transit access is misleading.
    if "event" in (r.get("route_long_name", "") + r.get("route_short_name", "")).lower():
        continue
    routes[r["route_id"]] = {
        "id": r["route_id"],
        "name": (r.get("route_short_name") or "").strip(),
        "long_name": (r.get("route_long_name") or "").strip(),
        "color": "#" + (r.get("route_color") or "666666").strip(),
        "text_color": "#" + (r.get("route_text_color") or "ffffff").strip(),
    }
print("  %d rail routes: %s"
      % (len(routes), ", ".join(sorted(v["name"] for v in routes.values()))))

# ------------------------------------------------------------------- trips
# One representative shape per route+direction: the longest, which is the
# variant that runs the whole line rather than a short-turn.

shape_trip = {}                       # shape_id -> a trip_id using it
shape_route = {}                      # shape_id -> route_id
shape_dir = {}                        # shape_id -> direction_id
for t in rows(z, "trips.txt"):
    rid, sid = t["route_id"], t.get("shape_id")
    if rid not in routes or not sid:
        continue
    shape_route[sid] = rid
    shape_dir[sid] = t.get("direction_id", "0")
    shape_trip.setdefault(sid, t["trip_id"])

# ------------------------------------------------------------------ shapes

pts = defaultdict(list)
for s in rows(z, "shapes.txt"):
    sid = s["shape_id"]
    if sid not in shape_route:
        continue
    pts[sid].append((int(s["shape_pt_sequence"]),
                     float(s["shape_pt_lon"]), float(s["shape_pt_lat"])))

best = {}                             # (route_id, direction) -> shape_id
for sid, p in pts.items():
    key = (shape_route[sid], shape_dir[sid])
    if key not in best or len(p) > len(pts[best[key]]):
        best[key] = sid

# Clip to the downtown window. A route can enter, leave and re-enter, so a
# shape becomes a LIST of polylines rather than one.
lines = []
kept_shapes = set()
for (rid, direction), sid in sorted(best.items()):
    seq = sorted(pts[sid])
    run, runs = [], []
    for _, lon, lat in seq:
        if inside(lon, lat):
            run.append([round(lon, DP), round(lat, DP)])
        elif run:
            # carry the first outside point so the line reaches the edge
            run.append([round(lon, DP), round(lat, DP)])
            runs.append(run)
            run = []
    if run:
        runs.append(run)
    runs = [r for r in runs if len(r) >= 2]
    if not runs:
        continue
    kept_shapes.add(sid)
    lines.append({"route_id": rid, "direction": direction, "paths": runs})

used_routes = {l["route_id"] for l in lines}
print("  %d route-directions inside the downtown window (%d routes)"
      % (len(lines), len(used_routes)))

# ------------------------------------------------------------------- stops
# stop_times.txt is ~33 MB, so stream it once and keep only the rows belonging
# to the representative trips.

want_trips = {shape_trip[sid] for sid in kept_shapes if sid in shape_trip}
stop_ids = set()
for st in rows(z, "stop_times.txt"):
    if st["trip_id"] in want_trips:
        stop_ids.add(st["stop_id"])

stations = []
seen = set()
for s in rows(z, "stops.txt"):
    if s["stop_id"] not in stop_ids:
        continue
    try:
        lon, lat = float(s["stop_lon"]), float(s["stop_lat"])
    except (ValueError, KeyError):
        continue
    if not inside(lon, lat):
        continue
    name = (s.get("stop_name") or "").strip()
    # The feed lists a platform per direction; one dot per station is enough.
    key = (name, round(lon, 4), round(lat, 4))
    if key in seen:
        continue
    seen.add(key)
    stations.append({"name": name, "lonlat": [round(lon, DP), round(lat, DP)]})

stations.sort(key=lambda s: s["name"])
print("  %d stations inside the window" % len(stations))

# ------------------------------------------------------------------- write

transit = {
    "attribution": "Transit data © San Diego Metropolitan Transit System (MTS), "
                   "GTFS %s. Retrieved at build time and inlined; the page makes "
                   "no network requests." % feed.get("feed_version", ""),
    "source_url": "https://www.sdmts.com/business-center/app-developers",
    "feed_start": feed.get("feed_start_date", ""),
    "feed_end": feed.get("feed_end_date", ""),
    "routes": [routes[r] for r in sorted(used_routes)],
    "lines": lines,
    "stations": stations,
}

os.makedirs(OUT, exist_ok=True)
path = os.path.join(OUT, "transit.json")
with open(path, "w", encoding="utf-8") as fh:
    json.dump(transit, fh, separators=(",", ":"), allow_nan=False)
print("  wrote data/out/transit.json  %.1f KB" % (os.path.getsize(path) / 1024))
