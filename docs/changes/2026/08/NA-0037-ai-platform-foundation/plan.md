---
change_id: NA-0037
title: Retomar e unificar a plataforma de IA
type: feature
status: in_progress
created_at: 2026-08-14T12:30:00-03:00
base_branch: master
base_sha: aeedb58
branch: feature/NA-0037-20260814-ai-platform-foundation
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0037 - Plataforma de IA

## Objetivo

Consolidar providers locais e externos, assistente, auditoria, terminal,
diagnosticos, AI SSH Actions e MCP em uma arquitetura coerente, governada e
adotavel, preservando os fluxos criticos sem IA.

## Situacao anterior

Os principais blocos existem e funcionam, mas foram entregues por frentes
independentes. Configuracao, nomenclatura, provider routing, auditoria e UX nao
formam ainda uma jornada unica.

## Escopo desta frente

- inventario verificavel do estado atual;
- PRD unificado e arquitetura alvo;
- matriz de providers, finalidades e roteamento;
- decisao de acesso a dados por tools tipadas, sem SQL livre;
- plano de UX para configuracao, assistente, terminal e MCP;
- roadmap incremental com criterios de seguranca, performance e auditoria;
- primeiro corte tecnico da fundacao a definir apos validar o inventario.

## Riscos

| Risco | Impacto | Mitigacao |
|---|---|---|
| modelo executar fora de policy | critico | Tool Registry, ActionRun e revalidacao |
| vazamento de contexto/segredo | critico | minimizacao, redaction e sem SQL/DSN |
| providers disputarem finalidade | alto | router deterministico por finalidade |
| IA degradar terminal | alto | modulo opcional e palette desacoplada |
| custo/latencia imprevisivel | alto | budgets, fila, timeout, circuit breaker |
| shell MCP amplo demais | critico | perfil avancado, allowlist, TTL e kill switch |

## Evidencias iniciais

- `local-ai` resolve provider por policy, mas sem failover em runtime;
- OpenAI de auditoria e OpenAI-compatible do assistente possuem contratos
  diferentes;
- modos de escrita do assistente ainda nao criam ActionRun;
- MCP possui resources, tools, approvals e shell, mas onboarding e orientado a
  chamadas HTTP manuais;
- auditoria e diagnosticos ja oferecem base persistida para o relatorio alvo.

## Fases

1. Fundacao e clareza de providers.
2. MCP adotavel e testavel.
3. Assistente com Tool Registry.
4. Copilot do terminal.
5. Diagnosticos e relatorios.
6. Importacoes, bulk actions e autonomia governada.

## Stop criteria

- qualquer bypass de tenant, ACL, approval ou policy;
- necessidade de entregar credencial do banco ao modelo;
- dependencia de IA no carregamento ou funcionamento do terminal;
- envio externo de segredos ou buffer sem minimizacao;
- execucao de script sem preview, checksum, policy e trilha.

## Resultado do primeiro corte

- PRD unificado criado com inventario, gaps, arquitetura, UX e roadmap;
- status do assistente agora apresenta providers local/rede separadamente;
- provider selecionado, modelo, localidade e motivo de roteamento ficam visiveis;
- UI deixa explicito que prioridade configurada ainda nao e failover em runtime;
- experiencia renomeada para `Assistente NodeAccess`;
- 3 testes novos de roteamento aprovados;
- typechecks backend/frontend e build shared aprovados;
- regressao completa aprovada: 84 arquivos e 628 testes.
