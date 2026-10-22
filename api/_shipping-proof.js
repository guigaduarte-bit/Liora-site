'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { fail } = require('./_payment');

const QUOTE_TTL_SECONDS = 15 * 60;

function signingConfig() {
  const secret = process.env.CHECKOUT_SIGNING_SECRET;
  const mode = process.env.PAYMENT_MODE;
  const environment = process.env.VERCEL_ENV || 'development';
  // Cotar frete continua possível antes de configurar pagamentos. Nesse caso,
  // não emitimos um comprovante que possa ser aceito pelo checkout.
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32
    || !['test', 'live'].includes(mode)
    || !['production', 'preview', 'development'].includes(environment)
    || (environment === 'production') !== (mode === 'live')) return null;
  return { secret, mode, environment };
}

function binding({ zipCode, cart }, config) {
  const quantities = new Map();
  for (const item of cart) {
    const key = JSON.stringify([item.id, Math.round(item.price * 100)]);
    quantities.set(key, (quantities.get(key) || 0) + item.quantity);
  }
  const items = [...quantities].sort(([a], [b]) => a.localeCompare(b));
  // Nem o CEP nem os itens ficam expostos no conteúdo do comprovante.
  return createHmac('sha256', config.secret).update('liora-shipping-cart-v1\n')
    .update(JSON.stringify([zipCode, items])).digest('base64url');
}

function signature(encoded, config) {
  return createHmac('sha256', config.secret).update('liora-shipping-quote-v1\n')
    .update(encoded).digest();
}

function attachQuoteProofs(result, context, config = signingConfig(), now = Date.now()) {
  if (!config) return result;
  const iat = Math.floor(now / 1000);
  const scope = binding(context, config);
  return { ...result, quotes: result.quotes.map(quote => {
    // Simulações e embalagens pendentes nunca habilitam pagamento.
    if (quote.preview || quote.estimated) return quote;
    const payload = {
      v: 1, kind: 'shipping', mode: config.mode, environment: config.environment,
      scope, iat, exp: iat + QUOTE_TTL_SECONDS,
      quote: { id: quote.id, name: quote.name, carrier: quote.carrier,
        priceCents: Math.round(quote.price * 100), deliveryDays: quote.deliveryDays ?? null }
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { ...quote, quoteProof: `${encoded}.${signature(encoded, config).toString('base64url')}` };
  }) };
}

function verifyQuote(raw, context, config, now = Date.now()) {
  const invalid = () => fail('SHIPPING_QUOTE_INVALID', 'Não foi possível validar o frete. Calcule a entrega novamente.', 409);
  if (typeof raw !== 'string' || raw.length > 4096) invalid();
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts.every(p => /^[A-Za-z0-9_-]+$/.test(p))) invalid();
  const received = Buffer.from(parts[1], 'base64url');
  const expected = signature(parts[0], config);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) invalid();
  let proof;
  try { proof = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch { invalid(); }
  const seconds = Math.floor(now / 1000);
  if (!proof || proof.v !== 1 || proof.kind !== 'shipping'
    || proof.mode !== config.mode || proof.environment !== config.environment
    || !Number.isInteger(proof.iat) || !Number.isInteger(proof.exp)
    || proof.iat > seconds + 60 || proof.exp !== proof.iat + QUOTE_TTL_SECONDS) invalid();
  if (proof.exp <= seconds) fail('SHIPPING_QUOTE_EXPIRED', 'A cotação de frete expirou. Calcule a entrega novamente.', 409);
  if (proof.scope !== binding(context, config)) {
    fail('SHIPPING_QUOTE_CHANGED', 'O carrinho ou o CEP mudou. Calcule a entrega novamente.', 409);
  }
  const quote = proof.quote;
  if (!quote || quote.id !== context.serviceId
    || typeof quote.id !== 'string' || !quote.id || quote.id.length > 80
    || typeof quote.name !== 'string' || quote.name.length > 80
    || typeof quote.carrier !== 'string' || quote.carrier.length > 60
    || !Number.isSafeInteger(quote.priceCents) || quote.priceCents < 0
    || (quote.deliveryDays !== null && (!Number.isSafeInteger(quote.deliveryDays) || quote.deliveryDays < 0))) invalid();
  return { id: quote.id, name: quote.name, carrier: quote.carrier,
    price: quote.priceCents / 100, deliveryDays: quote.deliveryDays, preview: false };
}

module.exports = { attachQuoteProofs, verifyQuote, QUOTE_TTL_SECONDS };
