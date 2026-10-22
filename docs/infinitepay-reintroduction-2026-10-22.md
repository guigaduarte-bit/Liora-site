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

`npm test`: 240 testes passaram, incluindo criação InfinitePay, conferência de retorno, retomada, isolamento de provedor, idempotência opcional e reutilização do frete assinado. Build de 44 páginas e 32 produtos concluído.

Validação externa e publicação ainda pendentes nesta revisão. Nenhum pagamento foi liquidado por estes testes automatizados.
