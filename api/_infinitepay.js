'use strict';
// Read-only reconciliation for payments initiated before this provider was removed.
// New checkouts are accepted exclusively through Mercado Pago.
const { providerRequest, fail } = require('./_payment');
async function checkInfinitePay({ config, proof, transactionNsu, slug }) {
  if (typeof transactionNsu !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(transactionNsu) || typeof slug !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(slug)) fail('PAYMENT_IDENTIFICATION_INVALID', 'Identificação do pagamento inválida.', 400);
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
  return { payment_id: transactionNsu, status: payment.paid ? 'approved' : 'pending', review_reasons: [], updated_at: null, method: payment.capture_method || null, installments: payment.installments || null, paid_cents: payment.paid_amount || null };
}
module.exports = { checkInfinitePay };
