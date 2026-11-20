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
 const result=await(await request(window,'/api/validate-coupon',{items,payMethod:'pix',couponCode:'BF20%'})).json();
 assert.equal(result.subtotalCents,10000);assert.equal(result.couponDiscountCents,2000);assert.equal(result.paymentDiscountCents,400);assert.equal(result.productTotalCents,7600);
 const first=await(await request(window,'/api/validate-coupon',{items,payMethod:'card',couponCode:'PRIMEIRACOMPRA',payer:{cpf:'19119119100'}})).json();
 assert.equal(first.productTotalCents,9000);
 const shipping=await(await request(window,'/api/shipping-quote',{items})).json();assert.equal(shipping.quotes[0].price,19.9);
 assert.equal(window.LIORA_COUPONS_ENABLED,true);assert.equal(window.LIORA_CHECKOUT_V2,false);assert.equal(window.LIORA_PAYMENT_ENVIRONMENT,'preview');
 window.LIORA_COUPONS_ENABLED=false;assert.equal(window.LIORA_COUPONS_ENABLED,true);
});

test('prévia cobre período anterior, expirado e CPF com pedido sem API externa',async()=>{
 for(const [scenario,couponCode,code] of [['bf_early','BF20%','COUPON_NOT_STARTED'],['bf_expired','BF20%','COUPON_EXPIRED'],['first_used','PRIMEIRACOMPRA','COUPON_NOT_ELIGIBLE']]){
  const window=preview(scenario),res=await request(window,'/api/validate-coupon',{items,payMethod:'pix',couponCode,payer:{cpf:'19119119100'}});
  assert.equal(res.ok,false);assert.equal((await res.json()).code,code);
 }
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
