'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const products = require('../content/products.json');

function storefront({ saved = {}, blockedStorage = false, search = '', fetch, environment = 'production', checkoutV2 = false } = {}) {
  const storage = new Map(Object.entries(saved));
  const nodes = new Map();
  const windowEvents = new Map();
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
    LIORA_PAYMENT_ENVIRONMENT: environment,
    LIORA_CHECKOUT_V2: checkoutV2,
    LIORA_PAYMENT_POLICY: { maxInstallments: 3, interestFreeInstallments: 0 },
    crypto: require('node:crypto').webcrypto,
    location: { search, pathname: '/', href: 'https://liora.example/', origin: 'https://liora.example' },
    history: { replaceState() {} },
    addEventListener(name, handler) { windowEvents.set(name,handler); }
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
    URL, URLSearchParams, TextEncoder, Uint8Array,
    fetch: fetch || (async () => { assert.fail('O teste não pode acessar a rede'); })
  });
  // Captura somente a promessa de inicialização para observar falhas assíncronas.
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'storefront.js'), 'utf8')
    .replace('(async function checkPaymentReturn(){', 'globalThis.paymentReturnDone=(async function checkPaymentReturn(){');
  vm.runInContext(source, context, { filename: 'assets/storefront.js' });
  return { storage, nodes, done: context.paymentReturnDone, emit: (name,event) => windowEvents.get(name)?.(event), run: (code) => vm.runInContext(code, context) };
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

test('reabrir checkout após mudar quantidade recalcula uma vez com CEP preservado e carrinho atual', async () => {
  const requests = [];
  const app = storefront({ fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })) });
  await app.done;
  app.run("addToCart('botanique',1); checkoutForm.cep='95900-180'; shippingState={status:'ready',quotes:[{id:'1',price:30.39}],cep:'95900180'}; selectedShippingService='1'; drawerView='cart'; changeQty(cart[0].key,1);");
  assert.equal(app.run('shippingState.status'), 'idle');
  const quoteDone = app.run("drawerView='checkout';renderCheckout()");
  app.run('renderCheckout()');
  assert.equal(app.run('shippingState.status'), 'loading');
  const shippingRequests = requests.filter(request => request.url === '/api/shipping-quote');
  assert.equal(shippingRequests.length, 1);
  assert.deepEqual(JSON.parse(shippingRequests[0].options.body), { cep: '95900180', items: [{ id: 'botanique', qty: 2 }] });
  requests.find(request => request.url.includes('viacep')).resolve({ json: async () => ({ erro: true }) });
  shippingRequests[0].resolve({ ok: true, json: async () => ({ quotes: [{ id: '1', price: 0, preview: true }] }) });
  await quoteDone;
  assert.equal(app.run('shippingState.status'), 'ready');
  assert.equal(app.run('checkoutForm.cep'), '95900-180');
  assert.equal(app.run('selectedShippingService'), '1');
  assert.equal(requests.filter(request => request.url === '/api/shipping-quote').length, 1);
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

for (const status of ['approved', 'pending', 'rejected', 'review_required']) {
  test(`retorno ${status} só limpa o carrinho quando a API confirma aprovação`, async () => {
    let calls = 0;
    const app = storefront({
      saved: { liora_cart: JSON.stringify([{ id: 'botanique', qty: 1, frag: 'Lavanda' }]), 'liora_checkout_proof:LIORA-TESTE-12345678': 'synthetic-proof' },
      search: '?checkout=return&payment_id=123&order_id=LIORA-TESTE-12345678',
      fetch: async (url, options) => {
        assert.equal(options.headers['X-Checkout-Proof'], 'synthetic-proof');
        calls += 1;
        assert.match(url, /^\/api\/payment-status\?/);
        return { ok: true, json: async () => ({ status, order_id: 'LIORA-TESTE-12345678' }) };
      }
    });
    await app.done;
    assert.equal(calls, 1);
    assert.equal(app.run('cartQty()'), status === 'approved' ? 0 : 1);
    assert.equal(JSON.parse(app.storage.get('liora_cart')).length, status === 'approved' ? 0 : 1);
  });
}

