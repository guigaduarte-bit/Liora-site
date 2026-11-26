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
beforeEach(async () => { await db.exec('reset role; truncate liora_orders, liora_order_payments, liora_coupon_customers, liora_order_alerts, liora_order_emails cascade;'); });

async function serverQuery(query, parameters) {
  await db.exec('set role service_role');
  try { return await db.query(query, parameters); }
  finally { await db.exec('reset role'); }
}
async function createOrder(environment = 'production') {
  const order = { id: `LIORA-EMAIL-${String(++sequence).padStart(12, '0')}`, environment, mode: environment === 'production' ? 'live' : 'test',
    provider: 'mercadopago', method: 'card', total_cents: 9590, subtotal_cents: 10000, discount_cents: 2400, shipping_cents: 1990,
    customer: { name: 'PRIVATE_CUSTOMER', email: 'private@example.test', address: 'PRIVATE_ADDRESS', cpf: '19119119100' },
    items: [{ name: 'Produto sintético', quantity: 2, price: 50, fragrance: 'PRIVATE_CUSTOMIZATION' }], shipping: { id: 'synthetic-fixed' }, request_hash: 'e'.repeat(64) };
  const columns = Object.keys(order), values = Object.values(order).map(v => v && typeof v === 'object' ? JSON.stringify(v) : v);
  await serverQuery(`insert into liora_orders (${columns.join(',')}) values (${values.map((_, i) => '$' + (i + 1)).join(',')})`, values);
  return order;
}
async function pay(order, status = 'approved', reasons = []) {
  const payment = { payment_id: String(sequence), status, method: 'credit_card', installments: 1, paid_cents: order.total_cents,
    review_reasons: reasons, updated_at: '2026-11-26T20:00:00Z' };
  return (await serverQuery('select liora_record_payment($1,$2,$3::jsonb) as result', [order.id, order.environment, JSON.stringify(payment)])).rows[0].result;
}
async function claim(orderId = null, activation = '2000-01-01T00:00:00Z') {
  return (await serverQuery('select liora_claim_order_email($1,$2) as result', [activation, orderId])).rows[0].result;
}
async function finish(alert, state, messageId = null, errorCode = null, retryAt = null, token = alert.claim_token) {
  return (await serverQuery('select liora_finish_order_email($1,$2,$3,$4,$5,$6) as result', [alert.id, token, state, messageId, errorCode, retryAt])).rows[0].result;
}
async function delivery(alert, status, messageId = '11111111-1111-4111-8111-111111111111', eventAt = '2026-11-26T20:00:00.123456Z') {
  return (await serverQuery('select liora_update_order_email_delivery($1,$2,$3,$4) as result', [alert.id, messageId, status, eventAt])).rows[0].result;
}
async function rows() { return (await db.query('select * from liora_order_emails order by created_at,id')).rows; }

test('email event is transactional, production paid only, deduplicated and isolated from WhatsApp', async () => {
  for (const environment of ['preview', 'development']) { const order = await createOrder(environment); await pay(order); }
  const pending = await createOrder(); await pay(pending, 'pending');
  const review = await createOrder(); await pay(review, 'approved', ['installment_terms_mismatch']);
  const manual = await createOrder(); await db.query("update liora_orders set status='approved' where id=$1", [manual.id]);
  assert.equal((await rows()).length, 0);
  const order = await createOrder(); await pay(order); await pay(order);
  const emails = await rows(), whatsapp = (await db.query('select id,status from liora_order_alerts')).rows;
  assert.equal(emails.length, 1); assert.equal(emails[0].order_id, order.id); assert.equal(emails[0].status, 'queued');
  assert.equal(whatsapp.length, 1); assert.notEqual(emails[0].id, whatsapp[0].id);
  const claimed = await claim(order.id); await delivery(claimed, 'delivered');
  assert.equal((await db.query('select status from liora_order_alerts')).rows[0].status, 'queued');
  assert.equal((await delivery({ id: whatsapp[0].id }, 'delivered')).updated, false);
});

