'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../scripts/coupon-preview.html'),'utf8');
const script=source.match(/<script>([\s\S]*)<\/script>/)[1];
new vm.Script(script,{filename:'scripts/coupon-preview.html'});
const fixtureSource=script.slice(script.indexOf('function fixture('),script.indexOf('\nlet template;'));
function preview(scenario){
 const window={LIORA_PRODUCTS:require('../content/products.json'),parent:{location:{origin:'https://preview.example'},postMessage(){}}};
 const document={addEventListener(){},getElementById(){return {textContent:''}}};
 const context=vm.createContext({window,document,Map,JSON,Object,String,Math,Error});
 vm.runInContext(fixtureSource+'\nfixture('+JSON.stringify(scenario)+')',context);
 return window;
}
const items=[{id:'botanique',qty:1},{id:'natal-gingerbread',qty:1}];
function request(window,url,body){return window.fetch(url,{body:JSON.stringify(body)});}

test('prévia usa catálogo real e mantém BF, primeira compra e Pix com totais de demonstração coerentes',async()=>{
 const window=preview('bf_active');
 const result=await(await request(window,'/api/validate-coupon',{items,payMethod:'pix',couponCode:'BF20'})).json();
 assert.equal(result.subtotalCents,10000);assert.equal(result.couponDiscountCents,2000);assert.equal(result.paymentDiscountCents,400);assert.equal(result.productTotalCents,7600);
 const firstWindow=preview('first_eligible');
 const first=await(await request(firstWindow,'/api/validate-coupon',{items,payMethod:'card',couponCode:'PRIMEIRACOMPRA',payer:{cpf:'19119119100'}})).json();
 assert.equal(first.productTotalCents,9000);
 const shipping=await(await request(window,'/api/shipping-quote',{items})).json();assert.equal(shipping.quotes[0].price,19.9);
 assert.equal(window.LIORA_COUPONS_ENABLED,false);assert.equal(window.LIORA_CAMPAIGN_COUPONS_ENABLED,true);assert.equal(window.LIORA_ORDER_TRACKING_ENABLED,false);assert.equal(window.LIORA_CHECKOUT_V2,false);assert.equal(window.LIORA_PAYMENT_ENVIRONMENT,'preview');
 window.LIORA_COUPONS_ENABLED=true;assert.equal(window.LIORA_COUPONS_ENABLED,false);
 assert.equal(firstWindow.LIORA_COUPONS_ENABLED,true);assert.equal(firstWindow.LIORA_CAMPAIGN_COUPONS_ENABLED,false);
});

test('cenários BF recusam primeira compra antes de pedir CPF e mantêm o modo campanha isolado',async()=>{
 for(const scenario of ['bf_active','bf_early','bf_expired']){
  const window=preview(scenario);
  const res=await request(window,'/api/validate-coupon',{items,payMethod:'pix',couponCode:'PRIMEIRACOMPRA'});
  assert.equal(res.ok,false);assert.equal((await res.json()).code,'COUPONS_UNAVAILABLE');
  assert.equal(window.LIORA_COUPONS_ENABLED,false);assert.equal(window.LIORA_CAMPAIGN_COUPONS_ENABLED,true);
  window.LIORA_ORDER_TRACKING_ENABLED=true;assert.equal(window.LIORA_ORDER_TRACKING_ENABLED,false);
 }
});

test('prévia cobre período anterior, expirado e CPF com pedido sem API externa',async()=>{
 for(const [scenario,couponCode,code] of [['bf_early','BF20','COUPON_NOT_STARTED'],['bf_expired','BF20','COUPON_EXPIRED'],['first_used','PRIMEIRACOMPRA','COUPON_FIRST_ORDER_ONLY']]){
  const window=preview(scenario),res=await request(window,'/api/validate-coupon',{items,payMethod:'pix',couponCode,payer:{cpf:'19119119100'}});
  assert.equal(res.ok,false);assert.equal((await res.json()).code,code);
 }
});

