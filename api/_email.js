'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ORDER_ID = /^LIORA-[A-Z0-9-]{10,80}$/;
const MAX_RESPONSE_BYTES = 65536;

function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || value !== value.trim() || /[\s\r\n<>(),;:\\"\[\]]/.test(value)) return null;
  const pieces = value.split('@');
  if (pieces.length !== 2 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/.test(pieces[0])
    || pieces[0].startsWith('.') || pieces[0].endsWith('.') || pieces[0].includes('..')) return null;
  const labels = pieces[1].split('.');
  if (labels.length < 2 || !labels.every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) return null;
  return `${pieces[0]}@${pieces[1].toLowerCase()}`;
}

function webhookSecretBytes(value) {
  if (typeof value !== 'string' || !/^whsec_[A-Za-z0-9+/]{22,256}={0,2}$/.test(value)) return null;
  const encoded = value.slice(6), bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 16 || bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) return null;
  return bytes;
}

// Private credentials are deliberately absent from this returned object.
function getOrderEmailConfig(env = process.env) {
  const config = { enabled: env.EMAIL_ALERTS_ENABLED === 'true',
    from: emailAddress(env.EMAIL_ALERT_FROM), recipient: emailAddress(env.EMAIL_ALERT_RECIPIENT) };
  const errors = [];
  if (env.VERCEL_ENV !== 'production' || env.PAYMENT_MODE !== 'live') errors.push('EMAIL_ENVIRONMENT_MISMATCH');
  if (!config.from) errors.push('EMAIL_FROM_REQUIRED');
  if (!config.recipient) errors.push('EMAIL_RECIPIENT_REQUIRED');
  if (typeof env.RESEND_API_KEY !== 'string' || env.RESEND_API_KEY.trim().length < 16
    || env.RESEND_API_KEY.length > 512 || /[\r\n]/.test(env.RESEND_API_KEY)) errors.push('EMAIL_API_KEY_REQUIRED');
  if (!webhookSecretBytes(env.RESEND_WEBHOOK_SECRET)) errors.push('EMAIL_WEBHOOK_SECRET_REQUIRED');
  return { ...config, valid: errors.length === 0, errors };
}

function htmlEscape(value) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function buildOrderEmailPayload(alert, order, config) {
  if (!alert || !UUID.test(alert.id || '') || !order || !ORDER_ID.test(order.id || '')
    || order.environment !== 'production' || order.mode !== 'live' || order.status !== 'approved'
    || alert.order_id !== order.id || alert.environment !== 'production'
    || !Number.isSafeInteger(order.total_cents) || order.total_cents <= 0
    || !Array.isArray(order.items) || order.items.length < 1 || order.items.length > 50
    || !emailAddress(config?.from) || !emailAddress(config?.recipient)) return null;
  const lines = [];
  for (const item of order.items) {
    if (!item || typeof item.name !== 'string' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 200) return null;
    const name = item.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!name) return null;
    lines.push(`${item.quantity} × ${name}`);
  }
  const total = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.total_cents / 100).replace(/\u00a0/g, ' ');
  const footer = 'Consulte o registro privado de pedidos para conferir os detalhes antes de iniciar a produção.';
  return {
    from: `Liora <${config.from}>`, to: [config.recipient],
    subject: `Venda confirmada na Liora — ${order.id}`,
    text: `Nova venda confirmada\n\nO pagamento deste pedido foi confirmado.\n\nPedido: ${order.id}\nTotal pago: ${total}\n\nProdutos\n${lines.join('\n')}\n\n${footer}`,
    html: '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
      + '<body style="margin:0;padding:28px 16px;background:#f5f1e9;color:#332e26;font-family:Arial,sans-serif">'
      + '<div style="max-width:560px;margin:auto;background:#fffdf8;border:1px solid #ddd1b9;border-radius:12px;padding:28px">'
      + '<p style="margin:0 0 24px;letter-spacing:5px;color:#887346;font-size:20px">LIORA</p>'
      + '<h1 style="font-size:25px;line-height:1.3;margin:0 0 12px">Nova venda confirmada</h1>'
      + '<p style="line-height:1.6">O pagamento deste pedido foi confirmado.</p>'
      + `<p style="line-height:1.6"><strong>Pedido</strong><br>${htmlEscape(order.id)}</p>`
      + `<p style="line-height:1.6"><strong>Total pago</strong><br><span style="font-size:24px">${htmlEscape(total)}</span></p>`
      + `<h2 style="font-size:16px;margin:24px 0 8px">Produtos</h2><ul style="padding-left:22px;line-height:1.8">${lines.map(line => `<li>${htmlEscape(line)}</li>`).join('')}</ul>`
      + `<p style="border-top:1px solid #e6dece;padding-top:20px;margin-top:24px;font-size:13px;line-height:1.6;color:#61594b">${footer}</p>`
      + '</div></body></html>',
    tags: [{ name: 'liora_alert_id', value: alert.id }, { name: 'event', value: 'payment_confirmed' }],
  };
}

