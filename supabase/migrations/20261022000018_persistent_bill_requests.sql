-- Bill requests survive a page reload: staff screens load the pending ones from the
-- database, and they stay until the bill is paid, the order is cancelled, or a staff
-- member dismisses the request (which clears it on every screen).

alter table public.orders
  add column if not exists bill_method text check (bill_method in ('cash', 'card'));

create index if not exists orders_pending_bill_idx
  on public.orders (restaurant_id, bill_requested_at desc)
  where bill_requested_at is not null;

-- Same as before, but the requested payment method is stored with the request.
create or replace function public.request_bill(p_order uuid, p_method text default 'cash')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_number integer;
  v_method text := case when p_method = 'card' then 'card' else 'cash' end;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then
    perform private.fail(404, 'Order not found');
  end if;
  -- Don't ping staff for bills that can't be settled (spam guard).
  if o.payment_status = 'paid' then
    perform private.fail(400, 'Order is already paid');
  end if;
  if o.status = 'cancelled' then
    perform private.fail(400, 'Order is cancelled');
  end if;
  -- Already pinged recently: keep the latest method, but don't ping again.
  if o.bill_requested_at > now() - interval '1 minute' then
    update public.orders set bill_method = v_method where id = o.id;
    return jsonb_build_object('requested', true, 'method', v_method);
  end if;

  update public.orders set bill_requested_at = now(), bill_method = v_method where id = o.id;
  select number into v_number from public.tables where id = o.table_id;
  perform private.broadcast(
    'restaurant:' || o.restaurant_id,
    'bill_requested',
    jsonb_build_object(
      'orderId', o.id,
      'orderNumber', o.order_number,
      'table', case when o.table_id is null then null
                    else jsonb_build_object('_id', o.table_id, 'number', v_number) end,
      'method', v_method),
    true);
  return jsonb_build_object('requested', true, 'method', v_method);
end;
$$;

-- Unpaid bill requests of a restaurant, newest first.
create or replace function public.pending_bill_requests(p_restaurant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_staff(p_restaurant, array['waiter', 'cashier', 'manager']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'orderId', r.id,
             'orderNumber', r.order_number,
             'table', case when r.table_id is null then null
                           else jsonb_build_object('_id', r.table_id, 'number', r.table_number) end,
             'method', coalesce(r.bill_method, 'cash'),
             'requestedAt', r.bill_requested_at)
           order by r.bill_requested_at desc)
    from (
      select o.id, o.order_number, o.table_id, t.number as table_number, o.bill_method,
             o.bill_requested_at
      from public.orders o
      left join public.tables t on t.id = o.table_id
      where o.restaurant_id = p_restaurant
        and o.bill_requested_at is not null
        and o.payment_status <> 'paid'
        and o.status <> 'cancelled'
      order by o.bill_requested_at desc
      limit 20
    ) r
  ), '[]'::jsonb);
end;
$$;

-- A staff member has handled the request: clear it for everyone.
create or replace function public.dismiss_bill_request(p_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then
    perform private.fail(404, 'Order not found');
  end if;
  perform private.require_staff(o.restaurant_id, array['waiter', 'cashier', 'manager']);
  update public.orders set bill_requested_at = null, bill_method = null where id = o.id;
  perform private.broadcast(
    'restaurant:' || o.restaurant_id,
    'bill_request_cleared',
    jsonb_build_object('orderId', o.id),
    true);
  return jsonb_build_object('dismissed', true);
end;
$$;

revoke all on function public.pending_bill_requests(uuid) from public, anon;
revoke all on function public.dismiss_bill_request(uuid) from public, anon;
grant execute on function public.pending_bill_requests(uuid) to authenticated;
grant execute on function public.dismiss_bill_request(uuid) to authenticated;
