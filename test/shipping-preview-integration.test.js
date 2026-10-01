'use strict';

const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const previewEstimate = require('../api/preview-shipping-estimate');
const shippingQuote = require('../api/shipping-quote');
const createPreference = require('../api/create-preference');
const { quoteShipping } = require('../api/_shipping');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

async function invoke(handler, method, body) {
  const res = {
    statusCode: 200, headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; }
  };
  await handler({ method, body }, res);
  return res;
}

function previewEnv(withProvider = false) {
  process.env.VERCEL_ENV = 'preview';
  delete process.env.SUPERFRETE_TOKEN;
  delete process.env.SHIP_ORIGIN_CEP;
  if (withProvider) {
    process.env.SUPERFRETE_TOKEN = 'test-only-shipping-token';
    process.env.SHIP_ORIGIN_CEP = '80000000';
    process.env.SUPERFRETE_BASE_URL = 'https://sandbox.superfrete.com';
    process.env.SUPERFRETE_SERVICES = '1,2';
  }
}

function providerStub(calls, data = [{ id: 1, name: 'PAC', company: { name: 'Correios' }, price: '20.00', delivery_time: 5 }]) {
  global.fetch = async (url, options) => {
    assert.match(String(url), /sandbox\.superfrete\.com\/api\/v0\/calculator$/);
    calls.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => data };
  };
}

test('simulator endpoint stays unavailable outside preview, including client flags', async () => {
  for (const env of ['production', 'development', '']) {
    process.env.VERCEL_ENV = env;
    const response = await invoke(previewEstimate, 'POST', { preview: true, items: [{ id: 'peonia', qty: 1 }] });
    assert.equal(response.statusCode, 404);
    assert.equal(response.body.packaging, undefined);
  }
});

test('preview catalogue exposes only public product fields and no contact data', async () => {
  previewEnv();
  const response = await invoke(previewEstimate, 'GET');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(response.body.products.length, 27);
  for (const product of response.body.products) {
    assert.deepEqual(Object.keys(product).sort(), ['dimensionsCm', 'id', 'name', 'stock', 'weightGrams']);
  }
});

test('all 27 models are evaluated by the deployed API handler without external calls', async () => {
  previewEnv();
  global.fetch = async () => { throw new Error('No external request expected'); };
  const products = (await invoke(previewEstimate, 'GET')).body.products;
  const counts = {};
  for (const product of products) {
    const result = await invoke(previewEstimate, 'POST', { items: [{ id: product.id, qty: 1 }] });
    assert.equal(result.statusCode, 200, product.id);
    counts[result.body.packaging.status] = (counts[result.body.packaging.status] || 0) + 1;
  }
  assert.deepEqual(counts, { incomplete: 3, estimated: 23, unavailable: 1 });
});

test('simulation allows hypothetical quantities while checkout enforces inventory', async () => {
  previewEnv();
  const items = [{ id: 'botanique', qty: 4 }];
  const simulation = await invoke(previewEstimate, 'POST', { items });
  assert.equal(simulation.body.packaging.parcels.length, 2);
  assert.equal(simulation.body.packaging.totalWeightGrams, 2800);
  const checkout = await invoke(shippingQuote, 'POST', { cep: '95900180', items });
  assert.equal(checkout.statusCode, 400);
  assert.equal(checkout.body.code, 'INVALID_REQUEST');
});

test('preview estimates without credentials and does not invent price options', async () => {
  previewEnv();
  const response = await invoke(shippingQuote, 'POST', { cep: '95900180', items: [{ id: 'peonia', qty: 1 }] });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.packaging.totalWeightGrams, 350);
  assert.equal(response.body.packaging.parcels[0].boxCode, 'M12');
  assert.deepEqual(response.body.quotes, []);
  assert.equal(response.body.code, 'SHIPPING_CONFIGURATION_REQUIRED');
});

test('provider receives the full parcel once in kilograms, without products or client dimensions', async () => {
  previewEnv(true);
  const calls = [];
  providerStub(calls);
  const response = await invoke(shippingQuote, 'POST', {
    cep: '95900180',
    items: [{ id: 'peonia', qty: 1, weight: 0.001, dimensionsCm: { length: 1, width: 1, height: 1 } }]
  });
  assert.equal(response.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].package, { length: 24, width: 16, height: 12, weight: 0.35 });
  assert.equal(calls[0].products, undefined);
  assert.equal(response.body.quotes[0].preview, true);
  assert.equal(response.body.quotes[0].estimated, true);
});

