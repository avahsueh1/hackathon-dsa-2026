# Surplus → Street — UI package

The built front end, on its own branch, with the files at the root so it can be
served as-is.

**Open `index.html`.** It works offline, by double-click, with no server and
nothing to install.

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

## This branch is generated

It is built from `index.html` on the `heatmap` branch by:

```bash
python3 scripts/extract_ui.py
```

`heatmap` is the source of truth — it holds the data pipeline, the scripts and
the single-file `index.html` the build writes to. **Edits made here will be
overwritten** the next time this branch is regenerated. Port them back.

## One gotcha if you do edit

The stylesheet is global and single-file, and a class-name collision is silent.
`.bar` was already the map controls row; reusing that name for the comparison
bars collapsed them to zero width with no error at all. Prefix new classes.
