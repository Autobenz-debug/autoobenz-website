create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_kwd numeric(10,3) not null default 0 check (discount_kwd > 0),
  scope text not null default 'cart' check (scope in ('cart', 'product')),
  product_id uuid references public.products(id) on delete set null,
  product_old_id text,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders
add column if not exists coupon_code text,
add column if not exists discount_kwd numeric(10,3) not null default 0;

create unique index if not exists coupons_code_upper_idx on public.coupons(upper(code));
create index if not exists coupons_product_id_idx on public.coupons(product_id);
create index if not exists coupons_product_old_id_idx on public.coupons(product_old_id);

alter table public.coupons enable row level security;

grant select on public.coupons to anon;
grant select, insert, update, delete on public.coupons to authenticated;
grant select, insert, update, delete on public.coupons to service_role;

drop policy if exists "Public can read active coupons" on public.coupons;
create policy "Public can read active coupons"
on public.coupons for select
to anon, authenticated
using (
  is_active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
);

drop policy if exists "Admins can manage coupons" on public.coupons;
create policy "Admins can manage coupons"
on public.coupons for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
