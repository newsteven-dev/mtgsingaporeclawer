-- Views behind the signed-in "Captured searches" page (applied as migration "search_log_views").
-- search_events and captured_cards are redefined by 20261110131015_search_events_gap_grouping.sql.

-- One row per search: the store checks for a card made within the same minute.
create view public.search_events with (security_invoker = true) as
select
  card_key,
  max(card_name) as card_name,
  date_trunc('minute', captured_at) as searched_at,
  count(*) as stores_checked,
  array_agg(store order by store) as stores,
  array_agg(id order by store) as snapshot_ids,
  sum(in_stock_count) as in_stock_listings,
  min(min_price) as cheapest,
  (array_agg(store order by min_price nulls last))[1] as cheapest_store
from public.price_snapshots
group by card_key, date_trunc('minute', captured_at);

-- One row per card ever searched.
create view public.captured_cards with (security_invoker = true) as
select
  card_key,
  max(card_name) as card_name,
  count(distinct date_trunc('minute', captured_at)) as searches,
  min(captured_at) as first_searched,
  max(captured_at) as last_searched,
  min(min_price) filter (where captured_at > now() - interval '1 day') as cheapest_last_24h
from public.price_snapshots
group by card_key;

revoke all on public.search_events, public.captured_cards from anon, authenticated;
