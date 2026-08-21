-- Proposed. Not run yet -- this is the "what we still need" list.
--
-- The volunteer flow itself is already live: add_volunteer_delivery_flow.sql
-- gave `claims` a nullable zone_id, delivery_mode, volunteer_name and the
-- requested -> accepted -> delivered path. The frontend is integrated against
-- exactly that and works today.
--
-- What it cannot do yet is put a pickup on a map, because a `claims` row does
-- not say where the food is or when it can be collected. The volunteer screen
-- is a map of pings with pickup times on them, so those are the difference
-- between a working map and a list of restaurant names.
--
-- Until this runs, the frontend keeps them in the browser that typed them:
-- the poster sees their own detail, other devices see the name and quantity.
-- Nothing breaks, it is just not shared.
--
-- All nullable, all additive. Safe to re-run.

-- Where the driver goes. Free text as typed by the restaurant.
alter table claims add column if not exists address text;

-- Two numerics, not PostGIS: enough to drop a marker, and this project has no
-- spatial queries. The frontend resolves the typed address against the block
-- network it already ships, so these can be filled client-side on insert.
alter table claims add column if not exists lat numeric;
alter table claims add column if not exists lng numeric;

-- The collection window. A window, not an instant: "between 9 and 10" is what
-- a kitchen can actually promise at the end of service, and it is what the
-- volunteer feed sorts and filters on.
alter table claims add column if not exists pickup_from timestamptz;
alter table claims add column if not exists pickup_to timestamptz;

-- Distinct from drop_location_note, which is about the drop-off. This is
-- "back door on the alley, ask for Marco" -- how to actually get the food.
alter table claims add column if not exists pickup_note text;

-- The volunteer feed is "open requests, soonest collection first".
create index if not exists claims_volunteer_feed_idx
  on claims (delivery_mode, status, pickup_from);

-- ---------------------------------------------------------------------------
-- One thing that is NOT needed, for the record
--
-- sync_zone_food_claimed() already counts status 'claimed', and the frontend
-- sets zone_id and status='claimed' together the moment a volunteer takes a
-- pickup and chooses where it goes. So a zone's coverage moves at pickup
-- time, which is what the product wants, with no trigger change at all.
--
-- If you would rather the volunteer path used 'accepted' for that state
-- instead, the trigger would need 'accepted' added to both of its
-- `status in (...)` lists -- otherwise the food would be invisible to
-- coverage between pickup and drop-off.
-- ---------------------------------------------------------------------------
