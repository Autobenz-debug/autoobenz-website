alter table public.orders
add column if not exists taly_order_id text,
add column if not exists taly_order_reference text,
add column if not exists taly_payment_url text,
add column if not exists taly_status text,
add column if not exists taly_response jsonb,
add column if not exists taly_webhook_payload jsonb;

create index if not exists orders_taly_order_id_idx on public.orders(taly_order_id);
create index if not exists orders_taly_order_reference_idx on public.orders(taly_order_reference);

grant select, insert, update on public.orders to service_role;
grant select, insert, update on public.order_items to service_role;
