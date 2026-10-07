'use strict';

const { configuration, verifyProof, providerRequest, fail, respondError, responseHeaders } = require('./_payment');
const STATUSES = new Set(['approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'refunded', 'charged_back', 'in_mediation']);

function cents(value, optional = false) {
  if (optional && (value === undefined || value === null)) return 0;
  if (typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
    || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
    fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível validar a resposta do pagamento.', 502);
  }
  return Math.round(value * 100);
}

function mismatch(fields) {
  // Field names only: never log amounts, references, provider bodies or proofs.
  console.warn(JSON.stringify({ event: 'payment_order_mismatch', fields }));
  fail('PAYMENT_ORDER_MISMATCH', 'O pagamento precisa ser conferido pela loja. Não pague novamente.', 409);
}

async function findPayment(proof, options) {
  const query = new URLSearchParams({ external_reference: proof.orderId, sort: 'date_created', criteria: 'desc', limit: '20' });
  const result = await providerRequest(`https://api.mercadopago.com/v1/payments/search?${query}`, options);
  if (!Array.isArray(result.results) || !Number.isSafeInteger(result.paging?.total) || result.paging.total < 0) {
    fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível consultar o pagamento.', 502);
  }
  // Do not infer a result from an incomplete search or from multiple approvals.
  if (result.paging.total > result.results.length) mismatch(['ambiguous_search']);
  const matches = result.results.filter(payment => payment.external_reference === proof.orderId);
  const approved = matches.filter(payment => payment.status === 'approved');
  if (approved.length > 1) mismatch(['multiple_approved_payments']);
  const payment = approved[0] || matches.find(payment => ['pending', 'in_process', 'authorized'].includes(payment.status)) || matches[0];
  if (!payment) fail('PAYMENT_NOT_FOUND', 'O pagamento ainda não apareceu na consulta. Verifique novamente em instantes.', 404);
  const id = String(payment.id);
  if (!/^\d{1,30}$/.test(id)) fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível consultar o pagamento.', 502);
  return id;
}

module.exports = async function handler(req, res) {
  responseHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido' });
  }
  try {
    const config = configuration('mercadopago');
    const proof = verifyProof(req, 'mercadopago', config);
    let paymentId = req.query && req.query.payment_id;
    const orderId = req.query && req.query.order_id;
    if ((paymentId !== undefined && (typeof paymentId !== 'string' || !/^\d{1,30}$/.test(paymentId))) || orderId !== proof.orderId) {
      fail('PAYMENT_IDENTIFICATION_INVALID', 'Identificação do pagamento inválida.', 400);
    }
    const options = { headers: { Authorization: `Bearer ${config.credential}` } };
    if (!paymentId) paymentId = await findPayment(proof, options);
    const payment = await providerRequest(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, options);
    // Checkout Pro carries the products and delivery as separate amounts.
    // Do not compare net_received_amount (fees) or total_paid_amount (interest).
    const amountCents = cents(payment.transaction_amount);
    const shippingCents = cents(payment.shipping_amount, true);
    const totalCents = amountCents + shippingCents;
    if (!STATUSES.has(payment.status) || amountCents <= 0 || !Number.isSafeInteger(totalCents)
      || typeof payment.live_mode !== 'boolean' || typeof payment.currency_id !== 'string') {
      fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível validar a resposta do pagamento.', 502);
    }
    const fields = [];
    if (String(payment.id) !== paymentId) fields.push('payment_id');
    if (payment.external_reference !== proof.orderId) fields.push('external_reference');
    if (totalCents !== proof.totalCents) fields.push('total');
    if (payment.currency_id !== proof.currency) fields.push('currency');
    if (payment.live_mode !== (proof.mode === 'live')) fields.push('mode');
    if (fields.length) mismatch(fields);
    const methodMatches = proof.method === 'pix'
      ? payment.payment_method_id === 'pix'
      : payment.payment_type_id === (proof.method === 'card' ? 'credit_card' : 'ticket');
    if (!methodMatches) fail('PAYMENT_METHOD_MISMATCH', 'O meio de pagamento precisa ser conferido pela loja antes de confirmar o pedido.', 409);
    return res.status(200).json({ payment_id: paymentId, order_id: proof.orderId, status: payment.status, payment_mode: proof.mode });
  } catch (error) { return respondError(res, error); }
};
