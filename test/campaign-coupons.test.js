'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const { randomUUID, randomBytes } = require('node:crypto');
const orders = require('../api/_orders');
const { validateCoupon } = require('../api/_coupons');
const { validateCart } = require('../api/_cart');
const { configuration, verifyProof } = require('../api/_payment');
const createCheckout = require('../api/create-preference');
const validateEndpoint = require('../api/validate-coupon');
const paymentStatus = require('../api/payment-status');
const infinitePayStatus = require('../api/infinitepay-status');
const couponPolicy = require('../content/coupon-policy.json');

const originalEnv = { ...process.env }, originalFetch = global.fetch;
const activeTime = Date.parse('2026-11-28T12:00:00-03:00');
let calls, providerPayment, infinitePayment;

beforeEach(() => {
  for (const name of ['ORDERS_SUPABASE_URL', 'ORDERS_SUPABASE_SECRET_KEY', 'MP_WEBHOOK_SECRET',
    'COUPON_CPF_HASH_SECRET', 'MP_WEBHOOK_URL', 'INFINITEPAY_WEBHOOK_URL', 'SUPERFRETE_TOKEN', 'SHIP_ORIGIN_CEP']) {
    delete process.env[name];
  }
  Object.assign(process.env, {
    LIORA_CAMPAIGN_COUPONS_ENABLED: 'true', LIORA_COUPONS_ENABLED: 'false', LIORA_CHECKOUT_V2: 'false',
    LIORA_ORDER_TRACKING_ENABLED: 'false', WHATSAPP_ENABLED: 'false',
    VERCEL_ENV: 'production', PAYMENT_MODE: 'live', SITE_URL: 'https://liora.example',
    CHECKOUT_SIGNING_SECRET: 'synthetic-campaign-signing-secret-for-tests',
    MP_ACCESS_TOKEN: 'synthetic-campaign-access-token', INFINITEPAY_HANDLE: 'synthetic-campaign-handle'
  });
  calls = []; providerPayment = null; infinitePayment = null;
  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    const response = body => ({ ok: true, status: 200, json: async () => body });
    if (url === 'https://api.mercadopago.com/checkout/preferences') {
      return response({ id: 'synthetic-preference', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=synthetic', live_mode: true });
    }
    if (url === 'https://api.checkout.infinitepay.io/links') {
      return response({ url: 'https://checkout.infinitepay.io/synthetic-campaign' });
    }
    if (url === 'https://api.mercadopago.com/v1/payments/123' && providerPayment) return response(providerPayment);
    if (url === 'https://api.checkout.infinitepay.io/payment_check' && infinitePayment) return response(infinitePayment);
    assert.fail('Campaign-only checkout must not call storage or an unexpected provider endpoint');
  };
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
  Object.assign(process.env, originalEnv);
});

async function invoke(handler, body) {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method: 'POST', body }, res);
  return res;
}

async function confirm(handler, created, extraQuery = {}) {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method: 'GET', headers: { 'x-checkout-proof': created.checkout_proof },
    query: { order_id: created.order_id, ...extraQuery } }, res);
  return res;
}

function request(overrides = {}) {
  return { returnOrigin: 'https://liora.example', couponCode: 'BF20', payMethod: 'card',
    items: [{ id: 'botanique', qty: 1, frag: 'Lavanda', price: 0.01 }],
    shipping: { method: 'delivery', serviceId: 'curitiba-fixed', price: 0 },
    payer: { name: 'Pessoa Sintética', email: 'fixture@example.com', cep: '80010000', addr: 'Endereço sintético', num: '1' },
    ...overrides };
}

function mpPayment(created, method = 'card') {
  return { id: 123, status: 'approved', external_reference: created.order_id,
    transaction_amount: method === 'pix' ? 57 : 60, shipping_amount: 19.9,
    currency_id: 'BRL', live_mode: true,
    payment_method_id: { pix: 'pix', card: 'visa', boleto: 'bolbradesco' }[method],
    payment_type_id: { pix: 'bank_transfer', card: 'credit_card', boleto: 'ticket' }[method] };
}

