'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAlertStore } = require('../api/_order-alerts');
const { createHandler } = require('../api/order-alerts');

const alert = {
  id: '12345678-1234-4234-8234-123456789abc', claim_token: '12345678-1234-4234-8234-987654321abc',
  order_id: 'LIORA-TEST-12345678', attempts: 1, environment: 'production', event_type: 'payment_confirmed',
  total_cents: 9490, items: [{ name: 'Produto', quantity: 2 }], confirmed_at: '2026-11-20T12:00:00Z',
};
const messageId = 'wamid.SYNTHETIC_MESSAGE_1';
const environment = overrides => ({
  VERCEL_ENV: 'production', PAYMENT_MODE: 'live', WHATSAPP_ENABLED: 'true',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345', WHATSAPP_SENDER_NUMBER: '+16505550101',
  WHATSAPP_ALERT_RECIPIENT: '+16505550102', WHATSAPP_ACCESS_TOKEN: 'synthetic-token-unit-tests-only',
  WHATSAPP_ORDER_TEMPLATE: 'liora_pedido_confirmado', WHATSAPP_ALERTS_START_AT: '2026-11-20T09:00:00-03:00',
  WHATSAPP_APP_SECRET: 'synthetic-app-secret-unit-tests-only',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'synthetic-verification-token-unit-tests-only',
  CRON_SECRET: 'synthetic-dispatch-secret-unit-tests-only', ...overrides,
});

function fixture({ env = environment(), claimed = alert, outcome = { status: 'accepted', messageId }, finish, sendError } = {}) {
  const calls = [], sends = [];
  const store = createAlertStore({ env, now: () => Date.parse('2026-11-20T12:30:00Z'),
    request: async (path, options) => {
      calls.push({ path, ...options });
      if (path.endsWith('liora_claim_order_alert')) return claimed;
      if (path.endsWith('liora_finish_order_alert')) return finish || { updated: true, status: options.body.p_state };
      if (path.endsWith('liora_update_order_alert_delivery')) return { updated: true, status: 'delivered' };
      assert.fail('Unexpected RPC');
    },
    send: async (...args) => { sends.push(args); if (sendError) throw new Error('private transport details'); return outcome; },
  });
  return { ...store, calls, sends };
}

test('disabled, nonproduction and incomplete channel configurations never claim an alert', async () => {
  for (const changes of [
    { WHATSAPP_ENABLED: undefined }, { WHATSAPP_ENABLED: 'false' }, { WHATSAPP_ACCESS_TOKEN: '' },
    { WHATSAPP_APP_SECRET: '' }, { WHATSAPP_WEBHOOK_VERIFY_TOKEN: '' },
    { VERCEL_ENV: 'preview' }, { PAYMENT_MODE: 'test' }, { WHATSAPP_ALERTS_START_AT: '' },
    { WHATSAPP_ALERTS_START_AT: '2026-11-20T12:00:00' }, { WHATSAPP_ALERT_RECIPIENT: '+16505550101' },
  ]) {
    const f = fixture({ env: environment(changes) });
    assert.ok(['disabled', 'unavailable'].includes((await f.dispatchOrderAlert()).status));
    assert.equal(f.calls.length, 0); assert.equal(f.sends.length, 0);
  }
});

test('activation boundary and exact order scope are sent to the atomic claim; empty queue does not send', async () => {
  const f = fixture({ claimed: null });
  assert.deepEqual(await f.dispatchOrderAlert({ orderId: alert.order_id }), { status: 'empty' });
  assert.deepEqual(f.calls[0].body, { p_activation_start: '2026-11-20T12:00:00.000Z', p_order_id: alert.order_id });
  assert.equal(f.sends.length, 0);
  await assert.rejects(f.dispatchOrderAlert({ orderId: 'not-an-order' }), { code: 'ORDER_ALERT_ID_INVALID' });
  assert.equal(f.calls.length, 1);
});

