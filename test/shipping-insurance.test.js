'use strict';

const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { quoteShipping } = require('../api/_shipping');
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

function setup(responses) {
  Object.assign(process.env, {
    VERCEL_ENV: 'preview', SUPERFRETE_TOKEN: 'test-only-token',
    SHIP_ORIGIN_CEP: '80010000', SUPERFRETE_BASE_URL: 'https://sandbox.superfrete.com',
    SUPERFRETE_SERVICES: '1,2,3'
  });
  const calls = [];
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    const data = responses.shift();
    if (data instanceof Error) throw data;
    assert.ok(data, 'Unexpected provider request');
    return { ok: true, status: 200, json: async () => data };
  };
  return calls;
}
const minimumError = id => ({ id, error: 'Valor segurado é abaixo do limite mínimo de R$ 27,00' });
const validQuote = (id, price = '20.00') => ({ id, price, name: id === 1 ? 'PAC' : 'SEDEX', company: { name: 'Correios' }, delivery_time: 5 });
const quote = subtotal => quoteShipping({ zipCode: '95900180', cart: [{ id: 'peonia', quantity: 1 }], subtotal });

test('low-value order recovers PAC and SEDEX without inflating merchandise value or changing the parcel', async () => {
  const calls = setup([[minimumError(1), minimumError(2)], [validQuote(1), validQuote(2, '30.00')]]);
  const result = await quote(12);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.insurance_value, 12);
  assert.equal(calls[0].options.use_insurance_value, true);
  assert.equal(calls[1].services, '1,2');
  assert.equal(calls[1].options.insurance_value, 0);
  assert.equal(calls[1].options.use_insurance_value, false);
  assert.deepEqual(calls[1].package, calls[0].package);
  assert.deepEqual(calls[1].from, calls[0].from);
  assert.deepEqual(calls[1].to, calls[0].to);
  assert.equal(result.quotes.length, 2);
  assert.equal(result.quotes[0].insurance.reason, 'WITHIN_AUTOMATIC_COVERAGE');
  assert.equal(result.quotes[0].preview, true);
  assert.equal(result.quotes[0].estimated, true);
});

test('automatic-coverage ceiling is respected at the cent boundary', async () => {
  for (const [subtotal, recover] of [[25.63, true], [25.64, false], [26, false], [75, false]]) {
    const calls = setup(recover ? [[minimumError(1)], [validQuote(1)]] : [[minimumError(1)], [minimumError(1)]]);
    const result = await quote(subtotal);
    assert.equal(result.quotes.length, recover ? 1 : 0);
    assert.equal(calls.some(call => !call.options.use_insurance_value), recover);
    if (!recover) assert.ok(calls.every(call => call.options.insurance_value === subtotal));
  }
});

test('partial insured quotes survive while only the rejected eligible service is retried', async () => {
  const calls = setup([[validQuote(1), minimumError(2)], [validQuote(2, '30.00'), validQuote(3, '1.00')]]);
  const result = await quote(12);
  assert.equal(calls[1].services, '2');
  assert.deepEqual(result.quotes.map(item => item.id), ['1', '2']);
  assert.equal(result.quotes[0].insurance, undefined);
  assert.equal(result.quotes[1].insurance.additional, false);
});

test('unrelated errors and other carriers never disable additional insurance', async () => {
  for (const error of [{ id: 1, error: 'Rota sem cobertura' }, minimumError(3)]) {
    const calls = setup([[error], [error]]);
    const result = await quote(12);
    assert.equal(result.code, 'NO_SHIPPING_OPTIONS');
    assert.ok(calls.every(call => call.options.use_insurance_value));
  }
});

test('valid higher-value orders keep their declared value and need no recovery request', async () => {
  const calls = setup([[validQuote(1)]]);
  const result = await quote(75);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.insurance_value, 75);
  assert.equal(calls[0].options.use_insurance_value, true);
  assert.equal(result.quotes.length, 1);
});

test('a transport failure during recovery preserves previously valid services', async () => {
  setup([[validQuote(1), minimumError(2)], new Error('test network failure')]);
  const result = await quote(12);
  assert.deepEqual(result.quotes.map(item => item.id), ['1']);
});
