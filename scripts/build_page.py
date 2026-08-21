#!/usr/bin/env python3
"""Inline data/out/*.json into index.html.

index.html is both the source and the deliverable: it carries a marked region

    /*__DATA_BEGIN__*/ ... /*__DATA_END__*/

inside a <script type="application/json"> block, and this script rewrites what
sits between the markers. Idempotent -- the markers survive every build, so you
can edit the page freely and re-run this to refresh the data.

That keeps spec section 8's promise honest: one self-contained file, no
external requests, nothing to fetch at runtime.

    python3 scripts/build_heatmap_data.py && python3 scripts/build_page.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "out")
PAGE = os.path.join(ROOT, "index.html")

BEGIN = "/*__DATA_BEGIN__*/"
END = "/*__DATA_END__*/"

REQUIRED = (("geometry", "geometry.json"),
            ("values", "values.json"),
            ("insights", "insights.json"))
# Built by build_transit_data.py / build_shelter_data.py. The page degrades to
# hiding those layers if either is absent, so the heat map alone still builds.
OPTIONAL = (("transit", "transit.json"),
            ("shelters", "shelters.json"),
            ("health", "health.json"))

payload = {}
for key, name in REQUIRED:
    path = os.path.join(OUT, name)
    if not os.path.exists(path):
        sys.exit("missing %s -- run scripts/build_heatmap_data.py first" % path)
    with open(path, encoding="utf-8") as fh:
        payload[key] = json.load(fh)

for key, name in OPTIONAL:
    path = os.path.join(OUT, name)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            payload[key] = json.load(fh)
    else:
        payload[key] = None
        print("  note: %s absent, that layer will be hidden" % name)

blob = json.dumps(payload, separators=(",", ":"), allow_nan=False)

# A literal </script> inside the JSON would close the host tag early. None of
# this data contains one, but the guard costs nothing and the failure mode is
# a silently blank page.
blob = blob.replace("</", "<\\/")

with open(PAGE, encoding="utf-8") as fh:
    html = fh.read()

if BEGIN not in html or END not in html:
    sys.exit("index.html has no %s ... %s region to fill" % (BEGIN, END))

pattern = re.compile(re.escape(BEGIN) + ".*?" + re.escape(END), re.S)
html, n = pattern.subn(lambda _: BEGIN + blob + END, html, count=1)
if n != 1:
    sys.exit("could not rewrite the data region")

with open(PAGE, "w", encoding="utf-8") as fh:
    fh.write(html)

size = os.path.getsize(PAGE)
print("inlined %d blocks x %d months into index.html"
      % (len(payload["geometry"]["blocks"]), len(payload["values"]["months"])))
print("  index.html  %.1f KB  (self-contained, 0 external requests)" % (size / 1024))
