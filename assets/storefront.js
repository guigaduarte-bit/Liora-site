
/* ============ EMBEDDED IMAGES ============ */
const IMGS={
  veiled:'/assets/images/veiled.jpg',
  pair:'/assets/images/pair.jpg',
  eiffel:'/assets/images/eiffel.jpg',
  logo:'/assets/images/logo.jpg'
};
const PIMG={"vela-escultural-lady-veil-phie3": "/assets/images/vela-escultural-lady-veil-phie3.webp", "vela-decorativa-anjo-em-vitral-1sbe9": "/assets/images/vela-decorativa-anjo-em-vitral-1sbe9.webp", "botanique": "/assets/images/botanique.webp", "botanique-150-gr-1gyzj": "/assets/images/botanique-150-gr-1gyzj.webp", "botanique-70-ml-1dqj4": "/assets/images/botanique-70-ml-1dqj4.webp", "ursinho": "/assets/images/ursinho.webp", "flordevenus": "/assets/images/flordevenus.webp", "abraco-em-luz": "/assets/images/abraco-em-luz.webp", "mini-bubble": "/assets/images/mini-bubble.webp", "bolhas": "/assets/images/bolhas.webp", "no-deluz": "/assets/images/no-deluz.webp", "lioracoral": "/assets/images/lioracoral.webp", "essenza-cube": "/assets/images/essenza-cube.webp", "kit-silhouette": "/assets/images/kit-silhouette.webp", "trevo": "/assets/images/trevo.webp", "perolas": "/assets/images/perolas.webp", "kit-boho-glass": "/assets/images/kit-boho-glass.webp", "lumina": "/assets/images/lumina.webp", "gota-de-luz1": "/assets/images/gota-de-luz1.webp", "geometricafacetada": "/assets/images/geometricafacetada.webp", "cilindro-mosaico": "/assets/images/cilindro-mosaico.webp", "chama-esculpida": "/assets/images/chama-esculpida.webp", "jardim-encantado": "/assets/images/jardim-encantado.webp", "camafeufada": "/assets/images/camafeufada.webp", "botanicavasogesso": "/assets/images/botanicavasogesso.webp", "peonia": "/assets/images/peonia.webp", "sagrada-familia": "/assets/images/sagrada-familia.webp"};
document.querySelectorAll('[data-i]').forEach(el=>{if(!el.getAttribute('src'))el.src=IMGS[el.dataset.i]});
document.querySelectorAll('[data-p]').forEach(el=>{if(!el.getAttribute('src'))el.src=PIMG[el.dataset.p]});
if(!document.getElementById('fav').getAttribute('href'))document.getElementById('fav').href=IMGS.logo;

/* ============ STORE DATA (lioraaromasdeluxo.lojavirtualnuvem.com.br) ============ */
const AROMA_TAB='Catálogo de Aromas';
const CATS=['Todas','Essenciais','Esculturas','Clássico','Boho Glass','Flora Linea','Kits e Presentes',AROMA_TAB];
const AROMA_FAMILIES=[
  {name:'Floral Frutal',className:'floral-frutal',profile:'Romântico · Fresco · Feminino',items:[
    {name:'Sim Arman',notes:'Figo · Damasco · Cedro · Musk'},
    {name:'Fig Flower',notes:'Figo · Damasco · Cedro · Musk'},
    {name:'Cereja & Avelã',notes:'Cereja · Gardênia · Cacau · Musk'}
  ]},
  {name:'Floral',className:'floral',profile:'Delicado · Clássico · Elegante',items:[
    {name:'Blum',notes:'Néroli · Jasmim · Tuberosa · Musk'},
    {name:'Cloé',notes:'Peônia · Magnólia · Musk'},
    {name:'Ar da Primavera',notes:'Floral verde'},
    {name:'Flor de Peônia',notes:'Peônia · Rosa'},
    {name:'White Gardênia',notes:'Gardênia · Jasmim · Almíscar',archive:true}
  ]},
  {name:'Floral Aromático',className:'aromatico',profile:'Sofisticado · Sereno',items:[
    {name:'Lavanda Sofisticada',notes:'Lavanda · Almíscar · Acorde aromático'}
  ]},
  {name:'Floral Cítrico',className:'citrico',profile:'Leve · Fresco · Doce',items:[
    {name:'Lichia Sublime',notes:'Lichia · Rosa · Baunilha · Musk'}
  ]},
  {name:'Cítrico Frutal',className:'citrico-frutal',profile:'Vibrante · Energizante · Ensolarado',items:[
    {name:'Goji & Tarocco Orange',notes:'Laranja · Bergamota · Goji · Manga · Buquê · Musk'},
    {name:'Aurora Cítrica',notes:'Perfil cítrico frutal',archive:true}
  ]},
  {name:'Frutal',className:'frutal',profile:'Alegre · Tropical · Sedutor',items:[
    {name:'Trick or Treat',notes:'Maçapão · Pera · Berry · Beetle Juice'},
    {name:'Smell of Dawn',notes:'Lichia · Rosa · Violeta · Berry'},
    {name:'Beetle Juice',notes:'Perfil frutal',archive:true}
  ]},
  {name:'Oriental Gourmand',className:'gourmand',profile:'Quente · Envolvente · Confortante',items:[
    {name:'Dolci Notte',notes:'Baunilha · Amêndoa · Cacau'}
  ]}
];
const PRODUCTS=window.LIORA_PRODUCTS;
PRODUCTS.forEach(p=>p.img=PIMG[p.id]);
const SHIP_FREE=150;

