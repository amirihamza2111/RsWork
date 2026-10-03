-- RsWork core schema (replaces the MongoDB/Mongoose models).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- restaurants
create table public.restaurants (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  type            text not null default 'restaurant'
                  check (type in ('restaurant', 'cafe', 'fastfood', 'hotel', 'bar')),
  address         text,
  phone           text,
  logo            text check (logo is null or logo = '' or logo ~* '^https?://'),
  is_active       boolean not null default true,
  lat             double precision,
  lng             double precision,
  geofence_radius integer not null default 250,
  sections_day    text,
  owner_id        uuid,
  settings        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ------------------------------------------------------------------- profiles
-- One row per Supabase Auth user; carries the app role and tenant.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  name          text not null,
  email         text not null unique,
  role          text not null default 'client'
                check (role in ('client', 'waiter', 'cashier', 'cook', 'manager', 'superadmin')),
  phone         text,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index profiles_restaurant_role_idx on public.profiles (restaurant_id, role);

alter table public.restaurants
  add constraint restaurants_owner_id_fkey
  foreign key (owner_id) references public.profiles (id) on delete set null;
create index restaurants_owner_idx on public.restaurants (owner_id);

-- ----------------------------------------------------------------- categories
create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          jsonb not null check (name ? 'ar' and name ? 'fr' and name ? 'en'),
  image         text check (image is null or image = '' or image ~* '^https?://'),
  sort_order    integer,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index categories_restaurant_order_idx on public.categories (restaurant_id, sort_order);

-- ----------------------------------------------------------------- menu_items
create table public.menu_items (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  category_id      uuid not null references public.categories (id) on delete cascade,
  name             jsonb not null check (name ? 'ar' and name ? 'fr' and name ? 'en'),
  description      jsonb,
  price            numeric(10, 2) not null check (price >= 0),
  image            text check (image is null or image = '' or image ~* '^https?://'),
  is_available     boolean not null default true,
  prep_station     text not null default 'kitchen' check (prep_station in ('kitchen', 'bar')),
  is_vegetarian    boolean not null default false,
  is_gluten_free   boolean not null default false,
  allergens        text[] not null default '{}',
  preparation_time integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index menu_items_restaurant_category_idx on public.menu_items (restaurant_id, category_id);
create index menu_items_restaurant_available_idx on public.menu_items (restaurant_id, is_available);
create index menu_items_category_idx on public.menu_items (category_id);

-- --------------------------------------------------------------------- tables
create table public.tables (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  number             integer not null check (number > 0),
  capacity           integer not null default 4,
  status             text not null default 'available'
                     check (status in ('available', 'occupied', 'reserved')),
  assigned_waiter_id uuid references public.profiles (id) on delete set null,
  session_id         text,
  session_expires_at timestamptz,
  qr_code            text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (restaurant_id, number)
);
create index tables_assigned_waiter_idx on public.tables (assigned_waiter_id);

-- --------------------------------------------------------------------- orders
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text unique,
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  table_id         uuid references public.tables (id) on delete set null,
  client_id        uuid references public.profiles (id) on delete set null,
  waiter_id        uuid references public.profiles (id) on delete set null,
  prepared_by_id   uuid references public.profiles (id) on delete set null,
  prepared_by_name text,
  served_by_id     uuid references public.profiles (id) on delete set null,
  status           text not null default 'pending'
                   check (status in ('pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled')),
  payment_status   text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'partial')),
  payment_method   text not null default 'cash' check (payment_method in ('cash', 'card', 'mobile')),
  total_amount     numeric(10, 2) not null default 0,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index orders_restaurant_created_idx on public.orders (restaurant_id, created_at desc);
create index orders_restaurant_status_idx on public.orders (restaurant_id, status);
create index orders_table_status_idx on public.orders (table_id, status);
create index orders_client_created_idx on public.orders (client_id, created_at desc);
create index orders_waiter_status_idx on public.orders (waiter_id, status);
create index orders_prepared_by_idx on public.orders (prepared_by_id);
create index orders_served_by_idx on public.orders (served_by_id);

