#!/usr/bin/env python3
"""Write ui-source.html: index.html with the inlined data stripped out.

index.html is ~1 MB, and 85% of that is JSON. Readable as a browser page,
useless as something to hand a teammate to edit. This produces the same file
with the data region replaced by a note -- about 154 KB, all of it code.

The output is git-ignored on purpose: it is derived from index.html, so a
committed copy would drift the moment anyone edits the real file. Regenerate
it whenever you need to share the source.

    python3 scripts/extract_ui.py
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "index.html")
OUT = os.path.join(ROOT, "ui-source.html")

BEGIN = "/*__DATA_BEGIN__*/"
END = "/*__DATA_END__*/"

NOTE = """/* ---------------------------------------------------------------------
   DATA GOES HERE.

   This is the UI source for Surplus -> Street, with the inlined JSON stripped
   out so it is readable. As-is the page renders its shell and then stops,
   because DATA is empty.

   To get a running page, put this back at the repo root as index.html and run:

       python3 scripts/rebuild_all.py

   build_page.py replaces everything between the __DATA_BEGIN__ and __DATA_END__
   markers with the built JSON. The markers survive every build, so index.html
   is both the thing you edit and the thing that ships.

   The shape it expects:
     geometry  382 block polygons + centroids       (build_heatmap_data.py)
     values    people per block per month           (build_heatmap_data.py)
     insights  concentration headline stats         (build_heatmap_data.py)
     zones     10 delivery zones + need bands       (build_zones.py)
     shelters  HIC beds, occupancy, FY25 funding    (build_shelter_data.py)
     health    HCAI clinics and hospitals           (build_health_data.py)
     transit   MTS trolley lines and stations       (build_transit_data.py)
     plan      siting recommendations               (build_siting_model.py)

   Everything except geometry/values/insights is optional -- the page hides the
   matching layer or tab when its key is null.
   --------------------------------------------------------------------- */
{"geometry":null,"values":null,"insights":null,"zones":null,
 "shelters":null,"health":null,"transit":null,"plan":null}"""

if not os.path.exists(PAGE):
    sys.exit("no index.html -- run scripts/rebuild_all.py first")

with open(PAGE, encoding="utf-8") as fh:
    html = fh.read()

if BEGIN not in html or END not in html:
    sys.exit("index.html has no data markers to strip")

i = html.index(BEGIN)
j = html.index(END) + len(END)
stripped = html[:i] + BEGIN + "\n" + NOTE + "\n" + END + html[j:]

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write(stripped)

before, after = len(html) / 1024.0, len(stripped) / 1024.0
print("index.html      %8.1f KB" % before)
print("ui-source.html  %8.1f KB   (%.0f%% of it was data)"
      % (after, 100 * (before - after) / before))
