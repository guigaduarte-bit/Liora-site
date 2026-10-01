# Liora — implantação do e-mail comercial

Data da preparação: **2026-10-01**. Estado: **roteiro preparado; conta, caixa e envio/recebimento ainda não comprovados**. Não houve contratação, criação de conta, alteração de DNS nem envio de mensagem nesta revisão.

## Escolha e dependências

A responsável prefere a interface Gmail. A proposta é **Google Workspace Business Starter, um usuário**, com a caixa comercial sugerida `contato@lioraaromasdeluxo.com.br` e, opcionalmente, `privacidade@lioraaromasdeluxo.com.br` como alias para a mesma caixa. Esses endereços são propostas; não devem aparecer no site como canais ativos antes dos testes.

Para executar, são necessários acesso administrativo autorizado ao Google Workspace e à zona DNS na Vercel, contratação/aceite dos termos pela titular e uma conta de teste externa sob controle da responsável. Senha, recuperação, códigos de autenticação e dados de cobrança devem ser preenchidos diretamente no provedor, sem entrar no repositório ou na documentação.

## Evidência pública de DNS

Consulta feita em 01/10/2026 ao resolvedor público Google por DNS over HTTPS. Após falha na resolução DNS nativa do ambiente, as quatro consultas HTTPS concluíram:

| Nome consultado | Tipo | Resultado |
|---|---|---|
| `lioraaromasdeluxo.com.br` | NS | `ns1.vercel-dns.com.` e `ns2.vercel-dns.com.`; TTL 21600 |
| `lioraaromasdeluxo.com.br` | MX | `Status: 0` (`NOERROR`), sem `Answer`; SOA da zona na resposta |
| `lioraaromasdeluxo.com.br` | TXT | `Status: 0` (`NOERROR`), sem `Answer`; SOA da zona na resposta |
| `_dmarc.lioraaromasdeluxo.com.br` | TXT | `Status: 0` (`NOERROR`), sem `Answer`; SOA da zona na resposta |

Consultas reproduzíveis, somente leitura:

- <https://dns.google/resolve?name=lioraaromasdeluxo.com.br&type=NS>
- <https://dns.google/resolve?name=lioraaromasdeluxo.com.br&type=MX>
- <https://dns.google/resolve?name=lioraaromasdeluxo.com.br&type=TXT>
- <https://dns.google/resolve?name=_dmarc.lioraaromasdeluxo.com.br&type=TXT>

O DNS autoritativo é da **Vercel**. A ausência de MX não comprova se existe uma conta privada em preparação; comprova que não havia MX publicado nessa consulta. Não havia SPF/TXT na raiz nem DMARC no nome consultado. DKIM não foi avaliado: é preciso conhecer o seletor gerado pelo provedor. Reconsultar antes de qualquer mudança, pois o estado pode mudar.

## Implementação após criação da conta

