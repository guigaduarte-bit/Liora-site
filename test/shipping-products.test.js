'use strict';

const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const catalog = require('../api/catalog');
const products = require('../content/products.json');
const shippingData = require('../content/shipping-products.json');
const { loadApi, confirmedShipping } = require('./helpers/isolated-api.cjs');

const originalFetch = global.fetch;
const environmentKeys = ['SUPERFRETE_TOKEN', 'SHIP_ORIGIN_CEP', 'SUPERFRETE_BASE_URL', 'SUPERFRETE_SERVICES', 'SITE_URL', 'MP_ACCESS_TOKEN'];
const originalEnv = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of environmentKeys) delete process.env[key];
  global.fetch = async () => assert.fail('Este teste não permite chamadas externas');
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureShipping() {
  process.env.SUPERFRETE_TOKEN = 'fixture-token';
  process.env.SHIP_ORIGIN_CEP = '80000000';
}

function fixtureData() {
  return {
    ursinho: confirmedShipping({ weightGrams: 33 }),
    peonia: confirmedShipping({ weightGrams: 100 })
  };
}

async function invoke(handler, body) {
  const response = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; }
  };
  await handler({ method: 'POST', body }, response);
  return response;
}

test('dados extraídos cobrem todos os SKUs e não aprovam pesos comerciais para expedição', () => {
  assert.deepEqual(Object.keys(shippingData).sort(), Object.keys(catalog).sort());
  assert.equal(Object.values(shippingData).filter((item) => item.weightGrams !== null).length, 26);
  assert.equal(Object.values(shippingData).filter((item) => item.dimensionsCm !== null).length, 24);
  for (const product of products) {
    const data = shippingData[product.id];
    assert.equal(data.confirmedForShipping, false);
    assert.equal(data.packingWeightGrams, null);
    assert.equal(data.shippingDimensionsCm, null);
    assert.deepEqual(data.source, { file: 'content/products.json', field: 'dims', text: product.dims });
  }
  assert.equal(shippingData.botanique.weightGrams, 475);
  assert.deepEqual(shippingData.botanique.dimensionsCm, { length: 9, width: 9, height: 16 });
  assert.equal(shippingData['botanique-150-gr-1gyzj'].weightGrams, null);
  assert.equal(shippingData['vela-decorativa-anjo-em-vitral-1sbe9'].dimensionsCm, null, 'duas medidas não definem um volume');
  assert.deepEqual(shippingData['kit-silhouette'].dimensionsCm, { length: 8, width: 6, height: 13 });
});

