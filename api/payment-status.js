'use strict';

const { configuration, verifyProof, providerRequest, fail, respondError, responseHeaders } = require('./_payment');
const orders = require('./_orders');
const { validatePayment } = require('./_mp-validation');
function mismatch() { fail('PAYMENT_ORDER_MISMATCH', 'O pagamento precisa ser conferido pela loja. Não pague novamente.', 409); }

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
    const order = orders.enabled() || proof.registered ? await orders.getOrder(proof.orderId, config.environment) : null;
    const result = validatePayment(payment, proof, paymentId, order);
    const recorded = await orders.reconcile(proof, result);
    return res.status(200).json({ payment_id: paymentId, order_id: proof.orderId,
      status: recorded?.status || (result.review_reasons.length ? 'review_required' : payment.status), payment_mode: proof.mode });
  } catch (error) { return respondError(res, error); }
};
