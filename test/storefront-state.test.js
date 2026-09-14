'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const products = require('../content/products.json');

function storefront({ saved = {}, blockedStorage = false, search = '', fetch } = {}) {
  const storage = new Map(Object.entries(saved));
  const nodes = new Map();
  const element = (id) => {
    if (['grid', 'tabsBar'].includes(id)) return null;
    if (!nodes.has(id)) nodes.set(id, {
      innerHTML: '', textContent: '', value: '', style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      focus() {}, checkValidity() { return true; }, getAttribute() { return ''; }
    });
    return nodes.get(id);
  };
  const window = {
    LIORA_PRODUCTS: structuredClone(products),
    LIORA_CATEGORIES: [],
    location: { search, pathname: '/', href: 'https://liora.example/' },
    history: { replaceState() {} },
    addEventListener() {}
  };
  const context = vm.createContext({
    window,
    location: window.location,
    document: {
      body: { dataset: {}, style: {} }, title: 'Liora',
      getElementById: element, querySelectorAll: () => [],
      querySelector: element, addEventListener() {}
    },
    sessionStorage: {
      getItem(key) { if (blockedStorage) throw new Error('Storage indisponível'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw new Error('Storage indisponível'); storage.set(key, String(value)); },
      removeItem(key) { if (blockedStorage) throw new Error('Storage indisponível'); storage.delete(key); }
    },
    IntersectionObserver: class { observe() {} unobserve() {} },
    setTimeout() { return 1; }, clearTimeout() {},
    URLSearchParams, TextEncoder,
    fetch: fetch || (async () => { assert.fail('O teste não pode acessar a rede'); })
  });
  // Captura somente a promessa de inicialização para observar falhas assíncronas.
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'storefront.js'), 'utf8')
    .replace('(async function checkPaymentReturn(){', 'globalThis.paymentReturnDone=(async function checkPaymentReturn(){');
  vm.runInContext(source, context, { filename: 'assets/storefront.js' });
  return { storage, nodes, done: context.paymentReturnDone, run: (code) => vm.runInContext(code, context) };
}

test('carrinho atravessa páginas guardando somente ID, quantidade e fragrância', async () => {
  const first = storefront();
  await first.done;
  first.run("addToCart('botanique',1,'Lavanda'); checkoutForm={name:'Cliente Sintético',email:'cliente@example.com',cep:'80000000',num:'100',addr:'Rua de Teste'}; updateCounts();");
  const savedCart = JSON.parse(first.storage.get('liora_cart'));
  assert.deepEqual(savedCart, [{ id: 'botanique', qty: 1, frag: 'Lavanda' }]);
  assert.doesNotMatch(JSON.stringify([...first.storage]), /cliente@example|Rua de Teste|80000000|Cliente Sintético/);

  const next = storefront({ saved: Object.fromEntries(first.storage) });
  await next.done;
  assert.equal(next.run('cartQty()'), 1);
  assert.equal(next.run('subtotal()'), 75);
  assert.equal(next.run('cart[0].frag'), 'Lavanda');
});

test('restauração ignora entradas inválidas e substitui valores gravados pelo catálogo atual', async () => {
  const app = storefront({ saved: { liora_cart: JSON.stringify([
    null,
    { id: 'inexistente', qty: 1 },
    { id: 'botanique', qty: -1 },
    { id: 'botanique', qty: 1.5 },
    { id: 'botanicavasogesso', qty: 1, soldout: false },
    { id: 'botanique', qty: 1, frag: 'Lavanda', price: 0.01, stock: 99, name: 'Nome adulterado', img: 'https://invalido.example/' }
  ]) } });
  await app.done;
  assert.equal(app.run('cartQty()'), 1);
  assert.equal(app.run('subtotal()'), 75);
  assert.equal(app.run('cart[0].name'), products.find((p) => p.id === 'botanique').name);
  assert.equal(app.run('cart[0].img'), '/assets/images/botanique.webp');
});

test('restauração limita o estoque pelo produto, mesmo entre fragrâncias', async () => {
  const app = storefront({ saved: { liora_cart: JSON.stringify([
    { id: 'botanique', qty: 1, frag: 'Lavanda' },
    { id: 'botanique', qty: 9, frag: 'Baunilha' }
  ]) } });
  await app.done;
  assert.equal(app.run('cartQty()'), 2);
  assert.equal(app.run('subtotal()'), 150);
});