1. **Criar a organização e um usuário.** No [Google Workspace](https://workspace.google.com/pricing?hl=pt-BR), conferir plano, moeda, preço, compromisso de cobrança e termos. Usar o domínio existente da Liora; não comprar outro domínio. Criar a caixa escolhida, proteger o acesso com autenticação em duas etapas e manter recuperação sob controle da responsável.
2. **Verificar o domínio.** No Admin Console, acessar Conta → Domínios → Gerenciar domínios e obter o TXT exclusivo de verificação. Na Vercel, abrir a equipe que administra o domínio → Domains → `lioraaromasdeluxo.com.br` → Advanced Settings/DNS Records. Adicionar somente o TXT fornecido pela conta no nome raiz e confirmar a verificação no Google. Não copiar um código de exemplo.
3. **Ativar recebimento Gmail.** Após a conta e a verificação, conferir no assistente do Google a configuração aplicável. A orientação oficial atual para nova configuração é MX na raiz; no formulário Vercel, deixar **Name vazio**, escolher Type **MX**, prioridade **1** e Value **`smtp.google.com`**. Usar o TTL aceito pelo painel. Revisar os MX existentes antes de substituir qualquer um e concluir “Ativar o Gmail” no Admin Console.
4. **Preservar o site.** Não alterar os nameservers, A/AAAA, CNAME, ALIAS ou demais registros que atendem à loja para instalar o e-mail. Não reinicializar a zona DNS. O registro do domínio no Registro.br pode permanecer onde está.
5. **Autenticar o envio.** No assistente oficial, configurar SPF de acordo com todos os serviços que realmente enviarão pelo domínio; não criar vários registros SPF concorrentes. Gerar a chave DKIM no Admin Console, publicar o TXT no seletor indicado e iniciar a autenticação no Google. Definir DMARC após conferir o alinhamento de SPF/DKIM; se houver endereço para relatórios, ele também deve existir e ser atendido. Não inventar seletor, chave, código de verificação ou endereço de relatório.
6. **Alias opcional de privacidade.** Em Diretório → Usuários, abrir o único usuário e adicionar o endereço alternativo `privacidade`. Ele recebe na mesma caixa e não é uma segunda conta de login. Configurar o remetente correspondente no Gmail caso a responsável queira responder usando o alias; conferir o resultado nos testes.

Alterações DNS podem depender de cache e propagação. A verificação efetiva no Google e nas consultas públicas é o critério de conclusão, sem promessa de ativação imediata.

## Teste manual antes de publicar o canal

O roteiro não dispara mensagens automaticamente. A responsável deve executar os testes com contas sob seu controle e texto fictício, sem dados de clientes:

- [ ] Receber mensagem externa na caixa comercial.
- [ ] Responder pelo Gmail e confirmar que o destinatário recebeu com o remetente comercial correto.
- [ ] Se criado, receber mensagem no alias de privacidade e testar a resposta pretendida.
- [ ] Conferir SPF, DKIM e DMARC nos cabeçalhos da mensagem recebida; registrar resultado sem publicar cabeçalhos completos ou endereços pessoais.
- [ ] Conferir que apenas a responsável possui o acesso administrativo interno pretendido e que a recuperação/autenticação em duas etapas funciona.
- [ ] Registrar data, responsável e resultados mínimos de recebimento/resposta/autenticação no documento de continuidade.

## Integração com o preview

Depois dos testes, atualizar rodapé e três políticas com os canais aprovados; incluir o provedor de e-mail no fluxo de tratamento de dados. Configurar o contato técnico em `SUPERFRETE_USER_AGENT` com a caixa funcional e gerar um novo Preview se a variável mudar. A string de fallback existente no código não constitui comprovação de atendimento.

Definir também rotina de acompanhamento, confirmação de demandas, exercício dos direitos de privacidade, devolução e estorno. Endereço físico comercial publicável continua sendo decisão separada: a implantação de e-mail não autoriza divulgar o endereço residencial, CPF ou contatos pessoais. Apresentar o Preview atualizado e os resultados antes de solicitar aprovação para produção.

## Referências oficiais consultadas em 01/10/2026

- [Vercel — gerenciar DNS e instalar e-mail](https://vercel.com/docs/domains/managing-dns-records).
- [Google — verificar domínio por TXT](https://knowledge.workspace.google.com/admin/domains/verify-your-domain-with-a-txt-record?hl=pt-br).
- [Google — registros MX](https://knowledge.workspace.google.com/admin/domains/set-up-mx-records-for-google-workspace?hl=pt-br).
- [Google — ativar Gmail e autenticar envio](https://knowledge.workspace.google.com/admin/gmail/activate-gmail-with-google-workspace-your-company).
- [Google — aliases de e-mail](https://knowledge.workspace.google.com/admin/users/add-or-delete-an-alternate-email-address-email-alias?hl=pt-br).
- [Decreto 7.962/2013 — informações do fornecedor e atendimento](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm).
