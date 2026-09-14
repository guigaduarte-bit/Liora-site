'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const productionCatalog = require('../api/catalog');

const apiDirectory = path.join(__dirname, '..', 'api');

// O catálogo atual usa preços inteiros. Um catálogo sintético permite verificar
// os centavos do limite sem alterar produtos reais ou carregar credenciais.
// Os handlers e a regra de frete executados continuam sendo os arquivos reais.
function isolatedApi(filename, options = {}) {
  const sourcePath = path.join(apiDirectory, filename);
  const nativeRequire = createRequire(sourcePath);
  const module = { exports: {} };
  const fetch = options.fetch || (async () => {
    assert.fail('Este teste não pode realizar chamadas externas');
  });
  const context = {
    module,
    exports: module.exports,
    Buffer,
    URL,
    console,
    fetch,
    process: {
      env: {
        SITE_URL: 'https://liora.example',
        MP_ACCESS_TOKEN: 'TEST-token-sintetico'
      }
    },
    require(specifier) {
      if (specifier === './catalog') return options.catalog || productionCatalog;
      if (specifier === './_shipping') return isolatedApi('_shipping.js', options);
      return nativeRequire(specifier);
    }
  };
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context, {
    filename: sourcePath
  });
  return module.exports;
}

async function invoke(handler, body) {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  await handler({ method: 'POST', body }, res);
  return res;
}

function checkoutBody(items, payMethod = 'pix', cep = '80000-000') {
  return {
    items,
    payMethod,
    shipping: { method: 'delivery', serviceId: 'curitiba-fixed' },
    payer: {
      name: 'Cliente Sintético',
      email: 'cliente@example.com',
      cep,
      num: '100',
      addr: 'Rua de Teste, Curitiba/PR'
    }
  };
}

const boundaries = [
  { subtotal: 149.99, shipping: 19.9, pixProducts: 142.49, pixTotal: 162.39, cardTotal: 169.89 },
  { subtotal: 150, shipping: 0, pixProducts: 142.5, pixTotal: 142.5, cardTotal: 150 },
  { subtotal: 150.01, shipping: 0, pixProducts: 142.51, pixTotal: 142.51, cardTotal: 150.01 }
];

for (const boundary of boundaries) {
  for (const payMethod of ['pix', 'card']) {
    test(`frete em R$ ${boundary.subtotal.toFixed(2)} com ${payMethod}: limite antes do desconto`, async () => {
      let sentPreference;
      let calls = 0;
      const handler = isolatedApi('create-preference.js', {
        catalog: {
          'produto-limite': { name: 'Produto sintético do limite', price: boundary.subtotal, stock: 1 }
        },
        fetch: async (url, options) => {
          calls += 1;
          assert.equal(url, 'https://api.mercadopago.com/checkout/preferences');
          sentPreference = JSON.parse(options.body);
          return {
            ok: true,
            status: 201,
            json: async () => ({ id: 'pref-sintetica', init_point: 'https://pagamento.example/teste' })
          };
        }
      });
      const res = await invoke(handler, checkoutBody([
        { id: 'produto-limite', qty: 1, price: 0.01 }
      ], payMethod));

      assert.equal(res.statusCode, 200);
      assert.equal(calls, 1);
      assert.equal(sentPreference.metadata.subtotal, boundary.subtotal);
      assert.equal(sentPreference.shipments.cost, boundary.shipping);
      const products = sentPreference.items.reduce((total, item) => total + item.unit_price * item.quantity, 0);
      assert.equal(products, payMethod === 'pix' ? boundary.pixProducts : boundary.subtotal);
      assert.equal(res.body.total, payMethod === 'pix' ? boundary.pixTotal : boundary.cardTotal);
      assert.equal(sentPreference.metadata.total, res.body.total);
      assert.equal(res.headers['cache-control'], 'no-store');
    });
  }
}

test('fragrâncias compartilham estoque: aceita o limite e rejeita excedente na cotação e no checkout', async () => {
  const options = {
    fetch: async (url) => {
      assert.equal(url, 'https://api.mercadopago.com/checkout/preferences');
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 'pref-variantes', init_point: 'https://pagamento.example/teste' })
      };
    }
  };
  const atStock = [
    { id: 'botanique', qty: 1, frag: 'Lavanda' },
    { id: 'botanique', qty: 1, frag: 'Baunilha' }
  ];
  const overStock = [...atStock, { id: 'botanique', qty: 1, frag: 'Flor de cerejeira' }];
  assert.equal(productionCatalog.botanique.stock, 2, 'atualize o cenário se o estoque-base mudar');

  const quote = isolatedApi('shipping-quote.js', options);
  const acceptedQuote = await invoke(quote, { cep: '80000-000', items: atStock });
  assert.equal(acceptedQuote.statusCode, 200);
  assert.equal(acceptedQuote.body.freeShipping, true);
  const rejectedQuote = await invoke(quote, { cep: '80000-000', items: overStock });
  assert.equal(rejectedQuote.statusCode, 400);
  assert.match(rejectedQuote.body.error, /Estoque insuficiente/);

  const checkout = isolatedApi('create-preference.js', options);
  const acceptedCheckout = await invoke(checkout, checkoutBody(atStock));
  assert.equal(acceptedCheckout.statusCode, 200);
  assert.equal(acceptedCheckout.body.total, 142.5);
  const rejectedCheckout = await invoke(checkout, checkoutBody(overStock));
  assert.equal(rejectedCheckout.statusCode, 400);
  assert.match(rejectedCheckout.body.error, /Estoque insuficiente/);
});

test('produto esgotado em carrinho restaurado continua bloqueado na cotação e no pagamento', async () => {
  const items = [{ id: 'botanicavasogesso', qty: 1, price: 0.01, stock: 99, soldout: false }];
  const quote = await invoke(isolatedApi('shipping-quote.js'), { cep: '80000-000', items });
  const checkout = await invoke(isolatedApi('create-preference.js'), checkoutBody(items));
  assert.equal(quote.statusCode, 400);
  assert.equal(checkout.statusCode, 400);
  assert.match(quote.body.error, /indisponível/i);
  assert.match(checkout.body.error, /não está disponível/i);
});

test('cotação demonstrativa não permite iniciar pagamento, mesmo com frete grátis', async () => {
  const body = checkoutBody([{ id: 'botanique', qty: 2 }], 'pix', '20000-000');
  body.shipping.serviceId = 'preview-pac';
  const res = await invoke(isolatedApi('create-preference.js'), body);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /cotação real/i);
});
