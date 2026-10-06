'use strict';

const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { quoteShipping } = require('../api/_shipping');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const originalWarn = console.warn;
const originalError = console.error;
afterEach(() => {
  global.fetch = originalFetch;
  console.warn = originalWarn;
  console.error = originalError;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

function configure() {
  process.env.VERCEL_ENV = 'preview';
  process.env.SUPERFRETE_TOKEN = 'private-test-token-never-log';
  process.env.SHIP_ORIGIN_CEP = '80010000';
  process.env.SUPERFRETE_BASE_URL = 'https://sandbox.superfrete.com';
  delete process.env.SUPERFRETE_SERVICES;
}

test('no-options diagnostics retain readable messages and redact credentials and contact details', async () => {
  configure();
  const logs = [];
  console.warn = (...args) => logs.push(args);
  global.fetch = async () => ({ ok: true, status: 200, json: async () => [{
    id: 1,
    error: `Serviço indisponível; token=${process.env.SUPERFRETE_TOKEN}; origem=80010000; destino=95900-180; teste@example.com; https://example.com/private; 123.456.789-00`
  }] });
  const result = await quoteShipping({ zipCode: '95900180', cart: [{ id: 'peonia', quantity: 1 }], subtotal: 12 });
  const diagnostic = JSON.parse(logs[0][0]);
  assert.equal(logs[0].length, 1);
  assert.equal(diagnostic.event, 'shipping_provider_no_options');
  assert.equal(diagnostic.originZipValid, true);
  assert.equal(diagnostic.attempts.length, 2);
  assert.match(diagnostic.attempts[0].messages[0], /Serviço indisponível/);
  assert.equal(diagnostic.attempts[0].responseType, 'array');
  assert.equal(diagnostic.attempts[0].resultCount, 1);
  const serialized = JSON.stringify(logs);
  for (const secret of [process.env.SUPERFRETE_TOKEN, '80010000', '95900-180', 'teste@example.com', 'https://example.com/private', '123.456.789-00']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(result.code, 'NO_SHIPPING_OPTIONS');
  assert.deepEqual(result.quotes, []);
  assert.equal(JSON.stringify(result).includes('Serviço indisponível'), false);
});

test('provider rejection logs nested error messages without changing the public failure response', async () => {
  configure();
  const logs = [];
  console.warn = () => {};
  console.error = (...args) => logs.push(args);
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({
    errors: [{ error: { message: `Authorization: Bearer ${process.env.SUPERFRETE_TOKEN}` } }]
  }) });
  const result = await quoteShipping({ zipCode: '01310100', cart: [{ id: 'peonia', quantity: 1 }], subtotal: 12 });
  const diagnostic = JSON.parse(logs[0][0]);
  assert.equal(diagnostic.event, 'shipping_provider_rejected');
  assert.equal(diagnostic.attempts[0].status, 401);
  assert.match(diagnostic.attempts[0].messages[0], /Bearer \[redacted\]/);
  assert.equal(JSON.stringify(logs).includes(process.env.SUPERFRETE_TOKEN), false);
  assert.equal(result.code, 'SHIPPING_PROVIDER_UNAVAILABLE');
});
