'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { createHmac } = require('node:crypto');
const { loadApi } = require('./helpers/isolated-api.cjs');
const { configuration, siteOrigin, signProof, verifyProof, PAYMENT_TIMEOUT_MS } = require('../api/_payment');
const createPreference = loadApi('create-preference.js');
const paymentStatus = require('../api/payment-status');
const infinitePayStatus = require('../api/infinitepay-status');
const initialEnv = { ...process.env };
const initialFetch = global.fetch;
const initialWarn = console.warn;
const initialTimeout = global.setTimeout;
const orderId = 'LIORA-SECURITY-12345678';
const secret = 'synthetic-checkout-signing-key-for-tests-only';
let calls;

beforeEach(() => {
  for (const key of ['VERCEL_ENV', 'SITE_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'MP_WEBHOOK_URL', 'INFINITEPAY_WEBHOOK_URL', 'SUPERFRETE_TOKEN', 'SHIP_ORIGIN_CEP']) delete process.env[key];
  Object.assign(process.env, { PAYMENT_MODE: 'test', CHECKOUT_SIGNING_SECRET: secret, MP_ACCESS_TOKEN: 'APP_USR-synthetic-test-credential', SITE_URL: 'https://liora.example' });
  calls = 0;
  global.fetch = async () => { calls++; assert.fail('No external request permitted'); };
});
afterEach(() => {
  global.fetch = initialFetch;
  console.warn = initialWarn;
  global.setTimeout = initialTimeout;
  for (const key of Object.keys(process.env)) if (!(key in initialEnv)) delete process.env[key];
  Object.assign(process.env, initialEnv);
});

async function invoke(handler, req) {
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; } };
  await handler(req, res);
  return res;
}
function proof(provider = 'mercadopago', overrides = {}, now) {
  return signProof({ orderId, totalCents: 9490, method: provider === 'infinitepay' ? 'infinitepay' : 'card', provider, ...overrides }, configuration(provider), now);
}
function statusRequest(provider = 'mercadopago', token = proof(provider)) {
  return { method: 'GET', headers: { 'x-checkout-proof': token }, query: { order_id: orderId, payment_id: '123', transaction_nsu: 'transaction-123', slug: 'invoice-123' } };
}
function mpPayment(overrides = {}) {
  return { id: 123, external_reference: orderId, status: 'approved', transaction_amount: 94.9, currency_id: 'BRL', live_mode: false, payment_type_id: 'credit_card', payment_method_id: 'visa', ...overrides };
}
function mockResponse(body, options = {}) {
  global.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => body, ...options }; };
}
function request(overrides = {}) {
  return { method: 'POST', body: { items: [{ id: 'botanique', qty: 1 }], payMethod: 'card', shipping: { method: 'delivery', serviceId: 'curitiba-fixed' }, payer: { name: 'Cliente Sintético', email: 'test@example.com', cep: '80000000', addr: 'Rua Fictícia', num: '1' }, ...overrides } };
}
function infiniteLive() {
  Object.assign(process.env, { PAYMENT_MODE: 'live', VERCEL_ENV: 'production', INFINITEPAY_HANDLE: 'synthetic-handle' });
}

test('missing payment mode, signing key or provider credential fails closed with 503', async () => {
  for (const key of ['PAYMENT_MODE', 'CHECKOUT_SIGNING_SECRET', 'MP_ACCESS_TOKEN']) {
    const value = process.env[key];
    delete process.env[key];
    const res = await invoke(createPreference, request());
    assert.equal(res.statusCode, 503);
    assert.match(res.body.code, /NOT_CONFIGURED/);
    process.env[key] = value;
  }
  process.env.CHECKOUT_SIGNING_SECRET = 'too-short';
  assert.equal((await invoke(createPreference, request())).statusCode, 503);
  assert.equal(calls, 0);
});

test('Preview cannot use live mode or InfinitePay and Production cannot use test mode', async () => {
  process.env.VERCEL_ENV = 'preview';
  process.env.PAYMENT_MODE = 'live';
  assert.equal((await invoke(createPreference, request())).body.code, 'PAYMENT_ENVIRONMENT_MISMATCH');
  process.env.PAYMENT_MODE = 'test';
  process.env.INFINITEPAY_HANDLE = 'synthetic-handle';
  assert.equal((await invoke(createPreference, request({ payMethod: 'infinitepay' }))).body.code, 'INFINITEPAY_PREVIEW_UNAVAILABLE');
  assert.equal((await invoke(infinitePayStatus, { method: 'GET' })).body.code, 'INFINITEPAY_PREVIEW_UNAVAILABLE');
  process.env.VERCEL_ENV = 'production';
  assert.equal((await invoke(createPreference, request())).body.code, 'PAYMENT_ENVIRONMENT_MISMATCH');
  assert.equal(calls, 0);
});

