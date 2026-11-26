'use strict';

const { getOrderEmailConfig, sendOrderEmail, UUID, ORDER_ID } = require('./_email');

const STATES = new Set(['queued', 'sending', 'accepted', 'delivered', 'failed', 'unknown']);
const DELIVERY = new Set(['sent', 'delivered', 'delivery_delayed', 'failed', 'bounced', 'suppressed', 'complained']);
const RETRY_SECONDS = [60, 300, 900, 3600];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function safeCode(code) { return typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code) ? code : 'EMAIL_ACK_UNKNOWN'; }
function resultShape(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.updated === 'boolean'
    && (value.status === undefined || STATES.has(value.status));
}
function timestamp(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function createEmailAlertStore({ env = process.env, request = (...args) => require('./_orders').storageRequest(...args),
  send = sendOrderEmail, now = () => Date.now() } = {}) {
  async function rpc(name, body) { return request(`rpc/${name}`, { method: 'POST', body }); }

  async function dispatchOrderEmail({ orderId = null } = {}) {
    const config = getOrderEmailConfig(env);
    if (!config.enabled) return { status: 'disabled' };
    const start = timestamp(env.EMAIL_ALERTS_START_AT);
    if (!config.valid || !start) return { status: 'unavailable', code: config.errors[0] || 'EMAIL_ACTIVATION_REQUIRED' };
    if (orderId !== null && (typeof orderId !== 'string' || !ORDER_ID.test(orderId))) fail('EMAIL_ALERT_ID_INVALID');
    const alert = await rpc('liora_claim_order_email', { p_activation_start: start, p_order_id: orderId });
    if (alert === null) return { status: 'empty' };
    if (!alert || !UUID.test(alert.id || '') || !UUID.test(alert.claim_token || '')
      || !ORDER_ID.test(alert.order_id || '') || (orderId !== null && alert.order_id !== orderId)
      || alert.environment !== 'production' || alert.event_type !== 'payment_confirmed'
      || !Number.isInteger(alert.attempts) || alert.attempts < 1 || alert.attempts > 5) fail('EMAIL_ALERT_STORAGE_INVALID');

    const order = { id: alert.order_id, environment: 'production', mode: 'live', status: 'approved',
      total_cents: alert.total_cents, items: alert.items };
    let outcome;
    try { outcome = await send(alert, order, { env }); }
    catch { outcome = { status: 'unknown', code: 'EMAIL_ACK_UNKNOWN' }; }

    let state = 'unknown', messageId = null, code = 'EMAIL_ACK_UNKNOWN', retryAt = null;
    if (outcome?.status === 'accepted' && UUID.test(outcome.messageId || '')) {
      state = 'accepted'; messageId = outcome.messageId; code = null;
    } else if (outcome?.status === 'failed') {
      state = 'failed'; code = safeCode(outcome.code);
    } else if (outcome?.status === 'retryable') {
      state = alert.attempts < 5 ? 'queued' : 'failed';
      code = state === 'queued' ? safeCode(outcome.code) : 'ATTEMPT_LIMIT_REACHED';
      if (state === 'queued') retryAt = new Date(now() + RETRY_SECONDS[alert.attempts - 1] * 1000).toISOString();
    }
    const result = await rpc('liora_finish_order_email', {
      p_alert_id: alert.id, p_claim_token: alert.claim_token, p_state: state,
      p_provider_email_id: messageId, p_error_code: code, p_retry_at: retryAt,
    });
    if (!resultShape(result)) fail('EMAIL_ALERT_STORAGE_INVALID');
    return { status: result.status || state, updated: result.updated };
  }

  async function recordEmailDelivery({ alertId, messageId, status, eventAt } = {}) {
    const eventTime = timestamp(eventAt);
    if (!UUID.test(alertId || '') || !UUID.test(messageId || '') || !DELIVERY.has(status) || !eventTime) fail('EMAIL_ALERT_DELIVERY_INVALID');
    const result = await rpc('liora_update_order_email_delivery', {
      p_alert_id: alertId, p_provider_email_id: messageId, p_delivery_status: status, p_event_at: eventAt,
    });
    if (!resultShape(result)) fail('EMAIL_ALERT_STORAGE_INVALID');
    return result;
  }

  return { dispatchOrderEmail, recordEmailDelivery };
}

module.exports = { ...createEmailAlertStore(), createEmailAlertStore };
