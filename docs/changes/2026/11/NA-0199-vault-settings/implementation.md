# NA-0199 — Registro da implementação

Base: `ea7b80e3b` (master com NA-0198). Branch: feature/NA-0199-20261124-vault-settings.

## Pedido e objetivo

O responsável não encontrou onde habilitar revelar/copiar no tenant e pediu o padrão das demais configurações (`/admin/settings`). Decisão (2026-11-24): seção **Cofre** em `/admin/settings` para administradores; gestores do cofre que não são administradores mantêm os blocos na página do cofre.

## Implementação

- Backend: `POST /vault-security/administration/settings` (administradores do tenant ou gestores; sem desbloqueio; origem exata e limite via `inspect`) com os valores atuais da política do cofre.
- Portal: `VaultSettings.vue` na seção **Cofre (VaultNAccess)** de `/admin/settings` (`?section=vault`): valores atuais, e para gestores o `VaultAdministration` no modo `settings` (proposta/aprovação de entrega no tenant, tempo de confirmação e validade); administradores não gestores leem; na página do cofre, administradores veem o link **Configurações do cofre** no lugar dos blocos e o aviso de política leva a essa seção.
- Docs: manual (`hosts`), `OPERATIONS-vault-security.md`.

## Validação

- Ran: vitest vault-security + portal + shared (incluindo serviço/rota de `settings`, modos do `VaultAdministration`, `VaultSettings`, link direto e roteamento do aviso); `test:vault-administration:web` 14 cenários PASS (política proposta pela seção **Cofre**, validade de 24 h pela seção, capturas); `tsc`, `vue-tsc`, `lint:changed`, `security:scan`, `manual:check-reviewed` PASS.
- Ran: revisão independente (subagente): PASS_WITH_WARNINGS; ajustes aplicados.
- Skipped: `validate:sonar` local (tokens do responsável).

## Recuperação

Revert da PR; sem migração.

## Pendências

- Homologação: abrir **Configurações → Cofre**, conferir os valores e propor revelar/copiar; outro gestor aprova.
- Encerramento da NA-0198 registrado aqui (mesclada em `ea7b80e3b`).

## Diário de interações

### 2026-11-24T11:30:00-03:00 — Implementação, simulação e revisão

Ver acima.
