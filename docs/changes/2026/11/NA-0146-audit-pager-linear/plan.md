---
change_id: NA-0146
title: Reconhecimento linear dos estados de pager na auditoria
type: fix
status: ready-for-tests
created_at: 2026-11-04T09:44:12-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: ee436402db8bcce7fab4378d6ba28c1673b282b5
branch: fix/NA-0146-20261104-audit-pager-linear
owner: NodeAccess
planner: Codex
risk: medium
---

## Contexto e situação anterior

NA-0145 reproduziu SQ-0052: summarizeInteractiveOutput consome saída de terminal e a expressão de pager sobrepõe um quantificador numérico à cauda genérica. Falha de correspondência com U+2028 e cerca de60KB ultrapassou1,5s em subprocesso. O corte de linhas ocorre depois do reconhecimento.

## Problema e objetivo

Eliminar a sobreposição mantendo exatamente a linguagem aceita e a saída do resumo. Usuário autorizou correções, testes e simulações da avaliação NA-0145.

## Escopo

Expressão PAGER_STATUS_LINE e regressões do normalizador; documentos e evidências desta frente. Nenhuma mudança em transporte, sessão, armazenamento, limites ou baseline Sonar.

## Critérios de aceitação

- [x] Status de pager legítimos continuam removidos; conteúdo legítimo e Unicode incompleto são preservados.
- [x] Consumidor original processa casos adversariais grandes dentro do deadline sem truncamento.
- [x] Comparação diferencial com expressão anterior em entradas curtas não encontra mudança semântica.
- [x] Testes existentes de normalização/reconstrução e testes focais passam.
- [ ] Revisão independente e Sonar integrado verificam ausência da ocorrência.

## Estratégia técnica

A menor correção é remover a repetição redundante de dígitos antes da cauda: um dígito obrigatório seguido por ponto-estrela aceita a mesma linguagem que um ou mais dígitos seguido por ponto-estrela, pois os dígitos restantes já são aceitos pela cauda. Os delimitadores anteriores não se sobrepõem aos grupos numéricos. Confirmar com casos diferenciais, separadores Unicode e consumidor original, sem substituir por parser maior sem necessidade.

## Riscos e mitigações

Preservar semântica de ponto e âncoras JavaScript, inclusive separadores de linha. Provas adversariais em subprocesso com deadline, evitando prender Vitest/servidor. Não usar limite de tempo como substituto da equivalência de conteúdo.

## Matriz de testes e evidências

Baseline existente: NA-0145 pager-probes, consumidor original e timeout1,5s. Ran adicional antes da correção: suíte normalizer e prova adversarial com deadline. Planned: regressão funcional, comparação diferencial, caso60KB/1MB em subprocesso, testes de reconstrução relacionados, lint/typecheck conforme impacto, revisão independente. Sonar e cobertura integrais no candidato integrado NA-0093.

## Baseline

Fonte ee436402db8bcce7fab4378d6ba28c1673b282b5. Não reutilizar aprovação de scanner como aprovação da correção ainda não implementada.

## Rollback ou recuperação

Branch própria e patch integrado com identidade NA-0093; rollback pontual restaura a expressão anterior, mas reintroduz o risco conhecido e não é a recuperação recomendada em operação. Sem migração.

## Aprovação

Decisão: GO_WITH_RISKS. Objetivo autorizado pelo usuário; alteração localizada preserva arquitetura. Homologação humana e merge da integração continuam separados.
