# Verificação do checkout — 22/10/2026

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
