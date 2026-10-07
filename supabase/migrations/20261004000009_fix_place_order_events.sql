-- Fix: appending to the events array (text[] || literal parsed as array concatenation).

-- Places an order. Prices always come from the menu (client prices are
-- ignored); the table row is locked so the anti-abuse caps can't be raced.
create or replace function public.place_order(
  p_table uuid,
  p_items jsonb,
  p_session text default null,
  p_lat float8 default null,
  p_lng float8 default null,
  p_notes text default null,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_open_orders constant integer := 5;
  c_max_open_tab constant numeric := 1000;
  v_me public.profiles := private.me();
  v_is_staff boolean;
  t public.tables;
  r public.restaurants;
  v_item jsonb;
  m public.menu_items;
  v_qty integer;
  v_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_open_count integer;
  v_open_sum numeric;
  v_order public.orders;
  v_method text := case when p_payment_method in ('cash', 'card', 'mobile') then p_payment_method end;
  v_has_bar boolean := false;
  v_events text[] := array['new_order'];
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail(400, 'Please provide table and at least one item');
  end if;

  select * into t from public.tables where id = p_table and is_active for update;
  if not found then
    perform private.fail(400, 'Invalid table');
  end if;
  select * into r from public.restaurants where id = t.restaurant_id;

  -- Staff of this restaurant order without a QR session or geofence.
  v_is_staff := v_me.id is not null
    and v_me.role in ('waiter', 'cook', 'cashier', 'manager', 'superadmin')
    and private.can_access_restaurant(t.restaurant_id);

  if not v_is_staff then
    if t.session_id is null or t.session_expires_at is null or t.session_expires_at <= now()
       or p_session is null or p_session <> t.session_id then
      perform private.fail(403, 'Your table session is invalid or expired — please rescan the QR code.');
    end if;
    -- Geofence: dormant until the manager configures the restaurant location.
    if r.lat is not null and r.lng is not null then
      if p_lat is null or p_lng is null then
        perform private.fail(403, 'Please enable location so we can confirm you are at the restaurant.');
      end if;
      if private.distance_meters(r.lat, r.lng, p_lat, p_lng) > coalesce(r.geofence_radius, 250) then
        perform private.fail(403, 'You appear to be away from the restaurant, so ordering is disabled.');
      end if;
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into m
    from public.menu_items
    where id = private.try_uuid(v_item ->> 'menuItem') and restaurant_id = t.restaurant_id;
    if not found then
      perform private.fail(400, 'One or more items are invalid for this restaurant');
    end if;
    if not m.is_available then
      perform private.fail(400, 'Item is not available: ' || coalesce(m.name ->> 'fr', m.id::text));
    end if;
    v_qty := greatest(1, coalesce(floor(case when (v_item ->> 'quantity') ~ '^\d+(\.\d+)?$'
                                             then (v_item ->> 'quantity')::numeric end)::integer, 1));
    v_total := v_total + m.price * v_qty;
    v_has_bar := v_has_bar or m.prep_station = 'bar';
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'menu_item_id', m.id,
      'quantity', v_qty,
      'price', m.price,
      'options', private.sanitize_text(v_item ->> 'options', 200),
      'comment', private.sanitize_text(v_item ->> 'comment', 300),
      'prep_station', m.prep_station));
  end loop;

  -- Anti-abuse caps: open orders and the unpaid tab per table.
  select count(*), coalesce(sum(total_amount), 0) into v_open_count, v_open_sum
  from public.orders
  where table_id = t.id
    and status in ('pending', 'confirmed', 'preparing', 'ready')
    and payment_status <> 'paid';
  if v_open_count >= c_max_open_orders then
    perform private.fail(400, 'This table has too many open orders — please ask a staff member.');
  end if;
  if v_open_sum + v_total > c_max_open_tab then
    perform private.fail(400, 'This table has reached its open-tab limit — please settle the bill first.');
  end if;

  insert into public.orders (restaurant_id, table_id, client_id, waiter_id, notes, payment_method, total_amount)
  values (
    t.restaurant_id,
    t.id,
    case when v_me.role = 'client' then v_me.id end,
    case when v_me.role = 'waiter' and v_is_staff then v_me.id else t.assigned_waiter_id end,
    private.sanitize_text(p_notes, 1000),
    coalesce(v_method, 'cash'),
    v_total)
  returning * into v_order;

  insert into public.order_items (order_id, menu_item_id, quantity, price, options, comment, prep_station, position)
  select v_order.id,
         (l.value ->> 'menu_item_id')::uuid,
         (l.value ->> 'quantity')::integer,
         (l.value ->> 'price')::numeric,
         l.value ->> 'options',
         l.value ->> 'comment',
         l.value ->> 'prep_station',
         (l.ordinality - 1)::integer
  from jsonb_array_elements(v_lines) with ordinality as l(value, ordinality);

  update public.tables set status = 'occupied' where id = t.id;

  if v_method in ('cash', 'mobile') then
    insert into public.payments (order_id, restaurant_id, amount, method, status)
    values (v_order.id, t.restaurant_id, v_total,
            case when v_method = 'mobile' then 'card' else 'cash' end, 'pending');
    v_events := array_append(v_events, 'cashPaymentRequested');
  end if;
  if v_has_bar then
    -- Drinks are brought by the waiter, not the kitchen.
    v_events := array_append(v_events, 'drinks_requested');
  end if;
  perform private.emit_order(v_order.id, v_events);

  return private.order_json(v_order.id, v_is_staff or v_me.role = 'client');
end;
$$;
