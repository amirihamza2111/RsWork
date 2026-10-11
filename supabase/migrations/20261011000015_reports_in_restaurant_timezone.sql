-- Reports used UTC days and hours, so for a restaurant in Tunis (UTC+1) peak
-- hours showed an hour early and "today" reset at 01:00. They now use the
-- restaurant's settings.timezone; sign-up records the browser's timezone.

-- The restaurant's IANA timezone, or UTC when unset or unknown.
create or replace function private.restaurant_tz(p_restaurant uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.settings ->> 'timezone'
     from public.restaurants r
     where r.id = p_restaurant
       and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = r.settings ->> 'timezone')),
    'UTC')
$$;

revoke all on function private.restaurant_tz(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------- onboarding
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_name text := nullif(btrim(v_meta ->> 'name'), '');
  v_restaurant_name text := nullif(btrim(v_meta ->> 'restaurant_name'), '');
  v_timezone text := v_meta ->> 'timezone';
  v_role text := 'client';
  v_restaurant uuid;
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_timezone) then
    v_timezone := null;
  end if;

  if v_app ? 'staff_role' then
    if v_app ->> 'staff_role' not in ('waiter', 'cashier', 'cook', 'manager', 'superadmin') then
      raise exception 'invalid staff role';
    end if;
    v_role := v_app ->> 'staff_role';
    v_restaurant := private.try_uuid(v_app ->> 'restaurant_id');
  elsif v_restaurant_name is not null then
    insert into public.restaurants (name, settings)
    values (
      left(v_restaurant_name, 120),
      jsonb_strip_nulls(jsonb_build_object(
        'currency', coalesce(nullif(left(v_meta ->> 'currency', 8), ''), 'TND'),
        'language', case when v_meta ->> 'language' in ('ar', 'fr', 'en') then v_meta ->> 'language' else 'fr' end,
        'timezone', v_timezone))
    )
    returning id into v_restaurant;
    v_role := 'manager';
  end if;

  insert into public.profiles (id, name, email, role, phone, restaurant_id)
  values (
    new.id,
    left(coalesce(v_name, split_part(new.email, '@', 1)), 120),
    lower(new.email),
    v_role,
    nullif(left(v_meta ->> 'phone', 40), ''),
    v_restaurant
  );

  if v_restaurant_name is not null and not (v_app ? 'staff_role') then
    update public.restaurants set owner_id = new.id where id = v_restaurant;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- reports
