'use strict';
const { fail } = require('./_payment');
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

function validatePayment(payment, proof, paymentId, order) {
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
  const review = [];
  if (!methodMatches) {
    if (payment.status === 'approved' && payment.payment_method_id === 'account_money') review.push(proof.method === 'pix' ? 'pix_paid_with_balance' : 'payment_method_changed');
    else if (['refunded', 'charged_back', 'cancelled'].includes(payment.status) && payment.payment_method_id === 'account_money') { /* Reconcile reversals of historical balance payments. */ }
    else fail('PAYMENT_METHOD_MISMATCH', 'O meio de pagamento precisa ser conferido pela loja antes de confirmar o pedido.', 409);
  }
  if (payment.status === 'approved' && proof.method === 'card' && order?.interest_free_installments > 0) {
    const paid = payment.transaction_details?.total_paid_amount;
    if (!Number.isInteger(payment.installments) || payment.installments < 1 || payment.installments > order.interest_free_installments || paid == null || cents(paid) !== totalCents) review.push('installment_terms_mismatch');
  }
  return { payment_id: paymentId, status: payment.status, review_reasons: review,
    updated_at: payment.date_last_updated || null, method: payment.payment_method_id,
    installments: Number.isInteger(payment.installments) ? payment.installments : null,
    paid_cents: payment.transaction_details?.total_paid_amount == null ? null : cents(payment.transaction_details.total_paid_amount) };
}
module.exports = { validatePayment };
