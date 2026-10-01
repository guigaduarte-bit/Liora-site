'use strict';

const { configuration, verifyProof, providerRequest, fail, respondError, responseHeaders } = require('./_payment');
const STATUSES = new Set(['approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'refunded', 'charged_back', 'in_mediation']);

module.exports = async function handler(req, res) {
  responseHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido' });
  }
  try {
    const config = configuration('mercadopago');
    const proof = verifyProof(req, 'mercadopago', config);
    const paymentId = req.query && req.query.payment_id;
    const orderId = req.query && req.query.order_id;
    if (typeof paymentId !== 'string' || !/^\d{1,30}$/.test(paymentId) || orderId !== proof.orderId) {
      fail('PAYMENT_IDENTIFICATION_INVALID', 'Identificação do pagamento inválida.', 400);
    }
    const payment = await providerRequest(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${config.credential}` }
    });
    const amount = payment.transaction_amount;
    if (!STATUSES.has(payment.status) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0
      || !Number.isSafeInteger(Math.round(amount * 100)) || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001
      || typeof payment.live_mode !== 'boolean' || typeof payment.currency_id !== 'string') {
      fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível validar a resposta do pagamento.', 502);
    }
    if (String(payment.id) !== paymentId || payment.external_reference !== proof.orderId
      || Math.round(amount * 100) !== proof.totalCents || payment.currency_id !== proof.currency
      || payment.live_mode !== (proof.mode === 'live')) {
      fail('PAYMENT_ORDER_MISMATCH', 'O pagamento não corresponde aos dados deste pedido.', 409);
    }
    const methodMatches = proof.method === 'pix'
      ? payment.payment_method_id === 'pix'
      : payment.payment_type_id === (proof.method === 'card' ? 'credit_card' : 'ticket');
    if (!methodMatches) fail('PAYMENT_METHOD_MISMATCH', 'O meio de pagamento precisa ser conferido pela loja antes de confirmar o pedido.', 409);
    return res.status(200).json({ payment_id: paymentId, order_id: proof.orderId, status: payment.status, payment_mode: proof.mode });
  } catch (error) { return respondError(res, error); }
};
