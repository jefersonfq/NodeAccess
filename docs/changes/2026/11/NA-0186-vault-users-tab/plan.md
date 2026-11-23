---
change_id: NA-0186
title: Permissões do cofre pela guia Usuários e tempo de confirmação por tenant
type: feature
status: ready-for-review
created_at: 2026-11-22T20:00:00-03:00
base_branch: master
base_sha: 7c973fce81737b48b321c7e50555c4fb5ef255dc
branch: feature/NA-0186-20261122-vault-users-tab
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0186 — Permissões do cofre pela guia Usuários e tempo de confirmação por tenant

## Contexto e situação anterior

- As permissões do cofre (revelar, copiar, extensão) só são concedidas na seção **Permissões do cofre (gestores)** dentro do VaultNAccess (NA-0183, `VaultAdministration.vue`), com proposta de um gestor e aprovação de outro.
- Toda revelação ou cópia exige uma confirmação de identidade (senha+TOTP ou provedor) com no máximo 60 s (`grantDeadline` em `vault-domain.ts`; contrato NA-0177 §"Prova fresca", 60 s). Na prática, a cada operação após 1 minuto o usuário confirma de novo.
- Na homologação da NA-0183 (2026-11-22) o responsável achou a concessão pouco fluida e pediu: conceder pela guia Usuários; e, depois de confirmar, valer por um tempo configurável no tenant, não a cada operação.

## Problema e objetivo

1. Conceder e aprovar permissões do cofre a partir da guia **Usuários**, por usuário, com as mesmas regras de hoje.
2. Tempo de confirmação configurável por tenant para revelar/copiar, mudado pelo mesmo fluxo de dois gestores.

## Escopo

1. **Guia Usuários**: no menu de ações de cada usuário, **Permissões do cofre**, visível só para gestores do cofre (mesma consulta `administration/status`). Abre uma janela com a seção de administração já existente, filtrada para aquele usuário (situação de revelar/copiar/extensão, propor ativar/retirar, propostas pendentes dele e **Aprovar** para outro gestor). A seção do VaultNAccess continua igual.
2. **Tempo de confirmação** (`confirmationSeconds`) na política do cofre do tenant (`vault_policies.config`): de 60 s (padrão, contrato) a 900 s (15 min), em minutos inteiros. Nova mudança de administração `{ kind: 'confirmation', seconds }`, proposta por um gestor e aprovada por outro, com o valor visível na proposta. Política sem o campo = 60 s.
3. Vale só para revelar/copiar. Administração do cofre e consentimento da extensão continuam exigindo confirmação < 60 s. A sessão do cofre continua limitada pela inatividade (5 min) e pela validade absoluta; cada liberação continua valendo 30 s e sendo de uso único.
4. A seção de administração mostra o tempo atual e permite propor outro valor; o resumo (`overview`) passa a trazer `policy.confirmationSeconds`.
5. Auditoria: a proposta e a aprovação já registram a mudança (`POLICY_CHANGE_PROPOSED`/`POLICY_CHANGED`).
6. Manual (`docs/manual`), textos pt-BR/en, testes.

Fora: mudar quem pode aprovar; tela para `policy`/`item`; mudar a inatividade da sessão; aplicar o tempo à administração ou à extensão; NA-0187.

## Critérios de aceitação

- [ ] Gestor vê **Permissões do cofre** na guia Usuários; quem não é gestor (inclusive admin do NodeAccess) não vê; o servidor nega igual a hoje.
- [ ] Pela guia Usuários: propor, ver a proposta pendente daquele usuário e aprovar com outro gestor; proponente e beneficiário não aprovam (testes de componente e servidor existentes continuam PASS).
- [ ] `confirmation` fora de 60–900 s, não inteiro ou fora de minutos inteiros é rejeitado pela rota e pela política (`assertPolicy`).
- [ ] Com 300 s aprovados, revelar/copiar funcionam até 300 s após a confirmação (dentro da sessão), e a administração continua exigindo < 60 s; com o padrão, comportamento atual.
- [ ] Aprovar o tempo incrementa a versão da política (bloqueia sessões do cofre), como toda mudança.
- [ ] Testes do cofre (unitários, MySQL/Redis reais, portal Chromium), lint, typecheck, manual e checks remotos PASS.

## Estratégia técnica

- `grantDeadline(session, client, now, authority, proofWindowMs = 60_000)`; `request`/`consume` passam `confirmationSeconds * 1000` da política; `confirmed` mantém 60 s.
- `VaultPolicy.confirmationSeconds?: number`, validado em `assertPolicy`; repositório aplica com `JSON_SET`.
- `VaultAdministration.vue` ganha a propriedade opcional `userId` (filtro) e o bloco do tempo (só sem filtro); `UsersView.vue` abre a janela.

## Riscos e mitigações

- **Exceção ao contrato NA-0177** (prova de 60 s para revelar/copiar): decisão do responsável (2026-11-22), limitada a 15 min, só por dois gestores, padrão inalterado, auditada e sempre dentro da sessão do cofre (inatividade de 5 min, validade absoluta, versão da política e sessão central viva). Registrar no contrato como exceção configurável.
- Regressão no fluxo de aprovação: reuso do mesmo componente e das mesmas rotas; testes atuais como rede de proteção.

## Matriz de testes e evidências

`vitest` de `vault-security`, componentes do cofre e `UsersView`; `npm run test:vault:real`; `npm run test:vault:frontend`; `lint:changed`; `tsc`/`vue-tsc`; `test:manual`/`manual:check-reviewed`; `security:scan`; revisão independente de segurança; `validate:sonar` depende dos tokens do responsável.

## Baseline

A registrar antes do código.

## Rollback ou recuperação

Revert da PR. Valor gravado em `config` é ignorado pelo código anterior (que volta a 60 s). Sem migração de esquema.

## Mudanças de escopo e decisões

- 2026-11-22: decisão do responsável — manter a regra de dois gestores; tempo de confirmação configurável no tenant.
- Decisões de desenho (planejador): máximo de 15 min; só revelar/copiar; mudança pelo fluxo de dois gestores, como as demais regras do cofre.
- 2026-11-22 (correção necessária, apontada pela revisão independente): o portal também limitava a prova a 60 s e se bloqueava antes do servidor. O desbloqueio passa a informar `proofUntil` (o tempo do tenant, nunca além da sessão); o portal usa esse prazo para revelar/copiar, mantém 60 s para administração e consentimento da extensão e acompanha a renovação da inatividade a cada operação autorizada, sem passar do fim absoluto da sessão. O tempo aceita só minutos inteiros.
- Ressalva aceita (revisão, LOW de UX): se o gestor tentar administrar com a prova acima de 60 s, o portal bloqueia o cofre e pede nova confirmação (falha para o lado mais restrito).

## Aprovação

Decisão: `GO_WITH_RISKS` — o responsável pediu a frente de ponta a ponta em 2026-11-22. Risco: afrouxa a prova de 60 s por decisão explícita, com limite e dois gestores.
