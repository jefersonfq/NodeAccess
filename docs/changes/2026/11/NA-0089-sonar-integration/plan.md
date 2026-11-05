---
change_id: NA-0089
title: Integracao e reanalise das remediacoes SonarQube
type: chore
status: in-development
created_at: 2026-11-03T14:46:10-03:00
base_branch: chore/NA-0085-20261103-sonarqube
base_sha: a8af091485abe611a66752d0cbb8a723bd8a291c
branch: chore/NA-0089-20261103-sonar-integration
owner: NodeAccess
planner: Codex
risk: high
---

# NA-0089 — Integração SonarQube

## Contexto e situação anterior

533 achados originais foram distribuídos nas frentes NA0086/87/88. A rotina e a tabela estão na NA0085; cada domínio tem branch e commits recuperáveis. Workspace canônico contém alterações de outras frentes e será preservado.

## Problema e objetivo

Validar as mudanças combinadas, conferir cada disposição contra análise real e disponibilizar tabela e rotina reproduzíveis sem esconder gates preexistentes.

## Escopo

Aplicação dos patches das três branches filhas, correções necessárias da integração, revisão das novas ocorrências, baseline individual de contexto aceito, tabela, evidências e planejamento vivo. Sem push, merge de master, VPS ou modificação de thresholds.

## Critérios de aceitação

- [x] Todos os 533 originais e eventuais novos achados com decisão/evidência.
- [x] Reanálise real identifica alterações combinadas; diferenças documentadas.
- [x] Testes, build, UX/terminal e simulações proporcionais reproduzidos.
- [x] Revisão independente e branches recuperáveis registradas.
- [x] Rotina normal executada; falha preexistente de cobertura explicitada.

## Estratégia técnica

Cherry-pick sem commit das frentes filhas sobre NA0085; commit próprio NA0089 com proveniência. Isso mantém branches por domínio e identidade única na governança, sem misturar commits de outras mudanças. Dependências locais reutilizadas, shared resolvido no próprio worktree. Relatórios brutos permanecem privados.

## Riscos e mitigações

Storage requer UID uniforme, parsers exigem equivalência e controles de interface precisam de DOM real. Revisão independente já identificou e corrigiu regressão de CR/LF. Nenhuma mudança autoriza downgrade de dados. Coverage abaixo70/70/60 mantém gate FAIL mesmo com Sonar verde.

## Matriz de testes e evidências

Ran nas frentes: testes por domínio, browsers, builds, revisão independente. Nesta integração: suite instrumentada integral, Sonar scripts/scanner/export, table browser, build/typecheck e regressões pertinentes; resultados em test-results.md. Homologação humana Manual, pendente.

## Baseline

Base a8af091485abe611a66752d0cbb8a723bd8a291c. Sonar original533 achados/0hotspots; cobertura Vitest40,91/40,22/34,43 e1timeout preexistente. Não aumentar escopo de cobertura artificialmente nem reduzir limiares.

## Rollback ou recuperação

Retornar branch de domínio ou checkout de checkpoint anterior em worktree separado. Não resetar trabalho canônico, não remover volumes Sonar nem dados operacionais. Reversão de código não desfaz permissões de arquivos já corrigidas.

## Aprovação

Decisão: GO_WITH_RISKS. Usuário autorizou todos os achados, branches e rotina fim a fim. Revisão independente obrigatória; publicação externa e homologação humana não inferidas.

## Estado de fechamento técnico

Implementação/triagem/reanálise e revisões concluídas localmente. Gate global permaneceFAIL por cobertura; isso impede declarar pronta para merge/homologada. Checkpoint local autorizado preserva trabalho e evidências, sem publicar. Última repetição no SHA commitado é registrada em evidência externa ao próprio commit.