test('missing and oversized pieces prevent partial carrier requests', async () => {
  previewEnv(true);
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected request'); };
  for (const id of ['botanique-150-gr-1gyzj', 'jardim-encantado']) {
    const result = await quoteShipping({ zipCode: '95900180', subtotal: 100, cart: [{ id: 'peonia', quantity: 1 }, { id, quantity: 1 }] });
    assert.deepEqual(result.quotes, []);
    assert.deepEqual(result.packaging.parcels, []);
    assert.equal(result.code, 'SHIPPING_PACKAGING_PENDING');
  }
  assert.equal(calls, 0);
});

test('multiple parcels are quoted separately and never submitted as one package', async () => {
  previewEnv(true);
  const calls = [];
  providerStub(calls);
  const result = await quoteShipping({ zipCode: '95900180', subtotal: 300, cart: [{ id: 'botanique', quantity: 4 }] });
  assert.equal(result.packaging.parcels.length, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.package.weight === 1.4));
  assert.ok(calls.every(call => call.options.insurance_value === 150));
  assert.equal(result.quotes[0].originalPrice, 40);
  assert.equal(result.quotes[0].price, 0);
  assert.equal(result.quotes[0].parcelCount, 2);
  assert.equal(result.quotes[0].estimated, true);
});

test('provider failure preserves the calculated packaging without fictitious rates', async () => {
  previewEnv(true);
  global.fetch = async () => { throw new Error('Mock provider failure'); };
  const response = await invoke(shippingQuote, 'POST', { cep: '95900180', items: [{ id: 'peonia', qty: 1 }] });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.packaging.totalWeightGrams, 350);
  assert.deepEqual(response.body.quotes, []);
  assert.equal(response.body.code, 'SHIPPING_PROVIDER_UNAVAILABLE');
});

test('local delivery and the existing free-shipping threshold are preserved', async () => {
  previewEnv();
  const cart = [{ id: 'peonia', quantity: 1 }];
  for (const [subtotal, expected] of [[149.99, 19.9], [150, 0]]) {
    const result = await quoteShipping({ zipCode: '80000000', subtotal, cart });
    const local = result.quotes.find(q => q.id === 'curitiba-fixed');
    assert.equal(local.price, expected);
    assert.equal(local.preview, false);
  }
  previewEnv(true);
  providerStub([]);
  const outside = await quoteShipping({ zipCode: '95900180', subtotal: 150, cart });
  assert.equal(outside.quotes[0].price, 0);
  assert.equal(outside.quotes[0].originalPrice, 20);
  assert.equal(outside.quotes[0].preview, true);
});

test('server rejects a payment using estimated shipping before any payment-provider call', async () => {
  previewEnv(true);
  process.env.SITE_URL = 'https://example.com';
  process.env.MP_ACCESS_TOKEN = 'test-only-payment-token';
  process.env.PAYMENT_MODE = 'test';
  process.env.VERCEL_URL = 'example.com';
  process.env.CHECKOUT_SIGNING_SECRET = 'synthetic-checkout-signing-key-for-tests-only';
  const calls = [];
  providerStub(calls);
  const response = await invoke(createPreference, 'POST', {
    items: [{ id: 'peonia', qty: 1 }], payMethod: 'pix',
    shipping: { method: 'delivery', serviceId: '1', preview: false },
    payer: { name: 'Teste Automatizado', email: 'teste@example.com', cep: '95900180', num: '1', addr: 'Endereço fictício de teste' }
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'SHIPPING_ESTIMATE_NOT_VALIDATED');
  assert.equal(calls.length, 1);
});

test('production does not activate estimates through a forged preview flag', async () => {
  previewEnv(true);
  process.env.VERCEL_ENV = 'production';
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('Unexpected request'); };
  const response = await invoke(shippingQuote, 'POST', {
    cep: '95900180', preview: true, items: [{ id: 'peonia', qty: 1 }]
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'SHIPPING_DATA_INCOMPLETE');
  assert.equal(response.body.packaging, undefined);
  assert.equal(calls, 0);
});

test('simulator rejects invalid payloads instead of accepting unknown products or unlimited quantities', async () => {
  previewEnv();
  for (const body of ['{', {}, { items: [] }, { items: [{ id: '__proto__', qty: 1 }] }, { items: [{ id: 'peonia', qty: 101 }] }, { items: [{ id: 'peonia', qty: 0.5 }] }]) {
    assert.equal((await invoke(previewEstimate, 'POST', body)).statusCode, 400);
  }
});
