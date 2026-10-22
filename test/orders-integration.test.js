'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, after, beforeEach, afterEach, test } = require('node:test');
const { createHmac } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { loadApi } = require('./helpers/isolated-api.cjs');
const createCheckout = loadApi('create-preference.js');
const webhook = require('../api/payment-webhook');
const paymentStatus = require('../api/payment-status');
const { validatePayment } = require('../api/_mp-validation');
const { cpf } = require('../api/_pix');
const originalEnv = { ...process.env }, originalFetch = global.fetch;
let db, calls, payments, storageDown;
const key = '12345678-1234-4234-8234-123456789abc';
const dbOrigin = 'https://abcdefghijklmnopqrst.supabase.co';

before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  // Match the platform defaults observed in the real Supabase project.
  await db.exec('alter default privileges in schema public grant all on tables to service_role;');
  const migrations = path.join(__dirname, '../supabase/migrations');
  for (const filename of fs.readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(migrations, filename), 'utf8'));
  }
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('reset role; truncate liora_orders, liora_order_payments cascade;');
  Object.assign(process.env, { LIORA_CHECKOUT_V2: 'true', PAYMENT_MODE: 'test', VERCEL_ENV: 'development', SITE_URL: 'https://liora.example',
    CHECKOUT_SIGNING_SECRET: 'synthetic-checkout-secret-32-characters', MP_ACCESS_TOKEN: 'synthetic-token', MP_WEBHOOK_SECRET: 'synthetic-webhook-secret-32-characters',
    ORDERS_SUPABASE_URL: dbOrigin, ORDERS_SUPABASE_SECRET_KEY: 'sb_secret_synthetic_key_for_unit_tests_only' });
  for (const k of ['SUPERFRETE_TOKEN', 'SHIP_ORIGIN_CEP', 'MP_WEBHOOK_URL', 'INFINITEPAY_WEBHOOK_URL']) delete process.env[k];
  calls = []; payments = new Map(); storageDown = false;
  global.fetch = mockedFetch;
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k];
  Object.assign(process.env, originalEnv);
});
const response = body => ({ ok: true, status: 200, json: async () => body });
async function mockedFetch(url, options = {}) {
  calls.push({ url, options });
  const body = options.body ? JSON.parse(options.body) : undefined;
  if (url.startsWith(dbOrigin)) {
    if (storageDown) throw Error('offline');
    assert.equal(options.headers.apikey, process.env.ORDERS_SUPABASE_SECRET_KEY);
    assert.equal(options.headers.Authorization, undefined, 'new secret key is not a JWT');
    await db.exec('set role service_role');
    const parsed = new URL(url), id = parsed.searchParams.get('id')?.slice(3), env = parsed.searchParams.get('environment')?.slice(3);
    if (parsed.pathname.endsWith('/rpc/liora_record_payment')) {
      const { rows } = await db.query('select liora_record_payment($1,$2,$3::jsonb) as result', [body.p_order_id, body.p_environment, JSON.stringify(body.p_payment)]);
      return response(rows[0].result);
    }
    if (options.method === 'POST') {
      const cols = Object.keys(body);
      assert.ok(cols.every(c => /^[a-z_]+$/.test(c)));
      const values = cols.map(c => typeof body[c] === 'object' ? JSON.stringify(body[c]) : body[c]);
      const { rows } = await db.query(`insert into liora_orders (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) on conflict(id) do nothing returning *`, values);
      return response(rows);
    }
    if (options.method === 'PATCH') {
      const { rows } = await db.query('update liora_orders set checkout_response=$1::jsonb, checkout_state=$2, updated_at=$3 where id=$4 and environment=$5 returning *', [JSON.stringify(body.checkout_response), body.checkout_state, body.updated_at, id, env]);
      return response(rows);
    }
    return response((await db.query('select * from liora_orders where id=$1 and environment=$2', [id, env])).rows);
  }
  if (url === 'https://api.mercadopago.com/v1/payments') {
    assert.equal(options.headers['X-Idempotency-Key'], body.external_reference);
    assert.equal(body.payment_method_id, 'pix');
    const existing = [...payments.values()].find(p => p.external_reference === body.external_reference);
    if (existing) return response(existing);
    const payment = { id: 123, status: 'pending', external_reference: body.external_reference, transaction_amount: body.transaction_amount, currency_id: 'BRL',
      live_mode: process.env.PAYMENT_MODE === 'live', payment_method_id: 'pix', payment_type_id: 'bank_transfer', date_last_updated: '2026-10-21T12:00:00Z',
      date_of_expiration: '2026-10-22T12:00:00Z', point_of_interaction: { transaction_data: { qr_code: '000201-SYNTHETIC-TEST-PIX', qr_code_base64: 'aW1hZ2U=' } } };
    payments.set('123', payment);
    return response(payment);
  }
  if (url.startsWith('https://api.mercadopago.com/v1/payments/')) {
    const payment = payments.get(url.split('/').pop());
    assert.ok(payment, 'provider payment fixture must exist');
    return response(payment);
  }
  if (url === 'https://api.mercadopago.com/checkout/preferences') return response({ id: 'pref-123', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-123' });
  if (url === 'https://api.checkout.infinitepay.io/payment_check') return response({ success: true, paid: true, amount: 9490, paid_amount: 9490, installments: 1, capture_method: 'credit_card' });
  assert.fail(`Unexpected network call: ${url}`);
}
async function invoke(handler, req) {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; } };
  await handler(req, res); return res;
}
function request(overrides = {}) {
  return { method: 'POST', body: { checkoutKey: key, returnOrigin: 'https://liora.example', items: [{ id: 'botanique', qty: 1, frag: 'Lavanda' }],
    payMethod: 'pix', shipping: { method: 'delivery', serviceId: 'curitiba-fixed' },
    payer: { name: 'Pessoa Teste', email: 'fixture@example.com', cep: '80010000', num: '1', addr: 'Endereço fictício', cpf: '19119119100' }, ...overrides } };
}
function notification(id = '123') {
  const ts = '1792584000', requestId = 'synthetic-request-id';
  const hash = createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
  return { method: 'POST', query: { provider: 'mercadopago', 'data.id': id }, headers: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${hash}` }, body: { type: 'payment', data: { id } } };
}
async function row(id) { return (await db.query('select * from liora_orders where id=$1', [id])).rows[0]; }
function statusRequest(checkout) { return { method: 'GET', headers: { 'x-checkout-proof': checkout.checkout_proof }, query: { order_id: checkout.order_id, payment_id: '123' } }; }

test('Pix exclusivo registra pedido antes da cobrança, inclui frete e não guarda CPF', async () => {
  const res = await invoke(createCheckout, request());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 91.15);
  assert.ok(res.body.pix.code); assert.equal(res.body.init_point, undefined);
  const order = await row(res.body.order_id);
  assert.equal(order.status, 'pending'); assert.equal(order.total_cents, 9115);
  assert.equal(order.items[0].fragrance, 'Lavanda'); assert.equal(order.customer.email, 'fixture@example.com');
  assert.doesNotMatch(JSON.stringify(order), /19119119100|checkout_proof/);
  assert.ok(calls[0].url.startsWith(dbOrigin), 'storage must precede provider');
  assert.equal(calls.some(c => c.url.endsWith('/checkout/preferences')), false);
});
test('falha ou configuração incompleta do banco impede qualquer cobrança', async () => {
  storageDown = true;
  assert.equal((await invoke(createCheckout, request())).statusCode, 503);
  assert.ok(calls.every(c => c.url.startsWith(dbOrigin)));
  delete process.env.ORDERS_SUPABASE_SECRET_KEY; calls = [];
  assert.equal((await invoke(createCheckout, request())).body.code, 'ORDER_STORAGE_NOT_CONFIGURED');
  assert.equal(calls.length, 0);
});
test('Pix exige CPF válido e chave de repetição antes de criar cobrança', async () => {
  const req = request(); req.body.payer.cpf = '11111111111';
  assert.equal((await invoke(createCheckout, req)).body.code, 'PIX_CPF_INVALID');
  const noKey = request(); delete noKey.body.checkoutKey;
  assert.equal((await invoke(createCheckout, noKey)).body.code, 'CHECKOUT_KEY_REQUIRED');
  assert.equal(calls.length, 0);
  assert.equal(cpf('191.191.191-00'), '19119119100');
});
test('reenvio do mesmo checkout reutiliza pedido e pagamento; alteração de dados é recusada', async () => {
  const first = await invoke(createCheckout, request());
  const second = await invoke(createCheckout, request());
  assert.equal(second.body.order_id, first.body.order_id);
  assert.equal(calls.filter(c => c.url === 'https://api.mercadopago.com/v1/payments').length, 1);
  const changed = request(); changed.body.payer.num = '2';
  assert.equal((await invoke(createCheckout, changed)).body.code, 'CHECKOUT_KEY_CONFLICT');
  assert.equal((await db.query('select count(*)::int as n from liora_orders')).rows[0].n, 1);
});
test('Pix recupera cobrança com mesma idempotência após falha ao salvar a resposta', async () => {
  global.fetch = async (url, options) => {
    if (options?.method === 'PATCH') throw Error('storage failed after provider');
    return mockedFetch(url, options);
  };
  assert.equal((await invoke(createCheckout, request())).statusCode, 503);
  global.fetch = mockedFetch;
  const retry = await invoke(createCheckout, request());
  assert.equal(retry.statusCode, 200); assert.equal(payments.size, 1);
  const keys = calls.filter(c => c.url === 'https://api.mercadopago.com/v1/payments').map(c => c.options.headers['X-Idempotency-Key']);
  assert.equal(new Set(keys).size, 1);
});
test('webhook confirma sem navegador, repetições não duplicam e resultado atrasado não regride', async () => {
  const checkout = (await invoke(createCheckout, request())).body;
  payments.get('123').status = 'approved';
  for (let i = 0; i < 2; i++) assert.equal((await invoke(webhook, notification())).statusCode, 200);
  assert.equal((await row(checkout.order_id)).status, 'approved');
  assert.equal((await db.query('select count(*)::int as n from liora_order_payments')).rows[0].n, 1);
  payments.get('123').status = 'pending';
  await invoke(webhook, notification());
  assert.equal((await row(checkout.order_id)).status, 'approved');
  assert.equal((await invoke(paymentStatus, statusRequest(checkout))).body.status, 'approved');
  assert.equal((await db.query('select * from liora_paid_orders')).rows.length, 0, 'test order never enters fulfillment');
});
test('assinatura inválida ou ausente é recusada antes de consultar dados', async () => {
  for (const headers of [{}, { 'x-signature': 'ts=1,v1=invalid', 'x-request-id': 'fake' }]) {
    assert.equal((await invoke(webhook, { ...notification(), headers })).statusCode, 401);
  }
  assert.equal(calls.length, 0);
});
test('notificação com valor ou ambiente divergente nunca aprova o pedido', async () => {
  const checkout = (await invoke(createCheckout, request())).body;
  const payment = payments.get('123'); payment.status = 'approved'; payment.transaction_amount = 0.01;
  assert.equal((await invoke(webhook, notification())).statusCode, 409);
  payment.transaction_amount = 91.15; payment.live_mode = true;
  assert.equal((await invoke(webhook, notification())).statusCode, 409);
  assert.equal((await row(checkout.order_id)).status, 'pending');
});
test('saldo em conta no Pix fica em conferência, reconhecendo o recebimento sem liberar produção', async () => {
  const checkout = (await invoke(createCheckout, request())).body;
  Object.assign(payments.get('123'), { status: 'approved', payment_method_id: 'account_money', payment_type_id: 'account_money' });
  assert.equal((await invoke(webhook, notification())).statusCode, 200);
  const order = await row(checkout.order_id);
  assert.equal(order.status, 'review_required'); assert.deepEqual(order.review_reasons, ['pix_paid_with_balance']);
  assert.equal((await invoke(paymentStatus, statusRequest(checkout))).body.status, 'review_required');
});
test('duas aprovações ficam em conferência; devolução é registrada por notificação', async () => {
  const checkout = (await invoke(createCheckout, request())).body;
  payments.get('123').status = 'approved'; await invoke(webhook, notification());
  payments.set('456', { ...payments.get('123'), id: 456 });
  await invoke(webhook, notification('456'));
  assert.equal((await row(checkout.order_id)).status, 'review_required');
  assert.equal((await invoke(paymentStatus, statusRequest(checkout))).body.status, 'review_required');
  Object.assign(payments.get('123'), { status: 'refunded', date_last_updated: '2026-10-21T13:00:00Z' });
  await invoke(webhook, notification());
  assert.equal((await db.query("select status from liora_order_payments where payment_id='123'")).rows[0].status, 'refunded');
});
test('juros ou mais parcelas que o prometido exigem conferência após pagamento', () => {
  const proof = { orderId: 'LIORA-FIXTURE-12345678', totalCents: 9490, currency: 'BRL', mode: 'test', method: 'card' };
  const payment = { id: 123, external_reference: proof.orderId, transaction_amount: 94.9, currency_id: 'BRL', live_mode: false, status: 'approved',
    payment_type_id: 'credit_card', payment_method_id: 'visa', installments: 3, transaction_details: { total_paid_amount: 94.9 } };
  assert.deepEqual(validatePayment(payment, proof, '123', { interest_free_installments: 3 }).review_reasons, []);
  for (const modified of [{ ...payment, installments: 4 }, { ...payment, transaction_details: { total_paid_amount: 99.9 } }, { ...payment, transaction_details: {} }]) {
    assert.deepEqual(validatePayment(modified, proof, '123', { interest_free_installments: 3 }).review_reasons, ['installment_terms_mismatch']);
  }
});
test('cartão limita parcelas e registra a condição sem prometer juros zero não verificados', async () => {
  const checkout = (await invoke(createCheckout, request({ payMethod: 'card' }))).body;
  const preference = JSON.parse(calls.find(c => c.url.endsWith('/checkout/preferences')).options.body);
  assert.equal(preference.payment_methods.installments, 3);
  assert.equal(preference.notification_url, 'https://liora.example/api/payment-webhook?provider=mercadopago');
  assert.equal((await row(checkout.order_id)).interest_free_installments, 0);
  await invoke(createCheckout, request({ payMethod: 'card' }));
  assert.equal(calls.filter(c => c.url.endsWith('/checkout/preferences')).length, 1);
});
test('InfinitePay removida não registra pedido nem chama processadores', async () => {
  Object.assign(process.env, { PAYMENT_MODE: 'live', VERCEL_ENV: 'production' });
  const result = await invoke(createCheckout, request({ payMethod: 'infinitepay' }));
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.code, 'PAYMENT_METHOD_UNAVAILABLE');
  assert.equal(calls.length, 0);
  assert.equal((await db.query('select * from liora_orders')).rows.length, 0);
});


test('falha no registro da notificação retorna erro para permitir nova entrega', async () => {
  await invoke(createCheckout, request()); payments.get('123').status = 'approved';
  storageDown = true;
  assert.equal((await invoke(webhook, notification())).statusCode, 503);
});
test('tabelas, fila e função não são acessíveis por visitantes nem clientes autenticados', async () => {
  await invoke(createCheckout, request());
  await db.exec('reset role');
  const security = await db.query("select relname, relrowsecurity from pg_class where relname in ('liora_orders','liora_order_payments')");
  assert.ok(security.rows.every(r => r.relrowsecurity));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const sql of ['select * from liora_orders', 'select * from liora_order_payments', 'select * from liora_paid_orders', "select liora_record_payment('x','production','{}')"]) {
      await assert.rejects(db.query(sql), /permission denied/);
    }
    await db.exec('reset role');
  }
});
test('servidor não pode excluir pedidos nem escrever pela consulta administrativa', async () => {
  await invoke(createCheckout, request());
  await db.exec('set role service_role');
  for (const sql of [
    'delete from liora_order_payments',
    'delete from liora_orders',
    'truncate liora_orders, liora_order_payments',
    "update liora_paid_orders set customer = '{}'::jsonb"
  ]) await assert.rejects(db.query(sql), /permission denied/);
  assert.equal((await db.query('select count(*)::int as n from liora_orders')).rows[0].n, 1);
});