/* ============ STATE ============ */
let cart=[], wish=new Set(), drawerView='cart', currentTab=document.body.dataset.category||'Todas';
let quick={id:null,qty:1};
let payMethod='pix', shipMethod='delivery', selectedShippingService='';
let checkoutForm={name:'',email:'',cep:'',num:'',addr:''};
let shippingState={status:'idle',quotes:[],preview:false,error:'',code:'',sandbox:false,cep:''};
let shippingRequestId=0;

const $=id=>document.getElementById(id);
const money=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const roundCurrency=v=>Math.round((v+Number.EPSILON)*100)/100;
const escapeAttr=v=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prod=id=>PRODUCTS.find(p=>p.id===id);
const instOf=p=>p.price>=15?3:(p.price>=10?2:0);
const instTxt=p=>{const n=instOf(p);return n?`${n} x de ${money(p.price/n)} sem juros`:'À vista'};
const offPct=p=>p.old?Math.round((1-p.price/p.old)*100):0;

/* ============ TABS + GRID ============ */
function renderTabs(){
  if($('tabsBar'))$('tabsBar').innerHTML=lioraTabsHTML(window.LIORA_CATEGORIES,currentTab);
}
function cardHTML(p){return lioraCardHTML(p,wish.has(p.id));}
function renderGrid(){
  const grid=$('grid');if(!grid)return;
  const category=window.LIORA_CATEGORIES.find(c=>c.name===currentTab);
  const items=category?PRODUCTS.filter(p=>category.ids.includes(p.id)):PRODUCTS;
  grid.innerHTML=items.map(cardHTML).join('');
}
function setTab(cat){const c=window.LIORA_CATEGORIES.find(c=>c.name===cat);location.href=c?c.path:'/velas-aromaticas/';}
function goCat(cat){setTab(cat);}

/* ============ WISHLIST ============ */
function toggleWish(id){
  wish.has(id)?wish.delete(id):wish.add(id);
  renderGrid();updateCounts();
  toast(wish.has(id)?'Adicionado aos favoritos':'Removido dos favoritos');
  if(drawerView==='wish'&&$('drawer').classList.contains('on'))renderDrawer();
}

