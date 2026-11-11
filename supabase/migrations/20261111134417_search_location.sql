-- Approximate location of the visitor who made each search (applied as migration "search_location").
-- Worked out on the server from the visitor's IP address with an offline city database (DB-IP Lite).
-- The IP address itself is never stored.
alter table public.price_snapshots
  add column location_city text,
  add column location_region text,
  add column location_country text;

-- Replace the 3-argument save function with one that also takes the location.
-- p_location defaults to null, so a server still sending three arguments keeps working.
drop function public.record_price_snapshot(text, text, jsonb);

create function public.record_price_snapshot(p_card_name text, p_store text, p_listings jsonb, p_location jsonb default null)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
  v_all integer := coalesce(jsonb_array_length(p_listings), 0);
begin
  insert into public.price_snapshots (card_name, store, listing_count, in_stock_count, min_price, min_price_nonfoil, min_price_foil,
                                      location_city, location_region, location_country)
  select p_card_name, p_store, v_all,
         count(*) filter (where (l->>'inStock')::boolean),
         min((l->>'price')::numeric) filter (where (l->>'inStock')::boolean),
         min((l->>'price')::numeric) filter (where (l->>'inStock')::boolean and l->>'finish' = 'nonfoil'),
         min((l->>'price')::numeric) filter (where (l->>'inStock')::boolean and l->>'finish' = 'foil'),
         nullif(left(p_location->>'city', 100), ''),
         nullif(left(p_location->>'region', 100), ''),
         nullif(upper(left(p_location->>'country', 2)), '')
  from jsonb_array_elements(coalesce(p_listings, '[]'::jsonb)) l
  returning id into v_id;

  insert into public.price_listings (snapshot_id, title, set_name, set_code, condition, finish, price, stock, url)
  select v_id, l->>'title', nullif(l->>'set',''), nullif(l->>'setCode',''), nullif(l->>'condition',''),
         l->>'finish', (l->>'price')::numeric, (l->>'stock')::integer, l->>'url'
  from jsonb_array_elements(coalesce(p_listings, '[]'::jsonb)) l
  where (l->>'inStock')::boolean and l->>'price' is not null;

  return v_id;
end;
$$;

revoke all on function public.record_price_snapshot(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_price_snapshot(text, text, jsonb, jsonb) to service_role;

-- search_events gains the searcher's location (new columns go at the end).
create or replace view public.search_events with (security_invoker = true) as
with ordered as (
  select s.*,
         case when captured_at - lag(captured_at) over (partition by card_key order by captured_at) < interval '2 minutes'
              then 0 else 1 end as is_new
  from public.price_snapshots s
),
grouped as (
  select *, sum(is_new) over (partition by card_key order by captured_at rows unbounded preceding) as grp
  from ordered
)
select
  card_key,
  max(card_name) as card_name,
  min(captured_at) as searched_at,
  count(distinct store) as stores_checked,
  array_agg(distinct store) as stores,
  array_agg(id order by store, captured_at) as snapshot_ids,
  sum(in_stock_count) as in_stock_listings,
  min(min_price) as cheapest,
  (array_agg(store order by min_price nulls last))[1] as cheapest_store,
  (array_agg(location_city order by captured_at) filter (where location_country is not null))[1] as location_city,
  (array_agg(location_region order by captured_at) filter (where location_country is not null))[1] as location_region,
  (array_agg(location_country order by captured_at) filter (where location_country is not null))[1] as location_country
from grouped
group by card_key, grp;

-- Searches per location, most first.
create view public.search_locations with (security_invoker = true) as
select
  location_country as country,
  location_region as region,
  location_city as city,
  count(*) as searches,
  count(distinct card_key) as cards,
  max(searched_at) as last_searched
from public.search_events
where location_country is not null
group by location_country, location_region, location_city;

revoke all on public.search_events, public.search_locations from anon, authenticated;
