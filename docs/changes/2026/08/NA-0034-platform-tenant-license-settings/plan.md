---
change_id: NA-0034
title: Separar configurações de plataforma, tenant e licenciamento
type: feature
status: passed
created_at: 2026-08-13T23:35:00-03:00
base_branch: feature/NA-0033-20260813-jira-session-traceability
base_sha: 351bd683ec874cc79550d669b19655423dc37e29
branch: feature/NA-0034-20260813-platform-tenant-license-settings
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0034 — Configurações de plataforma, tenant e licenciamento

## Contexto e situação anterior

Configurações globais, políticas do tenant e edição comercial da licença
compartilhavam tela e permissão administrativa. Um admin do tenant podia chamar
o endpoint de entitlements da própria organização.

## Problema e objetivo

Separar configurações globais da instalação, políticas do tenant e contrato
de licença. Somente superadmins podem visualizar configurações da plataforma
ou alterar quotas e entitlements. Administradores do tenant configuram apenas
seu escopo e consultam consumo/licença em modo somente leitura.

## Escopo

- menu `Plataforma` visível somente para superadmins;
- tela `Configurações da plataforma` para ambiente e diagnóstico global;
- tela `Configurações do tenant` em Administração;
- licença editável somente no detalhe do tenant por superadmin;
- resumo de licença e consumo somente leitura para tenant admin;
- separar contratos HTTP e guards no backend;
- distinguir quota contratada, limite operacional e consumo;
- manter enforcement server-side de usuários, hosts, módulos e providers;
- auditar alterações de licença;
- atualizar menu, paleta de comandos, redirects e documentação.

## Estratégia técnica

Criar contratos de plataforma protegidos por `requirePlatformAdmin`, selecionar
explicitamente o tenant na edição comercial e manter endpoints operacionais
vinculados ao `tenantId` autenticado. Normalizar dependências e validar consumo
no serviço antes da persistência. Separar rotas/menu e centralizar a edição de
licença na gestão de tenants.

## Riscos e mitigações

| Risco | Impacto | Mitigação | Stop criterion |
|---|---|---|---|
| autoelevação de licença | crítico | guard de plataforma e teste HTTP | admin comum recebe sucesso |
| tenant cruzado | crítico | tenant alvo explícito somente para superadmin | contrato do tenant incorreto muda |
| quota abaixo do consumo | alto | contagem e validação server-side | quota inválida persiste |
| menu ou rota vazando | alto | guards, condicionais e harness por perfil | admin comum vê Plataforma |
| dependência inconsistente | alto | normalização de filhos no backend | provider ativo sem Integrações |

## Critérios de aceitação

- [x] admin de tenant não visualiza nem altera configurações da plataforma;
- [x] admin de tenant não altera quotas, módulos ou providers licenciados;
- [x] superadmin consegue consultar e editar licença de tenant explicitamente selecionado;
- [x] configurações do tenant permanecem isoladas por `tenantId` autenticado;
- [x] quotas contratadas não podem ser reduzidas abaixo do consumo;
- [x] consumo de usuários e hosts é derivado no servidor e somente leitura;
- [x] dependências de recursos e integrações são normalizadas no backend e claras na UI;
- [x] alterações de licença geram auditoria sem dados sensíveis;
- [x] rotas, menu e paleta respeitam admin/superadmin;
- [x] testes unitários, HTTP, typechecks e harness Playwright/CDP passam.

## Estratégia de testes

- matriz HTTP: user, tenant admin, superadmin e tenant cruzado;
- quotas: abaixo, no limite, acima e redução abaixo do consumo;
- entitlements: módulo pai, provider filho e combinações inválidas;
- persistência: salvar, reler e confirmar isolamento entre tenants;
- UI tenant: leitura de consumo, edição de políticas e ausência de editor comercial;
- UI plataforma: seleção de tenant, edição de contrato e confirmação;
- navegação: menu, rota direta, paleta e estados sem permissão/licença;
- regressão: integrações, hosts, usuários e dashboard continuam consumindo o snapshot correto.

## Matriz de testes e evidências

| Critério/risco | Teste | Evidência |
|---|---|---|
| autorização e tenant alvo | Fastify routes | admin 403; superadmin atualiza ID selecionado |
| quotas e dependências | service unitário | redução bloqueada e filhos normalizados |
| navegação e persistência | Playwright + Chromium CDP | dois perfis, salvar e reler |
| contrato de tipos | typecheck integral | backend e frontend aprovados |
| empacotamento | build frontend | produção aprovada |

## Baseline

Antes da mudança, `PATCH /settings/license` exigia somente admin, Observabilidade
aparecia no grupo Plataforma para administradores comuns e a tela de Settings
misturava ambiente, tenant e editor comercial.

## Rollback ou recuperação

Reverter rotas e componentes novos mantendo a estrutura persistida de licença.
Nenhuma migration destrutiva é prevista.

## Aprovação

- Decisão: GO
- Aprovado por: usuário
- Aprovado em: 2026-08-13
