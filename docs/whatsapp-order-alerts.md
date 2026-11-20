# Avisos de pedidos pelo WhatsApp

O código envia um aviso ao responsável pela loja depois que o provedor de pagamento confirma um pedido de produção. A fila privada é criada na mesma transação que registra o pagamento. Abrir o checkout, criar um link ou receber um retorno não verificado não gera uma confirmação.

## Ativação

1. Manter um banco de pedidos ativo e aplicar, em ordem, as migrações de `supabase/migrations`. A migração de alertas não importa nem envia pedidos antigos.
2. Configurar o registro de pedidos e os webhooks de pagamento conforme `payment-setup.md`. `LIORA_ORDER_TRACKING_ENABLED=true` habilita esse registro preservando o Checkout Pro existente. Os cupons e o Pix direto continuam com seus próprios controles.
3. Conectar um remetente na API oficial WhatsApp Business e aprovar um modelo da categoria Utility. `content/whatsapp-order-template.json` contém a proposta; o arquivo não indica aprovação pela Meta.
4. Confirmar o número do responsável que receberá os avisos. Ele deve ser diferente do remetente da API.
5. Cadastrar as variáveis privadas na hospedagem, somente no ambiente Production. Não colocar credenciais no repositório, no navegador ou em mensagens de atendimento.
6. Configurar o callback HTTPS `/api/whatsapp-webhook`, verificar o desafio e assinar os eventos `messages` na conta WhatsApp Business. Validar os callbacks antes de ativar novos envios.
7. Configurar um agendador autenticado para chamar `/api/order-alerts` com `Authorization: Bearer <CRON_SECRET>`. Uma chamada processa no máximo um aviso; a frequência deve ser compatível com o plano de hospedagem e o volume de pedidos. O repositório não cria automaticamente um cron nem contrata um plano.
8. Definir `WHATSAPP_ALERTS_START_AT` para o instante efetivo de ativação, com fuso horário explícito. Isso impede o disparo de uma fila histórica. Ativar `WHATSAPP_ENABLED=true` somente com canal, modelo, destinatário e agendamento conferidos.
9. Publicar novamente depois de alterar os controles do checkout e verificar um fluxo de pagamento autorizado. A aceitação da Meta deve ser seguida de um callback `delivered` ou `read` antes de considerar a entrega validada.

## Variáveis

| Variável | Finalidade |
|---|---|
| `LIORA_ORDER_TRACKING_ENABLED` | Registro durável independente dos cupons/Pix direto; desativado por padrão |
| `ORDERS_SUPABASE_URL`, `ORDERS_SUPABASE_SECRET_KEY` | Banco privado de pedidos; somente servidor |
| `WHATSAPP_ENABLED` | Libera novos envios; desativado por padrão |
| `WHATSAPP_API_VERSION` | Versão Graph API; padrão `v27.0` |
| `WHATSAPP_ACCESS_TOKEN` | Token de usuário do sistema com `whatsapp_business_messaging` |
| `WHATSAPP_PHONE_NUMBER_ID` | Identificador do remetente registrado na Meta |
| `WHATSAPP_SENDER_NUMBER` | Número do remetente com DDI |
| `WHATSAPP_ALERT_RECIPIENT` | Número confirmado para receber os avisos, com DDI |
| `WHATSAPP_ORDER_TEMPLATE` | Nome exato do modelo aprovado |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Idioma aprovado; padrão `pt_BR` |
| `WHATSAPP_APP_SECRET` | Segredo do app para autenticar os callbacks |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Segredo aleatório para o desafio de configuração |
| `WHATSAPP_ALERTS_START_AT` | Data/hora ISO 8601 com fuso da ativação |
| `CRON_SECRET` | Segredo aleatório de pelo menos 32 caracteres para o despachante |

## Entrega e recuperação

- Cada pedido possui um único evento `payment_confirmed`. Repetições dos webhooks não duplicam a fila.
- O aviso contém a referência do pedido, total pago e resumo dos produtos/quantidades. CPF, nome, e-mail, endereço e personalização do cliente não são enviados.
- O envio imediato acontece depois de confirmar o pagamento. Uma falha no WhatsApp não desfaz o pagamento nem impede a página de confirmação.
- Recusas transitórias explícitas da Meta entram em espera de 1, 5, 15 e 60 minutos, com até cinco tentativas. O agendador efetivamente dispara as novas tentativas quando o prazo passa.
- Timeout, perda da resposta e resposta ambígua ficam como `unknown`: a mensagem pode ter sido aceita. Conferir o callback/registro da Meta antes de autorizar uma nova tentativa evita avisos duplicados.
- Um worker interrompido é colocado em `unknown` após cinco minutos. O callback autenticado ainda pode resolver esse estado.
- `accepted` representa aceitação pela API. A confirmação `delivered`/`read` vem exclusivamente de callback com assinatura válida, remetente e destinatário esperados. Eventos fora de ordem não rebaixam uma entrega confirmada.
- Mensagens recusadas definitivamente, problemas de modelo e credenciais inválidas exigem correção operacional. O código não recria modelos, não troca destinatário e não reenvia mensagens ambíguas automaticamente.
- Para pausar novos envios, definir `WHATSAPP_ENABLED=false`. Os callbacks autenticados continuam sendo processados. O controle de mensagens não altera os preços dos produtos, descontos ou frete.

## Referências oficiais

- [Tokens da API WhatsApp Business](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/)
- [Modelos de mensagens](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
- [Webhooks de status](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status/)
- [Códigos de erro](https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes)

Os testes locais usam provedores simulados e banco Postgres em memória. Eles não enviam mensagens, não criam cobranças e não substituem a validação operacional do canal conectado.
