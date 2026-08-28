'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const createPreference = require('../api/create-preference');
const paymentStatus = require('../api/payment-status');
const catalog = require('../api/catalog');

const originalFetch = global.fetch;
const originalEnv = {
  MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN,
  SITE_URL: process.env.SITE_URL,
  VERCEL_URL: process.env.VERCEL_URL,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL
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
      shipping: { method: 'correios', cost: 0.01 },
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
  let sentPreference;
  global.fetch = async (url, options) => {
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
      { id: 'botanique', qty: 2, frag: 'Lavanda', price: 0.01 },
      { id: 'peonia', qty: 1, price: 999999 }
    ]
  });
  const res = await invoke(createPreference, req);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.total, 176.8);
  assert.equal(sentPreference.metadata.subtotal, 162);
  assert.equal(sentPreference.metadata.total, 176.8);
  assert.equal(sentPreference.shipments.cost, 22.9);
  assert.equal(sentPreference.items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0), 153.9);
  assert.ok(sentPreference.items.every((item) => item.unit_price > 0));
  assert.ok(sentPreference.items.every((item) => !/frete/i.test(item.title)));
  assert.match(sentPreference.external_reference, /^LIORA-/);
  assert.match(sentPreference.back_urls.success, /checkout=return/);
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

test('checkout recusa método ambíguo de transferência e endereço sem número', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-token';
  process.env.SITE_URL = 'https://liora.example';
  global.fetch = async () => { throw new Error('não deveria consultar o Mercado Pago'); };

  const transfer = await invoke(createPreference, validRequest({ payMethod: 'transfer' }));
  assert.equal(transfer.statusCode, 400);
  assert.match(transfer.body.error, /pagamento inválido/);

  const noNumber = await invoke(createPreference, validRequest({
    payer: {
      name: 'Cliente Teste',
      email: 'cliente@example.com',
      cep: '80000-000',
      num: '',
      addr: 'Rua Teste, Curitiba/PR'
    }
  }));
  assert.equal(noNumber.statusCode, 400);
  assert.match(noNumber.body.error, /Endereço de entrega incompleto/);
});

test('checkout publicado usa controles semânticos e resiliência de rede', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /type="radio" name="payment" value="pix"/);
  assert.match(html, /autocomplete="email"/);
  assert.match(html, /autocomplete="postal-code"/);
  assert.match(html, /AbortController/);
  assert.match(html, /checkoutSubmitting/);
  assert.doesNotMatch(html, /value="transfer"/);
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