test('accepted sends persist one message ID and pass only the trusted minimal order to the adapter', async () => {
  const f = fixture({ claimed: { ...alert, customer: { cpf: '00000000000', email: 'private@example.test' } } });
  assert.deepEqual(await f.dispatchOrderAlert(), { status: 'accepted', updated: true });
  assert.deepEqual(f.sends[0][1], { id: alert.order_id, environment: 'production', mode: 'live', status: 'approved', total_cents: 9490, items: alert.items });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1].body, {
    p_alert_id: alert.id, p_claim_token: alert.claim_token, p_state: 'accepted',
    p_provider_message_id: messageId, p_error_code: null, p_retry_at: null,
  });
});

test('definite transient refusals use bounded future retries and stop at the fifth attempt', async () => {
  for (const [attempts, retryAt] of [[1, '2026-11-20T12:31:00.000Z'], [2, '2026-11-20T12:35:00.000Z'],
    [3, '2026-11-20T12:45:00.000Z'], [4, '2026-11-20T13:30:00.000Z'], [5, null]]) {
    const f = fixture({ claimed: { ...alert, attempts }, outcome: { status: 'retryable', code: 'WHATSAPP_PROVIDER_131056' } });
    const result = await f.dispatchOrderAlert();
    assert.equal(result.status, attempts < 5 ? 'queued' : 'failed');
    assert.equal(f.calls[1].body.p_retry_at, retryAt);
    assert.equal(f.calls[1].body.p_provider_message_id, null);
    if (attempts === 5) assert.equal(f.calls[1].body.p_error_code, 'ATTEMPT_LIMIT_REACHED');
  }
});

test('ambiguous acknowledgements and thrown sends are quarantined without a retry', async () => {
  for (const settings of [{ sendError: true }, { outcome: { status: 'unknown', code: 'WHATSAPP_ACK_UNKNOWN' } },
    { outcome: { status: 'accepted', messageId: 'invalid' } }, { outcome: undefined, sendError: true }]) {
    const f = fixture(settings);
    assert.equal((await f.dispatchOrderAlert()).status, 'unknown');
    assert.equal(f.calls[1].body.p_retry_at, null);
    assert.equal(f.calls[1].body.p_provider_message_id, null);
    assert.equal(f.calls[1].body.p_error_code, 'WHATSAPP_ACK_UNKNOWN');
  }
  const f = fixture({ outcome: { status: 'failed', code: 'private recipient data' } });
  assert.equal((await f.dispatchOrderAlert()).status, 'failed');
  assert.equal(f.calls[1].body.p_error_code, 'WHATSAPP_ACK_UNKNOWN');
});

test('an authenticated delivery that wins the ACK race remains delivered', async () => {
  const f = fixture({ finish: { updated: false, status: 'delivered' } });
  assert.deepEqual(await f.dispatchOrderAlert(), { status: 'delivered', updated: false });
});

test('malformed claims never send and delivery updates validate identifiers before storage', async () => {
  for (const changes of [{ claim_token: '' }, { environment: 'preview' }, { event_type: 'unknown' }, { attempts: 6 }]) {
    const f = fixture({ claimed: { ...alert, ...changes } });
    await assert.rejects(f.dispatchOrderAlert(), { code: 'ORDER_ALERT_STORAGE_INVALID' });
    assert.equal(f.sends.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.recordDelivery({ alertId: alert.id, messageId: 'invalid', status: 'read' }), { code: 'ORDER_ALERT_DELIVERY_INVALID' });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.recordDelivery({ alertId: alert.id, messageId, status: 'read' }), { updated: true, status: 'delivered' });
  assert.deepEqual(f.calls[0].body, { p_alert_id: alert.id, p_provider_message_id: messageId, p_delivery_status: 'read' });
});

async function invoke(handler, req) {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler(req, res); return res;
}

