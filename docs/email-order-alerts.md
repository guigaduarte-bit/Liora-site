# Avisos de vendas por e-mail

Implementação preparada em **26/11/2026**. O código e os testes não comprovam que um serviço de envio, remetente ou webhook já esteja ativo. A demonstração em `/preview-cupons/` é uma amostra visual e não envia mensagens.

O aviso informa que um pagamento real foi confirmado e contém somente a referência do pedido, o total pago e os nomes/quantidades dos produtos. Nome, CPF, e-mail, endereço, fragrância escolhida e personalização do cliente não entram na mensagem. O destinatário fica na configuração privada do servidor, sem aparecer no site ou no repositório.

Receber esses avisos em uma caixa pessoal não requer criar uma caixa comercial do Google Workspace. O envio pela Resend requer uma conta autorizada, um domínio/remetente verificado e as credenciais correspondentes. O roteiro de caixa comercial em `email-setup.md` trata de uma finalidade diferente.

## Fluxo

1. O servidor verifica o pagamento no provedor, incluindo referência, ambiente, método e valor.
2. O banco confirma o pagamento e, na mesma transação, cria um único evento privado em `liora_order_emails`. Uma mudança manual de status sem pagamento aprovado não cria uma venda notificável.
3. Depois do commit, o servidor tenta enviar o aviso. Os canais de e-mail e WhatsApp usam filas e identificadores independentes; a falha em um não impede o outro nem desfaz o pagamento.
4. A resposta da Resend registra **aceitação**, não entrega. Somente um callback autenticado pode registrar `delivered`, que significa aceitação pelo servidor de e-mail do destinatário, sem garantir leitura ou colocação na caixa de entrada.
5. O despachante autenticado `/api/order-alerts` processa no máximo um item de cada canal habilitado por chamada. Um agendador efetivamente configurado é necessário para executar as tentativas futuras.

O recurso é restrito a `VERCEL_ENV=production` e `PAYMENT_MODE=live`. Credenciais de e-mail não devem ser copiadas para Preview. Abrir o carrinho, aplicar um cupom, gerar um link de pagamento ou exibir a demonstração não envia um aviso de venda.

## Configurações privadas

| Variável | Uso |
|---|---|
| `EMAIL_ALERTS_ENABLED` | `true` libera novos envios; desativado por padrão. |
| `EMAIL_ALERT_RECIPIENT` | Um único e-mail confirmado pelo responsável, sem nome de exibição ou lista de endereços. |
| `EMAIL_ALERT_FROM` | E-mail do remetente em domínio verificado na Resend, sem nome de exibição. O código adiciona `Liora <...>`. |
| `EMAIL_ALERTS_START_AT` | Data/hora ISO 8601 com fuso explícito do início efetivo da operação. Exclui filas anteriores à ativação. |
| `RESEND_API_KEY` | Chave privada com permissão de envio para o domínio correto; somente servidor. |
| `RESEND_WEBHOOK_SECRET` | Segredo real do callback configurado na Resend, no formato `whsec_...`. Não inventar um valor. |
| `CRON_SECRET` | Segredo de pelo menos 32 caracteres para autenticar o agendador do despachante. |
| `ORDERS_SUPABASE_URL`, `ORDERS_SUPABASE_SECRET_KEY` | Banco privado de pedidos ativo. |
| `LIORA_ORDER_TRACKING_ENABLED` | Habilita o registro durável sem trocar o Checkout Pro por Pix direto; dispensável quando os cupons completos já exigem o mesmo registro. |
| `MP_WEBHOOK_SECRET` | Segredo real da aplicação Mercado Pago correta; pré-requisito do registro durável. |

Não ativar o registro durável ou os cupons completos com um segredo de pagamento fictício. A ativação do e-mail não configura a aplicação Mercado Pago, não confere o histórico de CPFs e não libera o PRIMEIRACOMPRA automaticamente.

## Ativação e conferência

