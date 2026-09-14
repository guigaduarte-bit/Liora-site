# Inventário de catálogo e conteúdo — Liora

Data: 14/09/2026. Fonte de referência: commit `1266f2189395fc2fa7955f4ff50e0c64f76e8e18`, arquivos `index.html` (PRODUCTS, PIMG e AROMA_FAMILIES) e `api/catalog.js`.

Este inventário prepara SEO-01 e o conteúdo das páginas. Não confirma publicação, disponibilidade em tempo real nem redirecionamentos da Nuvemshop. Preço, estoque e identificadores permanecem sob controle do catálogo da API; os valores abaixo são a referência do commit auditado. O arquivo `content/product-editorial.json` contém somente conteúdo editorial e características sustentadas pelo cadastro existente.

## Decisões de URL e nomes

- Uma página por ID atual em `/produtos/{id}/`, com barra final. Preservar os identificadores completos do checkout, inclusive sufixos e os nomes históricos das URLs.
- As três versões Botanique continuam separadas porque possuem IDs, preços e estoques próprios. Nenhuma unificação de estoque ou criação de variante foi executada. O “70-ml” do ID histórico não é evidência de volume: o nome atual diz 70 g.
- Flor de Vênus foi diferenciada em “rosto com flores” e “flor com base texturizada”, conforme descrições existentes. Jardim Encantado foi diferenciado em “arranjo floral” e “flores em vaso”. Os nomes usados pela API permanecem intactos.
- Nenhum peso ou dimensão importados foi elevado a especificação pública sem confirmar se representa a vela, o conjunto ou a embalagem de transporte. As designações 250 g, 150 g e 70 g permanecem como parte do nome atual Botanique; confirmar peso líquido antes de acrescentar atributo de peso ao schema.
- Para Kits, usar somente Kit Silhouette e Kit Boho Glass. A tag antiga “Kits e Presentes” também inclui itens avulsos, e não comprova kit ou embalagem de presente.

## Produtos e URLs definitivas propostas

Os nomes e descrições editoriais são próprios de cada produto; o gerador poderá formar títulos com nome + Liora e usar a descrição editorial como base da meta description. A intenção da página é identificar o modelo e permitir sua compra, mantendo disponibilidade real no catálogo.

