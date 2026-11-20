'use strict';

const MAX_ITEMS_TEXT = 300;
const MAX_RESPONSE_BYTES = 65536;
const ALERT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ORDER_ID = /^LIORA-[A-Z0-9-]{10,80}$/;
const MESSAGE_ID = /^wamid\.[A-Za-z0-9_+/=.-]{1,500}$/;
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80007, 130429, 131000, 131016, 131056, 131057]);

function phoneNumber(value) {
  if (typeof value !== 'string') return null;
  const digits = value.trim().replace(/^\+/, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

function isWhatsAppEnabled(env = process.env) { return env.WHATSAPP_ENABLED === 'true'; }

// Deliberately returns no access token or app secret, including on errors.
function getWhatsAppConfig(env = process.env) {
  const config = {
    enabled: isWhatsAppEnabled(env),
    apiVersion: env.WHATSAPP_API_VERSION || 'v27.0',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    senderNumber: phoneNumber(env.WHATSAPP_SENDER_NUMBER),
    recipient: phoneNumber(env.WHATSAPP_ALERT_RECIPIENT),
    templateName: env.WHATSAPP_ORDER_TEMPLATE || '',
    language: env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR',
  };
  const errors = [];
  if (env.VERCEL_ENV !== 'production' || env.PAYMENT_MODE !== 'live') errors.push('WHATSAPP_ENVIRONMENT_MISMATCH');
  if (!/^v\d{1,3}\.\d{1,2}$/.test(config.apiVersion)) errors.push('WHATSAPP_API_VERSION_INVALID');
  if (!/^\d{5,30}$/.test(config.phoneNumberId)) errors.push('WHATSAPP_PHONE_NUMBER_ID_REQUIRED');
  if (!config.senderNumber) errors.push('WHATSAPP_SENDER_NUMBER_REQUIRED');
  if (!config.recipient) errors.push('WHATSAPP_RECIPIENT_REQUIRED');
  if (config.senderNumber && config.senderNumber === config.recipient) errors.push('WHATSAPP_SENDER_EQUALS_RECIPIENT');
  if (typeof env.WHATSAPP_ACCESS_TOKEN !== 'string' || !env.WHATSAPP_ACCESS_TOKEN.trim()
    || /[\r\n]/.test(env.WHATSAPP_ACCESS_TOKEN)) errors.push('WHATSAPP_ACCESS_TOKEN_REQUIRED');
  if (typeof env.WHATSAPP_APP_SECRET !== 'string' || env.WHATSAPP_APP_SECRET.trim().length < 16)
    errors.push('WHATSAPP_APP_SECRET_REQUIRED');
  if (typeof env.WHATSAPP_WEBHOOK_VERIFY_TOKEN !== 'string' || env.WHATSAPP_WEBHOOK_VERIFY_TOKEN.trim().length < 16)
    errors.push('WHATSAPP_WEBHOOK_VERIFY_TOKEN_REQUIRED');
  if (!/^[a-z0-9_]{1,512}$/.test(config.templateName)) errors.push('WHATSAPP_TEMPLATE_REQUIRED');
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(config.language)) errors.push('WHATSAPP_TEMPLATE_LANGUAGE_INVALID');
  return { ...config, valid: errors.length === 0, errors };
}

function itemSummary(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) return null;
  const parts = [];
  for (const item of items) {
    // Names are product names from the private order snapshot. Customer fields,
    // fragrance/customization text and arbitrary serialized objects never enter this payload.
    if (!item || typeof item.name !== 'string' || !Number.isInteger(item.quantity)
      || item.quantity < 1 || item.quantity > 200) return null;
    const name = item.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    parts.push(`${item.quantity}x ${name.slice(0, 100)}`);
  }
  const summary = parts.join('; ');
  return summary.length > MAX_ITEMS_TEXT ? `${summary.slice(0, MAX_ITEMS_TEXT - 1).trimEnd()}…` : summary;
}

