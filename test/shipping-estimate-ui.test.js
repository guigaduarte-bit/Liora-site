'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const products = require('../content/products.json');

function storefront(quote, fetchOverride) {
  const nodes = new Map();
  const element = id => {
    if (['grid', 'tabsBar'].includes(id)) return null;
    if (!nodes.has(id)) nodes.set(id, {
      innerHTML: '', textContent: '', value: '', style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      focus() {}, setSelectionRange() {}, checkValidity() { return true; }, getAttribute() { return ''; }
    });
    return nodes.get(id);
  };
  const window = {
    LIORA_PRODUCTS: structuredClone(products), LIORA_CATEGORIES: [],
    location: { search: '', pathname: '/', href: 'https://liora.example/' },
    history: { replaceState() {} }, addEventListener() {}
  };
  const calls = [];
  const context = vm.createContext({
    window, location: window.location,
    document: {
      body: { dataset: {}, style: {} }, title: 'Liora', getElementById: element,
      querySelectorAll: () => [], querySelector: element, addEventListener() {}
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    IntersectionObserver: class { observe() {} unobserve() {} },
    setTimeout() { return 1; }, clearTimeout() {}, URLSearchParams, TextEncoder,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (fetchOverride) return fetchOverride(url, options);
      if (url.startsWith('https://viacep.com.br/')) return { json: async () => ({ localidade: 'São Paulo', uf: 'SP' }) };
      assert.equal(url, '/api/shipping-quote', 'Nenhuma cobrança deve ser iniciada pelos testes');
      return { ok: true, json: async () => quote };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'storefront.js'), 'utf8'), context);
  return { nodes, calls, run: code => vm.runInContext(code, context) };
}

const packaging = {
  status: 'estimated', totalWeightGrams: 875, pieceCount: 1,
  parcels: [{
    boxCode: 'G20', dimensionsCm: { length: 32, width: 24, height: 20 },
    itemsWeightGrams: 475, boxWeightGrams: 300, protectionWeightGrams: 100,
    totalWeightGrams: 875, items: [{ id: 'botanique', quantity: 1 }]
  }], issues: []
};

test('cotação sem serviço exibe peso e embalagem, sem dizer entrega calculada ou pedir novamente o CEP', async () => {
  const app = storefront({ quotes: [], packaging, notice: 'A embalagem foi estimada; a cotação do transporte ainda não está disponível.' });
  app.run("addToCart('botanique',1); checkoutForm.cep='01001-000';");
  await app.run("buscarCEP('01001000')");
  const html = app.nodes.get('drawerBody').innerHTML;
  assert.match(html, /Estimativa de embalagem · conferência pendente/);
  assert.match(html, /1 caixa · 875 g no total/);
  assert.match(html, /475 g/);
  assert.match(html, /Caixa vazia<\/dt><dd>300 g/);
  assert.match(html, /Proteção e fechamento<\/dt><dd>100 g/);
  assert.match(html, /32 × 24 × 20 cm/);
  assert.match(html, /a cotação do transporte ainda não está disponível/);
  assert.doesNotMatch(html, /Entrega calculada para este CEP|Informe o CEP para calcular/);
  assert.match(app.nodes.get('drawerFoot').innerHTML, /onclick="confirmOrder\(\)" disabled/);
});

test('opção estimada impede pagamento na interface e na função de confirmação', async () => {
  const app = storefront({
    quotes: [{ id: 'pac', name: 'PAC', carrier: 'Correios', price: 27.5, deliveryDays: 5, preview: true, estimated: true }],
    preview: true, packaging
  });
  app.run("addToCart('botanique',1)");
  await app.run("buscarCEP('01001000')");
  assert.match(app.nodes.get('drawerBody').innerHTML, /Cotação de teste com peso e embalagem estimados/);
  assert.doesNotMatch(app.nodes.get('drawerBody').innerHTML, /Opções demonstrativas/);
  assert.match(app.nodes.get('drawerFoot').innerHTML, /Total estimado/);
  assert.match(app.nodes.get('drawerFoot').innerHTML, /onclick="confirmOrder\(\)" disabled/);
  await app.run('confirmOrder()');
  assert.equal(app.calls.length, 2);
  assert.match(app.nodes.get('toastMsg').textContent, /Esta opção é uma simulação/);
});

