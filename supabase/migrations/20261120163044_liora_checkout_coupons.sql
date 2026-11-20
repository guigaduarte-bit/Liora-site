-- CPF values never enter this ledger: the server sends only a keyed HMAC.
-- Keep existing Checkout Pro behavior independent from LIORA_CHECKOUT_V2.
alter table public.liora_orders
  add column customer_cpf_hash text check (customer_cpf_hash ~ '^[a-f0-9]{64}$'),
  add column coupon_code text check (coupon_code in ('BF20%', 'PRIMEIRACOMPRA')),
  add column coupon_discount_cents integer not null default 0 check (coupon_discount_cents >= 0),
  add column payment_discount_cents integer not null default 0 check (payment_discount_cents >= 0),
  add column checkout_closed_at timestamptz,
  add constraint liora_coupon_breakdown check (
    customer_cpf_hash is null or discount_cents = coupon_discount_cents + payment_discount_cents
  ),
  add constraint liora_coupon_amount check (
    (coupon_code is null and coupon_discount_cents = 0)
    or (coupon_code is not null and coupon_discount_cents > 0 and customer_cpf_hash is not null)
  );
create index liora_orders_cpf on public.liora_orders(environment, customer_cpf_hash, created_at)
  where customer_cpf_hash is not null;

-- Mark ready only after the entire historical customer source is imported and
-- all new paid orders are being captured with the same stable HMAC key.
create table public.liora_coupon_history_status (
  environment text primary key check (environment in ('production', 'preview', 'development')),
  ready boolean not null default false,
  verified_at timestamptz,
  source_reference text,
  check (not ready or (verified_at is not null and source_reference is not null and length(trim(source_reference)) > 0))
);
insert into public.liora_coupon_history_status(environment)
values ('production'), ('preview'), ('development');

-- This row also serializes creation for one CPF, including checkouts that do
-- not use a coupon. A paid order stays historical even after a refund.
create table public.liora_coupon_customers (
  environment text not null check (environment in ('production', 'preview', 'development')),
  cpf_hash text not null check (cpf_hash ~ '^[a-f0-9]{64}$'),
  has_paid_order boolean not null default false,
  first_paid_order_id text,
  first_paid_at timestamptz,
  source_reference text,
  updated_at timestamptz not null default now(),
  primary key (environment, cpf_hash)
);
alter table public.liora_coupon_history_status enable row level security;
alter table public.liora_coupon_customers enable row level security;
revoke all on public.liora_coupon_history_status, public.liora_coupon_customers from public, anon, authenticated, service_role;
grant select on public.liora_coupon_history_status to service_role;
grant select, insert, update on public.liora_coupon_customers to service_role;

