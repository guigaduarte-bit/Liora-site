'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { Readable } = require('node:stream');
const { getWhatsAppConfig, isWhatsAppEnabled, sendOrderAlert } = require('../api/_whatsapp');
const { createHandler, MAX_BODY_BYTES, config: webhookConfig } = require('../api/whatsapp-webhook');

const alert = { id: '12345678-1234-4234-8234-123456789abc', order_id: 'LIORA-TEST-12345678', environment: 'production' };
const messageId = 'wamid.SYNTHETIC_MESSAGE_1';
const environment = overrides => ({
  VERCEL_ENV: 'production', PAYMENT_MODE: 'live', WHATSAPP_ENABLED: 'true',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345', WHATSAPP_SENDER_NUMBER: '+16505550101',
  WHATSAPP_ALERT_RECIPIENT: '+16505550102', WHATSAPP_ACCESS_TOKEN: 'synthetic-token-unit-tests-only',
  WHATSAPP_ORDER_TEMPLATE: 'liora_pedido_confirmado', WHATSAPP_TEMPLATE_LANGUAGE: 'pt_BR',
  WHATSAPP_APP_SECRET: 'synthetic-app-secret-unit-tests-only',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'synthetic-verification-token-unit-tests-only', ...overrides,
});
const order = overrides => ({
  id: alert.order_id, total_cents: 9490, environment: 'production', mode: 'live', status: 'approved',
  items: [{ name: 'Botanique', quantity: 2, fragrance: 'Do not forward customer customization' }],
  customer: { name: 'Private customer name', email: 'private@example.test', cpf: '00000000000', address: 'Private address' },
  ...overrides,
});
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const accepted = () => reply({ messaging_product: 'whatsapp', messages: [{ id: messageId, message_status: 'accepted' }] });

test('sending requires explicit enablement, production live mode and complete distinct-number configuration', async () => {
  const invalid = [
    { WHATSAPP_ENABLED: undefined }, { WHATSAPP_ENABLED: 'TRUE' }, { VERCEL_ENV: 'preview' },
    { PAYMENT_MODE: 'test' }, { WHATSAPP_ACCESS_TOKEN: '' }, { WHATSAPP_PHONE_NUMBER_ID: '' },
    { WHATSAPP_PHONE_NUMBER_ID: '../other' }, { WHATSAPP_SENDER_NUMBER: '' }, { WHATSAPP_ALERT_RECIPIENT: '' },
    { WHATSAPP_ALERT_RECIPIENT: '16505550101' }, { WHATSAPP_ORDER_TEMPLATE: '' },
    { WHATSAPP_APP_SECRET: undefined }, { WHATSAPP_APP_SECRET: 'short' },
    { WHATSAPP_WEBHOOK_VERIFY_TOKEN: undefined }, { WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'short' },
    { WHATSAPP_API_VERSION: 'v27.0/../../other' }, { WHATSAPP_TEMPLATE_LANGUAGE: 'invalid language' },
  ];
  let calls = 0;
  for (const overrides of invalid) {
    const result = await sendOrderAlert(alert, order(), { env: environment(overrides), fetchImpl: async () => { calls++; return accepted(); } });
    assert.equal(result.status, 'failed');
  }
  assert.equal(calls, 0);
  assert.equal(isWhatsAppEnabled(environment()), true);
  const config = getWhatsAppConfig(environment());
  assert.equal(config.valid, true);
  assert.equal(config.apiVersion, 'v27.0');
  assert.doesNotMatch(JSON.stringify(config), /synthetic-token|synthetic-app-secret/);
});

