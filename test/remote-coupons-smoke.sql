-- Run only against the dedicated Liora database, after both coupon/alert migrations.
-- The complete script must run in ONE connection. All fixtures and readiness
-- changes remain uncommitted and are rolled back. No payment or messaging HTTP calls.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Verify the closed history gate, then enable it only inside this transaction.
update public.liora_coupon_history_status set ready = false where environment = 'production';
set local role service_role;
do $$
declare
  result jsonb;
begin
  result := public.liora_coupon_eligibility(repeat('f',64),'production',null);
  if result->>'code' is distinct from 'COUPON_HISTORY_UNAVAILABLE' then
    raise exception 'Incomplete history was not rejected';
  end if;
  begin
    update public.liora_coupon_history_status set ready = true where environment = 'production';
    raise exception 'Service role unexpectedly allowed history activation';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
update public.liora_coupon_history_status
set ready = true, verified_at = now(), source_reference = 'synthetic rollback smoke only'
where environment = 'production';

set local role service_role;
do $$
declare
  suffix text := upper(replace(gen_random_uuid()::text,'-',''));
  order_id text;
  preview_id text;
  synthetic_hash text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  order_snapshot jsonb;
  payment jsonb;
  result jsonb;
  claimed jsonb;
  callback_result jsonb;
begin
  order_id := 'LIORA-SMOKE-' || suffix;
  preview_id := 'LIORA-PREVIEW-SMOKE-' || suffix;
  order_snapshot := jsonb_build_object(
    'id',order_id,'environment','production','mode','live',
    'provider','mercadopago','method','pix',
    'subtotal_cents',10000,'coupon_discount_cents',1000,'payment_discount_cents',450,
    'discount_cents',1450,'shipping_cents',1990,'total_cents',10540,
    'customer','{}'::jsonb,
    'items','[{"name":"Produto sintético","quantity":1,"price":100}]'::jsonb,
    'shipping','{"method":"synthetic"}'::jsonb,
    'request_hash',repeat('e',64),'customer_cpf_hash',synthetic_hash,
    'coupon_code','PRIMEIRACOMPRA'
  );
  result := public.liora_register_coupon_order(order_snapshot);
  if result->>'created' is distinct from 'true' then raise exception 'First order registration failed'; end if;
  if (result#>>'{order,total_cents}')::integer is distinct from 10540
    or (result#>>'{order,shipping_cents}')::integer is distinct from 1990 then
    raise exception 'Coupon/Pix/shipping totals changed';
  end if;
  result := public.liora_register_coupon_order(order_snapshot);
  if result->>'created' is distinct from 'false' then raise exception 'Retry was not idempotent'; end if;
  result := public.liora_register_coupon_order(order_snapshot || jsonb_build_object('request_hash',repeat('d',64)));
  if result->>'code' is distinct from 'CHECKOUT_KEY_CONFLICT' then raise exception 'Changed checkout key was accepted'; end if;
  result := public.liora_register_coupon_order(order_snapshot || jsonb_build_object('id',order_id || '-SECOND'));
  if result->>'code' is distinct from 'COUPON_ORDER_PENDING' then raise exception 'Concurrent first coupon was accepted'; end if;
  result := public.liora_register_coupon_order(order_snapshot || jsonb_build_object(
    'id',order_id || '-NORMAL','coupon_code',null,'coupon_discount_cents',0,
    'payment_discount_cents',500,'discount_cents',500,'total_cents',11490));
  if result->>'code' is distinct from 'COUPON_ORDER_PENDING' then raise exception 'Ordinary checkout bypassed first coupon reservation'; end if;
  if exists(select 1 from public.liora_order_alerts where liora_order_alerts.order_id=order_snapshot->>'id') then
    raise exception 'Unpaid order emitted an alert';
  end if;

  payment := jsonb_build_object('payment_id','SYNTHETIC-' || suffix,'status','approved',
    'method','pix','installments',1,'paid_cents',10540,'review_reasons','[]'::jsonb,'updated_at',now());
  result := public.liora_record_payment(order_id,'production',payment);
  if result->>'status' is distinct from 'approved' then raise exception 'Payment reconciliation failed'; end if;
  perform public.liora_record_payment(order_id,'production',payment);
  if (select count(*) from public.liora_order_alerts a where a.order_id=order_snapshot->>'id') <> 1 then
    raise exception 'Confirmed order did not emit exactly one alert';
  end if;
  if not exists(select 1 from public.liora_coupon_customers where environment='production'
    and cpf_hash=synthetic_hash and has_paid_order) then raise exception 'Paid CPF marker missing'; end if;
  result := public.liora_register_coupon_order(order_snapshot);
  if result->>'created' is distinct from 'false' then raise exception 'Paid order retry was blocked'; end if;
  result := public.liora_coupon_eligibility(synthetic_hash,'production',null);
  if result->>'code' is distinct from 'COUPON_FIRST_ORDER_ONLY' then raise exception 'Paid customer remained eligible'; end if;

  claimed := public.liora_claim_order_alert(now() - interval '1 minute',order_id);
  if claimed is null or claimed->>'claim_token' is null
    or (claimed->>'total_cents')::integer is distinct from 10540 then raise exception 'Alert claim failed'; end if;
  if claimed ?| array['customer','customer_cpf_hash','shipping','email','address'] then raise exception 'Alert payload contains customer data'; end if;
  if public.liora_claim_order_alert(now() - interval '1 minute',order_id) is not null then
    raise exception 'Alert was claimed twice';
  end if;
  result := public.liora_finish_order_alert((claimed->>'id')::uuid,(claimed->>'claim_token')::uuid,
    'unknown',null,'SYNTHETIC_NETWORK_TIMEOUT',null);
  if result->>'status' is distinct from 'unknown' then raise exception 'Unknown send state was not retained'; end if;
  if public.liora_claim_order_alert(now() - interval '1 minute',order_id) is not null then
    raise exception 'Unknown send was blindly retried';
  end if;
  if (select o.status from public.liora_orders o where o.id=order_snapshot->>'id') is distinct from 'approved' then
    raise exception 'Alert failure changed payment state';
  end if;
  callback_result := public.liora_update_order_alert_delivery((claimed->>'id')::uuid,'wamid.synthetic.' || suffix,'delivered');
  if callback_result->>'status' is distinct from 'delivered' then raise exception 'Late callback failed'; end if;
  result := public.liora_finish_order_alert((claimed->>'id')::uuid,(claimed->>'claim_token')::uuid,
    'accepted','wamid.synthetic.' || suffix,null,null);
  if result->>'updated' is distinct from 'false' or result->>'status' is distinct from 'delivered' then
    raise exception 'Stale HTTP acknowledgement regressed delivery';
  end if;

  -- Cross-environment isolation: a paid preview order must not notify production.
  result := public.liora_register_coupon_order(order_snapshot || jsonb_build_object(
    'id',preview_id,'environment','preview','mode','test','coupon_code',null,
    'coupon_discount_cents',0,'payment_discount_cents',500,'discount_cents',500,'total_cents',11490));
  if result->>'created' is distinct from 'true' then raise exception 'Preview registration failed'; end if;
  perform public.liora_record_payment(preview_id,'preview',payment || '{"paid_cents":11490}'::jsonb);
  if exists(select 1 from public.liora_order_alerts a where a.order_id=preview_id) then raise exception 'Preview emitted a production alert'; end if;
  begin
    delete from public.liora_order_alerts where id=(claimed->>'id')::uuid;
    raise exception 'Service role unexpectedly allowed deleting alerts';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role anon;
do $$
begin
  begin
    perform public.liora_coupon_eligibility(repeat('f',64),'production',null);
    raise exception 'Anonymous coupon RPC access was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.liora_order_alerts;
    raise exception 'Anonymous alert access was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
do $$
begin
  begin
    perform public.liora_claim_order_alert(now(),null);
    raise exception 'Authenticated alert claim was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.liora_coupon_customers;
    raise exception 'Authenticated CPF history access was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
select 'coupon_payment_alert_smoke_passed_and_rolled_back' as smoke_result;
