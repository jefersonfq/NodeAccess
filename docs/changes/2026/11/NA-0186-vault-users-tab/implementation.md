# NA-0186 — Registro da implementação

Base: 7c973fce81737b48b321c7e50555c4fb5ef255dc. Branch: feature/NA-0186-20261122-vault-users-tab.

## Pedido e objetivo

Conceder e aprovar as permissões do cofre pela guia Usuários e permitir que o tenant defina por quanto tempo uma confirmação de identidade libera revelar/copiar (pedido do responsável na homologação da NA-0183).

## Implementação

- Servidor (`apps/backend/src/modules/vault-security`): mudança de administração `confirmation` (60–900 s) na rota, no repositório (proposta e aprovação) e em `assertPolicy`; `grantDeadline` recebe a janela da prova, usada só em `request`/`consume`; o desbloqueio devolve `proofUntil`; `confirmed` (administração, consentimento da extensão) mantém 60 s; `overview` devolve `policy.confirmationSeconds`. Sem migração: o valor fica em `vault_policies.config`.
- Contrato compartilhado: `VaultAdministrationChangeSchema` com `confirmation` e `policy` no resumo.
- Portal: `services/vault-manager.ts` (identidade e "é gestor?", reaproveitados pela seção); `VaultAdministration.vue` com foco por usuário (`userId`) e bloco do tempo de confirmação; `vault-delivery.ts` com prazo do tenant para revelar/copiar, 60 s para administração e extensão e renovação da inatividade; `UsersView.vue` com a ação **Permissões do cofre** só para gestores, abrindo a seção focada numa janela. Erros de lint antigos do `UsersView.vue` corrigidos (promessas sem `void`, `async` sem `await`), sem mudar o comportamento.
- Documentos: manual `hosts.md` (guia Usuários e tempo de confirmação; `UsersView.vue` e `vault-manager.ts` passam a fazer parte das fontes do capítulo), exceção registrada no contrato NA-0177, encerramento da NA-0183.

## Validação

Ver o diário (execuções reais).

## Recuperação

Revert da PR. Valor gravado em `config` é ignorado pelo código anterior (volta a 60 s).

## Pendências

- `npm run validate:sonar` local: exige Node 24 e os tokens do responsável.
- Homologação pelo responsável: abrir **Permissões do cofre** na guia Usuários, propor com um gestor e aprovar com outro; propor 5 min, aprovar e revelar duas vezes sem nova confirmação dentro do tempo.
- Roadmap 2027: sem ferramenta de edição da planilha.

## Diário de interações

### 2026-11-22T22:30:00-03:00 — Implementação de ponta a ponta

Pedido: "Vamos de NA-0186 fim a fim" (e incluir a NA-0187 em seguida). Plano escrito com `GO_WITH_RISKS`; decisões do planejador: máximo de 15 min, só revelar/copiar, mudança pelo fluxo de dois gestores.
Ran (baseline em `7c973fce8`): vitest `vault-security`, componentes do cofre e views admin: 389 PASS.
Ran (candidato): vitest `vault-security` 262 PASS (40 skipped, reais opt-in); componentes do cofre e serviços do portal 111 PASS; `test:vault:real` 40 PASS (1 novo); `test:vault:frontend` PASS; `tsc` backend e `vue-tsc` frontend PASS; `lint:changed` 0 erros; `manual:check-reviewed`, `manual:validate` e `test:manual` PASS; `security:scan` PASS (hashes dos locales em `security/gitleaks-fixtures.json` atualizados; linhas sinalizadas inalteradas).

### 2026-11-22T23:20:00-03:00 — Revisão independente e correção

Revisão independente de segurança (subagente, somente leitura): FAIL na primeira rodada, sem falha de segurança. O portal ainda bloqueava aos 60 s, então o tempo do tenant não chegava ao usuário (HIGH de funcionamento); LOW: frações de minuto e um comentário. Corrigido: `proofUntil` no desbloqueio, prazos separados no portal (tenant para revelar/copiar, 60 s para administração e extensão), renovação da inatividade espelhando o servidor, só minutos inteiros em rota, contrato compartilhado e política. Segunda rodada: PASS_WITH_WARNINGS; ressalva aceita registrada no `plan.md`.
Ran (após a correção): vitest `vault-security`, serviços e componentes do cofre 1118 PASS; `tsc` e `vue-tsc` PASS; `lint:changed` 0 erros; `test:vault:real` 40 PASS; `test:vault:frontend` PASS; `test:extension:web` 12/12 PASS; `security:scan` PASS; `manual:check-reviewed` e `test:manual` PASS (hash do capítulo hosts renovado).
Skipped: `validate:sonar` (Node 24 e tokens do responsável).

### 2026-11-23T00:10:00-03:00 — PR77 e ajustes pedidos pela CI

PR77 aberta. A CI reprovou `change-governance` (corpo da PR sem as seções do modelo) e `static-quality` (`lint:changed` aceita zero avisos; o `UsersView.vue` tinha 111 avisos antigos). Corrigido: corpo no modelo do projeto; avisos resolvidos com `eslint --fix` (formatação do template) e tipos de retorno explícitos, sem mudança de comportamento; hash do capítulo `hosts` renovado. Ran: `lint:changed` 0 problemas; `vue-tsc` PASS; vitest views + componentes do cofre 198 PASS; `manual:check-reviewed` PASS.

### 2026-11-23T01:20:00-03:00 — Cobertura de código novo (sonar-real)

`sonar-real` reprovou: cobertura do código novo 55,8% (< 80%; linhas + condições), porque o `UsersView.vue` não tinha teste e as linhas alteradas (tipos, ação nova, template) contavam sem cobertura. Novo `views/admin/users-view.test.ts` (carga, opções e roteamento das ações, colunas, modais, erros e manipuladores do template). Medição local com o mesmo critério (linhas + condições alteradas desde `7c973fce8`): 224/265 = 84,5%. Ran: vitest cofre/serviços/views 1205 PASS; `vue-tsc` PASS; `lint:changed` 0 problemas.

### 2026-11-23T02:50:00-03:00 — Merge e encerramento

PR77 mergeada em `master` (`abdcc1b5e`, 2026-11-23) com os 12 checks remotos verdes; o `sonar-real` falhou uma vez só pelo teste instável `tacacs-tls.test.ts` (tempo esgotado, falha também no `master` local) e passou na reexecução (gate OK, cobertura nova 85,1%). `master` local sincronizado. Status `closed`. Seguem: homologação pelo responsável (roteiro em Pendências) e `validate:sonar` local (tokens do responsável). Encerramento registrado na branch da NA-0187.
