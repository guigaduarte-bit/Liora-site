import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalizeBusinessIdentity,renderBusinessIdentity,applyBusinessIdentity} from '../scripts/business-identity.mjs';

const source = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
// Isolated format fixtures: these are never used by the build or published pages.
const fixture = {cnpj:'12ABC34501DE35',legalName:'Empresa de teste & <exemplo> "LTDA"'};

test('identificação ausente preserva a página sem publicar placeholder ou CNPJ', () => {
  const empty = {cnpj:null,legalName:null};
  const identity = normalizeBusinessIdentity(empty);
  assert.equal(identity, null);
  assert.equal(renderBusinessIdentity(identity), '');
  for (const file of ['index.html','termos-de-uso.html','politica-de-privacidade.html','trocas-e-devolucoes.html']) {
    const original = source(file);
    const rendered = applyBusinessIdentity(original, identity);
    assert.equal(rendered, original.replace('<!-- business:footer -->', ''));
    assert.doesNotMatch(rendered, /class="business-identity"|CNPJ \d|12ABC345/);
  }
});

test('formata CNPJ numérico ou alfanumérico e rejeita dados inválidos ou nome sem CNPJ', () => {
  assert.equal(normalizeBusinessIdentity({...fixture,cnpj:'12345678000190'}).cnpj, '12.345.678/0001-90');
  assert.equal(normalizeBusinessIdentity({...fixture,cnpj:'12.abc.345/01de-35'}).cnpj, '12.ABC.345/01DE-35');
  for (const config of [{cnpj:null,legalName:'Empresa'}, {...fixture,cnpj:'12345678901'}, {...fixture,cnpj:'12ABC34501DEZZ'}, {...fixture,legalName:'  '}]) {
    assert.throws(() => normalizeBusinessIdentity(config));
  }
});

test('CNPJ sem razão social aparece sem nome fictício nem classificação PF ou PJ', () => {
  const identity = normalizeBusinessIdentity({cnpj:fixture.cnpj,legalName:null});
  const footer = renderBusinessIdentity(identity);
  assert.equal(footer, '<p class="business-identity">CNPJ 12.ABC.345/01DE-35</p>');
  for (const file of ['index.html','termos-de-uso.html','politica-de-privacidade.html','trocas-e-devolucoes.html']) {
    const html = applyBusinessIdentity(source(file), identity);
    assert.ok(html.includes(footer));
    assert.doesNotMatch(html, /Empresa de teste|>null<|>undefined<|por pessoa física|A pessoa física responsável|pessoa jurídica/);
  }
  assert.match(applyBusinessIdentity(source('termos-de-uso.html'), identity), /tem identificação comercial no CNPJ/);
  assert.match(applyBusinessIdentity(source('politica-de-privacidade.html'), identity), /A razão social, o endereço e um canal válido/);
});

test('identificação completa escapa o nome e substitui operação e controladora juntas', () => {
  const identity = normalizeBusinessIdentity(fixture);
  const footer = renderBusinessIdentity(identity);
  assert.match(footer, /Empresa de teste &amp; &lt;exemplo&gt; &quot;LTDA&quot;/);
  assert.match(footer, /CNPJ 12\.ABC\.345\/01DE-35/);
  for (const file of ['index.html','termos-de-uso.html','politica-de-privacidade.html','trocas-e-devolucoes.html']) {
    const html = applyBusinessIdentity(source(file), identity);
    assert.ok(html.includes(footer));
    assert.doesNotMatch(html, /<exemplo>|por pessoa física|A pessoa física responsável/);
    if (file !== 'index.html') assert.match(html, /Os dados pessoais de contato e o endereço permanecem omitidos/);
  }
  assert.match(applyBusinessIdentity(source('termos-de-uso.html'), identity), /é operada por <strong>Empresa de teste/);
  assert.match(applyBusinessIdentity(source('politica-de-privacidade.html'), identity), /é a controladora dos dados tratados na operação/);
});