test('retorno sem comprovante assinado preserva carrinho e não consulta pagamento', async () => {
  const app = storefront({
    saved: { liora_cart: JSON.stringify([{ id: 'botanique', qty: 1 }]) },
    search: '?checkout=return&payment_id=123&order_id=LIORA-TESTE-12345678'
  });
  await app.done;
  assert.equal(app.run('cartQty()'), 1);
  assert.match(app.nodes.get('toastMsg').textContent, /Confira a situação no provedor/);
});

test('checkout transmite origem e guarda comprovante sem persistir dados pessoais', async () => {
  let sent;
  const app = storefront({ fetch: async (url, options) => {
    assert.equal(url, '/api/create-preference');
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ init_point: 'https://www.mercadopago.com.br/checkout/teste', order_id: 'LIORA-TESTE-12345678', checkout_proof: 'signed-fixture' }) };
  } });
  await app.done;
  app.run("addToCart('botanique',1); shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9,preview:false,quoteProof:'signed-shipping-fixture'}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Cliente Fictício'; $('fE').value='cliente@example.com'; $('fC').value='80000000'; $('fNum').value='100'; $('fA').value='Rua Fictícia';");
  await app.run('confirmOrder()');
  assert.equal(sent.returnOrigin, 'https://liora.example');
  assert.equal(sent.shipping.quoteProof, 'signed-shipping-fixture');
  assert.equal(app.storage.get('liora_checkout_proof:LIORA-TESTE-12345678'), 'signed-fixture');
  assert.doesNotMatch(JSON.stringify([...app.storage]), /cliente@example|Fictício|Fictícia|80000000/);
});

test('navegador sem armazenamento não cria pagamento sem conseguir guardar o comprovante', async () => {
  const app = storefront({ blockedStorage: true });
  await app.done;
  app.run("addToCart('botanique',1); shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9,preview:false}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Teste'; $('fE').value='teste@example.com'; $('fC').value='80000000'; $('fA').value='Rua Fictícia';");
  await app.run('confirmOrder()');
  assert.match(app.nodes.get('toastMsg').textContent, /armazenamento desta sessão/);
});

test('checkout Pix exibe desconto e total consistentes em limites de centavos', async () => {
  const app = storefront();
  await app.done;
  for (const [price, expectedDiscount, expectedTotal] of [[19.9, 1, 38.8], [34.5, 1.73, 52.67], [149.9, 7.5, 162.3], [150, 7.5, 142.5]]) {
    app.run(`cart=[{id:'botanique',qty:1,price:${price}}]; payMethod='pix'; shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:${price >= 150 ? 0 : 19.9}}]}; selectedShippingService='curitiba-fixed'; renderCheckout();`);
    const footer = app.nodes.get('drawerFoot').innerHTML;
    assert.ok(footer.includes(`− ${app.run(`money(${expectedDiscount})`)}`));
    assert.ok(footer.includes(`Pagar com Pix · ${app.run(`money(${expectedTotal})`)}`));
  }
});

test('envios simultâneos do checkout geram uma única solicitação e preservam o método', async () => {
  let calls = 0, sent, resolve;
  const response = new Promise(done => { resolve = done; });
  const app = storefront({ fetch: async (url, options) => { calls++; sent=JSON.parse(options.body); return response; } });
  await app.done;
  app.run("addToCart('botanique',1); shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Cliente Fictício'; $('fE').value='cliente@example.com'; $('fC').value='80000000'; $('fNum').value='100'; $('fA').value='Rua Fictícia';");
  const first = app.run('confirmOrder()');
  app.run("selectPayment('card')");
  assert.equal(app.run('payMethod'),'pix');
  const second = app.run('confirmOrder()');
  resolve({ok:true,json:async()=>({init_point:'https://www.mercadopago.com.br/checkout/teste',order_id:'LIORA-TESTE-12345678',checkout_proof:'signed-fixture'})});
  await Promise.all([first,second]);
  assert.equal(calls,1);
  assert.equal(sent.payMethod,'pix');
});

