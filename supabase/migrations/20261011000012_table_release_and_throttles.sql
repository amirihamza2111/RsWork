-- 1. Free a table once its guests are done.
-- 2. Throttle the anonymous endpoints that ping staff or write data.
-- 3. Managers may only change a feedback's review status, not its content.

-- ------------------------------------------------------------ table release
-- A table is done when every non-cancelled order on it is served AND paid
-- (in either order: card payments can come before the food). Its QR session
-- is cleared so a photographed QR can't keep ordering on the next guests' tab.
create or replace function private.release_settled_table()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.table_id is null then
    return null;
  end if;
  if not exists (
    select 1 from public.orders o
    where o.table_id = new.table_id
      and o.status <> 'cancelled'
      and (o.status <> 'served' or o.payment_status <> 'paid')
  ) then
    update public.tables
    set status = 'available', session_id = null, session_expires_at = null
    where id = new.table_id and status = 'occupied';
  end if;
  return null;
end;
$$;

revoke all on function private.release_settled_table() from public, anon, authenticated;

create trigger orders_release_table
  after update of status, payment_status on public.orders
  for each row
  when (old.status is distinct from new.status or old.payment_status is distinct from new.payment_status)
  execute function private.release_settled_table();

-- ------------------------------------------------------- bill request throttle
alter table public.orders add column bill_requested_at timestamptz;

-- The diner asks to pay at the table: pings the restaurant's staff screens,
-- at most once a minute per order.
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
  -- Already pinged recently: report success without pinging again.
  if o.bill_requested_at > now() - interval '1 minute' then
    return jsonb_build_object('requested', true, 'method', v_method);
  end if;

  update public.orders set bill_requested_at = now() where id = o.id;
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

-- ---------------------------------------------------------- feedback throttle
-- One feedback per order; table-only feedback at most once per 10 minutes per
-- table; and it must belong to a real restaurant.
create or replace function public.submit_feedback(
  p_rating integer,
  p_order uuid default null,
  p_table uuid default null,
  p_category text default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant uuid;
  v_table_restaurant uuid;
  v_order uuid;
  v_table uuid;
  f public.feedback;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    perform private.fail(400, 'Rating must be between 1 and 5');
  end if;
  -- The restaurant is derived from the order or table, never trusted from input.
  select id, restaurant_id into v_order, v_restaurant from public.orders where id = p_order;
  select id, restaurant_id into v_table, v_table_restaurant from public.tables where id = p_table;
  v_restaurant := coalesce(v_restaurant, v_table_restaurant);
  if v_restaurant is null then
    perform private.fail(400, 'Feedback must be for an order or a table');
  end if;

  if v_order is not null then
    if exists (select 1 from public.feedback where order_id = v_order) then
      perform private.fail(409, 'Feedback was already sent for this order');
    end if;
  elsif exists (
    select 1 from public.feedback
    where table_id = v_table and created_at > now() - interval '10 minutes'
  ) then
    perform private.fail(429, 'Feedback was just sent from this table — please try again later');
  end if;

  insert into public.feedback (restaurant_id, table_id, order_id, rating, category, comment)
  values (v_restaurant, v_table, v_order, p_rating,
          coalesce(nullif(private.sanitize_text(p_category, 50), ''), 'Overall'),
          private.sanitize_text(p_comment, 500))
  returning * into f;

  return jsonb_build_object(
    '_id', f.id, 'rating', f.rating, 'category', f.category,
    'comment', f.comment, 'status', f.status, 'createdAt', f.created_at);
end;
$$;

-- Also closes the race between two simultaneous submissions for one order.
create unique index feedback_one_per_order_idx on public.feedback (order_id) where order_id is not null;

-- ---------------------------------------------- feedback: review status only
revoke update on public.feedback from anon, authenticated;
grant update (status, reviewed_at) on public.feedback to authenticated;
