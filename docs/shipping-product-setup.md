# Frete por carrinho — Liora

Atualização: 20/10/2026. A pedido do usuário, o checkout voltou à configuração anterior de venda, sem depender de estimar ou preencher peso e dimensões de cada peça. Alteração preparada em preview; publicação depende da validação solicitada pelo usuário.

## Configuração ativa

`api/_shipping.js` recupera a função `packageFor` anterior ao commit `264c64a`. A SuperFrete recebe um único `package` com parâmetros automáticos do pedido:

- Comprimento e largura: 20 cm.
- Altura: 12 cm + 3 cm por unidade, limitada a 60 cm.
- Peso: 0,35 kg por unidade, com mínimo de 0,30 kg e o mesmo arredondamento da versão anterior.

São os parâmetros de cotação já usados pela loja, não medições reais das peças. O cadastro individual em `content/shipping-products.json` não é requisito para vender nem para cotar o frete. Peso, medidas e flags enviados pelo navegador não alteram essa regra. Estoque, disponibilidade, preços, quantidade e a cotação escolhida continuam sendo revalidados no servidor antes do pagamento.

Mantidos: entrega em Curitiba por R$ 19,90; gratuidade a partir de R$ 150 em produtos, antes do desconto; desconto de 5% no Pix; prazo de produção de 10 dias úteis acrescido do transporte. As melhorias de seguro, tratamento de falhas, prazo de consulta e confirmação de pagamento foram preservadas.

## Dados do catálogo

As cinco medidas estimadas acrescentadas em 20/10 foram removidas de `content/products.json`, `content/product-editorial.json` e `content/shipping-products.json`. Foram preservados os pesos informados pelo usuário e as medidas previamente existentes.

| Modelo Flora Línea | Peso informado |
|---|---:|
| Caixa quadrada média | 420 g |
| Caixa redonda floral | 460 g |
| Caixa floral grande | 480 g |
| Vaso de gesso P | 200 g |
| Vaso de metal com alça | 265 g |
| Vaso floral de cerâmica | 520 g |
| Caixa flor solitária | 100 g |

Esses sete modelos continuam com estoque 10 e “Disponibilidade a confirmar”, conforme a instrução comercial anterior. Sua indisponibilidade não decorre mais de requisito logístico do checkout. Nenhum produto foi liberado ou retirado de venda nesta alteração.

## Simulador separado

O simulador `/__preview-frete/` e `/api/preview-shipping-estimate` permanece exclusivamente como ferramenta técnica de preview. Não interfere no carrinho por padrão. A integração experimental exige explicitamente `LIORA_SHIPPING_ESTIMATE=true` no servidor, além de `VERCEL_ENV=preview`; não foi ativada nesta revisão. Em produção a regra padrão permanece, mesmo com a flag presente.

O módulo isolado `_shipping-products.js` mantém sua validação para eventual uso futuro com dados medidos; não é usado no checkout ativo. Nenhum peso ou dimensão foi marcado como confirmado para postagem.

## Verificação

`npm test`: 192 testes aprovados, incluindo build das páginas, todos os produtos vendáveis cotando em produção e preview sem dados logísticos por peça, parâmetros originais por quantidade, dados adulterados no navegador ignorados, estoque agregado por SKU, disponibilidade, frete de Curitiba, gratuidade, Pix e revalidação do frete antes do pagamento.

Provedores externos foram simulados nos testes. Nenhuma compra, cobrança ou etiqueta real foi criada.
