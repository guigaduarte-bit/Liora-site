# Frete por carrinho — Liora

Atualização: 20/10/2026. Sete pesos Flora Línea informados pelo usuário e cinco conjuntos de medidas estimadas cadastrados no preview. Estimador implementado; embalagens e transportadora ainda não homologadas. Disponibilidade a confirmar mantida; publicação em produção depende de aprovação.

## Dados separados

- `content/shipping-products.json`: peso total e dimensões de cada peça. A Botanique 250 g foi confirmada com 475 g, altura 16 cm e diâmetro 9 cm. Os sete pesos Flora Línea informados em 19/10 constam da tabela abaixo. Os demais dados são referências do catálogo, sem confirmação automática para postagem. Lady Veil e Anjo em Vitral não têm três dimensões. Botanique 150 g ainda não tem peso completo. São 31 pesos e 29 conjuntos completos de dimensões (cinco estimados) em 32 SKUs.
- `content/shipping-packaging-estimate.json`: nove modelos RPC dos Correios, taras provisórias e parâmetros de proteção. Nenhuma estimativa deve ser gravada como peso medido.
- `api/_shipping-estimate.js`: compõe caixas conforme os produtos e quantidades. A responsável não precisa medir todas as combinações de compra; validar caixas e regras com amostras representativas.

## Pesos informados em 19/10 e medidas estimadas em 20/10/2026

| Modelo | Peso total da peça informado | Dimensões da peça (C × L × A) |
|---|---:|---|
| Caixa quadrada média | 420 g | 20 × 20 × 10 cm, estimativa |
| Caixa redonda floral | 460 g | 20 × 20 × 12 cm, estimativa |
| Caixa floral grande (R$ 129,90) | 480 g | 24 × 24 × 10 cm, estimativa |
| Vaso de gesso P | 200 g | 12 × 12 × 12 cm, referência anterior do catálogo |
| Vaso de metal com alça | 265 g | 16 × 16 × 22 cm, estimativa |
| Vaso floral de cerâmica | 520 g | 15 × 15 × 18 cm, referência anterior do catálogo |
| Caixa flor solitária | 100 g | 10 × 10 × 6 cm, estimativa |

O vaso cerâmico foi corrigido de 700 g para 520 g. A caixa de apresentação e o recipiente integram a peça; a caixa externa de transporte/proteção continua separada. Nenhum peso de embalagem foi deduzido desses valores. As dimensões anteriores não foram reconfirmadas nesta mensagem. `confirmedForShipping` continua falso e as taras/medidas protegidas continuam sem homologação física. Os sete modelos mantêm estoque 10, disponibilidade a confirmar e compra bloqueada conforme orientação expressa do usuário.

## Cálculo de estimativa

Peso por volume = soma(peso total da peça × quantidade) + tara da caixa + 50 g por peça + 50 g por caixa.

A tara é somada uma vez por caixa. Fragrâncias do mesmo SKU são agrupadas. Somente dados do servidor fornecem pesos e dimensões; valores enviados pelo navegador são ignorados.

Hipóteses editáveis, sem certificação: proteção de 1,5 cm por face; parede de 0,5 cm por face. As dimensões RPC são tratadas como externas no modelo; as internas ficam 1 cm menores em cada eixo. A massa de proteção e sua espessura são hipóteses independentes. A Botanique ocupa 12 × 12 × 19 cm protegida e fica no limite da altura interna estimada da G20. Com 2 cm por face, é necessária caixa mais alta para manter a peça em pé.

A acomodação usa milímetros inteiros, peças em pé, rotação somente da base, sem empilhamento. Retângulos livres não se sobrepõem. Tenta a menor caixa por volume que comporta o conjunto; quando nenhuma comporta tudo, divide em volumes usando a caixa que recebe mais peças. É uma heurística conservadora, não uma solução ótima de empacotamento. Pode utilizar mais caixas que uma montagem manual. Limites: 100 peças e 20 volumes.

Qualquer produto incompleto ou que não cabe impede um resultado parcial silencioso. Jardim Encantado precisa de caixa maior neste modelo. Medidas estimadas não equivalem a medições extraídas de fotografias; manter a indicação de estimativa até a conferência física.

## Isolamento do preview e integração

O modo de estimativa só é ativado por `VERCEL_ENV=preview` no servidor; campos do cliente não podem ativá-lo.

- `/__preview-frete/`: ferramenta de conferência, gerada somente no build de preview (ou build local de QA). Permite testar os 32 modelos e carrinhos hipotéticos, inclusive quantidades maiores que o estoque, sem fazer compra nem alterar estoque.
- `/api/preview-shipping-estimate`: GET de dados públicos do catálogo e POST de estimativa; retorna 404 fora do ambiente Preview. Sem chamadas a transportadoras ou pagamentos.
- `/api/shipping-quote`: continua validando o estoque real do checkout. No Preview acrescenta o resumo da embalagem. Com credenciais disponíveis, envia uma consulta por volume à SuperFrete usando apenas `package`, com dimensões externas e peso total convertido de g para kg. Não envia `products` junto, pois `package` prevalece na API.
- Cotações externas com embalagem estimada recebem `preview: true` e `estimated: true`. São bloqueadas no botão de pagamento e revalidadas/bloqueadas no servidor antes de qualquer criação de pagamento.
- Sem credenciais ou com falha do provedor, a embalagem permanece visível com aviso; não são inventadas tarifas para esta estimativa. Múltiplos volumes são cotados separadamente. Só são oferecidas modalidades presentes em todas as caixas, com soma em centavos e o maior prazo de transporte. Se faltar prazo em um volume, o prazo total fica desconhecido. Falha em qualquer volume impede oferta externa parcial; a entrega local permanece independente.
- A entrega local de Curitiba mantém sua regra independente. Frete grátis a partir de R$ 150 em produtos, antes do Pix, continua com o mesmo alcance do código existente; não foi limitado a Curitiba. Pix mantém 5% de desconto. Produção: 10 dias úteis após pagamento e personalização confirmados, acrescidos do transporte.
- Fora do Preview, permanece o caminho anterior `buildShippingProducts`, que exige dados logísticos confirmados por SKU. A promoção do código para produção não ativa a estimativa automaticamente. A migração definitiva para caixas por pedido é uma próxima etapa após validação.

