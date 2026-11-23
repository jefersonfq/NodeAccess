---
change_id: NA-0188
title: Gestores do cofre pela guia Usuários, validade de propostas por tenant e avisos de pendência
type: security
status: ready-for-review
created_at: 2026-11-23T07:30:00-03:00
base_branch: master
base_sha: 518e88aa5a88a9a029299b2470707fb694b02642
branch: security/NA-0188-20261123-vault-managers
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0188 — Gestores do cofre pela guia Usuários, validade de propostas e avisos de pendência

## Contexto e situação anterior

Homologação da NA-0186 (2026-11-23) no tenant local:

- Gestores do cofre ficam em `vault_managers`, preenchida só pelo `tools/vault-security/manage.mjs bootstrap` (exatamente 2). Cargo ADMIN/superadmin não dá poder no cofre (contrato NA-0177). Não há como incluir ou remover gestor pela tela.
- Com 2 gestores, nenhum deles pode receber permissão: o beneficiário não pode propor nem aprovar, e não sobra aprovador. A tela aceitava a proposta mesmo assim.
- Propostas vencem em 120 s fixos e não há aviso de pendência em lugar nenhum; o segundo gestor precisa estar com a tela aberta no mesmo minuto.
- Para quem não é gestor, a tela fica vazia sem explicação.

## Problema e objetivo

Tornar a administração do cofre utilizável sem afrouxar a regra de duas pessoas:

1. "Gestor do cofre" vira permissão do usuário na guia Usuários, concedida e removida pelo mesmo fluxo de dois gestores (decisão do responsável: opção A).
2. Validade da proposta configurável por tenant, de 2 min a 24 h (padrão 2 min), pelo fluxo de dois gestores.
3. Avisos de pendência para gestores (guia Usuários e tela do cofre), com contagem sem precisar desbloquear.
4. Recusa já na proposta quando a aprovação for impossível, com o motivo.
5. Mensagem explicativa para quem não é gestor.

## Escopo

Backend (`apps/backend/src/modules/vault-security`):
- `VaultChange`: `{kind:'manager', userId, enabled}` e `{kind:'proposalWindow', seconds}` (120–86400 s, minutos inteiros). `VaultPolicy.proposalSeconds?` validado em `assertPolicy`.
- Proposta: vence em `proposalSeconds` (padrão 120 s). Recusa `VAULT_NO_APPROVER` (409) quando não existe gestor ativo além do proponente e do beneficiário (grant e manager), na proposta e de novo na aprovação. Como sempre restam proponente e aprovador, o tenant mantém ao menos 2 gestores. Ninguém propõe mudança de gestor para si.
- Aprovação de `manager`: grava/atualiza `vault_managers` (inclusão exige usuário ativo do tenant); `proposalWindow` grava `config.proposalSeconds`; versão da política incrementa como em toda aprovação.
- `administration/status`: `{ manager, pending, managers }` — `pending` = propostas vivas que o gestor pode aprovar; `managers` = ids dos gestores (só para gestores).
- `administration/overview`: `users[].manager` e `policy.proposalSeconds`.
- Contrato `packages/shared` (`vault-administration.schema.ts`) e rotas zod.

Frontend:
- `VaultAdministration.vue`: coluna "Gestor do cofre"; bloco "Validade das propostas"; botão de proposta desabilitado com motivo quando não há aprovador possível ou a remoção violaria o mínimo; propostas de gestor e de validade aprováveis na tela; tempo restante legível (h/min); aviso de pendências antes de desbloquear; erros `noApprover`/`managerMinimum` explicados sem bloquear o cofre.
- `UsersView.vue`: etiqueta "Gestor do cofre"; faixa "N alterações do cofre aguardam sua aprovação" com "Revisar" (atualiza a cada 60 s); para admin não gestor, ação "Permissões do cofre" desabilitada com o motivo.
- `VaultView` (via `VaultAdministration`): nota curta para ADMIN que não é gestor.
- Locales pt-BR/en.

Testes:
- Unitários/componentes (vitest) e MySQL real (`vault.mysql.test.ts`) para as regras novas.
- Novo e2e Playwright HTTPS `npm run test:vault-administration:web` com rotas reais do cofre, `VaultService`, bcrypt/TOTP/JWE reais e três usuários sintéticos (dois gestores e um admin não gestor), com as regras da administração em memória (as regras SQL ficam no teste MySQL). Cobre fluxo completo, UX (estados, mensagens, foco/acessibilidade básica), poluição visual (sem avisos duplicados, sem rolagem horizontal em desktop/mobile, capturas) e ausência de erros no navegador.

Docs: `OPERATIONS-vault-security.md`, contrato NA-0177 (exceção registrada), manual (`docs/manual/hosts.md` e manifesto), catálogo da Central de Segurança se a revisão ficar desatualizada.

Fora de escopo: notificação global/push e e-mail; mudar o bootstrap; papel automático de gestor para ADMIN (opção C recusada por segurança).

## Critérios de aceitação

