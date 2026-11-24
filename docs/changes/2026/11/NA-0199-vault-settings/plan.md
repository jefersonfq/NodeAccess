---
change_id: NA-0199
title: Cofre — configurações do tenant em /admin/settings (seção Cofre)
type: feature
status: delivered
created_at: 2026-11-24T10:00:00-03:00
base_branch: master
base_sha: ea7b80e3b64374583633a9fbfc03f4cfb37198aa
branch: feature/NA-0199-20261124-vault-settings
owner: Jeferson Quintana
planner: Claude Code
risk: medium
issue: null
---

# NA-0199 — Configurações do cofre em /admin/settings

## Contexto e situação anterior

A política de revelar/copiar, a cota, o tempo de confirmação e a validade das propostas (NA-0186/0188/0196) ficam na seção **Permissões do cofre (gestores)** da página do cofre. O responsável não encontrou onde habilitar revelar/copiar: as demais configurações do tenant ficam em `/admin/settings`.

## Problema e objetivo

Levar as configurações do tenant do cofre para o lugar padrão (`/admin/settings`, seção **Cofre**), mantendo a regra de dois gestores; a página do cofre fica com itens e permissões por pessoa. Decisão do responsável (2026-11-24): gestores do cofre que não são administradores continuam vendo esses blocos na própria página do cofre ("o VaultNAccess como recurso individual").

## Escopo

- Backend: `POST /vault-security/administration/settings` (sem desbloqueio, origem exata, limite de leitura): para administradores do tenant ou gestores do cofre, devolve os valores atuais (revelar, copiar, cota, tempo de confirmação, validade das propostas, origem do cofre, Windows Hello disponível na origem) e se a pessoa é gestora; demais recebem 403.
- Portal:
  - `/admin/settings`: seção **Cofre (VaultNAccess)**, com link direto `?section=vault`: valores atuais para leitura; para gestores, confirmação de identidade e os blocos de proposta (entrega no tenant, tempo de confirmação, validade) e as propostas desses tipos para aprovar; administradores que não são gestores veem a orientação de pedir a um gestor; tenant sem cofre configurado é explicado.
  - Página do cofre: para administradores, os blocos de configuração do tenant viram o link **Configurações do cofre** (`/admin/settings?section=vault`); gestores não administradores mantêm os blocos; o aviso "Revelar e copiar estão desligados" leva o gestor administrador à seção de configurações.
- Docs: manual (capítulo do cofre e textos), operação.

Fora: mudar quem pode alterar (continua proposta + aprovação de dois gestores); configurações por item e por pessoa (seguem na página do cofre).

## Critérios de aceitação

- [x] Administrador encontra a seção **Cofre** em `/admin/settings` com os valores atuais, sem desbloquear o cofre.
- [x] Gestor (administrador) propõe e outro gestor aprova pela seção; os valores mudam.
- [x] Administrador não gestor vê os valores só para leitura, com orientação; usuário comum não acessa (403).
- [x] Página do cofre: administrador vê o link no lugar dos blocos; gestor não administrador mantém os blocos.
- [x] Simulação no navegador atualizada (fluxo da política pela seção de configurações) e capturas.

## Estratégia técnica

`VaultAdministration` ganha o modo `settings` (só configurações do tenant e as propostas desses tipos) e passa a esconder esses blocos na página do cofre para administradores; nova leitura `administration/settings` via `inspect()` (origem e limite), com papel de administrador ou gestor conferido no servidor.

## Mudanças de escopo e decisões

- 2026-11-24 (simulação): textos por papel — na seção de configurações o botão é **Alterar configurações do cofre**; o aviso "Revelar e copiar estão desligados" leva o gestor administrador a **Configurações → Cofre**.
- 2026-11-24 (revisão independente, PASS_WITH_WARNINGS): registro de implementação; testes do link direto `?section=vault` e do roteamento do aviso; só a rota ausente (404) é tratada como "cofre não habilitado" (403 já explica "cofre não configurado"); texto de carregamento na seção.

## Riscos e mitigações

- Expor configurações a administradores não gestores: são valores de política (sem segredos) e já visíveis aos usuários de forma indireta (motivos da NA-0196); alteração continua exclusiva dos gestores.
- Duas telas com os mesmos blocos (gestor não administrador): componente único reaproveitado, sem lógica duplicada.

## Matriz de testes e evidências

vitest (serviço/rota de `settings`, componente, `VaultAdministration` nos modos, `SettingsView`), simulação `test:vault-administration:web`, `tsc`, `vue-tsc`, `lint:changed`, `security:scan`, `manual:check-reviewed`; revisão independente.

## Baseline

2026-11-24 sobre `ea7b80e3b`: vitest vault-security + componentes do cofre + views + shared 571 PASS, 50 skipped.

## Rollback ou recuperação

Revert da PR; sem migração.

## Aprovação

Decisão: `GO` — responsável em 2026-11-24 ("Claro, gostei da ideia"), com gestores não administradores mantendo os blocos na página do cofre.
