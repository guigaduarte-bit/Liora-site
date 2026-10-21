-- Supabase's default grants can include DELETE/TRUNCATE even when this
-- application's migration grants only SELECT/INSERT/UPDATE. Reset them first.
revoke all on public.liora_orders, public.liora_order_payments, public.liora_paid_orders from service_role;
grant select, insert, update on public.liora_orders, public.liora_order_payments to service_role;
grant select on public.liora_paid_orders to service_role;
