'use strict';

const { createHash, createHmac } = require('node:crypto');
const { fail } = require('./_payment');

function enabled() { return process.env.LIORA_CHECKOUT_V2 === 'true'; }
function couponsEnabled() { return process.env.LIORA_COUPONS_ENABLED === 'true'; }
// Coupon history must not silently switch the existing Checkout Pro Pix flow.
function trackingEnabled() { return enabled() || couponsEnabled(); }
function settings() {
  const url = process.env.ORDERS_SUPABASE_URL;
  const key = process.env.ORDERS_SUPABASE_SECRET_KEY;
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url || '') || !key || key.length < 32) {
    fail('ORDER_STORAGE_NOT_CONFIGURED', 'O registro de pedidos está temporariamente indisponível. Tente mais tarde.');
  }
  return { url: url.replace(/\/$/, ''), key };
}
async function request(path, { method = 'GET', body, prefer } = {}) {
  const { url, key } = settings();
  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      method, headers: { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
        'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) throw new Error('storage');
    return response.status === 204 ? null : await response.json();
  } catch {
    // Never expose database responses, customer data or credentials in logs.
    fail('ORDER_STORAGE_UNAVAILABLE', 'Não foi possível registrar o pedido. Se já pagou, não pague novamente; consulte a confirmação.', 503);
  }
}
function identity(key, config) {
  if (typeof key !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) {
    fail('CHECKOUT_KEY_REQUIRED', 'Atualize a página e tente novamente.', 400);
  }
  return `LIORA-${createHmac('sha256', config.secret).update(`${config.environment}:${key}`).digest('hex').slice(0, 32).toUpperCase()}`;
}
async function getOrder(id, environment) {
  if (!/^LIORA-[A-Z0-9-]{10,80}$/.test(id || '')) return null;
  const rows = await request(`liora_orders?id=eq.${encodeURIComponent(id)}&environment=eq.${encodeURIComponent(environment)}&limit=1`);
  if (!Array.isArray(rows)) fail('ORDER_STORAGE_UNAVAILABLE');
  return rows[0] || null;
}
async function register(order, fingerprint) {
  const requestHash = createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
  if (order.customer_cpf_hash) {
    const result = await request('rpc/liora_register_coupon_order', {
      method: 'POST', body: { p_order: { ...order, request_hash: requestHash } }
    });
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail('ORDER_STORAGE_UNAVAILABLE');
    if (result.code) couponFailure(result.code);
    if (!result.order || result.order.id !== order.id || result.order.environment !== order.environment
      || result.order.request_hash !== requestHash || typeof result.created !== 'boolean') fail('ORDER_STORAGE_UNAVAILABLE');
    return { order: result.order, created: result.created };
  }
  const rows = await request('liora_orders?on_conflict=id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: { ...order, request_hash: requestHash } });
  if (!Array.isArray(rows)) fail('ORDER_STORAGE_UNAVAILABLE');
  if (rows.length === 1) return { order: rows[0], created: true };
  const existing = await getOrder(order.id, order.environment);
  if (!existing || existing.request_hash !== requestHash) fail('CHECKOUT_KEY_CONFLICT', 'Os dados deste pedido mudaram. Reabra o checkout para continuar.', 409);
  return { order: existing, created: false };
}
function couponFailure(code) {
  const messages = {
    COUPON_HISTORY_UNAVAILABLE: ['A validação da primeira compra está temporariamente indisponível. Tente novamente mais tarde ou remova o cupom.', 503],
    COUPON_FIRST_ORDER_ONLY: ['O cupom PRIMEIRACOMPRA é válido apenas no primeiro pedido deste CPF. Remova o cupom para continuar.', 409],
    COUPON_ORDER_PENDING: ['Há um pedido em andamento para este CPF. Consulte esse pagamento antes de tentar novamente.', 409],
    CHECKOUT_KEY_CONFLICT: ['Os dados deste pedido mudaram. Reabra o checkout para continuar.', 409]
  };
  const entry = messages[code];
  if (!entry) fail('ORDER_STORAGE_UNAVAILABLE');
  fail(code, entry[0], entry[1]);
}
async function couponEligibility(cpfHash, environment, orderId = null) {
  if (!/^[a-f0-9]{64}$/.test(cpfHash || '') || !['production', 'preview', 'development'].includes(environment)) fail('COUPON_IDENTITY_INVALID');
  const result = await request('rpc/liora_coupon_eligibility', {
    method: 'POST', body: { p_cpf_hash: cpfHash, p_environment: environment, p_order_id: orderId }
  });
  if (!result || typeof result.eligible !== 'boolean'
    || (!result.eligible && !['COUPON_HISTORY_UNAVAILABLE', 'COUPON_FIRST_ORDER_ONLY', 'COUPON_ORDER_PENDING'].includes(result.code))) fail('ORDER_STORAGE_UNAVAILABLE');
  return result;
}
async function saveCheckout(id, environment, data) {
  const rows = await request(`liora_orders?id=eq.${encodeURIComponent(id)}&environment=eq.${environment}`, {
    method: 'PATCH', prefer: 'return=representation', body: { checkout_response: data, checkout_state: 'ready', updated_at: new Date().toISOString() }
  });
  if (!Array.isArray(rows) || rows.length !== 1) fail('ORDER_STORAGE_UNAVAILABLE');
}
async function recordPayment(order, payment) {
  return request('rpc/liora_record_payment', { method: 'POST', body: { p_order_id: order.id, p_environment: order.environment, p_payment: payment } });
}
function proofFor(order) {
  return { orderId: order.id, provider: order.provider, totalCents: order.total_cents, method: order.method, mode: order.mode, environment: order.environment, currency: 'BRL' };
}
async function reconcile(proof, payment) {
  if (!trackingEnabled() && !proof.registered) return;
  const order = await getOrder(proof.orderId, proof.environment);
  // Orders started before activation have no durable snapshot to reconstruct.
  if (!order) {
    if (proof.registered) fail('ORDER_NOT_FOUND', 'O registro do pedido precisa ser conferido pela loja. Não pague novamente.', 409);
    return;
  }
  if (order.provider !== proof.provider || order.total_cents !== proof.totalCents || order.method !== proof.method || order.mode !== proof.mode) fail('PAYMENT_ORDER_MISMATCH', 'O pedido precisa ser conferido pela loja. Não pague novamente.', 409);
  return recordPayment(order, payment);
}

module.exports = { enabled, couponsEnabled, trackingEnabled, settings, identity, getOrder, register, saveCheckout, recordPayment, proofFor, reconcile, couponEligibility, couponFailure };
