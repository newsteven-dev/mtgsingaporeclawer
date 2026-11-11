-- Daily prices for the cards of recent sets, used to find price movers
-- (applied as migration "set_price_history").
-- One row per Singapore day, set and card (regular non-foil printing).
create table public.set_card_prices (
  day date not null,
  set_code text not null,
  set_name text not null,
  card_name text not null,
  ck_nm_usd numeric(10,2),
  ck_url text,
  tcg_usd numeric(10,2),
  recorded_at timestamptz not null default now(),
  primary key (day, set_code, card_name)
);
create index set_card_prices_set_day_idx on public.set_card_prices (set_code, day desc);

alter table public.set_card_prices enable row level security;
-- No policies: only the service role (server) can read/write.
revoke all on public.set_card_prices from anon, authenticated;

-- Biggest Card Kingdom NM price changes in a set: the latest day vs the earliest day within
-- the last p_days days (so it works with fewer days of history too). Cards under
-- p_min_usd at both ends are ignored to keep tiny-price noise out.
create function public.set_price_movers(p_set_code text, p_days integer default 7, p_limit integer default 5, p_min_usd numeric default 1)
returns table (card_name text, old_day date, new_day date, old_usd numeric, new_usd numeric, change_pct numeric, ck_url text)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select max(day) as new_day,
           (select min(day) from public.set_card_prices
             where set_code = p_set_code and day >= (select max(day) from public.set_card_prices where set_code = p_set_code) - p_days) as old_day
    from public.set_card_prices
    where set_code = p_set_code
  ),
  pairs as (
    select n.card_name, b.old_day, b.new_day, o.ck_nm_usd as old_usd, n.ck_nm_usd as new_usd, n.ck_url
    from bounds b
    join public.set_card_prices n on n.set_code = p_set_code and n.day = b.new_day
    join public.set_card_prices o on o.set_code = p_set_code and o.day = b.old_day and o.card_name = n.card_name
    where b.old_day < b.new_day and o.ck_nm_usd > 0 and n.ck_nm_usd is not null
      and greatest(o.ck_nm_usd, n.ck_nm_usd) >= p_min_usd
  )
  select card_name, old_day, new_day, old_usd, new_usd,
         round((new_usd - old_usd) / old_usd * 100, 1) as change_pct, ck_url
  from pairs
  where new_usd <> old_usd
  order by abs((new_usd - old_usd) / old_usd) desc, new_usd desc
  limit least(greatest(coalesce(p_limit, 5), 1), 50);
$$;

-- Days of history available for a set (to explain when movers will appear).
create function public.set_price_days(p_set_code text)
returns table (first_day date, last_day date, days bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select min(day), max(day), count(distinct day) from public.set_card_prices where set_code = p_set_code;
$$;

revoke all on function public.set_price_movers(text, integer, integer, numeric) from public, anon, authenticated;
revoke all on function public.set_price_days(text) from public, anon, authenticated;
grant execute on function public.set_price_movers(text, integer, integer, numeric) to service_role;
grant execute on function public.set_price_days(text) to service_role;
