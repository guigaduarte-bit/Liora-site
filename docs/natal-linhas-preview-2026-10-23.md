# Gingerbread e Gnomos de Natal — preview para aprovação

## Escopo

- Duas linhas na aba Natal e também em Kits e presentes Natal Liora.
- R$ 25,00 por unidade; aviso explícito de que as fotos apresentam diferentes estampas.
- Compra pelo mesmo SKU e mesma página nas duas abas, sem duplicar estoque ou preços.
- Fotos ambientadas com pedra bege clara, ramos de pinheiro, luzes quentes e detalhes dourados, seguindo a foto do Cavalinho de balanço da aba Natal.
- Fotos originais preservadas na galeria de cada produto.
- Publicação em produção depende da aprovação solicitada pelo usuário; apenas a branch de preview foi atualizada.

## Referências e imagens

Entradas: `IMG_2008.jpg` (seis Gingerbread), `IMG_2007.jpg` (três Gnomos).
Referência visual: `assets/images/natal-cavalinho-de-balanco.webp`.
Edição realizada com a ferramenta integrada de geração de imagens. Arquivos do site:

- `assets/images/natal-gingerbread-ambientada.webp`
- `assets/images/natal-gnomos-de-natal-ambientada.webp`
- Versões responsivas de 360 px e 720 px na pasta `assets/images/responsive/`.

Direção dos prompts: substituir o fundo pelo cenário natalino da referência, com travertino bege, pinheiro, luzes douradas, laço e enfeite champanhe. Preservar os seis desenhos Gingerbread, tampas de madeira e marca Liora; preservar os três desenhos de Gnomos, potes de vidro e tampas de cortiça. Enquadramento de catálogo 4:5, produtos integralmente visíveis, sem textos ou preços adicionados. Para Gingerbread, seis potes em dois grupos de três; para Gnomos, os três potes lado a lado na ordem original. Não inserir o cavalinho da referência.

## Validação

- `npm test`: 263 aprovados, zero falhas.
- Build valida arquivos e metadados das imagens, sincronização do catálogo e preços.
- Kits e presentes: 15 cards, incluindo os dois produtos vinculados às páginas de compra.
- Preços, descrições, imagem principal e links dos dois novos cards conferidos no HTML final.
- Nenhum pagamento real realizado nesta alteração.

Preview: https://liora-site-git-preview-natal-2310-circulo-de-cuidado.vercel.app/kits-e-presentes-natal/
Branch: `preview/natal-2310`.
Base de produção preservada: `bc3b172a1225ce34fbd821c692aa4d597f15e87e`.
