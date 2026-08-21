# Adding a panel

Two machines are pushing to this repo. `index.html` is one big file, so the
worst thing you can do is both edit it and then spend the hackathon resolving a
merge. You do not have to.

**Drop files into `src/panels/`. `build_page.py` inlines them automatically.**

Nothing else changes. `index.html` keeps three markers, and every build injects
your content just above them:

| You add | Goes into |
|---|---|
| `src/panels/*.html` | the page, just before the sources footer |
| `src/panels/*.js`   | the app script, with all the data already in scope |
| `src/panels/*.css`  | the stylesheet |

Files are inlined in filename order, so prefix them: `20-forecast.html`,
`20-forecast.js`. Pick a number nobody else is using and you will never
conflict, because git merges two new files cleanly.

## The smallest possible panel

`src/panels/30-example.html`

```html
<section class="tab" id="tab-example" role="tabpanel" hidden>
  <h2 class="secthead">My panel</h2>
  <div class="findings" id="example-body"></div>
</section>
```

`src/panels/30-example.js`

```js
// Runs inside the app IIFE. Everything is already in scope:
//   GEO, V, INS, SHELTERS, HEALTH, TRANSIT, PLAN   -- the data
//   fmt, money, monthName, prettyBlockId, prettyStreet, tok  -- helpers
//   px, py, NS, layer(), applyTransform()          -- map drawing
(function () {
  var el = document.getElementById("example-body");
  if (!el) return;
  el.innerHTML = "<p>" + fmt(V.block_ids.length) + " blocks loaded.</p>";
})();
```

Then register the tab. This is the only line in `index.html` you touch, and it
is one line, so a conflict is trivial to resolve:

```html
<button role="tab" id="tb-example" aria-selected="false"
        aria-controls="tab-example">My panel</button>
```

and add `"example"` to the `TABS` array.

## Adding your own data

Write a `scripts/build_<thing>_data.py` that emits `data/out/<thing>.json`, then
add one line to the `OPTIONAL` tuple in `scripts/build_page.py`:

```python
OPTIONAL = (..., ("thing", "thing.json"))
```

It arrives in the page as `DATA.thing`. Make it **optional**: if the file is
missing the build still succeeds and your panel should hide itself, so a
teammate who has not run your script can still build the page.

## Drawing on the map

```js
var gMine = layer("mine");          // a new <g> inside the pan/zoom viewport
gMine.style.display = "none";
// px(lon) and py(lat) project into map coordinates
```

Add a checkbox with `id="lay-mine"` to the controls row, then
`bindLayer("lay-mine", gMine)`. If your marks should stay the same size as the
map zooms, counter-scale them inside `applyTransform` with `1 / k`.

## House rules

1. **No external requests.** Fetch at build time in your Python script and
   inline the result. A tile fetch dying during the demo costs more than a
   basemap gains (spec §0).
2. **Never edit `data/out/`** — it is generated and git-ignored. Change the
   script that writes it.
3. **Do not touch `geometry.json` or `values.json`.** Layer 3 consumes them
   verbatim (spec §11). Write your own file instead.
4. **Fail the build, not the demo.** If your numbers must hold, assert them in
   your build script the way `build_heatmap_data.py` does.
5. **Say what you cannot support.** If a number is an estimate, label it as one
   on screen. The judges are scoring honesty about uncertainty.

## Checking your work

```bash
python3 scripts/build_page.py
```

It prints how many panel files it inlined, and syntax-checks the whole inline
script with `node --check` if node is installed. A broken string literal in your
JS otherwise produces a blank page and no error at all.
