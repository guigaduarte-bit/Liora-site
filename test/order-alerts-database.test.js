'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, beforeEach, after, test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

let db, sequence = 0;
before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; alter default privileges in schema public grant all on tables to service_role;');
  const directory = path.join(__dirname, '../supabase/migrations');
  for (const filename of fs.readdirSync(directory).filter(n => n.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(directory, filename), 'utf8'));
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec('reset role; truncate liora_orders, liora_order_payments, liora_coupon_customers, liora_order_alerts cascade;'); });

async function serverQuery(query, parameters) {
  await db.exec('set role service_role');
  try { return await db.query(query, parameters); }
  finally { await db.exec('reset role'); }
}
async function createOrder(environment = 'production') {
  const order = { id: `LIORA-ALERT-${String(++sequence).padStart(12, '0')}`, environment, mode: environment === 'production' ? 'live' : 'test',
    provider: 'mercadopago', method: 'card', total_cents: 11990, subtotal_cents: 10000, discount_cents: 0, shipping_cents: 1990,
    customer: { name: 'Cliente sintético', email: 'fixture@example.com', address: 'Endereço sintético', cpf: '19119119100' },
    items: [{ name: 'Vela sintética', quantity: 2, price: 50, fragrance: 'Lavanda' }], shipping: { id: 'synthetic-fixed' }, request_hash: 'e'.repeat(64) };
  const columns = Object.keys(order), values = Object.values(order).map(v => v && typeof v === 'object' ? JSON.stringify(v) : v);
  await serverQuery(`insert into liora_orders (${columns.join(',')}) values (${values.map((_, i) => '$' + (i + 1)).join(',')})`, values);
  return order;
}
async function pay(order, status = 'approved', reasons = []) {
  const payment = { payment_id: String(sequence), status, method: 'credit_card', installments: 1, paid_cents: order.total_cents,
    review_reasons: reasons, updated_at: '2026-11-20T17:00:00Z' };
  return (await serverQuery('select liora_record_payment($1,$2,$3::jsonb) as result', [order.id, order.environment, JSON.stringify(payment)])).rows[0].result;
}
async function claim(orderId = null, activation = '2000-01-01T00:00:00Z') {
  return (await serverQuery('select liora_claim_order_alert($1,$2) as result', [activation, orderId])).rows[0].result;
}
async function finish(alert, state, messageId = null, errorCode = null, retryAt = null, token = alert.claim_token) {
  return (await serverQuery('select liora_finish_order_alert($1,$2,$3,$4,$5,$6) as result', [alert.id, token, state, messageId, errorCode, retryAt])).rows[0].result;
}
async function delivery(alert, status, messageId = 'wamid.synthetic-confirmed') {
  return (await serverQuery('select liora_update_order_alert_delivery($1,$2,$3) as result', [alert.id, messageId, status])).rows[0].result;
}
async function alertRows() { return (await db.query('select * from liora_order_alerts order by created_at,id')).rows; }

test('apenas pagamento aprovado e verificado de produção enfileira aviso; reentregas não duplicam', async () => {
  for (const environment of ['preview', 'development']) {
    const order = await createOrder(environment); await pay(order);
  }
  const pending = await createOrder(); await pay(pending, 'pending');
  const review = await createOrder(); await pay(review, 'approved', ['installment_terms_mismatch']);
  const manual = await createOrder(); await db.query("update liora_orders set status='approved' where id=$1", [manual.id]);
  assert.equal((await alertRows()).length, 0);
  const order = await createOrder(); await pay(order); await pay(order);
  const rows = await alertRows();
  assert.equal(rows.length, 1); assert.equal(rows[0].order_id, order.id);
  assert.equal(rows[0].event_type, 'payment_confirmed'); assert.equal(rows[0].status, 'queued');
});

test('claim usa ativação explícita, concede uma só posse e retorna somente conteúdo mínimo', async () => {
  const order = await createOrder(); await pay(order);
  assert.equal(await claim(order.id, '2999-01-01T00:00:00Z'), null);
  await assert.rejects(claim(order.id, null), /Activation timestamp/);
  const alert = await claim(order.id);
  assert.match(alert.id, /^[a-f0-9-]{36}$/); assert.match(alert.claim_token, /^[a-f0-9-]{36}$/);
  assert.equal(alert.attempts, 1); assert.equal(alert.total_cents, 11990);
  assert.deepEqual(alert.items, [{ name: 'Vela sintética', quantity: 2 }]);
  assert.doesNotMatch(JSON.stringify(alert), /Cliente sintético|fixture@example.com|19119119100|Endereço|Lavanda|customer|shipping/);
  assert.equal(await claim(order.id), null);
  const wrongToken = await finish(alert, 'accepted', 'wamid.synthetic', null, null, randomUUID());
  assert.equal(wrongToken.updated, false);
  assert.deepEqual(await finish(alert, 'accepted', 'wamid.synthetic'), { updated: true, status: 'accepted' });
  assert.equal((await finish(alert, 'failed', null, 'UNEXPECTED_DUPLICATE')).updated, false);
});

