'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const catalog=require('../api/catalog');
const routes=require('../docs/seo-routes.json');
const root=path.join(__dirname,'../dist');
const read=url=>fs.readFileSync(path.join(root,url.endsWith('/')?url.slice(1)+'index.html':url.slice(1)),'utf8');
const base='https://lioraaromasdeluxo.com.br';
test('todas as páginas têm conteúdo inicial, metadados únicos e destinos reais',()=>{
 const titles=new Set(),descriptions=new Set();
 for(const url of routes){
  const html=read(url);
  assert.equal([...html.matchAll(/<h1\b/g)].length,1,url);
  assert.equal([...html.matchAll(/rel="canonical"/g)].length,1,url);
  assert.ok(html.includes(`rel="canonical" href="${base+url}"`),url);
  const title=html.match(/<title>(.*?)<\/title>/)[1],desc=html.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.ok(!titles.has(title),`duplicate title ${url}`);titles.add(title);
  assert.ok(!descriptions.has(desc),`duplicate description ${url}`);descriptions.add(desc);
  assert.doesNotMatch(html,/<meta name="robots"[^>]+noindex/,url);
  assert.doesNotMatch(html,/mailto:|wa\.me\/|jullianas@gmail|Juliana Straatmann|id="newsForm"/,url);
  for(const [,value] of html.matchAll(/(?:href|src)="(\/[^"?]*)"/g)){
   const p=value.split('#')[0];
   assert.ok(fs.existsSync(path.join(root,p.endsWith('/')?p.slice(1)+'index.html':p.slice(1))),`${url}: ${p}`);
  }
 }
});
test('27 produtos têm preço, disponibilidade e identificador coerentes no HTML e schema',()=>{
 const client={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'assets/catalog.js'),'utf8'),client);
 assert.equal(client.window.LIORA_PRODUCTS.length,27);
 for(const [id,p] of Object.entries(catalog)){
  const html=read(`/produtos/${id}/`);
  const schemas=[...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map(m=>JSON.parse(m[1]));
  const schema=schemas.find(s=>s['@type']==='Product');
  assert.equal(schema.sku,id);assert.equal(schema.offers.price,p.price);assert.equal(schema.offers.priceCurrency,'BRL');
  assert.equal(schema.offers.availability,`https://schema.org/${p.soldout?'OutOfStock':'InStock'}`);
  const data=client.window.LIORA_PRODUCTS.find(x=>x.id===id);assert.equal(data.price,p.price);assert.equal(data.stock,p.stock);assert.equal(data.name,p.name);
  assert.ok(html.includes(`productAdd(event,'${id}')`));
  assert.ok(html.includes(p.price.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})));
  assert.ok(schemas.some(s=>s['@type']==='BreadcrumbList'));
  if(p.soldout)assert.match(html,/<button class="btn btn-ink" type="submit" disabled>Produto esgotado/);
 }
});
test('sitemap cobre os destinos canônicos e home expõe links dos 27 produtos sem JavaScript',()=>{
 const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
 assert.equal([...sitemap.matchAll(/<loc>/g)].length,routes.length);
 for(const url of routes)assert.ok(sitemap.includes(`<loc>${base+url}</loc>`));
 for(const id of Object.keys(catalog))assert.ok(read('/').includes(`href="/produtos/${id}/"`));
 assert.match(fs.readFileSync(path.join(root,'robots.txt'),'utf8'),/Allow: \/\n/);
 assert.match(read('/404.html'),/name="robots" content="noindex"/);
});
