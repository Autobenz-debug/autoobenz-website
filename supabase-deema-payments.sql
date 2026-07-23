alter table public.orders
add column if not exists deema_order_reference text,
add column if not exists deema_payment_url text,
add column if not exists deema_status text,
add column if not exists deema_response jsonb,
add column if not exists deema_webhook_payload jsonb;

create index if not exists orders_deema_order_reference_idx on public.orders(deema_order_reference);

grant select, insert, update on public.orders to service_role;
grant select, insert, update on public.order_items to service_role;
