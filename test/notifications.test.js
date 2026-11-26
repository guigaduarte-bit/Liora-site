'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationDispatcher } = require('../api/_notifications');

test('only explicitly enabled notification channels run, with no implicit recipient or channel fallback', async () => {
  const calls = [];
  const env = { EMAIL_ALERTS_ENABLED: 'false', WHATSAPP_ENABLED: 'false' };
  const dispatch = createNotificationDispatcher({ env,
    email: async options => { calls.push(['email', options]); return { status: 'accepted' }; },
    whatsapp: async options => { calls.push(['whatsapp', options]); return { status: 'accepted' }; },
  });
  assert.deepEqual(await dispatch(), { status: 'disabled' });
  assert.deepEqual(calls, []);
  env.EMAIL_ALERTS_ENABLED = 'true';
  const options = { orderId: 'LIORA-TEST-12345678' };
  assert.deepEqual(await dispatch(options), { status: 'accepted' });
  assert.deepEqual(calls, [['email', options]]);
});

test('channels start in parallel and an unavailable channel does not prevent the other from finishing', async () => {
  const started = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const dispatch = createNotificationDispatcher({ env: { EMAIL_ALERTS_ENABLED: 'true', WHATSAPP_ENABLED: 'true' },
    email: async () => { started.push('email'); await gate; return { status: 'accepted' }; },
    whatsapp: async () => { started.push('whatsapp'); await gate; throw new Error('private provider details'); },
  });
  const pending = dispatch();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started.sort(), ['email', 'whatsapp']);
  release();
  assert.deepEqual(await pending, { status: 'unavailable' });
});

test('malformed channel responses do not leak details or appear successful', async () => {
  for (const response of [undefined, {}, { status: 'private response' }, { status: 'unavailable', code: 'private key' }]) {
    const dispatch = createNotificationDispatcher({ env: { EMAIL_ALERTS_ENABLED: 'true' }, email: async () => response });
    assert.deepEqual(await dispatch(), { status: 'unavailable' });
  }
  const dispatch = createNotificationDispatcher({ env: { EMAIL_ALERTS_ENABLED: 'true', WHATSAPP_ENABLED: 'true' },
    email: async () => ({ status: 'empty' }), whatsapp: async () => ({ status: 'accepted' }) });
  assert.deepEqual(await dispatch(), { status: 'processed' });
});

test('email dispatch follows the committed, verified production payment and cannot undo it', async () => {
  const orders = require('../api/_orders'), email = require('../api/_email-alerts');
  const originalEnv = { ...process.env }, originalFetch = global.fetch;
  const originalDispatch = email.dispatchOrderEmail, originalWarn = console.warn;
  const order = { id: 'LIORA-TEST-12345678', environment: 'production', mode: 'live' };
  let recorded = { recorded: true, status: 'approved' }, storageDown = false;
  const events = [], warnings = [];
  try {
    Object.assign(process.env, {
      EMAIL_ALERTS_ENABLED: 'true', WHATSAPP_ENABLED: 'false',
      ORDERS_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      ORDERS_SUPABASE_SECRET_KEY: 'synthetic-storage-secret-unit-tests-only',
    });
    global.fetch = async url => {
      assert.match(url, /\/rpc\/liora_record_payment$/);
      if (storageDown) throw new Error('private database failure');
      events.push('payment committed');
      return { ok: true, status: 200, json: async () => recorded };
    };
    email.dispatchOrderEmail = async ({ orderId }) => {
      assert.equal(orderId, order.id);
      events.push('email attempted');
      throw new Error('private email credential');
    };
    console.warn = value => warnings.push(value);
    assert.deepEqual(await orders.recordPayment(order, {}), recorded);
    assert.deepEqual(events, ['payment committed', 'email attempted']);
    assert.deepEqual(warnings, ['ORDER_ALERT_DISPATCH_DEFERRED']);

    events.length = 0;
    for (const status of ['pending', 'review_required', 'refunded']) {
      recorded = { recorded: true, status };
      await orders.recordPayment(order, {});
    }
    recorded = { recorded: false, status: 'approved' };
    await orders.recordPayment(order, {});
    recorded = { recorded: true, status: 'approved' };
    await orders.recordPayment({ ...order, environment: 'preview' }, {});
    await orders.recordPayment({ ...order, mode: 'test' }, {});
    process.env.EMAIL_ALERTS_ENABLED = 'false';
    await orders.recordPayment(order, {});
    assert.ok(events.every(event => event === 'payment committed'));

    process.env.EMAIL_ALERTS_ENABLED = 'true';
    events.length = 0;
    storageDown = true;
    await assert.rejects(orders.recordPayment(order, {}), { code: 'ORDER_STORAGE_UNAVAILABLE' });
    assert.deepEqual(events, []);
  } finally {
    email.dispatchOrderEmail = originalDispatch; global.fetch = originalFetch; console.warn = originalWarn;
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});
