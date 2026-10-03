-- Row Level Security, Realtime channel authorization and Storage.
--
-- The Express API connects with a privileged role and enforces business rules
-- itself; RLS here guarantees the public anon/publishable key (shipped to the
-- browser) can never read tenant data through PostgREST, and scopes which
-- Realtime private channels a signed-in user may join.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.current_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select restaurant_id from public.profiles where id = (select auth.uid()) and is_active
$$;

create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and is_active
$$;

-- True when the signed-in user is staff allowed to see the given restaurant:
-- staff of that restaurant, its owner (multi-restaurant managers), or a superadmin.
create or replace function private.can_access_restaurant(target uuid)
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
        or (p.role in ('waiter', 'cashier', 'cook', 'manager') and p.restaurant_id = target)
        or (p.role = 'manager' and exists (
              select 1 from public.restaurants r where r.id = target and r.owner_id = p.id))
      )
  )
$$;

revoke all on function private.current_restaurant_id() from public, anon;
revoke all on function private.current_app_role() from public, anon;
revoke all on function private.can_access_restaurant(uuid) from public, anon;
grant execute on function private.current_restaurant_id() to authenticated;
grant execute on function private.current_app_role() to authenticated;
grant execute on function private.can_access_restaurant(uuid) to authenticated;

-- ------------------------------------------------------------------ enable RLS
alter table public.restaurants          enable row level security;
alter table public.profiles             enable row level security;
alter table public.categories           enable row level security;
alter table public.menu_items           enable row level security;
alter table public.tables               enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_counters       enable row level security;
alter table public.payments             enable row level security;
alter table public.feedback             enable row level security;
alter table public.push_subscriptions   enable row level security;
alter table public.recommendations      enable row level security;
alter table public.recommendation_items enable row level security;
alter table public.waiter_presence      enable row level security;

-- --------------------------------------------------------------- read policies
create policy "staff read own restaurants" on public.restaurants
  for select to authenticated
  using (private.can_access_restaurant(id));

create policy "read own profile or restaurant staff" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (restaurant_id is not null and private.can_access_restaurant(restaurant_id))
  );

create policy "staff read categories" on public.categories
  for select to authenticated
  using (private.can_access_restaurant(restaurant_id));

create policy "staff read menu items" on public.menu_items
  for select to authenticated
  using (private.can_access_restaurant(restaurant_id));

create policy "staff read tables" on public.tables
  for select to authenticated
  using (private.can_access_restaurant(restaurant_id));

create policy "staff or owning client read orders" on public.orders
  for select to authenticated
  using (
    private.can_access_restaurant(restaurant_id)
    or client_id = (select auth.uid())
  );

create policy "read items of readable orders" on public.order_items
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    where o.id = order_id
      and (private.can_access_restaurant(o.restaurant_id) or o.client_id = (select auth.uid()))
  ));

create policy "staff read payments" on public.payments
  for select to authenticated
  using (private.can_access_restaurant(restaurant_id));

create policy "staff read feedback" on public.feedback
  for select to authenticated
  using (restaurant_id is not null and private.can_access_restaurant(restaurant_id));

create policy "read own push subscriptions" on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "staff read recommendations" on public.recommendations
  for select to authenticated
  using (private.can_access_restaurant(restaurant_id));

create policy "staff read recommendation items" on public.recommendation_items
  for select to authenticated
  using (exists (
    select 1 from public.recommendations r
    where r.id = recommendation_id and private.can_access_restaurant(r.restaurant_id)
  ));

create policy "staff read waiter presence" on public.waiter_presence
  for select to authenticated
  using (private.can_access_restaurant(restaurant_id));

-- order_counters intentionally has no policy: only the API/trigger touch it.
-- No anon policies anywhere: anonymous diners go through the API.

-- ---------------------------------------------------- Realtime private channels
-- Topics: restaurant:<restaurant_id> (staff of that restaurant)
--         waiter:<user_id>           (that waiter only)
-- table:<table_id> is a public channel (anonymous diners) and carries no PII.
create policy "staff receive restaurant and personal broadcasts" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (
      realtime.topic() = 'waiter:' || (select auth.uid())::text
      or (
        realtime.topic() like 'restaurant:%'
        and private.can_access_restaurant(
          nullif(substring(realtime.topic() from '^restaurant:([0-9a-fA-F-]{36})$'), '')::uuid
        )
      )
    )
  );

-- ---------------------------------------------------------------------- Storage
-- Menu images: public read via public URL, writes only through the API (service role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 5242880,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
