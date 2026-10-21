# Pagamentos e pedidos — implementação de 21/10/2026

## Estado real

Código implementado e verificado com 221 testes locais. O teste de banco usa PostgreSQL em PGlite, aplica todas as migrações e executa consultas com os papéis `anon`, `authenticated` e `service_role`, incluindo os privilégios padrão observados no Supabase. As respostas dos processadores são simuladas. Não houve cobrança real, homologação bancária nem alteração de credenciais.

Após autorização do responsável, foi criado o projeto Supabase exclusivo `liora-orders`, referência `ncckaasybejljuvophbz`, na organização Circulo de Cuidado Supabase, região São Paulo (`sa-east-1`). O serviço informou custo mensal estimado de zero na criação. A estrutura e a restrição de privilégios foram aplicadas e verificadas no banco remoto. URL da API: `https://ncckaasybejljuvophbz.supabase.co`. Nenhuma chave foi incluída no repositório.

O script `test/remote-orders-smoke.sql` passou no banco remoto: registro de aprovação, repetição sem duplicação, evento atrasado, conferência por saldo, estorno, exclusão dos testes da consulta de pedidos reais e negação de acesso a visitantes/clientes. Todos os dados são fictícios e a transação termina com `ROLLBACK`; a conferência posterior encontrou zero pedidos e zero pagamentos. Esse teste valida o banco, não a liquidação nem a entrega de notificações pelos provedores.

O navegador autorizado abriu o login da Vercel. A solicitação segura de autenticação não retornou confirmação e as tentativas documentadas de verificar a sessão expiraram por falta de resposta do navegador. O estado do login é desconhecido. Nenhuma variável foi alterada por esse caminho; o acesso à configuração da Vercel e à conta Mercado Pago ainda precisa ser restabelecido.

O novo fluxo fica **desativado por padrão**. A implementação mantém o checkout existente até haver banco, credenciais, configuração de notificações e homologação externa. Não marcar as três pendências como concluídas só porque o código foi publicado.

## Correções que funcionam sem novos serviços

- O limite do cartão continua em três parcelas, mas a loja informa “condições no pagamento”. `installments: 3` limita parcelas; não configura quem paga os juros.
- `content/payment-policy.json` contém `interestFreeInstallments: 0`. Só alterar para `3` depois de conferir a condição na conta da loja e no checkout; preencher a data e uma referência de evidência sem dados sensíveis. O build recusa juros zero sem esses campos. Isso não configura o Mercado Pago: a ativação comercial acontece na conta do vendedor e envolve tarifas.
- Quando um pagamento antigo do fluxo Pix tiver sido aprovado com `account_money`, a resposta passa a `review_required`. O cliente vê que o pagamento foi recebido e que não deve pagar novamente. Não há aprovação automática para produção, complemento de cobrança nem estorno automático.

## O que está pronto para ativação