async function readProviderResponse(response) {
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
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

async function sendOrderEmail(alert, order, { env = process.env, fetchImpl = global.fetch } = {}) {
  const config = getOrderEmailConfig(env);
  if (!config.enabled) return { status: 'failed', code: 'EMAIL_DISABLED' };
  if (!config.valid) return { status: 'failed', code: config.errors[0] };
  const payload = buildOrderEmailPayload(alert, order, config);
  if (!payload) return { status: 'failed', code: 'EMAIL_ORDER_INVALID' };
  if (typeof fetchImpl !== 'function') return { status: 'failed', code: 'EMAIL_TRANSPORT_UNAVAILABLE' };
  let response, body;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(7000),
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json',
        'Idempotency-Key': `liora-sale-email/${alert.id}` }, body: JSON.stringify(payload),
    });
    body = await readProviderResponse(response);
  } catch {
    // An ambiguous send remains quarantined even though Resend also deduplicates
    // matching requests for 24 hours. No automatic retry may outlive that window.
    return { status: 'unknown', code: 'EMAIL_ACK_UNKNOWN' };
  }
  if (response.ok && UUID.test(body?.id || '')) return { status: 'accepted', messageId: body.id };
  if (response.status === 429) return { status: 'retryable', code: 'EMAIL_RATE_LIMITED' };
  if (response.status === 409 && body?.name === 'concurrent_idempotent_requests') return { status: 'unknown', code: 'EMAIL_REQUEST_IN_PROGRESS' };
  if (response.status >= 400 && response.status < 500) return { status: 'failed', code: `EMAIL_HTTP_${response.status}` };
  return { status: 'unknown', code: 'EMAIL_ACK_UNKNOWN' };
}

// Svix's documented signature: HMAC-SHA256(base64 secret, id.timestamp.rawBody).
// A fresh attempt timestamp permits provider retries, while the database makes
// delivery updates idempotent and never re-sends from a callback.
function verifyEmailSignature(raw, headers, secret, now = Date.now()) {
  const key = webhookSecretBytes(secret), id = headers['svix-id'], timestamp = headers['svix-timestamp'], signatures = headers['svix-signature'];
  if (!key || !Buffer.isBuffer(raw) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)
    || typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp) || typeof signatures !== 'string'
    || signatures.length > 4096 || !Number.isFinite(now) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest();
  return signatures.split(' ').some(signature => {
    if (!/^v1,[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
    const received = Buffer.from(signature.slice(3), 'base64');
    return received.length === expected.length && timingSafeEqual(expected, received);
  });
}

module.exports = { getOrderEmailConfig, buildOrderEmailPayload, sendOrderEmail, verifyEmailSignature,
  emailAddress, webhookSecretBytes, UUID, ORDER_ID };
