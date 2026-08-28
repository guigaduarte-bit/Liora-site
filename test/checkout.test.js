'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const createPreference = require('../api/create-preference');
const shippingQuote = require('../api/shipping-quote');
const paymentStatus = require('../api/payment-status');
const catalog = require('../api/catalog');

const originalFetch = global.fetch;
const originalEnv = {
  MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN,
  SITE_URL: process.env.SITE_URL,
  VERCEL_URL: process.env.VERCEL_URL,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  MELHOR_ENVIO_TOKEN: process.env.MELHOR_ENVIO_TOKEN,
  SHIP_ORIGIN_CEP: process.env.SHIP_ORIGIN_CEP,
  MELHOR_ENVIO_BASE_URL: process.env.MELHOR_ENVIO_BASE_URL
};

afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function invoke(handler, req) {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await handler(req, res);
  return res;
}

function validRequest(overrides = {}) {
  return {
    method: 'POST',
    body: {
      items: [{ id: 'botanique', qty: 2, frag: 'Lavanda', price: 0.01 }],
      payMethod: 'pix',
      shipping: { method: 'delivery', serviceId: '1', cost: 0.01 },
      payer: {
        name: 'Cliente Teste',
        email: 'cliente@example.com',
        cep: '80000-000',
        num: '100',
        addr: 'Rua Teste, Curitiba/PR'
      },
      ...overrides
    }
  };
}

test('catálogo do servidor corresponde ao catálogo exibido no site', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const match = html.match(/const PRODUCTS=(\[.*?\]);\nPRODUCTS\.forEach/s);
  assert.ok(match, 'catálogo do site não encontrado');
  const frontendProducts = Function(`"use strict"; return ${match[1]}`)();

  assert.equal(Object.keys(catalog).length, frontendProducts.length);
  for (const product of frontendProducts) {
    assert.deepEqual(catalog[product.id], {
      name: product.name,
      price: product.price,
      stock: product.stock,
      ...(product.soldout ? { soldout: true } : {})
    });
  }
});

test('função carrega e recusa métodos diferentes de POST antes das configurações', async () => {
  delete process.env.MP_ACCESS_TOKEN;
  delete process.env.SITE_URL;
  const res = await invoke(createPreference, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
});

test('preço, desconto Pix e frete são calculados no servidor uma única vez', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-token';
  process.env.SITE_URL = 'https://liora.example';
  process.env.MELHOR_ENVIO_TOKEN = 'ME-token';
  process.env.SHIP_ORIGIN_CEP = '80000000';
  let sentPreference;
  global.fetch = async (url, options) => {
    if (url.includes('/shipment/calculate')) {
      return {
        ok: true,
        status: 200,
        json: async () => ([{ id: 1, name: 'PAC', custom_price: '19.90', custom_delivery_time: 5, company: { name: 'Correios' } }])
      };
    }
    assert.equal(url, 'https://api.mercadopago.com/checkout/preferences');
    assert.equal(options.headers.Authorization, 'Bearer TEST-token');
    sentPreference = JSON.parse(options.body);
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 'pref-123', init_point: 'https://mercadopago.example/checkout' })
    };
  };

  const req = validRequest({
    items: [
      { id: 'botanique', qty: 1, frag: 'Lavanda', price: 0.01 },
      { id: 'peonia', qty: 1, price: 999999 }
    ],
    payer: {
      name: 'Cliente Teste',
      email: 'cliente@example.com',
      cep: '20000-000',
      num: '100',
      addr: 'Rua Teste, Rio de Janeiro/RJ'
    }
  });
  const res = await invoke(createPreference, req);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 102.55);
  assert.equal(sentPreference.metadata.subtotal, 87);
  assert.equal(sentPreference.metadata.total, 102.55);
  assert.equal(sentPreference.shipments.cost, 19.9);
  assert.equal(sentPreference.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0), 82.65);
  assert.ok(sentPreference.items.every((item) => item.unit_price > 0));
  assert.ok(sentPreference.items.every((item) => !/frete/i.test(item.title)));
  assert.match(sentPreference.external_reference, /^LIORA-/);
  assert.match(sentPreference.back_urls.success, /checkout=return/);
});

