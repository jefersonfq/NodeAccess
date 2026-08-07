---
change_id: NA-0009
title: Organizar e versionar assets oficiais da marca NodeAccess
type: docs
status: ready-for-commit
created_at: 2026-08-06T12:55:34-03:00
base_branch: master
base_sha: 512024608ea18b98f7bf2bb228e5a1846db929b5
branch: docs/NA-0009-20260806-brand-assets
owner: codex
planner: codex
risk: low
issue: null
---

# NA-0009 — Assets oficiais da marca NodeAccess

## Contexto e situação anterior

Os PNGs de logo, wordmark, favicon e marca lateral foram gerados em `docs/assets/nodeaccess-png`, mas permanecem não versionados no diretório principal. Sem uma frente própria, os arquivos ficam sem revisão de dimensões, nomenclatura, finalidade e instruções de uso.

## Problema e objetivo

Organizar um pacote versionado e documentado de assets PNG da marca NodeAccess, distinguindo favicon, símbolo, wordmark, uso em fundos claros/escuros e contratos, sem alterar automaticamente a identidade exibida pela aplicação.

## Escopo

- Included:
  - inventariar os 14 PNGs e o README existentes;
  - validar formato, dimensões, transparência e integridade básica;
  - padronizar estrutura e documentação de uso;
  - remover duplicações somente se comprovadas por checksum e finalidade;
  - garantir que nenhum arquivo de debug ou dado sensível seja incluído;
  - preparar comparação e evidência para revisão.
- Excluded:
  - redesenhar ou gerar nova identidade visual;
  - substituir logos no frontend, favicon ativo ou documentos existentes;
  - alterar componentes, CSS, build ou comportamento da aplicação;
  - remover os arquivos de origem antes da validação.

## Critérios de aceitação

- [x] Todos os PNGs existentes possuem formato, dimensões e finalidade documentados.
- [x] Os assets abrem corretamente e preservam transparência/fundo esperado.
- [x] Nomes e estrutura permitem identificar marca, variante, tamanho e contexto de uso.
- [x] O README informa usos recomendados, restrições e arquivos canônicos.
- [x] Nenhum arquivo de `imgs_debug`, worktree, log, credencial ou artefato operacional entra no diff.
- [x] `git diff --check` e o lint incremental aplicável passam.
- [x] Revisão independente confirma que o pacote é coerente e não altera a aplicação.

## Estratégia técnica

Copiar os assets existentes para o worktree isolado, validar metadados e checksums, revisar o README e manter a entrega limitada a documentação e imagens. Preservar os binários originais quando não houver defeito comprovado.

## Riscos e mitigações

| Risk | Impact | Mitigation | Stop criterion |
|---|---|---|---|
| Versionar imagem incorreta ou de debug | Médio | Allowlist explícita e revisão do diff | Arquivo fora de `docs/assets/nodeaccess-png` |
| Duplicar variantes sem propósito | Baixo | Comparar checksums, dimensões e documentação | Duplicata sem função distinta |
| Alterar identidade ativa sem homologação | Médio | Não tocar frontend nesta frente | Qualquer diff em `apps/` |
| Perder asset original | Médio | Copiar para worktree e preservar origem até merge | Origem ausente ou checksum divergente sem justificativa |

## Matriz de testes e evidências

| Criterion/risk | Test/harness | Environment | Evidence | Required |
|---|---|---|---|---|
| Integridade e formato | file, checksum e leitura de imagem | local isolado | inventário no relatório | yes |
| Dimensões e transparência | identificador de imagens disponível | local isolado | tabela de assets | yes |
| Escopo | git status, diff e diff --check | worktree NA-0009 | saída dos comandos | yes |
| Documentação | revisão do README | worktree NA-0009 | revisão independente | yes |
| Regressão da aplicação | não aplicável: nenhum arquivo de aplicação | local | justificativa registrada | no |

## Baseline

- Base SHA: `512024608ea18b98f7bf2bb228e5a1846db929b5`.
- Commands/results: `git status` no master lista somente `docs/assets/` após exclusões locais.
- Known failures: nenhum; assets ainda não estão presentes no worktree da frente.
- Before evidence: 14 PNGs e 1 README existentes no diretório principal, totalizando aproximadamente 680 KB.

Resultados: [test-results.md](./test-results.md).

## Rollback ou recuperação

Como a frente adicionará somente imagens e documentação, rollback consiste em reverter a adição desses arquivos. Não há banco, configuração, runtime ou dados persistentes afetados.

## Scope changes and decisions

- `IN_PLAN`: organizar e documentar os assets existentes.
- `OUT_OF_SCOPE`: aplicar as logos na interface ou gerar novas variantes.

## Aprovação

- Decisão: `GO`
- Approved by: usuário
- Approved at: 2026-08-06T12:55:34-03:00
