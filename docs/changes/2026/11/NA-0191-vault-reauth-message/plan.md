---
change_id: NA-0191
title: Mensagem própria quando a confirmação de identidade do cofre falha
type: security
status: closed
created_at: 2026-11-23T11:00:00-03:00
base_branch: master
base_sha: 740d58273bd7e01aa34a284a08842817d1fc7cc5
branch: security/NA-0191-20261123-vault-reauth-message
owner: Jeferson Quintana
planner: Claude Code
risk: medium
issue: null
---

# NA-0191 — Mensagem própria quando a confirmação de identidade do cofre falha

## Contexto e situação anterior

Homologação da extensão (2026-11-23): o usuário com **Usar extensão** ativa recebeu "Acesso negado. Verifique a permissão "Usar extensão" com os gestores do cofre." A auditoria mostrou `UNLOCK_DENIED`: a senha ou o código do autenticador da conta não conferiram. O backend responde toda recusa do cofre com `VAULT_FORBIDDEN` (403); o portal mapeia 403 para `denied`, e a página de consentimento traduz `denied` como falta da permissão.

## Problema e objetivo

Diferenciar a falha da confirmação de identidade da falta de permissão, sem afrouxar nenhuma regra: o usuário vê "Não foi possível confirmar sua identidade. Confira a conta indicada, a senha e o código do autenticador e tente novamente." sem indicar qual fator falhou.

## Escopo

- Backend (`vault.service.ts`, `vault-domain.ts`): `VAULT_REAUTH_FAILED` (403, mesmo status) para senha/TOTP recusados no desbloqueio local, prova do provedor recusada e TOTP recusado após o provedor. Desafio inválido/vencido, prova do provedor de outro cliente e demais recusas seguem `VAULT_FORBIDDEN`. Auditoria, queima do desafio e limites inalterados.
- Portal: `vault-http.ts` lê o código também em 403 → motivo `reauth`; textos pt-BR/en em `vaultDelivery.errors.reauth`. A página de consentimento da extensão, o painel de entrega e a administração do cofre passam a mostrar essa mensagem.
- Testes unitários, rotas, componentes e o e2e HTTPS do cofre (senha errada).

Fora: mudar regras de bloqueio, contagem de tentativas ou métodos de confirmação.

## Critérios de aceitação

- [x] Senha ou código errados na confirmação (local ou após o provedor) e prova do provedor recusada respondem 403 `VAULT_REAUTH_FAILED`, com a mesma auditoria `UNLOCK_DENIED` e o desafio queimado.
- [x] O portal mostra a mensagem de confirmação falha na página de consentimento, no painel de entrega e na administração; "Acesso negado… Usar extensão" fica só para recusas de permissão.
- [x] A mensagem não indica qual fator falhou; nenhum limite muda.
- [x] Outras recusas 403 continuam `denied`.

## Estratégia técnica

Novo helper `reauthFailed()` no domínio, usado só nos três pontos de verificação de credencial do `VaultService`. No portal, o transporte já lê o corpo em 409 (`VAULT_NO_APPROVER`); passa a ler também em 403 e mapear `VAULT_REAUTH_FAILED`.

## Riscos e mitigações

Distinguir "credencial errada" de "sem permissão" para um usuário já autenticado no portal não abre enumeração (a conta é a da sessão) e os limites de tentativas continuam. Mesmo status HTTP: clientes antigos continuam tratando como recusa.

## Matriz de testes e evidências

vitest `vault-security`, serviços e componentes do cofre; `test:vault:frontend` (HTTPS real com senha errada); `test:vault-administration:web`; `tsc`/`vue-tsc`; `lint:changed`; `security:scan`; `manual:check-reviewed`; revisão independente; `validate:sonar` depende dos tokens do responsável.

## Baseline

2026-11-23, `660b08096`: vitest `vault-security` + serviços e componentes do cofre 428 PASS (44 opt-in skipped).

## Rollback ou recuperação

Revert da PR. Sem migração; o portal anterior trata o novo código como `denied`.

## Aprovação

Decisão: `GO` — responsável aprovou a frente de ponta a ponta em 2026-11-23.