test('cotação aplica tarifa fixa em Curitiba e frete grátis a partir de R$ 150', async () => {
  delete process.env.MELHOR_ENVIO_TOKEN;
  delete process.env.SHIP_ORIGIN_CEP;
  const res = await invoke(shippingQuote, {
    method: 'POST',
    body: { cep: '80000-000', items: [{ id: 'botanique', qty: 1 }] }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.preview, false);
  assert.equal(res.body.freeShipping, false);
  assert.equal(res.body.quotes[0].id, 'curitiba-fixed');
  assert.equal(res.body.quotes[0].price, 19.9);

  const free = await invoke(shippingQuote, {
    method: 'POST',
    body: { cep: '20000-000', items: [{ id: 'botanique', qty: 2 }] }
  });
  assert.equal(free.statusCode, 200);
  assert.equal(free.body.freeShipping, true);
  assert.ok(free.body.quotes.every((quote) => quote.price === 0));
});

test('estoque é somado por produto mesmo com fragrâncias diferentes', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-token';
  process.env.SITE_URL = 'https://liora.example';
  global.fetch = async () => { throw new Error('não deveria consultar o Mercado Pago'); };

  const res = await invoke(createPreference, validRequest({
    items: [
      { id: 'botanique', qty: 2, frag: 'Lavanda' },
      { id: 'botanique', qty: 1, frag: 'Baunilha' }
    ]
  }));

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Estoque insuficiente/);
});

test('checkout recusa formas de pagamento removidas da interface', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-token';
  process.env.SITE_URL = 'https://liora.example';
  const res = await invoke(createPreference, validRequest({
    payMethod: 'transfer',
    shipping: { method: 'delivery', serviceId: 'curitiba-fixed' }
  }));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /pagamento inválido/i);
});

test('checkout recusa retirada gratuita removida do site', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-token';
  process.env.SITE_URL = 'https://liora.example';
  const res = await invoke(createPreference, validRequest({
    shipping: { method: 'retirada' }
  }));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /envio inválido/i);
});

test('boleto bancário é enviado ao Mercado Pago como pagamento por ticket', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-token';
  process.env.SITE_URL = 'https://liora.example';
  let sentPreference;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.mercadopago.com/checkout/preferences');
    sentPreference = JSON.parse(options.body);
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 'pref-boleto', init_point: 'https://mercadopago.example/boleto' })
    };
  };
  const res = await invoke(createPreference, validRequest({
    payMethod: 'boleto',
    shipping: { method: 'delivery', serviceId: 'curitiba-fixed' }
  }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sentPreference.payment_methods.excluded_payment_types, [
    { id: 'credit_card' },
    { id: 'debit_card' },
    { id: 'bank_transfer' }
  ]);
});

test('retorno aprovado só é aceito quando pertence ao mesmo pedido', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-token';
  const orderId = 'LIORA-ABC12345-1234ABCD';
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.mercadopago.com/v1/payments/987654321');
    assert.equal(options.headers.Authorization, 'Bearer TEST-token');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 987654321,
        external_reference: orderId,
        status: 'approved',
        status_detail: 'accredited'
      })
    };
  };

  const res = await invoke(paymentStatus, {
    method: 'GET',
    query: { payment_id: '987654321', order_id: orderId }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'approved');

  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 987654321, external_reference: 'LIORA-OUTRO-12345678', status: 'approved' })
  });
  const mismatch = await invoke(paymentStatus, {
    method: 'GET',
    query: { payment_id: '987654321', order_id: orderId }
  });
  assert.equal(mismatch.statusCode, 409);
});
