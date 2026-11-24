-- Private transactional outbox. No customer contact or CPF is copied here.
create table public.liora_order_alerts (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.liora_orders(id),
  environment text not null check (environment = 'production'),
  event_type text not null default 'payment_confirmed' check (event_type = 'payment_confirmed'),
  status text not null default 'queued' check (status in ('queued', 'sending', 'accepted', 'delivered', 'failed', 'unknown')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  provider_message_id text check (length(provider_message_id) between 1 and 1024),
  last_error_code text check (last_error_code ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  last_delivery_status text check (last_delivery_status in ('sent', 'delivered', 'read', 'failed')),
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, environment, event_type),
  unique (environment, provider_message_id)
);
create index liora_order_alerts_queue on public.liora_order_alerts(status, available_at, created_at)
  where status in ('queued', 'sending');
alter table public.liora_order_alerts enable row level security;
revoke all on public.liora_order_alerts from public, anon, authenticated, service_role;
grant select, insert, update on public.liora_order_alerts to service_role;

create function public.liora_enqueue_order_alert()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.environment <> 'production' or new.mode <> 'live' or new.status <> 'approved' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'approved' then return new; end if;
  -- The existing reconciliation writes a verified payment before approving its
  -- order. Manual/direct status writes without a payment do not emit alerts.
  if not exists (select 1 from public.liora_order_payments where order_id = new.id
    and environment = 'production' and status = 'approved') then return new; end if;
  insert into public.liora_order_alerts(order_id, environment)
    values (new.id, new.environment) on conflict (order_id, environment, event_type) do nothing;
  return new;
end;
$$;
revoke all on function public.liora_enqueue_order_alert() from public, anon, authenticated;
grant execute on function public.liora_enqueue_order_alert() to service_role;
create trigger liora_enqueue_order_alert after insert or update of status on public.liora_orders
for each row execute function public.liora_enqueue_order_alert();

create function public.liora_claim_order_alert(p_activation_start timestamptz, p_order_id text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  chosen public.liora_order_alerts%rowtype;
  order_record public.liora_orders%rowtype;
  safe_items jsonb;
begin
  if p_activation_start is null then raise exception 'Activation timestamp required'; end if;
  -- A worker lost after starting HTTP may already have sent the message.
  -- Quarantine that attempt instead of blindly sending it a second time.
  update public.liora_order_alerts set status = 'unknown', claim_token = null,
    last_error_code = 'SEND_LEASE_EXPIRED', updated_at = now()
    where status = 'sending' and claimed_at < now() - interval '5 minutes';
  update public.liora_order_alerts a set status = 'failed', last_error_code = 'ORDER_NOT_APPROVED', updated_at = now()
    where a.status = 'queued' and exists (select 1 from public.liora_orders o where o.id = a.order_id and o.status <> 'approved');
  select a.* into chosen from public.liora_order_alerts a
    join public.liora_orders o on o.id = a.order_id and o.environment = a.environment
    where a.status = 'queued' and a.available_at <= now() and a.attempts < 5
      and a.created_at >= p_activation_start and (p_order_id is null or a.order_id = p_order_id)
      and o.environment = 'production' and o.mode = 'live' and o.status = 'approved'
    order by a.available_at, a.created_at, a.id for update of a skip locked limit 1;
  if not found then return null; end if;
  update public.liora_order_alerts set status = 'sending', attempts = attempts + 1,
    claimed_at = now(), claim_token = gen_random_uuid(), updated_at = now()
    where id = chosen.id returning * into chosen;
  select * into strict order_record from public.liora_orders where id = chosen.order_id;
  select coalesce(jsonb_agg(jsonb_build_object('name', item->>'name', 'quantity', (item->>'quantity')::integer) order by ord), '[]'::jsonb)
    into safe_items from jsonb_array_elements(order_record.items) with ordinality as line(item, ord);
  return jsonb_build_object('id', chosen.id, 'claim_token', chosen.claim_token, 'attempts', chosen.attempts,
    'order_id', chosen.order_id, 'environment', chosen.environment, 'event_type', chosen.event_type,
    'total_cents', order_record.total_cents, 'items', safe_items, 'confirmed_at', order_record.confirmed_at);
end;
$$;
revoke all on function public.liora_claim_order_alert(timestamptz,text) from public, anon, authenticated;
grant execute on function public.liora_claim_order_alert(timestamptz,text) to service_role;

create function public.liora_finish_order_alert(
  p_alert_id uuid, p_claim_token uuid, p_state text,
  p_provider_message_id text default null, p_error_code text default null, p_retry_at timestamptz default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a public.liora_order_alerts%rowtype;
  next_state text;
begin
  if p_state is null or p_state not in ('accepted', 'failed', 'unknown', 'queued') then raise exception 'Invalid alert state'; end if;
  if p_provider_message_id is not null and length(p_provider_message_id) not between 1 and 1024 then raise exception 'Invalid message identity'; end if;
  if p_error_code is not null and p_error_code !~ '^[A-Za-z0-9_.:-]{1,80}$' then raise exception 'Invalid error code'; end if;
  select * into a from public.liora_order_alerts where id = p_alert_id for update;
  if not found then return jsonb_build_object('updated', false); end if;
  if a.status <> 'sending' or p_claim_token is null or a.claim_token is distinct from p_claim_token then
    return jsonb_build_object('updated', false, 'status', a.status);
  end if;
  if a.provider_message_id is not null and a.provider_message_id is distinct from p_provider_message_id then
    return jsonb_build_object('updated', false, 'status', a.status);
  end if;
  if p_state = 'accepted' and p_provider_message_id is null then raise exception 'Accepted message identity required'; end if;
  if p_state = 'queued' and (p_provider_message_id is not null or p_retry_at is null or p_retry_at <= now()) then
    raise exception 'A definite pre-acceptance failure and future retry time are required';
  end if;
  next_state := case when p_state = 'queued' and a.attempts >= 5 then 'failed' else p_state end;
  update public.liora_order_alerts set status = next_state,
    provider_message_id = coalesce(provider_message_id, p_provider_message_id),
    last_error_code = case when p_state = 'queued' and a.attempts >= 5 then 'ATTEMPT_LIMIT_REACHED' else p_error_code end,
    available_at = case when next_state = 'queued' then p_retry_at else available_at end,
    accepted_at = case when next_state = 'accepted' then coalesce(accepted_at, now()) else accepted_at end,
    claim_token = null, updated_at = now()
    where id = a.id;
  return jsonb_build_object('updated', true, 'status', next_state);
end;
$$;
revoke all on function public.liora_finish_order_alert(uuid,uuid,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.liora_finish_order_alert(uuid,uuid,text,text,text,timestamptz) to service_role;

-- The HTTP route must first verify Meta's signature, sending phone ID and
-- recipient. The opaque alert ID is echoed by Meta as callback correlation.
create function public.liora_update_order_alert_delivery(p_alert_id uuid, p_provider_message_id text, p_delivery_status text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a public.liora_order_alerts%rowtype;
  next_state text;
begin
  if p_provider_message_id is null or length(p_provider_message_id) not between 1 and 1024
    or p_delivery_status is null or p_delivery_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception 'Invalid delivery update';
  end if;
  select * into a from public.liora_order_alerts where id = p_alert_id for update;
  if not found then return jsonb_build_object('updated', false); end if;
  if a.provider_message_id is not null and a.provider_message_id <> p_provider_message_id then
    return jsonb_build_object('updated', false, 'status', a.status);
  end if;
  -- Signed callbacks can beat the HTTP acknowledgement or resolve an unknown
  -- network outcome. They cannot attach themselves to an unclaimed alert.
  if a.provider_message_id is null and (a.attempts = 0 or a.status not in ('sending', 'unknown', 'accepted')) then
    return jsonb_build_object('updated', false, 'status', a.status);
  end if;
  if a.last_delivery_status = 'read' or (a.status = 'delivered' and p_delivery_status not in ('delivered', 'read'))
    or (a.status = 'failed' and p_delivery_status = 'sent') then
    return jsonb_build_object('updated', false, 'status', a.status);
  end if;
  next_state := case when p_delivery_status in ('delivered', 'read') then 'delivered'
    when p_delivery_status = 'failed' then 'failed' else 'accepted' end;
  update public.liora_order_alerts set status = next_state, provider_message_id = p_provider_message_id,
    last_delivery_status = p_delivery_status,
    accepted_at = case when next_state in ('accepted', 'delivered') then coalesce(accepted_at, now()) else accepted_at end,
    delivered_at = case when next_state = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
    last_error_code = case when next_state = 'failed' then 'PROVIDER_DELIVERY_FAILED' else null end,
    claim_token = null, updated_at = now()
    where id = a.id;
  return jsonb_build_object('updated', true, 'status', next_state);
end;
$$;
revoke all on function public.liora_update_order_alert_delivery(uuid,text,text) from public, anon, authenticated;
grant execute on function public.liora_update_order_alert_delivery(uuid,text,text) to service_role;
