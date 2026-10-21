'use strict';

const { providerRequest, fail } = require('./_payment');
const { validatePayment } = require('./_mp-validation');

function cpf(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits) || /^(\d)\1+$/.test(digits)) return null;
  for (let length = 9; length <= 10; length++) {
    const sum = [...digits.slice(0, length)].reduce((n, digit, i) => n + Number(digit) * (length + 1 - i), 0);
    if ((sum * 10 % 11) % 10 !== Number(digits[length])) return null;
  }
  return digits;
}
async function createPix({ orderId, total, payer, config, notificationUrl }) {
  const identification = cpf(payer.cpf);
  if (!identification) fail('PIX_CPF_INVALID', 'Informe um CPF válido para gerar o Pix.', 400);
  const data = await providerRequest('https://api.mercadopago.com/v1/payments', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.credential}`, 'X-Idempotency-Key': orderId },
    body: JSON.stringify({ transaction_amount: total, payment_method_id: 'pix', description: `Pedido ${orderId} — Liora`,
      external_reference: orderId, notification_url: notificationUrl,
      // Provider default expiry (24 h) keeps retries byte-for-byte identical.
      payer: { email: payer.email, first_name: payer.name.split(' ')[0], last_name: payer.name.split(' ').slice(1).join(' '), identification: { type: 'CPF', number: identification } },
      metadata: { order_id: orderId, checkout: 'pix_direct' } })
  });
  validatePayment(data, { orderId, totalCents: Math.round(total * 100), method: 'pix', currency: 'BRL', mode: config.mode }, String(data.id));
  const pix = data.point_of_interaction?.transaction_data;
  if (!/^\d{1,30}$/.test(String(data.id)) || data.payment_method_id !== 'pix' || data.live_mode !== (config.mode === 'live')
    || data.external_reference !== orderId || data.currency_id !== 'BRL' || Math.round(data.transaction_amount * 100) !== Math.round(total * 100)
    || !['pending', 'approved'].includes(data.status) || typeof pix?.qr_code !== 'string' || !pix.qr_code.startsWith('000201') || pix.qr_code.length > 4096
    || typeof pix.qr_code_base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(pix.qr_code_base64) || pix.qr_code_base64.length > 200000
    || !Number.isFinite(Date.parse(data.date_of_expiration))) {
    fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível validar o Pix. Consulte o pedido antes de tentar novamente.', 502);
  }
  return { id: String(data.id), payment_id: String(data.id), pix: { code: pix.qr_code, image: pix.qr_code_base64, expires_at: data.date_of_expiration } };
}

module.exports = { cpf, createPix };