| ID / URL | Nome descritivo | Preço base | Estoque base | Categoria principal proposta | Seleção de fragrância atual |
|---|---|---:|---:|---|---|
| [vela-escultural-lady-veil-phie3](https://lioraaromasdeluxo.com.br/produtos/vela-escultural-lady-veil-phie3/) | Vela escultural Lady Veil | R$ 62,00 | 10 | Esculturas | Campo disponível |
| [vela-decorativa-anjo-em-vitral-1sbe9](https://lioraaromasdeluxo.com.br/produtos/vela-decorativa-anjo-em-vitral-1sbe9/) | Vela decorativa Anjo em Vitral | R$ 55,00 | 20 | Esculturas | Campo disponível |
| [botanique](https://lioraaromasdeluxo.com.br/produtos/botanique/) | Botanique — 250 g | R$ 75,00 | 2 | Essenciais | Campo disponível |
| [botanique-150-gr-1gyzj](https://lioraaromasdeluxo.com.br/produtos/botanique-150-gr-1gyzj/) | Botanique — 150 g | R$ 52,00 | 12 | Essenciais | Campo disponível |
| [botanique-70-ml-1dqj4](https://lioraaromasdeluxo.com.br/produtos/botanique-70-ml-1dqj4/) | Botanique — 70 g | R$ 25,00 | 5 | Essenciais | Campo disponível |
| [ursinho](https://lioraaromasdeluxo.com.br/produtos/ursinho/) | Pequeno Amor | R$ 10,00 | 30 | Essenciais | Campo disponível |
| [flordevenus](https://lioraaromasdeluxo.com.br/produtos/flordevenus/) | Flor de Vênus — rosto com flores | R$ 55,00 | 5 | Esculturas | Campo disponível |
| [abraco-em-luz](https://lioraaromasdeluxo.com.br/produtos/abraco-em-luz/) | Abraço em Luz | R$ 42,00 | 10 | Esculturas | Campo disponível |
| [mini-bubble](https://lioraaromasdeluxo.com.br/produtos/mini-bubble/) | Mini Bubble | R$ 16,00 | 30 | Essenciais | Campo disponível |
| [bolhas](https://lioraaromasdeluxo.com.br/produtos/bolhas/) | Bolhas | R$ 30,00 | 10 | Esculturas | Campo disponível |
| [no-deluz](https://lioraaromasdeluxo.com.br/produtos/no-deluz/) | Nó de Luz | R$ 32,00 | 5 | Essenciais | Campo disponível |
| [lioracoral](https://lioraaromasdeluxo.com.br/produtos/lioracoral/) | Liora Coral | R$ 32,00 | 10 | Esculturas | Campo disponível |
| [essenza-cube](https://lioraaromasdeluxo.com.br/produtos/essenza-cube/) | Essenza Cube | R$ 42,00 | 4 | Esculturas | Campo disponível |
| [kit-silhouette](https://lioraaromasdeluxo.com.br/produtos/kit-silhouette/) | Kit Silhouette | R$ 75,00 | 3 | Kits | Campo disponível |
| [trevo](https://lioraaromasdeluxo.com.br/produtos/trevo/) | Trevo | R$ 42,00 | 4 | Esculturas | Campo disponível |
| [perolas](https://lioraaromasdeluxo.com.br/produtos/perolas/) | Pérolas | R$ 42,00 | 4 | Esculturas | Campo disponível |
| [kit-boho-glass](https://lioraaromasdeluxo.com.br/produtos/kit-boho-glass/) | Kit Boho Glass | R$ 75,00 | 2 | Kits | Sem campo |
| [lumina](https://lioraaromasdeluxo.com.br/produtos/lumina/) | Lumina | R$ 46,00 | 5 | Esculturas | Campo disponível |
| [gota-de-luz1](https://lioraaromasdeluxo.com.br/produtos/gota-de-luz1/) | Gota de Luz | R$ 42,00 | 10 | Esculturas | Campo disponível |
| [geometricafacetada](https://lioraaromasdeluxo.com.br/produtos/geometricafacetada/) | Liora Elegance | R$ 32,00 | 5 | Esculturas | Campo disponível |
| [cilindro-mosaico](https://lioraaromasdeluxo.com.br/produtos/cilindro-mosaico/) | Cilindro Mosaico | R$ 42,00 | 5 | Esculturas | Campo disponível |
| [chama-esculpida](https://lioraaromasdeluxo.com.br/produtos/chama-esculpida/) | Chama Esculpida | R$ 62,00 | 5 | Esculturas | Campo disponível |
| [jardim-encantado](https://lioraaromasdeluxo.com.br/produtos/jardim-encantado/) | Jardim Encantado — arranjo floral | R$ 85,00 | 3 | Essenciais | Campo disponível |
| [camafeufada](https://lioraaromasdeluxo.com.br/produtos/camafeufada/) | Camafeu Fada | R$ 8,00 | 30 | Esculturas | Campo disponível |
| [botanicavasogesso](https://lioraaromasdeluxo.com.br/produtos/botanicavasogesso/) | Jardim Encantado — flores em vaso | R$ 75,00 | 0 — esgotado | Essenciais | Campo disponível |
| [peonia](https://lioraaromasdeluxo.com.br/produtos/peonia/) | Flor de Vênus — flor com base texturizada | R$ 12,00 | 8 | Esculturas | Campo disponível |
| [sagrada-familia](https://lioraaromasdeluxo.com.br/produtos/sagrada-familia/) | Sagrada Família | R$ 52,00 | 5 | Esculturas | Campo disponível |

A categoria principal proposta organiza a navegação; ela não substitui as coleções originais nem altera parâmetros de compra. As coleções Clássico, Flora Linea e Boho Glass podem permanecer como seleções secundárias, desde que tenham descrição e seleção próprias. Os dois kits podem também aparecer em suas linhas de origem.

## Fotografias, características e lacunas

Há uma fotografia WebP local por ID no caminho `/assets/images/{id}.webp`; não há galeria adicional confirmada. As características públicas de `specs` foram extraídas das descrições: forma, relevo, recipiente ou tampa quando explícitos. “Vidro”, “madeira” e “metálica” descrevem recipiente/tampa, e não composição da cera.

| ID | Coleções originais | Peso/medidas importados — validar antes de publicar como especificação | Pendência específica |
|---|---|---|---|
| vela-escultural-lady-veil-phie3 | Essenciais, Esculturas, Clássico, Kits e Presentes | Peso: 110gr | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| vela-decorativa-anjo-em-vitral-1sbe9 | Essenciais, Esculturas, Kits e Presentes | Peso: 100 gr · Medidas: 11cm x 6,2 cm | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| botanique | Essenciais, Flora Linea, Kits e Presentes | Não cadastrado | Confirmar peso líquido, dimensões, quantidade de unidades e uso do termo luminária. |
| botanique-150-gr-1gyzj | Essenciais, Flora Linea | Não cadastrado | Descrição original diz “conjunto”; confirmar unidades incluídas e peso líquido. A nova descrição não promete conjunto. |
| botanique-70-ml-1dqj4 | Essenciais, Flora Linea, Kits e Presentes | Peso 70gr / Medidas: 9cm x 9cm x 7cm (C x L x A) · Medidas: 9cm x 9cm x 7cm (C x L x A) | ID menciona 70 ml, nome 70 g; confirmar unidade e peso líquido. Medidas estavam duplicadas. |
| ursinho | Essenciais | Peso: 40gr · Medidas: 4cmX4cmX5cm (CXLXA) | Confirmar prazo atual (origem: 5 a 7 dias) e faixas de desconto por volume; não há evidência de regra correspondente no catálogo da API. |
| flordevenus | Flora Linea | Peso: 120gr · Medidas: 8cmX4cmX10cm (CXLXA) | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| abraco-em-luz | Flora Linea | Peso: 65gr · Medidas: 8cmX4cmX10cm (CXLXA) | “Material translúcido” não identifica composição; não publicar material específico. |
| mini-bubble | Essenciais | Peso: 40gr · Medidas: 4cmX4cmX4cm (CXLXA) | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| bolhas | Clássico | Peso: 88gr · Medidas: 7cmX5cmX6cm (CXLXA) | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| no-deluz | Essenciais | Peso: 55gr · Medidas: 8cmX8cmX8cm (CXLXA) | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| lioracoral | Esculturas | Peso: 65gr · Medidas: 7cmX7cmX7cm (CXLXA) | Descrição de origem truncada; solicitar características e texto completos. |
| essenza-cube | Esculturas | Peso: 125gr · Medidas: 7cmX7cmX7cm (CXLXA) | Descrição de origem truncada; solicitar características e texto completos. |
| kit-silhouette | Esculturas | Peso: 253gr · Medidas: 8cmX6cmX13cm (CXLXA) | Descrição truncada; confirmar peças, quantidades e embalagem incluídas no kit. |
| trevo | Esculturas | Peso: 120gr · Medidas: 5cmX5cmX12cm (CXLXA) | Descrição de origem truncada; confirmar forma detalhada e texto completo. |
| perolas | Clássico | Peso: 130gr · Medidas: 7cmX7cmX8cm (CXLXA) | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| kit-boho-glass | Boho Glass, Kits e Presentes | Peso: 350gr · Medidas: 8cmX8cmX10cm (CXLXA) | Confirmar composição/quantidades do kit, fragrância fornecida e por que frag=false. |
| lumina | Clássico | Peso: 130gr · Medidas: 7cmX7cmX9cm (CXLXA) | Origem descreve vaso; confirmar se inclui vela/cera e sua composição antes de afirmar. |
| gota-de-luz1 | Esculturas | Peso: 108gr · Medidas: 7cmX7cmX8cm (CXLXA). | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| geometricafacetada | Esculturas | Peso: 100gr · Medidas: 6cmX6cmX5cm (CXLXA). | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| cilindro-mosaico | Esculturas | Peso: 130gr · Medidas: 6cmX6cmX8cm (CXLXA) | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| chama-esculpida | Clássico | Peso: 208gr · Medidas: 7cmX7cmX13cm (CXLXA) | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| jardim-encantado | Flora Linea, Kits e Presentes | Peso: 700gr · Medidas: 15cmX15cmX18cm (CXLXA) | Confirmar número de flores/velas, material do vaso e conteúdo vendido. |
| camafeufada | Essenciais, Esculturas, Clássico, Kits e Presentes | Peso: 50gr · Medidas: 10cmX8cmX11cm (CXLXA). | Confirmar fita incluída e se as medidas são do produto ou da embalagem. |
| botanicavasogesso | Flora Linea | Peso: 200gr · Medidas: 12cmX12cmX12cm (CXLXA) | Esgotado: confirmar previsão de retorno/descontinuação e material do vaso; não inferir gesso apenas pelo ID. |
| peonia | Flora Linea | Peso 100gr · Medidas: 10cmX10cmX7cm (CXLXA). | Confirmar especificações técnicas, composição e informações comerciais comuns abaixo. |
| sagrada-familia | Essenciais, Esculturas | Peso: 200g · Medidas: 12cm x 8cm x 15cm (C x L x A) | Origem descreve escultura; confirmar composição e conteúdo vendido antes de afirmar materiais. |

Pendências comuns a validar com a responsável pela marca:

1. Peso líquido da peça, peso bruto para frete e medidas identificadas por comprimento, largura e altura; manter esses campos separados.
2. Composição da cera, tipo de pavio e demais materiais. O cadastro não comprova atributos como “vegetal”, “vegano”, “atóxico” ou duração de queima; não incluí-los.
3. Opções de cor e combinação de aroma por modelo, restrições e disponibilidade. O booleano `frag` só informa se o campo atual está disponível; não comprova que todo aroma esteja disponível em todo produto.
4. Prazo de produção por modelo, separado do prazo de transporte. O prazo citado para Pequeno Amor não deve ser generalizado.
5. Conteúdo da embalagem, unidades e itens incluídos, especialmente kits e arranjos. Não prometer embalagem de presente ou acessórios sem confirmação.
6. Cuidados apropriados a cada modelo e contexto de uso, validados pela fabricante; não copiar duração inicial de queima genérica para todo catálogo.
7. Validar nomes dos dois modelos homônimos, fotos extras e dados que possam enriquecer as fichas sem alterar identidade comercial ou IDs.

## Categorias e páginas propostas

| Grupo/página | Intenção e recorte | Destino proposto | Observações |
|---|---|---|---|
| Essenciais | Modelos em recipiente e seleção essencial da marca | /velas-aromaticas/ | Validar a curadoria; aroma específico depende do modelo e disponibilidade. |
| Esculturas | Peças com formas, motivos e relevos decorativos | /velas-decorativas/ | Preservar coleções secundárias existentes; não afirmar que Lumina inclui vela sem confirmar. |
| Kits | Produtos vendidos com nome de kit | /kits-e-presentes/ | Apenas Kit Silhouette e Kit Boho Glass; composição pendente. Outros itens podem ser sugeridos para presente sem chamá-los de kit. |
| Aromas | Famílias, notas e referências de arquivo | /catalogo-de-aromas/ | Preservar nomes e notas atuais, separar arquivo de aromas atuais. |
| Personalização | Explicar o campo de fragrância e consulta de opções | /velas-personalizadas/ | Não criar grade de cores, prazos ou quantidade mínima sem confirmação. |
| Sobre | Apresentação da marca e processo já documentado | /sobre/ | Somente autoria e contatos comerciais autorizados; sem dados pessoais. |

## Catálogo de aromas preservado

| Família | Perfil original | Aroma | Notas originais | Estado no catálogo |
|---|---|---|---|---|
| Floral Frutal | Romântico · Fresco · Feminino | Sim Arman | Figo · Damasco · Cedro · Musk | Atual no catálogo |
| Floral Frutal | Romântico · Fresco · Feminino | Fig Flower | Figo · Damasco · Cedro · Musk | Atual no catálogo |
| Floral Frutal | Romântico · Fresco · Feminino | Cereja & Avelã | Cereja · Gardênia · Cacau · Musk | Atual no catálogo |
| Floral | Delicado · Clássico · Elegante | Blum | Néroli · Jasmim · Tuberosa · Musk | Atual no catálogo |
| Floral | Delicado · Clássico · Elegante | Cloé | Peônia · Magnólia · Musk | Atual no catálogo |
| Floral | Delicado · Clássico · Elegante | Ar da Primavera | Floral verde | Atual no catálogo |
| Floral | Delicado · Clássico · Elegante | Flor de Peônia | Peônia · Rosa | Atual no catálogo |
| Floral | Delicado · Clássico · Elegante | White Gardênia | Gardênia · Jasmim · Almíscar | Referência de arquivo |
| Floral Aromático | Sofisticado · Sereno | Lavanda Sofisticada | Lavanda · Almíscar · Acorde aromático | Atual no catálogo |
| Floral Cítrico | Leve · Fresco · Doce | Lichia Sublime | Lichia · Rosa · Baunilha · Musk | Atual no catálogo |
| Cítrico Frutal | Vibrante · Energizante · Ensolarado | Goji & Tarocco Orange | Laranja · Bergamota · Goji · Manga · Buquê · Musk | Atual no catálogo |
| Cítrico Frutal | Vibrante · Energizante · Ensolarado | Aurora Cítrica | Perfil cítrico frutal | Referência de arquivo |
| Frutal | Alegre · Tropical · Sedutor | Trick or Treat | Maçapão · Pera · Berry · Beetle Juice | Atual no catálogo |
| Frutal | Alegre · Tropical · Sedutor | Smell of Dawn | Lichia · Rosa · Violeta · Berry | Atual no catálogo |
| Frutal | Alegre · Tropical · Sedutor | Beetle Juice | Perfil frutal | Referência de arquivo |
| Oriental Gourmand | Quente · Envolvente · Confortante | Dolci Notte | Baunilha · Amêndoa · Cacau | Atual no catálogo |

São 7 famílias, 16 referências e 3 entradas de arquivo. “Atual no catálogo” não representa uma validação de estoque de essência. Manter referências de arquivo distinguíveis; confirmar compatibilidade com cada produto antes de introduzir seletores limitados por aroma. As notas e nomes não foram reescritos nem expandidos.

## Migração: alcance deste inventário

As URLs de produto propostas preservam a estrutura e os IDs existentes no catálogo importado. Não é evidência de que todas as 27 URLs antigas estejam publicadas hoje. SEO-06 deve conferir status e canonical no domínio Nuvemshop para cada caminho, além de categorias e URLs obtidas em Search Console. As sementes `/notrancado/` e `/pascoa-encantada/` ainda dependem de identificação; não definir redirect genérico para a home. A hospedagem do domínio novo não controla redirects da Nuvemshop.

## Verificação desta entrega

- 27 objetos editoriais, IDs únicos e cobertura completa do catálogo.
- Comparação programática entre PRODUCTS do commit de referência e API: nomes de checkout, preços, estoque e disponibilidade coincidem para todos os produtos.
- O JSON editorial não inclui preço, estoque ou nomes de checkout sobrescritos.
- Descrições truncadas não foram completadas com características presumidas.
- Pesos/medidas ambíguos permanecem no inventário técnico para confirmação e não em specs públicas.
- Nenhuma publicação, redirecionamento externo ou alteração de regras de compra foi executada nesta subtarefa.
