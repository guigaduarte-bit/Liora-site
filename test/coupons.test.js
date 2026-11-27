'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { resolveCoupon, normalizeCode, cpfHash, priceProducts, allocateProductCents } = require('../api/_coupons');
const { validateCart } = require('../api/_cart');
const orders = require('../api/_orders');
const createCheckout = require('../api/create-preference');
const validateEndpoint = require('../api/validate-coupon');
const { createInfinitePay } = require('../api/_infinitepay');
const { attachQuoteProofs } = require('../api/_shipping-proof');
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
let calls, snapshots;

beforeEach(() => {
  Object.assign(process.env, { LIORA_COUPONS_ENABLED: 'true', LIORA_CHECKOUT_V2: 'false', VERCEL_ENV: 'development', PAYMENT_MODE: 'test',
    SITE_URL: 'https://liora.example', CHECKOUT_SIGNING_SECRET: 'synthetic-signing-secret-for-coupon-tests',
    MP_ACCESS_TOKEN: 'synthetic-access-token', MP_WEBHOOK_SECRET: 'synthetic-webhook-secret-for-coupon-tests',
    COUPON_CPF_HASH_SECRET: 'synthetic-cpf-hash-secret-for-coupon-tests',
    // Runtime-only dummy credentials; no reusable key material in source.
    ORDERS_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', ORDERS_SUPABASE_SECRET_KEY: 'sb_secret_' + randomBytes(24).toString('base64url') });
  delete process.env.SUPERFRETE_TOKEN;
  calls = []; snapshots = [];
  global.fetch = async (url, options) => {
    calls.push({ url, body: options?.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/checkout/preferences')) return { ok: true, json: async () => ({ id: 'test-preference', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=test' }) };
    if (url.endsWith('/links')) return { ok: true, json: async () => ({ url: 'https://checkout.infinitepay.io/test' }) };
    throw Error('Unexpected network request in coupon test');
  };
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

async function invoke(handler, body) {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method: 'POST', body }, res);
  return res;
}
function request(overrides = {}) {
  return { checkoutKey: randomUUID(), returnOrigin: 'https://liora.example', couponCode: 'BF20',
    items: [{ id: 'botanique', qty: 1, frag: 'Lavanda', price: 0.01 }], payMethod: 'card',
    shipping: { method: 'delivery', serviceId: 'curitiba-fixed', price: 0 },
    payer: { name: 'Pessoa Teste', email: 'teste@example.com', cep: '80010000', addr: 'Endereço de teste', num: '1', cpf: '191.191.191-00' },
    ...overrides };
}
function mockOrders(t) {
  const saved = new Map();
  t.mock.method(orders, 'getOrder', async id => saved.get(id) || null);
  t.mock.method(orders, 'couponEligibility', async () => ({ eligible: true }));
  t.mock.method(orders, 'register', async snapshot => {
    snapshots.push(snapshot);
    if (saved.has(snapshot.id)) return { order: saved.get(snapshot.id), created: false };
    saved.set(snapshot.id, { ...snapshot, created_at: new Date(Date.now()).toISOString() });
    return { order: snapshot, created: true };
  });
  t.mock.method(orders, 'saveCheckout', async (id, environment, response) => { saved.get(id).checkout_response = response; });
}

test('BF20 respects inclusive Brazilian start and exclusive midnight after November 29', () => {
  assert.throws(() => resolveCoupon('BF20', Date.parse('2026-11-26T02:59:59.999Z')), { code: 'COUPON_NOT_STARTED' });
  assert.equal(resolveCoupon(' bf20 ', Date.parse('2026-11-26T03:00:00Z')).percent, 20);
  assert.equal(resolveCoupon('BF20', Date.parse('2026-11-30T02:59:59.999Z')).percent, 20);
  assert.throws(() => resolveCoupon('BF20', Date.parse('2026-11-30T03:00:00Z')), { code: 'COUPON_EXPIRED' });
});
test('one literal coupon at a time; no aliases, arrays, objects or composite codes', () => {
  for (const code of [['BF20', 'PRIMEIRACOMPRA'], {}, 'BF20 PRIMEIRACOMPRA', 'BF20+PRIMEIRACOMPRA', 'BF20,PRIMEIRACOMPRA']) {
    assert.throws(() => normalizeCode(code), { code: 'COUPON_ONE_AT_A_TIME' });
  }
  assert.throws(() => resolveCoupon('BF20%'), { code: 'COUPON_INVALID' });
  assert.equal(normalizeCode(undefined), null);
  assert.equal(resolveCoupon('primeiracompra').percent, 10);
});
test('catalogue value stays 129.90; coupon then existing Pix extra preserve exact cents', () => {
  const cart = [{ price: 129.9, quantity: 1 }];
  const bf = resolveCoupon('BF20', Date.parse('2026-11-28T12:00:00-03:00'));
  const first = resolveCoupon('PRIMEIRACOMPRA');
  assert.deepEqual(priceProducts(cart, 'card', bf), { subtotalCents: 12990, couponDiscountCents: 2598, paymentDiscountCents: 0, productTotalCents: 10392,
    coupon: { code: 'BF20', percent: 20, discountCents: 2598 } });
  assert.equal(priceProducts(cart, 'pix', bf).productTotalCents, 9872);
  assert.equal(priceProducts(cart, 'card', first).productTotalCents, 11691);
  assert.equal(priceProducts(cart, 'pix', first).productTotalCents, 11106);
  assert.equal(priceProducts(cart, 'pix').productTotalCents, 12340);
  assert.equal(cart[0].price, 129.9);
});
test('CPF hash is normalized, private, environment scoped and requires a stable secret', () => {
  const hash = cpfHash('191.191.191-00', 'development');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, cpfHash('19119119100', 'development'));
  assert.notEqual(hash, cpfHash('19119119100', 'production'));
  assert.throws(() => cpfHash('11111111111', 'development'), { code: 'CHECKOUT_CPF_INVALID' });
  delete process.env.COUPON_CPF_HASH_SECRET;
  assert.throws(() => cpfHash('19119119100', 'development'), { code: 'COUPON_IDENTITY_NOT_CONFIGURED' });
});
test('proportional allocation always matches discounted total without negative lines', () => {
  for (let count = 1; count <= 50; count++) {
    const cart = Array.from({ length: count }, (_, i) => ({ price: (101 + i * 17) / 100, quantity: (i % 4) + 1 }));
    for (const percent of [10, 20]) for (const method of ['card', 'pix']) {
      const pricing = priceProducts(cart, method, { code: 'fixture', percent });
      const allocation = allocateProductCents(cart, pricing.productTotalCents);
      assert.equal(allocation.reduce((sum, cents) => sum + cents, 0), pricing.productTotalCents);
      assert.ok(allocation.every(cents => cents > 0 && Number.isInteger(cents)));
    }
  }
});
test('coupon API ignores browser discount/price/time and enforces first purchase eligibility', async t => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-28T12:00:00-03:00'));
  mockOrders(t);
  const res = await invoke(validateEndpoint, request({ discount: 100, now: '2099-01-01' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.subtotalCents, 7500);
  assert.equal(res.body.couponDiscountCents, 1500);
  assert.equal(calls.length, 0, 'validation never creates a payment');
  t.mock.method(orders, 'couponEligibility', async () => ({ eligible: false, code: 'COUPON_FIRST_ORDER_ONLY' }));
  assert.equal((await invoke(validateEndpoint, request({ couponCode: 'PRIMEIRACOMPRA' }))).body.code, 'COUPON_FIRST_ORDER_ONLY');
  t.mock.method(orders, 'couponEligibility', async () => ({ eligible: false, code: 'COUPON_HISTORY_UNAVAILABLE' }));
  assert.equal((await invoke(validateEndpoint, request({ couponCode: 'PRIMEIRACOMPRA' }))).statusCode, 503);
});
test('payment creation revalidates date, prevents spoofing, preserves fixed freight and existing Checkout Pro Pix', async t => {
  mockOrders(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-11-28T12:00:00-03:00'));
  for (const method of ['card', 'boleto', 'pix']) {
    const result = await invoke(createCheckout, request({ payMethod: method }));
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.total, method === 'pix' ? 76.90 : 79.90);
    assert.equal(result.body.pix, undefined, 'coupon tracking must not activate direct Pix');
    const call = calls.at(-1);
    assert.equal(call.body.shipments.cost, 19.90);
    assert.equal(call.body.items.reduce((sum, item) => sum + Math.round(item.unit_price * 100) * item.quantity, 0), method === 'pix' ? 5700 : 6000);
    assert.equal(call.body.payer.identification.number, '19119119100');
    const order = snapshots.at(-1);
    assert.equal(order.items[0].price, 75);
    assert.equal(order.shipping_cents, 1990);
    assert.equal(order.coupon_code, 'BF20');
    assert.doesNotMatch(JSON.stringify(order), /19119119100/);
  }
  t.mock.method(Date, 'now', () => Date.parse('2026-11-30T03:00:00Z'));
  const count = calls.length;
  assert.equal((await invoke(createCheckout, request())).body.code, 'COUPON_EXPIRED');
  assert.equal(calls.length, count);
});
test('free shipping remains based on original subtotal, including after coupon reduces below R$150', async t => {
  mockOrders(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-11-28T12:00:00-03:00'));
  const res = await invoke(createCheckout, request({ items: [{ id: 'botanique', qty: 2 }], payMethod: 'pix' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 114);
  assert.equal(calls.at(-1).body.shipments.cost, 0);
  assert.equal(snapshots[0].subtotal_cents, 15000);
});
test('same checkout key reuses coupon payment; rejected eligibility never calls provider', async t => {
  mockOrders(t);
  const req = request({ couponCode: 'PRIMEIRACOMPRA', payMethod: 'pix' });
  const first = await invoke(createCheckout, req);
  const second = await invoke(createCheckout, req);
  assert.equal(first.statusCode, 200);
  assert.equal(second.body.order_id, first.body.order_id);
  assert.equal(calls.length, 1);
  // Creation relies on the database's atomic reservation, not a stale quote.
  t.mock.method(orders, 'register', async () => orders.couponFailure('COUPON_ORDER_PENDING'));
  assert.equal((await invoke(createCheckout, request({ couponCode: 'PRIMEIRACOMPRA' }))).body.code, 'COUPON_ORDER_PENDING');
  assert.equal(calls.length, 1);
});
test('BF order created in the campaign recovers the same payment after midnight without creating a new one', async t => {
  mockOrders(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-11-29T23:59:00-03:00'));
  const req = request();
  const quote = attachQuoteProofs({ quotes: [{ id: 'curitiba-fixed', name: 'Entrega em Curitiba', carrier: 'Entrega local', price: 19.9, deliveryDays: 0 }] },
    { zipCode: '80010000', cart: validateCart(req.items) },
    { secret: process.env.CHECKOUT_SIGNING_SECRET, environment: 'development', mode: 'test' }).quotes[0];
  req.shipping.quoteProof = quote.quoteProof;
  const first = await invoke(createCheckout, req);
  assert.equal(first.statusCode, 200);
  t.mock.method(Date, 'now', () => Date.parse('2026-11-30T00:30:00-03:00'));
  const recovered = await invoke(createCheckout, req);
  assert.equal(recovered.statusCode, 200);
  assert.equal(recovered.body.order_id, first.body.order_id);
  assert.equal(calls.length, 1);
  assert.equal((await invoke(createCheckout, request())).body.code, 'COUPON_EXPIRED');
  assert.equal(calls.length, 1);
});
test('missing/invalid CPF and multiple coupons fail before provider; no-coupon orders are tracked', async t => {
  mockOrders(t);
  for (const cpf of ['', '11111111111']) {
    const req = request(); req.payer.cpf = cpf;
    assert.equal((await invoke(createCheckout, req)).body.code, 'CHECKOUT_CPF_INVALID');
  }
  assert.equal((await invoke(createCheckout, request({ coupons: ['BF20', 'PRIMEIRACOMPRA'] }))).body.code, 'COUPON_ONE_AT_A_TIME');
  assert.equal(calls.length, 0);
  const res = await invoke(createCheckout, request({ couponCode: undefined }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 94.9);
  assert.equal(snapshots[0].coupon_code, null);
  assert.match(snapshots[0].customer_cpf_hash, /^[a-f0-9]{64}$/);
});
test('InfinitePay discount changes only charged item totals and leaves delivery untouched', async () => {
  const cart = validateCart([{ id: 'botanique', qty: 1 }, { id: 'perolas', qty: 2 }]);
  const pricing = priceProducts(cart, 'infinitepay', resolveCoupon('PRIMEIRACOMPRA'));
  await createInfinitePay({ config: { credential: 'synthetic-handle' }, orderId: 'LIORA-TEST-12345678', siteUrl: 'https://liora.example',
    cart, shippingCost: 19.9, selectedQuote: { name: 'Curitiba' }, customer: { name: 'Pessoa Teste', email: 'teste@example.com' }, address: {}, durable: true,
    discountedProductCents: pricing.productTotalCents });
  const items = calls[0].body.items;
  assert.equal(items.at(-1).price, 1990);
  assert.equal(items.reduce((sum, item) => sum + item.price * item.quantity, 0), pricing.productTotalCents + 1990);
});