test('falha na criação permite uma nova tentativa sem apagar o carrinho', async () => {
  let calls = 0;
  const app = storefront({ fetch:async()=>{ calls++; return {ok:false,json:async()=>({error:'Tente novamente.'})}; } });
  await app.done;
  app.run("addToCart('botanique',1); shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Teste'; $('fE').value='teste@example.com'; $('fC').value='80000000'; $('fA').value='Rua Fictícia';");
  await app.run('confirmOrder()');
  await app.run('confirmOrder()');
  assert.equal(calls,2);
  assert.equal(app.run('cartQty()'),1);
});

test('InfinitePay é adicional em produção e permanece indisponível no preview', async () => {
  for(const environment of ['production','preview']) {
    const app=storefront({environment}); await app.done;
    app.run("addToCart('botanique',1); shippingState={status:'ready',quotes:[]}; renderCheckout();");
    for(const method of ['pix','card','boleto']) assert.match(app.nodes.get('drawerBody').innerHTML,new RegExp('id="payment-'+method+'"'));
    app.run("selectPayment('infinitepay')");
    assert.equal(app.run('payMethod'),environment==='production'?'infinitepay':'pix');
    if(environment==='production')assert.match(app.nodes.get('drawerBody').innerHTML,/id="payment-infinitepay"/);
    else {
      assert.doesNotMatch(app.nodes.get('drawerBody').innerHTML,/id="payment-infinitepay"/);
      app.run("payMethod='infinitepay'"); await app.run('confirmOrder()');
      assert.match(app.nodes.get('toastMsg').textContent,/formas de pagamento disponíveis/);
    }
  }
});

test('aprovação de teste é identificada e pendência não promete e-mail inexistente', async () => {
  for (const status of ['approved', 'pending']) {
    const app = storefront({
      saved: { 'liora_checkout_proof:LIORA-TESTE-12345678': 'synthetic-proof' },
      search: '?checkout=return&payment_id=123&order_id=LIORA-TESTE-12345678',
      fetch: async () => ({ ok: true, json: async () => ({ status, payment_mode: 'test', order_id: 'LIORA-TESTE-12345678' }) })
    });
    await app.done;
    assert.doesNotMatch(app.nodes.get('toastMsg').textContent, /e-mail|avisaremos/);
    if (status === 'approved') {
      assert.match(app.nodes.get('toastMsg').textContent, /teste aprovado/);
      assert.equal(app.storage.get('liora_checkout_proof:LIORA-TESTE-12345678'), undefined);
    } else assert.equal(app.storage.get('liora_checkout_proof:LIORA-TESTE-12345678'), 'synthetic-proof');
  }
});

test('falha no retorno permite consultar o mesmo pagamento e limpar somente itens comprados', async () => {
  let calls = 0;
  const requests = [];
  const app = storefront({
    saved: { liora_cart: JSON.stringify([{ id: 'botanique', qty: 1, frag: 'Lavanda' }]), 'liora_checkout_proof:LIORA-TESTE-12345678': 'synthetic-proof' },
    search: '?checkout=return&payment_id=123&order_id=LIORA-TESTE-12345678',
    fetch: async (url, options) => {
      requests.push(url); assert.equal(options.method, undefined); calls++;
      return { ok: calls > 1, json: async () => ({ status: 'approved', order_id: 'LIORA-TESTE-12345678' }) };
    }
  });
  await app.done;
  assert.equal(app.run('cartQty()'), 1);
  assert.match(app.nodes.get('drawerBody').innerHTML, /Verificar pagamento novamente/);
  app.run("addToCart('mini-bubble',1,'');");
  await app.run('retryPaymentConfirmation()');
  assert.equal(requests[0], requests[1]);
  assert.equal(app.run('cartQty()'), 1);
  assert.equal(app.run('cart[0].id'), 'mini-bubble');
  assert.match(app.nodes.get('drawerBody').innerHTML, /Pagamento confirmado/);
  await app.run('retryPaymentConfirmation()');
  assert.equal(calls, 2);
  assert.equal(app.run('cartQty()'), 1);
});

