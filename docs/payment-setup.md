# Liora — configuração e homologação dos pagamentos

Atualização: 01/10/2026. Correções implementadas para Preview; pagamentos externos ainda não homologados. Não promover para produção com base apenas na suíte simulada.

## Configuração aplicada e pendente

Em Vercel → projeto `liora-site` → Settings → Environment Variables, usar escopo **Preview + branch `preview/seo-2026-09-14`**. As entradas de Production não foram copiadas nem modificadas.

| Variável | Estado em 01/10 | Regra |
|---|---|---|
| `PAYMENT_MODE` | Config criada: `test` | Obrigatória. Preview/development só aceitam test; Production só live. |
| `SITE_URL` | Config criada com a URL estável da branch Preview | Deve coincidir com a origem Vercel da branch/deployment. Usar a mesma origem no início e no retorno, pois o comprovante fica na sessão desse domínio. |
| `MP_ACCESS_TOKEN` | Não instalado em Preview; entrada existente só em Production | Obter na seção de testes da aplicação correta, sem publicar/copiar em chat ou Git. Prefixo `APP_USR` não prova ambiente real; conta de teste também pode usá-lo. |
| `CHECKOUT_SIGNING_SECRET` | Não instalado | Segredo próprio do servidor com pelo menos 32 bytes, independente por ambiente. Nunca `NEXT_PUBLIC_*`, nunca reutilizar a credencial do processador. Inserir como Secret pelo fluxo seguro de configuração. |
| `INFINITEPAY_HANDLE` | Entrada existente só em Production | InfinitePay fica recusado no Preview. Não há Sandbox documentado nas fontes consultadas; não copiar o handle real e chamar a cobrança de teste. |
| URLs de webhook | Não configuradas nesta rodada | Não apontar para endpoint inexistente. Persistência e processamento assíncrono ainda precisam ser implementados. |

Depois de instalar as configurações pendentes, criar novo deployment Preview. Alterar variável não atualiza o deployment anterior. Credenciais precisam pertencer à loja e ao ambiente corretos; nenhuma troca ou rotação foi realizada nesta rodada.

## O que o código passou a verificar

- Falhas de configuração retornam 503 e um código identificável; não aparecem como erro500 genérico de configuração ausente.
- URLs de checkout precisam usar HTTPS e um hostname permitido. Preview não volta para domínio de produção por fallback.
- O servidor assina o identificador do pedido, total em centavos, BRL, método, processador, ambiente, emissão e validade máxima de sete dias. Não inclui nome, e-mail, endereço, CEP ou fragrância.
- O navegador guarda o comprovante em `sessionStorage` e o envia em `X-Checkout-Proof`, nunca na URL. Sem comprovante válido, não é exibida aprovação baseada nos parâmetros do retorno.
- Mercado Pago: consulta server-to-server, confere ID, referência do pedido, total, moeda, `live_mode`, status e método efetivo.
- InfinitePay: exige booleanos estritos de sucesso/pagamento, confere valor em centavos e esquema de confirmação. Retornos como `paid: "false"` não aprovam compra.
- Requisições têm timeout; logs registram código/status sem respostas brutas, dados do comprador ou segredo.
- O texto de pendência não promete e-mail automático inexistente. Pagamento de teste é identificado como teste e não inicia produção.

O comprovante é uma proteção da confirmação na sessão. **Não é um banco de pedidos, recibo fiscal ou substituto de webhook.** Fechar a sessão pode impedir essa confirmação pela loja; o cliente deve conferir o provedor antes de pagar novamente. Não liberar produção sem solucionar o registro durável e a confirmação assíncrona abaixo.

## Homologação externa ainda necessária

1. Instalar credencial Mercado Pago proveniente de Testes e segredo de assinatura pelo fluxo seguro. Conferir conta, ambiente e URL de retorno.
2. Usar comprador/vendedor e dados de teste do Mercado Pago. Testar cartão aprovado, pendente e rejeitado; conferir total e referência no painel. Não inserir dados pessoais reais nem realizar cobrança real como se fosse Sandbox.
3. Validar Pix e boleto conforme disponibilidade oficial do ambiente de teste. Boleto emitido é pendência, não aprovação. O frete externo estimado permanece bloqueado; pode-se usar a entrega local para validar o fluxo técnico.
4. Confirmar o formato real e as condições da InfinitePay. Qualquer transação real requer escopo e valor autorizados separadamente; nenhum link, pedido, pagamento ou estorno real foi criado nesta rodada.
5. Resolver a regra Pix: Checkout Pro permite dinheiro em conta, que não pode ser excluído segundo a documentação. A confirmação agora rejeita divergência de método, mas isso não impede que o provedor tenha recebido dinheiro. Antes de produção, escolher um fluxo que garanta Pix para o desconto ou definir conciliação/estorno aprovado. Não alterar silenciosamente os 5% definidos pela loja.

## Registro de pedidos e confirmação assíncrona

Ainda não há armazenamento durável nem endpoint de webhook neste repositório. A próxima implementação precisa de um serviço de dados autorizado e escopado à Liora, com ambiente de teste separado. Não usar arquivo local de função serverless como banco nem gravar dados pessoais no Git.

Critérios do bloco:

- Criar pedido no servidor com snapshot de preços, personalização, frete e valores antes do pagamento; guardar somente os dados operacionais necessários e proteger o acesso administrativo.
- Vincular transação ao pedido, com idempotência para criação, notificações duplicadas e reconciliação. Não confiar no corpo de webhook como prova de pagamento.
- Mercado Pago: conferir assinatura, consultar pagamento no servidor e validar referência/valor/moeda/ambiente/método contra o pedido.
- InfinitePay: seguir contrato efetivo de notificações e consultar o pagamento no provedor, vinculando a pedido existente.
- Persistir aprovado/pendente/rejeitado/cancelado/estornado, com trilha mínima sem cartão/token e sem logs de dados pessoais.
- Confirmar personalização separadamente. Iniciar os dez dias úteis de produção somente após pagamento e personalização confirmados.
- Definir retenção, recuperação, acesso exclusivo interno da responsável e rotina de estorno/devolução. E-mail transacional depende de canal/remetente real configurado, não apenas do comprovante na sessão.

## Referências oficiais

- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/test-accounts
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/integration-test/test-purchases
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications
- https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/additional-settings/payment-methods
- https://www.infinitepay.io/checkout-documentacao
- https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay
