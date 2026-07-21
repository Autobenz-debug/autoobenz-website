alter table public.orders
add column if not exists sadad_invoice_id text,
add column if not exists sadad_payment_url text,
add column if not exists sadad_status text,
add column if not exists sadad_response jsonb,
add column if not exists sadad_webhook_payload jsonb,
add column if not exists paid_at timestamptz;

create index if not exists orders_sadad_invoice_id_idx on public.orders(sadad_invoice_id);

grant select, insert, update on public.orders to service_role;
grant select, insert, update on public.order_items to service_role;