test('Preview uses only a trusted exact return origin and has no production fallback', async () => {
  Object.assign(process.env, { VERCEL_ENV: 'preview', SITE_URL: 'https://production.example', VERCEL_PROJECT_PRODUCTION_URL: 'production.example', VERCEL_URL: 'unique-preview.example', VERCEL_BRANCH_URL: 'branch-preview.example' });
  assert.throws(() => siteOrigin(configuration('mercadopago')), { code: 'PAYMENT_RETURN_URL_MISMATCH' });
  process.env.SITE_URL = 'https://branch-preview.example';
  assert.equal(siteOrigin(configuration('mercadopago')), 'https://branch-preview.example');
  const mismatch = await invoke(createPreference, request({ returnOrigin: 'https://unique-preview.example' }));
  assert.equal(mismatch.body.code, 'CHECKOUT_ORIGIN_MISMATCH');
  delete process.env.SITE_URL; delete process.env.VERCEL_URL; delete process.env.VERCEL_BRANCH_URL;
  assert.throws(() => siteOrigin(configuration('mercadopago')), { code: 'PAYMENT_RETURN_URL_NOT_CONFIGURED' });
  assert.equal(calls, 0);
});

test('issued proof contains only signed purchase facts, and return URL contains no proof or customer data', async () => {
  let sent;
  global.fetch = async (url, options) => { calls++; sent = JSON.parse(options.body); return { ok: true, status: 201, json: async () => ({ id: 'pref-123', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-123' }) }; };
  const res = await invoke(createPreference, request({ returnOrigin: 'https://liora.example' }));
  assert.equal(res.statusCode, 200);
  const payload = verifyProof({ headers: { 'x-checkout-proof': res.body.checkout_proof } }, 'mercadopago', configuration('mercadopago'));
  assert.equal(payload.totalCents, 9490);
  assert.equal(payload.exp - payload.iat, 7 * 86400);
  assert.deepEqual(Object.keys(payload).sort(), ['currency', 'environment', 'exp', 'iat', 'method', 'mode', 'orderId', 'provider', 'totalCents', 'v'].sort());
  assert.doesNotMatch(JSON.stringify(payload), /Fictícia|Cliente|test@example|80000000/);
  assert.doesNotMatch(sent.back_urls.success, /proof|test@example|Fict/);
  assert.equal(sent.metadata.customer_address, undefined);
});

test('missing, expired, modified or cross-provider proof never contacts payment provider', async () => {
  const valid = proof();
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(valid.split('.')[0], 'base64url')), totalCents: 1 })).toString('base64url') + '.' + valid.split('.')[1];
  for (const token of ['', 'nonsense', changed, proof('mercadopago', {}, Date.now() - 8 * 86400000), proof('mercadopago', { provider: 'infinitepay', method: 'infinitepay' })]) {
    const res = await invoke(paymentStatus, statusRequest('mercadopago', token));
    assert.equal(res.statusCode, 400);
  }
  const wrongOrder = statusRequest(); wrongOrder.query.order_id = 'LIORA-OTHER-12345678';
  assert.equal((await invoke(paymentStatus, wrongOrder)).statusCode, 400);
  const oversized = statusRequest('mercadopago', 'a'.repeat(2050));
  assert.equal((await invoke(paymentStatus, oversized)).statusCode, 400);
  assert.equal(calls, 0);
});

test('a correctly signed proof with inconsistent scope or invalid schema is rejected', () => {
  const base = JSON.parse(Buffer.from(proof().split('.')[0], 'base64url'));
  for (const overrides of [{ environment: 'production' }, { mode: 'live' }, { currency: 'USD' }, { totalCents: -1 }, { method: 'infinitepay' }, { exp: base.exp + 1 }, { iat: base.iat + 3600, exp: base.exp + 3600 }]) {
    const encoded = Buffer.from(JSON.stringify({ ...base, ...overrides })).toString('base64url');
    const token = encoded + '.' + createHmac('sha256', secret).update(encoded).digest('base64url');
    assert.throws(() => verifyProof({ headers: { 'x-checkout-proof': token } }, 'mercadopago', configuration('mercadopago')), { code: 'CHECKOUT_PROOF_INVALID' });
  }
});