test('campaign flag grants only BF20 and never bypasses first-purchase authorization', async t => {
  t.mock.method(Date, 'now', () => activeTime);
  assert.equal(orders.campaignCouponsEnabled(), true);
  assert.equal(orders.couponsEnabled(), false);
  assert.equal(orders.trackingEnabled(), false);
  assert.equal(orders.enabled(), false);

  const quote = await invoke(validateEndpoint, { items: request().items, payMethod: 'card', couponCode: ' bf20 ' });
  assert.equal(quote.statusCode, 200);
  assert.equal(quote.body.couponDiscountCents, 1500);
  for (const handler of [validateEndpoint, createCheckout]) {
    const rejected = await invoke(handler, request({ couponCode: 'PRIMEIRACOMPRA' }));
    assert.equal(rejected.statusCode, 503);
    assert.equal(rejected.body.code, 'COUPONS_UNAVAILABLE');
    assert.doesNotMatch(rejected.body.error, /CPF/);
  }
  await assert.rejects(validateCoupon({ code: 'PRIMEIRACOMPRA', cart: validateCart(request().items),
    paymentMethod: 'card', environment: 'production', checkEligibility: false }), { code: 'COUPONS_UNAVAILABLE' });

  // A later policy edit cannot accidentally grant a first-purchase definition
  // or an unrelated new campaign through the BF20-only authorization.
  const bf = couponPolicy.coupons.find(coupon => coupon.code === 'BF20');
  const previousFirstPurchaseOnly = bf.firstPurchaseOnly;
  try {
    bf.firstPurchaseOnly = true;
    assert.equal((await invoke(validateEndpoint, request())).body.code, 'COUPONS_UNAVAILABLE');
  } finally { bf.firstPurchaseOnly = previousFirstPurchaseOnly; }
  couponPolicy.coupons.push({ code: 'SYNTHETICFUTURE', percent: 20, firstPurchaseOnly: false });
  try {
    assert.equal((await invoke(createCheckout, request({ couponCode: 'SYNTHETICFUTURE' }))).body.code, 'COUPONS_UNAVAILABLE');
  } finally { couponPolicy.coupons.pop(); }
  for (const handler of [validateEndpoint, createCheckout]) {
    assert.equal((await invoke(handler, request({ coupons: ['BF20', 'PRIMEIRACOMPRA'] }))).body.code, 'COUPON_ONE_AT_A_TIME');
    assert.equal((await invoke(handler, request({ couponCode: 'BF20+PRIMEIRACOMPRA' }))).body.code, 'COUPON_ONE_AT_A_TIME');
  }
  process.env.LIORA_CAMPAIGN_COUPONS_ENABLED = 'false';
  assert.equal((await invoke(validateEndpoint, request())).body.code, 'COUPONS_UNAVAILABLE');
  assert.equal((await invoke(createCheckout, request())).body.code, 'COUPONS_UNAVAILABLE');
  assert.equal(calls.length, 0);
});