test('adição e alteração de quantidade respeitam o estoque agregado das fragrâncias', async () => {
  const app = storefront();
  await app.done;
  app.run("addToCart('botanique',1,'Lavanda'); addToCart('botanique',1,'Baunilha');");
  assert.equal(app.run("addToCart('botanique',1,'Floral')"), false);
  app.run('changeQty(cart[0].key,1)');
  assert.equal(app.run('cartQty()'), 2);
  assert.equal(app.run('cart.length'), 2);
});

test('mudança de carrinho invalida serviço, preço e requisição de frete anterior', async () => {
  const app = storefront();
  await app.done;
  app.run("addToCart('botanique',1,'Lavanda'); shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9}],cep:'80000000'}; selectedShippingService='curitiba-fixed'; shippingRequestId=10;");
  app.run("addToCart('botanique',1,'Baunilha')");
  assert.equal(app.run('selectedShippingService'), '');
  assert.equal(app.run('shippingState.quotes.length'), 0);
  assert.equal(app.run('shippingState.status'), 'idle');
  assert.ok(app.run('shippingRequestId') > 10);
});

test('resposta atrasada de frete não repõe endereço e cotação depois de apagar um dígito do CEP', async () => {
  const requests = new Map();
  const app = storefront({
    fetch: (url) => new Promise((resolve) => requests.set(url, resolve))
  });
  await app.done;
  app.run("addToCart('botanique',1); checkoutForm.cep='80000-000'; checkoutForm.addr='Endereço informado pelo cliente';");
  const quoteDone = app.run("buscarCEP('80000000')");
  assert.equal(requests.size, 2);
  app.run("maskCEP({value:'80000-00'})");

  requests.get('https://viacep.com.br/ws/80000000/json/')({
    json: async () => ({ logradouro: 'Rua anterior', bairro: 'Centro', localidade: 'Curitiba', uf: 'PR' })
  });
  requests.get('/api/shipping-quote')({
    ok: true,
    json: async () => ({ quotes: [{ id: 'curitiba-fixed', price: 19.9 }] })
  });
  await quoteDone;

  assert.equal(app.run('checkoutForm.cep'), '80000-00');
  assert.equal(app.run('checkoutForm.addr'), 'Endereço informado pelo cliente');
  assert.equal(app.run('shippingState.status'), 'idle');
  assert.equal(app.run('shippingState.quotes.length'), 0);
  assert.equal(app.run('selectedShippingService'), '');
});

test('fragrância é exibida como texto e não altera os comandos do carrinho', async () => {
  const app = storefront();
  await app.done;
  app.run(`addToCart('botanique',1,${JSON.stringify("Flor d'água <suave>")}); renderDrawer();`);
  assert.doesNotMatch(app.run('cart[0].key'), /[<>"']/);
  const html = app.nodes.get('drawerBody').innerHTML;
  assert.match(html, /Flor d&#39;água &lt;suave&gt;/);
  assert.doesNotMatch(html, /<suave>/);
});

test('storage bloqueado e JSON corrompido não impedem comprar durante a sessão', async () => {
  for (const options of [
    { blockedStorage: true },
    { saved: { liora_cart: '{json-invalido' } }
  ]) {
    const app = storefront(options);
    await assert.doesNotReject(app.done);
    assert.equal(app.run("addToCart('botanique',1,'Lavanda')"), true);
    assert.equal(app.run('cartQty()'), 1);
  }
});

for (const status of ['approved', 'pending', 'rejected']) {
  test(`retorno ${status} só limpa o carrinho quando a API confirma aprovação`, async () => {
    let calls = 0;
    const app = storefront({
      saved: { liora_cart: JSON.stringify([{ id: 'botanique', qty: 1, frag: 'Lavanda' }]) },
      search: '?checkout=return&payment_id=123&order_id=LIORA-TESTE-12345678',
      fetch: async (url) => {
        calls += 1;
        assert.match(url, /^\/api\/payment-status\?/);
        return { ok: true, json: async () => ({ status }) };
      }
    });
    await app.done;
    assert.equal(calls, 1);
    assert.equal(app.run('cartQty()'), status === 'approved' ? 0 : 1);
    assert.equal(JSON.parse(app.storage.get('liora_cart')).length, status === 'approved' ? 0 : 1);
  });
}