test('approved template request contains only order reference, BRL total and bounded product summary', async () => {
  let call;
  const result = await sendOrderAlert(alert, order(), { env: environment(), fetchImpl: async (url, options) => { call = { url, options }; return accepted(); } });
  assert.deepEqual(result, { status: 'accepted', messageId });
  assert.equal(call.url, 'https://graph.facebook.com/v27.0/123456789012345/messages');
  assert.equal(call.options.redirect, 'error');
  assert.equal(call.options.headers.Authorization, 'Bearer synthetic-token-unit-tests-only');
  const payload = JSON.parse(call.options.body);
  assert.equal(payload.to, '16505550102');
  assert.equal(payload.biz_opaque_callback_data, alert.id);
  assert.deepEqual(payload.template.components, [{ type: 'body', parameters: [
    { type: 'text', text: alert.order_id }, { type: 'text', text: 'R$ 94,90' }, { type: 'text', text: '2x Botanique' },
  ] }]);
  assert.doesNotMatch(call.options.body, /Private|private@example|00000000000|customization|fragrance/);

  const manyItems = Array.from({ length: 50 }, () => ({ name: 'Produto com nome longo'.repeat(8), quantity: 1 }));
  await sendOrderAlert(alert, order({ items: manyItems }), { env: environment(), fetchImpl: async (_, options) => {
    const summary = JSON.parse(options.body).template.components[0].parameters[2].text;
    assert.ok(summary.length <= 300);
    assert.ok(summary.endsWith('…'));
    return accepted();
  } });
});

test('test, unpaid, conflicting or malformed order snapshots never send', async () => {
  let calls = 0;
  for (const overrides of [
    { status: 'pending' }, { status: 'review_required' }, { status: 'refunded' },
    { environment: 'preview' }, { mode: 'test' }, { id: 'LIORA-OTHER-12345678' },
    { total_cents: -1 }, { total_cents: 1.5 }, { items: [] },
    { items: [{ name: 'Produto', quantity: 0 }] },
  ]) {
    assert.equal((await sendOrderAlert(alert, order(overrides), { env: environment(), fetchImpl: async () => { calls++; return accepted(); } })).code, 'WHATSAPP_ORDER_INVALID');
  }
  assert.equal(calls, 0);
});

test('Meta refusals distinguish retryable failures from permanent failures without raw provider details', async () => {
  for (const [code, status] of [[130429, 'retryable'], [131056, 'retryable'], [131016, 'retryable'], [190, 'failed'], [132001, 'failed'], [131021, 'failed']]) {
    const result = await sendOrderAlert(alert, order(), { env: environment(), fetchImpl: async () => reply({ error: { code, message: 'SENSITIVE provider details' } }, 400) });
    assert.deepEqual(result, { status, code: `WHATSAPP_PROVIDER_${code}` });
    assert.doesNotMatch(JSON.stringify(result), /SENSITIVE/);
  }
});

test('timeout, malformed acceptance and server errors remain unknown instead of blindly retryable', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('socket closed after acceptance; confidential details'); },
    async () => reply({}),
    async () => reply({ messages: [{ id: 'not-a-whatsapp-id' }] }),
    async () => reply({ messages: [{ id: messageId }, { id: messageId }] }),
    async () => new Response('malformed', { status: 200 }),
    async () => new Response('a'.repeat(65537), { status: 200 }),
    async () => new Response('upstream unavailable', { status: 503 }),
  ]) {
    const result = await sendOrderAlert(alert, order(), { env: environment(), fetchImpl });
    assert.deepEqual(result, { status: 'unknown', code: 'WHATSAPP_ACK_UNKNOWN' });
  }
});

function statusPayload(statuses, metadata = {}) {
  return { object: 'whatsapp_business_account', entry: [{ id: '123456', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: '123456789012345', ...metadata }, statuses,
  } }] }] };
}
const delivery = overrides => ({ id: messageId, status: 'delivered', recipient_id: '16505550102',
  timestamp: '1795176000', biz_opaque_callback_data: alert.id, ...overrides });
function signedRequest(payload, env = environment(), changes = {}) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const bytes = Buffer.from(raw);
  const req = Readable.from([bytes.subarray(0, 17), bytes.subarray(17)]);
  Object.assign(req, { method: 'POST', headers: {
    'content-type': 'application/json', 'content-length': String(bytes.length),
    'x-hub-signature-256': `sha256=${createHmac('sha256', env.WHATSAPP_APP_SECRET).update(bytes).digest('hex')}`,
  }, ...changes });
  return req;
}
async function invoke(handler, req) {
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; } };
  await handler(req, res);
  return res;
}