test('claim obeys activation and lease ownership, returns no customer data, and ACK needs matching token', async () => {
  const order = await createOrder(); await pay(order);
  assert.equal(await claim(order.id, '2999-01-01T00:00:00Z'), null);
  await assert.rejects(claim(order.id, null), /Activation timestamp/);
  const alert = await claim(order.id);
  assert.equal(alert.total_cents, 9590); assert.equal(alert.attempts, 1);
  assert.deepEqual(alert.items, [{ name: 'Produto sintético', quantity: 2 }]);
  assert.doesNotMatch(JSON.stringify(alert), /PRIVATE_|private@example|19119119100|customer|shipping|recipient/);
  assert.equal(await claim(order.id), null);
  assert.equal((await finish(alert, 'accepted', randomUUID(), null, null, randomUUID())).updated, false);
  assert.deepEqual(await finish(alert, 'accepted', randomUUID()), { updated: true, status: 'accepted' });
  assert.equal((await finish(alert, 'failed', null, 'LATE_WORKER')).updated, false);
});

test('lost send ACK is quarantined and signed email delivery resolves it without changing payment', async () => {
  const order = await createOrder(); await pay(order);
  const alert = await claim(order.id);
  assert.deepEqual(await finish(alert, 'unknown', null, 'EMAIL_ACK_UNKNOWN'), { updated: true, status: 'unknown' });
  assert.equal(await claim(order.id), null);
  assert.equal((await db.query('select status from liora_orders where id=$1', [order.id])).rows[0].status, 'approved');
  assert.deepEqual(await delivery(alert, 'delivered'), { updated: true, status: 'delivered' });
  assert.equal(await claim(order.id), null);
});

test('expired send lease never sends again and late authenticated callback can still resolve delivery', async () => {
  const order = await createOrder(); await pay(order);
  const alert = await claim(order.id);
  await db.query("update liora_order_emails set claimed_at=now()-interval '6 minutes' where id=$1", [alert.id]);
  assert.equal(await claim(order.id), null);
  assert.equal((await rows())[0].status, 'unknown'); assert.equal((await rows())[0].last_error_code, 'SEND_LEASE_EXPIRED');
  assert.equal((await finish(alert, 'accepted', randomUUID())).updated, false);
  assert.equal((await delivery(alert, 'delivered')).status, 'delivered');
});

test('callback before claim or with wrong email ID is ignored, and callback winning ACK remains authoritative', async () => {
  const order = await createOrder(); await pay(order);
  assert.equal((await delivery((await rows())[0], 'delivered')).updated, false);
  const alert = await claim(order.id), emailId = randomUUID();
  assert.deepEqual(await delivery(alert, 'delivered', emailId), { updated: true, status: 'delivered' });
  assert.equal((await finish(alert, 'accepted', emailId)).updated, false);
  assert.equal((await delivery(alert, 'failed', randomUUID())).updated, false);
  assert.equal((await delivery(alert, 'sent', emailId, '2026-11-26T20:00:01Z')).updated, false);
  assert.equal((await delivery(alert, 'delivered', emailId)).updated, false);
});

test('provider timestamps reject stale failure, preserve precise ordering, and complaint is terminal', async () => {
  const order = await createOrder(); await pay(order);
  const alert = await claim(order.id), emailId = randomUUID();
  await delivery(alert, 'delivered', emailId, '2026-11-26T20:00:00.123457Z');
  assert.equal((await delivery(alert, 'failed', emailId, '2026-11-26T20:00:00.123456Z')).updated, false);
  assert.equal((await delivery(alert, 'complained', emailId, '2026-11-26T20:05:00Z')).status, 'failed');
  const row = (await rows())[0];
  assert.equal(row.last_error_code, 'PROVIDER_COMPLAINED'); assert.ok(row.delivered_at);
  assert.equal((await delivery(alert, 'delivered', emailId, '2026-11-26T20:06:00Z')).updated, false);
  assert.equal(await claim(order.id), null);
});

