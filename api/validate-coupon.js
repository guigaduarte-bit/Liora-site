'use strict';

const { validateCart } = require('./_cart');
const { validateCoupon } = require('./_coupons');
const { PaymentError, fail, responseHeaders, respondError } = require('./_payment');
const orders = require('./_orders');

module.exports = async function handler(req, res) {
  responseHeaders(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método não permitido' });
  }
  try {
    const body = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body || {};
    if (!['pix', 'card', 'boleto', 'infinitepay'].includes(body.payMethod)) fail('PAYMENT_METHOD_UNAVAILABLE', 'Escolha uma forma de pagamento.', 400);
    if (body.coupons !== undefined) fail('COUPON_ONE_AT_A_TIME', 'Use apenas um cupom por pedido.', 400);
    const environment = process.env.VERCEL_ENV || 'development';
    const config = { environment, secret: process.env.CHECKOUT_SIGNING_SECRET };
    let orderId;
    if (body.checkoutKey && typeof config.secret === 'string' && Buffer.byteLength(config.secret) >= 32) orderId = orders.identity(body.checkoutKey, config);
    const result = await validateCoupon({ code: body.couponCode, cart: validateCart(body.items), paymentMethod: body.payMethod, payerCpf: body.payer?.cpf, environment, orderId });
    const { definition, ...quote } = result;
    return res.status(200).json(quote);
  } catch (error) {
    if (error instanceof PaymentError) return respondError(res, error);
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'Dados do cupom inválidos.' });
    if (error && /Carrinho|produto|Quantidade|Estoque/i.test(error.message)) return res.status(400).json({ error: error.message });
    return respondError(res, error);
  }
};
