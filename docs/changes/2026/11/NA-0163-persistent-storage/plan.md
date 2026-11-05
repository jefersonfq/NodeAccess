---
change_id: NA-0163
title: Remover defaults temporários de auditoria e avatares
type: fix
status: ready-for-tests
created_at: 2026-11-04T17:40:41-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 025e82863d0a2cff49b29896dc283c7efdd00548
branch: fix/NA-0163-20261104-persistent-storage
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0163 — Remover defaults temporários de auditoria e avatares

## Contexto e situação anterior
Candidato base passou validação Sonar completa e todos os checks hospedados. Restam três achados operacionais e consolidação da rotina.

## Problema e objetivo
Remover defaults temporários de auditoria e avatares.

## Escopo
Defaults persistentes privados; preservar overrides; transição sem remoção automática de dados. Testar env, permissões, symlinks, leitura após reinício e configuração dos volumes.

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
