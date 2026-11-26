-- Synthetic database verification only. No external HTTP or message is sent.
-- Every write, including queues, is removed by the final ROLLBACK.
begin;
set local role service_role;
do $$
declare
  email_alert jsonb;
  result jsonb;
  email_id uuid := gen_random_uuid();
  order_id text := 'LIORA-EMAIL-SMOKE-' || upper(replace(gen_random_uuid()::text, '-', ''));
begin
  insert into public.liora_orders(id,environment,mode,provider,method,total_cents,subtotal_cents,discount_cents,shipping_cents,
    customer,items,shipping,request_hash)
  values(order_id,'production','live','mercadopago','card',11990,10000,0,1990,
    '{"name":"SYNTHETIC_DATABASE_TEST","email":"fixture@example.test"}'::jsonb,
    '[{"name":"Produto sintético","quantity":2,"price":50}]'::jsonb,
    '{"id":"synthetic-shipping"}'::jsonb,repeat('e',64));
  select public.liora_record_payment(order_id,'production',jsonb_build_object(
    'payment_id','synthetic-' || gen_random_uuid()::text,'status','approved','method','credit_card','installments',1,
    'paid_cents',11990,'review_reasons','[]'::jsonb,'updated_at',now())) into result;
  if result->>'status' <> 'approved' then raise exception 'Synthetic payment not recorded'; end if;
  select public.liora_claim_order_email(now() - interval '1 minute',order_id) into email_alert;
  if email_alert is null or email_alert->>'attempts' <> '1' then raise exception 'Email claim missing'; end if;
  if email_alert ?| array['customer','customer_cpf_hash','shipping','email','address','recipient'] then raise exception 'Email payload contains customer data'; end if;
  select public.liora_update_order_email_delivery((email_alert->>'id')::uuid,email_id,'delivered',now()) into result;
  if result->>'status' <> 'delivered' then raise exception 'Email delivery not recorded'; end if;
  select public.liora_finish_order_email((email_alert->>'id')::uuid,(email_alert->>'claim_token')::uuid,'accepted',email_id,null,null) into result;
  if result->>'updated' <> 'false' or result->>'status' <> 'delivered' then raise exception 'Late ACK overwrote delivery'; end if;
  select public.liora_claim_order_email(now() - interval '1 minute',order_id) into result;
  if result is not null then raise exception 'Delivered email claimed twice'; end if;
end;
$$;
rollback;
select 'email_smoke_passed_and_rolled_back' as verification;
