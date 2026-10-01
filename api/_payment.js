'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const PROOF_TTL_SECONDS = 7 * 24 * 60 * 60;
const PAYMENT_TIMEOUT_MS = 10000;

class PaymentError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function fail(code, message = 'Pagamento temporariamente indisponível', status = 503) {
  throw new PaymentError(code, message, status);
}

function httpsUrl(value, allowedHosts) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (allowedHosts && !allowedHosts.includes(url.hostname)) return null;
    return url;
  } catch { return null; }
}

function environmentUrl(value) {
  if (!value) return null;
  return httpsUrl(value.includes('://') ? value : `https://${value}`);
}

function configuration(provider) {
  const mode = process.env.PAYMENT_MODE;
  const environment = process.env.VERCEL_ENV || 'development';
  if (!['test', 'live'].includes(mode)) fail('PAYMENT_MODE_NOT_CONFIGURED');
  if ((environment === 'production') !== (mode === 'live')) fail('PAYMENT_ENVIRONMENT_MISMATCH');
  if (!['production', 'preview', 'development'].includes(environment)) fail('PAYMENT_ENVIRONMENT_MISMATCH');
  const secret = process.env.CHECKOUT_SIGNING_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) fail('CHECKOUT_SIGNING_NOT_CONFIGURED');
  if (provider === 'infinitepay' && (environment !== 'production' || mode !== 'live')) {
    fail('INFINITEPAY_PREVIEW_UNAVAILABLE', 'InfinitePay não está disponível neste ambiente de teste.');
  }
  const credential = provider === 'infinitepay' ? process.env.INFINITEPAY_HANDLE : process.env.MP_ACCESS_TOKEN;
  if (typeof credential !== 'string' || !credential.trim()) fail('PAYMENT_PROVIDER_NOT_CONFIGURED');
  if (provider === 'infinitepay' && !/^[A-Za-z0-9_-]{1,100}$/.test(credential)) fail('PAYMENT_PROVIDER_NOT_CONFIGURED');
  return { mode, environment, secret, credential };
}

function siteOrigin(config) {
  // Vercel's preview deployment URLs are the only return targets in Preview.
  // SITE_URL often points at the shop's production domain across environments.
  const previewUrls = [environmentUrl(process.env.VERCEL_BRANCH_URL), environmentUrl(process.env.VERCEL_URL)].filter(Boolean);
  const configured = environmentUrl(process.env.SITE_URL);
  if (config.environment === 'preview' && configured && !previewUrls.some(url => url.origin === configured.origin)) {
    fail('PAYMENT_RETURN_URL_MISMATCH');
  }
  const url = config.environment === 'preview'
    ? configured || previewUrls[0]
    : environmentUrl(process.env.SITE_URL) || (config.environment === 'production' ? environmentUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) : null);
    if (!url) fail('PAYMENT_RETURN_URL_NOT_CONFIGURED');
  return url.origin;
}

function signProof({ orderId, provider, totalCents, method }, config, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const payload = { v: 1, orderId, provider, totalCents, currency: 'BRL', method, mode: config.mode, environment: config.environment, iat, exp: iat + PROOF_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', config.secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyProof(req, provider, config, now = Date.now()) {
  const raw = req.headers && req.headers['x-checkout-proof'];
  if (typeof raw !== 'string' || raw.length > 2048) fail('CHECKOUT_PROOF_REQUIRED', 'Não foi possível identificar este pedido com segurança.', 400);
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) fail('CHECKOUT_PROOF_INVALID', 'Comprovante do pedido inválido.', 400);
  const expected = createHmac('sha256', config.secret).update(parts[0]).digest();
  const received = Buffer.from(parts[1], 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) fail('CHECKOUT_PROOF_INVALID', 'Comprovante do pedido inválido.', 400);
  let proof;
  try { proof = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { fail('CHECKOUT_PROOF_INVALID', 'Comprovante do pedido inválido.', 400); }
  const seconds = Math.floor(now / 1000);
  if (!proof || proof.v !== 1 || !/^LIORA-[A-Z0-9-]{10,80}$/.test(proof.orderId)
    || proof.provider !== provider || proof.currency !== 'BRL'
    || !Number.isSafeInteger(proof.totalCents) || proof.totalCents <= 0
    || !['pix', 'card', 'boleto', 'infinitepay'].includes(proof.method)
    || (provider === 'infinitepay') !== (proof.method === 'infinitepay')
    || proof.mode !== config.mode || proof.environment !== config.environment
    || !Number.isInteger(proof.iat) || !Number.isInteger(proof.exp)
    || proof.iat > seconds + 60 || proof.exp <= seconds
    || proof.exp - proof.iat !== PROOF_TTL_SECONDS) {
    fail('CHECKOUT_PROOF_INVALID', 'Comprovante do pedido inválido ou expirado.', 400);
  }
  return proof;
}

async function providerRequest(url, options) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PaymentError('PAYMENT_PROVIDER_TIMEOUT', 'O pagamento demorou para responder. Tente novamente.', 504));
    }, PAYMENT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetch(url, { ...options, signal: controller.signal });
      let data;
      try { data = await response.json(); }
      catch { fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível validar a resposta do pagamento.', 502); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) fail('PAYMENT_PROVIDER_INVALID_RESPONSE', 'Não foi possível validar a resposta do pagamento.', 502);
      if (!response.ok) {
        console.warn(JSON.stringify({ event: 'payment_provider_rejected', status: response.status }));
        fail('PAYMENT_PROVIDER_REJECTED', 'Não foi possível processar o pagamento. Tente novamente.', 502);
      }
      return data;
    })(), timeout]);
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    fail('PAYMENT_PROVIDER_UNAVAILABLE', 'Não foi possível acessar o pagamento. Tente novamente.', 502);
  } finally { clearTimeout(timer); }
}

function respondError(res, error) {
  const known = error instanceof PaymentError;
  const code = known ? error.code : 'PAYMENT_INTERNAL_ERROR';
  console.warn(JSON.stringify({ event: 'payment_request_failed', code }));
  return res.status(known ? error.status : 500).json({ code, error: known ? error.message : 'Não foi possível processar o pagamento.' });
}

function responseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = { PaymentError, fail, httpsUrl, configuration, siteOrigin, signProof, verifyProof, providerRequest, respondError, responseHeaders, PAYMENT_TIMEOUT_MS };
