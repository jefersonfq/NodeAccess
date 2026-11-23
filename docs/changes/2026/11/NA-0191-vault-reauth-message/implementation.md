# NA-0191 — Registro da implementação

Base: `660b08096` (ver `plan.md`). Branch: security/NA-0191-20261123-vault-reauth-message.

## Pedido e objetivo

O usuário com **Usar extensão** ativa via "Acesso negado. Verifique a permissão…" na página de conexão da extensão. Diagnóstico (consulta somente leitura ao banco local): auditoria `UNLOCK_DENIED` — a confirmação de identidade (senha/código) falhou; a permissão estava concedida. Pedido: mensagem própria, de ponta a ponta.

## Implementação

- Backend: `reauthFailed()` (`VAULT_REAUTH_FAILED`, 403) nos três pontos de verificação de credencial do `VaultService`; prova do provedor ausente ou de outro cliente segue `VAULT_FORBIDDEN`. Auditoria e queima do desafio inalteradas.
- Portal: `vault-http.ts` mapeia 403 `VAULT_REAUTH_FAILED` → `reauth`; código do autenticador malformado (fluxo do provedor) e credencial Google malformada também viram `reauth`; texto `vaultDelivery.errors.reauth` (pt-BR/en), usado pela página de conexão da extensão, painel de entrega e administração.
- E2E HTTPS do cofre: senha errada exige a mensagem nova.
- Manual `hosts.md` (recuperação), manifesto revisado, `OPERATIONS-manual-pilot.md`; hashes revisados dos locales em `security/gitleaks-fixtures.json` (linha sinalizada inalterada).

## Validação

- Ran: vitest `vault-security` 282 PASS (44 opt-in skipped); portal (componentes, serviços, views) 1001 PASS; `tsc`, `vue-tsc`, `lint:changed` PASS; `test:vault:frontend` PASS (backend real, senha errada mostra a mensagem); `manual:check-reviewed` PASS; `security:scan` sem achado desta frente (sinaliza só arquivos locais não versionados da NA-0190).
- Skipped: `validate:sonar` local (tokens do responsável).

## Recuperação

Revert da PR; o portal anterior trata o código novo como recusa genérica.

## Pendências

- Homologação: na página de conexão da extensão, digitar senha errada e ver a mensagem nova; com a senha e o código certos da conta indicada, conectar.

## Diário de interações

### 2026-11-23T11:20:00-03:00 — Diagnóstico e implementação

Responsável aprovou a frente de ponta a ponta. Implementação e validação acima.

### 2026-11-23T11:40:00-03:00 — Revisão independente

Revisão independente (subagente, somente leitura): PASS_WITH_WARNINGS, sem oráculo útil (senha e TOTP verificados juntos; desafio queimado antes; auditoria e limites inalterados). Corrigido W1: código do autenticador em formato inválido no fluxo do provedor e credencial do Google malformada passam a `reauth` no portal (antes `denied`, que a página da extensão mostrava como falta de permissão). Ran: vitest serviços/componentes do cofre e `vault-security`.
