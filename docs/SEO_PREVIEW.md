# Liora — pacote de SEO em revisão

Data: 14/09/2026. Produção ainda não autorizada para este pacote.

## Referência e arquitetura

- Repositório: guigaduarte-bit/Liora-site.
- Base: main, commit `1266f2189395fc2fa7955f4ff50e0c64f76e8e18`.
- HTML da home pública idêntico ao arquivo dessa base: SHA-256 `877ca894b5ef325de96a333db5bc52b4eab43cd4734d5ddc6cbe67dbe0d4c0c4`.
- Branch de trabalho: `preview/seo-2026-09-14`.
- Implementação inicial: commit `bd7db434b9d8bd560638a7d0ea761dd67454a397`; [PR #7 em rascunho](https://github.com/guigaduarte-bit/Liora-site/pull/7).
- [Preview Vercel](https://liora-site-git-preview-seo-2026-09-14-circulo-de-cuidado.vercel.app): build informado como Ready pela integração GitHub–Vercel. A URL exige autenticação.
- Stack mantida: HTML/CSS/JavaScript e funções Node em `/api`. Build estático, sem framework adicional.
- `index.html` é o modelo de origem; `npm run build` cria a entrega em `dist/`. A configuração da Vercel usa esse diretório; as funções permanecem no código de `/api`. A disponibilidade efetiva dessas rotas no preview ainda precisa ser confirmada por HTTP autenticado.
- Conteúdo descritivo: `content/product-editorial.json`. IDs, nomes do checkout, preços e estoques: `api/catalog.js`, comparados com o inventário de origem no build.
- 41 páginas: home, 27 produtos, 7 seleções comerciais, aromas, personalização, Sobre e 3 políticas. URLs em `docs/seo-routes.json`.
- Políticas recuperadas do commit `22596bd3f8b7e737735756b0396a7acf83d4f335` da branch jurídica. Não estavam em main.

## Entregas

- Conteúdo dos produtos e links reais presentes no HTML inicial; acesso direto, canonical próprio, Product/Offer, BreadcrumbList e compartilhamento.
- Coleções, aromas e marca em páginas navegáveis; nomes homônimos diferenciados sem alterar o ID do checkout.
- Cores, fontes, fotografias e composição da marca preservadas. Novas páginas seguem a mesma linguagem.
- Sitemap com os 41 destinos de produção; robots permite rastreamento. O cabeçalho `x-robots-tag: noindex` foi confirmado na resposta HTTP 302 de autenticação do preview; falta confirmar a resposta final das páginas autenticadas.
- Carrinho/favoritos atravessam páginas na sessão. Armazenam apenas IDs, quantidade e fragrância. Dados de contato/endereço do comprador não são persistidos.
- Estoque agregado entre fragrâncias, escape de texto, chaves internas seguras e cotação invalidada ao mudar itens. Respostas atrasadas também são descartadas ao apagar um dígito do CEP; regressão reproduzida e corrigida.
- Fragrância limitada a 60 caracteres, acompanhando o contrato já existente da API.
- Newsletter simulada removida; contatos pessoais omitidos. Políticas mantêm aviso de revisão até fechar informação comercial autorizada.
- Imagens com dimensões, carregamento adiado fora da primeira tela e srcset quando há variante útil. Hero prioritário no HTML. Originais intactos; 27 variantes sem ampliação.

## Validação executada

`npm test`: 43 testes aprovados, incluindo 14 testes de checkout preexistentes, políticas, metadados e estado do carrinho.

Os testes comerciais usam respostas simuladas, sem criar pedidos ou cobranças reais. Foram cobertos os valores de R$ 149,99 / R$ 150,00 / R$ 150,01 em Pix e cartão. A gratuidade usa subtotal de produtos antes do desconto Pix; Curitiba permanece R$ 19,90 abaixo do limite; Pix permanece 5%.

O rastreio estático verificou as 41 páginas: um H1, title/description únicos, canonical próprio, destinos internos existentes e imagens essenciais com src/alt. Product/Offer foi comparado com o catálogo para todos os 27 IDs. Isso não equivale a validação pelo Rich Results Test do Google.

O navegador remoto não acessa o servidor local (ERR_BLOCKED_BY_CLIENT). Ao abrir o preview publicado, foi redirecionado para “Login – Vercel”; o GET público não fornece o conteúdo da aplicação. Uma requisição HEAD recebeu 302 para autenticação, com `x-robots-tag: noindex`. O acesso conectado retornou 404 para o projeto Liora, inclusive usando o ID confirmado pelo bot da Vercel, e não conseguiu gerar link temporário de revisão. Portanto a revisão visual, o fluxo real no navegador e a confirmação de status HTTP/APIs da aplicação estão bloqueados por acesso, sem resultado aprovado. O painel `/__preview-qa/` só é gerado em ambiente Preview e permite conferir o mesmo site em quadros de 360, 390, 768 e 1366 px. Não entra no sitemap nem no build de produção.

## Pendências para concluir a revisão

- Acesso autenticado à implantação já criada: obter link temporário de revisão ou conexão com acesso ao projeto Liora. Em seguida, validar páginas/APIs, `noindex` após autenticação, redirects/404 e revisão visual em 360, 390, 768 e 1366 px.
- Fichas de produto: peso e dimensões de produto versus embalagem; materiais; conteúdo e apresentação dos kits; produção; cores disponíveis e cuidados por modelo. Ver `docs/seo-inventory.md`.
- Pequeno Amor: regras antigas de volume e prazo precisam de confirmação; não foram transformadas em desconto automático.
- Canal comercial autorizado e identificação empresarial para as políticas; o preview não deve ser promovido com avisos provisórios. Perfil social atual no HTML diverge do handle informado para o cartão de visitas e precisa de confirmação.
- O conector Vercel atual só expõe o projeto Círculo de Cuidado. Leitura direta de Liora e do deployment conhecido retornou 404 nesse escopo; não alterar o projeto não relacionado.
- Search Console/Nuvemshop sem acesso administrativo confirmado. Tentativa de ler sitemap da loja anterior terminou em timeout; não há inventário externo completo.
- Validar integrações em sandbox configurado, Rich Results Test, desempenho de laboratório e, após publicação aprovada, indexação/links externos.

## Como continuar

1. `npm test` e `LIORA_PREVIEW_QA=1 npm run build` para a prévia de revisão local.
2. Retomar o [PR #7](https://github.com/guigaduarte-bit/Liora-site/pull/7) e o [preview existente](https://liora-site-git-preview-seo-2026-09-14-circulo-de-cuidado.vercel.app). Obter acesso autorizado para testar home → categoria → produto → carrinho, aromas e políticas, sem merge em main.
3. Fechar pendências factuais e operacionais antes de solicitar aprovação de produção.
4. Após aprovação explícita: publicar, conferir os destinos finais e só então ativar a migração externa e enviar sitemap no Search Console.

## Evidências e limite da entrega

`docs/seo-validation-evidence.json` registra o commit da implementação, contagens de testes e resultado sanitizado do acesso ao preview. A base de produção não recebeu merge nem promoção deste pacote. Build Ready não equivale a revisão visual ou homologação dos provedores. O painel de QA não foi aberto no preview devido à autenticação.

## Referências técnicas consultadas

- [Vercel: prévias e noindex](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines).
- [Vercel: funções no diretório api](https://vercel.com/docs/functions/runtimes/node-js).
- [Google: dados estruturados de produto no HTML inicial](https://developers.google.com/search/docs/appearance/structured-data/product-snippet).
