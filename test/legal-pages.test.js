'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const pages = [
  ['trocas-e-devolucoes.html', 'Trocas e devoluções'],
  ['termos-de-uso.html', 'Termos de uso'],
  ['politica-de-privacidade.html', 'Política de privacidade']
];

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('páginas legais existem, têm estrutura acessível e seguem a identidade Liora', () => {
  for (const [file, heading] of pages) {
    const html = read(file);
    assert.match(html, /<html lang="pt-BR">/);
    assert.match(html, new RegExp(`<h1>${heading}<\\/h1>`, 'i'));
    assert.match(html, /<meta name="description" content="[^"]+">/);
    assert.match(html, /<link rel="stylesheet" href="\/assets\/legal\.css">/);
    assert.match(html, /class="skip-link" href="#conteudo"/);
    assert.match(html, /<main id="conteudo">/);
    assert.match(html, /aria-label="Nesta página"/);
    assert.match(html, /href="\/" aria-label="Liora Aromas de Luxo — página inicial"/);
    assert.doesNotMatch(html, /href="#"/);
  }
});

test('preview omite dados pessoais e sinaliza a proteção aplicada', () => {
  for (const [file] of pages) {
    const html = read(file);
    assert.match(html, /Dados protegidos neste preview/);
    assert.match(html, /omite dados pessoais e cadastrais/);
    assert.doesNotMatch(html, /mailto:|wa\.me\/|CPF\/CNPJ:|Endereço físico:/i);
    assert.doesNotMatch(html, /\[[^\]]+A INFORMAR\]/i);
  }
});

test('conteúdo inclui garantias essenciais de consumo e privacidade', () => {
  const returns = read('trocas-e-devolucoes.html');
  assert.match(returns, /7 dias corridos após o recebimento/);
  assert.match(returns, /velas personalizadas por cor e fragrância/);
  assert.match(returns, /não realizamos troca comercial por simples mudança de preferência/);
  assert.match(returns, /cor ou fragrância diferente da confirmada/);
  assert.match(returns, /inclusive o frete original/);
  assert.match(returns, /ausência da embalagem original[^<]+não afasta/i);
  assert.doesNotMatch(returns, /personalizad[oa]s? não (?:podem|serão) (?:ser )?devolvid[oa]s?/i);

  const terms = read('termos-de-uso.html');
  assert.match(terms, /Código de Defesa do Consumidor/);
  assert.match(terms, /Mercado Pago ou pela InfinitePay/);
  assert.match(terms, /Política de Trocas e Devoluções/);
  assert.match(terms, /cor e a fragrância confirmadas/);

  const privacy = read('politica-de-privacidade.html');
  assert.match(privacy, /Lei Geral de Proteção de Dados/);
  assert.match(privacy, /não são armazenados pela Liora/);
  assert.match(privacy, /formulário de novidades[^<]+não registra nem envia o e-mail/i);
});

test('rodapé da loja aponta para as três páginas e não usa mais aviso em toast', () => {
  const index = read('index.html');
  for (const [file] of pages) assert.match(index, new RegExp(`href="\\/${file}"`));
  assert.doesNotMatch(index, /toast\('Trocas em até 7 dias/);
});

test('newsletter simulada não promete cadastro inexistente', () => {
  const index = read('index.html');
  assert.doesNotMatch(index, /id="newsForm"|Inscrição confirmada/);
  assert.match(index, /Uma nova experiência está chegando/);
});

test('links internos entre páginas legais apontam para arquivos existentes', () => {
  for (const [file] of pages) {
    const html = read(file);
    const links = [...html.matchAll(/href="\/([^"#?]+\.html)"/g)].map(match => match[1]);
    for (const target of links) {
      assert.ok(fs.existsSync(path.join(root, target)), `${file} aponta para ${target}, que não existe`);
    }
  }
});
