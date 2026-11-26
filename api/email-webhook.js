'use strict';

const { emailAddress, webhookSecretBytes, verifyEmailSignature, UUID } = require('./_email');

const MAX_BODY_BYTES = 262144;
const EVENTS = new Set(['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.failed',
  'email.bounced', 'email.suppressed', 'email.complained']);

function reject(code, status = 400) { const error = new Error(code); error.code = code; error.status = status; throw error; }
function header(req, key) { const value = req.headers?.[key]; return typeof value === 'string' ? value : ''; }

async function rawBody(req) {
  const length = header(req, 'content-length');
  if (length && (!/^\d{1,10}$/.test(length) || Number(length) > MAX_BODY_BYTES)) reject('EMAIL_BODY_TOO_LARGE', 413);
  if (typeof req[Symbol.asyncIterator] !== 'function') reject('EMAIL_RAW_BODY_REQUIRED');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) reject('EMAIL_RAW_BODY_REQUIRED');
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) reject('EMAIL_BODY_TOO_LARGE', 413);
    chunks.push(bytes);
  }
  if (size === 0) reject('EMAIL_BODY_INVALID');
  return Buffer.concat(chunks, size);
}

function verifiedUpdate(payload, config) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.type !== 'string') reject('EMAIL_PAYLOAD_INVALID');
  if (!EVENTS.has(payload.type)) return null;
  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) reject('EMAIL_PAYLOAD_INVALID');
  // Resend echoes our exact From value and tags. Only this single configured
  // recipient and this separately persisted email alert may be updated.
  if (data.from !== `Liora <${config.from}>` || !Array.isArray(data.to) || data.to.length !== 1
    || emailAddress(data.to[0]) !== config.recipient || !UUID.test(data.email_id || '')
    || !data.tags || Array.isArray(data.tags) || data.tags.event !== 'payment_confirmed'
    || !UUID.test(data.tags.liora_alert_id || '')) return null;
  if (typeof payload.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(payload.created_at)
    || !Number.isFinite(Date.parse(payload.created_at))) reject('EMAIL_PAYLOAD_INVALID');
  return { alertId: data.tags.liora_alert_id, messageId: data.email_id,
    status: payload.type.slice(6), eventAt: payload.created_at };
}

function createHandler({ env = process.env, now = () => Date.now(),
  recordDelivery = update => require('./_email-alerts').recordEmailDelivery(update) } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      if (env.VERCEL_ENV !== 'production' || env.PAYMENT_MODE !== 'live') reject('EMAIL_ENVIRONMENT_MISMATCH', 503);
      // Pause flags and sending credentials do not disable authenticated receipts.
      const config = { from: emailAddress(env.EMAIL_ALERT_FROM), recipient: emailAddress(env.EMAIL_ALERT_RECIPIENT) };
      if (!config.from || !config.recipient || !webhookSecretBytes(env.RESEND_WEBHOOK_SECRET)) reject('EMAIL_WEBHOOK_NOT_CONFIGURED', 503);
      if (!/^application\/json(?:\s*;|\s*$)/i.test(header(req, 'content-type'))) reject('EMAIL_CONTENT_TYPE_INVALID', 415);
      const raw = await rawBody(req);
      if (!verifyEmailSignature(raw, req.headers || {}, env.RESEND_WEBHOOK_SECRET, now())) reject('EMAIL_SIGNATURE_INVALID', 401);
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch { reject('EMAIL_PAYLOAD_INVALID'); }
      const update = verifiedUpdate(payload, config);
      if (update) {
        const result = await recordDelivery(update);
        if (!result || typeof result.updated !== 'boolean') reject('EMAIL_STORAGE_UNAVAILABLE', 503);
      }
      return res.status(200).json({ received: true });
    } catch (error) {
      const known = typeof error?.code === 'string' && error.code.startsWith('EMAIL_');
      return res.status(known ? error.status || 503 : 503).json({ code: known ? error.code : 'EMAIL_STORAGE_UNAVAILABLE' });
    }
  };
}

module.exports = createHandler();
module.exports.config = { api: { bodyParser: false } };
module.exports.createHandler = createHandler;
module.exports.MAX_BODY_BYTES = MAX_BODY_BYTES;
