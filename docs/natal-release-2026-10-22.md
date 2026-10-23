# Natal Liora — validação para publicação

Solicitação: testar a compra de um kit ou produto da aba Natal e publicar após a validação.

## Versão conferida

- Commit de homologação: `fadde3527e6d97624ee91422e0afe8bbac1b40a4`.
- Árvore de arquivos: `ce51db4131030c408fcd3fa468a7147aec5adcb4`, idêntica à versão testada localmente.
- Integração Vercel no GitHub: `success` para a homologação `GCRjjifHwCcaLAaAivYYQm1aou7D`.
- As correções existentes de Mercado Pago, InfinitePay, cotação assinada e retomada de pedidos foram preservadas.

## Escopo

16 velas da coleção Natal com preços, medidas, fotos, compra por encomenda e envio em até 10 dias úteis; 13 apresentações em Kits e presentes Natal Liora com descrições e valores aprovados; azevinho e avisos de personalização de cores com consulta contextual pelo WhatsApp. Os kits continuam como apresentações com consulta, sem inclusão no catálogo transacional; o teste de compra foi realizado com um produto da aba Natal, conforme a alternativa autorizada.

## Testes

`npm test`: **261 aprovados, zero falhas**. Inclui compra por encomenda dos 16 modelos, validação de preços no servidor, frete, proteção de cotações, tratamento de retorno sem pagamento e regras dos processadores. Os testes automatizados de provedores usam respostas simuladas.

O teste no navegador encontrou uma diferença de arredondamento no anúncio Pix: o Cavalinho mostrava R$ 9,41 na página e R$ 9,40 no checkout. A página agora usa a mesma função de cálculo do servidor. Um teste de regressão confere R$ 9,40 para o Cavalinho e R$ 18,90 para o Boneco de biscoito.

## Homologação online

Foi usada a origem estável de homologação já configurada, com dados sintéticos de comprador e sem cartão ou pagamento real.

| Verificação | Resultado |
| --- | --- |
| Cavalinho de balanço | R$ 9,90; 10,6 × 8,6 cm; disponível por encomenda |
| Inclusão no carrinho | 1 unidade, subtotal R$ 9,90 |
| Prazo | Envio em até 10 dias úteis, acrescido do transporte |
| Frete para Curitiba | Modalidade local R$ 19,90; opções Correios também retornadas |
| Pix | Desconto R$ 0,50; total com entrega local R$ 29,30 |
| Cartão | Total com entrega local R$ 29,80 |
| Criação do checkout | A loja aceitou o produto e redirecionou à URL HTTPS retornada pelo Mercado Pago |
| Página externa | Erro genérico “Hubo un error accediendo a esta pagina...” no navegador remoto, antes do formulário; mesma limitação já registrada nos testes anteriores |
| Retorno à loja | “Pagamento ainda não localizado”; nenhuma aprovação indevida |
| Retomada | O link é exatamente o checkout original; nenhum segundo pedido foi criado |

A validação confirma o fluxo da loja até a geração e retomada do checkout. **Não comprova liquidação de pagamento nesta rodada.** A integração de pagamentos já havia sido validada pelo responsável e permanece preservada. Nenhuma credencial ou variável de ambiente foi modificada.

## Publicação autorizada

A solicitação autoriza publicar após a validação. A liberação usa a integração GitHub–Vercel existente, com atualização sem força e conferência do estado de `main`. O acesso direto do conector Vercel ao projeto retornou 404/403; o CLI não tinha credenciais. Não foram alterados controles de acesso.
