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

Wired to the backend repo's live Supabase project
(`siapatodia8/dsa-hackathon-2026`). Nothing on that side was changed — the
frontend was reshaped to fit the schema, not the other way round.

The URL and publishable key are defaults in `src/lib/supabase.ts`, the same
values their `src/supabaseClient.js` commits, and for the same reason: it is
the publishable/anon key, and RLS controls what it can do. `.env` overrides
both. `VITE_SUPABASE_OFFLINE=1` forces the localStorage path, which is worth
knowing if venue wifi blocks outbound mid-demo.

### What their schema actually gives us

`claims` has exactly four writable columns: `zone_id`, `restaurant_name`,
`quantity`, `status`. There is no restaurants table and no auth — their RLS is
deliberately trust-based for the demo. So:

- **Registration is local.** It exists to fill in `restaurant_name` on every
  claim rather than to create an account. `lib/account.ts` never touches the
  network.
- **Food type and drop window have no column.** The claim sheet still collects
  them and they are stored locally, keyed by claim id, so the device that
  entered them still shows them. The shared board carries the business and the
  quantity. The Drops screen says so rather than implying they synced.
- **Cancelling is a status change,** matching their deliberate lack of a
  DELETE policy, so the SB 1383 trail stays intact.

### Coverage comes from the server, not from us

`zones.coverage_pct` and `coverage_status` are generated columns driven by a
trigger that sums only claims created since
`app_state.current_service_night_started_at`. That table is RLS-locked with no
policies, so the client cannot reproduce the server's idea of "tonight" — a
client-side sum would quietly disagree with it. The store reads their numbers
instead. `zones` has no Realtime publication on their side (also deliberate),
so a `claims` event refetches both.

Their realtime settle window is copied too: Supabase can report `SUBSCRIBED`
just before the replication filter is bound, so a write made immediately after
subscribing can be missed.

### Two bugs this integration surfaced

Their need denominators are fractional — Golden Hill is 20.3. Rounding it for
display gave a card reading "~20 expected" where bringing exactly 20 left the
zone at 99% and still open. Displayed need is now rounded **up**: you cannot
bring 0.3 of a meal, and the number on the card has to be one that finishes the
job. The claim sheet's suggested quantity had the same flaw — it rounded to the
nearest 5, pre-filling 20 against a need of 21 — and now rounds up too.

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
