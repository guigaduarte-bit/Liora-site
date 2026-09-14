# Recuperação das páginas legais — Liora

Data da revisão técnica: 14 de setembro de 2026.

## Origem e escopo

As três páginas legais e a folha de estilo foram recuperadas da branch `origin/preview/legal-pages`, commit `22596bd3f8b7e737735756b0396a7acf83d4f335` (`Protege dados pessoais no preview jurídico`). Essa branch ainda não integrava a `main` usada como base do trabalho de SEO.

Arquivos recuperados:

- `politica-de-privacidade.html`
- `termos-de-uso.html`
- `trocas-e-devolucoes.html`
- `assets/legal.css`
- `test/legal-pages.test.js`

Os textos de compra, personalização, troca e devolução foram preservados. Os links “Voltar à loja” agora apontam diretamente para `/`. A tipografia Cormorant Garamond/Jost e a paleta creme, dourado e marrom foram preservadas.

## Adequações à versão de SEO

- A política de privacidade informa que a inscrição na newsletter está indisponível e que não há coleta de e-mails para novidades. Foi removida a referência anterior a um formulário visível que simulava a inscrição.
- A política descreve a persistência do carrinho e favoritos em `sessionStorage`: identificadores dos produtos, quantidades e fragrâncias; nenhum nome, e-mail, CEP ou endereço do comprador é persistido ali.
- O identificador temporário de retorno do pagamento continua descrito. Os processadores e fornecedores existentes permanecem conforme o texto recuperado.
- A data da política de privacidade foi atualizada para refletir essas mudanças técnicas. As datas das políticas de compra e devolução foram mantidas, pois seu conteúdo não foi revisado juridicamente.

## Privacidade do preview

As páginas recuperadas não expõem nome pessoal da responsável, telefone pessoal, e-mail pessoal, identificação fiscal ou endereço físico. Os avisos de avaliação pública foram preservados.

A versão jurídica anterior também retirava esses dados de `index.html`, removia os links de WhatsApp, substituía o formulário de newsletter por uma mensagem de indisponibilidade e adicionava os links das três políticas ao rodapé. Essas alterações devem compor o layout compartilhado das páginas de SEO.

Não se deve reinserir contatos pessoais a partir do histórico Git. O contato empresarial adequado, o canal de privacidade e a identidade comercial a publicar precisam ser confirmados pela responsável em ambiente apropriado. O perfil social comercial já existente pode permanecer, mas sua titularidade e o endereço comercial definitivo continuam pendentes de validação.

## Pendências para produção

1. Confirmar quais dados empresariais e canais comerciais podem ser publicados. Não há dados novos aprovados neste trabalho.
2. Preencher as informações comerciais exigidas e os canais funcionais na versão final; as páginas de preview omitem esses dados deliberadamente.
3. Rever e retirar os avisos de preview apenas após essa confirmação e a aprovação de produção.
4. Confirmar os procedimentos operacionais de atendimento, logística reversa, retenção de registros e exercício dos direitos descritos nas políticas. A recuperação do texto não constitui evidência de que esses processos operacionais estejam implantados.
5. Executar o conjunto completo de testes após a integração do rodapé e da remoção da newsletter simulada ao layout compartilhado.

## Evidências de verificação

Comando de verificação isolada:

```sh
node --test --test-name-pattern='páginas legais existem|preview omite|conteúdo inclui|links internos' test/legal-pages.test.js
```

Resultado: quatro testes aprovados; dois testes de integração com a página inicial não selecionados neste comando. Foram verificados estrutura acessível, links internos, ausência de contatos pessoais nas páginas legais e preservação do conteúdo essencial recuperado.

O conjunto completo deve ainda conferir o rodapé e a remoção da newsletter simulada, junto ao build e ao preview do site.

## Confirmações operacionais posteriores — 14/09/2026

- Operação por pessoa física, com acesso administrativo interno exclusivo da responsável. O texto distingue esse acesso dos tratamentos necessários pelos fornecedores de pagamento, logística e infraestrutura.
- Produção: 10 dias úteis a partir da confirmação conjunta do pagamento e da personalização; se ocorrerem em momentos diferentes, vale a última confirmação. O prazo de transporte da cotação pelo CEP é acrescido à produção.
- Identificação pessoal recebida fora do repositório. Nenhum nome pessoal, CPF ou endereço foi incorporado ao código, a esta documentação ou ao preview nesta rodada.
- A responsável ainda não possui e-mail comercial. Os textos não afirmam a existência de um canal ativo; sua implantação e teste continuam pendentes.
- O conjunto completo foi executado nesta rodada: 43 testes aprovados, incluindo integração das páginas legais com o rodapé. Isso encerra a pendência de teste local acima; não comprova as permissões das contas externas nem o procedimento real de atendimento.
- Permanecem pendentes canal funcional, verificação das permissões, retenção/locais reais de guarda e fechamento da versão cadastral antes de produção aprovada.
