'use strict';

const { createHmac } = require('node:crypto');
const policy = require('../content/coupon-policy.json');
const { cpf } = require('./_pix');
const { fail } = require('./_payment');
const orders = require('./_orders');

function normalizeCode(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40 || /[,;\s+]/.test(value.trim())) {
    fail('COUPON_ONE_AT_A_TIME', 'Use apenas um cupom por pedido.', 400);
  }
  const code = value.trim().toUpperCase();
  return code || null;
}

function resolveCoupon(value, now = Date.now()) {
  const code = normalizeCode(value);
  if (!code) return null;
  const coupon = policy.coupons.find(item => item.code === code);
  if (!coupon) fail('COUPON_INVALID', 'Cupom não encontrado. Confira o código e tente novamente.', 400);
  if (coupon.startsAt && now < Date.parse(coupon.startsAt)) {
    fail('COUPON_NOT_STARTED', 'O cupom BF20% vale de 27 a 29/11/2026, pelo horário de Brasília.', 400);
  }
  if (coupon.endsAt && now >= Date.parse(coupon.endsAt)) {
    fail('COUPON_EXPIRED', 'O prazo do cupom BF20% terminou em 29/11/2026, pelo horário de Brasília.', 400);
  }
  return coupon;
}

function cpfHash(value, environment) {
  const normalized = cpf(value);
  if (!normalized) fail('CHECKOUT_CPF_INVALID', 'Informe um CPF válido para continuar.', 400);
  const secret = process.env.COUPON_CPF_HASH_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || !['production', 'preview', 'development'].includes(environment)) {
    fail('COUPON_IDENTITY_NOT_CONFIGURED', 'Não foi possível conferir o CPF agora. Tente novamente mais tarde.');
  }
  // A dedicated stable secret prevents dictionary attacks against the tiny CPF
  // space. Do not rotate it without migrating historical identities as well.
  return createHmac('sha256', secret).update(`liora-cpf-v1:${environment}:${normalized}`).digest('hex');
}

function priceProducts(cart, paymentMethod, coupon = null) {
  const subtotalCents = cart.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
  const couponDiscountCents = coupon ? Math.round(subtotalCents * coupon.percent / 100) : 0;
  const afterCouponCents = subtotalCents - couponDiscountCents;
  const paymentDiscountCents = paymentMethod === 'pix' ? Math.round(afterCouponCents * policy.pixExtraPercent / 100) : 0;
  return {
    subtotalCents,
    couponDiscountCents,
    paymentDiscountCents,
    productTotalCents: afterCouponCents - paymentDiscountCents,
    coupon: coupon ? { code: coupon.code, percent: coupon.percent, discountCents: couponDiscountCents } : null
  };
}

function eligibilityError(code) {
  const errors = {
    COUPON_HISTORY_UNAVAILABLE: ['Não foi possível conferir este cupom agora. Tente mais tarde ou continue sem cupom.', 503],
    COUPON_FIRST_ORDER_ONLY: ['O PRIMEIRACOMPRA é válido apenas no primeiro pedido por CPF. Remova o cupom para continuar.', 409],
    COUPON_ORDER_PENDING: ['Há um pedido em andamento para este CPF. Consulte esse pedido antes de tentar novamente.', 409]
  };
  const [message, status] = errors[code] || errors.COUPON_HISTORY_UNAVAILABLE;
  fail(Object.hasOwn(errors, code) ? code : 'COUPON_HISTORY_UNAVAILABLE', message, status);
}

async function validateCoupon({ code, cart, paymentMethod, payerCpf, environment, orderId, now, checkEligibility = true }) {
  if (!orders.couponsEnabled()) fail('COUPONS_UNAVAILABLE', 'Os cupons estão temporariamente indisponíveis. Continue sem cupom ou tente mais tarde.');
  const coupon = resolveCoupon(code, now);
  if (!coupon) fail('COUPON_REQUIRED', 'Digite um cupom para aplicar o desconto.', 400);
  if (coupon.firstPurchaseOnly && checkEligibility) {
    const identity = cpfHash(payerCpf, environment);
    const eligibility = await orders.couponEligibility(identity, environment, orderId);
    if (!eligibility.eligible) eligibilityError(eligibility.code);
  }
  return { ...priceProducts(cart, paymentMethod, coupon), definition: coupon };
}

// Allocate exact integer cents proportionally. Largest remainders avoid a
// negative last line when small products or many fragrances are in the cart.
function allocateProductCents(cart, targetCents) {
  const weights = cart.map(item => Math.round(item.price * 100) * item.quantity);
  const subtotalCents = weights.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(targetCents) || targetCents <= 0 || targetCents > subtotalCents) fail('COUPON_TOTAL_INVALID');
  const allocations = weights.map((weight, index) => ({ index, cents: Math.floor(weight * targetCents / subtotalCents), remainder: (weight * targetCents) % subtotalCents }));
  let remaining = targetCents - allocations.reduce((sum, item) => sum + item.cents, 0);
  const ranked = [...allocations].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remaining; i++) ranked[i].cents++;
  if (allocations.some(item => item.cents <= 0)) fail('COUPON_TOTAL_INVALID', 'Não foi possível calcular o desconto deste carrinho. Revise os produtos.');
  return allocations.map(item => item.cents);
}

module.exports = { normalizeCode, resolveCoupon, cpfHash, priceProducts, validateCoupon, allocateProductCents, eligibilityError };