- [x] Gestor A propõe tornar C gestor; gestor B aprova; C passa a ser gestor (aparece a etiqueta e as opções do cofre).
- [x] A não consegue propor mudança de gestor para si; C não aprova a própria promoção.
- [x] Com só 2 gestores, a proposta de permissão para um deles é recusada pelo servidor (`VAULT_NO_APPROVER`) e o botão fica desabilitado com o motivo na tela.
- [x] Remover um gestor que deixaria menos de 2 é recusado na proposta e na aprovação (não há aprovador distinto).
- [x] Validade configurável de 2 min a 24 h (minutos inteiros) por dois gestores; a nova proposta vence no prazo configurado; valor inválido recusado.
- [x] Gestor vê a contagem de pendências que pode aprovar na guia Usuários e na tela do cofre sem desbloquear; não gestor não recebe contagem.
- [x] Admin que não é gestor vê a explicação, sem ações que falhariam.
- [x] Toda aprovação continua exigindo confirmação de identidade recente e incrementando a versão da política; ADMIN sem gestão continua sem poder no cofre.
- [x] E2E Playwright cobre os itens acima em desktop e mobile, sem erros no navegador e sem rolagem horizontal.

## Estratégia técnica

Regras no `SqlVaultAdministration` (transação com `FOR UPDATE/SHARE`, como as existentes); validade lida da política travada no `VaultAdministrationService.propose`. Contagem de pendências na mesma transação do `status` (sem sessão do cofre, limitada por `tx.limit`). Frontend calcula os aprovadores possíveis a partir de `users[].manager` só para orientar; o servidor decide.

## Riscos e mitigações

- Gestão de gestores pela tela amplia a superfície: mitigado por dois gestores distintos, proibição de autopromoção, mínimo de 2, prova recente de 60 s e auditoria `POLICY_CHANGE_PROPOSED/POLICY_CHANGED`.
- Propostas de até 24 h ficam abertas por mais tempo: escolha explícita do responsável; continuam exigindo segundo gestor com confirmação recente; padrão segue 2 min.
- Contagem sem desbloqueio revela só um número e ids de gestores a quem já é gestor.

## Matriz de testes e evidências

vitest `vault-security`, `packages/shared`, componentes/serviços/views do cofre e `UsersView`; MySQL real do cofre; `npm run test:vault-administration:web` (novo); `npm run test:vault:frontend`; `tsc`/`vue-tsc`; `lint:changed`; `manual:check-reviewed`; `security:scan`; revisão independente; `validate:sonar` depende dos tokens do responsável.

## Baseline

2026-11-23, em `518e88aa5`: vitest `vault-security` 265 PASS (41 opt-in skipped); portal (componentes do cofre, `vault-delivery`, `vault-manager`, `users-view`) 122 PASS.

## Rollback ou recuperação

Revert da PR. Sem migração de esquema: `proposalSeconds` em `config` é ignorado pelo código anterior (volta a 120 s); gestores incluídos pela tela permanecem em `vault_managers` e continuam válidos no código anterior (remover pelo banco se necessário).

## Mudanças de escopo e decisões

- 2026-11-23: decisões do responsável — opção A para gestores (dois gestores), validade por tenant de 2 min a 24 h, avisos de pendência, recusa de proposta impossível, mensagem para não gestor, e2e Playwright ampliado (fluxo, UX, poluição visual).
- 2026-11-23: opção C (admin promove sozinho) recusada: admin cria usuários e redefine senha/TOTP, então dominaria os dois papéis.
- 2026-11-23 (planejador): a regra de mínimo de 2 gestores (`VAULT_MANAGER_MINIMUM`) foi retirada por ser inalcançável — a exigência de aprovador distinto já impede ficar com menos de 2. Erro único `VAULT_NO_APPROVER`, que o portal explica sem bloquear o cofre.
- 2026-11-23 (revisão independente, PASS_WITH_WARNINGS, sem achado crítico/alto): corrigidos — lista de propostas sem as que a aprovação recusaria (proponente que deixou de ser gestor, conta desativada a receber/promover); retirar gestor apaga as propostas abertas dele; reduzir a validade encurta as abertas; trava `FOR UPDATE OF m` (só as linhas de gestor); desativar exige usuário do tenant; status desconhecido não mostra ação nem explicação e uma consulta falha mantém o último estado; teste MySQL de duas remoções simultâneas. Ressalvas aceitas: sem ação de retirar a própria proposta (vence sozinha; candidata a frente futura); desativar/excluir contas de gestores pela guia Usuários pode deixar menos de dois ativos (documentado no manual e em `OPERATIONS-vault-security.md`).
- 2026-11-23 (correções apontadas pelo e2e): etiquetas da tabela de usuários reativas (vale também para **Online**, NA-0187); tabela do cofre com largura mínima no celular; janela **Revisar** só com as propostas.

## Aprovação

Decisão: `GO_WITH_RISKS` — escopo aprovado pelo responsável em 2026-11-23 ("Opção A … Pode seguir fim a fim").