test('retry endpoint requires a strong configured bearer secret and production live mode before dispatch', async () => {
  let calls = 0;
  for (const [overrides, auth, expected] of [
    [{}, '', 401], [{}, 'Bearer incorrect', 401], [{ CRON_SECRET: '' }, 'Bearer ', 401],
    [{ CRON_SECRET: 'short' }, 'Bearer short', 401],
    [{ VERCEL_ENV: 'preview' }, `Bearer ${environment().CRON_SECRET}`, 503],
  ]) {
    const result = await invoke(createHandler({ env: environment(overrides), dispatch: async () => { calls++; return { status: 'empty' }; } }), { method: 'POST', headers: { authorization: auth } });
    assert.equal(result.statusCode, expected);
  }
  assert.equal(calls, 0);
  const result = await invoke(createHandler({ env: environment(), dispatch: async (...args) => { calls++; assert.equal(args.length, 0); return { status: 'accepted' }; } }),
    { method: 'GET', headers: { authorization: `Bearer ${environment().CRON_SECRET}` }, query: { orderId: 'untrusted' }, body: { orderId: 'untrusted' } });
  assert.equal(result.statusCode, 200); assert.deepEqual(result.body, { status: 'accepted' }); assert.equal(calls, 1);
});

test('retry endpoint hides storage details and marks missing activation as unavailable', async () => {
  for (const dispatch of [async () => { throw new Error('private credentials'); }, async () => ({ status: 'unavailable', code: 'private config' })]) {
    const result = await invoke(createHandler({ env: environment(), dispatch }), { method: 'POST', headers: { authorization: `Bearer ${environment().CRON_SECRET}` } });
    assert.equal(result.statusCode, 503); assert.doesNotMatch(JSON.stringify(result.body), /private/);
  }
});

test('order tracking is independent and alert failures never undo persisted payments', async () => {
  const orders = require('../api/_orders'), alerts = require('../api/_order-alerts');
  const originalEnv = { ...process.env }, originalFetch = global.fetch, originalDispatch = alerts.dispatchOrderAlert, originalWarn = console.warn;
  let dispatches = 0, storageDown = false;
  try {
    Object.assign(process.env, environment({ ORDERS_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      ORDERS_SUPABASE_SECRET_KEY: 'synthetic-storage-secret-unit-tests-only', LIORA_CHECKOUT_V2: 'false', LIORA_COUPONS_ENABLED: 'false', LIORA_ORDER_TRACKING_ENABLED: 'true' }));
    assert.equal(orders.trackingEnabled(), true); assert.equal(orders.enabled(), false); assert.equal(orders.couponsEnabled(), false);
    global.fetch = async (url) => {
      assert.match(url, /\/rpc\/liora_record_payment$/);
      if (storageDown) throw new Error('private storage error');
      return { ok: true, status: 200, json: async () => ({ recorded: true, status: 'approved' }) };
    };
    alerts.dispatchOrderAlert = async ({ orderId }) => { dispatches++; assert.equal(orderId, alert.order_id); throw new Error('private provider error'); };
    const warnings = []; console.warn = value => warnings.push(value);
    assert.deepEqual(await orders.recordPayment({ id: alert.order_id, environment: 'production', mode: 'live' }, {}), { recorded: true, status: 'approved' });
    assert.equal(dispatches, 1); assert.deepEqual(warnings, ['ORDER_ALERT_DISPATCH_DEFERRED']);
    process.env.WHATSAPP_ENABLED = 'false';
    await orders.recordPayment({ id: alert.order_id, environment: 'production', mode: 'live' }, {});
    process.env.WHATSAPP_ENABLED = 'true';
    await orders.recordPayment({ id: alert.order_id, environment: 'preview', mode: 'test' }, {});
    assert.equal(dispatches, 1);
    storageDown = true;
    await assert.rejects(orders.recordPayment({ id: alert.order_id, environment: 'production', mode: 'live' }, {}), { code: 'ORDER_STORAGE_UNAVAILABLE' });
    assert.equal(dispatches, 1);
  } finally {
    alerts.dispatchOrderAlert = originalDispatch; global.fetch = originalFetch; console.warn = originalWarn;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
