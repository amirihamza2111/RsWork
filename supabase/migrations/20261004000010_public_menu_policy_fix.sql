-- Fix: anonymous diners can't read `restaurants`, so menu policies that joined
-- it returned nothing. The menu itself is public data.
drop policy "anyone reads active categories" on public.categories;
drop policy "anyone reads menu items" on public.menu_items;

create policy "anyone reads active categories" on public.categories
  for select to anon, authenticated
  using (is_active);

create policy "anyone reads menu items" on public.menu_items
  for select to anon, authenticated
  using (true);