1. Aplicar a migração `20261126223826_liora_order_emails.sql` após as migrações anteriores. Verificar as funções privadas, RLS e permissões. A migração não importa vendas antigas nem envia mensagens.
2. Concluir a validação do registro de pedidos e dos webhooks de pagamento descrita em `payment-setup.md`. Manter preços de catálogo, cálculo de descontos e fretes existentes.
3. Com acesso autorizado à conta Resend, verificar o domínio e o remetente escolhido. Publicar somente os registros DNS realmente fornecidos pelo provedor; preservar os registros usados pelo site e eventuais caixas de e-mail existentes. Conferir plano e limites sem contratar serviços adicionais automaticamente.
4. Salvar as variáveis privadas de produção. Cadastrar o callback HTTPS `/api/email-webhook` e copiar seu segredo real para `RESEND_WEBHOOK_SECRET`. Assinar `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.suppressed` e `email.complained`.
5. Configurar um agendador autenticado para `/api/order-alerts` com `Authorization: Bearer <CRON_SECRET>`, respeitando o plano da hospedagem. O código não cria um cron nem contrata um plano.
6. Conferir o destinatário e manter remetente/destinatário estáveis enquanto houver mensagens em andamento. Definir a data de ativação, habilitar `EMAIL_ALERTS_ENABLED=true` e publicar novamente.
7. Validar o envio ao destinatário autorizado e o callback correspondente, com mensagem de teste claramente identificada e sem cobrar clientes ou inventar uma venda. Um HTTP 200 do envio, isoladamente, não comprova entrega.

O endpoint de callback exige o corpo HTTP original, HMAC-SHA256 conforme o contrato Svix, timestamp da tentativa com tolerância de cinco minutos, remetente e destinatário exatos, identificador UUID do e-mail e tags do alerta. O horário do evento aceita precisão fracionária do provedor e é preservado no banco. Ele não lê o status de pagamento enviado pelo navegador nem altera pagamentos.

## Falhas, repetição e operação

- Cada venda tem uma linha única por evento na fila de e-mail. Mensagens WhatsApp e seus callbacks não podem atualizar essa fila.
- O cabeçalho `Idempotency-Key` identifica o mesmo alerta em todas as tentativas de envio. A Resend mantém essa deduplicação por 24 horas; por isso ela complementa a fila durável, sem substituir seus controles.
- Recusas HTTP 429 entram em espera de 1, 5, 15 e 60 minutos, até cinco tentativas. Uma resposta de credencial/domínio inválido exige correção operacional.
- Timeout, perda de resposta, HTTP 5xx ou requisição idempotente ainda em andamento ficam em `unknown`. Não há reenvio automático desses casos, inclusive após a janela de 24 horas do provedor. Conferir o registro da Resend e os callbacks antes de autorizar recuperação manual.
- Uma execução perdida após iniciar HTTP também fica em `unknown` depois de cinco minutos. Um callback assinado pode resolver esse estado e pode chegar antes da resposta HTTP do envio.
- Eventos antigos são ignorados. Em horários iguais, reclamação/falha definitiva prevalece sobre entrega e envio, independentemente da ordem de chegada. `sent` ou `delivery_delayed` não rebaixa uma entrega/falha já confirmada. Uma reclamação é terminal.
- Uma falha definitiva posterior à aceitação pelo servidor de destino continua registrada; `delivered_at` preserva o instante de aceitação anterior. Reembolsos e pagamentos em conferência não podem ser reclamados para um novo aviso atrasado.
- Para pausar novos envios, definir `EMAIL_ALERTS_ENABLED=false`. Manter a configuração do callback enquanto houver mensagens em andamento: ele continua aceitando recibos assinados mesmo com envios pausados.

O teste PostgreSQL local usa PGlite e aplica todas as migrações. Os testes de transporte usam respostas simuladas e o vetor público de interoperabilidade da Svix. Eles não enviam e-mail nem realizam cobranças.

## Fontes oficiais

- [Resend: enviar e-mail](https://resend.com/docs/api-reference/emails/send-email)
- [Resend: idempotência e janela de 24 horas](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend: erros da API](https://resend.com/docs/api-reference/errors)
- [Resend: verificação de webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Resend: evento de entrega e formato do remetente/tags](https://resend.com/docs/webhooks/emails/delivered)
- [Svix: assinatura manual e vetor público de interoperabilidade](https://docs.svix.com/receiving/verifying-payloads/how-manual)

Documentação e changelog Supabase consultados em 26/11/2026. As mudanças recentes de formato de configuração CLI e de escopo de autorização para merge de branches não alteram esta migração SQL aditiva no projeto existente.
