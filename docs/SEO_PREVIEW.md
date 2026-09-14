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
- `index.html` é o modelo de origem; `npm run build` cria a entrega em `dist/`. A configuração da Vercel usa esse diretório; as funções permanecem no código de `/api`. As quatro rotas responderam em HTTP autenticado: cotação e criação recusaram GET com 405; os dois status de pagamento retornaram JSON 500 e exigem revisão da configuração de Preview.
- Conteúdo descritivo: `content/product-editorial.json`. IDs, nomes do checkout, preços e estoques: `api/catalog.js`, comparados com o inventário de origem no build.
- 41 páginas: home, 27 produtos, 7 seleções comerciais, aromas, personalização, Sobre e 3 políticas. URLs em `docs/seo-routes.json`.
- Políticas recuperadas do commit `22596bd3f8b7e737735756b0396a7acf83d4f335` da branch jurídica. Não estavam em main.

## Entregas

- Conteúdo dos produtos e links reais presentes no HTML inicial; acesso direto, canonical próprio, Product/Offer, BreadcrumbList e compartilhamento.
- Coleções, aromas e marca em páginas navegáveis; nomes homônimos diferenciados sem alterar o ID do checkout.
- Cores, fontes, fotografias e composição da marca preservadas. Novas páginas seguem a mesma linguagem.
- Sitemap com os 41 destinos de produção; robots permite rastreamento. O cabeçalho `x-robots-tag: noindex` foi confirmado nas 52 respostas finais autenticadas, inclusive nas 41 páginas.
- Carrinho/favoritos atravessam páginas na sessão. Armazenam apenas IDs, quantidade e fragrância. Dados de contato/endereço do comprador não são persistidos.
- Estoque agregado entre fragrâncias, escape de texto, chaves internas seguras e cotação invalidada ao mudar itens. Respostas atrasadas também são descartadas ao apagar um dígito do CEP; regressão reproduzida e corrigida.
- Fragrância limitada a 60 caracteres, acompanhando o contrato já existente da API.
- Newsletter simulada removida; contatos pessoais omitidos. Políticas mantêm aviso de revisão até fechar informação comercial autorizada.
- Imagens com dimensões, carregamento adiado fora da primeira tela e srcset quando há variante útil. Hero prioritário no HTML. Originais intactos; 27 variantes sem ampliação.

## Validação executada

`npm test`: 43 testes aprovados, incluindo 14 testes de checkout preexistentes, políticas, metadados e estado do carrinho.

Os testes comerciais usam respostas simuladas, sem criar pedidos ou cobranças reais. Foram cobertos os valores de R$ 149,99 / R$ 150,00 / R$ 150,01 em Pix e cartão. A gratuidade usa subtotal de produtos antes do desconto Pix; Curitiba permanece R$ 19,90 abaixo do limite; Pix permanece 5%.

O rastreio estático verificou as 41 páginas: um H1, title/description únicos, canonical próprio, destinos internos existentes e imagens essenciais com src/alt. Product/Offer foi comparado com o catálogo para todos os 27 IDs. Isso não equivale a validação pelo Rich Results Test do Google.

A sessão existente do navegador passou a abrir a prévia em 14/09/2026. Foram verificadas 20 combinações: home, catálogo, Lady Veil, aromas e trocas em 360, 390, 768 e 1366 px, sem elementos excedendo a largura na medição do conteúdo principal e sem imagens quebradas reportadas. A verificação usa iframe com largura CSS real; não equivale a dispositivo físico ou Core Web Vitals. Desktop e celular tiveram capturas de referência.

O fluxo produto → fragrância/quantidade → carrinho → início da compra foi exercitado. Carrinho e fragrância sobreviveram à troca de página e ao recarregamento; CEP e endereço ficaram vazios. Menu móvel, busca com três versões Botanique, favoritos e bloqueio do produto esgotado passaram. As miniaturas do carrinho terminaram de carregar corretamente.

A interface hospedada mostrou subtotal de R$ 124,00, frete Curitiba de R$ 19,90, total Pix de R$ 137,70 e total cartão/boleto de R$ 143,90. Para R$ 186,00 em produtos, mostrou frete grátis e Pix de R$ 176,70. A SuperFrete informa explicitamente cotações demonstrativas. Nenhum pedido, pagamento ou boleto foi criado; os itens simulados foram removidos ao terminar.