test('legacy BF20 charges exact provider totals without CPF, storage, webhook secret or checkout key', async t => {
  t.mock.method(Date, 'now', () => activeTime);
  for (const method of ['pix', 'card', 'boleto', 'infinitepay']) {
    const req = request({ payMethod: method });
    assert.equal(req.payer.cpf, undefined);
    assert.equal(req.checkoutKey, undefined);
    const before = calls.length;
    const created = await invoke(createCheckout, req);
    assert.equal(created.statusCode, 200);
    const expectedProducts = method === 'pix' ? 5700 : 6000;
    const expectedTotal = expectedProducts + 1990;
    assert.equal(Math.round(created.body.total * 100), expectedTotal);
    assert.equal(calls.length, before + 1);
    const sent = calls.at(-1), provider = method === 'infinitepay' ? 'infinitepay' : 'mercadopago';
    const proof = verifyProof({ headers: { 'x-checkout-proof': created.body.checkout_proof } }, provider, configuration(provider));
    assert.equal(proof.totalCents, expectedTotal);
    assert.equal(proof.registered, undefined);
    assert.equal(proof.method, method);
    assert.doesNotMatch(JSON.stringify(sent.body), /"cpf"|"identification"/);
    if (provider === 'mercadopago') {
      assert.equal(sent.url, 'https://api.mercadopago.com/checkout/preferences');
      assert.equal(sent.body.items.reduce((sum, item) => sum + Math.round(item.unit_price * 100) * item.quantity, 0), expectedProducts);
      assert.equal(sent.body.shipments.cost, 19.9);
      assert.equal(sent.body.notification_url, undefined);
      assert.equal(sent.body.metadata.coupon_code, 'BF20');
      assert.equal(sent.body.metadata.coupon_discount, 15);
      assert.equal(sent.body.metadata.payment_discount, method === 'pix' ? 3 : 0);
    } else {
      assert.equal(sent.url, 'https://api.checkout.infinitepay.io/links');
      assert.equal(sent.body.items.reduce((sum, item) => sum + item.price * item.quantity, 0), expectedTotal);
      assert.equal(sent.body.items.at(-1).price, 1990);
      assert.equal(sent.body.webhook_url, undefined);
    }
  }
  const free = await invoke(createCheckout, request({ payMethod: 'pix', items: [{ id: 'botanique', qty: 2 }] }));
  assert.equal(free.statusCode, 200);
  assert.equal(free.body.total, 114);
  assert.equal(calls.at(-1).body.shipments.cost, 0, 'original subtotal still qualifies for free shipping');
  for (const method of ['pix', 'card']) {
    const ordinary = await invoke(createCheckout, request({ payMethod: method, couponCode: undefined }));
    assert.equal(ordinary.statusCode, 200);
    assert.equal(ordinary.body.total, method === 'pix' ? 91.15 : 94.9);
  }
});

test('legacy BF20 payment confirmation checks the signed discounted total without storage', async t => {
  t.mock.method(Date, 'now', () => activeTime);
  const created = await invoke(createCheckout, request({ payMethod: 'pix' }));
  assert.equal(created.statusCode, 200);
  providerPayment = mpPayment(created.body, 'pix');
  const confirmed = await confirm(paymentStatus, created.body, { payment_id: '123' });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.status, 'approved');

  providerPayment = { ...providerPayment, transaction_amount: 60 };
  const mismatch = await confirm(paymentStatus, created.body, { payment_id: '123' });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.body.code, 'PAYMENT_ORDER_MISMATCH');
  const [encoded, signature] = created.body.checkout_proof.split('.');
  const forged = { ...JSON.parse(Buffer.from(encoded, 'base64url')), totalCents: 7990 };
  const before = calls.length;
  const invalid = await confirm(paymentStatus, { ...created.body,
    checkout_proof: `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}` }, { payment_id: '123' });
  assert.equal(invalid.body.code, 'CHECKOUT_PROOF_INVALID');
  assert.equal(calls.length, before);

  const infinite = await invoke(createCheckout, request({ payMethod: 'infinitepay' }));
  assert.equal(infinite.statusCode, 200);
  infinitePayment = { success: true, paid: true, amount: 7990, paid_amount: 7990, installments: 1, capture_method: 'credit_card' };
  assert.equal((await confirm(infinitePayStatus, infinite.body, { transaction_nsu: 'synthetic-nsu', slug: 'synthetic-slug' })).body.status, 'approved');
  infinitePayment.amount = 9490;
  assert.equal((await confirm(infinitePayStatus, infinite.body, { transaction_nsu: 'synthetic-nsu', slug: 'synthetic-slug' })).body.code, 'PAYMENT_ORDER_MISMATCH');
  assert.ok(calls.every(call => !call.url.includes('supabase')));
});

