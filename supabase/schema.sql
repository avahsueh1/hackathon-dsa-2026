-- Surplus -> Street : the only table the app needs.
--
-- Everything else (zones, block geometry, shelters, the siting model) is
-- static reference data built by scripts/ and shipped in the page. It changes
-- when someone ingests a new street count, roughly monthly, and belongs in git
-- rather than in Postgres.

create table if not exists public.claims (
  id               uuid primary key default gen_random_uuid(),
  zone             text not null,                 -- matches zones.json .zones[].id
  zone_name        text not null,
  meals            integer not null check (meals > 0 and meals <= 5000),
  drop_window      text not null,                 -- "Tonight, 8-9pm"
  food_description text,
  donor_name       text,                          -- replace with auth once it lands
  drop_date        date not null default current_date,
  status           text not null default 'claimed'
                   check (status in ('claimed','delivered','cancelled')),
  created_by       uuid references auth.users (id) default auth.uid(),
  created_at       timestamptz not null default now()
);

-- The list query is "tonight's live claims", so index what it filters on.
create index if not exists claims_zone_status_idx
  on public.claims (zone, status);
create index if not exists claims_drop_date_idx
  on public.claims (drop_date desc);

-- Realtime: this is the product. Another restaurant claims a zone and every
-- other screen has to show it without a refresh.
alter publication supabase_realtime add table public.claims;

alter table public.claims enable row level security;

-- READ: any verified user sees every claim. This is deliberate -- you cannot
-- avoid two restaurants covering the same corner if you cannot see each
-- other's claims. Nothing in a row identifies an individual: it records that a
-- business is bringing food to a neighbourhood.
create policy "verified users read all claims"
  on public.claims for select
  to authenticated
  using (true);

-- WRITE: you may only post as yourself...
create policy "users insert their own claims"
  on public.claims for insert
  to authenticated
  with check (created_by = auth.uid());

-- ...and only amend or cancel your own drop.
create policy "users update their own claims"
  on public.claims for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- Deliberately no DELETE policy. The app cancels by setting
-- status = 'cancelled' instead, so the SB 1383 donation trail stays intact --
-- a compliance log with rows silently missing is worse than no log.