create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  menu_item_id uuid references public.menu_items (id) on delete set null,
  quantity     integer not null check (quantity > 0),
  price        numeric(10, 2) not null,
  options      text,
  comment      text,
  status       text not null default 'queued' check (status in ('queued', 'preparing', 'ready', 'served')),
  prep_station text not null default 'kitchen' check (prep_station in ('kitchen', 'bar')),
  position     integer not null default 0
);
create index order_items_order_idx on public.order_items (order_id, position);
create index order_items_menu_item_idx on public.order_items (menu_item_id);

-- Daily per-restaurant order numbers: ORD-YYYYMMDD-NNNN (UTC day).
create table public.order_counters (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day           date not null,
  seq           integer not null default 0,
  primary key (restaurant_id, day)
);

create or replace function public.assign_order_number()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_seq integer;
begin
  if new.order_number is not null then
    return new;
  end if;
  insert into public.order_counters as c (restaurant_id, day, seq)
  values (new.restaurant_id, v_day, 1)
  on conflict (restaurant_id, day) do update set seq = c.seq + 1
  returning c.seq into v_seq;
  new.order_number := 'ORD-' || to_char(v_day, 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function public.assign_order_number();

-- ------------------------------------------------------------------- payments
create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  order_id                 uuid not null references public.orders (id) on delete cascade,
  restaurant_id            uuid not null references public.restaurants (id) on delete cascade,
  amount                   numeric(10, 2) not null,
  method                   text not null check (method in ('cash', 'card')),
  status                   text not null default 'pending'
                           check (status in ('pending', 'completed', 'failed', 'refunded')),
  stripe_payment_intent_id text unique,
  stripe_client_secret     text,
  paid_at                  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);
create index payments_restaurant_created_idx on public.payments (restaurant_id, created_at desc);

-- ------------------------------------------------------------------- feedback
create table public.feedback (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  table_id      uuid references public.tables (id) on delete set null,
  order_id      uuid references public.orders (id) on delete set null,
  rating        integer not null check (rating between 1 and 5),
  category      text not null default 'Overall',
  comment       text check (char_length(comment) <= 500),
  status        text not null default 'new' check (status in ('new', 'reviewed')),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index feedback_restaurant_status_created_idx
  on public.feedback (restaurant_id, status, created_at desc);
create index feedback_table_idx on public.feedback (table_id);
create index feedback_order_idx on public.feedback (order_id);

-- --------------------------------------------------------- push_subscriptions
create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  endpoint      text not null unique,
  subscription  jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index push_subscriptions_restaurant_idx on public.push_subscriptions (restaurant_id);

-- ------------------------------------------------------------ recommendations
-- Precomputed "frequently bought together" model, rebuilt by the API.
create table public.recommendations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id       uuid not null references public.menu_items (id) on delete cascade,
  generated_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, item_id)
);
create index recommendations_item_idx on public.recommendations (item_id);

create table public.recommendation_items (
  recommendation_id uuid not null references public.recommendations (id) on delete cascade,
  menu_item_id      uuid not null references public.menu_items (id) on delete cascade,
  count             integer not null default 0,
  score             double precision not null default 0,
  primary key (recommendation_id, menu_item_id)
);
create index recommendation_items_menu_item_idx on public.recommendation_items (menu_item_id);

-- ------------------------------------------------------------ waiter_presence
-- Heartbeat-based "who is on the floor" used for automatic section assignment.
create table public.waiter_presence (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  last_seen_at  timestamptz not null default now()
);
create index waiter_presence_restaurant_seen_idx on public.waiter_presence (restaurant_id, last_seen_at);

-- ------------------------------------------------------------ updated_at hooks
do $$
declare
  t text;
begin
  foreach t in array array[
    'restaurants', 'profiles', 'categories', 'menu_items', 'tables', 'orders',
    'payments', 'feedback', 'push_subscriptions', 'recommendations'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t, t);
  end loop;
end;
$$;
