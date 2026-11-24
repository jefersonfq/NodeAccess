# NA-0200 — Registro da implementação

Base: `930004d4d` (master com NA-0199). Branch: security/NA-0200-20261124-extension-hello.

## Pedido e objetivo

Fatia E5b: Windows Hello para a extensão. O WebAuthn só roda na origem do portal, então a prova vem de uma confirmação de identidade numa aba do portal (contrato SEC-16).

## Implementação

- Backend: `proof-request`/`proof-claim` (DPoP) e `proof-info`/`proof-approve` (portal; aprovação com sessão do cofre confirmada há menos de 60 s); pedido de 2 min em `vault_records` (`extproof`), sem token; só a mesma chave resgata, uma vez; auditoria.
- Portal: `/vault/extension/confirm?request=…` mostra o dispositivo e confirma a identidade (Windows Hello, senha + código ou provedor); bloqueia o cofre depois de aprovar.
- Extensão: **Confirmar no portal (Windows Hello)** no pedido de prova; guarda só o id do pedido na sessão; com o popup aberto, aguarda e segue com a ação; reaberto, só restaura a prova (SEC-16).
- Docs: contrato, operação da extensão, manual, plano de evolução.

## Validação

- Ran: vitest vault-security + extensão + portal + shared 1617 PASS; `test:extension:web` 36 checagens PASS (aba de confirmação no Chromium real, revelar após a aprovação, pedido resgatado uma vez); `tsc`, `vue-tsc`, `typecheck:extension`, `lint:changed`, `security:scan`, `manual:check-reviewed` PASS.
- Ran: revisão independente de segurança (subagente): PASS_WITH_WARNINGS; ajustes aplicados.
- Skipped: `validate:sonar` local (tokens do responsável); Windows Hello real (homologação).

## Recuperação

Revert da PR; sem migração; o código no popup continua funcionando.

## Pendências

- Homologação: com o Windows Hello cadastrado (NA-0198) e a origem em `https://localhost:5173`, revelar na extensão por **Confirmar no portal**.

## Diário de interações

### 2026-11-24T14:30:00-03:00 — Implementação

Ver acima.