test('same-timestamp events converge to hard failure regardless of HTTP arrival order', async () => {
  for (const statuses of [['bounced', 'delivered'], ['delivered', 'bounced'], ['sent', 'delivered', 'failed'], ['failed', 'delivered', 'sent']]) {
    const order = await createOrder(); await pay(order);
    const alert = await claim(order.id), emailId = randomUUID();
    for (const status of statuses) await delivery(alert, status, emailId, '2026-11-26T20:00:00.123456Z');
    const row = (await db.query('select status,last_delivery_status from liora_order_emails where id=$1', [alert.id])).rows[0];
    assert.equal(row.status, 'failed');
    assert.equal(row.last_delivery_status, statuses.includes('bounced') ? 'bounced' : 'failed');
  }
});

test('definite refusals alone may retry, respecting availability and five-attempt limit', async () => {
  const order = await createOrder(); await pay(order);
  let alert = await claim(order.id);
  await assert.rejects(finish(alert, 'queued', null, 'EMAIL_RATE_LIMITED', '2000-01-01T00:00:00Z'), /future retry/);
  await assert.rejects(finish(alert, 'queued', randomUUID(), 'EMAIL_RATE_LIMITED', '2999-01-01T00:00:00Z'), /pre-acceptance/);
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await finish(alert, 'queued', null, 'EMAIL_RATE_LIMITED', '2999-01-01T00:00:00Z');
    assert.equal(result.status, attempt < 5 ? 'queued' : 'failed');
    if (attempt === 5) break;
    assert.equal(await claim(order.id), null);
    await db.query("update liora_order_emails set available_at=now()-interval '1 second' where id=$1", [alert.id]);
    alert = await claim(order.id); assert.equal(alert.attempts, attempt + 1);
  }
  assert.equal(await claim(order.id), null); assert.equal((await rows())[0].last_error_code, 'ATTEMPT_LIMIT_REACHED');
});

test('refunded orders cannot emit delayed sale emails, even if order status was manually changed back', async () => {
  const order = await createOrder(); await pay(order); await pay(order, 'refunded');
  await db.query("update liora_orders set status='approved' where id=$1", [order.id]);
  assert.equal(await claim(order.id), null);
  assert.equal((await rows())[0].status, 'failed'); assert.equal((await rows())[0].last_error_code, 'ORDER_NOT_APPROVED');
});

test('email table and RPCs are private, without server DELETE/TRUNCATE or SECURITY DEFINER', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from liora_order_emails'), /permission denied/);
    await assert.rejects(db.query("select liora_claim_order_email('2000-01-01'::timestamptz,null)"), /permission denied/);
    await assert.rejects(db.query('select liora_finish_order_email($1,$2,$3,null,null,null)', [randomUUID(), randomUUID(), 'failed']), /permission denied/);
    await assert.rejects(db.query('select liora_update_order_email_delivery($1,$2,$3,$4)', [randomUUID(), randomUUID(), 'sent', '2026-11-26T20:00:00Z']), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  await assert.rejects(db.query('delete from liora_order_emails'), /permission denied/);
  await assert.rejects(db.query('truncate liora_order_emails'), /permission denied/);
  await db.exec('reset role');
  const functions = (await db.query("select proname,prosecdef,proconfig from pg_proc where proname in ('liora_enqueue_order_email','liora_claim_order_email','liora_finish_order_email','liora_update_order_email_delivery')")).rows;
  assert.equal(functions.length, 4); assert.ok(functions.every(f => !f.prosecdef && f.proconfig.includes('search_path=""')));
  assert.equal((await db.query("select relrowsecurity from pg_class where relname='liora_order_emails'")).rows[0].relrowsecurity, true);
  const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='liora_order_emails'")).rows;
  assert.equal(columns.some(c => /recipient|customer|cpf|address/.test(c.column_name)), false);
});
