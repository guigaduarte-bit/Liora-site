'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { configuration, providerRequest, fail, respondError, responseHeaders } = require('./_payment');
const { validatePayment } = require('./_mp-validation');
const { checkInfinitePay } = require('./_infinitepay');
const orders = require('./_orders');

function verifySignature(req) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) fail('PAYMENT_WEBHOOK_NOT_CONFIGURED');
  const id = req.query?.['data.id'];
  const requestId = req.headers?.['x-request-id'];
  const signature = req.headers?.['x-signature'];
  if (typeof id !== 'string' || !/^\d{1,30}$/.test(id) || typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(requestId)
    || typeof signature !== 'string' || signature.length > 400) fail('WEBHOOK_SIGNATURE_INVALID', 'Notificação inválida.', 401);
  const parts = signature.split(',').map(s => s.trim());
  const ts = parts.find(s => s.startsWith('ts='))?.slice(3);
  const v1 = parts.find(s => s.startsWith('v1='))?.slice(3);
  if (parts.length !== 2 || !/^\d{10,13}$/.test(ts || '') || !/^[a-f0-9]{64}$/.test(v1 || '')) fail('WEBHOOK_SIGNATURE_INVALID', 'Notificação inválida.', 401);
  // Provider retries can arrive much later: deduplicate/reconcile in Postgres,
  // rather than rejecting a valid redelivery based on its age.
  const expected = createHmac('sha256', secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest();
  if (!timingSafeEqual(expected, Buffer.from(v1, 'hex'))) fail('WEBHOOK_SIGNATURE_INVALID', 'Notificação inválida.', 401);
  return id;
}

module.exports = async function handler(req, res) {
  responseHeaders(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Método não permitido' }); }
  try {
    // Keep receiving updates for existing orders if new V2 checkouts are paused.
    orders.settings();
    const provider = req.query?.provider;
    if (!['mercadopago', 'infinitepay'].includes(provider)) fail('WEBHOOK_PROVIDER_INVALID', 'Notificação inválida.', 400);
    const config = configuration(provider);
    let order, result;
    if (provider === 'mercadopago') {
      const id = verifySignature(req);
      const payment = await providerRequest(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${config.credential}` } });
      order = await orders.getOrder(payment.external_reference, config.environment);
      if (!order) return res.status(200).json({ received: true }); // Other integrations/legacy orders in this merchant account.
      if (order.provider !== provider) fail('PAYMENT_ORDER_MISMATCH', 'Notificação inválida.', 409);
      result = validatePayment(payment, orders.proofFor(order), id, order);
    } else {
      const body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
      order = await orders.getOrder(body?.order_nsu, config.environment);
      if (!order || order.provider !== provider) fail('WEBHOOK_ORDER_INVALID', 'Pedido não encontrado.', 400);
      // InfinitePay documents no signature. Never trust paid/status/amount in
      // its notification: query the merchant's payment_check API ourselves.
      result = await checkInfinitePay({ config, proof: orders.proofFor(order), transactionNsu: body.transaction_nsu, slug: body.invoice_slug });
    }
    await orders.recordPayment(order, result);
    return res.status(200).json({ received: true });
  } catch (error) {
    if (req.query?.provider === 'infinitepay') return res.status(400).json({ error: 'Notificação não confirmada; tente novamente.' }); // Documented retry status.
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Notificação inválida.' });
    return respondError(res, error);
  }
};