test('histórico indisponível não aplica PRIMEIRACOMPRA nem expõe consultas reais na prévia',async()=>{
 const window=preview('first_unavailable');
 const res=await request(window,'/api/validate-coupon',{items,payMethod:'pix',couponCode:'PRIMEIRACOMPRA',payer:{cpf:'19119119100'}});
 assert.equal(res.ok,false);assert.equal(res.status,503);
 const body=await res.json();assert.equal(body.code,'COUPON_HISTORY_UNAVAILABLE');assert.equal(body.coupon,undefined);
 assert.match(body.error,/Tente mais tarde ou continue sem cupom/);
 await assert.rejects(window.fetch('/api/orders'),/não acessa serviços reais/);
 assert.equal(window.__couponPreview.blocked,1);
});

test('exemplo de e-mail abre sem rede, fecha o checkout e não revela destinatário pessoal',async()=>{
 let requests=0;
 const frame={hidden:false,srcdoc:'checkout em demonstração'},emailPreview={hidden:true},result={textContent:''};
 const context=vm.createContext({frame,emailPreview,result,document:{getElementById(){return {value:'email_preview'}}},fetch(){requests++;throw Error('network must not be called')}});
 const startSource=script.slice(script.indexOf('let template;'),script.indexOf("\nwindow.addEventListener('message'"));
 await vm.runInContext(startSource+'\nstart()',context);
 assert.equal(requests,0);assert.equal(frame.hidden,true);assert.equal(frame.srcdoc,'');assert.equal(emailPreview.hidden,false);
 assert.equal(result.textContent,'Exemplo de e-mail pronto. Nenhuma mensagem foi enviada.');
 const sample=source.match(/<article class="email-preview"[\s\S]*?<\/article>/)[0];
 assert.match(sample,/Exemplo de e-mail · nenhuma mensagem enviada/);
 assert.match(sample,/E-mail pessoal configurado/);
 assert.match(sample,/Venda confirmada na Liora — LIORA-PREVIA-0001/);
 assert.match(sample,/R\$ 95,90/);assert.match(sample,/1 × Botanique/);assert.match(sample,/1 × Gingerbread/);
 assert.match(sample,/Esta prévia não confirma uma venda nem a ativação do envio de e-mails/);
 assert.doesNotMatch(sample,/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
 assert.doesNotMatch(sample,/<(?:form|script|input)|mailto:|https?:\/\//i);
});

test('carregamento atrasado do checkout não substitui o exemplo de e-mail selecionado',async()=>{
 let resolveTemplate;
 const frame={hidden:false,srcdoc:''},emailPreview={hidden:true},result={textContent:''},scenario={value:'bf_active'};
 const context=vm.createContext({frame,emailPreview,result,document:{getElementById(){return scenario}},fetch:async()=>({text:()=>new Promise(resolve=>{resolveTemplate=resolve})}),fixture(){}});
 const startSource=script.slice(script.indexOf('let template;'),script.indexOf("\nwindow.addEventListener('message'"));
 vm.runInContext(startSource,context);
 const pending=vm.runInContext('start()',context);
 await Promise.resolve();
 scenario.value='email_preview';await vm.runInContext('start()',context);
 resolveTemplate('<head></head><body>Checkout fictício</body>');await pending;
 assert.equal(frame.hidden,true);assert.equal(frame.srcdoc,'');assert.equal(emailPreview.hidden,false);
 assert.equal(result.textContent,'Exemplo de e-mail pronto. Nenhuma mensagem foi enviada.');
});

test('prévia nunca redireciona para cobrança e recusa qualquer chamada não declarada',async()=>{
 const window=preview('bf_active');
 const payment=await request(window,'/api/create-preference',{items,payMethod:'card'});
 assert.equal(payment.ok,false);assert.equal((await payment.json()).init_point,undefined);assert.equal(window.__couponPreview.paymentAttempts,1);
 await assert.rejects(window.fetch('https://api.mercadopago.com/checkout/preferences'),/não acessa serviços reais/);
 await assert.rejects(window.fetch('/api/payment-status?order_id=real'),/não acessa serviços reais/);
 assert.equal(window.__couponPreview.blocked,2);
 assert.match(source,/connect-src \\'none\\'; form-action \\'none\\'/);
 assert.match(source,/Prévia de cupons · sem cobrança/);
});
