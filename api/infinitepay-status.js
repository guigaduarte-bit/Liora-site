'use strict';

const { configuration, verifyProof, providerRequest, fail, respondError, responseHeaders } = require('./_payment');

module.exports = async function handler(req, res) {
  responseHeaders(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método não permitido' });
  }
  try {
    const config = configuration('infinitepay');
    const proof = verifyProof(req, 'infinitepay', config);
    const query = req.query || {};
    const orderId = query.order_id || query.order_nsu;
    const transactionNsu = query.transaction_nsu;
    const slug = query.slug || query.invoice_slug;
    if (orderId !== proof.orderId || typeof transactionNsu !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(transactionNsu)
      || typeof slug !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(slug)) {
      fail('PAYMENT_IDENTIFICATION_INVALID', 'Identificação do pagamento inválida.', 400);
    }
    const payment = await providerRequest('https://api.checkout.infinitepay.io/payment_check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ handle: config.credential, order_nsu: proof.orderId, transaction_nsu: transactionNsu, slug })
    });
    if (payment.success !== true || typeof payment.paid !== 'boolean'
      || !Number.isSafeInteger(payment.amount) || payment.amount <= 0) {
      fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível validar a resposta do pagamento.', 502);
    }
    if (payment.amount !== proof.totalCents) fail('PAYMENT_ORDER_MISMATCH', 'O pagamento não corresponde ao valor deste pedido.', 409);
    if (payment.paid && (!Number.isSafeInteger(payment.paid_amount) || payment.paid_amount < proof.totalCents
      || !Number.isInteger(payment.installments) || payment.installments < 1 || payment.installments > 12
      || !['credit_card', 'pix'].includes(payment.capture_method))) {
      fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível validar a resposta do pagamento.', 502);
    }
    // InfinitePay reports BRL cents and has no documented test mode.
    // It is therefore permitted only in Production with explicit live mode.
    return res.status(200).json({ order_id: proof.orderId, status: payment.paid === true ? 'approved' : 'pending', payment_mode: proof.mode });
  } catch (error) { return respondError(res, error); }
};