test('server campaign dates reject new expired orders but confirm an existing BF20 payment after closing', async t => {
  const start = Date.parse('2026-11-27T03:00:00Z'), end = Date.parse('2026-11-30T03:00:00Z');
  let clock = start - 1, lastCreated;
  t.mock.method(Date, 'now', () => clock);
  for (const [time, error] of [[start - 1, 'COUPON_NOT_STARTED'], [start, null], [end - 1, null], [end, 'COUPON_EXPIRED']]) {
    clock = time;
    const before = calls.length;
    // Client dates and discounts do not affect server authorization or pricing.
    const req = request({ now: '2026-11-28T12:00:00-03:00', discount: 100, couponPercent: 100 });
    const quote = await invoke(validateEndpoint, req);
    const checkout = await invoke(createCheckout, req);
    if (error) {
      assert.equal(quote.body.code, error);
      assert.equal(checkout.body.code, error);
      assert.equal(calls.length, before);
    } else {
      assert.equal(quote.statusCode, 200);
      assert.equal(quote.body.couponDiscountCents, 1500);
      assert.equal(checkout.statusCode, 200);
      assert.equal(checkout.body.total, 79.9);
      lastCreated = checkout.body;
    }
  }
  clock = end - 1;
  assert.equal((await invoke(validateEndpoint, request())).statusCode, 200);
  clock = end;
  const before = calls.length;
  assert.equal((await invoke(createCheckout, request())).body.code, 'COUPON_EXPIRED');
  assert.equal(calls.length, before, 'a quote does not reserve an expired discount');

  clock = end + 60 * 60 * 1000;
  providerPayment = mpPayment(lastCreated);
  const confirmed = await confirm(paymentStatus, lastCreated, { payment_id: '123' });
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.status, 'approved');
  assert.equal(calls.length, before + 1, 'only the provider is queried after the campaign');
  assert.equal(calls.at(-1).url, 'https://api.mercadopago.com/v1/payments/123');
});

test('campaign flag preserves webhook, CPF and history guards whenever durable controls are enabled', async t => {
  t.mock.method(Date, 'now', () => activeTime);
  Object.assign(process.env, { ORDERS_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    ORDERS_SUPABASE_SECRET_KEY: 'sb_secret_' + randomBytes(24).toString('base64url') });
  for (const flag of ['LIORA_ORDER_TRACKING_ENABLED', 'LIORA_CHECKOUT_V2', 'LIORA_COUPONS_ENABLED']) {
    process.env[flag] = 'true';
    assert.equal(orders.trackingEnabled(), true);
    const result = await invoke(createCheckout, request());
    assert.equal(result.statusCode, 503);
    assert.equal(result.body.code, 'PAYMENT_WEBHOOK_NOT_CONFIGURED');
    process.env[flag] = 'false';
  }
  process.env.LIORA_COUPONS_ENABLED = 'true';
  process.env.MP_WEBHOOK_SECRET = 'synthetic-campaign-webhook-secret-for-tests';
  assert.equal((await invoke(createCheckout, request())).body.code, 'CHECKOUT_CPF_INVALID');
  const fullRequest = request({ checkoutKey: randomUUID(), payer: { ...request().payer, cpf: '19119119100' } });
  assert.equal((await invoke(createCheckout, fullRequest)).body.code, 'COUPON_IDENTITY_NOT_CONFIGURED');
  process.env.COUPON_CPF_HASH_SECRET = 'synthetic-campaign-cpf-secret-for-tests';
  t.mock.method(orders, 'getOrder', async () => null);
  t.mock.method(orders, 'couponEligibility', async () => ({ eligible: false, code: 'COUPON_HISTORY_UNAVAILABLE' }));
  t.mock.method(orders, 'register', async () => orders.couponFailure('COUPON_HISTORY_UNAVAILABLE'));
  fullRequest.couponCode = 'PRIMEIRACOMPRA';
  assert.equal((await invoke(validateEndpoint, fullRequest)).body.code, 'COUPON_HISTORY_UNAVAILABLE');
  assert.equal((await invoke(createCheckout, fullRequest)).body.code, 'COUPON_HISTORY_UNAVAILABLE');
  assert.equal(calls.length, 0);
});
