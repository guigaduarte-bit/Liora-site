'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomBytes, randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { getOrderEmailConfig, buildOrderEmailPayload, sendOrderEmail, emailAddress, verifyEmailSignature } = require('../api/_email');
const { createHandler, MAX_BODY_BYTES } = require('../api/email-webhook');

const secret = `whsec_${randomBytes(24).toString('base64')}`;
const messageId = randomUUID();
const alert = { id: randomUUID(), order_id: 'LIORA-EMAIL-12345678', environment: 'production' };
const environment = overrides => ({ VERCEL_ENV: 'production', PAYMENT_MODE: 'live', EMAIL_ALERTS_ENABLED: 'true',
  EMAIL_ALERT_FROM: 'vendas@example.com', EMAIL_ALERT_RECIPIENT: 'owner@example.net',
  RESEND_API_KEY: `synthetic-unit-tests-${randomBytes(12).toString('hex')}`, RESEND_WEBHOOK_SECRET: secret, ...overrides });
const order = overrides => ({ id: alert.order_id, environment: 'production', mode: 'live', status: 'approved', total_cents: 9590,
  items: [{ name: 'Vela <aromática> & presente', quantity: 2, fragrance: 'CUSTOMIZATION_PRIVATE' }],
  customer: { name: 'PRIVATE_CUSTOMER', email: 'private@example.test', cpf: '00000000000', address: 'PRIVATE_ADDRESS' }, ...overrides });
const response = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('email configuration fails closed outside production and never returns credentials', async () => {
  let requests = 0;
  for (const changes of [{ EMAIL_ALERTS_ENABLED: undefined }, { EMAIL_ALERTS_ENABLED: 'TRUE' }, { VERCEL_ENV: 'preview' },
    { PAYMENT_MODE: 'test' }, { EMAIL_ALERT_FROM: '' }, { EMAIL_ALERT_RECIPIENT: '' }, { EMAIL_ALERT_RECIPIENT: 'a@example.com,b@example.com' },
    { EMAIL_ALERT_FROM: 'Liora <vendas@example.com>' }, { RESEND_API_KEY: 'short' }, { RESEND_API_KEY: 'private\r\nheader' },
    { RESEND_WEBHOOK_SECRET: '' }, { RESEND_WEBHOOK_SECRET: 'whsec_invalid' }]) {
    const result = await sendOrderEmail(alert, order(), { env: environment(changes), fetchImpl: async () => { requests++; return response({ id: messageId }); } });
    assert.equal(result.status, 'failed');
  }
  assert.equal(requests, 0);
  const env = environment(), config = getOrderEmailConfig(env);
  assert.equal(config.valid, true);
  assert.equal(JSON.stringify(config).includes(env.RESEND_API_KEY), false);
  assert.equal(JSON.stringify(config).includes(env.RESEND_WEBHOOK_SECRET), false);
  for (const value of ['a\n@example.com', 'a@example.com;bad@example.com', 'a@-bad.example', '.a@example.com', 'a..b@example.com', 'a@example']) assert.equal(emailAddress(value), null);
});

test('email contains approved order summary only, with escaped HTML and one configured recipient', () => {
  const config = getOrderEmailConfig(environment()), payload = buildOrderEmailPayload(alert, order(), config);
  assert.equal(payload.subject, `Venda confirmada na Liora — ${alert.order_id}`);
  assert.deepEqual(payload.to, ['owner@example.net']);
  assert.equal(payload.from, 'Liora <vendas@example.com>');
  assert.match(payload.text, /Total pago: R\$ 95,90/);
  assert.match(payload.text, /2 × Vela <aromática> & presente/);
  assert.match(payload.html, /2 × Vela &lt;aromática&gt; &amp; presente/);
  assert.doesNotMatch(JSON.stringify(payload), /PRIVATE_|CUSTOMIZATION_|00000000000|private@example/);
  assert.deepEqual(payload.tags, [{ name: 'liora_alert_id', value: alert.id }, { name: 'event', value: 'payment_confirmed' }]);
  assert.equal(payload.attachments, undefined); assert.equal(payload.cc, undefined); assert.equal(payload.bcc, undefined);
});