- Pix direto: `POST /v1/payments`, `payment_method_id: pix`, frete incluído no total, desconto de 5% apenas nos produtos, CPF validado, QR Code/copia e cola e consulta na página. Não cria preferência Checkout Pro para Pix, portanto não oferece o saldo da carteira nesse fluxo.
- Pedido criado antes de chamar o processador. Snapshot inclui produtos, fragrâncias, quantidades, preço, desconto, frete, nome, e-mail e entrega. CPF é transmitido ao Mercado Pago e não é salvo no pedido; o fingerprint contém somente um hash dos dados da tentativa.
- Repetir a tentativa com a mesma chave retorna o pedido existente. O Pix usa também a idempotência do Mercado Pago, incluindo recuperação após falha ao salvar a resposta. Cartão/InfinitePay sem resposta confirmada ficam retidos para conferência, sem criar outro link automaticamente.
- `/api/payment-webhook?provider=mercadopago`: verifica HMAC de `x-signature`, consulta o pagamento no Mercado Pago e confere referência, total, moeda, ambiente e método. Assinaturas repetidas são seguras porque a reconciliação é idempotente; não se impõe uma janela de idade que possa rejeitar notificações legítimas reenviadas.
- `/api/payment-webhook?provider=infinitepay`: a documentação não fornece assinatura. O servidor usa a referência recebida somente para consultar `payment_check` com o handle da loja e validar o resultado. Nenhum valor/status do corpo recebido aprova o pedido.
- Atualizações do pedido e pagamento ocorrem na mesma transação PostgreSQL. Pendência atrasada não regride aprovação; estornos são registrados; duas aprovações ou condições divergentes exigem conferência. O retorno no navegador também reconcilia o registro.
- Tabelas com RLS e sem concessões a visitantes/clientes; função `SECURITY INVOKER`, executável somente por `service_role`. Chave do banco somente no servidor. Não há API pública para listar clientes ou pedidos.
- A consulta administrativa `liora_paid_orders` mostra pedidos reais aprovados, sem testes ou pedidos em conferência. A personalização continua sendo confirmada separadamente antes de iniciar os dez dias úteis de produção. O registro não envia e-mail, não emite nota fiscal nem altera estoque automaticamente.

## Serviços e configurações necessários

1. Restaurar acesso ao projeto Vercel `liora-site`, time `circulo-de-cuidado`. O conector disponível retornou 404 para o projeto/variáveis e 403 ao tentar acessar o preview protegido. A integração GitHub → Vercel continua funcionando, mas não permite administrar configurações por este acesso.
2. **Concluído:** criar o banco exclusivo da Liora, com organização autorizada e custo informado pelo serviço. Os projetos de outros aplicativos não foram modificados. Ainda falta preparar o ambiente de homologação e suas credenciais; preferir banco separado de produção.
3. **Concluído no projeto `liora-orders`:** aplicar `supabase/migrations/20261021152148_liora_orders.sql` e `supabase/migrations/20261021172806_liora_order_privileges.sql`, verificar tabelas, função, RLS e negação de acesso para `anon`/`authenticated`. As migrações foram geradas pelo CLI Supabase 2.121.0; os nomes locais foram alinhados às versões efetivamente registradas pelo serviço remoto. A segunda migração remove os privilégios padrão de exclusão/limpeza do servidor e deixa a consulta administrativa somente para leitura.
4. Instalar as configurações abaixo pelo gerenciador de segredos da Vercel. Não enviar valores ao chat nem armazená-los no repositório.

| Configuração | Uso |
|---|---|
| `ORDERS_SUPABASE_URL` | URL HTTPS do projeto Liora (`https://<ref>.supabase.co`). |
| `ORDERS_SUPABASE_SECRET_KEY` | Chave secreta backend do banco Liora; `sb_secret_...` preferida. Chave `service_role` legada também é suportada. |
| `MP_WEBHOOK_SECRET` | Assinatura de notificações da aplicação correta no Mercado Pago; pelo menos 32 caracteres. |
| `LIORA_CHECKOUT_V2` | `true` ativa conjuntamente Pix direto e registro obrigatório. Deve estar disponível no build e nas funções. |
| `PAYMENT_MODE`, `MP_ACCESS_TOKEN`, `CHECKOUT_SIGNING_SECRET`, `SITE_URL` | Manter ambiente e origem consistentes. Homologação usa `test`; produção usa `live`. Segredos independentes por ambiente. |
| `INFINITEPAY_HANDLE` | Somente produção; não há sandbox documentado. |

O novo fluxo envia automaticamente as URLs de webhook da mesma origem da loja, em lugar das variáveis antigas `MP_WEBHOOK_URL`/`INFINITEPAY_WEBHOOK_URL`. No painel Mercado Pago, configurar notificações do tópico `payment` e a chave correspondente. A rota precisa ser acessível ao processador: um preview protegido por login não serve como destino até ser configurado pelo mecanismo oficial apropriado, sem desativar proteção de todo o projeto.

