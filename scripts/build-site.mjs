import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const catalog=require('../api/catalog.js');
const {lioraEscape:e,lioraMoney:money,lioraImage,lioraCardHTML,lioraTabsHTML,lioraAromasHTML}=require('../assets/components.js');
const root=path.resolve(import.meta.dirname||path.dirname(new URL(import.meta.url).pathname),'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const json=f=>JSON.parse(read(f));
const base='https://lioraaromasdeluxo.com.br';
const out=path.join(root,'dist');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
const imageManifest=json('content/image-manifest.json');
const editorial=json('content/product-editorial.json');
const original=json('content/products.json');
if(new Set(original.map(p=>p.id)).size!==27||editorial.length!==27)throw Error('Expected 27 unique products');
const products=original.map(p=>{
 const commercial=catalog[p.id],copy=editorial.find(x=>x.id===p.id);
 if(!commercial||!copy)throw Error(`Missing data ${p.id}`);
 if(commercial.price!==p.price||commercial.stock!==p.stock||commercial.name!==p.name)throw Error(`Commercial drift ${p.id}`);
 const img=`/assets/images/${p.id}.webp`;
 return {...p,...commercial,soldout:!!commercial.soldout||commercial.stock===0,displayName:copy.displayName,desc:copy.description,detail:copy.detail||'',specs:copy.specs,dims:'',img,imageMeta:imageManifest[img]};
});
const categories=[
 {name:'Todas',path:'/velas-aromaticas/',title:'Velas artesanais aromáticas e decorativas',description:'Conheça as velas Liora: peças esculturais, formas geométricas e modelos botânicos feitos à mão em Curitiba. Encontre o desenho que combina com o seu espaço.',ids:products.map(p=>p.id)},
 {name:'Essenciais',path:'/essenciais/',title:'Essenciais Liora',description:'Uma seleção de formas para conhecer a Liora: Lady Veil, Botanique, Mini Bubble e outros modelos que combinam com diferentes composições.',ids:products.filter(p=>p.cats.includes('Essenciais')).map(p=>p.id)},
 {name:'Esculturas',path:'/velas-decorativas/',title:'Velas decorativas da coleção Esculturas',description:'Bustos, relevos e formas orgânicas em peças que também participam da decoração. Explore Lady Veil, Anjo em Vitral e os demais desenhos da coleção Esculturas.',ids:products.filter(p=>p.cats.includes('Esculturas')).map(p=>p.id)},
 {name:'Clássico',path:'/classico/',title:'Coleção Clássico',description:'Formas geométricas, curvas e texturas para compor ambientes: descubra Pérolas, Cilindro Mosaico, Chama Esculpida e os outros modelos desta coleção.',ids:products.filter(p=>p.cats.includes('Clássico')).map(p=>p.id)},
 {name:'Boho Glass',path:'/boho-glass/',title:'Coleção Boho Glass',description:'Conheça o Kit Boho Glass, o modelo que dá nome a esta seleção. Veja a foto, a descrição e as condições de compra em sua página.',ids:products.filter(p=>p.cats.includes('Boho Glass')).map(p=>p.id)},
 {name:'Flora Linea',path:'/flora-linea/',title:'Flora Linea: flores e formas delicadas',description:'Flores, pássaros e motivos delicados atravessam a coleção Flora Linea. Compare as versões Botanique e conheça os desenhos de Flor de Vênus e Jardim Encantado.',ids:products.filter(p=>p.cats.includes('Flora Linea')).map(p=>p.id)},
 {name:'Kits e Presentes',path:'/kits-e-presentes/',title:'Kits Liora para decorar e presentear',description:'Conheça Kit Silhouette e Kit Boho Glass. Consulte a apresentação de cada modelo; composição e embalagem devem ser confirmadas com a Liora antes da compra.',ids:['kit-silhouette','kit-boho-glass']}
];
const script=read('assets/storefront.js');
const families=vm.runInNewContext(script.match(/const AROMA_FAMILIES=(\[.*?\]);/s)[1]);
fs.writeFileSync(path.join(out,'assets/catalog.js'),`window.LIORA_PRODUCTS=${JSON.stringify(products).replace(/</g,'\\u003c')};\nwindow.LIORA_CATEGORIES=${JSON.stringify(categories)};\n`);
const crumbs=(items)=>`<nav class="breadcrumbs" aria-label="Caminho da página"><a href="/">Início</a>${items.map((i,n)=>`<span aria-hidden="true">/</span>${i.path?`<a href="${i.path}">${e(i.name)}</a>`:`<span aria-current="page">${e(i.name)}</span>`}`).join('')}</nav>`;
const crumbSchema=(items)=>({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{name:'Início',path:'/'},...items].map((x,i)=>({'@type':'ListItem',position:i+1,name:x.name,item:base+x.path}))});
function metadata({url,title,description,img='/assets/images/eiffel.jpg',schemas=[]}){
 return `<title>${e(title)}</title>\n<meta name="description" content="${e(description)}">\n<link rel="canonical" href="${base+url}">\n<meta property="og:type" content="website">\n<meta property="og:locale" content="pt_BR">\n<meta property="og:site_name" content="Liora Aromas de Luxo">\n<meta property="og:title" content="${e(title)}">\n<meta property="og:description" content="${e(description)}">\n<meta property="og:url" content="${base+url}">\n<meta property="og:image" content="${base+img}">\n<meta name="twitter:card" content="summary_large_image">\n${schemas.map(s=>`<script type="application/ld+json">${JSON.stringify(s).replace(/</g,'\\u003c')}</script>`).join('\n')}`;
}
let template=read('index.html').replace('<link rel="icon" id="fav" href="">','<link rel="icon" id="fav" href="/assets/images/responsive/logo-96.webp">');
template=template.replace(/<ul id="footCats"><\/ul>/,`<ul id="footCats">${categories.slice(1).map(c=>`<li><a href="${c.path}">${c.name}</a></li>`).join('')}<li><a href="/catalogo-de-aromas/">Catálogo de Aromas</a></li><li><a href="/velas-personalizadas/">Personalização</a></li></ul>`);
// All essential image resources are present before JavaScript executes.
template=template.replace(/<img([^>]*?)data-([ip])="([^"]+)"([^>]*)>/g,(all,a,kind,id,b)=>{
 const img=kind==='p'?`/assets/images/${id}.webp`:`/assets/images/${id}.jpg`,m=imageManifest[img];
 const alt=all.match(/alt="([^"]*)"/)?.[1]||'Liora';
 const priority=id==='eiffel';
 const src=id==='logo'?(m.variants.find(v=>v.width===192)?.src||img):img;
 const variants=[...(m.variants||[]),{src:img,width:m.width}].filter((v,i,list)=>list.findIndex(x=>x.width===v.width)===i);
 return `<img${a}data-${kind}="${id}"${b} src="${src}" width="${m.width}" height="${m.height}" ${variants.length>1?`srcset="${variants.map(v=>`${v.src} ${v.width}w`).join(', ')}" sizes="${id==='logo'?'96px':priority?'100vw':'(max-width: 768px) 100vw, 50vw'}"`:''} ${priority?'fetchpriority="high"':'loading="lazy"'} decoding="async">`;
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
 const items=products.filter(p=>c.ids.includes(p.id));
 page({url:c.path,title:`${c.title} | Liora`,description:c.description,schemas:[crumbSchema([{name:c.name,path:c.path}])]},`<section class="wrap category-page">${crumbs([{name:c.name}])}<div class="page-intro"><p class="eyebrow">Coleções Liora</p><h1 class="display">${c.title}</h1><p>${c.description}</p></div><nav class="tabs" id="tabsBar" aria-label="Coleções">${lioraTabsHTML(categories,c.name)}</nav><div class="grid" id="grid">${items.map(p=>lioraCardHTML(p)).join('')}</div><p class="product-help">Frete grátis a partir de R$ 150 em produtos, antes do desconto Pix. Confira as <a href="/termos-de-uso.html">condições de compra</a>.</p></section>`,c.name);
}
for(const p of products){
 const url=`/produtos/${p.id}/`,cat=categories.find(c=>c.name===p.cats[0])||categories[0];
 const trail=[{name:cat.name,path:cat.path},{name:p.displayName,path:url}];
 const productSchema={'@context':'https://schema.org','@type':'Product',name:p.displayName,description:p.desc,image:[base+p.img],sku:p.id,brand:{'@type':'Brand',name:'Liora'},offers:{'@type':'Offer',url:base+url,priceCurrency:'BRL',price:p.price,availability:`https://schema.org/${p.soldout?'OutOfStock':'InStock'}`}};
 const related=products.filter(r=>r.id!==p.id&&r.cats.some(c=>p.cats.includes(c))).slice(0,4);
 page({url,title:`${p.displayName} | Liora`,description:p.desc,img:p.img,schemas:[productSchema,crumbSchema(trail)]},`<section class="wrap product-page">${crumbs([{name:cat.name,path:cat.path},{name:p.displayName}])}<div class="product-layout"><div class="product-photo">${lioraImage(p,true)}</div><div class="product-copy"><p class="eyebrow">${e(cat.name)} · Liora</p><h1 class="display">${e(p.displayName)}</h1><p class="description">${e(p.desc)}</p><p class="product-price">${p.old?`<del>${money(p.old)}</del>`:''}${money(p.price)}</p><p class="product-pix">${money(Math.round(p.price*95)/100)} no Pix · 5% de desconto</p><p class="product-status">${p.soldout?'Esgotado no momento':'Disponível no catálogo'}</p>
 <form class="product-form" onsubmit="return productAdd(event,'${p.id}')">${p.frag&&!p.soldout?'<label for="fragrance">Qual fragrância você deseja? (opcional)</label><input id="fragrance" name="fragrance" maxlength="60" placeholder="Ex.: Lavanda Sofisticada"><p class="product-help">Fragrância personalizada sem custo adicional. <a href="/catalogo-de-aromas/">Conheça o catálogo de aromas</a>.</p>':''}<div class="purchase-row"><div><label for="quantity">Quantidade</label><input id="quantity" name="quantity" type="number" value="1" min="1" max="${p.stock||1}" step="1" ${p.soldout?'disabled':''}></div><button class="btn btn-ink" type="submit" ${p.soldout?'disabled':''}>${p.soldout?'Produto esgotado':'Adicionar ao carrinho'}</button></div><noscript><p class="product-help">Ative o JavaScript para usar o carrinho e finalizar a compra.</p></noscript></form>
 <h2 class="display" style="font-size:30px">Sobre a peça</h2><dl class="product-specs">${p.specs.map(s=>`<dt>${e(s.label)}</dt><dd>${e(s.value)}</dd>`).join('')}</dl>${p.detail?`<p class="product-help">${e(p.detail)}</p>`:''}<div class="product-links"><a href="/velas-personalizadas/">Personalização</a><a href="/trocas-e-devolucoes.html">Trocas e devoluções</a></div>
 <details><summary>Entrega e pagamento</summary><p>Envio para todo o Brasil, com opções calculadas pelo CEP no carrinho. Curitiba: R$ 19,90 em compras abaixo de R$ 150. Frete grátis a partir de R$ 150 em produtos, antes do desconto Pix. Pix com 5% de desconto; cartão e boleto pelo Mercado Pago, além de InfinitePay. O prazo de transporte é informado na cotação. Para encomendas, confirme o prazo de produção separadamente.</p></details><details><summary>Cuidados com a peça</summary><p>Consulte as orientações que acompanham a peça. Os cuidados variam conforme o formato e o recipiente.</p></details></div></div><div class="related"><p class="eyebrow">Continue explorando</p><h2 class="display">Outras formas de encantar</h2><div class="grid">${related.map(r=>lioraCardHTML(r)).join('')}</div></div></section>`);
}
page({url:'/catalogo-de-aromas/',title:'Catálogo de Aromas: famílias e fragrâncias | Liora',description:'Explore as sete famílias olfativas do catálogo Liora. Compare notas florais, frutais, cítricas e gourmand para escolher sua fragrância.',schemas:[crumbSchema([{name:'Catálogo de Aromas',path:'/catalogo-de-aromas/'}])]},`<section class="wrap aroma-page">${crumbs([{name:'Catálogo de Aromas'}])}<div class="page-intro"><p class="eyebrow">Guia olfativo Liora</p><h1 class="display">Catálogo <em>de Aromas</em></h1><p>Encontre a família olfativa que traduz a atmosfera que você deseja criar. As fragrâncias marcadas como Arquivo são referências anteriores; confirme a disponibilidade antes de escolhê-las.</p></div>${lioraAromasHTML(families)}<a class="btn btn-outline" href="/velas-aromaticas/">Escolher uma vela</a></section>`);
const infoPages=[
 {url:'/sobre/',title:'Sobre a Liora',description:'Conheça a Liora Aromas de Luxo: velas artesanais criadas em Curitiba, com desenhos esculturais e fragrâncias que fazem parte da decoração.',body:'<h2>Arte, aroma e presença</h2><p>A Liora nasceu do encontro entre arte, aroma e emoção. Suas velas são feitas à mão em Curitiba, com atenção ao desenho e aos detalhes de cada peça.</p><p>Bustos com véus, motivos florais e formas geométricas fazem parte de um catálogo em que a vela também participa da decoração. A coleção Esculturas destaca relevos e volumes; Flora Linea reúne flores, pássaros e outras formas delicadas.</p><h2>Uma escolha pessoal</h2><p>Nos modelos que oferecem personalização, a fragrância pode ser indicada pelo cliente sem custo adicional. O catálogo de aromas reúne as famílias e notas para orientar essa escolha.</p><p><a href="/catalogo-de-aromas/">Explore os aromas</a> e <a href="/velas-aromaticas/">conheça as coleções</a>.</p>'},
 {url:'/velas-personalizadas/',title:'Personalização de velas Liora',description:'Saiba como indicar a fragrância na sua vela Liora e o que confirmar sobre cor, encomendas e prazo de produção antes de comprar.',body:'<h2>Escolha a sua fragrância</h2><p>Os modelos compatíveis exibem o campo de fragrância na página do produto. Indique sua preferência antes de adicionar a vela ao carrinho. Essa personalização não tem custo adicional.</p><p>Consulte o <a href="/catalogo-de-aromas/">catálogo de aromas</a> e confira as notas de cada família. Referências marcadas como Arquivo precisam de confirmação de disponibilidade.</p><h2>Cor e encomendas</h2><p>Para uma cor específica ou uma encomenda em quantidade, confirme com a Liora a possibilidade de produção, a apresentação da peça e o prazo antes de comprar. Uma solicitação só deve ser considerada confirmada após o acordo com a loja.</p><h2>Produção e transporte são etapas diferentes</h2><p>A cotação do carrinho informa o transporte pelo CEP. Encomendas podem ter prazo de produção próprio, que precisa ser confirmado separadamente. Consulte também as <a href="/trocas-e-devolucoes.html">condições de troca e devolução</a>.</p><a class="btn btn-ink" href="/velas-aromaticas/">Escolher um modelo</a>'}
];
for(const p of infoPages)page({...p,title:`${p.title} | Liora`,schemas:[crumbSchema([{name:p.title,path:p.url}])]},`<section class="wrap">${crumbs([{name:p.title}])}<div class="page-intro"><p class="eyebrow">Liora · Aromas de Luxo</p><h1 class="display">${p.title}</h1><p>${p.description}</p></div><div class="prose">${p.body}</div></section>`);
for(const file of ['trocas-e-devolucoes.html','termos-de-uso.html','politica-de-privacidade.html']){
 let html=read(file);const title=html.match(/<title>(.*?)<\/title>/)[1],description=html.match(/<meta name="description" content="([^"]+)"/)[1];
 html=html.replace(/<title>.*?<\/title>/,metadata({url:`/${file}`,title,description})).replace(/(<meta name="description"[^>]+>)([\s\S]*?)<meta name="description"[^>]+>/,'$1$2');
 html=html.replace(/<link rel="canonical"[^>]+>/g,'').replace('</head>',`<link rel="canonical" href="${base}/${file}">\n</head>`);
 emit('/'+file,html);
}
fs.writeFileSync(path.join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(url=>`  <url><loc>${base+url}</loc></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(out,'robots.txt'),`User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
fs.writeFileSync(path.join(out,'404.html'),template.replace(/<title>.*?<\/title>/,`<title>Página não encontrada | Liora</title><meta name="robots" content="noindex">`).replace(/<main id="conteudo">[\s\S]*?<\/main>/,'<main id="conteudo"><section class="wrap section"><div class="page-intro"><p class="eyebrow">404</p><h1 class="display">Esta página não foi encontrada</h1><p>Explore as coleções para encontrar sua Liora.</p><a class="btn btn-ink" href="/velas-aromaticas/">Ver as velas</a></div></section></main>'));
fs.writeFileSync(path.join(root,'docs/seo-routes.json'),JSON.stringify(pages,null,2)+'\n');
console.log(`Generated ${pages.length} pages, 27 products, sitemap and robots in dist/`);

if(process.env.VERCEL_ENV==='preview'||process.env.LIORA_PREVIEW_QA==='1'){
 fs.mkdirSync(path.join(out,'__preview-qa'),{recursive:true});
 fs.copyFileSync(path.join(root,'scripts/preview-qa.html'),path.join(out,'__preview-qa/index.html'));
}
