# Surplus → Street — the app

React + Vite + TypeScript. react-leaflet for the map, supabase-js for the
backend. Replaces the single-file `index.html` build at the repo root, which
stays in git as a reference.

```bash
npm install
npm run dev
```

## Why a fixed phone frame

The old build had a desktop layout with a `max-width: 860px` mobile override,
and the two disagreed — an unscoped desktop rule that landed later in the
sheet won on source order, and a flex item's default `min-width: auto` let a
sideways-scrolling rail size its own ancestors to 921px inside a 390px
viewport. Both bugs came from having two layouts.

So there is one. `.device` renders a 9:16 portrait frame at every screen size:
edge-to-edge on a phone (below 560px, with the safe-area insets), centred on a
dim backdrop on a laptop. No breakpoint can disagree with another because
there is only one.

## Data

`src/data/*.json` is a committed snapshot of the Python pipeline's output, so
`npm install && npm run dev` works on a fresh clone. To adopt a new zone model:

```bash
python scripts/rebuild_all.py && npm run sync:data --prefix app
```

`npm run dev` and `npm run build` both run `sync:data` first, so a rebuilt
pipeline is picked up automatically on the machine that has `data/out/`.

## Backend

With no env vars the app runs entirely on localStorage and the demo works
offline — including claiming, the coverage flip and the SB 1383 export. Point
it at the backend repo's Supabase project by copying `.env.example` to `.env`:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Both values are statically folded at build time, so with them unset Rollup
tree-shakes supabase-js out of the bundle entirely; with them set it comes back
as a ~220 KB chunk. Verified both ways.

`supabase/schema.sql` at the repo root is the target shape. The backend still
needs two nullable columns on `claims`:

```sql
alter table public.claims add column if not exists drop_window text;
alter table public.claims add column if not exists food_description text;
```

## Layout

- `src/App.tsx` — the landing gate, tab state, claim-in-progress, toast.
- `src/components/MobileShell.tsx` — header, scrolling `main`, bottom tab bar, `Hero`.
- `src/screens/` — `Landing`, `Tonight`, `MapScreen`, `Drops`, `Account`, `ClaimSheet`.
- `src/components/ZoneMap.tsx` — react-leaflet, real block polygons, coverage
  donut badges, three-tier colouring.
- `src/lib/store.ts` / `account.ts` — external stores; Supabase or localStorage
  behind one interface, so no component knows which is running.

The components and CSS are ported from the Claude Design export in
`surplus-street-mobile-vite.md`; the tokens are byte-identical to it. Two
deliberate departures, both commented at the point of departure: the design's
rail divides its width evenly (unreadable with eight real zones on a 390px
phone, so the tickets keep a legible width and the wire scrolls), and the
design's `app.css` fills the viewport rather than using a fixed frame.