test('recarregar após falha recupera a referência removida da URL sem nova cobrança', async () => {
  const saved = { liora_cart: JSON.stringify([{ id: 'botanique', qty: 1 }]), 'liora_checkout_proof:LIORA-TESTE-12345678': 'synthetic-proof' };
  const first = storefront({ saved, search: '?checkout=return&payment_id=123&order_id=LIORA-TESTE-12345678', fetch: async () => { throw new Error('offline'); } });
  await first.done;
  const next = storefront({ saved: Object.fromEntries(first.storage), fetch: async url => {
    assert.match(url, /payment_id=123/);
    return { ok: true, json: async () => ({ order_id: 'LIORA-TESTE-12345678', status: 'approved' }) };
  } });
  await next.done;
  assert.equal(next.run('cartQty()'), 0);
  assert.equal(next.storage.get('liora_checkout_return'), undefined);
});

test('sessão da versão anterior recupera pedido mesmo sem payment_id no navegador', async () => {
  const app = storefront({
    saved: { liora_checkout_order: 'LIORA-TESTE-12345678', 'liora_checkout_proof:LIORA-TESTE-12345678': 'synthetic-proof', liora_cart: JSON.stringify([{ id: 'botanique', qty: 1 }]) },
    fetch: async url => {
      assert.equal(url, '/api/payment-status?order_id=LIORA-TESTE-12345678');
      return { ok: true, json: async () => ({ order_id: 'LIORA-TESTE-12345678', status: 'approved' }) };
    }
  });
  await app.done;
  assert.equal(app.run('cartQty()'), 0);
});

test('status aprovado adulterado na URL ou resposta de outro pedido não esvazia sacola', async () => {
  const app = storefront({
    saved: { liora_cart: JSON.stringify([{ id: 'botanique', qty: 1 }]), 'liora_checkout_proof:LIORA-TESTE-12345678': 'synthetic-proof' },
    search: '?checkout=return&status=approved&payment_id=123&order_id=LIORA-TESTE-12345678',
    fetch: async () => ({ ok: true, json: async () => ({ status: 'approved', order_id: 'LIORA-OTHER-12345678' }) })
  });
  await app.done;
  assert.equal(app.run('cartQty()'), 1);
  assert.match(app.nodes.get('drawerBody').innerHTML, /Confirmação em aberto/);
});

test('Pix direto mostra QR e copia e cola, consulta o pagamento e guarda só a tentativa sem CPF', async () => {
  const payloads=[];
  const app=storefront({checkoutV2:true,fetch:async(url,options)=>{
    if(url==='/api/create-preference'){
      payloads.push(JSON.parse(options.body));
      return {ok:true,json:async()=>({order_id:'LIORA-TESTE-12345678',checkout_proof:'signed-fixture',provider:'mercadopago',payment_id:'123',total:91.15,pix:{code:'000201-SYNTHETIC-PIX',image:'aW1hZ2U=',expires_at:'2099-01-01T00:00:00Z'}})};
    }
    assert.match(url,/payment_id=123/);
    return {ok:true,json:async()=>({order_id:'LIORA-TESTE-12345678',status:'pending'})};
  }});
  await app.done;
  app.run("addToCart('botanique',1); shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Pessoa Fictícia'; $('fE').value='cliente@example.com'; $('fC').value='80000000'; $('fNum').value='1'; $('fA').value='Rua Fictícia'; $('fCPF').value='19119119100';");
  await app.run('confirmOrder()');
  assert.equal(payloads.length,1);
  assert.match(payloads[0].checkoutKey,/^[a-f0-9-]{36}$/);
  assert.equal(payloads[0].payer.cpf,'19119119100');
  assert.match(app.nodes.get('drawerBody').innerHTML,/QR Code para pagar este pedido por Pix/);
  assert.match(app.nodes.get('drawerBody').innerHTML,/Copiar código Pix/);
  assert.equal(app.run('window.location.href'),'https://liora.example/');
  assert.equal(app.run('cartQty()'),1);
  assert.doesNotMatch(JSON.stringify([...app.storage]),/19119119100|cliente@example|Fictícia|80000000/);
});

