# Backend handoff

**For whoever owns the Supabase project.** The UI is finished and already
talks to your project. There is exactly one thing to do, and it is one paste.

---

## 1. Run the migration

Supabase dashboard → **SQL Editor** → New query → paste all of
[`supabase/migration_002_offers.sql`](../supabase/migration_002_offers.sql) →
**Run**.

Safe to re-run: every statement is `if not exists` or `or replace`, with one
exception noted below.

**If you get `relation "offers" is already member of publication`** — that is
the one non-idempotent line. Delete just this and re-run:

```sql
alter publication supabase_realtime add table public.offers;
```

**Then check Realtime is actually on:** Database → Publications →
`supabase_realtime` → make sure `offers` is toggled on. Without it the UI
falls back to a 20-second poll, which works but is not the demo.

That is the whole job. Nothing to deploy, nothing to configure in the app.

---

## 2. What it does

Adds one table, `offers`, and widens one existing function.

**Nothing existing is dropped or altered.** `claims`, `zones`, `app_state`,
your RLS policies, the nightly `pg_cron` reset — all untouched and all still
counting exactly as they do now.

### Why a new table and not columns on `claims`

The product split in two. A restaurant posts what it has; a **volunteer**
collects it and decides which zone it goes to. So food exists before it has a
destination — and `claims.zone_id` is `NOT NULL`, which cannot represent that
middle state. An `offer` starts with `zone_id` null and acquires one at
drop-off.

### The one existing thing that changes

`sync_zone_food_claimed()` gets a new body. It used to sum tonight's `claims`;
it now sums `claims` **and** `offers` through a shared `zone_food_total()`
helper. So `food_claimed`, and therefore the generated `coverage_pct` and
`coverage_status`, keep working — they just see both sources.

The trigger on `claims` already calls that function, so it picks up the new
body automatically. Offers get their own trigger.

---

## 3. The contract the UI depends on

These names are wired into the frontend. Renaming any of them breaks it, so
tell me first and I will change the app rather than you working around it.

### `offers`

| Column | Notes |
|---|---|
| `id` | uuid |
| `restaurant_name`, `address` | not null. `contact` optional |
| `food_type`, `quantity` | quantity is numeric, 0 < q ≤ 5000 |
| `notes` | optional, shown to the driver |
| `pickup_from`, `pickup_to` | timestamptz window, `to > from` |
| `status` | `open` → `accepted` → `delivered`, or `cancelled` |
| `volunteer_name` | null until accepted |
| `zone_id` | **null until drop-off**, then FK to `zones.zone_id` |
| `accepted_at`, `delivered_at`, `created_at` | timestamps |

### Statuses carry meaning, not just labels

- `open` — in every volunteer's feed
- `accepted` — one volunteer has it; leaves everyone else's feed
- `delivered` — counted in the restaurant's donation total and its CSV
- `cancelled` — restaurant withdrew it

**`accepted` and `delivered` both count toward `zones.food_claimed`.** An
`open` offer has no destination yet; a `cancelled` one is not coming.

### Deliberately no DELETE policy

Matching `claims`. Withdrawing sets `status = 'cancelled'` so the donation
trail survives for SB 1383 and the restaurant's tax export. A compliance log
with rows silently missing is worse than no log.

### Zone ids must keep matching

The frontend ships its own copy of the zone model (geometry, cross-streets,
shelter counts) and joins on `zone_id`. All eight already match your
`data/derived/zone_need.csv` — `city_center`, `east_village_north`,
`east_village_south`, `northwest_downtown`, `southwest_downtown`,
`outside_barrio_logan`, `outside_sherman_heights`, `outside_golden_hill`.

If the model is ever re-run with different ids, the app needs
`python scripts/rebuild_all.py && npm run sync:data --prefix app` to follow.

---

## 4. How to check it worked

Reload the app. The header line under the title changes:

| Before | After |
|---|---|
| `Zones live · offers on this device` | `Live board · downtown San Diego` |

That is the app detecting the table and switching itself over. No code change,
no redeploy — it probes on boot and falls back on `PGRST205`.

To prove the trigger fires, post an offer as a restaurant, take it as a
volunteer, drop it on a zone, then:

```sql
select zone_id, food_claimed, coverage_pct, coverage_status
from zones order by food_claimed desc limit 3;
```

`food_claimed` should include the offer's `quantity`.

---

## 5. Known gaps, for you to decide on

**No auth.** Your RLS is trust-based for the demo, so the app has no login.
`restaurant_name` and `volunteer_name` are typed once and kept in
localStorage. If you add Supabase Auth, the change is small and local: the app
keeps identity in `app/src/lib/account.ts` and nothing else touches it. The
natural shape is `created_by uuid references auth.users` on `offers`, with the
RLS narrowed to owner-writes.

**Offers posted before the migration stay on the device that made them.**
They live in localStorage and do not migrate up. Simplest answer is to post
fresh ones for the demo; say the word if you want an importer instead.

**No distance or routing.** The volunteer feed filters by pickup time only.
`address` is free text, not geocoded — sorting runs by how far away they are
would need lat/lng on `offers`.

---

## Where things live

| | |
|---|---|
| Migration | `supabase/migration_002_offers.sql` |
| Their original schema | `supabase/schema.sql` |
| App's typed mirror of the API | `app/src/lib/backend.ts` |
| Read/write logic and the local fallback | `app/src/lib/store.ts` |
| Connection config | `app/src/lib/supabase.ts`, `app/.env.example` |
