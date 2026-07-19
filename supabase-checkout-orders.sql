create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table public.orders
add column if not exists order_number text,
add column if not exists customer_name text,
add column if not exists customer_phone text,
add column if not exists customer_email text,
add column if not exists shipping_country text default 'Kuwait',
add column if not exists shipping_city text,
add column if not exists shipping_address text,
add column if not exists notes text,
add column if not exists subtotal_kwd numeric(10,3) default 0,
add column if not exists shipping_kwd numeric(10,3) default 0,
add column if not exists total_kwd numeric(10,3) default 0,
add column if not exists status text default 'new',
add column if not exists payment_status text default 'pending',
add column if not exists payment_method text default 'cash_or_link';

alter table public.order_items
add column if not exists order_id uuid,
add column if not exists product_id uuid,
add column if not exists product_old_id text,
add column if not exists product_slug text,
add column if not exists product_title text,
add column if not exists quantity integer default 1,
add column if not exists unit_price_kwd numeric(10,3) default 0,
add column if not exists total_kwd numeric(10,3) default 0;

create unique index if not exists orders_order_number_key on public.orders(order_number);
create index if not exists order_items_order_id_idx on public.order_items(order_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_order_id_fkey'
  ) then
    alter table public.order_items
    add constraint order_items_order_id_fkey
    foreign key (order_id)
    references public.orders(id)
    on delete cascade;
  end if;
end $$;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

grant select, insert on public.orders to anon;
grant select, insert on public.order_items to anon;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;

create policy "Customers can create orders"
on public.orders for insert
to anon, authenticated
with check (true);

create policy "Customers can create order items"
on public.order_items for insert
to anon, authenticated
with check (true);

create policy "Admins can read orders"
on public.orders for select
to authenticated
using (public.is_admin());

create policy "Admins can update orders"
on public.orders for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can read order items"
on public.order_items for select
to authenticated
using (public.is_admin());