test('repetição após falha de rede mantém chave de idempotência e mudança de compra gera outra', async()=>{
  const keys=[];
  const app=storefront({checkoutV2:true,fetch:async(url,options)=>{keys.push(JSON.parse(options.body).checkoutKey);throw Error('offline')}});
  await app.done;
  app.run("addToCart('botanique',1); payMethod='card'; shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Pessoa Fictícia'; $('fE').value='cliente@example.com'; $('fC').value='80000000'; $('fA').value='Rua Fictícia';");
  await app.run('confirmOrder()');
  app.run("shippingState.quotes[0].quoteProof='renewed-shipping-proof'");
  await app.run('confirmOrder()');
  assert.equal(keys[0],keys[1]);
  app.run("$('fN').value='Outra Pessoa Fictícia'");await app.run('confirmOrder()');
  assert.notEqual(keys[2],keys[1]);
});

test('cotação vencida é atualizada e exige nova confirmação sem reenviar o pagamento',async()=>{
  let attempts=0,quotes=0;
  const app=storefront({fetch:async(url,options)=>{
    if(url==='/api/create-preference'){
      attempts++;
      assert.equal(JSON.parse(options.body).shipping.quoteProof,'expired-proof');
      return {ok:false,json:async()=>({code:'SHIPPING_QUOTE_EXPIRED',error:'A cotação expirou.'})};
    }
    if(url==='/api/shipping-quote'){
      quotes++;
      return {ok:true,json:async()=>({quotes:[{id:'1',price:29.5,quoteProof:'renewed-proof'}]})};
    }
    assert.match(url,/viacep/);
    return {json:async()=>({logradouro:'Endereço automático',localidade:'Rio de Janeiro',uf:'RJ'})};
  }});
  await app.done;
  app.run("addToCart('botanique',1); payMethod='card'; shippingState={status:'ready',quotes:[{id:'1',price:28.13,quoteProof:'expired-proof'}]}; selectedShippingService='1'; $('fN').value='Pessoa Fictícia'; $('fE').value='cliente@example.com'; $('fC').value='20020050'; $('fNum').value='10'; $('fA').value='Endereço ajustado pelo cliente';");
  await app.run('confirmOrder()');
  assert.equal(attempts,1);
  assert.equal(quotes,1);
  assert.equal(app.run('checkoutSubmitting'),false);
  assert.equal(app.run('shippingState.quotes[0].quoteProof'),'renewed-proof');
  assert.equal(app.run('checkoutForm.addr'),'Endereço ajustado pelo cliente');
  assert.equal(app.run('window.location.href'),'https://liora.example/');
  assert.match(app.nodes.get('toastMsg').textContent,/Confira o total e confirme/);
});

test('sem validação comercial não anuncia juros zero nem valores de parcela garantidos',async()=>{
  const app=storefront();await app.done;
  assert.doesNotMatch(app.run('paymentOptionsHTML()'),/sem juros/);
  assert.match(app.run("instTxt(prod('botanique'))"),/condições no pagamento/);
  const {lioraCardHTML}=require('../assets/components');
  assert.doesNotMatch(lioraCardHTML(products.find(p=>p.id==='botanique')),/sem juros/);
});

test('retorno sem pagamento localizado preserva pedido e permite retomar o mesmo checkout', async () => {
  const orderId='LIORA-TESTE-12345678';
  const checkoutUrl='https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-test';
  let calls=0;
  const app=storefront({
    saved:{liora_cart:JSON.stringify([{id:'botanique',qty:1}]),
      ['liora_checkout_proof:'+orderId]:'synthetic-proof',
      liora_checkout_return:JSON.stringify({orderId,provider:'mercadopago',checkoutUrl})},
    search:'?checkout=return&order_id='+orderId,
    fetch:async(url,options)=>{
      calls++; assert.match(url,/^\/api\/payment-status\?/); assert.equal(options.method,undefined);
      return {ok:false,status:404,json:async()=>({code:'PAYMENT_NOT_FOUND'})};
    }
  });
  await app.done;
  assert.equal(calls,1);
  assert.equal(app.run('paymentView.status'),'not_found');
  assert.equal(app.run('cartQty()'),1);
  assert.equal(app.storage.get('liora_checkout_proof:'+orderId),'synthetic-proof');
  assert.equal(JSON.parse(app.storage.get('liora_checkout_return')).checkoutUrl,checkoutUrl);
  assert.match(app.nodes.get('drawerBody').innerHTML,/Pagamento ainda não localizado/);
  assert.match(app.nodes.get('drawerBody').innerHTML,/Retomar pagamento no Mercado Pago/);
  assert.match(app.nodes.get('drawerBody').innerHTML,/Se já pagou, aguarde e consulte novamente/);
  assert.doesNotMatch(app.nodes.get('drawerBody').innerHTML,/Pagamento confirmado/);
});

