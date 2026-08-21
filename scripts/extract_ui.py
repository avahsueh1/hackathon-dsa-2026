#!/usr/bin/env python3
"""Unpack index.html into something a person can read and edit.

index.html is one self-contained file, which is the whole point of the
deliverable -- but 85% of it is inlined JSON, so it is useless to hand
someone to work on.

    python3 scripts/extract_ui.py              # -> ui/  (a folder, + ui.zip)
    python3 scripts/extract_ui.py --single     # -> ui-source.html (one file)

THE FOLDER

    ui/
      index.html    markup only, ~30 KB
      styles.css    every style
      app.js        every line of behaviour
      data.js       the built JSON as one global
      README.md     how it fits together

    It still opens by double-click, offline, no server. That is why the data
    is a .js file assigning a global rather than a .json file: browsers block
    fetch() and XHR on file:// URLs, but <script src> and <link> load fine.

Both outputs are git-ignored: they are derived from index.html, so a committed
copy would drift the moment anyone edited the real file. index.html stays the
source of truth.
"""

import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "index.html")
SINGLE = os.path.join(ROOT, "ui-source.html")
FOLDER = os.path.join(ROOT, "ui")
ZIP = os.path.join(ROOT, "ui.zip")

BEGIN = "/*__DATA_BEGIN__*/"
END = "/*__DATA_END__*/"

DATA_KEYS = """     geometry  382 block polygons + centroids       (build_heatmap_data.py)
     values    people per block per month           (build_heatmap_data.py)
     insights  concentration headline stats         (build_heatmap_data.py)
     zones     10 delivery zones + need bands       (build_zones.py)
     shelters  HIC beds, occupancy, FY25 funding    (build_shelter_data.py)
     health    HCAI clinics and hospitals           (build_health_data.py)
     transit   MTS trolley lines and stations       (build_transit_data.py)
     plan      siting recommendations               (build_siting_model.py)"""

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
%s

   Everything except geometry/values/insights is optional -- the page hides the
   matching layer or tab when its key is null.
   --------------------------------------------------------------------- */
{"geometry":null,"values":null,"insights":null,"zones":null,
 "shelters":null,"health":null,"transit":null,"plan":null}""" % DATA_KEYS


def read_page():
    if not os.path.exists(PAGE):
        sys.exit("no index.html -- run scripts/rebuild_all.py first")
    with open(PAGE, encoding="utf-8") as fh:
        html = fh.read()
    if BEGIN not in html or END not in html:
        sys.exit("index.html has no data markers")
    return html


def write_single(html):
    i, j = html.index(BEGIN), html.index(END) + len(END)
    out = html[:i] + BEGIN + "\n" + NOTE + "\n" + END + html[j:]
    with open(SINGLE, "w", encoding="utf-8") as fh:
        fh.write(out)
    print("ui-source.html  %8.1f KB   (%.0f%% of index.html was data)"
          % (len(out) / 1024.0, 100 * (len(html) - len(out)) / float(len(html))))


FOLDER_README = """# Surplus -> Street -- UI package

Open `index.html`. It works offline, by double-click, with no server and no
install.

## What is what

| File | |
|---|---|
| `index.html` | Markup only: the four tabs, the claim modal, the drop table. |
| `styles.css` | Every style. Design tokens at the top, then layout, then the app. |
| `app.js` | Every line of behaviour: zones, the claim loop, the SVG map, box-select, the siting plan, the SB 1383 export. |
| `data.js` | The built data as one global, `window.HEATMAP_DATA`. |

## Why `data.js` and not `data.json`

Browsers block `fetch()` and `XHR` on `file://` URLs, so a `.json` file would
mean this only ran behind a web server. A `.js` file assigning a global loads
from `<script src>` like any other script, so the folder stays double-clickable.

`data.js` is generated. To change what is in it, edit the Python in the repo's
`scripts/` and re-run `python3 scripts/rebuild_all.py`.

## Editing

This folder is a **snapshot for reading and prototyping**. The repo's
`index.html` is the source of truth -- it is one self-contained file, which is
a hard requirement of the deliverable, and it is what the build writes to.

If you change something here and want to keep it, port it back into
`index.html` and rebuild.

## One gotcha

The stylesheet is global and single-file, and a class-name collision is silent.
`.bar` was already the map controls row; reusing that name for the comparison
bars collapsed them to zero width with no error. Prefix new classes.
"""


def write_folder(html):
    # --- pull the pieces out
    m = re.search(r"<style>(.*?)</style>", html, re.S)
    if not m:
        sys.exit("could not find the <style> block")
    css = m.group(1).strip("\n")
    html_no_css = html[:m.start()] + '<link rel="stylesheet" href="styles.css">' \
        + html[m.end():]

    i = html_no_css.index(BEGIN)
    j = html_no_css.index(END) + len(END)
    blob = html_no_css[i + len(BEGIN):j - len(END)]
    # build_page.py escapes </ so the JSON cannot close its host <script> tag.
    blob = blob.replace("<\\/", "</").strip()

    # the data <script> block that contained it goes away entirely
    ds = html_no_css.rindex("<script", 0, i)
    de = html_no_css.index("</script>", j) + len("</script>")
    html_no_data = html_no_css[:ds] + '<script src="data.js"></script>' \
        + html_no_css[de:]

    m2 = re.search(r"<script>(.*?)</script>\s*</body>", html_no_data, re.S)
    if not m2:
        sys.exit("could not find the app <script> block")
    js = m2.group(1).strip("\n")
    shell = html_no_data[:m2.start()] + '<script src="app.js"></script>\n</body>' \
        + html_no_data[m2.end():]

    # --- the app reads the inline JSON; point it at the global instead
    js, n = re.subn(
        r'var RAW = document\.getElementById\("heatmap-data"\)\.textContent;\s*'
        r'var DATA = JSON\.parse\([^;]*?\);',
        "// Supplied by data.js, which assigns window.HEATMAP_DATA.\n"
        "var DATA = window.HEATMAP_DATA;",
        js, count=1, flags=re.S)
    if n != 1:
        sys.exit("could not repoint the data reader -- did index.html change?")

    if os.path.isdir(FOLDER):
        shutil.rmtree(FOLDER)
    os.makedirs(FOLDER)

    files = {
        "index.html": shell,
        "styles.css": css + "\n",
        "app.js": js + "\n",
        "data.js": "// Generated by scripts/rebuild_all.py. Do not edit by hand.\n"
                   "window.HEATMAP_DATA = " + blob + ";\n",
        "README.md": FOLDER_README,
    }
    for name, body in files.items():
        with open(os.path.join(FOLDER, name), "w", encoding="utf-8") as fh:
            fh.write(body)

    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for name in files:
            z.write(os.path.join(FOLDER, name), "ui/" + name)

    print("ui/")
    for name in ["index.html", "styles.css", "app.js", "data.js", "README.md"]:
        print("  %-12s %8.1f KB" % (name, os.path.getsize(os.path.join(FOLDER, name)) / 1024.0))
    print("ui.zip         %8.1f KB" % (os.path.getsize(ZIP) / 1024.0))


def main():
    html = read_page()
    if "--single" in sys.argv:
        write_single(html)
    else:
        write_folder(html)
        if "--also-single" in sys.argv:
            write_single(html)


if __name__ == "__main__":
    main()
