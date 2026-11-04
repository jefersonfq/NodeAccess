---
change_id: NA-0164
title: Exigir reconhecimento explícito ao ativar TACACS legado
type: security
status: in-development
created_at: 2026-11-04T17:40:41-03:00
base_branch: chore/NA-0093-20261103-sonar-delivery
base_sha: 025e82863d0a2cff49b29896dc283c7efdd00548
branch: security/NA-0164-20261104-tacacs-legacy-guard
owner: NodeAccess
planner: Codex
risk: medium
---

# NA-0164 — Exigir reconhecimento explícito ao ativar TACACS legado

## Contexto e situação anterior
Candidato base passou validação Sonar completa e todos os checks hospedados. Restam três achados operacionais e consolidação da rotina.

## Problema e objetivo
Exigir reconhecimento explícito ao ativar TACACS legado.

## Escopo
Preservar interoperabilidade MD5 e risco OPEN; exigir reconhecimento operacional antes de escutar, documentação e compose sem reconhecimento automático. Testes positivos/negativos e protocolo TCP real.

## Critérios de aceitação
- [ ] Comportamento e evidências correspondem ao escopo.
- [ ] Casos negativos e regressões aplicáveis passam.
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

## Correção necessária autorizada — 2026-11-04

NECESSARY_CORRECTION: remover cinco achados lint preexistentes em `tacacs-main.ts`, com anotações de retorno e omissão de `tenants` via propriedade `undefined` no JSON. Equivalência comportamental preservada; protocolo e decisões AAA não mudam. Baseline dos achados e reexecução registrados no diário.
