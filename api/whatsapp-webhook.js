'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { phoneNumber, ALERT_ID, MESSAGE_ID } = require('./_whatsapp');

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_STATUSES = 1000;
const STATUS = new Set(['sent', 'delivered', 'read', 'failed']);

function reject(code, status = 400) { const error = new Error(code); error.code = code; error.status = status; throw error; }
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
function header(req, key) { const value = req.headers?.[key]; return typeof value === 'string' ? value : ''; }

async function rawBody(req) {
  const length = header(req, 'content-length');
  if (length && (!/^\d{1,10}$/.test(length) || Number(length) > MAX_BODY_BYTES)) reject('WHATSAPP_BODY_TOO_LARGE', 413);
  if (typeof req[Symbol.asyncIterator] !== 'function') reject('WHATSAPP_RAW_BODY_REQUIRED');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) reject('WHATSAPP_RAW_BODY_REQUIRED');
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) reject('WHATSAPP_BODY_TOO_LARGE', 413);
    chunks.push(bytes);
  }
  if (size === 0) reject('WHATSAPP_BODY_INVALID');
  return Buffer.concat(chunks, size);
}

function verifiedUpdates(payload, config) {
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)
    || payload.entry.length > MAX_STATUSES) reject('WHATSAPP_PAYLOAD_INVALID');
  const updates = [], seen = new Set();
  let count = 0;
  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.changes) || entry.changes.length > MAX_STATUSES) reject('WHATSAPP_PAYLOAD_INVALID');
    for (const change of entry.changes) {
      if (change?.field !== 'messages') continue;
      const value = change.value;
      if (value?.metadata?.phone_number_id !== config.phoneNumberId) continue;
      if (value.statuses === undefined) continue; // Incoming messages are unrelated to order alerts.
      if (!Array.isArray(value.statuses)) reject('WHATSAPP_PAYLOAD_INVALID');
      for (const item of value.statuses) {
        if (++count > MAX_STATUSES) reject('WHATSAPP_PAYLOAD_INVALID');
        if (!item || !STATUS.has(item.status) || typeof item.id !== 'string' || !MESSAGE_ID.test(item.id)
          || typeof item.biz_opaque_callback_data !== 'string' || !ALERT_ID.test(item.biz_opaque_callback_data)
          || phoneNumber(item.recipient_id) !== config.recipient) continue;
        const key = `${item.biz_opaque_callback_data}:${item.id}:${item.status}`;
        if (seen.has(key)) continue;
        seen.add(key);
        updates.push({ alertId: item.biz_opaque_callback_data, messageId: item.id, status: item.status });
      }
    }
  }
  return updates;
}

function createHandler({ env = process.env, recordDelivery = update => require('./_order-alerts').recordDelivery(update) } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      if (env.VERCEL_ENV !== 'production') reject('WHATSAPP_ENVIRONMENT_MISMATCH', 503);
      if (req.method === 'GET') {
        const token = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
        if (typeof token !== 'string' || token.length < 16) reject('WHATSAPP_WEBHOOK_NOT_CONFIGURED', 503);
        const challenge = req.query?.['hub.challenge'];
        if (req.query?.['hub.mode'] !== 'subscribe' || typeof req.query?.['hub.verify_token'] !== 'string'
          || req.query['hub.verify_token'].length > 512 || !sameSecret(req.query['hub.verify_token'], token)
          || typeof challenge !== 'string' || !/^\d{1,200}$/.test(challenge)) reject('WHATSAPP_VERIFICATION_INVALID', 403);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(challenge);
      }

      // Keep accepting authenticated delivery reports when new sends are paused.
      // The sending token and WHATSAPP_ENABLED are intentionally irrelevant here.
      const secret = env.WHATSAPP_APP_SECRET;
      const config = { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, recipient: phoneNumber(env.WHATSAPP_ALERT_RECIPIENT) };
      if (typeof secret !== 'string' || secret.length < 16 || !/^\d{5,30}$/.test(config.phoneNumberId || '')
        || !config.recipient) reject('WHATSAPP_WEBHOOK_NOT_CONFIGURED', 503);
      const signature = header(req, 'x-hub-signature-256');
      if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) reject('WHATSAPP_SIGNATURE_INVALID', 401);
      if (!/^application\/json(?:\s*;|\s*$)/i.test(header(req, 'content-type'))) reject('WHATSAPP_CONTENT_TYPE_INVALID', 415);
      const raw = await rawBody(req);
      const expected = createHmac('sha256', secret).update(raw).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) reject('WHATSAPP_SIGNATURE_INVALID', 401);
      // Never reconstruct JSON before authentication; signatures cover original bytes.
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch { reject('WHATSAPP_PAYLOAD_INVALID'); }
      for (const update of verifiedUpdates(payload, config)) {
        const result = await recordDelivery(update);
        if (!result || typeof result.updated !== 'boolean') reject('WHATSAPP_STORAGE_UNAVAILABLE', 503);
      }
      return res.status(200).json({ received: true });
    } catch (error) {
      // Provider/customer payloads and underlying storage errors never reach clients or logs.
      const known = typeof error?.code === 'string' && error.code.startsWith('WHATSAPP_');
      return res.status(known ? error.status || 503 : 503).json({ code: known ? error.code : 'WHATSAPP_STORAGE_UNAVAILABLE' });
    }
  };
}

module.exports = createHandler();
module.exports.config = { api: { bodyParser: false } };
module.exports.createHandler = createHandler;
module.exports.MAX_BODY_BYTES = MAX_BODY_BYTES;
