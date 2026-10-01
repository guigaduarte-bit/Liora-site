'use strict';

const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { quoteShipping, normalizeQuotes } = require('../api/_shipping');
const { estimateCartPackaging } = require('../api/_shipping-estimate');
const shippingQuote = require('../api/shipping-quote');
const createPreference = require('../api/create-preference');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

function setup(handler) {
  Object.assign(process.env, {
    VERCEL_ENV: 'preview', SUPERFRETE_TOKEN: 'test-only-shipping-token',
    SHIP_ORIGIN_CEP: '80010000', SUPERFRETE_BASE_URL: 'https://sandbox.superfrete.com',
    SUPERFRETE_SERVICES: '1,2'
  });
  delete process.env.SUPERFRETE_USER_AGENT;
  const calls = [];
  global.fetch = async (url, options) => {
    assert.match(String(url), /sandbox\.superfrete\.com\/api\/v0\/calculator$/);
    const body = JSON.parse(options.body);
    calls.push(body);
    const data = await handler(body, options);
    return { ok: true, status: 200, json: async () => data };
  };
  return calls;
}
const rate = (id, price, days = 5, carrier = 'Correios') => ({
  id, price, delivery_time: days, company: { name: carrier }, name: id === 1 ? 'PAC' : 'SEDEX'
});
const mixedCart = [{ id: 'peonia', quantity: 2 }, { id: 'botanique', quantity: 1 }];
const mixed = (zipCode = '95900180') => quoteShipping({ zipCode, cart: mixedCart, subtotal: 99 });

async function invoke(handler, body) {
  const res = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler({ method: 'POST', body }, res);
  return res;
}

// Fault injection is isolated to this test's module instance, never the real
// catalogue, packaging configuration or production deployment.
function isolatedShipping({ packaging, timers, clock } = {}) {
  const source = path.resolve(__dirname, '../api/_shipping.js');
  const nativeRequire = createRequire(source);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
    module, process, console, AbortController, Date: clock || Date,
    fetch: (...args) => global.fetch(...args),
    require(specifier) {
      if (specifier === './_shipping-estimate' && packaging) return {
        isShippingEstimatePreview: () => true,
        estimateCartPackaging: () => packaging
      };
      if (specifier === 'node:timers' && timers) return timers;
      return nativeRequire(specifier);
    }
  }, { filename: source });
  return module.exports;
}

test('normalization never turns missing or malformed price values into free shipping', () => {
  for (const price of [null, undefined, '', ' ', false, true, [], [12], {}, NaN, Infinity, '-1', '-0.001', 1e100, '0x10', '1e3']) {
    assert.deepEqual(normalizeQuotes([rate(1, price)]), [], String(price));
  }
  assert.equal(normalizeQuotes([rate(1, '23,51')])[0].price, 23.51);
  assert.equal(normalizeQuotes([rate(1, 0)])[0].price, 0);
  assert.equal(normalizeQuotes([{ ...rate(1, '30.42'), custom_price: '30.39' }])[0].price, 30.39);
  assert.equal(normalizeQuotes([{ ...rate(1, '30.42'), custom_price: null }])[0].price, 30.42);
  for (const days of ['', ' ', false, [], {}]) assert.equal(normalizeQuotes([rate(1, 20, days)])[0].deliveryDays, null);
});

test('each parcel has its own dimensions, mass and merchandise value; only complete services are summed', async () => {
  const calls = setup(body => body.package.weight === 0.59
    ? [rate(1, '12.34', 6), rate(2, '23.45', 2)]
    : [rate(1, '20.01', 8)]);
  const result = await mixed();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.package), [
    { length: 32, width: 24, height: 12, weight: 0.59 },
    { length: 32, width: 24, height: 20, weight: 0.875 }
  ]);
  assert.deepEqual(calls.map(call => call.options.insurance_value), [24, 75]);
  assert.ok(calls.every(call => call.options.use_insurance_value && !call.products));
  assert.equal(result.quotes.length, 1);
  const quote = result.quotes[0];
  assert.equal(quote.id, '1');
  assert.equal(quote.price, 32.35);
  assert.equal(quote.originalPrice, 32.35);
  assert.equal(quote.deliveryDays, 8);
  assert.equal(quote.parcelCount, 2);
  assert.equal(quote.preview, true);
  assert.equal(quote.estimated, true);
  assert.deepEqual(quote.components.map(item => [item.parcelIndex, item.merchandiseValue, item.insurance.declaredValue]), [[1, 24, 24], [2, 75, 75]]);
});

