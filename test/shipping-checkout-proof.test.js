'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const createPreference = require('../api/create-preference');
const shippingQuote = require('../api/shipping-quote');
const { ShippingQuoteError } = require('../api/_shipping');
const { configuration } = require('../api/_payment');
const { attachQuoteProofs, verifyQuote, QUOTE_TTL_SECONDS } = require('../api/_shipping-proof');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const product = 'botanique-70-ml-1dqj4';
const items = [{ id: product, qty: 1 }];
const context = { zipCode: '20020050', cart: [{ id: product, quantity: 1, price: 25 }], serviceId: '1' };
const rate = { id: '1', name: 'PAC', carrier: 'Correios', price: 28.13, deliveryDays: 5, preview: false };

beforeEach(() => {
  Object.assign(process.env, {
    PAYMENT_MODE: 'test', VERCEL_ENV: 'development',
    CHECKOUT_SIGNING_SECRET: 'synthetic-shipping-quote-signing-key-only',
    MP_ACCESS_TOKEN: 'synthetic-mp-token', SITE_URL: 'https://liora.example',
    SUPERFRETE_TOKEN: 'synthetic-shipping-token', SHIP_ORIGIN_CEP: '80020000',
    SUPERFRETE_BASE_URL: 'https://sandbox.superfrete.com'
  });
  delete process.env.LIORA_CHECKOUT_V2;
  delete process.env.LIORA_SHIPPING_ESTIMATE;
  delete process.env.MP_WEBHOOK_URL;
  global.fetch = async () => assert.fail('A rede real não pode ser acessada pelos testes');
});
afterEach(() => {
  global.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});

async function invoke(handler, body) {
  const res = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ method: 'POST', body }, res);
  return res;
}
function request(shipping = {}) {
  return { items, payMethod: 'card', returnOrigin: 'https://liora.example',
    shipping: { method: 'delivery', serviceId: '1', ...shipping },
    payer: { name: 'Teste Sintético', email: 'teste@example.com', cep: context.zipCode, num: '1', addr: 'Endereço sintético' } };
}
function proof(now = Date.now()) {
  return attachQuoteProofs({ quotes: [rate] }, context, configuration('mercadopago'), now).quotes[0].quoteProof;
}

test('cotação de R$ 28,13 é reutilizada no pagamento mesmo se a SuperFrete deixar de responder', async () => {
  let shippingCalls = 0, paymentCalls = 0, preference;
  global.fetch = async (url, options) => {
    if (url.includes('/api/v0/calculator')) {
      shippingCalls++;
      if (shippingCalls > 1) throw new ShippingQuoteError('SHIPPING_PROVIDER_TIMEOUT', 'A cotação demorou mais que o esperado. Tente novamente.', { status: 503 });
      return { ok: true, status: 200, json: async () => [{ id: 1, name: 'PAC', price: 28.13, delivery_time: 5, company: { name: 'Correios' } }] };
    }
    assert.equal(url, 'https://api.mercadopago.com/checkout/preferences');
    paymentCalls++;
    preference = JSON.parse(options.body);
    return { ok: true, status: 201, json: async () => ({ id: 'pref-synthetic', init_point: 'https://www.mercadopago.com.br/checkout/test' }) };
  };
  const quote = await invoke(shippingQuote, { cep: context.zipCode, items });
  assert.equal(quote.statusCode, 200);
  const signed = quote.body.quotes.find(q => q.id === '1');
  assert.ok(signed.quoteProof);
  const result = await invoke(createPreference, request({ quoteProof: signed.quoteProof, cost: 0.01 }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.total, 53.13);
  assert.equal(preference.shipments.cost, 28.13);
  assert.equal(shippingCalls, 1);
  assert.equal(paymentCalls, 1);
});

test('assinatura recusa preço adulterado, outro serviço, CEP, carrinho, preço de catálogo e ambiente', async () => {
  const token = proof();
  const [payload, signature] = token.split('.');
  const changed = JSON.parse(Buffer.from(payload, 'base64url'));
  changed.quote.priceCents = 1;
  const tampered = `${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
  for (const body of [
    request({ quoteProof: tampered }),
    request({ quoteProof: token, serviceId: '2' }),
    { ...request({ quoteProof: token }), payer: { ...request().payer, cep: '22041001' } },
    { ...request({ quoteProof: token }), items: [{ id: product, qty: 2 }] }
  ]) {
    const result = await invoke(createPreference, body);
    assert.equal(result.statusCode, 409);
    assert.match(result.body.code, /^SHIPPING_QUOTE_(INVALID|CHANGED)$/);
  }
  const config = configuration('mercadopago');
  assert.throws(() => verifyQuote(token, { ...context, cart: [{ id: product, quantity: 1, price: 26 }] }, config), { code: 'SHIPPING_QUOTE_CHANGED' });
  assert.throws(() => verifyQuote(token, context, { ...config, mode: 'live', environment: 'production' }), { code: 'SHIPPING_QUOTE_INVALID' });
});

test('cotação expirada pede atualização sem consultar transportadora ou criar pagamento', async () => {
  const token = proof(Date.now() - (QUOTE_TTL_SECONDS + 1) * 1000);
  const result = await invoke(createPreference, request({ quoteProof: token }));
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'SHIPPING_QUOTE_EXPIRED');
});

test('comprovante não contém CEP e aceita apenas mudanças de fragrância sem mudança de quantidade', () => {
  const token = proof();
  const decoded = Buffer.from(token.split('.')[0], 'base64url').toString();
  assert.doesNotMatch(decoded, new RegExp(context.zipCode));
  const quoted = attachQuoteProofs({ quotes: [rate] }, { ...context, cart: [
    { id: product, quantity: 1, price: 25, fragrance: 'Lavanda' },
    { id: product, quantity: 1, price: 25, fragrance: 'Baunilha' }
  ] }).quotes[0];
  assert.equal(verifyQuote(quoted.quoteProof, { ...context, cart: [{ id: product, quantity: 2, price: 25 }] }, configuration('mercadopago')).price, 28.13);
});

test('simulação e embalagem estimada não recebem comprovante para liberar cobrança', () => {
  const result = attachQuoteProofs({ quotes: [{ ...rate, preview: true }, { ...rate, estimated: true }] }, context);
  assert.ok(result.quotes.every(q => !q.quoteProof));
  delete process.env.CHECKOUT_SIGNING_SECRET;
  assert.equal(attachQuoteProofs({ quotes: [rate] }, context).quotes[0].quoteProof, undefined);
});

test('página antiga recebe erro de frete específico em vez de erro interno de pagamento', async () => {
  let calls = 0;
  global.fetch = async url => {
    assert.match(url, /superfrete/);
    calls++;
    throw new ShippingQuoteError('SHIPPING_PROVIDER_TIMEOUT', 'A cotação demorou mais que o esperado. Tente novamente.', { status: 503 });
  };
  const result = await invoke(createPreference, request());
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'SHIPPING_PROVIDER_TIMEOUT');
  assert.match(result.body.error, /cotação/);
  assert.equal(calls, 1);
});

test('falha de rede da transportadora não aparece como recusa de pagamento', async () => {
  global.fetch = async url => { assert.match(url, /superfrete/); throw new TypeError('fetch failed'); };
  const result = await invoke(createPreference, request());
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'SHIPPING_PROVIDER_UNAVAILABLE');
});
