-- Surplus -> Street: surplus offers, and the volunteer run that moves them.
--
-- Run this in the Supabase SQL Editor of the shared project, after
-- supabase/schema.sql. It is additive: nothing existing is dropped, and the
-- `claims` table keeps working exactly as it does today.
--
-- ---------------------------------------------------------------------------
-- Why a new table rather than more columns on `claims`
--
-- `claims` models "this restaurant is bringing N meals to THIS zone" -- the
-- restaurant picks the destination. The product now splits that in two:
--
--   a restaurant posts what it has and when it can be collected, and
--   a volunteer collects it and decides which zone it goes to.
--
-- So a piece of food exists before it has a destination, which `claims`
-- cannot represent: claims.zone_id is NOT NULL. An offer therefore starts
-- with zone_id null and acquires one when a volunteer routes it.
-- ---------------------------------------------------------------------------

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),

  -- who is giving the food away
  restaurant_name text not null,
  address         text not null,
  contact         text,

  -- what, and how much of it
  food_type   text not null,
  quantity    numeric not null check (quantity > 0 and quantity <= 5000),
  notes       text,

  -- when it can be collected. A window, not an instant: "between 9 and 10"
  -- is what a kitchen can actually promise at the end of service.
  pickup_from timestamptz not null,
  pickup_to   timestamptz not null,
  constraint offers_pickup_window check (pickup_to > pickup_from),

  -- the run
  --   open      posted, nobody collecting it
  --   accepted  a volunteer is collecting it
  --   delivered dropped at zone_id
  --   cancelled the restaurant withdrew it, or nobody came
  status text not null default 'open'
    check (status in ('open', 'accepted', 'delivered', 'cancelled')),

  -- No auth on this project yet (see schema.sql), so the volunteer is a name
  -- rather than a user. Swap for a uuid referencing auth.users when it lands.
  volunteer_name text,

  -- Chosen by the volunteer at drop-off, which is the whole point of the
  -- split. Null until then.
  zone_id text references public.zones (zone_id),

  accepted_at  timestamptz,
  delivered_at timestamptz,
  created_at   timestamptz not null default now()
);

-- The volunteer's feed is "open offers, soonest pickup first", and the
-- restaurant's list is "mine, newest first".
create index if not exists offers_status_pickup_idx
  on public.offers (status, pickup_from);
create index if not exists offers_restaurant_idx
  on public.offers (restaurant_name, created_at desc);
create index if not exists offers_zone_idx
  on public.offers (zone_id);

alter table public.offers enable row level security;

-- Same trust-based posture as `claims`: no user auth exists yet, so the
-- publishable key can read and write. A production version gates these behind
-- restaurant and volunteer accounts.
drop policy if exists "Public read offers" on public.offers;
create policy "Public read offers"
  on public.offers for select
  using (true);

drop policy if exists "Public insert offers" on public.offers;
create policy "Public insert offers"
  on public.offers for insert
  with check (true);

drop policy if exists "Public update offers" on public.offers;
create policy "Public update offers"
  on public.offers for update
  using (true);

-- Deliberately no DELETE policy, matching `claims`: withdrawing an offer sets
-- status = 'cancelled' so the donation trail stays intact for SB 1383.

-- Realtime. This is the product: a restaurant posts surplus and it appears on
-- every volunteer's phone without a refresh, and when one volunteer accepts
-- it, it leaves everyone else's list.
alter publication supabase_realtime add table public.offers;

-- ---------------------------------------------------------------------------
-- Coverage
--
-- zones.food_claimed drives coverage_pct and coverage_status. It is currently
-- the sum of tonight's `claims`. Food routed by a volunteer has to count the
-- same way, so this replaces the function body to sum BOTH sources.
--
-- Additive on purpose: existing claims keep counting exactly as they did, so
-- anything already built against `claims` is unaffected.
--
-- Only accepted and delivered offers count -- an open offer has no
-- destination yet, and a cancelled one is not coming.
-- ---------------------------------------------------------------------------

create or replace function public.zone_food_total(target text, night_start timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select sum(quantity) from claims
      where zone_id = target
        and status in ('claimed', 'delivered')
        and created_at >= night_start
    ), 0)
    +
    coalesce((
      select sum(quantity) from offers
      where zone_id = target
        and status in ('accepted', 'delivered')
        and created_at >= night_start
    ), 0);
$$;

create or replace function public.sync_zone_food_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_zone_id text;
  night_start timestamptz;
begin
  target_zone_id := coalesce(new.zone_id, old.zone_id);
  select current_service_night_started_at into night_start from app_state where id = 1;

  if target_zone_id is not null then
    update zones
    set food_claimed = zone_food_total(target_zone_id, night_start)
    where zone_id = target_zone_id;
  end if;

  -- A row that moved between zones has to leave the old one behind.
  if (tg_op = 'UPDATE'
      and old.zone_id is not null
      and old.zone_id is distinct from new.zone_id) then
    update zones
    set food_claimed = zone_food_total(old.zone_id, night_start)
    where zone_id = old.zone_id;
  end if;

  return coalesce(new, old);
end;
$$;

-- The trigger on `claims` already calls this function, so it picks up the new
-- body automatically. Offers need their own.
drop trigger if exists offers_sync_food_claimed on public.offers;
create trigger offers_sync_food_claimed
  after insert or update or delete on public.offers
  for each row
  execute function public.sync_zone_food_claimed();

-- reset_nightly_coverage() already zeroes zones.food_claimed and moves the
-- service-night marker; offers rows are never touched by it, so the donation
-- history survives the reset the same way claims do.
