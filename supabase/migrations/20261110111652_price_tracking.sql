-- Price history for searched cards (applied as migration "price_tracking").

-- One row per (card, store) price check.
create table public.price_snapshots (
  id bigint generated always as identity primary key,
  card_name text not null,
  card_key text generated always as (lower(card_name)) stored,
  store text not null,
  captured_at timestamptz not null default now(),
  listing_count integer not null default 0,
  in_stock_count integer not null default 0,
  min_price numeric(10,2),
  min_price_nonfoil numeric(10,2),
  min_price_foil numeric(10,2)
);
create index price_snapshots_card_time_idx on public.price_snapshots (card_key, captured_at desc);
create index price_snapshots_time_idx on public.price_snapshots (captured_at desc);

-- In-stock listings captured with each snapshot.
create table public.price_listings (
  id bigint generated always as identity primary key,
  snapshot_id bigint not null references public.price_snapshots(id) on delete cascade,
  title text not null,
  set_name text,
  set_code text,
  condition text,
  finish text check (finish in ('foil','nonfoil')),
  price numeric(10,2) not null,
  stock integer,
  url text
);
create index price_listings_snapshot_idx on public.price_listings (snapshot_id);

alter table public.price_snapshots enable row level security;
alter table public.price_listings enable row level security;
-- No policies: only the service role (server) can read/write.

-- Daily cheapest in-stock price per card/store.
create view public.card_price_daily with (security_invoker = true) as
select
  card_key,
  max(card_name) as card_name,
  store,
  (captured_at at time zone 'Asia/Singapore')::date as day,
  min(min_price) as min_price,
  min(min_price_nonfoil) as min_price_nonfoil,
  min(min_price_foil) as min_price_foil,
  max(in_stock_count) as in_stock_count
from public.price_snapshots
group by card_key, store, (captured_at at time zone 'Asia/Singapore')::date;

-- Cards searched in the last 30 days, with the cheapest price now vs ~7 days ago.
create view public.trending_cards with (security_invoker = true) as
with latest as (
  select distinct on (card_key, store) card_key, card_name, store, min_price, captured_at
  from public.price_snapshots
  order by card_key, store, captured_at desc
),
week_ago as (
  select distinct on (card_key, store) card_key, store, min_price
  from public.price_snapshots
  where captured_at <= now() - interval '7 days'
  order by card_key, store, captured_at desc
),
activity as (
  select card_key, max(card_name) as card_name, count(distinct date_trunc('hour', captured_at)) as checks_30d, max(captured_at) as last_checked
  from public.price_snapshots
  where captured_at > now() - interval '30 days'
  group by card_key
)
select
  a.card_key,
  a.card_name,
  a.checks_30d,
  a.last_checked,
  (select min(l.min_price) from latest l where l.card_key = a.card_key) as cheapest_now,
  (select l.store from latest l where l.card_key = a.card_key and l.min_price is not null order by l.min_price limit 1) as cheapest_store,
  (select min(w.min_price) from week_ago w where w.card_key = a.card_key) as cheapest_7d_ago
from activity a;

-- Insert a snapshot and its in-stock listings in one call.
create function public.record_price_snapshot(p_card_name text, p_store text, p_listings jsonb)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
  v_all integer := coalesce(jsonb_array_length(p_listings), 0);
begin
  insert into public.price_snapshots (card_name, store, listing_count, in_stock_count, min_price, min_price_nonfoil, min_price_foil)
  select p_card_name, p_store, v_all,
         count(*) filter (where (l->>'inStock')::boolean),
         min((l->>'price')::numeric) filter (where (l->>'inStock')::boolean),
         min((l->>'price')::numeric) filter (where (l->>'inStock')::boolean and l->>'finish' = 'nonfoil'),
         min((l->>'price')::numeric) filter (where (l->>'inStock')::boolean and l->>'finish' = 'foil')
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

revoke all on function public.record_price_snapshot(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_price_snapshot(text, text, jsonb) to service_role;
revoke all on public.price_snapshots, public.price_listings, public.card_price_daily, public.trending_cards from anon, authenticated;
