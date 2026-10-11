-- Supabase Auth's admin createUser inserts the user first and writes custom
-- app_metadata in a follow-up UPDATE, so on_auth_user_created never sees
-- `staff_role` for staff provisioned by the staff-admin Edge Function (they
-- ended up as clients). Apply the staff role whenever app_metadata sets or
-- changes it. app_metadata is writable only with the service key, so this is
-- as trusted as the insert path.

create or replace function private.apply_staff_app_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := new.raw_app_meta_data ->> 'staff_role';
  v_restaurant uuid := private.try_uuid(new.raw_app_meta_data ->> 'restaurant_id');
begin
  if v_role is null then
    return new;
  end if;
  if v_role not in ('waiter', 'cashier', 'cook', 'manager', 'superadmin') then
    raise exception 'invalid staff role';
  end if;
  if v_role is distinct from (old.raw_app_meta_data ->> 'staff_role')
     or v_restaurant is distinct from private.try_uuid(old.raw_app_meta_data ->> 'restaurant_id') then
    update public.profiles
    set role = v_role, restaurant_id = coalesce(v_restaurant, restaurant_id)
    where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.apply_staff_app_metadata() from public, anon, authenticated;

create trigger on_auth_user_app_metadata_changed
  after update of raw_app_meta_data on auth.users
  for each row execute function private.apply_staff_app_metadata();
