'use strict';
const { providerRequest, httpsUrl, fail } = require('./_payment');

async function createInfinitePay({ config, orderId, siteUrl, cart, shippingCost, selectedQuote, customer, address, durable }) {
  const items = cart.map(item => ({ quantity: item.quantity, price: Math.round(item.price * 100),
    description: `${item.name}${item.fragrance ? ` — ${item.fragrance}` : ''}`.slice(0, 120) }));
  if (shippingCost > 0) items.push({ quantity: 1, price: Math.round(shippingCost * 100), description: `Frete — ${selectedQuote.name}`.slice(0, 120) });
  const payload = { handle: config.credential, order_nsu: orderId,
    redirect_url: `${siteUrl}/?checkout=infinitepay-return&order_id=${encodeURIComponent(orderId)}`,
    items, customer, address };
  if (durable) payload.webhook_url = `${siteUrl}/api/payment-webhook?provider=infinitepay`;
  else if (process.env.INFINITEPAY_WEBHOOK_URL) {
    const webhook = httpsUrl(process.env.INFINITEPAY_WEBHOOK_URL, [new URL(siteUrl).hostname]);
    if (!webhook) fail('PAYMENT_WEBHOOK_URL_INVALID');
    payload.webhook_url = webhook.toString();
  }
  const data = await providerRequest('https://api.checkout.infinitepay.io/links', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload)
  });
  const checkoutUrl = httpsUrl(data.url, ['checkout.infinitepay.io', 'checkout.infinitepay.com.br']);
  if (!checkoutUrl || checkoutUrl.pathname === '/') {
    // Diagnose the response contract without recording customer data or payment URLs.
    console.warn(JSON.stringify({ event: 'infinitepay_invalid_checkout_response', hasUrl: typeof data.url === 'string',
      urlHost: httpsUrl(data.url)?.hostname || null, hasCheckoutUrl: typeof data.checkout_url === 'string', hasLink: typeof data.link === 'string' }));
    fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível iniciar o pagamento na InfinitePay.', 502);
  }
  return { id: orderId, init_point: checkoutUrl.toString() };
}
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
module.exports = { createInfinitePay, checkInfinitePay };
