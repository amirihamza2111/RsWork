-- Staff RPCs: kitchen/waiter/cashier workflows, sections, settings, reports.
-- Every function authorizes the caller with private.require_staff().

-- ------------------------------------------------------------------ orders
create or replace function public.kds_orders(p_restaurant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(p_restaurant, array['cook', 'waiter', 'manager']);
  -- Oldest first = front of the queue.
  return coalesce((
    select jsonb_agg(private.order_json(o.id, true) order by o.created_at)
    from public.orders o
    where o.restaurant_id = p_restaurant
      and o.status in ('pending', 'confirmed', 'preparing', 'ready')), '[]'::jsonb);
end;
$$;

-- Cashier lookup: unpaid, non-cancelled orders for a table number.
create or replace function public.active_orders_by_table(p_restaurant uuid, p_table_number integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tables;
  v_orders jsonb;
  v_due numeric;
begin
  perform private.require_staff(p_restaurant, array['cashier', 'manager']);
  if p_table_number is null or p_table_number <= 0 then
    perform private.fail(400, 'A valid tableNumber is required');
  end if;
  select * into t from public.tables where restaurant_id = p_restaurant and number = p_table_number;
  if not found then
    perform private.fail(404, 'Table not found');
  end if;

  select coalesce(jsonb_agg(private.order_json(o.id, true) order by o.created_at), '[]'::jsonb),
         coalesce(sum(o.total_amount), 0)
  into v_orders, v_due
  from public.orders o
  where o.table_id = t.id and o.status <> 'cancelled' and o.payment_status <> 'paid';

  return jsonb_build_object(
    'table', jsonb_build_object('id', t.id, 'number', t.number),
    'count', jsonb_array_length(v_orders),
    'totalDue', v_due,
    'orders', v_orders);
end;
$$;

-- A waiter claims an unassigned order; the first claimer wins.
create or replace function public.claim_order(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_me public.profiles;
  v_owner text;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then
    perform private.fail(404, 'Order not found');
  end if;
  v_me := private.require_staff(o.restaurant_id, array['waiter', 'manager']);

  if o.waiter_id is not null and o.waiter_id <> v_me.id then
    select name into v_owner from public.profiles where id = o.waiter_id;
    perform private.fail(409, 'Already claimed by ' || coalesce(v_owner, 'another waiter'));
  end if;

  update public.orders set waiter_id = v_me.id where id = o.id;
  perform private.emit_order(o.id, array['order_updated']);
  return private.order_json(o.id, true);
end;
$$;

-- Order-level transition (state machine), e.g. a waiter marking it served.
create or replace function public.set_order_status(p_order uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_me public.profiles;
  v_allowed text[];
begin
  if p_status not in ('pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled') then
    perform private.fail(400, 'Please provide a valid status');
  end if;

  -- The row lock serializes double-taps: the loser sees the new status.
  select * into o from public.orders where id = p_order for update;
  if not found then
    perform private.fail(404, 'Order not found');
  end if;
  v_me := private.require_staff(o.restaurant_id, array['manager', 'cook', 'waiter']);

  v_allowed := case o.status
    when 'pending' then array['confirmed', 'preparing', 'cancelled']
    when 'confirmed' then array['preparing', 'cancelled']
    when 'preparing' then array['ready', 'cancelled']
    when 'ready' then array['served', 'cancelled']
    else array[]::text[] end;
  if o.status <> p_status and not (p_status = any (v_allowed)) then
    if o.status in ('served', 'cancelled') and p_status in ('served', 'cancelled') then
      perform private.fail(409, format('Order was already moved to ''%s''', o.status));
    end if;
    perform private.fail(400, format('Cannot change order status from ''%s'' to ''%s''', o.status, p_status));
  end if;

  update public.orders
  set status = p_status,
      -- A waiter who picks up an unassigned order becomes its waiter.
      waiter_id = case when v_me.role = 'waiter' and waiter_id is null then v_me.id else waiter_id end,
      served_by_id = case when p_status = 'served' then v_me.id else served_by_id end
  where id = o.id;
  if p_status = 'served' then
    update public.order_items set status = 'served' where order_id = o.id;
  end if;

  perform private.emit_order(o.id,
    case when p_status = 'ready' then array['order_updated', 'order_ready'] else array['order_updated'] end);
  return private.order_json(o.id, true);
end;
$$;

-- Per-dish KDS status. The first cook to touch a ticket owns it; the order
-- status is rolled up from its items.
create or replace function public.set_item_status(p_order uuid, p_item uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_me public.profiles;
  i public.order_items;
  v_allowed text[];
  v_new_status text;
  v_total integer;
  v_served integer;
  v_kitchen integer;
  v_progress_done integer;
  v_progress_total integer;
  v_started integer;
begin
  if p_status not in ('queued', 'preparing', 'ready', 'served') then
    perform private.fail(400, 'Please provide a valid item status');
  end if;

  select * into o from public.orders where id = p_order for update;
  if not found then
    perform private.fail(404, 'Order not found');
  end if;
  v_me := private.require_staff(o.restaurant_id, array['manager', 'cook', 'waiter']);

  select * into i from public.order_items where id = p_item and order_id = o.id;
  if not found then
    perform private.fail(404, 'Order item not found');
  end if;

  v_allowed := case i.status
    when 'queued' then array['preparing', 'ready', 'served']
    when 'preparing' then array['ready', 'served']
    when 'ready' then array['served']
    else array[]::text[] end;
  if i.status <> p_status and not (p_status = any (v_allowed)) then
    perform private.fail(400, format('Cannot change item status from ''%s'' to ''%s''', i.status, p_status));
  end if;

  if v_me.role = 'cook' and o.prepared_by_id is not null and o.prepared_by_id <> v_me.id then
    perform private.fail(409, 'Ticket is being prepared by ' || coalesce(o.prepared_by_name, 'another cook'));
  end if;

  update public.order_items set status = p_status where id = i.id;

  -- Roll up: drinks don't need cooking, so kitchen items drive ready/preparing.
  select count(*),
         count(*) filter (where status = 'served'),
         count(*) filter (where prep_station = 'kitchen'),
         count(*) filter (where status <> 'queued')
  into v_total, v_served, v_kitchen, v_started
  from public.order_items where order_id = o.id;
  select count(*) filter (where status in ('ready', 'served')), count(*)
  into v_progress_done, v_progress_total
  from public.order_items
  where order_id = o.id and (v_kitchen = 0 or prep_station = 'kitchen');

  v_new_status := case
    when o.status = 'cancelled' then 'cancelled'
    when v_total = v_served then 'served'
    when v_progress_done = v_progress_total then 'ready'
    when v_started > 0 then 'preparing'
    else 'pending' end;

  update public.orders
  set status = v_new_status,
      prepared_by_id = case when v_me.role = 'cook' then v_me.id else prepared_by_id end,
      prepared_by_name = case when v_me.role = 'cook' then v_me.name else prepared_by_name end,
      waiter_id = case when v_me.role = 'waiter' and waiter_id is null then v_me.id else waiter_id end
  where id = o.id;

  perform private.emit_order(o.id,
    case when v_new_status = 'ready' and o.status <> 'ready'
         then array['kds_updated', 'order_updated', 'order_ready']
         else array['kds_updated', 'order_updated'] end);
  return private.order_json(o.id, true);
end;
$$;

-- ---------------------------------------------------------------- payments
create or replace function public.start_cash_payment(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  p public.payments;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then
    perform private.fail(404, 'Order not found');
  end if;
  perform private.require_staff(o.restaurant_id, array['cashier', 'manager']);
  if o.status = 'cancelled' then
    perform private.fail(400, 'Order is cancelled');
  end if;
  if o.payment_status = 'paid' then
    perform private.fail(400, 'Order is already paid');
  end if;

  -- Reuse a pending payment (e.g. cash pre-selected by the diner).
  update public.payments set method = 'cash', amount = o.total_amount
  where id = (select id from public.payments
              where order_id = o.id and status = 'pending' order by created_at desc limit 1)
  returning * into p;
  if p.id is null then
    insert into public.payments (order_id, restaurant_id, amount, method, status)
    values (o.id, o.restaurant_id, o.total_amount, 'cash', 'pending')
    returning * into p;
  end if;
  update public.orders set payment_status = 'unpaid', payment_method = 'cash' where id = o.id;

  perform private.emit_order(o.id, array['cashPaymentRequested']);
  return jsonb_build_object('payment', jsonb_build_object(
    '_id', p.id, 'order', p.order_id, 'amount', p.amount, 'method', p.method, 'status', p.status));
end;
$$;

-- Settles a payment exactly once and marks its order paid.
create or replace function public.confirm_cash_payment(p_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
begin
  select * into p from public.payments where id = p_payment for update;
  if not found then
    perform private.fail(404, 'Payment not found');
  end if;
  perform private.require_staff(p.restaurant_id, array['cashier', 'manager']);

  if p.status <> 'completed' then
    update public.payments set status = 'completed', paid_at = now() where id = p.id returning * into p;
    update public.orders set payment_status = 'paid' where id = p.order_id;
    perform private.emit_order(p.order_id, array['paymentCompleted']);
  end if;
  return jsonb_build_object('payment', jsonb_build_object(
    '_id', p.id, 'order', p.order_id, 'amount', p.amount, 'method', p.method,
    'status', p.status, 'paidAt', p.paid_at));
end;
$$;

-- ---------------------------------------------------------- waiter sections
-- Spreads active tables over the waiters on the floor: a full random shuffle
-- once per day (or when forced), otherwise sticky — only tables without an
-- online waiter move, each to the least-loaded waiter.
create or replace function private.rebalance_sections(p_restaurant uuid, p_force boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiters uuid[];
  v_count integer;
  r public.restaurants;
  v_today text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  v_full boolean;
  v_changed integer := 0;
  v_index integer := 0;
  v_target uuid;
  t record;
begin
  -- Serializes concurrent rebalances for the same restaurant.
  select * into r from public.restaurants where id = p_restaurant for update;
  if not found then
    return jsonb_build_object('skipped', true, 'reason', 'nothing to assign');
  end if;

  select array_agg(w.user_id order by random()) into v_waiters
  from public.waiter_presence w
  join public.profiles p on p.id = w.user_id
  where w.restaurant_id = p_restaurant
    and p.role = 'waiter' and p.is_active
    and w.last_seen_at > now() - interval '2 minutes';
  v_count := coalesce(array_length(v_waiters, 1), 0);
  if v_count = 0 then
    return jsonb_build_object('skipped', true, 'reason', 'no connected waiters');
  end if;
  if not exists (select 1 from public.tables where restaurant_id = p_restaurant and is_active) then
    return jsonb_build_object('skipped', true, 'reason', 'nothing to assign');
  end if;

  v_full := p_force or r.sections_day is distinct from v_today;
  if v_full then
    for t in select id, assigned_waiter_id from public.tables
             where restaurant_id = p_restaurant and is_active order by random() loop
      v_target := v_waiters[(v_index % v_count) + 1];
      v_index := v_index + 1;
      if t.assigned_waiter_id is distinct from v_target then
        update public.tables set assigned_waiter_id = v_target where id = t.id;
        v_changed := v_changed + 1;
      end if;
    end loop;
  else
    for t in select id from public.tables
             where restaurant_id = p_restaurant and is_active
               and (assigned_waiter_id is null or not (assigned_waiter_id = any (v_waiters)))
             order by random() loop
      select w into v_target
      from unnest(v_waiters) as w
      order by (select count(*) from public.tables x
                where x.restaurant_id = p_restaurant and x.is_active and x.assigned_waiter_id = w),
               random()
      limit 1;
      update public.tables set assigned_waiter_id = v_target where id = t.id;
      v_changed := v_changed + 1;
    end loop;
  end if;

  if r.sections_day is distinct from v_today then
    update public.restaurants set sections_day = v_today where id = p_restaurant;
  end if;
  perform private.broadcast('restaurant:' || p_restaurant, 'sections_updated',
    jsonb_build_object('changed', v_changed, 'waiters', v_count), true);
  return jsonb_build_object('skipped', false, 'fullShuffle', v_full, 'changed', v_changed, 'waiters', v_count);
end;
$$;

revoke all on function private.rebalance_sections(uuid, boolean) from public, anon, authenticated;

-- Sent by the waiter board every minute; joining the floor triggers a rebalance.
create or replace function public.waiter_heartbeat()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles := private.me();
  v_previous timestamptz;
  v_came_online boolean;
begin
  if v_me.id is null or v_me.role <> 'waiter' or v_me.restaurant_id is null then
    perform private.fail(403, 'Only waiters report presence');
  end if;
  select last_seen_at into v_previous
  from public.waiter_presence where user_id = v_me.id and restaurant_id = v_me.restaurant_id;
  v_came_online := v_previous is null or v_previous <= now() - interval '2 minutes';

  insert into public.waiter_presence (user_id, restaurant_id, last_seen_at)
  values (v_me.id, v_me.restaurant_id, now())
  on conflict (user_id) do update set restaurant_id = excluded.restaurant_id, last_seen_at = now();

  if v_came_online then
    perform private.rebalance_sections(v_me.restaurant_id, false);
  end if;
  return jsonb_build_object('cameOnline', v_came_online);
end;
$$;

create or replace function public.waiter_leave()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant uuid;
begin
  delete from public.waiter_presence where user_id = (select auth.uid()) returning restaurant_id into v_restaurant;
  if v_restaurant is not null then
    perform private.rebalance_sections(v_restaurant, false);
  end if;
  return jsonb_build_object('left', true);
end;
$$;

-- Manager-forced full reshuffle.
create or replace function public.auto_assign_sections(p_restaurant uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform private.require_staff(p_restaurant, array['manager']);
  v_result := private.rebalance_sections(p_restaurant, true);
  if (v_result ->> 'skipped')::boolean then
    perform private.fail(400, case when v_result ->> 'reason' = 'no connected waiters'
      then 'No waiter is currently online — sections are assigned when waiters connect.'
      else 'Nothing to assign yet.' end);
  end if;
  return v_result;
end;
$$;

-- The waiter's section: assigned tables plus tables where they carry an order.
create or replace function public.waiter_tables(p_restaurant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  v_me := private.require_staff(p_restaurant, array['waiter', 'manager']);
  return coalesce((
    select jsonb_agg(jsonb_build_object('_id', t.id, 'number', t.number) order by t.number)
    from public.tables t
    where t.restaurant_id = p_restaurant
      and (t.assigned_waiter_id = v_me.id
           or exists (select 1 from public.orders o where o.table_id = t.id and o.waiter_id = v_me.id))
  ), '[]'::jsonb);
end;
$$;

-- -------------------------------------------------------------- restaurant
create or replace function public.update_restaurant(p_restaurant uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.restaurants;
  v_location jsonb := p_patch -> 'location';
begin
  perform private.require_staff(p_restaurant, array['manager']);

  update public.restaurants set
    name = coalesce(nullif(btrim(p_patch ->> 'name'), ''), name),
    address = coalesce(nullif(p_patch ->> 'address', ''), address),
    phone = coalesce(nullif(p_patch ->> 'phone', ''), phone),
    logo = coalesce(nullif(p_patch ->> 'logo', ''), logo),
    settings = case when jsonb_typeof(p_patch -> 'settings') = 'object'
                    then settings || (p_patch -> 'settings') else settings end,
    -- `location: null` turns the geofence off.
    lat = case when p_patch ? 'location' and jsonb_typeof(v_location) = 'null' then null
               when jsonb_typeof(v_location -> 'lat') = 'number' then (v_location ->> 'lat')::float8
               else lat end,
    lng = case when p_patch ? 'location' and jsonb_typeof(v_location) = 'null' then null
               when jsonb_typeof(v_location -> 'lng') = 'number' then (v_location ->> 'lng')::float8
               else lng end,
    geofence_radius = case when jsonb_typeof(p_patch -> 'geofenceRadius') = 'number'
                           then greatest(10, (p_patch ->> 'geofenceRadius')::numeric::integer)
                           else geofence_radius end
  where id = p_restaurant
  returning * into r;

  return jsonb_build_object('_id', r.id, 'name', r.name);
end;
$$;

-- ----------------------------------------------------------------- reports
-- Revenue counts PAID orders only (money actually collected). Days are UTC.
create or replace function public.report_dashboard(p_restaurant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_result jsonb;
begin
  perform private.require_staff(p_restaurant, array['manager']);
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
begin
  perform private.require_staff(p_restaurant, array['manager']);
  return (
    select jsonb_agg(jsonb_build_object(
             'date', to_char(d.day, 'YYYY-MM-DD'),
             'totalOrders', coalesce(s.orders, 0),
             'totalRevenue', coalesce(s.revenue, 0)) order by d.day)
    from generate_series((now() at time zone 'utc')::date - 6, (now() at time zone 'utc')::date, interval '1 day') as d(day)
    left join (
      select (created_at at time zone 'utc')::date as day,
             count(*) as orders,
             sum(case when payment_status = 'paid' then total_amount else 0 end) as revenue
      from public.orders
      where restaurant_id = p_restaurant
        and created_at >= ((now() at time zone 'utc')::date - 6) at time zone 'utc'
      group by 1
    ) s on s.day = d.day::date);
end;
$$;

create or replace function public.report_top_items(p_restaurant uuid, p_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(p_restaurant, array['manager']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'itemName', name, 'totalQuantity', quantity, 'totalRevenue', revenue) order by quantity desc)
    from (
      select coalesce(m.name ->> 'fr', 'Unknown item') as name,
             sum(i.quantity) as quantity,
             sum(i.quantity * i.price) as revenue
      from public.order_items i
      join public.orders o on o.id = i.order_id
      left join public.menu_items m on m.id = i.menu_item_id
      where o.restaurant_id = p_restaurant and o.status <> 'cancelled'
      group by i.menu_item_id, m.name
      order by quantity desc
      limit greatest(1, least(coalesce(p_limit, 5), 50))
    ) top), '[]'::jsonb);
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
  v_end date := coalesce(p_end, (now() at time zone 'utc')::date);
  v_start date := coalesce(p_start, v_end - 29);
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
  if v_start > v_end then
    perform private.fail(400, 'start must be on or before end');
  end if;
  v_days := v_end - v_start + 1;
  v_from := v_start::timestamp at time zone 'utc';
  v_to := (v_end + 1)::timestamp at time zone 'utc';
  v_prev_from := (v_start - v_days)::timestamp at time zone 'utc';

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
    select extract(dow from created_at at time zone 'utc')::integer as dow,
           count(*) as orders,
           sum(case when payment_status = 'paid' then total_amount else 0 end) as revenue
    from public.orders
    where restaurant_id = p_restaurant and created_at >= v_from and created_at < v_to
    group by 1
  ) s on s.dow = d;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'name', coalesce(r.name, 'Restaurant'), 'address', coalesce(r.address, ''),
      'phone', coalesce(r.phone, ''), 'currency', coalesce(r.settings ->> 'currency', 'TND')),
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
        select to_char(created_at at time zone 'utc', 'YYYY-MM-DD') as day,
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
        select extract(hour from created_at at time zone 'utc')::integer as hour, count(*) as orders
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
      from generate_series((now() at time zone 'utc')::date - 89, (now() at time zone 'utc')::date, interval '1 day') g(day)
      left join (
        select (created_at at time zone 'utc')::date as day,
               count(*) as orders,
               sum(case when status = 'cancelled' then 0 else total_amount end) as revenue
        from public.orders
        where restaurant_id = p_restaurant
          and created_at >= ((now() at time zone 'utc')::date - 89) at time zone 'utc'
        group by 1) s on s.day = g.day::date));
end;
$$;

-- Staff RPCs are for signed-in users only.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.kds_orders(uuid)',
    'public.active_orders_by_table(uuid, integer)',
    'public.claim_order(uuid)',
    'public.set_order_status(uuid, text)',
    'public.set_item_status(uuid, uuid, text)',
    'public.start_cash_payment(uuid)',
    'public.confirm_cash_payment(uuid)',
    'public.waiter_heartbeat()',
    'public.waiter_leave()',
    'public.auto_assign_sections(uuid)',
    'public.waiter_tables(uuid)',
    'public.update_restaurant(uuid, jsonb)',
    'public.report_dashboard(uuid)',
    'public.report_weekly(uuid)',
    'public.report_top_items(uuid, integer)',
    'public.report_ai_analytics(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
