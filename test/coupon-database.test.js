'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, beforeEach, after, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const orders = require('../api/_orders');

let db;
const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64);
before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; alter default privileges in schema public grant all on tables to service_role;');
  const dir = path.join(__dirname, '../supabase/migrations');
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("reset role; truncate liora_orders, liora_order_payments, liora_coupon_customers cascade; update liora_coupon_history_status set ready=false, verified_at=null, source_reference=null;");
});
async function ready(environment = 'development') {
  await db.query('update liora_coupon_history_status set ready=true, verified_at=now(), source_reference=$1 where environment=$2', ['synthetic complete history fixture', environment]);
}
function snapshot(id = 'LIORA-TEST-1234567890', overrides = {}) {
  return { id, environment: 'development', mode: 'test', provider: 'mercadopago', method: 'card',
    total_cents: 10990, subtotal_cents: 10000, discount_cents: 1000, shipping_cents: 1990,
    interest_free_installments: 0, customer: { name: 'Pessoa de teste', email: 'fixture@example.com' },
    items: [{ id: 'synthetic', quantity: 1, price: 100 }], shipping: { id: 'fixture-delivery' },
    request_hash: 'c'.repeat(64), customer_cpf_hash: hashA, coupon_code: 'PRIMEIRACOMPRA',
    coupon_discount_cents: 1000, payment_discount_cents: 0, ...overrides };
}
function fullPrice(id, overrides = {}) {
  return snapshot(id, { coupon_code: null, coupon_discount_cents: 0, discount_cents: 0, total_cents: 11990, ...overrides });
}
async function register(order) {
  await db.exec('set role service_role');
  try { return (await db.query('select public.liora_register_coupon_order($1::jsonb) as result', [JSON.stringify(order)])).rows[0].result; }
  finally { await db.exec('reset role'); }
}
async function eligibility(hash = hashA, environment = 'development', orderId = null) {
  return (await db.query('select public.liora_coupon_eligibility($1,$2,$3) as result', [hash, environment, orderId])).rows[0].result;
}
async function payment(order, status, id = '123') {
  const body = { payment_id: id, status, method: 'credit_card', installments: 1, paid_cents: order.total_cents,
    review_reasons: [], updated_at: '2026-11-20T14:00:00Z' };
  await db.exec('set role service_role');
  try { return (await db.query('select public.liora_record_payment($1,$2,$3::jsonb) as result', [order.id, order.environment, JSON.stringify(body)])).rows[0].result; }
  finally { await db.exec('reset role'); }
}

test('primeira compra falha de modo seguro enquanto o histórico completo não foi validado', async () => {
  assert.deepEqual(await eligibility(), { eligible: false, code: 'COUPON_HISTORY_UNAVAILABLE' });
  assert.equal((await register(snapshot())).code, 'COUPON_HISTORY_UNAVAILABLE');
  assert.equal((await db.query('select count(*)::int n from liora_orders')).rows[0].n, 0);
  await assert.rejects(db.exec("update liora_coupon_history_status set ready=true, verified_at=now() where environment='production'"), /check constraint/);
  assert.equal((await register(fullPrice('LIORA-NOCOUPON-0001'))).created, true, 'ordinary orders can build history before first-order activation');
});

test('reserva permite apenas um pedido com PRIMEIRACOMPRA por CPF', async () => {
  await ready();
  assert.equal((await register(snapshot())).created, true);
  assert.equal((await register(snapshot('LIORA-SECOND-1234567890'))).code, 'COUPON_ORDER_PENDING');
  assert.equal((await register(snapshot('LIORA-OTHERCPF-1234567890', { customer_cpf_hash: hashB }))).created, true);
  assert.equal((await db.query('select count(*)::int n from liora_orders')).rows[0].n, 2);
});

test('reenvio idêntico reutiliza pedido; a mesma chave com outro conteúdo é recusada', async () => {
  await ready();
  const order = snapshot();
  assert.equal((await register(order)).created, true);
  assert.equal((await register(order)).created, false);
  assert.equal((await register({ ...order, request_hash: 'd'.repeat(64) })).code, 'CHECKOUT_KEY_CONFLICT');
  assert.equal((await register({ ...order, customer_cpf_hash: hashB })).code, 'CHECKOUT_KEY_CONFLICT');
  await payment(order, 'approved');
  assert.equal((await register(order)).created, false, 'the original order remains recoverable after payment');
});

test('qualquer pedido aberto anterior impede primeiro cupom; reserva impede um segundo pedido sem cupom', async () => {
  await ready();
  const ordinary = fullPrice('LIORA-ORDINARY-1234567890');
  assert.equal((await register(ordinary)).created, true);
  assert.equal((await register(fullPrice('LIORA-ORDINARY2-1234567890'))).created, true);
  assert.equal((await register(snapshot())).code, 'COUPON_ORDER_PENDING');
  await db.exec('update liora_orders set checkout_closed_at=now()');
  assert.equal((await register(snapshot())).created, true);
  assert.equal((await register(fullPrice('LIORA-ORDINARY3-1234567890'))).code, 'COUPON_ORDER_PENDING');
});