test('minimum-insurance recovery applies only to the low-value parcel in a mixed order', async () => {
  const calls = setup(body => {
    if (body.package.weight === 0.59 && body.options.use_insurance_value) return [
      { id: 1, error: 'Valor segurado é abaixo do limite mínimo de R$ 25,63' },
      { id: 2, error: 'Valor segurado é abaixo do limite mínimo de R$ 27,00' }
    ];
    return [rate(1, 20), rate(2, 30)];
  });
  const result = await mixed();
  assert.equal(calls.length, 3);
  const retry = calls.find(call => !call.options.use_insurance_value);
  assert.equal(retry.package.weight, 0.59);
  assert.equal(retry.options.insurance_value, 0);
  assert.ok(calls.filter(call => call.package.weight === 0.875).every(call => call.options.insurance_value === 75));
  assert.deepEqual(result.quotes[0].components.map(item => item.insurance.additional), [false, true]);
});

test('a carrier failure or malformed parcel rate cannot produce a partial external price', async () => {
  for (const fail of [() => { throw new Error('test network error'); }, () => [], () => [rate(1, null)]]) {
    setup(body => body.package.weight === 0.59 ? [rate(1, 20)] : fail());
    const result = await mixed();
    assert.deepEqual(result.quotes, []);
    assert.equal(result.packaging.parcels.length, 2);
    assert.ok(result.code);
    const local = await mixed('80010000');
    assert.deepEqual(local.quotes.map(quote => [quote.id, quote.price, quote.preview]), [['curitiba-fixed', 19.9, false]]);
  }
});

test('service intersections never mix carriers, accept duplicate ambiguity or invent a missing delivery time', async () => {
  setup(body => body.package.weight === 0.59 ? [rate(1, 20)] : [rate(1, 21, 5, 'Outra transportadora')]);
  assert.equal((await mixed()).code, 'SHIPPING_MULTIPLE_PACKAGES_UNAVAILABLE');
  setup(body => body.package.weight === 0.59 ? [rate(1, 20), rate(1, 21)] : [rate(1, 22)]);
  assert.deepEqual((await mixed()).quotes, []);
  setup(() => [rate(1, 20)]);
  // Explicitly omit every supported deadline field on the second parcel.
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const quote = rate(1, 20);
    if (body.package.weight === 0.875) delete quote.delivery_time;
    return { ok: true, status: 200, json: async () => [quote] };
  };
  assert.equal((await mixed()).quotes[0].deliveryDays, null);
});

