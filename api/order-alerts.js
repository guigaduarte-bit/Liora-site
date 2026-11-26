'use strict';

const { timingSafeEqual } = require('node:crypto');

function authorized(req, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512 || /[\r\n]/.test(secret)) return false;
  const supplied = req.headers?.authorization;
  if (typeof supplied !== 'string' || supplied.length > 1024) return false;
  const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(supplied);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function createHandler({ env = process.env, dispatch = () => require('./_notifications').dispatchOrderNotifications() } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
    }
    if (!authorized(req, env.CRON_SECRET)) return res.status(401).json({ code: 'UNAUTHORIZED' });
    if (env.VERCEL_ENV !== 'production' || env.PAYMENT_MODE !== 'live') return res.status(503).json({ code: 'ORDER_ALERT_ENVIRONMENT_MISMATCH' });
    try {
      // One item per enabled channel bounds execution. Independent database
      // leases protect parallel workers; the request cannot select an order.
      const result = await dispatch();
      if (!result || typeof result.status !== 'string') throw new Error('invalid');
      return res.status(result.status === 'unavailable' ? 503 : 200).json({ status: result.status });
    } catch {
      return res.status(503).json({ code: 'ORDER_ALERT_STORAGE_UNAVAILABLE' });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
