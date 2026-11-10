-- Regroup searches by time gaps instead of clock minutes (applied as migration "search_events_gap_grouping").

-- A "search" is a run of store checks for the same card with gaps under 2 minutes.
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
  (array_agg(store order by min_price nulls last))[1] as cheapest_store
from grouped
group by card_key, grp;

-- One row per card ever searched.
create or replace view public.captured_cards with (security_invoker = true) as
select
  card_key,
  max(card_name) as card_name,
  (select count(*) from public.search_events e where e.card_key = s.card_key) as searches,
  min(captured_at) as first_searched,
  max(captured_at) as last_searched,
  min(min_price) filter (where captured_at > now() - interval '1 day') as cheapest_last_24h
from public.price_snapshots s
group by card_key;

revoke all on public.search_events, public.captured_cards from anon, authenticated;