test('rejeição de uma tentativa de pagamento não reabre o cupom de um checkout reutilizável', async () => {
  await ready();
  const order = snapshot();
  await register(order);
  await payment(order, 'rejected');
  assert.equal((await eligibility()).code, 'COUPON_ORDER_PENDING');
  assert.equal((await register(snapshot('LIORA-RETRY-1234567890'))).code, 'COUPON_ORDER_PENDING');
  await db.query('update liora_orders set checkout_closed_at=now() where id=$1', [order.id]);
  assert.deepEqual(await eligibility(), { eligible: true });
  assert.equal((await register(snapshot('LIORA-RETRY-1234567890'))).created, true);
});

test('pagamento sem cupom também torna o CPF inelegível; reembolso não concede nova primeira compra', async () => {
  await ready();
  const order = fullPrice('LIORA-NORMAL-1234567890');
  await register(order);
  await payment(order, 'approved');
  assert.equal((await eligibility()).code, 'COUPON_FIRST_ORDER_ONLY');
  await payment(order, 'refunded');
  assert.equal((await register(snapshot())).code, 'COUPON_FIRST_ORDER_ONLY');
  const customer = (await db.query('select * from liora_coupon_customers')).rows[0];
  assert.equal(customer.has_paid_order, true);
  assert.equal(customer.first_paid_order_id, order.id);
  assert.doesNotMatch(JSON.stringify(customer), /cpf_number|19119119100/);
});

test('histórico importado bloqueia compradores antigos e ambientes permanecem separados', async () => {
  await ready(); await ready('preview');
  await db.query('insert into liora_coupon_customers(environment,cpf_hash,has_paid_order,source_reference) values ($1,$2,true,$3)', ['development', hashA, 'synthetic historical fixture']);
  assert.equal((await eligibility()).code, 'COUPON_FIRST_ORDER_ONLY');
  assert.deepEqual(await eligibility(hashA, 'preview'), { eligible: true });
  assert.equal((await register(snapshot('LIORA-PREVIEW-1234567890', { environment: 'preview' }))).created, true);
});

test('BF20% não exige primeira compra, mas mantém totais e registro por CPF', async () => {
  const order = snapshot('LIORA-BF-1234567890', { coupon_code: 'BF20%', coupon_discount_cents: 2000, discount_cents: 2000, total_cents: 9990 });
  const result = await register(order);
  assert.equal(result.created, true);
  assert.equal(result.order.subtotal_cents, 10000);
  assert.equal(result.order.shipping_cents, 1990);
  await assert.rejects(register({ ...order, id: 'LIORA-WRONG-1234567890', total_cents: 9991 }), /check constraint/);
});

test('visitantes não podem consultar histórico, reservar cupons ou registrar pagamentos', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.liora_coupon_customers'), /permission denied/);
    await assert.rejects(db.query('select * from public.liora_coupon_history_status'), /permission denied/);
    await assert.rejects(db.query('select public.liora_coupon_eligibility($1,$2,null)', [hashA, 'production']), /permission denied/);
    await assert.rejects(db.query('select public.liora_register_coupon_order($1::jsonb)', [JSON.stringify(snapshot())]), /permission denied/);
    await db.exec('reset role');
  }
  const functions = (await db.query("select proname, prosecdef, proconfig from pg_proc where proname in ('liora_coupon_eligibility','liora_register_coupon_order','liora_capture_paid_customer')")).rows;
  assert.equal(functions.length, 3);
  assert.ok(functions.every(f => !f.prosecdef && f.proconfig.includes('search_path=""')));
  const tables = (await db.query("select relname, relrowsecurity from pg_class where relname in ('liora_coupon_customers','liora_coupon_history_status')")).rows;
  assert.ok(tables.every(t => t.relrowsecurity));
});

test('ativação de cupons registra pedidos sem ativar Pix direto', () => {
  const before = { checkout: process.env.LIORA_CHECKOUT_V2, coupons: process.env.LIORA_COUPONS_ENABLED };
  try {
    delete process.env.LIORA_CHECKOUT_V2;
    process.env.LIORA_COUPONS_ENABLED = 'true';
    assert.equal(orders.enabled(), false);
    assert.equal(orders.couponsEnabled(), true);
    assert.equal(orders.trackingEnabled(), true);
  } finally {
    for (const [key, value] of [['LIORA_CHECKOUT_V2', before.checkout], ['LIORA_COUPONS_ENABLED', before.coupons]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
