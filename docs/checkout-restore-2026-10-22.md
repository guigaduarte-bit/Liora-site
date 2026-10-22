# Verificação do checkout — 22/10/2026

## Publicação e verificação em produção — 22/10/2026, 17h31 UTC

O commit `296365cca85cd6e78c3199585e124f2e8561e2cd` foi publicado após corrigir a falha de frete reproduzida pelo responsável e validar a criação real do checkout. A branch `main` avançou por fast-forward a partir de `8a1b7ce73739e9dd8bb5e65628cc43cf0eaebfa8`. O deployment `dpl_2W1vD4Li9JnqNhnZcBGnoGoQhsmJ` está **Ready / Production / Current**, com o domínio `lioraaromasdeluxo.com.br` atribuído. As seções abaixo preservam o histórico anterior à publicação.

| Verificação | Evidência |
|---|---|
| Suíte local | 234 testes aprovados, zero falhas; build de 44 páginas e 32 produtos |
| Criação no preview corrigido | 17:22:43 UTC: HTTP 200, execução de 370 ms; somente chamada ao Mercado Pago, sem segunda consulta à SuperFrete |
| Frete em produção | 17:27:10 UTC: HTTP 200; opções reais Jadlog, Loggi, PAC e Sedex |
| Criação em produção | 17:28:08 UTC: `POST /api/create-preference` HTTP 200, execução de 389 ms e resposta total de 415 ms; somente `POST api.mercadopago.com/checkout/preferences` nas APIs externas |
| Valores de produção | Botanique 70 g R$ 25,00 + Jadlog R$ 14,96 = R$ 39,96, cartão selecionado |
| Meios de pagamento | Pix, cartão e boleto; InfinitePay ausente |
| Retorno sem pagar | Pedido e carrinho preservados; “Pagamento ainda não localizado” e link para retomar a mesma preferência |
| Compra paga | **Não validada**; a página externa ainda exibiu erro genérico no navegador remoto, antes do formulário |

Foram utilizados dados sintéticos. Nenhum cartão foi informado, nenhum pagamento foi efetuado e nenhuma liquidação ou estorno foi realizado. A criação da preferência e o redirecionamento foram confirmados; não comprovam aprovação de pagamento. A publicação corrige o erro da Liora demonstrado pela captura enviada, mas não resolve nem identifica a causa do erro de acesso à página externa neste navegador.

Não foram alteradas credenciais ou variáveis de ambiente. Registro durável, Pix direto e anúncio de parcelamento sem juros continuam desativados. Os registros do teste não contêm dados reais de comprador, segredos ou URLs de preferência.

## Falha identificada no teste do responsável e correção — 22/10/2026

A captura enviada pelo responsável mostra “Não foi possível processar o pagamento” ainda na Liora. Os registros das tentativas de 14:08:40 e 14:09:06 (UTC−3) confirmam `POST /api/create-preference` com HTTP 500 / `PAYMENT_INTERNAL_ERROR`, duração de aproximadamente 8 segundos e chamada à SuperFrete Sandbox. A tentativa de 14:09:06 lista somente `sandbox.superfrete.com/api/v0/calculator`, sem chamada ao Mercado Pago. O prazo por requisição da transportadora no código é de 8 segundos. A cotação inicial de frete havia respondido HTTP 200 às 14:08:17.

O checkout consultava a transportadora novamente ao confirmar o pedido. O erro tipado de frete dessa segunda consulta era tratado como erro interno de pagamento. Isso é uma falha distinta da página externa do Mercado Pago observada no navegador remoto.

Correção implementada:

- A API de frete assina cada cotação utilizável, com validade de 15 minutos, vinculada ao CEP, produtos, quantidades, preços do catálogo e ambiente. Valores enviados sem assinatura nunca substituem o frete calculado pelo servidor.
- O checkout verifica o comprovante e reutiliza o frete válido sem nova chamada à SuperFrete. Cotações simuladas ou de embalagem pendente não recebem assinatura.
- Comprovantes adulterados, vencidos ou incompatíveis não criam pagamento. A interface recalcula, preserva o endereço informado e exige nova confirmação do total.
- Páginas abertas antes da atualização mantêm a conferência pelo servidor, mas uma falha da transportadora retorna o código e mensagem de frete, sem ser atribuída ao Mercado Pago.
- A renovação da cotação não altera a chave de idempotência da mesma compra no fluxo durável, que continua desativado.

Validação local: **234 testes aprovados, zero falhas**. Inclui o cenário da captura (R$ 25,00 + R$ 28,13 = R$ 53,13), com a transportadora falhando após a primeira cotação e a preferência sendo criada sem a segunda chamada. Inclui adulteração de valor, mudança de CEP/carrinho/preço do catálogo, ambiente, expiração e preservação da idempotência. As respostas externas nesses testes são simuladas; isso não comprova pagamento liquidado.

## Diagnóstico adicional — 22/10/2026, 17h UTC

A solicitação atual autoriza publicar após corrigir e testar. Nesta nova execução, `npm test` terminou com **226 aprovados, zero falhas**. A suíte utiliza respostas simuladas dos provedores.

O link de retomada da preferência existente foi acionado uma vez. O Mercado Pago voltou a exibir “Hubo un error accediendo a esta pagina...” antes de apresentar qualquer formulário. A abertura independente de `https://www.mercadopago.com.br/`, sem parâmetros de checkout, apresentou a mesma mensagem. Assim, a falha de acesso também ocorre fora do fluxo da Liora neste navegador; sua causa técnica exata não é informada pela página. Não há evidência suficiente para afirmar bloqueio por automação, indisponibilidade geral ou credencial inválida.

O painel de registros da Vercel confirmou:

- `POST /api/create-preference` no preview configurado, em 16:51:32 UTC: **HTTP 200**.
- `GET /api/payment-status` no retorno em 16:52:20 UTC: **HTTP 404**, com código de aplicação `PAYMENT_NOT_FOUND`, esperado para a tentativa ainda não paga; não se trata de rota ausente.
- O preview original sem escopo de configuração respondeu **HTTP 503 / PAYMENT_MODE_NOT_CONFIGURED**; o preview estável configurado superou essa falha.

A captura da mensagem externa foi registrada, sem dados de comprador ou pagamento. Não houve nova cobrança, preenchimento de cartão, mudança de credencial, alteração adicional de código ou publicação em produção nesta execução. A validação de ponta a ponta continua pendente de acesso funcional ao checkout do Mercado Pago com o comprador e cartão oficiais de teste. O sucesso HTTP da criação de preferência não comprova pagamento aprovado.

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