/* ============ CART ============ */
function addToCart(id,qty=1,frag=''){
  const p=prod(id);
  if(!p||p.soldout||p.stock<1){toast('Produto esgotado');return false}
  qty=Math.max(1,Math.floor(Number(qty)||1));frag=String(frag).trim().slice(0,60);
  const key=keyFor(id,frag);
  const ex=cart.find(i=>i.key===key);
  const have=cart.filter(i=>i.id===id).reduce((n,i)=>n+i.qty,0);
  if(p.stock&&have+qty>p.stock){toast(`Só ${p.stock} em estoque`);qty=Math.max(0,p.stock-have);if(!qty)return false}
  if(ex)ex.qty+=qty;
  else cart.push({key,id,qty,frag,price:p.price,name:p.name,img:p.img});
  updateCounts();return true;
}
function quickAdd(id){openQuick(id)}
function changeQty(key,d){
  const it=cart.find(i=>i.key===key);if(!it)return;
  const p=prod(it.id);
  if(d>0&&cart.filter(i=>i.id===it.id).reduce((n,i)=>n+i.qty,0)+1>p.stock){toast(`Só ${p.stock} em estoque`);return}
  it.qty+=d;if(it.qty<1)cart=cart.filter(i=>i.key!==key);
  updateCounts();renderDrawer();
}
function removeItem(key){cart=cart.filter(i=>i.key!==key);updateCounts();renderDrawer()}
const subtotal=()=>cart.reduce((s,i)=>s+i.price*i.qty,0);
const cartQty=()=>cart.reduce((s,i)=>s+i.qty,0);
const keyFor=(id,frag)=>id+'|'+Array.from(new TextEncoder().encode(frag),b=>b.toString(16).padStart(2,'0')).join('');
let cartFingerprint='';
function saveCart(){
  try{
    sessionStorage.setItem('liora_cart',JSON.stringify(cart.map(({id,qty,frag})=>({id,qty,frag}))));
    sessionStorage.setItem('liora_wish',JSON.stringify([...wish]));
  }catch{}
}
function restoreCart(){
  try{
    const saved=JSON.parse(sessionStorage.getItem('liora_cart')||'[]');
    if(Array.isArray(saved))for(const item of saved.slice(0,100)){
      if(!item||typeof item!=='object')continue;
      const p=prod(item.id);if(!p||p.soldout||!Number.isInteger(item.qty)||item.qty<1)continue;
      const remaining=p.stock-cart.filter(i=>i.id===p.id).reduce((n,i)=>n+i.qty,0);
      const qty=Math.min(item.qty,remaining);if(qty<1)continue;
      const frag=typeof item.frag==='string'?item.frag.slice(0,60):'';
      const key=keyFor(p.id,frag),existing=cart.find(i=>i.key===key);
      if(existing)existing.qty+=qty;else cart.push({key,id:p.id,qty,frag,price:p.price,name:p.name,img:p.img});
    }
    const savedWish=JSON.parse(sessionStorage.getItem('liora_wish')||'[]');
    if(Array.isArray(savedWish))wish=new Set(savedWish.filter(id=>prod(id)));
  }catch{}
}
function updateCounts(){
  const next=JSON.stringify(cart.map(({id,qty,frag})=>({id,qty,frag})));
  if(next!==cartFingerprint){
    shippingState={status:'idle',quotes:[],preview:false,error:'',code:'',sandbox:false,cep:''};
    selectedShippingService='';shippingRequestId++;cartFingerprint=next;
  }
  saveCart();
  const c=$('cartCount'),w=$('wishCount');
  c.textContent=cartQty();c.classList.toggle('on',cartQty()>0);
  w.textContent=wish.size;w.classList.toggle('on',wish.size>0);
}
function bump(){const b=$('cartCount');b.style.transform='scale(1.4)';setTimeout(()=>b.style.transform='',250)}
/* ============ DRAWER ============ */
function openDrawer(view){
  drawerView=view;renderDrawer();
  $('drawer').classList.add('on');$('scrim').classList.add('on');
  document.body.style.overflow='hidden';
}
function renderDrawer(){
  const body=$('drawerBody'),foot=$('drawerFoot'),title=$('drawerTitle');
  if(drawerView==='wish'){
    title.textContent='Favoritos';
    if(!wish.size){body.innerHTML=`<div class="cart-empty"><p class="display">Nenhum favorito ainda</p><p>Toque no coração de uma vela para guardá-la aqui.</p></div>`;foot.innerHTML='';return}
    body.innerHTML=[...wish].map(id=>{const p=prod(id);return `
      <div class="cart-item">
        <img src="${p.img}" alt="${escapeAttr(p.displayName||p.name)}">
        <div><p class="ci-name">${escapeAttr(p.displayName||p.name)}</p><p class="ci-meta">${p.cats[0]||''}</p>
        <button class="ci-remove" onclick="toggleWish('${p.id}')">Remover</button></div>
        <div class="ci-right"><span class="ci-price">${money(p.price)}</span>
        ${p.soldout?'<span class="ci-meta">Esgotado</span>':`<button class="btn btn-ink" style="padding:10px 14px;font-size:9px" onclick="quickAdd('${p.id}')">Mover ao carrinho</button>`}</div>
      </div>`}).join('');
    foot.innerHTML='';return;
  }
  if(drawerView==='checkout'){renderCheckout();return}
  if(drawerView==='success'){renderSuccess();return}
  title.textContent='Carrinho de compras';
  if(!cart.length){
    body.innerHTML=`<div class="cart-empty"><p class="display">O carrinho de compras está vazio</p><p>As velas mais desejadas esperam por você.</p><br><button class="btn btn-outline" onclick="closeAll()">Ver mais produtos</button></div>`;
    foot.innerHTML='';return;
  }
  const st=subtotal(),left=SHIP_FREE-st;
  body.innerHTML=`
    <div class="ship-bar">
      <p>${left>0?`Faltam <b>${money(left)}</b> para o frete grátis`:`<b>Você ganhou frete grátis ✦</b>`}</p>
      <div class="ship-track"><div class="ship-fill" style="width:${Math.min(st/SHIP_FREE*100,100)}%"></div></div>
    </div>
    ${cart.map(i=>`
    <div class="cart-item">
      <img src="${i.img}" alt="${escapeAttr(prod(i.id)?.displayName||i.name)}">
      <div>
        <p class="ci-name">${escapeAttr(prod(i.id)?.displayName||i.name)}</p>
        <p class="ci-meta">${i.frag?`Fragrância: ${escapeAttr(i.frag)}`:'Fragrância a combinar'}</p>
        <div class="qty">
          <button onclick="changeQty('${i.key}',-1)" aria-label="Diminuir">−</button><span>${i.qty}</span><button onclick="changeQty('${i.key}',1)" aria-label="Aumentar">+</button>
        </div>
      </div>
      <div class="ci-right"><span class="ci-price">${money(i.price*i.qty)}</span>
      <button class="ci-remove" onclick="removeItem('${i.key}')">Remover</button></div>
    </div>`).join('')}`;
  foot.innerHTML=`
    <div class="sum-row"><span>Subtotal (sem frete)</span><span>${money(st)}</span></div>
    <div class="sum-row total"><span>Total parcial</span><span>${money(st)}</span></div>
    <button class="btn btn-ink w-full" style="margin-top:14px" onclick="drawerView='checkout';renderDrawer()">Iniciar compra</button>
    <p style="text-align:center;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-soft);margin-top:12px">Pix: 5% de desconto extra ✦</p>`;
}

