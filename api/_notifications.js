'use strict';

const STATUSES = new Set(['disabled', 'unavailable', 'empty', 'queued', 'accepted', 'delivered', 'read', 'failed', 'unknown']);

// Each channel has its own durable queue. A failure in one channel must not
// prevent the other from running, or undo the already committed payment.
function createNotificationDispatcher({ env = process.env,
  whatsapp = options => require('./_order-alerts').dispatchOrderAlert(options),
  email = options => require('./_email-alerts').dispatchOrderEmail(options) } = {}) {
  return async function dispatchOrderNotifications(options = {}) {
    const jobs = [];
    if (env.WHATSAPP_ENABLED === 'true') jobs.push(() => whatsapp(options));
    if (env.EMAIL_ALERTS_ENABLED === 'true') jobs.push(() => email(options));
    if (!jobs.length) return { status: 'disabled' };

    const outcomes = await Promise.allSettled(jobs.map(job => Promise.resolve().then(job)));
    const statuses = outcomes.map(outcome => outcome.status === 'fulfilled' && STATUSES.has(outcome.value?.status)
      ? outcome.value.status : 'unavailable');
    if (statuses.includes('unavailable')) return { status: 'unavailable' };
    return { status: statuses.length === 1 ? statuses[0] : 'processed' };
  };
}

module.exports = { dispatchOrderNotifications: createNotificationDispatcher(), createNotificationDispatcher };
