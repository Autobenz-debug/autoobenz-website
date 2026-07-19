grant select, insert, update, delete on public.brands to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.product_types to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.product_images to authenticated;
grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;
grant select on public.admin_users to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

insert into public.admin_users (id, email, full_name, role)
select id, email, 'Autoobenz', 'admin'
from auth.users
where email = 'autobenz@outlook.sa'
on conflict (id) do update
set email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role;

create policy "Admins can read admin users"
on public.admin_users for select
to authenticated
using (public.is_admin() or id = auth.uid());

create policy "Admins can manage brands"
on public.brands for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can manage categories"
on public.categories for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can manage product types"
on public.product_types for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can manage products"
on public.products for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can manage product images"
on public.product_images for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can manage orders"
on public.orders for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can manage order items"
on public.order_items for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can upload product images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'product-images' and public.is_admin());

create policy "Admins can update product images"
on storage.objects for update
to authenticated
using (bucket_id = 'product-images' and public.is_admin())
with check (bucket_id = 'product-images' and public.is_admin());

create policy "Admins can delete product images"
on storage.objects for delete
to authenticated
using (bucket_id = 'product-images' and public.is_admin());
