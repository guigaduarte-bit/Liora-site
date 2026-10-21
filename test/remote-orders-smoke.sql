-- Run against the dedicated Liora database as an administrator.
-- Synthetic data only; the entire transaction is rolled back. No provider calls.
begin;
set local role service_role;
do $$
declare
  test_id text := 'LIORA-TEST-20261021-ROLLBACK';
  payment jsonb := '{"payment_id":"SYNTHETIC-ROLLBACK","status":"approved","method":"pix","installments":1,"paid_cents":9115,"review_reasons":[],"updated_at":"2026-10-21T12:00:00Z"}';
  result jsonb;
begin
  insert into public.liora_orders(id,environment,mode,provider,method,total_cents,subtotal_cents,discount_cents,shipping_cents,customer,items,shipping,request_hash)
  values(test_id,'preview','test','mercadopago','pix',9115,7500,375,1990,
    '{"name":"Teste técnico fictício"}','[{"id":"synthetic","quantity":1}]','{"method":"synthetic"}',repeat('a',64));
  result := public.liora_record_payment(test_id,'preview',payment);
  if result->>'status' <> 'approved' then raise exception 'Approval reconciliation failed'; end if;
  perform public.liora_record_payment(test_id,'preview',payment);
  if (select count(*) from public.liora_order_payments where order_id=test_id) <> 1 then raise exception 'Duplicate payment'; end if;
  perform public.liora_record_payment(test_id,'preview',payment || '{"status":"pending","updated_at":"2026-10-21T11:00:00Z"}'::jsonb);
  if (select status from public.liora_orders where id=test_id) <> 'approved' then raise exception 'Late event regressed payment'; end if;
  if exists(select 1 from public.liora_paid_orders where id=test_id) then raise exception 'Test order exposed for fulfillment'; end if;
  result := public.liora_record_payment(test_id,'preview',payment || '{"method":"account_money","review_reasons":["pix_paid_with_balance"],"updated_at":"2026-10-21T13:00:00Z"}'::jsonb);
  if result->>'status' <> 'review_required' then raise exception 'Balance review not recorded'; end if;
  result := public.liora_record_payment(test_id,'preview',payment || '{"status":"refunded","updated_at":"2026-10-21T14:00:00Z"}'::jsonb);
  if result->>'status' <> 'refunded' then raise exception 'Refund not recorded'; end if;
  begin
    delete from public.liora_order_payments where order_id=test_id;
    raise exception 'Server unexpectedly allowed deletion';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.liora_orders;
    raise exception 'Anonymous order access unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.liora_record_payment('LIORA-TEST-20261021-ROLLBACK','preview','{}');
    raise exception 'Anonymous reconciliation unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  begin
    perform 1 from public.liora_paid_orders;
    raise exception 'Customer order access unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