-- Revenue counts PAID orders only (money actually collected). Days and hours
-- are in the restaurant's timezone.
create or replace function public.report_dashboard(p_restaurant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_day_start timestamptz;
  v_result jsonb;
begin
  perform private.require_staff(p_restaurant, array['manager']);
  v_tz := private.restaurant_tz(p_restaurant);
  v_day_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  select jsonb_build_object(
    'totalOrdersToday', count(*) filter (where created_at >= v_day_start),
    'totalRevenueToday', coalesce(sum(total_amount) filter (
                           where created_at >= v_day_start and payment_status = 'paid'), 0),
    'pendingOrders', count(*) filter (where status = 'pending'),
    'occupiedTables', (select count(*) from public.tables
                       where restaurant_id = p_restaurant and status = 'occupied'))
  into v_result
  from public.orders where restaurant_id = p_restaurant;
  return v_result;
end;
$$;

create or replace function public.report_weekly(p_restaurant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
begin
  perform private.require_staff(p_restaurant, array['manager']);
  v_tz := private.restaurant_tz(p_restaurant);
  v_today := (now() at time zone v_tz)::date;
  return (
    select jsonb_agg(jsonb_build_object(
             'date', to_char(d.day, 'YYYY-MM-DD'),
             'totalOrders', coalesce(s.orders, 0),
             'totalRevenue', coalesce(s.revenue, 0)) order by d.day)
    from generate_series(v_today - 6, v_today, interval '1 day') as d(day)
    left join (
      select (created_at at time zone v_tz)::date as day,
             count(*) as orders,
             sum(case when payment_status = 'paid' then total_amount else 0 end) as revenue
      from public.orders
      where restaurant_id = p_restaurant
        and created_at >= (v_today - 6)::timestamp at time zone v_tz
      group by 1
    ) s on s.day = d.day::date);
end;
$$;

-- Inputs for the AI business report (the narrative and forecast are added by
-- the `ai-report` Edge Function). Defaults to the last 30 days.
create or replace function public.report_ai_analytics(
  p_restaurant uuid,
  p_start date default null,
  p_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_end date;
  v_start date;
  v_days integer;
  v_from timestamptz;
  v_to timestamptz;
  v_prev_from timestamptz;
  r public.restaurants;
  v_totals jsonb;
  v_prev jsonb;
  v_peak_days jsonb;
begin
  perform private.require_staff(p_restaurant, array['manager']);
  v_tz := private.restaurant_tz(p_restaurant);
  v_today := (now() at time zone v_tz)::date;
  v_end := coalesce(p_end, v_today);
  v_start := coalesce(p_start, v_end - 29);
  if v_start > v_end then
    perform private.fail(400, 'start must be on or before end');
  end if;
  v_days := v_end - v_start + 1;
  v_from := v_start::timestamp at time zone v_tz;
  v_to := (v_end + 1)::timestamp at time zone v_tz;
  v_prev_from := (v_start - v_days)::timestamp at time zone v_tz;

  select * into r from public.restaurants where id = p_restaurant;

  select jsonb_build_object(
           'orders', count(*),
           'revenue', coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0),
           'cancelled', count(*) filter (where status = 'cancelled'))
  into v_totals
  from public.orders where restaurant_id = p_restaurant and created_at >= v_from and created_at < v_to;

  select jsonb_build_object(
           'orders', count(*),
           'revenue', coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0))
  into v_prev
  from public.orders where restaurant_id = p_restaurant and created_at >= v_prev_from and created_at < v_from;

  select jsonb_agg(jsonb_build_object(
           'label', (array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[d + 1],
           'orders', coalesce(s.orders, 0),
           'revenue', coalesce(s.revenue, 0)) order by d)
  into v_peak_days
  from generate_series(0, 6) as d
  left join (
    select extract(dow from created_at at time zone v_tz)::integer as dow,
           count(*) as orders,
           sum(case when payment_status = 'paid' then total_amount else 0 end) as revenue
    from public.orders
    where restaurant_id = p_restaurant and created_at >= v_from and created_at < v_to
    group by 1
  ) s on s.dow = d;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'name', coalesce(r.name, 'Restaurant'), 'address', coalesce(r.address, ''),
      'phone', coalesce(r.phone, ''), 'currency', coalesce(r.settings ->> 'currency', 'TND'),
      'timezone', v_tz),
    'period', jsonb_build_object(
      'start', to_char(v_start, 'YYYY-MM-DD'), 'end', to_char(v_end, 'YYYY-MM-DD'), 'days', v_days),
    'totals', v_totals || jsonb_build_object(
      'avgOrderValue', case when (v_totals ->> 'orders')::integer > 0
                            then (v_totals ->> 'revenue')::numeric / (v_totals ->> 'orders')::integer
                            else 0 end),
    'comparison', jsonb_build_object(
      'prevOrders', v_prev -> 'orders',
      'prevRevenue', v_prev -> 'revenue',
      'ordersGrowthPct', case when (v_prev ->> 'orders')::numeric = 0
        then case when (v_totals ->> 'orders')::numeric > 0 then 100 else 0 end
        else round(((v_totals ->> 'orders')::numeric - (v_prev ->> 'orders')::numeric)
                   / (v_prev ->> 'orders')::numeric * 100, 1) end,
      'revenueGrowthPct', case when (v_prev ->> 'revenue')::numeric = 0
        then case when (v_totals ->> 'revenue')::numeric > 0 then 100 else 0 end
        else round(((v_totals ->> 'revenue')::numeric - (v_prev ->> 'revenue')::numeric)
                   / (v_prev ->> 'revenue')::numeric * 100, 1) end),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object('date', day, 'orders', orders, 'revenue', revenue) order by day)
      from (
        select to_char(created_at at time zone v_tz, 'YYYY-MM-DD') as day,
               count(*) as orders,
               sum(case when payment_status = 'paid' then total_amount else 0 end) as revenue
        from public.orders
        where restaurant_id = p_restaurant and created_at >= v_from and created_at < v_to
        group by 1) t), '[]'::jsonb),
    'topItems', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'revenue', revenue) order by quantity desc)
      from (
        select coalesce(m.name ->> 'fr', 'Unknown item') as name,
               sum(i.quantity) as quantity,
               sum(i.quantity * i.price) as revenue
        from public.order_items i
        join public.orders o on o.id = i.order_id
        left join public.menu_items m on m.id = i.menu_item_id
        where o.restaurant_id = p_restaurant and o.status <> 'cancelled'
          and o.created_at >= v_from and o.created_at < v_to
        group by i.menu_item_id, m.name
        order by quantity desc
        limit 5) top), '[]'::jsonb),
    'peakHours', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'orders', orders) order by orders desc, hour)
      from (
        select extract(hour from created_at at time zone v_tz)::integer as hour, count(*) as orders
        from public.orders
        where restaurant_id = p_restaurant and created_at >= v_from and created_at < v_to
        group by 1 order by 2 desc, 1 limit 3) h), '[]'::jsonb),
    'busiestDay', (select d from jsonb_array_elements(v_peak_days) d
                   order by (d ->> 'orders')::integer desc limit 1),
    'peakDays', v_peak_days,
    -- 90-day daily history (cancellations excluded from revenue) for the forecast.
    'history', (
      select jsonb_agg(jsonb_build_object(
               'date', to_char(g.day, 'YYYY-MM-DD'),
               'orders', coalesce(s.orders, 0),
               'revenue', coalesce(s.revenue, 0)) order by g.day)
      from generate_series(v_today - 89, v_today, interval '1 day') g(day)
      left join (
        select (created_at at time zone v_tz)::date as day,
               count(*) as orders,
               sum(case when status = 'cancelled' then 0 else total_amount end) as revenue
        from public.orders
        where restaurant_id = p_restaurant
          and created_at >= (v_today - 89)::timestamp at time zone v_tz
        group by 1) s on s.day = g.day::date));
end;
$$;