test('Mercado Pago confirmation checks reference, payment ID, exact cents, BRL, environment and method', async () => {
  for (const invalid of [{ external_reference: 'LIORA-OTHER-12345678' }, { id: 456 }, { transaction_amount: 94.89 }, { currency_id: 'USD' }, { live_mode: true }, { payment_type_id: 'account_money' }]) {
    mockResponse(mpPayment(invalid));
    assert.equal((await invoke(paymentStatus, statusRequest())).statusCode, 409);
  }
  mockResponse(mpPayment({ payment_type_id: 'bank_transfer', payment_method_id: 'other' }));
  assert.equal((await invoke(paymentStatus, statusRequest('mercadopago', proof('mercadopago', { method: 'pix' })))).body.code, 'PAYMENT_METHOD_MISMATCH');
});

test('Mercado Pago rejects malformed responses and returns legitimate pending/rejected/approved status only', async () => {
  for (const invalid of [{ status: 'unknown' }, { live_mode: 'false' }, { transaction_amount: '94.90' }, { transaction_amount: NaN }, { transaction_amount: 94.901 }]) {
    mockResponse(mpPayment(invalid));
    assert.equal((await invoke(paymentStatus, statusRequest())).statusCode, 502);
  }
  for (const status of ['pending', 'rejected', 'approved', 'refunded']) {
    mockResponse(mpPayment({ status }));
    const res = await invoke(paymentStatus, statusRequest());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, status);
    assert.equal(res.body.payment_mode, 'test');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});

test('InfinitePay requires strict booleans, integer cents and adequate paid amount before approval', async () => {
  infiniteLive();
  const valid = { success: true, paid: true, amount: 9490, paid_amount: 9490, installments: 1, capture_method: 'pix' };
  for (const invalid of [{ success: undefined }, { success: 'true' }, { paid: 'false' }, { amount: '9490' }, { paid_amount: 9489 }, { capture_method: 'unknown' }]) {
    mockResponse({ ...valid, ...invalid });
    assert.equal((await invoke(infinitePayStatus, statusRequest('infinitepay'))).statusCode, 502);
  }
  mockResponse({ ...valid, amount: 9489 });
  assert.equal((await invoke(infinitePayStatus, statusRequest('infinitepay'))).statusCode, 409);
  mockResponse(valid);
  assert.equal((await invoke(infinitePayStatus, statusRequest('infinitepay'))).body.status, 'approved');
  mockResponse({ success: true, paid: false, amount: 9490 });
  assert.equal((await invoke(infinitePayStatus, statusRequest('infinitepay'))).body.status, 'pending');
});

test('checkout rejects HTTP, credential-bearing and lookalike provider URLs', async () => {
  for (const url of ['http://www.mercadopago.com.br/x', 'https://www.mercadopago.com.br.evil.example/x', 'https://secret@www.mercadopago.com.br/x', 'javascript:alert(1)']) {
    mockResponse({ id: 'pref-123', init_point: url });
    assert.equal((await invoke(createPreference, request())).statusCode, 502);
  }
  infiniteLive();
  mockResponse({ url: 'http://checkout.infinitepay.com.br/x' });
  assert.equal((await invoke(createPreference, request({ payMethod: 'infinitepay' }))).statusCode, 502);
});

test('provider errors and timeouts log no credential, proof, provider body or personal data', async () => {
  const logs = [];
  console.warn = value => logs.push(value);
  mockResponse({ message: 'private@example.com Rua Fictícia APP_USR-secret' }, { ok: false, status: 401 });
  assert.equal((await invoke(paymentStatus, statusRequest())).statusCode, 502);
  global.fetch = async () => { throw new Error('private@example.com APP_USR-secret'); };
  assert.equal((await invoke(paymentStatus, statusRequest())).statusCode, 502);
  let signal;
  global.fetch = async (url, options) => { signal = options.signal; return new Promise(() => {}); };
  global.setTimeout = (fn, ms) => { assert.equal(ms, PAYMENT_TIMEOUT_MS); return initialTimeout(fn, 1); };
  const res = await invoke(paymentStatus, statusRequest());
  assert.equal(res.statusCode, 504);
  assert.equal(signal.aborted, true);
  assert.doesNotMatch(logs.join('\n'), /private|Fictícia|APP_USR|eyJ|secret/);
});
