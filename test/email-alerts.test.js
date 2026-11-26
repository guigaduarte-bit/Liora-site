'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { createEmailAlertStore } = require('../api/_email-alerts');

const alert = { id: randomUUID(), claim_token: randomUUID(), order_id: 'LIORA-EMAIL-12345678',
  attempts: 1, environment: 'production', event_type: 'payment_confirmed', total_cents: 9590,
  items: [{ name: 'Produto', quantity: 2 }], confirmed_at: '2026-11-26T19:00:00Z' };
const messageId = randomUUID();
const environment = overrides => ({ VERCEL_ENV: 'production', PAYMENT_MODE: 'live', EMAIL_ALERTS_ENABLED: 'true',
  EMAIL_ALERT_FROM: 'vendas@example.com', EMAIL_ALERT_RECIPIENT: 'owner@example.net',
  RESEND_API_KEY: `synthetic-test-${randomBytes(16).toString('hex')}`, RESEND_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString('base64')}`,
  EMAIL_ALERTS_START_AT: '2026-11-26T16:00:00-03:00', ...overrides });

function fixture({ env = environment(), claimed = alert, outcome = { status: 'accepted', messageId }, finish, sendError } = {}) {
  const calls = [], sends = [];
  const store = createEmailAlertStore({ env, now: () => Date.parse('2026-11-26T19:30:00Z'),
    request: async (path, options) => {
      calls.push({ path, ...options });
      if (path.endsWith('liora_claim_order_email')) return claimed;
      if (path.endsWith('liora_finish_order_email')) return finish || { updated: true, status: options.body.p_state };
      if (path.endsWith('liora_update_order_email_delivery')) return { updated: true, status: 'delivered' };
      assert.fail('Unexpected RPC');
    },
    send: async (...args) => { sends.push(args); if (sendError) throw new Error('private send failure'); return outcome; },
  });
  return { ...store, calls, sends };
}

test('inactive or incomplete email settings never claim or consume an attempt', async () => {
  for (const changes of [{ EMAIL_ALERTS_ENABLED: 'false' }, { EMAIL_ALERT_RECIPIENT: '' }, { EMAIL_ALERT_FROM: '' },
    { RESEND_API_KEY: '' }, { RESEND_WEBHOOK_SECRET: '' }, { VERCEL_ENV: 'preview' }, { PAYMENT_MODE: 'test' },
    { EMAIL_ALERTS_START_AT: '' }, { EMAIL_ALERTS_START_AT: '2026-11-26T19:00:00' }]) {
    const f = fixture({ env: environment(changes) });
    assert.ok(['disabled', 'unavailable'].includes((await f.dispatchOrderEmail()).status));
    assert.equal(f.calls.length, 0); assert.equal(f.sends.length, 0);
  }
});

test('email claim is separately scoped to activation and optional order, never to WhatsApp', async () => {
  const f = fixture({ claimed: null });
  assert.deepEqual(await f.dispatchOrderEmail({ orderId: alert.order_id }), { status: 'empty' });
  assert.equal(f.calls[0].path, 'rpc/liora_claim_order_email');
  assert.deepEqual(f.calls[0].body, { p_activation_start: '2026-11-26T19:00:00.000Z', p_order_id: alert.order_id });
  assert.equal(f.sends.length, 0);
  await assert.rejects(f.dispatchOrderEmail({ orderId: 'invalid' }), { code: 'EMAIL_ALERT_ID_INVALID' });
});

test('email ACK is persisted with lease token and passes only minimal paid order data', async () => {
  const f = fixture({ claimed: { ...alert, customer: { email: 'private@example.test', cpf: 'PRIVATE_CPF' } } });
  assert.deepEqual(await f.dispatchOrderEmail(), { status: 'accepted', updated: true });
  assert.deepEqual(f.sends[0][1], { id: alert.order_id, environment: 'production', mode: 'live', status: 'approved', total_cents: 9590, items: alert.items });
  assert.deepEqual(f.calls[1].body, { p_alert_id: alert.id, p_claim_token: alert.claim_token, p_state: 'accepted',
    p_provider_email_id: messageId, p_error_code: null, p_retry_at: null });
});

test('definite rate refusals back off at bounded intervals and stop after five attempts', async () => {
  for (const [attempts, retryAt] of [[1, '2026-11-26T19:31:00.000Z'], [2, '2026-11-26T19:35:00.000Z'],
    [3, '2026-11-26T19:45:00.000Z'], [4, '2026-11-26T20:30:00.000Z'], [5, null]]) {
    const f = fixture({ claimed: { ...alert, attempts }, outcome: { status: 'retryable', code: 'EMAIL_RATE_LIMITED' } });
    assert.equal((await f.dispatchOrderEmail()).status, attempts < 5 ? 'queued' : 'failed');
    assert.equal(f.calls[1].body.p_retry_at, retryAt);
  }
});

test('ambiguous email acknowledgements stay unknown without retries, and private errors are sanitized', async () => {
  for (const settings of [{ sendError: true }, { outcome: { status: 'unknown', code: 'EMAIL_ACK_UNKNOWN' } },
    { outcome: { status: 'accepted', messageId: 'wamid.wrong-channel' } }]) {
    const f = fixture(settings);
    assert.equal((await f.dispatchOrderEmail()).status, 'unknown');
    assert.equal(f.calls[1].body.p_retry_at, null); assert.equal(f.calls[1].body.p_provider_email_id, null);
  }
  const f = fixture({ outcome: { status: 'failed', code: 'private recipient address' } });
  assert.equal((await f.dispatchOrderEmail()).status, 'failed');
  assert.equal(f.calls[1].body.p_error_code, 'EMAIL_ACK_UNKNOWN');
});

test('bad claims never send and a callback winning the ACK race stays delivered', async () => {
  for (const changes of [{ id: '' }, { claim_token: '' }, { event_type: 'different' }, { environment: 'preview' }, { attempts: 6 }]) {
    const f = fixture({ claimed: { ...alert, ...changes } });
    await assert.rejects(f.dispatchOrderEmail(), { code: 'EMAIL_ALERT_STORAGE_INVALID' });
    assert.equal(f.sends.length, 0);
  }
  assert.deepEqual(await fixture({ finish: { updated: false, status: 'delivered' } }).dispatchOrderEmail(), { updated: false, status: 'delivered' });
});

test('email delivery rejects WhatsApp identities and retains provider fractional timestamp for ordering', async () => {
  const f = fixture(), eventAt = '2026-11-26T19:00:01.123456Z';
  await assert.rejects(f.recordEmailDelivery({ alertId: alert.id, messageId: 'wamid.wrong', status: 'delivered', eventAt }), { code: 'EMAIL_ALERT_DELIVERY_INVALID' });
  await assert.rejects(f.recordEmailDelivery({ alertId: alert.id, messageId, status: 'read', eventAt }), { code: 'EMAIL_ALERT_DELIVERY_INVALID' });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.recordEmailDelivery({ alertId: alert.id, messageId, status: 'delivered', eventAt }), { updated: true, status: 'delivered' });
  assert.deepEqual(f.calls[0].body, { p_alert_id: alert.id, p_provider_email_id: messageId, p_delivery_status: 'delivered', p_event_at: eventAt });
});
