# Frete por carrinho — Liora

Atualização: 27/09/2026. Estimador implementado no preview. Embalagens e transportadora ainda não homologadas; publicação em produção depende de aprovação.

## Dados separados

- `content/shipping-products.json`: peso total e dimensões de cada peça. A Botanique 250 g foi confirmada com 475 g, altura 16 cm e diâmetro 9 cm. Os demais dados são referências do catálogo, sem confirmação automática para postagem. Lady Veil e Anjo em Vitral não têm três dimensões; Botanique 150 g também não tem peso completo. São 26 pesos e 24 conjuntos completos de dimensões em 27 SKUs.
- `content/shipping-packaging-estimate.json`: nove modelos RPC dos Correios, taras provisórias e parâmetros de proteção. Nenhuma estimativa deve ser gravada como peso medido.
- `api/_shipping-estimate.js`: compõe caixas conforme os produtos e quantidades. A responsável não precisa medir todas as combinações de compra; validar caixas e regras com amostras representativas.

## Cálculo de estimativa

Peso por volume = soma(peso total da peça × quantidade) + tara da caixa + 50 g por peça + 50 g por caixa.

A tara é somada uma vez por caixa. Fragrâncias do mesmo SKU são agrupadas. Somente dados do servidor fornecem pesos e dimensões; valores enviados pelo navegador são ignorados.

Hipóteses editáveis, sem certificação: proteção de 1,5 cm por face; parede de 0,5 cm por face. As dimensões RPC são tratadas como externas no modelo; as internas ficam 1 cm menores em cada eixo. A massa de proteção e sua espessura são hipóteses independentes. A Botanique ocupa 12 × 12 × 19 cm protegida e fica no limite da altura interna estimada da G20. Com 2 cm por face, é necessária caixa mais alta para manter a peça em pé.

A acomodação usa milímetros inteiros, peças em pé, rotação somente da base, sem empilhamento. Retângulos livres não se sobrepõem. Tenta a menor caixa por volume que comporta o conjunto; quando nenhuma comporta tudo, divide em volumes usando a caixa que recebe mais peças. É uma heurística conservadora, não uma solução ótima de empacotamento. Pode utilizar mais caixas que uma montagem manual. Limites: 100 peças e 20 volumes.

Qualquer produto incompleto ou que não cabe impede um resultado parcial silencioso. Jardim Encantado precisa de caixa maior neste modelo. Não deduzir dimensões ausentes a partir de fotografias.

## Isolamento do preview e integração

O modo de estimativa só é ativado por `VERCEL_ENV=preview` no servidor; campos do cliente não podem ativá-lo.

- `/__preview-frete/`: ferramenta de conferência, gerada somente no build de preview (ou build local de QA). Permite testar os 27 modelos e carrinhos hipotéticos, inclusive quantidades maiores que o estoque, sem fazer compra nem alterar estoque.
- `/api/preview-shipping-estimate`: GET de dados públicos do catálogo e POST de estimativa; retorna 404 fora do ambiente Preview. Sem chamadas a transportadoras ou pagamentos.
- `/api/shipping-quote`: continua validando o estoque real do checkout. No Preview acrescenta o resumo da embalagem. Com um volume e credenciais disponíveis, envia à SuperFrete apenas `package`, com dimensões externas e peso total convertido de g para kg. Não envia `products` junto, pois `package` prevalece na API.
- Cotações externas com embalagem estimada recebem `preview: true` e `estimated: true`. São bloqueadas no botão de pagamento e revalidadas/bloqueadas no servidor antes de qualquer criação de pagamento.
- Sem credenciais ou com falha do provedor, a embalagem permanece visível com aviso; não são inventadas tarifas para esta estimativa. Múltiplos volumes são mostrados separadamente e ainda não geram cotação conjunta. Não tratá-los como um único pacote fictício.
- A entrega local de Curitiba mantém sua regra independente. Frete grátis a partir de R$ 150 em produtos, antes do Pix, continua com o mesmo alcance do código existente; não foi limitado a Curitiba. Pix mantém 5% de desconto. Produção: 10 dias úteis após pagamento e personalização confirmados, acrescidos do transporte.
- Fora do Preview, permanece o caminho anterior `buildShippingProducts`, que exige dados logísticos confirmados por SKU. A promoção do código para produção não ativa a estimativa automaticamente. A migração definitiva para caixas por pedido é uma próxima etapa após validação.

## Evidências locais

Suite atual: 142 testes aprovados, com build de 41 páginas. Inclui 27 modelos (23 estimáveis, três incompletos e um sem caixa), conservação de todos os 23 modelos completos no mesmo carrinho, colisões/limites, rotação, tara por volume, conversão para kg, estoque, falsificação de dados, bloqueio de cobrança estimada, preservação das regras existentes e isolamento de produção. Chamadas de provedores foram simuladas em memória; não homologam as contas externas.

| Exemplo | Resultado |
|---|---|
| Uma Botanique | G20, 875 g |
| Duas Botanique | G20, 1.400 g |
| Quatro Mini Bubble | M08, 530 g |
| Uma Botanique e dois Ursinhos | G20, 1.055 g |
| Quatro Botanique, hipótese no simulador | Duas G20 de 1.400 g; checkout continua recusando quantidade acima do estoque |

## Próximas etapas de homologação

1. Confirmar os modelos de caixa realmente adotados, suas dimensões internas/externas e tara; calibrar proteção com uma peça, duas iguais e um pedido misto. Não exigir todas as combinações.
2. Completar os dados faltantes de peças e revisar pesos totais de outros vidros/kits. Nunca presumir que o nome do produto é o peso completo.
3. Configurar credenciais e origem no Preview sem gravar segredos no repositório. Comparar cotação da API com painel usando peso, caixa, CEPs, valor declarado e serviços iguais.
4. Implementar/homologar cotações e etiquetas para múltiplos volumes antes de liberar esse caso para cobrança. A etiqueta deve reproduzir o pacote real.
5. Revisar a regra operacional aprovada, ativar apenas dados conferidos e testar pagamento/retorno antes da aprovação de produção.

## Fontes

- Correios: https://www.correios.com.br/Plone/enviar/encomendas/arquivo/nacional/guia-tecnico-embalagens-rpc_v1-1.pdf — dimensões dos modelos RPC. Resistência não é tara; o guia não confirma estoque de caixas em uma agência.
- SuperFrete: https://superfrete.readme.io/reference/cotacao-de-frete — `products`, `package`, unidades e consistência com a etiqueta.