/* ============ CHECKOUT ============ */
function checkoutCepStatus(){
  if(shippingState.status==='loading')return 'Calculando entrega…';
  if(shippingState.status==='ready')return 'Entrega calculada para este CEP ✓';
  if(shippingState.status==='error'&&shippingState.code==='NO_SHIPPING_OPTIONS')return 'CEP localizado; sem modalidade automática nesta rota.';
  if(shippingState.status==='error')return 'CEP localizado; cotação temporariamente indisponível.';
  return '';
}
function renderCheckout(){
  $('drawerTitle').textContent='Finalizar compra';
  const st=subtotal();
  const selectedQuote=shippingState.quotes.find(q=>q.id===selectedShippingService);
  const checkoutReady=shipMethod!=='delivery'||Boolean(selectedQuote);
  const ship=shipMethod==='delivery'&&selectedQuote?selectedQuote.price:0;
  const disc=payMethod==='pix'?roundCurrency(st*0.05):0;
  const total=roundCurrency(st+ship-disc);
  $('drawerBody').innerHTML=`
    <button class="back-link" onclick="drawerView='cart';renderDrawer()">← Voltar ao carrinho</button>
    <p class="chk-step">1 · Entrega</p>
    <div class="field"><label for="fN">Nome completo</label><input id="fN" placeholder="Seu nome" value="${escapeAttr(checkoutForm.name)}" oninput="checkoutForm.name=this.value"></div>
    <div class="field"><label for="fE">E-mail</label><input id="fE" type="email" placeholder="voce@email.com" value="${escapeAttr(checkoutForm.email)}" oninput="checkoutForm.email=this.value"></div>
    <div class="f-row">
      <div class="field"><label for="fC">CEP</label><input id="fC" placeholder="80000-000" inputmode="numeric" maxlength="9" value="${escapeAttr(checkoutForm.cep)}" oninput="checkoutForm.cep=this.value;maskCEP(this)"><span id="cepStatus" class="cep-status ${shippingState.status==='error'?'error':shippingState.status==='ready'?'ok':shippingState.status==='loading'?'loading':''}">${escapeAttr(checkoutCepStatus())}</span></div>
      <div class="field"><label for="fNum">Número</label><input id="fNum" placeholder="100" value="${escapeAttr(checkoutForm.num)}" oninput="checkoutForm.num=this.value"></div>
    </div>
    <div class="field"><label for="fA">Endereço</label><input id="fA" placeholder="Rua, bairro — cidade/UF" value="${escapeAttr(checkoutForm.addr)}" oninput="checkoutForm.addr=this.value"></div>
    <p class="chk-step mt">2 · Meio de envio</p>
    <p class="production-note"><strong>Produção: 10 dias úteis.</strong> A contagem começa quando pagamento e personalização estiverem confirmados. Some o prazo de transporte calculado pelo CEP.</p>
    ${shippingOptionsHTML(st)}
    <p class="chk-step mt">3 · Pagamento</p>
    <div class="pay-opt ${payMethod==='pix'?'sel':''}" onclick="payMethod='pix';renderCheckout()"><span>Pix</span><span class="disc">5% de desconto extra</span></div>
    <div class="pay-opt ${payMethod==='card'?'sel':''}" onclick="payMethod='card';renderCheckout()"><span>Cartão de crédito</span><span class="disc">até 3x sem juros</span></div>
    <div class="pay-opt ${payMethod==='boleto'?'sel':''}" onclick="payMethod='boleto';renderCheckout()"><span>Boleto bancário</span><span class="disc">aprovação após compensação</span></div>
    <div class="pay-opt ${payMethod==='infinitepay'?'sel':''}" onclick="payMethod='infinitepay';renderCheckout()"><span class="ship-opt-main"><b>InfinitePay</b><small>Pix, cartão em até 12x e carteiras digitais</small></span><span class="disc">Opção adicional</span></div>`;
  $('drawerFoot').innerHTML=`
    <div class="sum-row"><span>Subtotal</span><span>${money(st)}</span></div>
    <div class="sum-row"><span>Frete</span><span>${shipMethod==='delivery'&&!selectedQuote?'A calcular':ship?money(ship):'<span class="free">Grátis</span>'}</span></div>
    ${disc?`<div class="sum-row"><span>Desconto Pix (5%)</span><span style="color:var(--gold-deep)">− ${money(disc)}</span></div>`:''}
    <div class="sum-row total"><span>${checkoutReady?'Total':'Total parcial'}</span><span>${money(total)}</span></div>
    <button class="btn btn-solid w-full" style="margin-top:14px" onclick="confirmOrder()" ${checkoutReady?'':'disabled'}>${checkoutReady?`${payMethod==='pix'?'Pagar com Pix':payMethod==='boleto'?'Gerar boleto':payMethod==='infinitepay'?'Pagar com InfinitePay':'Confirmar pedido'} · ${money(total)}`:'Calcule o frete para continuar'}</button>
    <p style="text-align:center;font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-soft);margin-top:12px">Você será redirecionado ao ambiente seguro ${payMethod==='infinitepay'?'da InfinitePay':'do Mercado Pago'}</p>`;
}
function shippingOptionsHTML(st){
  if(shippingState.status==='loading') return `<div class="pay-opt" aria-disabled="true"><span class="ship-loading">Calculando as melhores opções…</span></div>`;
  if(shippingState.status==='error'){
    const noRoute=shippingState.code==='NO_SHIPPING_OPTIONS';
    const title=noRoute?'Não há modalidade automática para esta rota':'Cotação temporariamente indisponível';
    const action=shippingState.sandbox?'Ambiente de teste':'Tente novamente';
    return `<div class="pay-opt" aria-disabled="true"><span class="ship-opt-main"><b>${title}</b><small>${escapeAttr(shippingState.error)}</small></span><span class="disc">${action}</span></div>`;
  }
  if(!shippingState.quotes.length) return `<div class="pay-opt" aria-disabled="true"><span>Informe o CEP para calcular</span><span class="disc">Prazo e valor</span></div>`;
  const note=shippingState.preview?`<p class="ship-preview-note">Opções demonstrativas da SuperFrete neste preview. Valores e prazos reais aparecerão após conectar o token da loja.</p>`:'';
  return shippingState.quotes.map(q=>`<div class="pay-opt ship-opt ${shipMethod==='delivery'&&selectedShippingService===q.id?'sel':''}" onclick="selectShipping('${escapeAttr(q.id)}')"><span class="ship-opt-main"><b>${escapeAttr(q.name)}</b><small>${escapeAttr(q.carrier)} · ${q.deliveryDays?`transporte em até ${q.deliveryDays} dias úteis após a produção`:'prazo de transporte combinado após a compra'}</small></span><span class="disc">${q.price===0?'Grátis':money(q.price)}</span></div>`).join('')+note;
}
function selectShipping(serviceId){
  selectedShippingService=serviceId;
  shipMethod='delivery';
  renderCheckout();
}
/* ============ CEP: MÁSCARA + AUTOCOMPLETE ============ */
function maskCEP(el){
  let v=el.value.replace(/\D/g,'').slice(0,8);
  if(v.length>5) v=v.slice(0,5)+'-'+v.slice(5);
  el.value=v;
  checkoutForm.cep=v;
  if(v.replace('-','').length===8){
    buscarCEP(v.replace('-',''));
  }else{
    shippingRequestId++;
    shippingState={status:'idle',quotes:[],preview:false,error:'',code:'',sandbox:false,cep:''};
    selectedShippingService='';
  }
}