## Evidências locais

Evidência histórica anterior a 01/10/2026: 142 testes aprovados, com build de 41 páginas. Inclui 27 modelos (23 estimáveis, três incompletos e um sem caixa), conservação de todos os 23 modelos completos no mesmo carrinho, colisões/limites, rotação, tara por volume, conversão para kg, estoque, falsificação de dados, bloqueio de cobrança estimada, preservação das regras existentes e isolamento de produção. Chamadas de provedores foram simuladas em memória; não homologam as contas externas.

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
4. Homologar no ambiente real cotações e emissão de etiquetas para múltiplos volumes antes de liberar esse caso para cobrança. O cálculo separado já foi implementado no Preview em 01/10/2026; nenhuma etiqueta foi emitida. Cada etiqueta deve reproduzir seu pacote real.
5. Revisar a regra operacional aprovada, ativar apenas dados conferidos e testar pagamento/retorno antes da aprovação de produção.

## Fontes

- Correios: https://www.correios.com.br/Plone/enviar/encomendas/arquivo/nacional/guia-tecnico-embalagens-rpc_v1-1.pdf — dimensões dos modelos RPC. Resistência não é tara; o guia não confirma estoque de caixas em uma agência.
- SuperFrete: https://superfrete.readme.io/reference/cotacao-de-frete — `products`, `package`, unidades e consistência com a etiqueta.

## Múltiplos volumes — 01/10/2026

O seguro usa o valor dos produtos de cada caixa no catálogo do servidor. Antes de consultar, o código confere se todos os itens e quantidades foram conservados e se os valores por caixa somam o subtotal. A recuperação de seguro mínimo é avaliada por volume; uma caixa de R$ 75 não perde o seguro porque outra contém R$ 24.

A cotação traz `parcelCount` e `components` para conferência. A gratuidade é aplicada após totalizar, mantendo `originalPrice` como custo integral. Máximo de três consultas simultâneas, timeout de oito segundos por requisição e limite total de quinze segundos. Preço ausente, booleano ou vazio é inválido, nunca frete grátis. Prazo ausente permanece desconhecido.

Teste local focado: 46/46 aprovados, incluindo dez casos novos de múltiplos volumes/normalização/timeout e o bloqueio de pagamento estimado. Isso não valida medidas físicas, conta real, etiquetas ou a divergência de centavos da Botanique. O plano principal registra o resultado da suíte completa e do Preview desta rodada.


## Estimativas de dimensões — 20/10/2026

A pedido do usuário, os cinco cadastros que estavam sem dimensões receberam hipóteses de planejamento. Os valores não foram medidos nem calculados pelo peso ou por escala fotográfica. Consideram a peça completa com recipiente/tampa e saliências do arranjo; no vaso metálico, a altura inclui a composição. A alça deve ficar na posição real de transporte. Nas caixas redonda e floral, comprimento e largura delimitam o contorno externo. A caixa individual corresponde a uma unidade, ainda que a foto mostre duas.

As fichas apresentam “Medidas estimadas (C × L × A)” e aviso de conferência. O dado `dimensionsEstimated: true` identifica esses cinco registros; o simulador mostra a indicação na tabela, no pedido e no resultado. O preenchimento não altera `confirmedForShipping: false`, não preenche dimensões de postagem homologadas e não libera a compra.

| Modelo | Peça com proteção de 1,5 cm por face | Resultado individual da hipótese |
|---|---|---|
| Caixa quadrada média | 23 × 23 × 13 cm | G16, peso total estimado 790 g |
| Caixa redonda floral | 23 × 23 × 15 cm | G16, peso total estimado 830 g |
| Caixa flor solitária | 13 × 13 × 9 cm | M12, peso total estimado 350 g |
| Vaso de metal com alça | 19 × 19 × 25 cm | Nenhuma das nove caixas acomoda a altura em pé |
| Caixa floral grande | 27 × 27 × 13 cm | Nenhuma das nove caixas acomoda a largura |

A G16 tem interior estimado de 31 × 23 × 15 cm: redonda e quadrada usam o limite de largura, e a redonda também o de altura. Não há folga adicional além da proteção considerada. Conferir fisicamente antes de adotar. A caixa floral grande requer interior de pelo menos 27 × 27 × 13 cm; o vaso metálico, 19 × 19 × 25 cm nesta hipótese. Essas são necessidades geométricas, não novos modelos de caixa cadastrados ou recomendação de compra. O vaso cerâmico de referência continua precisando de outra caixa para seus 18 × 18 × 21 cm protegidos.

Os 32 modelos resultam em 26 estimativas, três cadastros incompletos e três casos sem caixa. Pedidos que incluem um produto sem caixa seguem bloqueados integralmente, sem apresentar peso/cotação parcial. Próxima ação: conferir uma amostra de cada formato, medir a embalagem fechada, validar proteção e tara, e cadastrar caixas maiores se as medidas reais confirmarem a necessidade. A aprovação para produção permanece separada da liberação comercial desses sete modelos.