test('produtos somam fragrâncias por SKU e convertem gramas em kg sem arredondamento monetário', () => {
  const { buildShippingProducts } = loadApi('_shipping-products.js', { shippingProducts: fixtureData() });
  const result = buildShippingProducts([
    { id: 'ursinho', quantity: 2, fragrance: 'Lavanda', weight: 99 },
    { id: 'peonia', quantity: 1 },
    { id: 'ursinho', quantity: 3, fragrance: 'Baunilha' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { quantity: 5, weight: 0.058, height: 8, width: 9, length: 10 },
    { quantity: 1, weight: 0.125, height: 8, width: 9, length: 10 }
  ]);
  const totalKilograms = result.reduce((sum, item) => sum + item.weight * item.quantity, 0);
  assert.ok(Math.abs(totalKilograms - 0.415) < 1e-9, 'o carrinho soma 415 gramas com a proteção homologada');
});

for (const [label, invalid] of [
  ['peso ausente', { weightGrams: null }],
  ['peso da proteção ausente', { packingWeightGrams: null }],
  ['medidas incompletas', { dimensionsCm: { length: 8, width: 7 } }],
  ['medidas protegidas ausentes', { shippingDimensionsCm: null }],
  ['dimensões menores que a peça', { shippingDimensionsCm: { length: 1, width: 1, height: 1 } }],
  ['confirmação ausente', { confirmedForShipping: false }],
  ['peso em texto', { weightGrams: '100' }]
]) {
  test(`frete impede cotação parcial: ${label}`, async () => {
    configureShipping();
    const data = fixtureData();
    data.peonia = confirmedShipping(invalid);
    const handler = loadApi('shipping-quote.js', { shippingProducts: data });
    const response = await invoke(handler, {
      cep: '20020050',
      items: [{ id: 'ursinho', qty: 1 }, { id: 'peonia', qty: 1 }]
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'SHIPPING_DATA_INCOMPLETE');
    assert.match(response.body.error, /frete.*configurado/i);
    assert.equal(response.body.quotes, undefined);
  });
}

test('endpoint usa pesos do servidor e envia products completo, sem package e sem dados pessoais', async () => {
  configureShipping();
  let request;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.superfrete.com/api/v0/calculator');
    request = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => [{ id: 1, name: 'PAC', price: 26.4, delivery_time: 5 }] };
  };
  const handler = loadApi('shipping-quote.js', { shippingProducts: fixtureData() });
  const response = await invoke(handler, {
    cep: '20020-050',
    name: 'Dado que não deve sair na cotação',
    email: 'nao-enviar@example.com',
    items: [
      { id: 'ursinho', qty: 2, frag: 'Lavanda', weight: 0.001, weightGrams: 1, dimensionsCm: { length: 1, width: 1, height: 1 } },
      { id: 'ursinho', qty: 3, frag: 'Baunilha', price: 0.01, confirmedForShipping: true },
      { id: 'peonia', qty: 1 }
    ]
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(request.products, [
    { quantity: 5, weight: 0.058, height: 8, width: 9, length: 10 },
    { quantity: 1, weight: 0.125, height: 8, width: 9, length: 10 }
  ]);
  assert.equal(Object.hasOwn(request, 'package'), false);
  assert.equal(request.options.insurance_value, 62);
  assert.equal(request.options.use_insurance_value, true);
  assert.deepEqual(request.from, { postal_code: '80000000' });
  assert.deepEqual(request.to, { postal_code: '20020050' });
  assert.doesNotMatch(JSON.stringify(request), /nao-enviar|Dado que|Lavanda|Baunilha/);
});

test('produto sem registro impede chamada ao provedor mesmo com metadados falsos no navegador', async () => {
  configureShipping();
  const handler = loadApi('shipping-quote.js', { shippingProducts: {} });
  const response = await invoke(handler, {
    cep: '20020050', items: [{ id: 'ursinho', qty: 1, ...confirmedShipping() }]
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'SHIPPING_DATA_INCOMPLETE');
});

test('estoque continua agregado por SKU antes da cotação por peso', async () => {
  configureShipping();
  const handler = loadApi('shipping-quote.js', { shippingProducts: fixtureData() });
  const response = await invoke(handler, {
    cep: '20020050', items: [{ id: 'ursinho', qty: 20, frag: 'Lavanda' }, { id: 'ursinho', qty: 11, frag: 'Baunilha' }]
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /Estoque insuficiente/);
});

test('sem credenciais mantém demonstração; dados pendentes nunca são enviados ao provedor', async () => {
  const response = await invoke(loadApi('shipping-quote.js'), {
    cep: '20020050', items: [{ id: 'botanique', qty: 1 }]
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.preview, true);
  assert.ok(response.body.quotes.every((quote) => quote.preview));
});

test('dados pendentes preservam entrega Curitiba de R$ 19,90 e gratuidade em R$ 150', async () => {
  configureShipping();
  const handler = loadApi('shipping-quote.js');
  for (const quantity of [1, 2]) {
    const response = await invoke(handler, {
      cep: '80020000', items: [{ id: 'botanique', qty: quantity }]
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.preview, false);
    assert.equal(response.body.quotes.length, 1);
    assert.equal(response.body.quotes[0].id, 'curitiba-fixed');
    assert.equal(response.body.quotes[0].price, quantity === 1 ? 19.9 : 0);
    assert.equal(response.body.freeShipping, quantity === 2);
  }
});

test('checkout recusa frete incompleto antes de iniciar pagamento e devolve o erro de configuração', async () => {
  configureShipping();
  process.env.SITE_URL = 'https://liora.example';
  process.env.MP_ACCESS_TOKEN = 'fixture-mercadopago';
  const response = await invoke(loadApi('create-preference.js'), {
    items: [{ id: 'botanique', qty: 1 }],
    payMethod: 'pix',
    shipping: { method: 'delivery', serviceId: '1' },
    payer: { name: 'Cliente Sintético', email: 'cliente@example.com', cep: '20020050', addr: 'Rua de Teste', num: '100' }
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'SHIPPING_DATA_INCOMPLETE');
  assert.equal(response.body.init_point, undefined);
});
