-- Shared helpers for the RPC layer (all in the non-exposed `private` schema).

-- Raises an error PostgREST turns into HTTP <status> (SQLSTATE 'PTxxx').
create or replace function private.fail(p_status integer, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'PT' || p_status::text, message = p_message;
end;
$$;

create or replace function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

-- Strips HTML tags and caps length (defense-in-depth against stored XSS).
create or replace function private.sanitize_text(p_value text, p_max integer default 1000)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then null
              else left(btrim(regexp_replace(p_value, '<[^>]*>', '', 'g')), p_max) end
$$;

-- Great-circle distance in meters (haversine).
create or replace function private.distance_meters(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- The signed-in, active profile (null row when anonymous or deactivated).
create or replace function private.me()
returns public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.profiles p where p.id = (select auth.uid()) and p.is_active
$$;

-- Manager of the restaurant (assigned or owner) or superadmin.
create or replace function private.can_manage_restaurant(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and (
        p.role = 'superadmin'
        or (p.role = 'manager' and (
              p.restaurant_id = target
              or exists (select 1 from public.restaurants r where r.id = target and r.owner_id = p.id)))
      )
  )
$$;

-- Returns the caller's profile when they hold one of p_roles for p_restaurant
-- (superadmin always passes); raises 401/403 otherwise.
create or replace function private.require_staff(p_restaurant uuid, p_roles text[])
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
begin
  v_me := private.me();
  if v_me.id is null then
    perform private.fail(401, 'Not authorized to access this route');
  end if;
  if v_me.role = 'superadmin' then
    return v_me;
  end if;
  if not (v_me.role = any (p_roles)) then
    perform private.fail(403, format('User role ''%s'' is not authorized to access this route', v_me.role));
  end if;
  if p_restaurant is null or not private.can_access_restaurant(p_restaurant) then
    perform private.fail(403, 'Restaurant context is required');
  end if;
  return v_me;
end;
$$;

create or replace function private.broadcast(p_topic text, p_event text, p_payload jsonb, p_private boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(coalesce(p_payload, '{}'::jsonb), p_event, p_topic, p_private);
end;
$$;

-- Slim, PII-free order event to the restaurant (private) and table (public) channels.
-- Screens only use these as a signal to refetch.
create or replace function private.emit_order(p_order uuid, p_events text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o record;
  v_payload jsonb;
  v_event text;
begin
  select id, order_number, status, restaurant_id, table_id into o from public.orders where id = p_order;
  if not found then
    return;
  end if;
  v_payload := jsonb_build_object(
    'orderId', o.id, 'orderNumber', o.order_number, 'status', o.status, 'tableId', o.table_id);
  foreach v_event in array p_events loop
    perform private.broadcast('restaurant:' || o.restaurant_id, v_event, v_payload, true);
    if o.table_id is not null then
      perform private.broadcast('table:' || o.table_id, v_event, v_payload, false);
    end if;
  end loop;
end;
$$;

-- An order in the API's DTO shape (`_id`, populated table / items[].menuItem).
-- Customer and waiter identity are only included when p_with_pii.
create or replace function private.order_json(p_order uuid, p_with_pii boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_with_pii then dto else dto - 'client' - 'waiter' end
  from (
    select jsonb_build_object(
      '_id', o.id,
      'orderNumber', o.order_number,
      'restaurant', jsonb_build_object(
        '_id', r.id, 'name', r.name, 'address', r.address, 'phone', r.phone, 'settings', r.settings),
      'table', case when t.id is null then null
                    else jsonb_build_object('_id', t.id, 'number', t.number) end,
      'client', case when c.id is null then null
                     else jsonb_build_object('_id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone) end,
      'waiter', case when w.id is null then null
                     else jsonb_build_object('_id', w.id, 'name', w.name) end,
      'preparedBy', o.prepared_by_id,
      'preparedByName', o.prepared_by_name,
      'servedBy', o.served_by_id,
      'status', o.status,
      'paymentStatus', o.payment_status,
      'paymentMethod', o.payment_method,
      'totalAmount', o.total_amount,
      'notes', o.notes,
      'createdAt', o.created_at,
      'updatedAt', o.updated_at,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 '_id', i.id,
                 'quantity', i.quantity,
                 'price', i.price,
                 'options', i.options,
                 'comment', i.comment,
                 'status', i.status,
                 'prepStation', i.prep_station,
                 'menuItem', case when m.id is null then null else jsonb_build_object(
                   '_id', m.id, 'name', m.name, 'price', m.price,
                   'image', m.image, 'prepStation', m.prep_station) end)
               order by i.position, i.id)
        from public.order_items i
        left join public.menu_items m on m.id = i.menu_item_id
        where i.order_id = o.id), '[]'::jsonb)
    ) as dto
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    left join public.tables t on t.id = o.table_id
    left join public.profiles c on c.id = o.client_id
    left join public.profiles w on w.id = o.waiter_id
    where o.id = p_order
  ) s
$$;

revoke all on function private.fail(integer, text) from public, anon;
revoke all on function private.me() from public, anon;
revoke all on function private.require_staff(uuid, text[]) from public, anon;
revoke all on function private.broadcast(text, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function private.emit_order(uuid, text[]) from public, anon, authenticated;
revoke all on function private.order_json(uuid, boolean) from public, anon, authenticated;
revoke all on function private.can_manage_restaurant(uuid) from public, anon;
grant execute on function private.can_manage_restaurant(uuid) to authenticated;
grant execute on function private.try_uuid(text) to authenticated;