function buildOrderAlertPayload(alert, order, config) {
  if (!alert || typeof alert.id !== 'string' || !ALERT_ID.test(alert.id)) return null;
  if (!order || typeof order.id !== 'string' || !ORDER_ID.test(order.id) || order.environment !== 'production'
    || order.mode !== 'live' || order.status !== 'approved'
    || (alert.order_id && alert.order_id !== order.id)
    || (alert.environment && alert.environment !== 'production')
    || !Number.isSafeInteger(order.total_cents) || order.total_cents <= 0) return null;
  const summary = itemSummary(order.items);
  if (!summary) return null;
  const total = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(order.total_cents / 100).replace(/\u00a0/g, ' ');
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: config.recipient,
    type: 'template',
    template: {
      name: config.templateName, language: { code: config.language },
      components: [{ type: 'body', parameters: [order.id, total, summary].map(text => ({ type: 'text', text })) }],
    },
    biz_opaque_callback_data: alert.id,
  };
}

function failure(status, code) { return { status, code }; }

async function readProviderResponse(response) {
  // A malformed/oversized acknowledgement cannot prove whether a send occurred.
  if (Number(response.headers?.get?.('content-length')) > MAX_RESPONSE_BYTES) return null;
  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); return null; }
        chunks.push(Buffer.from(value));
      }
      text = Buffer.concat(chunks, size).toString('utf8');
    } finally { reader.releaseLock(); }
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return null;
  }
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch { return null; }
}

async function sendOrderAlert(alert, order, { env = process.env, fetchImpl = global.fetch } = {}) {
  const config = getWhatsAppConfig(env);
  if (!config.enabled) return failure('failed', 'WHATSAPP_DISABLED');
  if (!config.valid) return failure('failed', config.errors[0]);
  const payload = buildOrderAlertPayload(alert, order || alert?.payload, config);
  if (!payload) return failure('failed', 'WHATSAPP_ORDER_INVALID');
  if (typeof fetchImpl !== 'function') return failure('failed', 'WHATSAPP_TRANSPORT_UNAVAILABLE');

  let response, body;
  try {
    response = await fetchImpl(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`, {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(7000),
    });
    body = await readProviderResponse(response);
  } catch {
    // Never log provider responses, tokens, recipient numbers or order contents.
    // A timeout can occur after Meta accepted the message: do not blindly resend.
    return failure('unknown', 'WHATSAPP_ACK_UNKNOWN');
  }

  if (body?.error && typeof body.error === 'object') {
    const code = Number.isSafeInteger(body.error.code) && body.error.code >= 0 ? body.error.code : null;
    if (code === null) return failure('unknown', 'WHATSAPP_ACK_UNKNOWN');
    const retryable = TRANSIENT_CODES.has(code) || body.error.is_transient === true;
    return failure(retryable ? 'retryable' : 'failed', `WHATSAPP_PROVIDER_${code}`);
  }
  if (!response.ok) {
    if (response.status === 429) return failure('retryable', 'WHATSAPP_RATE_LIMITED');
    if (response.status >= 400 && response.status < 500) return failure('failed', `WHATSAPP_HTTP_${response.status}`);
    return failure('unknown', 'WHATSAPP_ACK_UNKNOWN');
  }
  const message = Array.isArray(body?.messages) && body.messages.length === 1 ? body.messages[0] : null;
  if (!message || typeof message.id !== 'string' || !MESSAGE_ID.test(message.id)) return failure('unknown', 'WHATSAPP_ACK_UNKNOWN');
  // HTTP acceptance is not delivery. Only authenticated status callbacks can
  // promote this to sent/delivered/read.
  return { status: 'accepted', messageId: message.id };
}

module.exports = {
  getWhatsAppConfig, isWhatsAppEnabled, sendOrderAlert, buildOrderAlertPayload,
  phoneNumber, ALERT_ID, MESSAGE_ID, MAX_ITEMS_TEXT,
};
