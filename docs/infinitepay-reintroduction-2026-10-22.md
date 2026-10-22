# Reinclusão aditiva da InfinitePay — 22/10/2026

Solicitação: reincluir a InfinitePay, manter as correções em produção, testar e publicar a versão final.

Base pública preservada: `296365cca85cd6e78c3199585e124f2e8561e2cd`.

## Candidato

- Quarta opção de pagamento, ao lado de Pix, cartão e boleto pelo Mercado Pago.
- Criação server-to-server na InfinitePay, preços do catálogo e frete em centavos.
- Cotação assinada reutilizada, sem nova consulta à transportadora na confirmação.
- Retorno sem confirmação preserva carrinho e o mesmo link; não declara aprovação.
- Aprovação continua exigindo consulta ao provedor com prova assinada e valor conferido.
- URLs de pagamento validadas por provedor; preview continua impedindo cobranças InfinitePay.
- Uma implantação preparada em produção pode retornar ao seu próprio `VERCEL_URL` exato, sem aceitar domínios arbitrários. O domínio público configurado continua válido.
- Sem alteração de credenciais, catálogo, frete, `LIORA_CHECKOUT_V2` ou condições comerciais do Mercado Pago.

## Verificação local

`npm test`: 242 testes passaram, incluindo criação InfinitePay, conferência de retorno, retomada, isolamento de provedor, idempotência opcional e reutilização do frete assinado. Build de 44 páginas e 32 produtos concluído.

Validação externa concluída no build preparado abaixo. Nenhum pagamento foi liquidado; não foram fornecidos dados de cartão nem autorizado débito.


## Causa identificada no teste externo

No build preparado `dpl_4JhAc189U8PcA8fyiTKpK666CrvC` (sem o domínio público), a API real respondeu à criação do link em 22/10/2026 às 18:09:50 UTC. O campo `url` usou o host `checkout.infinitepay.io`. A validação anterior aceitava somente `checkout.infinitepay.com.br`, rejeitando a resposta com `PAYMENT_PROVIDER_INVALID_RESPONSE`.

Correção: permitir os dois hosts exatos, no servidor e no navegador, preservando rejeição de HTTP, credenciais na URL, portas e domínios semelhantes. O caminho ou identificador do link, os dados do cliente e as credenciais não são registrados no diagnóstico.


## Validação externa concluída

Commit funcional: `6410738011e120d1f5d70cd01471aa254488bbdb`.
Build preparado e validado: `dpl_34sSEUgT7JL6j3gXEWceY2kjDV55`, Production / Staged, sem atribuição do domínio público.

- Checkout da InfinitePay abriu na conta pública `$lioraaromasdeluxo`.
- Botanique 70 g: R$ 25,00; frete JADLOG: R$ 14,96; total: R$ 39,96, sem alteração entre loja e provedor.
- Contato sintético e endereço do teste aceitos; a etapa Pagamento exibiu Crédito, Pix e Apple Pay.
- Retorno à loja sem pagar exibiu “Confirmação em aberto” e “Retomar pagamento na InfinitePay”.
- Retomada abriu exatamente o mesmo link e total, sem criar outra cobrança nem declarar aprovação.
- A confirmação de pagamento liquidado continua coberta por testes automatizados da consulta autenticada ao provedor; não foi realizada transação financeira real.
- A produção anterior permaneceu no domínio público durante toda esta validação. A atribuição automática de domínios foi suspensa para preparar o build e foi restabelecida após a promoção manual.

Publicação concluída: `dpl_34sSEUgT7JL6j3gXEWceY2kjDV55` foi promovido diretamente, sem rebuild. O painel confirmou **Ready / Production / Current**, com `lioraaromasdeluxo.com.br` atribuído. O domínio público exibe as quatro opções: Pix, cartão, boleto e InfinitePay. A publicação automática foi restabelecida.

A branch `main` contém o mesmo código funcional e o registro da validação (`ae2e248f86a5c9307d903f94688e6ed82bb45781`); a diferença para o commit do build publicado é apenas documentação. A revisão automática inicialmente bloqueou a atualização de main enquanto faltava a validação externa, e a autorizou após os testes externos e o registro das evidências.

Evidência visual da interface pública: `liora-infinitepay-producao-final-20261022.jpg`, sem dados pessoais de comprador ou dados financeiros.