create function public.liora_coupon_eligibility(p_cpf_hash text, p_environment text, p_order_id text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_cpf_hash is null or p_cpf_hash !~ '^[a-f0-9]{64}$'
    or p_environment is null or p_environment not in ('production', 'preview', 'development') then
    raise exception 'Invalid coupon identity';
  end if;
  if not exists (select 1 from public.liora_coupon_history_status where environment = p_environment and ready) then
    return jsonb_build_object('eligible', false, 'code', 'COUPON_HISTORY_UNAVAILABLE');
  end if;
  if exists (select 1 from public.liora_coupon_customers where environment = p_environment and cpf_hash = p_cpf_hash and has_paid_order)
    or exists (select 1 from public.liora_orders where environment = p_environment and customer_cpf_hash = p_cpf_hash
      and (confirmed_at is not null or status in ('approved', 'refunded', 'charged_back', 'in_mediation'))) then
    return jsonb_build_object('eligible', false, 'code', 'COUPON_FIRST_ORDER_ONLY');
  end if;
  -- A failed individual payment does not close a reusable Checkout Pro link.
  -- Only verified provider-side closure may set checkout_closed_at.
  if exists (select 1 from public.liora_orders where environment = p_environment and customer_cpf_hash = p_cpf_hash
    and id is distinct from p_order_id and checkout_closed_at is null) then
    return jsonb_build_object('eligible', false, 'code', 'COUPON_ORDER_PENDING');
  end if;
  return jsonb_build_object('eligible', true);
end;
$$;
revoke all on function public.liora_coupon_eligibility(text,text,text) from public, anon, authenticated;
grant execute on function public.liora_coupon_eligibility(text,text,text) to service_role;

create function public.liora_register_coupon_order(p_order jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  incoming public.liora_orders%rowtype;
  existing public.liora_orders%rowtype;
  eligibility jsonb;
begin
  incoming := jsonb_populate_record(null::public.liora_orders, p_order);
  if incoming.customer_cpf_hash is null or incoming.customer_cpf_hash !~ '^[a-f0-9]{64}$'
    or incoming.environment is null or incoming.environment not in ('production', 'preview', 'development') then
    raise exception 'Invalid coupon identity';
  end if;
  insert into public.liora_coupon_customers(environment, cpf_hash)
    values (incoming.environment, incoming.customer_cpf_hash) on conflict do nothing;
  perform 1 from public.liora_coupon_customers
    where environment = incoming.environment and cpf_hash = incoming.customer_cpf_hash for update;

  -- Exact retries precede eligibility checks, including after payment succeeds.
  select * into existing from public.liora_orders where id = incoming.id;
  if found then
    if existing.environment is distinct from incoming.environment
      or existing.customer_cpf_hash is distinct from incoming.customer_cpf_hash
      or existing.request_hash is distinct from incoming.request_hash then
      return jsonb_build_object('code', 'CHECKOUT_KEY_CONFLICT');
    end if;
    return jsonb_build_object('order', to_jsonb(existing), 'created', false);
  end if;

  if incoming.coupon_code = 'PRIMEIRACOMPRA' then
    eligibility := public.liora_coupon_eligibility(incoming.customer_cpf_hash, incoming.environment, incoming.id);
    if not (eligibility->>'eligible')::boolean then return eligibility; end if;
  elsif exists (select 1 from public.liora_orders where environment = incoming.environment
    and customer_cpf_hash = incoming.customer_cpf_hash and coupon_code = 'PRIMEIRACOMPRA'
    and checkout_closed_at is null and confirmed_at is null
    and status not in ('approved', 'refunded', 'charged_back', 'in_mediation')) then
    -- A second non-coupon order could otherwise become the first paid order
    -- while the reserved discount remains payable on the older link.
    return jsonb_build_object('code', 'COUPON_ORDER_PENDING');
  end if;

  insert into public.liora_orders (
    id, environment, mode, provider, method, total_cents, subtotal_cents, discount_cents, shipping_cents,
    interest_free_installments, customer, items, shipping, request_hash,
    customer_cpf_hash, coupon_code, coupon_discount_cents, payment_discount_cents
  ) values (
    incoming.id, incoming.environment, incoming.mode, incoming.provider, incoming.method,
    incoming.total_cents, incoming.subtotal_cents, incoming.discount_cents, incoming.shipping_cents,
    coalesce(incoming.interest_free_installments, 0), incoming.customer, incoming.items, incoming.shipping, incoming.request_hash,
    incoming.customer_cpf_hash, incoming.coupon_code, coalesce(incoming.coupon_discount_cents, 0), coalesce(incoming.payment_discount_cents, 0)
  ) on conflict (id) do nothing returning * into existing;
  if not found then return jsonb_build_object('code', 'CHECKOUT_KEY_CONFLICT'); end if;
  return jsonb_build_object('order', to_jsonb(existing), 'created', true);
end;
$$;
revoke all on function public.liora_register_coupon_order(jsonb) from public, anon, authenticated;
grant execute on function public.liora_register_coupon_order(jsonb) to service_role;

-- This runs only after the existing reconciliation RPC has accepted verified
-- payment data. The historical marker is monotonic and never re-opens coupons.
create function public.liora_capture_paid_customer()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  o public.liora_orders%rowtype;
begin
  if new.status not in ('approved', 'refunded', 'charged_back', 'in_mediation') then return new; end if;
  select * into strict o from public.liora_orders where id = new.order_id;
  if o.customer_cpf_hash is null then return new; end if;
  insert into public.liora_coupon_customers(environment, cpf_hash, has_paid_order, first_paid_order_id, first_paid_at, source_reference)
  values (o.environment, o.customer_cpf_hash, true, o.id, now(), 'verified_payment')
  on conflict (environment, cpf_hash) do update set
    has_paid_order = true,
    first_paid_order_id = coalesce(liora_coupon_customers.first_paid_order_id, excluded.first_paid_order_id),
    first_paid_at = coalesce(liora_coupon_customers.first_paid_at, excluded.first_paid_at),
    source_reference = coalesce(liora_coupon_customers.source_reference, excluded.source_reference),
    updated_at = now();
  return new;
end;
$$;
revoke all on function public.liora_capture_paid_customer() from public, anon, authenticated;
grant execute on function public.liora_capture_paid_customer() to service_role;
create trigger liora_capture_paid_customer after insert or update of status on public.liora_order_payments
for each row execute function public.liora_capture_paid_customer();