test('free shipping keeps the full multivolume carrier cost and both estimated payment methods remain blocked', async () => {
  const calls = setup(body => [rate(1, body.package.weight === 1.1 ? 30.39 : 20.01)]);
  const cart = [{ id: 'sagrada-familia', quantity: 5 }];
  const result = await quoteShipping({ zipCode: '95900180', cart, subtotal: 260 });
  assert.equal(result.quotes[0].price, 0);
  assert.equal(result.quotes[0].originalPrice, 50.4);
  assert.deepEqual(calls.map(call => call.options.insurance_value), [156, 104]);
  Object.assign(process.env, {
    SITE_URL: 'https://example.com', VERCEL_URL: 'example.com',
    PAYMENT_MODE: 'test', CHECKOUT_SIGNING_SECRET: 'test-only-checkout-secret-at-least-32-characters',
    MP_ACCESS_TOKEN: 'test-only-payment-token', INFINITEPAY_HANDLE: 'test-store'
  });
  for (const payMethod of ['pix', 'infinitepay']) {
    const response = await invoke(createPreference, {
      items: [{ id: 'sagrada-familia', qty: 5 }], payMethod,
      shipping: { method: 'delivery', serviceId: '1', preview: false },
      payer: { name: 'Teste Automatizado', email: 'teste@example.com', cep: '95900180', num: '1', addr: 'Endereço fictício de teste' }
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, payMethod === 'infinitepay' ? 'INFINITEPAY_PREVIEW_UNAVAILABLE' : 'SHIPPING_ESTIMATE_NOT_VALIDATED');
  }
});

test('parcel values ignore client overrides and malformed conservation prevents every provider request', async () => {
  const calls = setup(() => [rate(1, 20)]);
  const response = await invoke(shippingQuote, {
    cep: '95900180', subtotal: 1,
    items: [{ id: 'peonia', qty: 2, price: 0.01 }, { id: 'botanique', qty: 1, price: 0.01 }]
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.map(call => call.options.insurance_value), [24, 75]);
  for (const corrupt of [
    packaging => { packaging.parcels[0].items[0].quantity++; },
    packaging => { packaging.parcels[0].items[0].id = 'unknown'; },
    packaging => { packaging.parcels = Array(21).fill(packaging.parcels[0]); }
  ]) {
    const packaging = estimateCartPackaging(mixedCart);
    corrupt(packaging);
    const before = calls.length;
    const result = await isolatedShipping({ packaging }).quoteShipping({ zipCode: '95900180', cart: mixedCart, subtotal: 99 });
    assert.equal(result.code, 'SHIPPING_PACKAGING_PENDING');
    assert.equal(result.quotes.length, 0);
    assert.equal(calls.length, before);
  }
  const before = calls.length;
  const invalidTotal = await quoteShipping({ zipCode: '95900180', cart: mixedCart, subtotal: 1 });
  assert.equal(invalidTotal.code, 'SHIPPING_PACKAGING_PENDING');
  assert.equal(calls.length, before);
});

test('provider requests have bounded concurrency and the fallback User-Agent contains no invented email', async () => {
  let active = 0, maximum = 0;
  const release = [];
  setup(async (_body, options) => {
    assert.match(options.headers['User-Agent'], /https:\/\/lioraaromasdeluxo\.com\.br/);
    assert.doesNotMatch(options.headers['User-Agent'], /@/);
    assert.ok(options.signal);
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => release.push(resolve));
    active--;
    return [rate(1, 20)];
  });
  const resultPromise = quoteShipping({ zipCode: '95900180', cart: [{ id: 'camafeufada', quantity: 10 }], subtotal: 80 });
  await new Promise(setImmediate);
  assert.equal(active, 3);
  while (release.length) {
    release.shift()();
    await new Promise(setImmediate);
  }
  const result = await resultPromise;
  assert.equal(maximum, 3);
  assert.equal(result.quotes[0].parcelCount, 4);
  assert.equal(result.quotes[0].price, 80);
});

test('hung requests time out and abort without a partial rate, with no real timer delay', async () => {
  setup(() => new Promise(() => {}));
  const signals = [];
  global.fetch = async (_url, options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  };
  const timers = {
    setTimeout(callback, milliseconds) {
      assert.ok(milliseconds > 0 && milliseconds <= 8000);
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {}
  };
  const result = await isolatedShipping({ timers }).quoteShipping({ zipCode: '95900180', cart: mixedCart, subtotal: 99 });
  assert.equal(result.code, 'SHIPPING_PROVIDER_TIMEOUT');
  assert.equal(result.quotes.length, 0);
  assert.ok(signals.length > 0 && signals.every(signal => signal.aborted));
});

test('the shared quote deadline prevents queued parcels from starting after the budget expires', async () => {
  let now = 0;
  const clock = class extends Date { static now() { return now; } };
  const calls = setup(() => {
    now = 16000;
    return [rate(1, 20)];
  });
  const result = await isolatedShipping({ clock }).quoteShipping({
    zipCode: '95900180', cart: [{ id: 'camafeufada', quantity: 10 }], subtotal: 80
  });
  assert.equal(result.code, 'SHIPPING_PROVIDER_TIMEOUT');
  assert.equal(result.quotes.length, 0);
  assert.equal(calls.length, 1);
});