test('falha e resultado desconhecido do envio nunca desfazem pedido aprovado nem repetem envio automaticamente', async () => {
  const order = await createOrder(); await pay(order);
  const alert = await claim(order.id);
  assert.deepEqual(await finish(alert, 'unknown', null, 'NETWORK_TIMEOUT'), { updated: true, status: 'unknown' });
  assert.equal(await claim(order.id), null);
  assert.equal((await db.query('select status from liora_orders where id=$1', [order.id])).rows[0].status, 'approved');
  assert.deepEqual(await delivery(alert, 'delivered'), { updated: true, status: 'delivered' });
});

test('lease vencida fica unknown, preservando callback tardio sem nova tentativa', async () => {
  const order = await createOrder(); await pay(order);
  const alert = await claim(order.id);
  await db.query("update liora_order_alerts set claimed_at=now()-interval '6 minutes' where id=$1", [alert.id]);
  assert.equal(await claim(order.id), null);
  const row = (await alertRows())[0];
  assert.equal(row.status, 'unknown'); assert.equal(row.last_error_code, 'SEND_LEASE_EXPIRED'); assert.equal(row.attempts, 1);
  assert.equal((await finish(alert, 'accepted', 'wamid.late-http')).updated, false);
  assert.equal((await delivery(alert, 'delivered', 'wamid.late-callback')).status, 'delivered');
});

test('callback assinado pode preceder ack; ID diferente ou callback anterior ao claim é recusado', async () => {
  const order = await createOrder(); await pay(order);
  const queued = (await alertRows())[0];
  assert.equal((await delivery(queued, 'delivered')).updated, false);
  const alert = await claim(order.id);
  assert.deepEqual(await delivery(alert, 'delivered'), { updated: true, status: 'delivered' });
  assert.equal((await finish(alert, 'accepted', 'wamid.synthetic-confirmed')).updated, false);
  assert.equal((await delivery(alert, 'read', 'wamid.different-message')).updated, false);
  assert.equal((await delivery(alert, 'failed')).updated, false);
  assert.equal((await delivery(alert, 'sent')).updated, false);
  assert.equal((await delivery(alert, 'read')).status, 'delivered');
  assert.equal((await delivery(alert, 'delivered')).updated, false, 'read must not regress to delivered');
  assert.equal((await alertRows())[0].last_delivery_status, 'read');
});

test('retentativa exige falha antes de aceitação, prazo futuro e respeita limite de cinco tentativas', async () => {
  const order = await createOrder(); await pay(order);
  let alert = await claim(order.id);
  await assert.rejects(finish(alert, 'queued', null, 'RATE_LIMIT', '2000-01-01T00:00:00Z'), /future retry/);
  await assert.rejects(finish(alert, 'queued', 'wamid.already-sent', 'RATE_LIMIT', '2999-01-01T00:00:00Z'), /pre-acceptance/);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await finish(alert, 'queued', null, 'RATE_LIMIT', '2999-01-01T00:00:00Z');
    assert.equal(result.status, attempt === 5 ? 'failed' : 'queued');
    if (attempt === 5) break;
    assert.equal(await claim(order.id), null, 'future retry is not claimed early');
    await db.query("update liora_order_alerts set available_at=now()-interval '1 second' where id=$1", [alert.id]);
    alert = await claim(order.id);
    assert.equal(alert.attempts, attempt + 1);
  }
  assert.equal(await claim(order.id), null);
  assert.equal((await alertRows())[0].last_error_code, 'ATTEMPT_LIMIT_REACHED');
});

test('pedido estornado antes do envio não dispara confirmação atrasada', async () => {
  const order = await createOrder(); await pay(order); await pay(order, 'refunded');
  assert.equal(await claim(order.id), null);
  const row = (await alertRows())[0];
  assert.equal(row.status, 'failed'); assert.equal(row.last_error_code, 'ORDER_NOT_APPROVED');
  assert.equal((await db.query('select status from liora_orders where id=$1', [order.id])).rows[0].status, 'refunded');
});

test('outbox e funções são privados, sem DELETE/TRUNCATE para servidor nem SECURITY DEFINER', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from liora_order_alerts'), /permission denied/);
    await assert.rejects(db.query("select liora_claim_order_alert('2000-01-01'::timestamptz,null)"), /permission denied/);
    await assert.rejects(db.query('select liora_finish_order_alert($1,$2,$3,null,null,null)', [randomUUID(), randomUUID(), 'failed']), /permission denied/);
    await assert.rejects(db.query('select liora_update_order_alert_delivery($1,$2,$3)', [randomUUID(), 'wamid.fixture', 'sent']), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await assert.rejects(db.query('delete from liora_order_alerts'), /permission denied/);
  await assert.rejects(db.query('truncate liora_order_alerts'), /permission denied/);
  await db.exec('reset role');
  const functions = (await db.query("select proname,prosecdef,proconfig from pg_proc where proname in ('liora_enqueue_order_alert','liora_claim_order_alert','liora_finish_order_alert','liora_update_order_alert_delivery')")).rows;
  assert.equal(functions.length, 4); assert.ok(functions.every(f => !f.prosecdef && f.proconfig.includes('search_path=""')));
  assert.equal((await db.query("select relrowsecurity from pg_class where relname='liora_order_alerts'")).rows[0].relrowsecurity, true);
});
