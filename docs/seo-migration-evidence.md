# Evidências públicas da migração Liora

Consulta em **14/09/2026**, referente à etapa SEO-06. Este registro complementa `seo-migration-map.json`; não configura redirecionamentos.

## Evidências e inferências

| Origem encontrada no índice público | Evidência | Consequência no mapa |
|---|---|---|
| [Essenciais — /notrancado/](https://lioraaromasdeluxo.lojavirtualnuvem.com.br/notrancado/) | O resultado identifica Essenciais e cita Camafeu Fada e Pequeno Amor. Os IDs atuais `camafeufada` e `ursinho` pertencem à coleção Essenciais em `content/products.json`. | Destino proposto `/essenciais/`, inferido pela correspondência de título e produtos; revisão e ativação externa continuam pendentes. |
| [Páscoa Encantada](https://lioraaromasdeluxo.lojavirtualnuvem.com.br/pascoa-encantada/) | O resultado identifica uma coleção sazonal e cita Casa do Coelho. Esses nomes não aparecem no catálogo atual. | Destino permanece indefinido; confirmar continuidade ou descontinuação comercial e eventual equivalente. |
| [Lady Veil](https://lioraaromasdeluxo.lojavirtualnuvem.com.br/produtos/vela-escultural-lady-veil-phie3/) | URL e título de produto correspondente aparecem no índice. | Evidência adicional para o caminho já preservado no preview. |
| [Anjo em vitral](https://lioraaromasdeluxo.lojavirtualnuvem.com.br/produtos/vela-decorativa-anjo-em-vitral-1sbe9/) | URL e título de produto correspondente aparecem no índice. | Evidência adicional para o caminho já preservado no preview. |
| [Botânica](https://lioraaromasdeluxo.lojavirtualnuvem.com.br/flora-linea/botanica/) | Categoria encontrada no índice, com caminho próprio dentro de Flora Linea. | Nova entrada no inventário; não assumir equivalência integral com `/flora-linea/` sem conferir os produtos. |

## Limites da verificação

- As tentativas de abertura direta de `/sitemap.xml`, `/notrancado/` e `/pascoa-encantada/` falharam na ferramenta de consulta com `not safe to open (non-retryable error)`. Não houve resposta HTTP da origem verificável: **não classificar como 404, timeout da origem ou loja desativada**.
- A segunda via, busca no índice público, retornou as evidências acima. Resultados indexados podem refletir conteúdo anterior e não confirmam HTTP, canonical, estoque, preços ou disponibilidade atual.
- Consultas utilizadas: `site:lioraaromasdeluxo.lojavirtualnuvem.com.br`, domínio completo com `notrancado` e domínio completo com `pascoa-encantada`.
- O sitemap completo não foi recuperado. O mapa agora contém 30 entradas: 27 caminhos de produtos e três categorias antigas. Duas das 27 URLs de produtos têm evidência adicional de presença no índice; as demais continuam baseadas nos IDs importados.
- Nenhum redirecionamento foi ativado. Os redirecionamentos no domínio antigo dependem da configuração na Nuvemshop; `vercel.json` não controla esse domínio.

Próxima ação: validar a correspondência proposta de Essenciais e confirmar o destino comercial de Páscoa Encantada e Botânica antes de preparar a ativação externa.