Os advisors não retornaram avisos de segurança de nível WARN/ERROR. Há dois [avisos informativos de RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): isso é intencional para tabelas privadas usadas somente pelo servidor, com privilégios de visitantes/clientes revogados. A análise de desempenho informou [índices ainda não utilizados](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), esperado no banco recém-criado e vazio; os índices dão suporte às consultas e não foram removidos.

## Homologação antes da ativação em produção

1. Configurar o ambiente de teste, aplicar a migração no banco de homologação e publicar o build com a flag ativa. Confirmar CPF, QR Code, cópia, prazo e retomada em desktop/celular.
2. Com contas e credenciais oficiais de teste, validar emissão do Pix e casos permitidos pelo sandbox; não chamar uma pendência de liquidação. Cartão: aprovado, pendente e recusado. Boleto: emissão/pendência e posterior notificação quando suportada.
3. Confirmar que o pedido existe **antes** da criação da cobrança; fechar a página e verificar que o webhook atualiza o mesmo registro; reenviar a notificação sem duplicar. Comparar pedido, transação, valor e frete no painel do provedor.
4. Conferir no painel do vendedor se três parcelas sem juros estão ativas e quais tarifas a loja assume. Conferir o total e as parcelas exibidas pelo processador. Só então registrar a evidência e liberar o anúncio em `payment-policy.json`. Um resultado com juros ou parcelas acima do prometido fica em conferência no registro.
5. InfinitePay requer conferência no ambiente real autorizado; nenhuma transação de valor real foi realizada como teste nesta implementação.
6. Configurar produção, verificar as URLs e confirmar que todas as migrações estão aplicadas; ativar a flag em um novo deploy. Fazer a conferência inicial de pedidos/notificações no banco e no provedor.

## Operação e recuperação

- Ver todos os pedidos na tabela privada `liora_orders` pelo painel autorizado do Supabase; pagamentos em `liora_order_payments`. Pedidos antigos não são importados porque não existe snapshot confiável dos dados da sessão.
- Em `review_required`, conferir a transação no painel antes de produzir, cobrar ou devolver. A conferência não é um pedido para o cliente repetir o pagamento.
- Em `checkout_state=creating` para cartão/InfinitePay após erro de rede, investigar a referência no provedor. Não apagar o registro/chave para forçar uma nova cobrança sem essa conferência.
- Se o banco estiver indisponível com a flag ativa, a criação falha antes de chamar o processador. Falha ao persistir notificação não recebe confirmação de sucesso; o provedor pode reenviar. A InfinitePay recebe HTTP 400 conforme o contrato de repetição documentado.
- Para suspender novas compras do fluxo novo, planejar o rollback mantendo banco, segredos e recebimento dos webhooks dos pedidos já iniciados. Não desligar o registro no meio de pagamentos pendentes sem reconciliação. Comprovantes emitidos pelo novo fluxo continuam exigindo o registro mesmo que a flag de criação seja desligada.

## Referências verificadas em 21/10/2026

- [Pix via Payments API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix)
- [Restrições dos métodos no Checkout Pro](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/payment-methods)
- [Parcelamento sem juros na conta do vendedor](https://www.mercadopago.com.br/developers/pt/docs/linx/configure-installments)
- [Assinatura e consulta de notificações Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-content/notifications/webhooks)
- [Integração e webhook InfinitePay](https://www.infinitepay.io/checkout-documentacao)
- [Chaves Supabase e uso exclusivo no servidor](https://supabase.com/docs/guides/getting-started/api-keys)
- [Segurança dos dados Supabase](https://supabase.com/docs/guides/database/secure-data)

O changelog Supabase foi consultado. A retirada de cifras CBC antigas de TLS 1.2 não exige alteração para este backend Node com TLS moderno; nenhuma extensão ou objeto interno do Supabase é modificado pela migração.
