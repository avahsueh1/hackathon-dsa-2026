# Surplus -> Street -- UI package

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
