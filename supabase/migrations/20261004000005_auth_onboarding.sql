-- Creates the app profile for every new Supabase Auth user, in the same
-- transaction as the sign-up.
--
--  * Self sign-up (browser, user-controlled raw_user_meta_data):
--      - with `restaurant_name` -> creates the restaurant, user becomes its manager/owner
--      - otherwise              -> client
--    A role is NEVER read from user metadata.
--  * Staff provisioned by the `staff-admin` Edge Function carry their role and
--    restaurant in raw_app_meta_data, which only the service role can write.

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
  v_role text := 'client';
  v_restaurant uuid;
begin
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
      jsonb_build_object(
        'currency', coalesce(nullif(left(v_meta ->> 'currency', 8), ''), 'TND'),
        'language', case when v_meta ->> 'language' in ('ar', 'fr', 'en') then v_meta ->> 'language' else 'fr' end)
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

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep the profile email in sync when Auth changes it.
create or replace function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.sync_profile_email() from public, anon, authenticated;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.sync_profile_email();