A chamada HTTP externa continua em 302/login com noindex, e o acesso conectado ao projeto não conseguiu gerar link temporário. O painel `/__preview-qa/` recebeu um botão Verificar HTTP para conferir os destinos por meio da sessão autenticada da própria aplicação. O botão foi executado no commit `9fefa1e`: 50/52 resultados esperados; 41 páginas retornaram 200, sitemap/robots 200, caminho inexistente 404 e quatro aliases chegaram a 200 no destino correto. Todas as respostas tinham noindex. Os dois resultados pendentes são 500 JSON em `/api/payment-status` e `/api/infinitepay-status`, sem parâmetros. O código verifica MP_ACCESS_TOKEN/INFINITEPAY_HANDLE antes dos parâmetros: isso é compatível com configuração ausente em Preview, sem leitura dos valores. Não foi observado o código HTTP intermediário dos redirects; `permanent: true` permanece na configuração. O painel é excluído do build de produção e do sitemap.

## Pendências para concluir a revisão

- Configurar e validar os provedores em Preview/sandbox: SuperFrete está demonstrativa e os status de Mercado Pago/InfinitePay retornaram 500. Não copiar credenciais de produção; manter a proteção da implantação.
- Fichas de produto: peso e dimensões de produto versus embalagem; materiais; conteúdo e apresentação dos kits; produção; cores disponíveis e cuidados por modelo. Ver `docs/seo-inventory.md`.
- Pequeno Amor: regras antigas de volume e prazo precisam de confirmação; não foram transformadas em desconto automático.
- Canal comercial autorizado e identificação empresarial para as políticas; o preview não deve ser promovido com avisos provisórios. Perfil social atual no HTML diverge do handle informado para o cartão de visitas e precisa de confirmação.
- O conector Vercel atual só expõe o projeto Círculo de Cuidado. Leitura direta de Liora e do deployment conhecido retornou 404 nesse escopo; não alterar o projeto não relacionado.
- Search Console/Nuvemshop sem acesso administrativo confirmado. Tentativa de ler sitemap da loja anterior terminou em timeout; não há inventário externo completo.
- Validar integrações em sandbox configurado, Rich Results Test, desempenho de laboratório e, após publicação aprovada, indexação/links externos.

## Como continuar

1. `npm test` e `LIORA_PREVIEW_QA=1 npm run build` para a prévia de revisão local.
2. Retomar o [PR #7](https://github.com/guigaduarte-bit/Liora-site/pull/7) e o [preview existente](https://liora-site-git-preview-seo-2026-09-14-circulo-de-cuidado.vercel.app). Usar os resultados de `docs/seo-http-evidence.json` e manter a sessão autorizada para repetir somente os dois checks de API após resolver sua configuração, sem merge em main.
3. Fechar pendências factuais e operacionais antes de solicitar aprovação de produção.
4. Após aprovação explícita: publicar, conferir os destinos finais e só então ativar a migração externa e enviar sitemap no Search Console.

## Evidências e limite da entrega

`docs/seo-validation-evidence.json` registra o commit da implementação, contagens de testes e resultado sanitizado do acesso ao preview. A base de produção não recebeu merge nem promoção deste pacote. `docs/seo-browser-evidence.json` registra a revisão visual e os fluxos efetivamente exercitados. `docs/seo-http-evidence.json` contém as 52 respostas sanitizadas e os dois bloqueios de API. `docs/seo-migration-evidence.md` fundamenta o mapa de 30 URLs candidatas, com correspondência proposta de Essenciais e duas categorias ainda sem destino confirmado. Build Ready e teste do carrinho não equivalem a homologação dos provedores.

## Referências técnicas consultadas

- [Vercel: prévias e noindex](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines).
- [Vercel: funções no diretório api](https://vercel.com/docs/functions/runtimes/node-js).
- [Google: dados estruturados de produto no HTML inicial](https://developers.google.com/search/docs/appearance/structured-data/product-snippet).
