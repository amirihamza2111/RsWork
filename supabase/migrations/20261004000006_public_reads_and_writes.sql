-- Direct table access from the browser (no API server):
--  * the public menu is readable by anyone,
--  * managers do plain CRUD on categories / menu items / tables / feedback status,
--  * managers upload menu photos into their restaurant's Storage folder.
-- Everything with business rules goes through the RPCs in later migrations.

-- ------------------------------------------------------------- public menu
create policy "anyone reads active categories" on public.categories
  for select to anon, authenticated
  using (is_active and exists (
    select 1 from public.restaurants r where r.id = restaurant_id and r.is_active));

create policy "anyone reads menu items" on public.menu_items
  for select to anon, authenticated
  using (exists (
    select 1 from public.restaurants r where r.id = restaurant_id and r.is_active));

-- The staff-only read policies are now covered by the public ones above
-- (inactive categories were never listed by the app).
drop policy "staff read categories" on public.categories;
drop policy "staff read menu items" on public.menu_items;

-- ------------------------------------------------------------ manager CRUD
create policy "managers insert categories" on public.categories
  for insert to authenticated with check (private.can_manage_restaurant(restaurant_id));
create policy "managers update categories" on public.categories
  for update to authenticated
  using (private.can_manage_restaurant(restaurant_id))
  with check (private.can_manage_restaurant(restaurant_id));
create policy "managers delete categories" on public.categories
  for delete to authenticated using (private.can_manage_restaurant(restaurant_id));

-- A menu item's category must belong to the same restaurant.
create policy "managers insert menu items" on public.menu_items
  for insert to authenticated
  with check (
    private.can_manage_restaurant(restaurant_id)
    and exists (select 1 from public.categories c
                where c.id = category_id and c.restaurant_id = menu_items.restaurant_id));
create policy "managers update menu items" on public.menu_items
  for update to authenticated
  using (private.can_manage_restaurant(restaurant_id))
  with check (
    private.can_manage_restaurant(restaurant_id)
    and exists (select 1 from public.categories c
                where c.id = category_id and c.restaurant_id = menu_items.restaurant_id));
create policy "managers delete menu items" on public.menu_items
  for delete to authenticated using (private.can_manage_restaurant(restaurant_id));

create policy "managers insert tables" on public.tables
  for insert to authenticated with check (private.can_manage_restaurant(restaurant_id));
create policy "managers update tables" on public.tables
  for update to authenticated
  using (private.can_manage_restaurant(restaurant_id))
  with check (private.can_manage_restaurant(restaurant_id));
create policy "managers delete tables" on public.tables
  for delete to authenticated using (private.can_manage_restaurant(restaurant_id));

create policy "managers review feedback" on public.feedback
  for update to authenticated
  using (restaurant_id is not null and private.can_manage_restaurant(restaurant_id))
  with check (restaurant_id is not null and private.can_manage_restaurant(restaurant_id));

-- --------------------------------------------------------- Storage: photos
-- Objects live at <restaurant_id>/<file>; the bucket is public for reads.
create policy "managers upload menu images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and private.can_manage_restaurant(private.try_uuid((storage.foldername(name))[1])));
create policy "managers update menu images" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'menu-images'
    and private.can_manage_restaurant(private.try_uuid((storage.foldername(name))[1])));
create policy "managers delete menu images" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'menu-images'
    and private.can_manage_restaurant(private.try_uuid((storage.foldername(name))[1])));

-- -------------------------------------------------------------- dead objects
-- Web push was dropped; recommendations are computed live; QR codes are
-- rendered in the browser; nothing listens on per-waiter channels.
drop table public.push_subscriptions;
drop table public.recommendation_items;
drop table public.recommendations;
alter table public.tables drop column qr_code;

drop policy "staff receive restaurant and personal broadcasts" on realtime.messages;
create policy "staff receive restaurant broadcasts" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'restaurant:%'
    and private.can_access_restaurant(
      private.try_uuid(substring(realtime.topic() from '^restaurant:(.+)$')))
  );
