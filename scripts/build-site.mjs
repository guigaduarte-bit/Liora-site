import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {normalizeBusinessIdentity,applyBusinessIdentity} from './business-identity.mjs';
const require=createRequire(import.meta.url);
const catalog=require('../api/catalog.js');
const {pixSubtotal}=require('../api/_payment.js');
const {lioraEscape:e,lioraMoney:money,lioraGallery,lioraAvailabilityLink,lioraCardHTML,lioraGiftPriceHTML,lioraGiftCardHTML,lioraTabsHTML,lioraAromasHTML}=require('../assets/components.js');
const root=path.resolve(import.meta.dirname||path.dirname(new URL(import.meta.url).pathname),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const json=f=>JSON.parse(read(f));
const businessIdentity=normalizeBusinessIdentity(json('content/business.json'));
const contact=json('content/contact.json');
const paymentPolicy=json('content/payment-policy.json');
if(paymentPolicy.maxInstallments!==3||![0,3].includes(paymentPolicy.interestFreeInstallments)||paymentPolicy.interestFreeInstallments>0&&(!paymentPolicy.verifiedAt||!paymentPolicy.verificationReference))throw Error('Installment terms require documented merchant verification');
if(!/^55\d{10,11}$/.test(contact.whatsapp||''))throw Error('Configure a valid Brazilian WhatsApp contact.');
const base='https://lioraaromasdeluxo.com.br';
function colorCustomization(name,url,model=false){
 const subject=`${model?'do modelo':'da coleção'} ${name}`;
 const href=`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(`Olá! Gostaria de consultar as opções de cores personalizadas ${subject}.\n\n${base}${url}`)}`;
 return `<aside class="color-customization" aria-label="Personalização de cores"><p>As cores das peças podem ser personalizadas.</p><a class="btn btn-outline" href="${e(href)}" target="_blank" rel="noopener noreferrer" aria-label="Consultar cores personalizadas ${e(subject)} pelo WhatsApp (abre em nova aba)">Consultar pelo WhatsApp</a></aside>`;
}
const out=path.join(root,'dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
const imageManifest=json('content/image-manifest.json');
for(const [src,meta] of Object.entries(imageManifest)){
 for(const image of [{src,bytes:meta.bytes},...(meta.variants||[])]){
  const file=path.join(root,image.src);
  if(!fs.existsSync(file)||!image.bytes||fs.statSync(file).size!==image.bytes)throw Error(`Invalid or incomplete image ${image.src}`);
 }
}
const editorial=json('content/product-editorial.json');
const collectionEditorial=json('content/collection-editorial.json');
const original=json('content/products.json');
const gifts=json('content/christmas-gifts.json').map(g=>{
 if(g.productId){
  const p=original.find(p=>p.id===g.productId),copy=editorial.find(p=>p.id===g.productId),commercial=catalog[g.productId];
  if(!p||!copy||!commercial)throw Error(`Unknown Christmas gift product ${g.productId}`);
  g={...g,name:copy.displayName,description:copy.description,detail:p.unitNote,price:commercial.price,priceLabel:'Unidade',image:p.images[0].src,alt:p.images[0].alt};
 }
 const imageMeta=imageManifest[g.image];
 if(!imageMeta||!g.name||!g.description||!g.alt)throw Error(`Incomplete Christmas gift ${g.id}`);
 return {...g,imageMeta};
});
if(new Set(gifts.map(g=>g.id)).size!==gifts.length)throw Error('Christmas gift IDs must be unique');
const productIds=original.map(p=>p.id);
if(new Set(productIds).size!==original.length||editorial.length!==original.length||Object.keys(catalog).length!==original.length||new Set(editorial.map(p=>p.id)).size!==original.length)throw Error('Product catalogue IDs must be unique and synchronized');
const products=original.map(p=>{
 const commercial=catalog[p.id],copy=editorial.find(x=>x.id===p.id);
 if(!commercial||!copy)throw Error(`Missing data ${p.id}`);
 if(commercial.price!==p.price||commercial.stock!==p.stock||commercial.name!==p.name||!!commercial.madeToOrder!==!!p.madeToOrder)throw Error(`Commercial drift ${p.id}`);
 const gallery=(p.images||[{src:`/assets/images/${p.id}.webp`,alt:copy.displayName}]).map(photo=>({img:photo.src,alt:photo.alt,imageMeta:imageManifest[photo.src]}));
 if(gallery.some(photo=>!photo.imageMeta))throw Error(`Missing image metadata ${p.id}`);
 const img=gallery[0].img;
 const availabilityUrl=p.availabilityPending?`https://wa.me/${contact.whatsapp}?text=${encodeURIComponent(`Olá! Gostaria de consultar a disponibilidade da peça ${copy.displayName}.\n\n${base}/produtos/${p.id}/`)}`:'';
 return {...p,...commercial,soldout:!!commercial.soldout||(!commercial.madeToOrder&&commercial.stock===0),displayName:copy.displayName,desc:copy.description,detail:copy.detail||'',specs:copy.specs,dims:p.showCardMeasures?(copy.specs.find(s=>s.label==='Medidas')?.value||''):'',img,imageMeta:imageManifest[img],gallery,availabilityUrl};
});
const categories=[
 {name:'Todas',path:'/velas-aromaticas/',title:'Velas artesanais aromáticas e decorativas',description:'Conheça as velas Liora: peças esculturais, formas geométricas e modelos botânicos feitos à mão em Curitiba. Encontre o desenho que combina com o seu espaço.',ids:products.map(p=>p.id)},
 {name:'Esculturas',path:'/velas-decorativas/',title:'Velas decorativas da coleção Esculturas',description:'Bustos, relevos e formas delicadas em velas feitas à mão. Lady Veil, Anjo em Vitral, Pequeno Amor e Mini Bubble se encontram na coleção Esculturas.',ids:products.filter(p=>p.cats.includes('Esculturas')).map(p=>p.id)},
 {name:'Clássico',path:'/classico/',title:'Coleção Clássico',description:'Formas geométricas, curvas e texturas para compor ambientes: descubra Pérolas, Bolhas, Lumina e Chama Esculpida.',ids:products.filter(p=>p.cats.includes('Clássico')).map(p=>p.id)},
 {name:'Boho Glass',path:'/boho-glass/',title:'Coleção Boho Glass',description:'Velas em vidro com detalhes que encantam. Explore as versões Botanique de 70 g, 150 g e 250 g junto ao Kit Boho Glass.',ids:products.filter(p=>p.cats.includes('Boho Glass')).map(p=>p.id)},
 {name:'Flora Linea',path:'/flora-linea/',title:'Flora Línea: flores para encantar',description:'Arranjos de velas florais em vasos de gesso, cerâmica e metal, caixas para presentear e formas delicadas. Conheça as composições da coleção Flora Línea.',ids:products.filter(p=>p.cats.includes('Flora Linea')).map(p=>p.id)},
 {name:'Natal',path:'/natal/',title:'Coleção Natal: velas para decorar e presentear',description:'Conheça as velas da coleção Natal Liora: Gingerbread, Gnomos de Natal, árvores, anjos e pequenas cenas natalinas para decorar e presentear.',ids:products.filter(p=>p.cats.includes('Natal')).map(p=>p.id)},
 {name:'Kits e presentes Natal Liora',path:'/kits-e-presentes-natal/',title:'Kits e presentes Natal Liora',description:'Conheça os kits e presentes de Natal Liora: velas decorativas, conjuntos e apresentações especiais para celebrar e presentear com carinho.',ids:[],editorial:true,festive:true}
];
const script=read('assets/storefront.js');
const families=vm.runInNewContext(script.match(/const AROMA_FAMILIES=(\[.*?\]);/s)[1]);
fs.writeFileSync(path.join(out,'assets/catalog.js'),`window.LIORA_PRODUCTS=${JSON.stringify(products).replace(/</g,'\\u003c')};\nwindow.LIORA_CATEGORIES=${JSON.stringify(categories)};\nwindow.LIORA_PAYMENT_ENVIRONMENT=${JSON.stringify(process.env.VERCEL_ENV||'development')};\nwindow.LIORA_CHECKOUT_V2=${process.env.LIORA_CHECKOUT_V2==='true'};\nwindow.LIORA_PAYMENT_POLICY=${JSON.stringify(paymentPolicy)};\n`);
const crumbs=(items)=>`<nav class="breadcrumbs" aria-label="Caminho da página"><a href="/">Início</a>${items.map((i,n)=>`<span aria-hidden="true">/</span>${i.path?`<a href="${i.path}">${e(i.name)}</a>`:`<span aria-current="page">${e(i.name)}</span>`}`).join('')}</nav>`;
const crumbSchema=(items)=>({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{name:'Início',path:'/'},...items].map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:base+x.path}))});
function metadata({url,title,description,img='/assets/images/eiffel.jpg',schemas=[]}){
 return `<title>${e(title)}</title>\n<meta name="description" content="${e(description)}">\n<link rel="canonical" href="${base+url}">\n<meta property="og:type" content="website">\n<meta property="og:locale" content="pt_BR">\n<meta property="og:site_name" content="Liora Aromas de Luxo">\n<meta property="og:title" content="${e(title)}">\n<meta property="og:description" content="${e(description)}">\n<meta property="og:url" content="${base+url}">\n<meta property="og:image" content="${base+img}">\n<meta name="twitter:card" content="summary_large_image">\n${schemas.map(s=>`<script type="application/ld+json">${JSON.stringify(s).replace(/</g,'\\u003c')}</script>`).join('\n')}`;
}
let template=applyBusinessIdentity(read('index.html'),businessIdentity).replace('<link rel="icon" id="fav" href="">','<link rel="icon" id="fav" href="/assets/images/responsive/logo-96.webp">');
template=template.replace(/<ul id="footCats"><\/ul>/,`<ul id="footCats">${categories.slice(1).map(c=>`<li><a href="${c.path}">${c.name}</a></li>`).join('')}<li><a href="/catalogo-de-aromas/">Catálogo de Aromas</a></li><li><a href="/velas-personalizadas/">Personalização</a></li></ul>`);
// All essential image resources are present before JavaScript executes.
template=template.replace(/<img([^>]*?)data-([ip])="([^"]+)"([^>]*)>/g,(all,a,kind,id,b)=>{
 const img=kind==='p'?`/assets/images/${id}.webp`:`/assets/images/${id}.jpg`,m=imageManifest[img];
 const alt=all.match(/alt="([^"]*)"/)?.[1]||'Liora';
 const priority=id==='eiffel';
 const src=id==='logo'?(m.variants.find(v=>v.width===192)?.src||img):img;
 const variants=[...(m.variants||[]),{src:img,width:m.width}].filter((v,i,list)=>list.findIndex(x=>x.width===v.width)===i);
 return `<img${a}data-${kind}="${id}"${b} src="${src}" width="${m.width}" height="${m.height}" ${variants.length>1?`srcset="${variants.map(v=>`${v.src} ${v.width}w`).join(', ')}" sizes="${id==='logo'?'150px':priority?'100vw':'(max-width: 768px) 100vw, 50vw'}"`:''} ${priority?'fetchpriority="high"':'loading="lazy"'} decoding="async">`;
});
const pages=[];
function emit(url,html){const filename=url.endsWith('/')?`${url.slice(1)}index.html`:url.slice(1);fs.mkdirSync(path.dirname(path.join(out,filename)),{recursive:true});fs.writeFileSync(path.join(out,filename),html);pages.push(url);}
function page(options,body,category=''){
 let html=template.replace(/<title>.*?<\/title>/s,metadata(options));
 if(body!==undefined)html=html.replace(/<main id="conteudo">[\s\S]*?<\/main>/,`<main id="conteudo">${body}</main>`);
 html=html.replace('<body>',`<body${category?` data-category="${e(category)}"`:''}>`);
 emit(options.url,html);
}
page({url:'/',title:'Liora Aromas de Luxo · Velas Artesanais — Curitiba/PR',description:'Velas artesanais aromáticas e decorativas Liora, feitas em Curitiba. Conheça as coleções, escolha sua fragrância e compre com envio para todo o Brasil.'},undefined);
let home=readDist('index.html').replace('<div class="grid" id="grid"></div>',`<div class="grid" id="grid">${products.map(p=>lioraCardHTML(p)).join('')}</div>`).replace(/(<div class="tabs[^>]+id="tabsBar">)<\/div>/,`$1${lioraTabsHTML(categories)}</div>`);
fs.writeFileSync(path.join(out,'index.html'),home);
function readDist(f){return fs.readFileSync(path.join(out,f),'utf8');}
for(const c of categories){
 if(c.editorial)continue;
 const items=products.filter(p=>c.ids.includes(p.id));
 const copy=collectionEditorial[c.name];
 const intro=copy?`<h1 class="display">${e(c.name)}</h1><p class="collection-tagline">${e(copy.tagline)}</p><p class="collection-description">${e(copy.description)}</p><p class="collection-invitation">${e(copy.invitation)}</p>`:`<h1 class="display">${e(c.title)}</h1><p>${e(c.description)}</p>`;
 page({url:c.path,title:`${c.title} | Liora`,description:c.description,schemas:[crumbSchema([{name:c.name,path:c.path}])]},`<section class="wrap category-page${c.name==='Natal'?' category-page-natal':''}">${crumbs([{name:c.name}])}${c.name==='Natal'?'<img class="natal-holly" src="/assets/images/natal-azevinho.webp" alt="" aria-hidden="true" width="384" height="384">':''}<div class="page-intro${copy?' collection-intro':''}"><p class="eyebrow">Coleções Liora</p>${intro}</div>${c.name==='Natal'?colorCustomization('Natal Liora',c.path):''}<nav class="tabs" id="tabsBar" aria-label="Coleções">${lioraTabsHTML(categories,c.name)}</nav><div class="grid" id="grid">${items.map(p=>lioraCardHTML(p)).join('')}</div><p class="product-help">Frete grátis a partir de R$ 150 em produtos, antes do desconto Pix. Confira as <a href="/termos-de-uso.html">condições de compra</a>.</p></section>`,c.name);
}
const giftCategory=categories.find(c=>c.editorial),giftCopy=collectionEditorial[giftCategory.name];
page({url:giftCategory.path,title:`${giftCategory.title} | Liora`,description:giftCategory.description,img:gifts[0].image,schemas:[crumbSchema([{name:giftCategory.name,path:giftCategory.path}])]},`<section class="wrap category-page category-page-natal">${crumbs([{name:giftCategory.name}])}<img class="natal-holly" src="/assets/images/natal-azevinho.webp" alt="" aria-hidden="true" width="384" height="384"><div class="page-intro collection-intro gift-intro"><p class="eyebrow">Coleções Liora</p><h1 class="display">Kits e presentes <span>Natal Liora</span></h1><p class="collection-tagline">${e(giftCopy.tagline)}</p><p class="collection-description">${e(giftCopy.description)}</p><p class="collection-invitation">${e(giftCopy.invitation)}</p></div>${colorCustomization(giftCategory.name,giftCategory.path)}<nav class="tabs" id="tabsBar" aria-label="Coleções">${lioraTabsHTML(categories,giftCategory.name)}</nav><div class="grid gift-grid" id="gifts-grid">${gifts.map(g=>lioraGiftCardHTML(g)).join('')}</div></section>`,giftCategory.name);
for(const g of gifts){
 if(g.productId)continue;
 const url=`${giftCategory.path}${g.id}/`;
 const trail=[{name:giftCategory.name,path:giftCategory.path},{name:g.name,path:url}];
 const related=gifts.filter(r=>r.id!==g.id).slice(0,4);
 page({url,title:`${g.name} · Natal Liora`,description:g.description,img:g.image,schemas:[crumbSchema(trail)]},`<section class="wrap product-page">${crumbs([{name:giftCategory.name,path:giftCategory.path},{name:g.name}])}<div class="product-layout"><figure class="gift-photo"><img src="${g.image}" alt="${e(g.alt)}" width="${g.imageMeta.width}" height="${g.imageMeta.height}" fetchpriority="high" decoding="async"></figure><div class="product-copy gift-copy"><p class="eyebrow">Kits e presentes · Natal Liora</p><h1 class="display">${e(g.name)}</h1><p class="description">${e(g.description)}</p>${lioraGiftPriceHTML(g,'product-price')}<p class="description">${e(g.detail)}</p>${colorCustomization(g.name,url,true)}<div class="product-links"><a href="${giftCategory.path}">Voltar aos kits e presentes</a><a href="/natal/">Conheça as velas de Natal</a></div></div></div><div class="related"><p class="eyebrow">Continue explorando</p><h2 class="display">Outras formas de presentear</h2><div class="grid gift-grid">${related.map(r=>lioraGiftCardHTML(r)).join('')}</div></div></section>`);
}
for(const p of products){
 const url=`/produtos/${p.id}/`,cat=categories.find(c=>c.name===p.cats[0])||categories[0];
 const trail=[{name:cat.name,path:cat.path},{name:p.displayName,path:url}];
 const productSchema={'@context':'https://schema.org','@type':'Product',name:p.displayName,description:p.desc,image:p.gallery.map(photo=>base+photo.img),sku:p.id,brand:{'@type':'Brand',name:'Liora'},offers:{'@type':'Offer',url:base+url,priceCurrency:'BRL',price:p.price,availability:`https://schema.org/${p.soldout?'OutOfStock':'InStock'}`}};
 const related=products.filter(r=>r.id!==p.id&&r.cats.some(c=>p.cats.includes(c))).slice(0,4);
 page({url,title:`${p.displayName} | Liora`,description:p.desc,img:p.img,schemas:[productSchema,crumbSchema(trail)]},`<section class="wrap product-page">${crumbs([{name:cat.name,path:cat.path},{name:p.displayName}])}<div class="product-layout">${lioraGallery(p)}<div class="product-copy"><p class="eyebrow">${e(cat.name)} · Liora</p><h1 class="display">${e(p.displayName)}</h1><p class="description">${e(p.desc)}</p><p class="product-price">${p.old?`<del>${money(p.old)}</del>`:''}${money(p.price)}${p.unitLabel?` <span class="price-unit">${e(p.unitLabel)}</span>`:''}</p><p class="product-pix">${money(pixSubtotal(p.price))} no Pix · 5% de desconto</p>${p.unitNote?`<p class="unit-note">${e(p.unitNote)}</p>`:''}<p class="product-status">${p.availabilityPending?'Disponibilidade a confirmar':p.soldout?'Esgotado no momento':p.madeToOrder?'Feito por encomenda':'Disponível no catálogo'}</p>
 ${p.availabilityPending?`<div class="purchase-row">${lioraAvailabilityLink(p)}</div><p class="product-help">Consulte esta peça pelo WhatsApp da Liora.</p>`:`<form class="product-form" onsubmit="return productAdd(event,'${p.id}')">${p.frag&&!p.soldout?'<label for="fragrance">Qual fragrância você deseja? (opcional)</label><input id="fragrance" name="fragrance" maxlength="60" placeholder="Ex.: Lavanda Sofisticada"><p class="product-help">Fragrância personalizada sem custo adicional. <a href="/catalogo-de-aromas/">Conheça o catálogo de aromas</a>.</p>':''}<div class="purchase-row"><div><label for="quantity">Quantidade</label><input id="quantity" name="quantity" type="number" value="1" min="1" max="${p.madeToOrder?100:p.stock||1}" step="1" ${p.soldout?'disabled':''}></div><button class="btn btn-ink" type="submit" ${p.soldout?'disabled':''}>${p.soldout?'Produto esgotado':'Adicionar ao carrinho'}</button></div><noscript><p class="product-help">Ative o JavaScript para usar o carrinho e finalizar a compra.</p></noscript></form>`}
 <p class="product-help"><strong>${p.madeToOrder?'Envio em até 10 dias úteis.':'Produção: 10 dias úteis.'}</strong> A contagem começa quando pagamento e personalização estiverem confirmados. O prazo de transporte, calculado pelo CEP, é acrescido à produção.</p>
 ${p.cats.includes('Natal')?colorCustomization(p.displayName,url,true):''}
 <h2 class="display" style="font-size:30px">Sobre a peça</h2><dl class="product-specs">${p.specs.map(s=>`<dt>${e(s.label)}</dt><dd>${e(s.value)}</dd>`).join('')}</dl>${p.detail?`<p class="product-help">${e(p.detail)}</p>`:''}<div class="product-links"><a href="/velas-personalizadas/">Personalização</a><a href="/trocas-e-devolucoes.html">Trocas e devoluções</a></div>
 <details><summary>Entrega e pagamento</summary><p>Envio para todo o Brasil, com opções calculadas pelo CEP no carrinho. Curitiba: R$ 19,90 em compras abaixo de R$ 150. Frete grátis a partir de R$ 150 em produtos, antes do desconto Pix. Pix com 5% de desconto, cartão e boleto pelo Mercado Pago. InfinitePay com Pix e cartão, conforme as condições exibidas no checkout. A produção leva 10 dias úteis, contados a partir do momento em que pagamento e personalização estiverem confirmados. O prazo total soma a produção ao transporte informado na cotação pelo CEP.</p></details><details><summary>Cuidados com a peça</summary><p>Consulte as orientações que acompanham a peça. Os cuidados variam conforme o formato e o recipiente.</p></details></div></div><div class="related"><p class="eyebrow">Continue explorando</p><h2 class="display">Outras formas de encantar</h2><div class="grid">${related.map(r=>lioraCardHTML(r)).join('')}</div></div></section>`);
}
page({url:'/catalogo-de-aromas/',title:'Catálogo de Aromas: famílias e fragrâncias | Liora',description:'Explore as sete famílias olfativas do catálogo Liora. Compare notas florais, frutais, cítricas e gourmand para escolher sua fragrância.',schemas:[crumbSchema([{name:'Catálogo de Aromas',path:'/catalogo-de-aromas/'}])]},`<section class="wrap aroma-page">${crumbs([{name:'Catálogo de Aromas'}])}<div class="page-intro"><p class="eyebrow">Guia olfativo Liora</p><h1 class="display">Catálogo <em>de Aromas</em></h1><p>Encontre a família olfativa que traduz a atmosfera que você deseja criar. As fragrâncias marcadas como Arquivo são referências anteriores; confirme a disponibilidade antes de escolhê-las.</p></div>${lioraAromasHTML(families)}<a class="btn btn-outline" href="/velas-aromaticas/">Escolher uma vela</a></section>`);
const infoPages=[
 {url:'/sobre/',title:'Sobre a Liora',description:'Conheça a Liora Aromas de Luxo: velas artesanais criadas em Curitiba, com desenhos esculturais e fragrâncias que fazem parte da decoração.',body:'<h2>Arte, aroma e presença</h2><p>A Liora nasceu do encontro entre arte, aroma e emoção. Suas velas são feitas à mão em Curitiba, com atenção ao desenho e aos detalhes de cada peça.</p><p>Bustos com véus, motivos florais e formas geométricas fazem parte de um catálogo em que a vela também participa da decoração. A coleção Esculturas destaca relevos e volumes; Flora Linea reúne flores, pássaros e outras formas delicadas.</p><h2>Uma escolha pessoal</h2><p>Nos modelos que oferecem personalização, a fragrância pode ser indicada pelo cliente sem custo adicional. O catálogo de aromas reúne as famílias e notas para orientar essa escolha.</p><p><a href="/catalogo-de-aromas/">Explore os aromas</a> e <a href="/velas-aromaticas/">conheça as coleções</a>.</p>'},
 {url:'/velas-personalizadas/',title:'Personalização de velas Liora',description:'Saiba como indicar a fragrância na sua vela Liora e o que confirmar sobre cor, encomendas e prazo de produção antes de comprar.',body:'<h2>Escolha a sua fragrância</h2><p>Os modelos compatíveis exibem o campo de fragrância na página do produto. Indique sua preferência antes de adicionar a vela ao carrinho. Essa personalização não tem custo adicional.</p><p>Consulte o <a href="/catalogo-de-aromas/">catálogo de aromas</a> e confira as notas de cada família. Referências marcadas como Arquivo precisam de confirmação de disponibilidade.</p><h2>Cor e encomendas</h2><p>Para uma cor específica ou uma encomenda em quantidade, confirme com a Liora a possibilidade de produção, a apresentação da peça e o prazo antes de comprar. Uma solicitação só deve ser considerada confirmada após o acordo com a loja.</p><h2>Produção e transporte são etapas diferentes</h2><p>O prazo de produção é de 10 dias úteis e começa quando a confirmação do pagamento e a definição da personalização estiverem concluídas. O prazo de entrega é a soma desses 10 dias úteis com o prazo de transporte calculado no carrinho, conforme o CEP e a modalidade escolhida. Consulte também as <a href="/trocas-e-devolucoes.html">condições de troca e devolução</a>.</p><a class="btn btn-ink" href="/velas-aromaticas/">Escolher um modelo</a>'}
];
for(const p of infoPages)page({...p,title:`${p.title} | Liora`,schemas:[crumbSchema([{name:p.title,path:p.url}])]},`<section class="wrap">${crumbs([{name:p.title}])}<div class="page-intro"><p class="eyebrow">Liora · Aromas de Luxo</p><h1 class="display">${p.title}</h1><p>${p.description}</p></div><div class="prose">${p.body}</div></section>`);
for(const file of ['trocas-e-devolucoes.html','termos-de-uso.html','politica-de-privacidade.html']){
 let html=applyBusinessIdentity(read(file),businessIdentity);const title=html.match(/<title>(.*?)<\/title>/)[1],description=html.match(/<meta name="description" content="([^"]+)"/)[1];
 html=html.replace(/<title>.*?<\/title>/,metadata({url:`/${file}`,title,description})).replace(/(<meta name="description"[^>]+>)([\s\S]*?)<meta name="description"[^>]+>/,'$1$2');
 html=html.replace(/<link rel="canonical"[^>]+>/g,'').replace('</head>',`<link rel="canonical" href="${base}/${file}">\n</head>`);
 emit('/'+file,html);
}
fs.writeFileSync(path.join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(url=>`  <url><loc>${base+url}</loc></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(out,'robots.txt'),`User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
fs.writeFileSync(path.join(out,'404.html'),template.replace(/<title>.*?<\/title>/,`<title>Página não encontrada | Liora</title><meta name="robots" content="noindex">`).replace(/<main id="conteudo">[\s\S]*?<\/main>/,'<main id="conteudo"><section class="wrap section"><div class="page-intro"><p class="eyebrow">404</p><h1 class="display">Esta página não foi encontrada</h1><p>Explore as coleções para encontrar sua Liora.</p><a class="btn btn-ink" href="/velas-aromaticas/">Ver as velas</a></div></section></main>'));
fs.writeFileSync(path.join(root,'docs/seo-routes.json'),JSON.stringify(pages,null,2)+'\n');
console.log(`Generated ${pages.length} pages, ${products.length} products, sitemap and robots in dist/`);

if(process.env.VERCEL_ENV==='preview'||process.env.LIORA_PREVIEW_QA==='1'){
 fs.mkdirSync(path.join(out,'__preview-qa'),{recursive:true});
 fs.copyFileSync(path.join(root,'scripts/preview-qa.html'),path.join(out,'__preview-qa/index.html'));
 if(process.env.VERCEL_ENV!=='production'){
  fs.mkdirSync(path.join(out,'__preview-pagamento'),{recursive:true});
  fs.copyFileSync(path.join(root,'scripts/payment-preview.html'),path.join(out,'__preview-pagamento/index.html'));
  fs.mkdirSync(path.join(out,'__preview-frete'),{recursive:true});
  fs.copyFileSync(path.join(root,'scripts/shipping-preview.html'),path.join(out,'__preview-frete/index.html'));
 }
}
