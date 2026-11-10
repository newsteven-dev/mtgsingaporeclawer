-- Top searched cards for one day or month (Singapore time), and the periods that have searches
-- (applied as migration "top_searched_cards").

create function public.top_searched_cards(p_period text, p_start date, p_limit integer default 20)
returns table (card_name text, searches bigint, last_searched timestamptz, cheapest numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with e as (
    select card_key, card_name, searched_at, cheapest,
           (searched_at at time zone 'Asia/Singapore')::date as day
    from public.search_events
  )
  select max(card_name) as card_name,
         count(*) as searches,
         max(searched_at) as last_searched,
         min(cheapest) as cheapest
  from e
  where case when p_period = 'month'
             then date_trunc('month', e.day)::date = date_trunc('month', p_start)::date
             else e.day = p_start end
  group by card_key
  order by count(*) desc, max(searched_at) desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

create function public.search_periods(p_period text)
returns table (period date, searches bigint, cards bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with e as (
    select card_key,
           case when p_period = 'month'
                then date_trunc('month', (searched_at at time zone 'Asia/Singapore')::date)::date
                else (searched_at at time zone 'Asia/Singapore')::date end as period
    from public.search_events
  )
  select period, count(*) as searches, count(distinct card_key) as cards
  from e
  group by period
  order by period desc;
$$;

revoke all on function public.top_searched_cards(text, date, integer) from public, anon, authenticated;
revoke all on function public.search_periods(text) from public, anon, authenticated;
grant execute on function public.top_searched_cards(text, date, integer) to service_role;
grant execute on function public.search_periods(text) to service_role;