async function buscarCEP(cep){
  const requestId=++shippingRequestId;
  const fA=document.getElementById('fA');
  shippingState={status:'loading',quotes:[],preview:false,error:'',code:'',sandbox:false,cep};
  selectedShippingService='';
  renderCheckout();
  try{
    const [addressResult,quoteResult]=await Promise.allSettled([
      fetch(`https://viacep.com.br/ws/${cep}/json/`).then(r=>r.json()),
      fetch('/api/shipping-quote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cep,items:cart.map(i=>({id:i.id,qty:i.qty}))})}).then(async r=>{const data=await r.json();if(!r.ok){const error=new Error(data.error||'Não foi possível calcular o frete');error.code=data.code||'SHIPPING_ERROR';error.sandbox=Boolean(data.sandbox);throw error}return data;})
    ]);
    if(requestId!==shippingRequestId)return;
    if(addressResult.status==='fulfilled'&&!addressResult.value.erro){
      const data=addressResult.value;
      const partes=[data.logradouro,data.bairro,`${data.localidade}/${data.uf}`].filter(Boolean);
      checkoutForm.addr=partes.join(', ');
    }
    if(quoteResult.status==='rejected')throw quoteResult.reason;
    shippingState={status:'ready',quotes:quoteResult.value.quotes||[],preview:Boolean(quoteResult.value.preview),error:'',code:'',sandbox:false,cep};
    selectedShippingService=shippingState.quotes[0]?.id||'';
    shipMethod='delivery';
    renderCheckout();
    const fNum=document.getElementById('fNum');
    if(fNum && !fNum.value) fNum.focus();
  }catch(err){
    if(requestId!==shippingRequestId)return;
    shippingState={status:'error',quotes:[],preview:false,error:err.message||'Não foi possível calcular o frete',code:err.code||'SHIPPING_ERROR',sandbox:Boolean(err.sandbox),cep};
    renderCheckout();
  }
}

async function confirmOrder(){
  const name=$('fN').value.trim(),email=$('fE').value.trim(),cep=$('fC').value.trim(),num=$('fNum').value.trim(),addr=$('fA').value.trim();
  checkoutForm={name,email,cep,num,addr};
  if(!name||!email||!$('fE').checkValidity()){toast('Preencha nome e e-mail válidos para continuar');return}
  if(shipMethod==='delivery'&&(!cep||!addr)){toast('Preencha o endereço de entrega');return}
  if(shipMethod==='delivery'&&!selectedShippingService){toast('Selecione uma opção de entrega');return}
  const btn=document.querySelector('#drawerFoot .btn-solid');
  const original=btn.textContent;
  btn.disabled=true;btn.textContent='Gerando pagamento…';
  try{
    const payload={
      items:cart.map(i=>({id:i.id,qty:i.qty,frag:i.frag})),
      payMethod,
      shipping:{method:shipMethod,serviceId:selectedShippingService},
      payer:{name,email,cep,num,addr}
    };
    const resp=await fetch('/api/create-preference',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok||!data.init_point){
      toast(data.error||'Não foi possível iniciar o pagamento. Tente novamente.');
      btn.disabled=false;btn.textContent=original;
      return;
    }
    if(data.order_id){try{sessionStorage.setItem('liora_checkout_order',data.order_id)}catch{}}
    window.location.href=data.init_point;
  }catch(err){
    toast('Erro de conexão. Tente novamente.');
    btn.disabled=false;btn.textContent=original;
  }
}
function renderSuccess(){
  $('drawerTitle').textContent='Pedido confirmado';
  $('drawerBody').innerHTML=`
    <div class="success">
      <div class="ok-ring"><svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg></div>
      <h3>Obrigada pelo seu pedido ✦</h3>
      <p>Seu pedido já está sendo preparado com carinho no ateliê.</p>
      <p class="order">Pedido ${window._order}</p>
      <button class="btn btn-outline" onclick="cart=[];updateCounts();closeAll()">Ver mais produtos</button>
    </div>`;
  $('drawerFoot').innerHTML='';
}

/* ============ QUICK VIEW ============ */
function openQuick(id){
  quick={id,qty:1};
  renderQuick();
  $('modal').classList.add('on');$('scrim').classList.add('on');
  document.body.style.overflow='hidden';
}
function stockNote(p){
  if(p.soldout)return '<p class="stock-note">Esgotado — avise-me quando voltar</p>';
  if(p.stock===1)return '<p class="stock-note">Atenção, última peça!</p>';
  if(p.stock&&p.stock<=5)return `<p class="stock-note">Só ${p.stock} em estoque</p>`;
  return p.stock?`<p class="stock-note" style="color:var(--ink-soft)">${p.stock} em estoque</p>`:'';
}
function renderQuick(){
  const p=prod(quick.id);if(!p)return;
  const off=offPct(p);
  $('modalCard').innerHTML=`
    <button class="modal-close" aria-label="Fechar" onclick="closeAll()"><svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:var(--ink);fill:none;stroke-width:1.4"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
    <div class="modal-media"><img src="${p.img}" alt="${escapeAttr(p.displayName||p.name)}"></div>
    <div class="modal-body">
      <p class="eyebrow">${p.soldout?'Esgotado':(off?off+'% OFF · Frete grátis*':'Coleção Liora')}</p>
      <h3>${escapeAttr(p.displayName||p.name)}</h3>
      <p class="m-variant">${p.cats.join(' · ')||'Liora Aromas de Luxo'}</p>
      <p class="m-price">${p.old?`<span class="old">${money(p.old)}</span>`:''}${money(p.price)}</p>
      <p class="m-inst">${instTxt(p)} · Pix com 5% de desconto extra</p>
      ${stockNote(p)}
      <p class="m-desc">${p.desc}</p>
      <div class="pyramid">
        ${p.dims?`<div class="pyr-row"><span>Dimensões</span><div>${p.dims}</div></div>`:''}
        ${p.frag?`<div class="pyr-row"><span>Fragrância</span><div>Personalizada pelo cliente — sem custo adicional</div></div>`:''}
        <div class="pyr-row"><span>Produção</span><div>Artesanal, feita à mão com ceras naturais</div></div>
      </div>
      ${p.frag&&!p.soldout?`
      <label class="opt-label" for="fragIn">Qual fragrância você deseja? (opcional)</label>
      <input class="frag-input" id="fragIn" maxlength="60" placeholder="Ex.: Lavanda Sofisticada, Dolci Notte…" value="">`:''}
      <div class="m-actions">
        <div class="qty" style="height:48px">
          <button style="width:42px;height:46px" onclick="quick.qty=Math.max(1,quick.qty-1);syncQty()" aria-label="Diminuir">−</button><span id="qQty">${quick.qty}</span><button style="width:42px;height:46px" onclick="quick.qty++;syncQty()" aria-label="Aumentar">+</button>
        </div>
        <button class="btn btn-ink" style="flex:1" id="qAdd" ${p.soldout?'disabled':''} onclick="modalAdd('${p.id}')">${p.soldout?'Esgotado':`Comprar · ${money(p.price*quick.qty)}`}</button>
      </div>
      <div class="m-specs">
        <div><svg viewBox="0 0 24 24"><path d="M12 3c3.5 4.2 5.5 7.2 5.5 10a5.5 5.5 0 0 1-11 0c0-2.8 2-5.8 5.5-10z"/></svg>Feito à mão</div>
        <div><svg viewBox="0 0 24 24"><path d="M1 7h13v10H1zM14 10h5l3 3v4h-8z"/><circle cx="6" cy="18.5" r="1.8"/><circle cx="17.5" cy="18.5" r="1.8"/></svg>Todo o Brasil</div>
        <div><svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M2.5 10h19"/></svg>Até 3x sem juros</div>
      </div>
      <div style="margin-top:26px">
        <details><summary>Pagamento</summary><p>Mercado Pago com Pix (5% de desconto), cartão em até 3x ou boleto. Como alternativa, use InfinitePay com Pix, cartão em até 12x e carteiras digitais.</p></details>
        <details><summary>Envio</summary><p>Comparamos opções da SuperFrete pelo CEP, incluindo Correios e outras transportadoras disponíveis. Em Curitiba, a entrega Liora custa R$ 19,90 abaixo de R$ 150. A partir desse valor, aplica-se a gratuidade geral.</p></details>
        <details><summary>Cuidados com a vela</summary><p>Consulte as orientações que acompanham a peça. Os cuidados variam conforme o formato e o recipiente.</p></details>
      </div>
    </div>`;
}
function syncQty(){
  const p=prod(quick.id);
  if(p.stock&&quick.qty>p.stock){quick.qty=p.stock;toast(`Só ${p.stock} em estoque`)}
  $('qQty').textContent=quick.qty;
  if(!p.soldout)$('qAdd').textContent=`Comprar · ${money(p.price*quick.qty)}`;
}
function modalAdd(id){
  const fragEl=$('fragIn');
  if(!addToCart(id,quick.qty,fragEl?fragEl.value.trim():''))return;
  closeAll();toast('Adicionado ao carrinho!');bump();
  setTimeout(()=>openDrawer('cart'),350);
}

/* ============ SEARCH ============ */
function openSearch(){$('searchOv').classList.add('on');document.body.style.overflow='hidden';setTimeout(()=>$('searchInput').focus(),400);doSearch('')}
function closeSearch(){$('searchOv').classList.remove('on');document.body.style.overflow=''}
function doSearch(q){
  q=q.trim().toLowerCase();
  const res=PRODUCTS.filter(p=>!q||`${escapeAttr(p.displayName||p.name)} ${p.cats.join(' ')} ${p.desc}`.toLowerCase().includes(q));
  $('searchRes').innerHTML=res.length?res.map(p=>`
    <a class="sr-item" href="/produtos/${p.id}/">
      <img src="${p.img}" alt="${escapeAttr(p.displayName||p.name)}">
      <h4>${escapeAttr(p.displayName||p.name)}</h4><p>${p.old?`<span class="old">${money(p.old)}</span>`:''}${money(p.price)}${p.soldout?' · Esgotado':''}</p>
    </a>`).join('')
  :`<p style="grid-column:1/-1;color:var(--ink-soft);font-size:14px">Nenhuma vela encontrada para “${escapeAttr(q)}”. Tente “lady veil”, “botanique” ou “kit”.</p>`;
}

/* ============ MENU / OVERLAYS ============ */
function openMenu(){$('mmenu').classList.add('on');document.body.style.overflow='hidden'}
function closeAll(){
  ['drawer','scrim','modal','mmenu'].forEach(i=>$(i).classList.remove('on'));
  document.body.style.overflow='';
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeAll();closeSearch()}});

