# Wiring up a backend

Short answer: **yes, easily.** One seam, already cut and tested against a fake
async backend including realtime.

## What is dynamic, and what is not

This matters more than the API shape. Do not put the whole app in Postgres.

| | Where it lives | Why |
|---|---|---|
| **Claims** | the backend | The only thing that changes minute to minute, and the only thing that must be *shared* between restaurants. |
| Zones, need model, block geometry, shelters, health, transit, siting plan | `data.js` / inlined JSON, built by `scripts/` and versioned in git | 872 KB of static reference data that changes when someone ingests a new street count — roughly monthly. Putting it in a database buys nothing and costs a round trip on every page load. |

If a new count arrives, the answer is `python3 scripts/ingest.py` and a redeploy,
not a migration. See [UPLOADING_DATA.md](UPLOADING_DATA.md).

## The seam

Every read and write of a claim goes through one object, exposed as
`window.SurplusStore`:

```js
window.SurplusStore.adapter = { /* your implementation */ };
window.SurplusStore.init();
```

With no adapter it uses `localStorage` and works offline, which is what the
demo does today.

### Why it is shaped this way

The UI renders synchronously; Supabase is promise-based. Rather than turn every
call site into an `async` function, the store keeps an **in-memory cache**:

- **reads are synchronous** against the cache, so the render path never knows a
  network exists
- **writes are optimistic** — the cache updates and the screen repaints
  immediately, then the write goes out. A claim button that hangs for 400ms at
  closing time is worse than one that occasionally has to roll back.
- **`Store.onChange`** repaints. Realtime pushes into the same path, so a claim
  from another restaurant lands exactly like one of your own.

## The adapter interface

```js
{
  list()             // -> Promise<claim[]>
  insert(claim)      // -> Promise
  update(id, patch)  // -> Promise
  remove(id)         // -> Promise
  clear()            // -> Promise   (demo convenience; optional)
  subscribe(fn)      // -> void      (optional; call fn() on any change)
}
```

## A claim

```js
{
  id:        "c0-gaslamp",        // see "things to agree" below
  zone:      "gaslamp",           // matches zones.json .zones[].id
  zone_name: "Gaslamp",
  meals:     45,
  when:      "Tonight, 8-9pm",
  what:      "Pasta trays, bread",
  who:       "Trattoria on 5th",
  date:      "2026-08-21",        // YYYY-MM-DD
  status:    "claimed"            // "claimed" | "delivered" | "cancelled"
}
```

`status: "cancelled"` is filtered out everywhere rather than deleted, so
cancellations stay in the SB 1383 export trail.

## Supabase adapter

```js
const sb = supabase.createClient(URL, ANON_KEY);

const rowToClaim = r => ({
  id: r.id, zone: r.zone, zone_name: r.zone_name, meals: r.meals,
  when: r.drop_window, what: r.food_description, who: r.donor_name,
  date: r.drop_date, status: r.status
});

window.SurplusStore.adapter = {
  list: () => sb.from("claims")
    .select("*").neq("status", "cancelled").order("created_at")
    .then(({ data, error }) => { if (error) throw error; return data.map(rowToClaim); }),

  insert: (c) => sb.from("claims").insert({
    zone: c.zone, zone_name: c.zone_name, meals: c.meals,
    drop_window: c.when, food_description: c.what,
    donor_name: c.who, drop_date: c.date, status: c.status
  }).then(({ error }) => { if (error) throw error; }),

  update: (id, patch) => sb.from("claims").update({ status: patch.status })
    .eq("id", id).then(({ error }) => { if (error) throw error; }),

  remove: (id) => sb.from("claims").update({ status: "cancelled" })
    .eq("id", id).then(({ error }) => { if (error) throw error; }),

  clear: () => Promise.resolve(),   // not something a real deployment offers

  subscribe: (fn) => sb.channel("claims")
    .on("postgres_changes", { event: "*", schema: "public", table: "claims" }, fn)
    .subscribe()
};

window.SurplusStore.init();
```

Schema and row-level security: [`../supabase/schema.sql`](../supabase/schema.sql).

## Accounts

Registering once removes the "Your business" field from every claim and makes
the SB 1383 log attribute drops to the right business. Same adapter pattern:

```js
window.SurplusAccount.adapter = {
  get:      ()        => Promise /* -> restaurant | null */,
  register: (details) => Promise /* -> restaurant */,
  signOut:  ()        => Promise
};
```

With Supabase Auth the shape is roughly:

```js
window.SurplusAccount.adapter = {
  get: async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from("restaurants").select("*").maybeSingle();
    return data && { name: data.name, address: data.address, type: data.business_type,
                     contact: data.contact_name, email: data.email, phone: data.phone,
                     typical: data.typical_meals, days: data.surplus_days || [] };
  },
  register: async (d) => {
    // magic link, so there is no password to build a reset flow for
    await sb.auth.signInWithOtp({ email: d.email });
    const { data, error } = await sb.from("restaurants").upsert({
      name: d.name, address: d.address, business_type: d.type,
      contact_name: d.contact, email: d.email, phone: d.phone,
      typical_meals: d.typical, surplus_days: d.days
    }).select().single();
    if (error) throw error;
    return d;
  },
  signOut: () => sb.auth.signOut()
};
```

`restaurants` is in [`../supabase/schema.sql`](../supabase/schema.sql). Note its
RLS is **owner-only**, unlike `claims`: a restaurant's contact details help no
other donor, and it is the one place the app holds personal data.

Once auth is live the app should take `who` from the session rather than the
form. It already prefers a registered account over the free-text field, so that
is a small edit.

## Three things to agree before either of you writes code

1. **Who generates `id`.** The demo makes a client-side string
   (`"c0-gaslamp"`). With a real database the id should be a `uuid` default —
   which means `insert()` must not send one, and `list()` maps it back. The
   adapter above already assumes this.
2. **`who` should come from auth, not a text field.** The brief calls for
   verified accounts only. Once Supabase Auth is in, `donor_name` comes from
   the session and the "Your business" input disappears. That is a UI change on
   my side — tell me when auth lands and it is a ten-minute edit.
3. **Field names.** I have used `drop_window` / `food_description` /
   `donor_name` / `drop_date` in the SQL because `when`, `what` and `date` are
   awkward or reserved in Postgres. If their schema already exists, keep
   theirs and change `rowToClaim` — that mapping function is the only place
   names are coupled.

## Row-level security is the privacy story

The brief promises verified accounts only. In RLS terms:

- **read**: any authenticated user reads every claim. That is the product — you
  cannot avoid double-booking a zone if you cannot see other people's claims.
- **write**: a user inserts only as themselves, and updates or cancels only
  their own rows.

Both policies are in the SQL. Note there is nothing sensitive in a claim: it
records that a restaurant is bringing food to a *neighbourhood*. No individual
is ever named or located, by design — see the privacy section of the README.

## Testing without a backend

The adapter contract was verified against a stub with artificial latency: init
subscribes and lists, a claim calls `insert`, and a row pushed in from
"another restaurant" repaints the zone as covered and updates the header
counters. If their adapter satisfies the six methods above, it will work.

Keep `localStorage` as the fallback. A dead backend at 10pm should degrade to a
single-restaurant tool, not a blank screen — `Store.refresh()` already swallows
errors and keeps the last good cache.