test('Curitiba preserva gratuidade no limite de R$150 e desconto Pix mesmo com embalagem estimada', async () => {
  const app = storefront({
    quotes: [{ id: 'curitiba-free', name: 'Entrega Curitiba', carrier: 'Liora', price: 0, preview: false }],
    preview: true, packaging: { ...packaging, totalWeightGrams: 1400 }
  });
  app.run("addToCart('botanique',2)");
  await app.run("buscarCEP('80010000')");
  const body = app.nodes.get('drawerBody').innerHTML;
  const foot = app.nodes.get('drawerFoot').innerHTML;
  assert.match(body, /Entrega calculada para este CEP/);
  assert.doesNotMatch(body, /Opções demonstrativas|Cotação de teste/);
  assert.match(foot, /Grátis/);
  assert.match(foot, /142,50/);
  assert.doesNotMatch(foot, /onclick="confirmOrder\(\)" disabled|Total estimado/);
});

test('dados incompletos nomeiam o produto e nunca apresentam soma parcial como peso do pedido', async () => {
  const id = 'botanique-150-gr-1gyzj';
  const app = storefront({
    quotes: [], notice: 'Complete os dados de embalagem.',
    packaging: { ...packaging, status: 'incomplete', issues: [{ id, message: 'Peso total e medidas pendentes.' }] }
  });
  app.run("addToCart('botanique',1)");
  await app.run("buscarCEP('01001000')");
  const html = app.nodes.get('drawerBody').innerHTML;
  assert.ok(html.includes(products.find(p => p.id === id).displayName || products.find(p => p.id === id).name));
  assert.match(html, /Peso total e medidas pendentes/);
  assert.doesNotMatch(html, /875 g|475 g|caixa ·/);
});

test('mudar carrinho ou apagar CEP retira imediatamente a estimativa anterior', async () => {
  const app = storefront({ quotes: [], packaging });
  app.run("addToCart('botanique',1)");
  await app.run("buscarCEP('01001000')");
  assert.match(app.nodes.get('drawerBody').innerHTML, /875 g/);
  app.run("maskCEP({value:'01001-00',selectionStart:8})");
  assert.equal(app.run('shippingState.packaging'), null);
  assert.doesNotMatch(app.nodes.get('drawerBody').innerHTML, /875 g|Estimativa de embalagem/);
  await app.run("buscarCEP('01001000')");
  app.run("addToCart('ursinho',1);renderCheckout();");
  assert.equal(app.run('shippingState.packaging'), null);
  assert.doesNotMatch(app.nodes.get('drawerBody').innerHTML, /875 g|Estimativa de embalagem/);
});

test('resposta atrasada não restaura embalagem após a alteração do carrinho', async () => {
  const pending = new Map();
  const app = storefront(null, url => new Promise(resolve => pending.set(url, resolve)));
  app.run("addToCart('botanique',1)");
  const done = app.run("buscarCEP('01001000')");
  app.run("addToCart('ursinho',1)");
  pending.get('https://viacep.com.br/ws/01001000/json/')({ json: async () => ({ localidade: 'São Paulo', uf: 'SP' }) });
  pending.get('/api/shipping-quote')({ ok: true, json: async () => ({ quotes: [], packaging }) });
  await done;
  assert.equal(app.run('shippingState.packaging'), null);
  assert.equal(app.run('shippingState.status'), 'idle');
});

test('respostas de produção sem embalagem não acrescentam o bloco de simulação', async () => {
  const app = storefront({ quotes: [{ id: 'curitiba-fixed', name: 'Entrega Curitiba', carrier: 'Liora', price: 19.9 }] });
  app.run("addToCart('ursinho',1)");
  await app.run("buscarCEP('80010000')");
  assert.doesNotMatch(app.nodes.get('drawerBody').innerHTML, /packaging-estimate|conferência pendente/);
});

test('avisos e problemas da embalagem são escapados como texto', async () => {
  const app = storefront({
    quotes: [], notice: '<img src=x onerror=alert(1)>',
    packaging: { status: 'unavailable', issues: [{ id: 'botanique', message: '<script>alert(1)</script>' }] }
  });
  app.run("addToCart('botanique',1)");
  await app.run("buscarCEP('01001000')");
  const html = app.nodes.get('drawerBody').innerHTML;
  assert.doesNotMatch(html, /<img src=x|<script>/);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /&lt;script&gt;/);
});