test('falha do provedor não é confundida com pedido sem pagamento nem oferece pagar novamente', async () => {
  const orderId='LIORA-TESTE-12345678';
  const app=storefront({
    saved:{liora_cart:JSON.stringify([{id:'botanique',qty:1}]),
      ['liora_checkout_proof:'+orderId]:'synthetic-proof',
      liora_checkout_return:JSON.stringify({orderId,provider:'mercadopago',checkoutUrl:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-test'})},
    fetch:async()=>({ok:false,status:502,json:async()=>({code:'PAYMENT_PROVIDER_UNAVAILABLE'})})
  });
  await app.done;
  assert.equal(app.run('paymentView.status'),'error');
  assert.equal(app.run('cartQty()'),1);
  assert.match(app.nodes.get('drawerBody').innerHTML,/Confirmação em aberto/);
  assert.doesNotMatch(app.nodes.get('drawerBody').innerHTML,/Retomar pagamento/);
});

test('checkout não redireciona nem oferece retomada para destinos adulterados', async () => {
  for(const checkoutUrl of ['http://www.mercadopago.com.br/checkout/x','https://www.mercadopago.com.br.evil.example/checkout/x','https://secret@www.mercadopago.com.br/checkout/x','https://www.mercadopago.com.br:444/checkout/x','javascript:alert(1)','https://checkout.infinitepay.com.br/test']){
    const app=storefront({fetch:async()=>({ok:true,json:async()=>({init_point:checkoutUrl,order_id:'LIORA-TESTE-12345678',checkout_proof:'signed-fixture'})})});
    await app.done;
    app.run("addToCart('botanique',1); shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Cliente Fictício'; $('fE').value='cliente@example.com'; $('fC').value='80000000'; $('fA').value='Rua Fictícia';");
    await app.run('confirmOrder()');
    assert.equal(app.run('window.location.href'),'https://liora.example/');
    assert.equal(app.storage.get('liora_checkout_order'),undefined);
    assert.equal(app.run('cartQty()'),1);
    app.run('paymentView={status:"not_found"};paymentReturn={orderId:"LIORA-TESTE-12345678",checkoutUrl:'+JSON.stringify(checkoutUrl)+'};renderPaymentStatus();');
    assert.doesNotMatch(app.nodes.get('drawerBody').innerHTML,/Retomar pagamento/);
  }
});

test('voltar pelo navegador após redirecionamento consulta o pedido existente sem criar outra preferência', async () => {
  const requests=[];
  const orderId='LIORA-TESTE-12345678';
  const app=storefront({fetch:async(url,options)=>{
    requests.push({url,method:options.method});
    if(url==='/api/create-preference')return {ok:true,json:async()=>({provider:'mercadopago',init_point:'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-test',order_id:orderId,checkout_proof:'signed-fixture'})};
    return {ok:false,status:404,json:async()=>({code:'PAYMENT_NOT_FOUND'})};
  }});
  await app.done;
  app.run("addToCart('botanique',1); shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Cliente Fictício'; $('fE').value='cliente@example.com'; $('fC').value='80000000'; $('fA').value='Rua Fictícia';");
  await app.run('confirmOrder()');
  await app.emit('pageshow',{persisted:true});
  assert.equal(requests.filter(r=>r.method==='POST').length,1);
  assert.match(requests[1].url,/^\/api\/payment-status\?/);
  assert.equal(app.run('drawerView'),'payment');
  assert.equal(app.run('paymentView.status'),'not_found');
  assert.equal(app.run('cartQty()'),1);
  assert.match(app.nodes.get('drawerBody').innerHTML,/Retomar pagamento no Mercado Pago/);
});


test('InfinitePay guarda o link e volta sem pagamento sem nova cobrança ou falsa aprovação', async () => {
  const orderId='LIORA-TESTE-12345678',checkoutUrl='https://checkout.infinitepay.com.br/synthetic-link';
  let calls=0;
  const app=storefront({fetch:async(url,options)=>{
    calls++; assert.equal(url,'/api/create-preference');
    assert.equal(JSON.parse(options.body).payMethod,'infinitepay');
    return {ok:true,json:async()=>({provider:'infinitepay',init_point:checkoutUrl,order_id:orderId,checkout_proof:'signed-fixture'})};
  }});
  await app.done;
  app.run("addToCart('botanique',1); payMethod='infinitepay'; shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Cliente Fictício'; $('fE').value='cliente@example.com'; $('fC').value='80000000'; $('fA').value='Rua Fictícia';");
  await app.run('confirmOrder()');
  assert.equal(app.run('window.location.href'),checkoutUrl);
  assert.equal(JSON.parse(app.storage.get('liora_checkout_return')).provider,'infinitepay');
  await app.emit('pageshow',{persisted:true});
  assert.equal(app.run('paymentView.status'),'unconfirmed');
  assert.equal(app.run('cartQty()'),1);
  assert.match(app.nodes.get('drawerBody').innerHTML,/Retomar pagamento na InfinitePay/);
  assert.equal(calls,1);
  const restored=storefront({saved:Object.fromEntries(app.storage),search:'?checkout=infinitepay-return&order_id='+orderId});
  await restored.done;
  assert.equal(restored.run('paymentView.status'),'unconfirmed');
  assert.equal(restored.run('cartQty()'),1);
  assert.match(restored.nodes.get('drawerBody').innerHTML,/synthetic-link/);
});

test('InfinitePay confirma no servidor antes de remover os produtos pagos', async () => {
  const orderId='LIORA-TESTE-12345678';
  const app=storefront({saved:{liora_cart:JSON.stringify([{id:'botanique',qty:1}]),['liora_checkout_proof:'+orderId]:'signed-fixture'},
    search:'?checkout=infinitepay-return&order_id='+orderId+'&transaction_nsu=tx-123&slug=invoice-123&status=approved',
    fetch:async(url,options)=>{
      assert.match(url,/^\/api\/infinitepay-status\?/);
      assert.match(url,/transaction_nsu=tx-123&slug=invoice-123/);
      assert.equal(options.headers['X-Checkout-Proof'],'signed-fixture');
      return {ok:true,json:async()=>({order_id:orderId,status:'pending',payment_mode:'live'})};
    }});
  await app.done;
  assert.equal(app.run('paymentView.status'),'pending');
  assert.equal(app.run('cartQty()'),1);
});

test('InfinitePay não aceita destino adulterado nem resposta de outro processador', async () => {
  for(const [url,provider] of [
    ['https://www.mercadopago.com.br/checkout/test','infinitepay'],
    ['https://checkout.infinitepay.com.br/x','mercadopago'],
    ['https://checkout.infinitepay.com.br.evil.example/x','infinitepay'],
    ['https://secret@checkout.infinitepay.com.br/x','infinitepay'],
    ['http://checkout.infinitepay.com.br/x','infinitepay']
  ]){
    const app=storefront({fetch:async()=>({ok:true,json:async()=>({provider,init_point:url,order_id:'LIORA-TESTE-12345678',checkout_proof:'signed-fixture'})})});
    await app.done;
    app.run("addToCart('botanique',1); payMethod='infinitepay'; shippingState={status:'ready',quotes:[{id:'curitiba-fixed',price:19.9}]}; selectedShippingService='curitiba-fixed'; $('fN').value='Cliente Fictício'; $('fE').value='cliente@example.com'; $('fC').value='80000000'; $('fA').value='Rua Fictícia';");
    await app.run('confirmOrder()');
    assert.equal(app.run('window.location.href'),'https://liora.example/');
    assert.equal(app.storage.get('liora_checkout_order'),undefined);
  }
});
