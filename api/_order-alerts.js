'use strict';

const { getWhatsAppConfig, sendOrderAlert, ALERT_ID, MESSAGE_ID } = require('./_whatsapp');

const ORDER_ID = /^LIORA-[A-Z0-9-]{10,80}$/;
const STATES = new Set(['queued', 'sending', 'accepted', 'delivered', 'failed', 'unknown']);
const DELIVERY = new Set(['sent', 'delivered', 'read', 'failed']);
const RETRY_SECONDS = [60, 300, 900, 3600];

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function safeCode(code) { return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'WHATSAPP_ACK_UNKNOWN'; }
function resultShape(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.updated === 'boolean'
    && (value.status === undefined || STATES.has(value.status));
}
function activationStart(env) {
  const value = env.WHATSAPP_ALERTS_START_AT;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function createAlertStore({ env = process.env, request = (...args) => require('./_orders').storageRequest(...args),
  send = sendOrderAlert, now = () => Date.now() } = {}) {
  async function rpc(name, body) { return request(`rpc/${name}`, { method: 'POST', body }); }

  async function dispatchOrderAlert({ orderId = null } = {}) {
    const config = getWhatsAppConfig(env);
    if (!config.enabled) return { status: 'disabled' };
    const start = activationStart(env);
    // Validate before claiming: missing credentials must not consume attempts.
    if (!config.valid || !start) return { status: 'unavailable', code: config.errors[0] || 'WHATSAPP_ACTIVATION_REQUIRED' };
    if (orderId !== null && (typeof orderId !== 'string' || !ORDER_ID.test(orderId))) fail('ORDER_ALERT_ID_INVALID');
    const alert = await rpc('liora_claim_order_alert', { p_activation_start: start, p_order_id: orderId });
    if (alert === null) return { status: 'empty' };
    if (!alert || !ALERT_ID.test(alert.id || '') || !ALERT_ID.test(alert.claim_token || '')
      || !ORDER_ID.test(alert.order_id || '') || (orderId !== null && alert.order_id !== orderId)
      || alert.environment !== 'production' || alert.event_type !== 'payment_confirmed'
      || !Number.isInteger(alert.attempts) || alert.attempts < 1 || alert.attempts > 5) fail('ORDER_ALERT_STORAGE_INVALID');

    // Only the private claim RPC supplies these values. Customer/contact data
    // never enters the WhatsApp adapter or its callback correlation field.
    const order = { id: alert.order_id, environment: 'production', mode: 'live', status: 'approved',
      total_cents: alert.total_cents, items: alert.items };
    let outcome;
    try { outcome = await send(alert, order, { env }); }
    catch { outcome = { status: 'unknown', code: 'WHATSAPP_ACK_UNKNOWN' }; }

    let state = 'unknown', messageId = null, code = 'WHATSAPP_ACK_UNKNOWN', retryAt = null;
    if (outcome?.status === 'accepted' && MESSAGE_ID.test(outcome.messageId || '')) {
      state = 'accepted'; messageId = outcome.messageId; code = null;
    } else if (outcome?.status === 'failed') {
      state = 'failed'; code = safeCode(outcome.code);
    } else if (outcome?.status === 'retryable') {
      state = alert.attempts < 5 ? 'queued' : 'failed';
      code = state === 'queued' ? safeCode(outcome.code) : 'ATTEMPT_LIMIT_REACHED';
      if (state === 'queued') retryAt = new Date(now() + RETRY_SECONDS[alert.attempts - 1] * 1000).toISOString();
    }
    const result = await rpc('liora_finish_order_alert', {
      p_alert_id: alert.id, p_claim_token: alert.claim_token, p_state: state,
      p_provider_message_id: messageId, p_error_code: code, p_retry_at: retryAt,
    });
    if (!resultShape(result)) fail('ORDER_ALERT_STORAGE_INVALID');
    // A signed delivery callback may have won the race with the HTTP ACK.
    return { status: result.status || state, updated: result.updated };
  }

  async function recordDelivery({ alertId, messageId, status } = {}) {
    if (!ALERT_ID.test(alertId || '') || !MESSAGE_ID.test(messageId || '') || !DELIVERY.has(status)) fail('ORDER_ALERT_DELIVERY_INVALID');
    const result = await rpc('liora_update_order_alert_delivery', {
      p_alert_id: alertId, p_provider_message_id: messageId, p_delivery_status: status,
    });
    if (!resultShape(result)) fail('ORDER_ALERT_STORAGE_INVALID');
    return result;
  }

  return { dispatchOrderAlert, recordDelivery };
}

module.exports = { ...createAlertStore(), createAlertStore };