test('only matching paid production orders form an email, with bounded item fields', async () => {
  let requests = 0;
  for (const changes of [{ status: 'pending' }, { status: 'review_required' }, { mode: 'test' }, { environment: 'preview' },
    { id: 'LIORA-DIFFERENT-12345678' }, { total_cents: 0 }, { total_cents: 95.9 }, { items: [] },
    { items: [{ name: 'x', quantity: 0 }] }, { items: [{ name: 'x', quantity: 201 }] }, { items: [{ name: ' \n ', quantity: 1 }] }]) {
    assert.equal((await sendOrderEmail(alert, order(changes), { env: environment(), fetchImpl: async () => { requests++; } })).code, 'EMAIL_ORDER_INVALID');
  }
  assert.equal(requests, 0);
  const payload = buildOrderEmailPayload(alert, order({ items: [{ name: 'x'.repeat(1000), quantity: 1 }] }), getOrderEmailConfig(environment()));
  assert.equal(payload.text.includes('x'.repeat(201)), false);
});

test('send uses Resend HTTPS, deterministic idempotency, timeout and opaque UUID acceptance', async () => {
  const calls = [], env = environment();
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return response({ id: messageId }); };
  assert.deepEqual(await sendOrderEmail(alert, order(), { env, fetchImpl }), { status: 'accepted', messageId });
  assert.deepEqual(await sendOrderEmail(alert, order(), { env, fetchImpl }), { status: 'accepted', messageId });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${env.RESEND_API_KEY}`);
  assert.equal(calls[0].options.headers['Idempotency-Key'], `liora-sale-email/${alert.id}`);
  assert.equal(calls[0].options.body, calls[1].options.body); assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('rate refusal retries; ambiguous ACK, concurrency and network failures never assert delivery', async () => {
  for (const [status, body, expected] of [
    [429, { name: 'rate_limit_exceeded', message: 'private provider content' }, { status: 'retryable', code: 'EMAIL_RATE_LIMITED' }],
    [401, { message: 'private credential' }, { status: 'failed', code: 'EMAIL_HTTP_401' }],
    [403, { message: 'private recipient' }, { status: 'failed', code: 'EMAIL_HTTP_403' }],
    [409, { name: 'invalid_idempotent_request' }, { status: 'failed', code: 'EMAIL_HTTP_409' }],
    [409, { name: 'concurrent_idempotent_requests' }, { status: 'unknown', code: 'EMAIL_REQUEST_IN_PROGRESS' }],
    [500, { message: 'private server error' }, { status: 'unknown', code: 'EMAIL_ACK_UNKNOWN' }],
    [200, { id: 'not-a-uuid' }, { status: 'unknown', code: 'EMAIL_ACK_UNKNOWN' }],
    [200, 'not JSON', { status: 'unknown', code: 'EMAIL_ACK_UNKNOWN' }],
    [200, 'x'.repeat(65537), { status: 'unknown', code: 'EMAIL_ACK_UNKNOWN' }],
  ]) {
    const result = await sendOrderEmail(alert, order(), { env: environment(), fetchImpl: async () => response(body, status) });
    assert.deepEqual(result, expected); assert.doesNotMatch(JSON.stringify(result), /private/);
  }
  assert.deepEqual(await sendOrderEmail(alert, order(), { env: environment(), fetchImpl: async () => { throw new Error('private transport info'); } }),
    { status: 'unknown', code: 'EMAIL_ACK_UNKNOWN' });
});

const now = Date.parse('2026-11-26T19:00:00Z');
const event = overrides => ({ type: 'email.delivered', created_at: '2026-11-26T18:59:59.123456Z', data: {
  email_id: messageId, from: 'Liora <vendas@example.com>', to: ['owner@example.net'],
  tags: { liora_alert_id: alert.id, event: 'payment_confirmed' }, subject: `Venda confirmada na Liora — ${alert.order_id}`,
}, ...overrides });
function signedRequest(payload = event(), changes = {}) {
  const bytes = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const id = 'msg_synthetic-unit-test', timestamp = String(Math.floor(now / 1000));
  const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.`).update(bytes).digest('base64');
  const req = Readable.from([bytes]);
  req.method = 'POST'; req.headers = { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}`, ...changes };
  return req;
}
async function invoke(handler, req) {
  const res = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res); return res;
}

test('Svix official interoperability vector and rotated signatures verify without parsing body', () => {
  // Public test vector from docs.svix.com/receiving/verifying-payloads/how-manual.
  const vectorSecret = ['whsec', 'plJ3nmyCDGBKInavdOK15jsl'].join('_');
  const raw = Buffer.from('{"event_type":"ping","data":{"success":true}}');
  const headers = { 'svix-id': 'msg_loFOjxBNrRLzqYUf', 'svix-timestamp': '1731705121', 'svix-signature': 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=' };
  assert.equal(verifyEmailSignature(raw, headers, vectorSecret, 1731705121000), true);
  assert.equal(verifyEmailSignature(raw, { ...headers, 'svix-signature': `v2,invalid ${headers['svix-signature']}` }, vectorSecret, 1731705121000), true);
  assert.equal(verifyEmailSignature(Buffer.from(raw.toString() + ' '), headers, vectorSecret, 1731705121000), false);
  assert.equal(verifyEmailSignature(raw, headers, vectorSecret, 1731705422000), false);
  assert.equal(verifyEmailSignature(raw, headers, vectorSecret, 1731704820000), false);
});

test('authenticated callback records only correlated email metadata and works while sends are paused', async () => {
  const calls = [], env = environment({ EMAIL_ALERTS_ENABLED: 'false', RESEND_API_KEY: '' });
  const handler = createHandler({ env, now: () => now, recordDelivery: async update => { calls.push(update); return { updated: true, status: 'delivered' }; } });
  const result = await invoke(handler, signedRequest());
  assert.equal(result.statusCode, 200); assert.deepEqual(result.body, { received: true });
  assert.deepEqual(calls, [{ alertId: alert.id, messageId, status: 'delivered', eventAt: '2026-11-26T18:59:59.123456Z' }]);
});

test('forged, stale, parsed, oversize and nonproduction callbacks never touch storage', async () => {
  let writes = 0;
  const handler = createHandler({ env: environment(), now: () => now, recordDelivery: async () => { writes++; return { updated: true }; } });
  for (const changes of [{ 'svix-signature': 'v1,forged' }, { 'svix-timestamp': String(now / 1000 - 301) }, { 'svix-id': 'different' },
    { 'svix-signature': ['not', 'a string'] }, { 'svix-timestamp': 'not a timestamp' }]) assert.equal((await invoke(handler, signedRequest(event(), changes))).statusCode, 401);
  assert.equal((await invoke(handler, signedRequest(event(), { 'content-type': 'text/plain' }))).statusCode, 415);
  assert.equal((await invoke(handler, signedRequest('x'.repeat(MAX_BODY_BYTES + 1)))).statusCode, 413);
  const parsed = signedRequest(); parsed[Symbol.asyncIterator] = undefined;
  assert.equal((await invoke(handler, parsed)).body.code, 'EMAIL_RAW_BODY_REQUIRED');
  assert.equal((await invoke(createHandler({ env: environment({ VERCEL_ENV: 'preview' }), now: () => now, recordDelivery: async () => { writes++; } }), signedRequest())).statusCode, 503);
  assert.equal(writes, 0);
});

test('valid signatures for unrelated sender, recipient, tags or channel do not change email delivery', async () => {
  let writes = 0;
  const handler = createHandler({ env: environment(), now: () => now, recordDelivery: async () => { writes++; return { updated: true }; } });
  for (const data of [{ ...event().data, from: 'Other <vendas@example.com>' }, { ...event().data, to: ['other@example.net'] },
    { ...event().data, to: ['owner@example.net', 'other@example.net'] }, { ...event().data, email_id: 'wamid.whatsapp' },
    { ...event().data, tags: { event: 'other_event', liora_alert_id: alert.id } }, { ...event().data, tags: {} }]) {
    assert.equal((await invoke(handler, signedRequest(event({ data })))).statusCode, 200);
  }
  assert.equal((await invoke(handler, signedRequest(event({ type: 'email.opened' })))).statusCode, 200);
  assert.equal(writes, 0);
});

test('provider delivery outcomes retain precise event times and storage failure remains retryable', async () => {
  const updates = [];
  const handler = createHandler({ env: environment(), now: () => now, recordDelivery: async value => { updates.push(value); return { updated: false }; } });
  for (const status of ['sent', 'delivery_delayed', 'bounced', 'suppressed', 'complained', 'failed']) {
    assert.equal((await invoke(handler, signedRequest(event({ type: `email.${status}` })))).statusCode, 200);
    assert.equal(updates.at(-1).status, status);
  }
  for (const recordDelivery of [async () => null, async () => { throw new Error('private database credentials'); }]) {
    const failed = await invoke(createHandler({ env: environment(), now: () => now, recordDelivery }), signedRequest());
    assert.equal(failed.statusCode, 503); assert.deepEqual(failed.body, { code: 'EMAIL_STORAGE_UNAVAILABLE' });
  }
});
