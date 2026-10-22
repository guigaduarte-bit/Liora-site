# Verificação do checkout — 22/10/2026

## Retomada da validação — 22/10/2026

O código `23191b965179795628f5c3e137c1da96d72c70c7` remove novas cobranças InfinitePay e permite retomar a mesma preferência Mercado Pago quando ainda não há pagamento. A suíte foi executada novamente: **226 testes aprovados, zero falhas**; as respostas dos provedores nos testes locais são simuladas.

O preview `liora-site-ha9dp2yls-circulo-de-cuidado.vercel.app`, da branch `fix/mercado-pago-only-2026-10-22`, não tinha configuração de pagamentos aplicável: a interface retornou “Pagamento temporariamente indisponível” e `/api/payment-status` respondeu `PAYMENT_MODE_NOT_CONFIGURED`. O painel Vercel mostrou as variáveis de homologação vinculadas somente a `preview/seo-2026-09-14`. O erro ocorre antes de chamar o Mercado Pago.

A branch de homologação foi avançada por fast-forward do commit `3dd0f89` para o mesmo código testado `23191b9`, sem copiar ou revelar segredos e sem alterar variáveis de produção. Foram concluídos os deployments Preview `dpl_6sNRaWeUSMiRYcoPTNjjMx2WJKZ1` e `dpl_G8XPoKLxcTqA9Q38qa74bitpyAcP`, ambos `READY`. O segundo também foi solicitado manualmente enquanto o painel avisava sobre possível atraso dos deploys automáticos do GitHub.

**Endereço para continuar a homologação:**

https://liora-site-git-preview-seo-2026-09-14-circulo-de-cuidado.vercel.app/produtos/botanique-70-ml-1dqj4/

Usar a origem estável acima desde o início até o retorno; o comprovante permanece na sessão dessa origem. Os endereços únicos de deployment não substituem automaticamente a origem configurada para o checkout.

| Verificação no navegador | Resultado nesta retomada |
|---|---|
| Configuração inicial do pagamento | `/api/payment-status` sem comprovante retornou `CHECKOUT_PROOF_REQUIRED`, superando a validação de configuração; isso não comprova liquidação |
| Checkout | Apenas Pix, cartão e boleto; InfinitePay ausente |
| Produto e entrega local | Botanique 70 g, R$ 25,00 + entrega Curitiba R$ 19,90 |
| Desconto Pix exibido | R$ 1,25; total R$ 43,65 |
| Cartão | Total R$ 44,90; preferência criada e redirecionamento ao endereço HTTPS retornado pelo Mercado Pago |
| Página externa do Mercado Pago | “Hubo un error accediendo a esta pagina...” antes de qualquer formulário; a única recarga apresentou o mesmo erro |
| Voltar pelo navegador | Consulta do pedido existente; “Pagamento ainda não localizado”; carrinho preservado com uma unidade |
| Retomada | O link “Retomar pagamento no Mercado Pago” aponta para a mesma preferência já criada; não foi acionado outro pagamento |
| Compra concluída e confirmação | Não realizadas; nenhum cartão foi informado e nenhum pagamento foi efetuado |

O erro genérico externo não identifica sua causa e não comprova indisponibilidade geral nem bloqueio por automação. Não foi possível homologar o pagamento completo. **Nenhuma publicação ou promoção para produção foi feita nesta retomada.** A liberação continua condicionada ao teste completo, conforme a instrução do responsável. A documentação oficial orienta utilizar comprador de teste e cartões de teste; Pix/boleto emitidos em ambiente de teste permanecem pendentes até os procedimentos admitidos pelo provedor.

As pendências de parcelamento sem juros, ativação do registro durável e Pix direto continuam descritas em `payment-activation.md`; não foram validadas ou ativadas nesta rodada. A retirada da InfinitePay elimina a necessidade de homologar novas cobranças desse provedor; a conferência de pagamentos antigos permanece disponível.

Referência: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/integration-test/test-purchases

## Registro anterior — antes da retirada da InfinitePay

O pedido foi manter o checkout anterior e publicar uma nova versão somente após aprovação do teste de venda.

O checkout anterior continua disponível no site. Uma nova publicação não foi aprovada, pois o teste completo de pagamento não pôde ser concluído.

| Verificação | Resultado |
|---|---|
| Testes locais da versão existente | 221 passaram; pagamentos simulados |
| Testes locais da versão candidata | 222 passaram; pagamentos simulados |
| Produto, carrinho, formulário e cotação de frete | Funcionaram |
| Criação de pagamento Pix | Link retornado; total de R$ 43,65 |
| Criação de pagamento por cartão | Link retornado; total de R$ 44,90 |
| Criação de pagamento por boleto | Link retornado; total de R$ 44,90 |
| Criação de pagamento InfinitePay | Falhou |
| Abertura do checkout Mercado Pago | O provedor exibiu erro neste navegador |
| Venda paga e retorno confirmado | Não realizados |

Os valores correspondem a um produto de R$ 25,00 e entrega de R$ 19,90; o Pix aplicou o desconto de 5% somente ao produto.

Foram usados dados sintéticos. Nenhuma cobrança, liquidação ou estorno foi realizado. A criação de um link não comprova aprovação de pagamento.

Há um candidato de compatibilidade para a resposta da InfinitePay, com testes locais, mas sem confirmação externa de que resolve a falha observada. Ele não foi promovido ao site público.

Para aprovar uma nova publicação, é necessário validar a resposta real da InfinitePay e concluir o pagamento de teste e o retorno pelo Mercado Pago. O parcelamento sem juros e o registro automático de pedidos não foram validados nesta rodada.
