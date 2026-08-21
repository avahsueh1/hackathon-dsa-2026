# Merging with the backend repo

Backend: <https://github.com/siapatodia8/dsa-hackathon-2026>
Frontend: this repo, `heatmap` branch

Both repos independently built a zone model. This is the plan for combining
them, and the short version is: **their need model wins, my front end consumes
it.** That is already done and working locally — nothing is pushed.

## Who brings what

| | Backend repo | This repo |
|---|---|---|
| Zone definitions | **8 zones**, with operational merges | 10 zones, one per neighbourhood |
| Need model | **baseline + 311 pressure − claimed** | mean of 3 recent months |
| 311 "Get It Done" data | **yes, 3,873 matched reports** | none |
| Supabase schema + RLS | **yes** | a competing draft |
| The app itself | — | **4 tabs, claim loop, SB 1383 export, EyePop hook** |
| Block-level analysis | — | **heat map, shelter siting, health/transit overlays** |

## Decision 1 — their zones win

Not a coin toss. Their model is better on three counts:

1. It works from the **block-level panel directly** (methodology-adjusted survey
   totals), rather than disaggregating monthly area totals down to blocks the
   way mine did. Fewer inferential steps.
2. It carries the **311 encampment signal**, which is the live input the brief
   asks for and which I never had.
3. Its **8 zones reflect an operational judgement** — Columbia+Cortez and
   Gaslamp+Marina merged, East Village split north/south — about how many
   drop-offs a volunteer can realistically cover. That is not a data question.

**Already implemented.** `scripts/build_zones.py` now reads
`data/backend/zone_need.csv` + `zones.geojson` when present and uses them
verbatim; my neighbourhood grouping is only the fallback for a machine that has
not synced. Verified: 8 zones, all 382 blocks covered, and each zone card in
the app now shows its own provenance —

> East Village South · 379 from 12 street counts · **+13 from 1,444 recent 311 reports**

To take an update from them, see "Decided: two repos, one sync command" below.

## Decision 2 — where zones live

Their `zones` table holds `need_score` server-side and recomputes when the
pipeline runs. My app inlines zones as static data so it works offline.

**Keep both, in that order:** inline zones as the offline fallback, and let the
adapter refresh `need_score` from the `zones` table when connected. A dead
network at 10pm should degrade to yesterday's numbers, not a blank screen.

## Decision 3 — the claims table needs two columns

This is the one real blocker, and it is small.

Their `claims` table:

```sql
id uuid, zone_id text, restaurant_name text,
quantity numeric, status text, created_at timestamptz
```

The app writes two more fields, and **SB 1383 record-keeping needs both** — a
donation log that does not say what was donated or when it was dropped is not
much of a log:

```sql
alter table claims add column if not exists drop_window      text;
alter table claims add column if not exists food_description text;
```

Non-breaking, both nullable. Everything else maps cleanly:

| App | Their column |
|---|---|
| `zone` | `zone_id` |
| `who` | `restaurant_name` |
| `meals` | `quantity` |
| `date` | `created_at` (date part) |
| `status` | `status` |
| `when` | **`drop_window`** ← add |
| `what` | **`food_description`** ← add |

## The adapter, against their schema

Drop this in once the two columns exist. `rowToClaim` is the only place the
names are coupled, so if they would rather rename, change it here and nowhere
else.

```js
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const rowToClaim = r => ({
  id: r.id,
  zone: r.zone_id,
  zone_name: (ZONES_BY_ID[r.zone_id] || {}).name || r.zone_id,
  meals: Number(r.quantity),
  when: r.drop_window || "Tonight",
  what: r.food_description || "",
  who: r.restaurant_name,
  date: (r.created_at || "").slice(0, 10),
  status: r.status
});

window.SurplusStore.adapter = {
  list: () => sb.from("claims").select("*").order("created_at")
    .then(({ data, error }) => { if (error) throw error; return data.map(rowToClaim); }),

  insert: (c) => sb.from("claims").insert({
    zone_id: c.zone, restaurant_name: c.who, quantity: c.meals,
    drop_window: c.when, food_description: c.what, status: c.status
  }).then(({ error }) => { if (error) throw error; }),

  update: (id, patch) => sb.from("claims").update({ status: patch.status })
    .eq("id", id).then(({ error }) => { if (error) throw error; }),

  remove: (id) => sb.from("claims").update({ status: "cancelled" })
    .eq("id", id).then(({ error }) => { if (error) throw error; }),

  clear: () => Promise.resolve(),

  subscribe: (fn) => sb.channel("claims")
    .on("postgres_changes", { event: "*", schema: "public", table: "claims" }, fn)
    .subscribe()
};

window.SurplusStore.init();
```

Their RLS already allows public read/insert/update on `claims`, and they have
Realtime enabled on that table — which is exactly what this needs.

## Two things to raise with them

1. **`status = 'cancelled'` needs to survive.** The app cancels by setting
   status rather than deleting, so the SB 1383 trail stays intact. Their RLS
   has no DELETE policy, which already gives us this — worth confirming it is
   deliberate.
2. **RLS is currently open to anyone with the anon key.** They flagged this
   themselves in a comment, and it is the right call for a demo. Worth saying
   out loud in the pitch before a judge asks, alongside the privacy framing.

## Decided: two repos, one sync command

The repos stay **independent** — separate pipelines, separate histories,
neither team blocked on the other. The one seam between them is their zone
model, and taking an update is a single command:

```bash
python3 scripts/sync_backend.py     # pull their data/derived/ into data/backend/
python3 scripts/rebuild_all.py      # rebuild the app on it
```

`--dry-run` shows what would change first, and `--from ../dsa-hackathon-2026`
reads a local clone instead of GitHub if you are offline or they have not
pushed yet.

The synced files are **committed here too**, so this repo builds with no
network. The sync is how you take their updates; it is not a build dependency.

### It refuses to sync a model that changed shape

The dangerous failure is not a broken sync — it is a *successful* one that
quietly produces a plausible map with wrong numbers on it. So the script
checks the columns `build_zones.py` actually reads and stops before writing:

```
STOP: their zone model no longer has column(s) the app reads:
  need_tier

Nothing written.
```

Verified by renaming `need_tier` in a fake copy of their repo: it stopped,
named the column, exited non-zero, and left `data/backend/` untouched.

It also warns if the zones stop covering all 382 blocks.

### Diffs on every sync

```
  changes:
    ~ east_village_south       392.0 -> 401.5 (+9.5)
```

So a shifting need score is something you notice, rather than something that
silently changes what the app tells a driver.

## Still open

- **Who owns `zones.json`** long term. Right now their pipeline produces
  `zone_need.csv` and this repo adapts it. If they would rather emit the app's
  format directly, `build_zones.py` collapses to almost nothing.
- **The two claim columns** above need adding before the adapter can be wired.
