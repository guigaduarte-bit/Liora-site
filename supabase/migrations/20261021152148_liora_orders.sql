-- Private order ledger. Browser roles deliberately receive no table/RPC access.
create table public.liora_orders (
  id text primary key check (id ~ '^LIORA-[A-Z0-9-]{10,80}$'),
  environment text not null check (environment in ('production','preview','development')),
  mode text not null check (mode in ('test','live')),
  provider text not null check (provider in ('mercadopago','infinitepay')),
  method text not null check (method in ('pix','card','boleto','infinitepay')),
  total_cents integer not null check (total_cents > 0),
  subtotal_cents integer not null check (subtotal_cents > 0),
  discount_cents integer not null check (discount_cents >= 0),
  shipping_cents integer not null check (shipping_cents >= 0),
  interest_free_installments integer not null default 0 check (interest_free_installments in (0,3)),
  customer jsonb not null check (jsonb_typeof(customer) = 'object'),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  shipping jsonb not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  checkout_state text not null default 'creating' check (checkout_state in ('creating','ready')),
  checkout_response jsonb,
  status text not null default 'pending',
  review_reasons text[] not null default '{}',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (total_cents = subtotal_cents - discount_cents + shipping_cents),
  check ((environment = 'production') = (mode = 'live')),
  check ((provider = 'infinitepay') = (method = 'infinitepay')),
  check (provider <> 'infinitepay' or environment = 'production')
);
create table public.liora_order_payments (
  environment text not null,
  provider text not null,
  payment_id text not null,
  order_id text not null references public.liora_orders(id),
  status text not null check (status in ('approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back','in_mediation')),
  method text,
  installments integer,
  paid_cents integer,
  review_reasons text[] not null default '{}',
  provider_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (environment, provider, payment_id)
);
create index liora_order_payments_order on public.liora_order_payments(order_id);
create index liora_orders_status on public.liora_orders(environment, status, created_at);
alter table public.liora_orders enable row level security;
alter table public.liora_order_payments enable row level security;
revoke all on public.liora_orders, public.liora_order_payments from public, anon, authenticated;
grant select, insert, update on public.liora_orders, public.liora_order_payments to service_role;

-- One locked order per reconciliation. No elevated SECURITY DEFINER permissions.
create function public.liora_record_payment(p_order_id text, p_environment text, p_payment jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  o public.liora_orders%rowtype;
  chosen public.liora_order_payments%rowtype;
  n integer;
  reasons text[];
begin
  select * into strict o from public.liora_orders where id = p_order_id and environment = p_environment for update;
  if exists (select 1 from public.liora_order_payments where environment = p_environment and provider = o.provider
      and payment_id = p_payment->>'payment_id' and order_id <> o.id) then
    raise exception 'Payment already assigned';
  end if;
  insert into public.liora_order_payments(environment, provider, payment_id, order_id, status, method, installments, paid_cents, review_reasons, provider_updated_at)
  values (p_environment, o.provider, p_payment->>'payment_id', o.id, p_payment->>'status', p_payment->>'method',
    (p_payment->>'installments')::integer, (p_payment->>'paid_cents')::integer,
    array(select jsonb_array_elements_text(p_payment->'review_reasons')), (p_payment->>'updated_at')::timestamptz)
  on conflict (environment, provider, payment_id) do update set
    status = excluded.status, method = excluded.method, installments = excluded.installments, paid_cents = excluded.paid_cents,
    review_reasons = excluded.review_reasons, provider_updated_at = excluded.provider_updated_at, updated_at = now()
  where liora_order_payments.order_id = excluded.order_id
    and (liora_order_payments.provider_updated_at is null or excluded.provider_updated_at >= liora_order_payments.provider_updated_at)
    -- A delayed pending result must never undo money already received/returned.
    and not (liora_order_payments.status in ('approved','refunded','charged_back') and excluded.status in ('pending','in_process','authorized','rejected','cancelled'))
    and not (liora_order_payments.status in ('refunded','charged_back') and excluded.status = 'approved');
  select count(*) into n from public.liora_order_payments where order_id = o.id and status = 'approved';
  select * into chosen from public.liora_order_payments where order_id = o.id
    order by (status = 'approved') desc, updated_at desc, payment_id desc limit 1;
  reasons := chosen.review_reasons;
  if n > 1 then reasons := array_append(reasons, 'multiple_approved_payments'); end if;
  update public.liora_orders set
    status = case when cardinality(reasons) > 0 then 'review_required' else chosen.status end,
    review_reasons = reasons,
    confirmed_at = case when chosen.status = 'approved' and cardinality(reasons) = 0 then coalesce(confirmed_at, now()) else confirmed_at end,
    updated_at = now()
  where id = o.id;
  return jsonb_build_object('recorded', true, 'status', case when cardinality(reasons) > 0 then 'review_required' else chosen.status end);
end;
$$;
revoke all on function public.liora_record_payment(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.liora_record_payment(text,text,jsonb) to service_role;

-- Test payments and orders requiring review never appear in the paid-orders view. Personalization still needs confirmation.
create view public.liora_paid_orders with (security_invoker = true) as
select id, created_at, confirmed_at, customer, items, shipping, total_cents
from public.liora_orders where environment = 'production' and mode = 'live' and status = 'approved';
revoke all on public.liora_paid_orders from public, anon, authenticated;
grant select on public.liora_paid_orders to service_role;
