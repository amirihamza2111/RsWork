-- Order numbers come from a per-restaurant daily counter (ORD-YYYYMMDD-NNNN),
-- so they are only unique within a restaurant. The global unique constraint
-- made the second restaurant's first order of each day fail.
alter table public.orders drop constraint orders_order_number_key;
alter table public.orders
  add constraint orders_restaurant_order_number_key unique (restaurant_id, order_number);
