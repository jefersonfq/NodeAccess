---
change_id: NA-0165
title: Consolidar Sonar obrigatório e rotina econômica de contexto
type: chore
status: ready-for-tests
created_at: 2026-11-04T17:40:42-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 025e82863d0a2cff49b29896dc283c7efdd00548
branch: chore/NA-0165-20261104-quality-context-efficiency
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0165 — Consolidar Sonar obrigatório e rotina econômica de contexto

## Contexto e situação anterior
Candidato base passou validação Sonar completa e todos os checks hospedados. Restam três achados operacionais e consolidação da rotina.

## Problema e objetivo
Consolidar Sonar obrigatório e rotina econômica de contexto.

## Escopo
Adicionar sonar-real ao ruleset existente preservando demais regras. Resumo compacto verificável para retomada e rotina por delta; fontes oficiais para tokens, sem prometer redução de custo não medida. Não reduzir testes ou checks. Documentar homologação humana pendente.

## Critérios de aceitação
- [x] Comportamento e evidências correspondem ao escopo.
- [x] Casos negativos e regressões aplicáveis passam.
- [ ] Revisão independente e análise integrada no candidato final.

## Estratégia técnica
Mudanças mínimas e independentes; integração por patch na NA0093. Docs canônicos no projeto atual.

## Riscos e mitigações
Não alterar nem mover dados de produção automaticamente. Não aceitar achados nem reduzir gates. Homologação humana permanece separada.

## Matriz de testes e evidências
Planned: testes focais, lint, governança e gates integrados; registrar comandos e resultados reais no diário.

## Baseline
025e82863d0a2cff49b29896dc283c7efdd00548: validate:sonar PASS e CI aprovado; testes focais a executar antes da edição.

## Rollback ou recuperação
Branch preservada; reverter patch específico. Configurações operacionais anteriores serão preservadas como evidência privada.

## Aprovação
Decisão: GO_WITH_RISKS. Usuário autorizou implementação fim a fim e proteção de branch; escolheu preservar TACACS legado com ativação endurecida. Não implica homologação ou aceite do risco MD5.