test('webhook handshake verifies token and returns exact challenge only in production', async () => {
  const env = environment(), handler = createHandler({ env });
  const req = { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': env.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'hub.challenge': '1234567890' } };
  assert.equal((await invoke(handler, req)).body, '1234567890');
  assert.equal((await invoke(handler, { ...req, query: { ...req.query, 'hub.verify_token': 'wrong' } })).statusCode, 403);
  assert.equal((await invoke(createHandler({ env: environment({ VERCEL_ENV: 'preview' }) }), req)).statusCode, 503);
  assert.equal(webhookConfig.api.bodyParser, false);
});

test('webhook authenticates original raw bytes before parsing or writing', async () => {
  let writes = 0;
  const handler = createHandler({ env: environment(), recordDelivery: async () => { writes++; return { updated: true }; } });
  const req = signedRequest(statusPayload([delivery()]));
  req.headers['x-hub-signature-256'] = `sha256=${'0'.repeat(64)}`;
  assert.equal((await invoke(handler, req)).statusCode, 401);
  const malformed = signedRequest('{invalid-json');
  assert.equal((await invoke(handler, malformed)).statusCode, 400);
  const unsignedMalformed = signedRequest('{invalid-json');
  delete unsignedMalformed.headers['x-hub-signature-256'];
  assert.equal((await invoke(handler, unsignedMalformed)).statusCode, 401);
  const parsedBody = { method: 'POST', headers: signedRequest('{}').headers, body: statusPayload([delivery()]) };
  assert.equal((await invoke(handler, parsedBody)).body.code, 'WHATSAPP_RAW_BODY_REQUIRED');
  assert.equal(writes, 0);
});

test('valid delivery callbacks remain enabled when new sends are paused and strip unrelated data', async () => {
  const updates = [], env = environment({ WHATSAPP_ENABLED: 'false', WHATSAPP_ACCESS_TOKEN: '' });
  const handler = createHandler({ env, recordDelivery: async update => { updates.push(update); return { updated: true, status: update.status }; } });
  const payload = statusPayload([delivery({ errors: [{ message: 'private provider details' }] }), delivery(), delivery({ status: 'read' })]);
  payload.entry[0].changes[0].value.contacts = [{ profile: { name: 'Private person' } }];
  const res = await invoke(handler, signedRequest(payload, env));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(updates, [
    { alertId: alert.id, messageId, status: 'delivered' }, { alertId: alert.id, messageId, status: 'read' },
  ]);
});

test('callback requires our sender metadata, recipient and opaque alert correlation', async () => {
  let writes = 0;
  const handler = createHandler({ env: environment(), recordDelivery: async () => { writes++; return { updated: true }; } });
  const invalid = [
    delivery({ recipient_id: '16505550999' }), delivery({ biz_opaque_callback_data: undefined }),
    delivery({ biz_opaque_callback_data: [alert.id] }), delivery({ id: [messageId] }),
    delivery({ status: 'unknown' }),
  ];
  assert.equal((await invoke(handler, signedRequest(statusPayload(invalid)))).statusCode, 200);
  assert.equal((await invoke(handler, signedRequest(statusPayload([delivery()], { phone_number_id: '999999999' })))).statusCode, 200);
  assert.equal(writes, 0);
});

test('persisted duplicates are acknowledged; storage failure requests provider retry without exposing details', async () => {
  const duplicate = createHandler({ env: environment(), recordDelivery: async () => ({ updated: false, status: 'delivered' }) });
  assert.equal((await invoke(duplicate, signedRequest(statusPayload([delivery()])))).statusCode, 200);
  for (const recordDelivery of [async () => { throw new Error('database credential and customer data'); }, async () => null]) {
    const failed = await invoke(createHandler({ env: environment(), recordDelivery }), signedRequest(statusPayload([delivery()])));
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.body, { code: 'WHATSAPP_STORAGE_UNAVAILABLE' });
  }
});

test('oversized raw webhook bodies are rejected before any persistence', async () => {
  let writes = 0;
  const handler = createHandler({ env: environment(), recordDelivery: async () => { writes++; return { updated: true }; } });
  const req = signedRequest(' '.repeat(MAX_BODY_BYTES + 1));
  assert.equal((await invoke(handler, req)).statusCode, 413);
  const chunked = signedRequest(' '.repeat(MAX_BODY_BYTES + 1));
  delete chunked.headers['content-length'];
  assert.equal((await invoke(handler, chunked)).statusCode, 413);
  assert.equal(writes, 0);
});
