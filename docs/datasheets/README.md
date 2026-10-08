# Datasheets NodeAccess — setembro de 2026

Edição 2. Documentos em português, revisados a partir do código e da documentação em 24/09/2026. A edição documental não identifica a versão instalada em produção.

| Edição | Uso | PDF | Fonte editável | HTML |
|---|---|---|---|---|
| Completa | Avaliação técnico-comercial integral | [PDF](./NodeAccess-Datasheet-2026-09.pdf) | [Markdown](../DATASHEET-NodeAccess.md) | [HTML](./NodeAccess-Datasheet-2026-09.html) |
| Comercial | Apresentação, descoberta e proposta | [PDF](./NodeAccess-Comercial-2026-09.pdf) | [Markdown](./NodeAccess-Comercial-2026-09.md) | [HTML](./NodeAccess-Comercial-2026-09.html) |
| Técnica/funcional | Avaliação de capacidades e integrações | [PDF](./NodeAccess-Tecnico-Funcional-2026-09.pdf) | [Markdown](./NodeAccess-Tecnico-Funcional-2026-09.md) | [HTML](./NodeAccess-Tecnico-Funcional-2026-09.html) |
| Infraestrutura/operação | Arquitetura, implantação e continuidade | [PDF](./NodeAccess-Infraestrutura-Operacao-2026-09.pdf) | [Markdown](./NodeAccess-Infraestrutura-Operacao-2026-09.md) | [HTML](./NodeAccess-Infraestrutura-Operacao-2026-09.html) |

Os documentos distinguem implementação, dependências, piloto e planejamento. Não definem preços, SLA ou certificações. Consulte a [matriz de evidências](../reviews/2026-09-24-datasheet-review.md) para verificar as fontes e limites da revisão.

Para atualizar, editar `docs/DATASHEET-NodeAccess.md` e, quando necessário, a composição comercial no gerador. Executar `node tools/docs/build-datasheets.cjs`. As edições segmentadas são regeneradas; não mantê-las manualmente em paralelo.

## Ajuste editorial para envio ao cliente — 24/09/2026

Conforme revisão de Jhon e confirmação de Jeferson, o PDF completo começa diretamente no capítulo 1: a antiga primeira página foi retirada, assim como todo o antigo item 12. As versões derivadas também foram regeneradas sem licenciamento. A fonte e o gerador preservam essa separação nas próximas atualizações.

A diretriz de licenciamento por quantidade de elementos observados está registrada exclusivamente na [base interna para documento separado](./LICENCIAMENTO-base-interna.md). Não foi gerada lista de preços, pois faixas e valores não foram definidos nesta revisão.

A geração valida a ausência de licenciamento nos materiais de produto, a estrutura das tabelas e a quantidade de capítulos. O PDF completo tem 11 páginas.
