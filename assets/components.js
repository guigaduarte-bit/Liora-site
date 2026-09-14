/* Pure renderers shared by static generation and the storefront. */
function lioraEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function lioraMoney(value){return value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function lioraImage(p,priority=false){
 const m=p.imageMeta||{};
 const sources=[...(m.variants||[]).map(v=>`${v.src} ${v.width}w`),...(m.width?[`${p.img} ${m.width}w`]:[])];
 return `<img src="${p.img}" alt="${lioraEscape(p.displayName||p.name)}" ${m.width?`width="${m.width}" height="${m.height}"`:''} ${sources.length>1?`srcset="${sources.join(', ')}" sizes="${priority?'(max-width: 768px) calc(100vw - 40px), 50vw':'(max-width: 600px) 46vw, (max-width: 1000px) 30vw, 23vw'}"`:''} ${priority?'fetchpriority="high"':'loading="lazy"'} decoding="async">`;
}
function lioraCardHTML(p,favorite=false){
 const name=lioraEscape(p.displayName||p.name),off=p.old?Math.round((1-p.price/p.old)*100):0;
 const installments=p.price>=15?3:p.price>=10?2:0;
 return `<article class="card${p.soldout?' soldout':''}"><div class="card-media">
 <a class="card-image-link" href="/produtos/${p.id}/" aria-label="Ver ${name}">${lioraImage(p)}</a>
 ${p.soldout?'<span class="badge out">Esgotado</span>':off?`<span class="badge">${off}% OFF</span>`:''}
 <button class="wish-btn${favorite?' on':''}" aria-label="Favoritar ${name}" aria-pressed="${favorite}" onclick="toggleWish('${p.id}')"><svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.7-9.3-9C1.2 8 3 4.5 6.6 4.5c2.2 0 3.9 1.3 5.4 3.4 1.5-2.1 3.2-3.4 5.4-3.4 3.6 0 5.4 3.5 3.9 7-1.8 4.3-9.3 9-9.3 9z"/></svg></button>
 <button class="quick-add" ${p.soldout?'disabled':''} onclick="openQuick('${p.id}')">${p.soldout?'Esgotado':'Escolher e adicionar'}</button></div>
 <div class="card-info"><h3><a href="/produtos/${p.id}/">${name}</a></h3><p class="card-price">${p.old?`<span class="old">${lioraMoney(p.old)}</span>`:''}${lioraMoney(p.price)}</p><p class="inst">${installments?`${installments} x de ${lioraMoney(p.price/installments)} sem juros`:'À vista'}</p><span class="tag-frete">Frete grátis em compras a partir de R$ 150</span></div></article>`;
}
function lioraTabsHTML(categories,current='Todas'){
 return categories.map(c=>`<a class="tab${c.name===current?' active':''}" href="${c.path}" ${c.name===current?'aria-current="page"':''}>${lioraEscape(c.name)}</a>`).join('')+'<a class="tab" href="/catalogo-de-aromas/">Catálogo de Aromas</a>';
}
function lioraAromasHTML(families){return `<div class="aroma-family-grid">${families.map(f=>`<section class="aroma-family ${f.className}"><div class="aroma-family-head"><h2 class="aroma-family-name"><i class="aroma-symbol"></i>${lioraEscape(f.name)}</h2><p class="aroma-profile">${lioraEscape(f.profile)}</p></div><ul class="aroma-items">${f.items.map(i=>`<li class="aroma-item"><strong class="aroma-name">${lioraEscape(i.name)}</strong><span class="aroma-notes">${lioraEscape(i.notes)}</span>${i.archive?'<span class="aroma-status">Arquivo</span>':''}</li>`).join('')}</ul></section>`).join('')}</div>`;}
if(typeof module!=='undefined')module.exports={lioraEscape,lioraMoney,lioraImage,lioraCardHTML,lioraTabsHTML,lioraAromasHTML};