/* ============ TOAST ============ */
let toastT;
function toast(msg){
  $('toastMsg').textContent=msg;
  $('toast').classList.add('on');
  clearTimeout(toastT);
  toastT=setTimeout(()=>$('toast').classList.remove('on'),2600);
}

/* ============ SCROLL FX ============ */
window.addEventListener('scroll',()=>$('header').classList.toggle('scrolled',scrollY>10),{passive:true});
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));

/* init */
restoreCart();renderTabs();renderGrid();updateCounts();

/* ============ RETORNO DOS CHECKOUTS ============ */
(async function checkPaymentReturn(){
  const params=new URLSearchParams(window.location.search);
  const isInfinitePay=params.get('checkout')==='infinitepay-return'||Boolean(params.get('transaction_nsu')&&params.get('slug'));
  const paymentId=params.get('payment_id')||params.get('collection_id');
  const orderId=params.get('order_nsu')||params.get('order_id')||params.get('external_reference')||(()=>{try{return sessionStorage.getItem('liora_checkout_order')}catch{return null}})();
  const isReturn=isInfinitePay||params.get('checkout')==='return'||Boolean(paymentId&&orderId);
  if(!isReturn)return;

  window.history.replaceState({},document.title,window.location.pathname);
  if(!orderId||(!isInfinitePay&&!paymentId)){
    toast('Não foi possível confirmar o pagamento. Consulte seu e-mail ou tente novamente.');
    return;
  }

  toast('Confirmando pagamento…');
  try{
    let statusUrl;
    if(isInfinitePay){
      const transactionNsu=params.get('transaction_nsu');
      const slug=params.get('slug')||params.get('invoice_slug');
      if(!transactionNsu||!slug)throw new Error('Retorno InfinitePay incompleto');
      statusUrl=`/api/infinitepay-status?transaction_nsu=${encodeURIComponent(transactionNsu)}&slug=${encodeURIComponent(slug)}&order_id=${encodeURIComponent(orderId)}`;
    }else{
      statusUrl=`/api/payment-status?payment_id=${encodeURIComponent(paymentId)}&order_id=${encodeURIComponent(orderId)}`;
    }
    const resp=await fetch(statusUrl);
    const data=await resp.json().catch(()=>({}));
    if(!resp.ok)throw new Error(data.error||'Falha ao confirmar pagamento');

    if(data.status==='approved'){
      cart=[];updateCounts();checkoutForm={name:'',email:'',cep:'',num:'',addr:''};
      try{sessionStorage.removeItem('liora_checkout_order')}catch{}
      toast('Pagamento aprovado ✦ Obrigada pelo seu pedido!');
    }else if(['pending','in_process','authorized'].includes(data.status)){
      toast('Pagamento em análise — avisaremos por e-mail assim que confirmado.');
    }else{
      try{sessionStorage.removeItem('liora_checkout_order')}catch{}
      toast('Pagamento não concluído. Você pode tentar novamente.');
    }
  }catch(err){
    toast('Não foi possível confirmar o pagamento agora. Consulte seu e-mail.');
  }
})();

function productAdd(event,id){
  event.preventDefault();const form=event.currentTarget;
  if(addToCart(id,Number(form.elements.quantity.value),form.elements.fragrance?.value||'')){
    toast('Adicionado ao carrinho!');openDrawer('cart');
  }
  return false;
}
