create table if not exists public.customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text,
  phone text,
  email text,
  shipping_country text,
  shipping_city text,
  shipping_address text
);

alter table public.customer_profiles
add column if not exists shipping_country text,
add column if not exists shipping_city text,
add column if not exists shipping_address text;

alter table public.orders
add column if not exists customer_id uuid references auth.users(id) on delete set null;

create index if not exists customer_profiles_email_idx on public.customer_profiles (lower(email));
create index if not exists customer_profiles_phone_idx on public.customer_profiles (phone);
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_customer_email_idx on public.orders (lower(customer_email));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customer_profiles_set_updated_at on public.customer_profiles;
create trigger customer_profiles_set_updated_at
before update on public.customer_profiles
for each row execute function public.set_updated_at();

alter table public.customer_profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

grant select, insert, update on public.customer_profiles to authenticated;
grant select on public.customer_profiles to service_role;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;

drop policy if exists "Customers can create own profile" on public.customer_profiles;
create policy "Customers can create own profile"
on public.customer_profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Customers can read own profile" on public.customer_profiles;
create policy "Customers can read own profile"
on public.customer_profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "Customers can update own profile" on public.customer_profiles;
create policy "Customers can update own profile"
on public.customer_profiles for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "Customers can create orders" on public.orders;
create policy "Customers can create orders"
on public.orders for insert
to anon, authenticated
with check (
  (auth.uid() is null and customer_id is null)
  or
  (auth.uid() is not null and (customer_id is null or customer_id = auth.uid()))
);

drop policy if exists "Customers can read own orders" on public.orders;
create policy "Customers can read own orders"
on public.orders for select
to authenticated
using (
  customer_id = auth.uid()
  or lower(customer_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or public.is_admin()
);

drop policy if exists "Customers can read own order items" on public.order_items;
create policy "Customers can read own order items"
on public.order_items for select
to authenticated
using (
  exists (
    select 1
    from public.orders
    where public.orders.id = public.order_items.order_id
      and (
        public.orders.customer_id = auth.uid()
        or lower(public.orders.customer_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        or public.is_admin()
      )
  )
);
