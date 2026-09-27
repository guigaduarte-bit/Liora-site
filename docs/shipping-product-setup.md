# Frete por produto — Liora

Atualização: 27/09/2026. Preparação em preview, sem homologação de transportadora e sem publicação em produção.

## Regra de cálculo

O peso das peças é a soma do peso unitário de cada SKU multiplicado por sua quantidade. Fragrâncias diferentes do mesmo SKU não mudam esse peso. A integração deve enviar `products` à SuperFrete, com quantidade, peso em kg e três dimensões em cm por unidade, sem o antigo `package` fixo. A API calcula o acondicionamento e devolve o preço conforme os CEPs de origem/destino, serviço e contrato.

O cadastro guarda o peso da peça separado do acréscimo de proteção/acondicionamento. A informação destinada à transportadora precisa representar o peso efetivamente postado, incluindo recipiente, tampa, proteção e embalagem. Não usar somente o peso de cera de um produto em vidro. A distribuição do peso de acondicionamento por unidade precisa ser conferida com pedidos reais, simples e mistos; não inventar uma margem universal.

Os Correios também podem considerar o peso cúbico: comprimento × largura × altura em centímetros ÷ 6.000. A fórmula não calcula preço em reais. Não implementar tabela ou limiar de cubagem local; o provedor aplica as condições do serviço/contrato. A API direta dos Correios recebe peso em gramas; a SuperFrete recebe em kg.

## Dados e liberação

`content/shipping-products.json` é o cadastro de logística do servidor. Os dados originais de `content/products.json` são referências do catálogo, não uma medição de expedição. `confirmedForShipping` só pode ser ativado depois de revisar peso da peça completa, proteção, três dimensões efetivas e acondicionamento para pedidos mistos.

Não preencher dados ausentes a partir de fotografias. Não usar os nomes Botanique 250 g / 150 g como prova do peso do conjunto com vidro e tampa. Lady Veil não tem três dimensões cadastradas; Anjo em Vitral tem apenas duas. Há 25 pesos explícitos e 23 conjuntos completos de dimensões no catálogo de 27 itens.

Com credenciais de transportadora configuradas, um carrinho com qualquer SKU incompleto não deve gerar cotação parcial ou valor fictício. A entrega local mantém suas condições independentes. Sem credenciais, as opções demonstrativas continuam identificadas e bloqueadas para pagamento.

## Homologação

1. Medir e confirmar os dados de cada SKU e sua proteção. Conferir principalmente itens com vidro, tampa e kits.
2. Configurar token Sandbox, origem, endpoint e contato técnico funcional no Preview. Os segredos não entram em arquivos públicos.
3. Comparar a API com o painel SuperFrete usando os mesmos itens, quantidades, CEPs, valor declarado e serviços.
4. Conferir se o acondicionamento proposto pela API é viável para velas frágeis. Registrar as dimensões retornadas e reproduzi-las ao emitir a etiqueta; caso o pacote real seja diferente, recalcular antes de cobrar/postar.
5. Cobrir uma peça, duas iguais, produtos mistos, kit, item com medidas ausentes, rota sem modalidade e alteração do carrinho/CEP. Conferir Curitiba R$ 19,90 e gratuidade em subtotal de produtos ≥ R$ 150 antes do desconto Pix.
6. Concluir consulta de preço real no ambiente correto, sem compra de etiqueta, antes de afirmar preço/cobertura homologados. Pagamentos e emissão de etiquetas continuam etapas separadas.

## Identificação comercial

`content/business.json` reúne a identificação comercial para o build. O CNPJ e o nome empresarial foram informados pela responsável em 27/09/2026 no pedido de inclusão da identificação no site. O nome fantasia continua Liora Aromas de Luxo. A identificação fornecida aparece no rodapé e nas políticas. A validação local não consulta nem comprova situação cadastral. A autorização para a identificação empresarial não autoriza divulgar CPF, endereço residencial ou outros dados pessoais.

## Fontes oficiais consultadas

- [SuperFrete — Cotação por produtos](https://superfrete.readme.io/reference/calculator)
- [SuperFrete — Peso real e cubagem dos Correios](https://ajuda.superfrete.com/artigo/como-funciona-o-calculo-dos-correios/)
- [Correios — Manual da API Preço](https://www.correios.com.br/atendimento/developers/manuais/manual-api-preco-1)

O procedimento de emissão de etiquetas não foi implementado nesta mudança. A produção continua dependendo de preview testado e aprovação explícita.
