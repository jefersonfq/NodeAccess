# NA-0183 — Registro da implementação

Base: 8ef8188a6af1ee0b8180a9707ad54b54b8fd4002. Branch: feature/NA-0183-20261119-vault-extension-e1.

## Pedido e objetivo

Primeira fatia (E1) da extensão VaultNAccess aprovada na NA-0182: permissão `extension` por usuário, conexão segura (PKCE + DPoP, sem refresh no piloto), busca de metadados de itens pessoais e compartilhados e abertura no portal.

## Implementação

Backend (`apps/backend/src/modules/vault-security`): migração aditiva `20261120150000_vault_extension` (grant `extension` no CHECK; `vault_extension_devices`, `vault_extension_tokens` só com hash), `vault-extension-domain/dpop/repository/service/routes`, `VaultService.confirmed` (step-up < 60 s reutilizado pela administração), revogação de dispositivos e autorizações ao retirar a permissão, flag `VAULT_EXTENSION_ENABLED` (desligada), `VAULT_EXTENSION_IDS`, `VAULT_EXTENSION_MIN_VERSION`. Contratos em `packages/shared/src/schemas/vault-extension.schema.ts`.
Portal: `/vault/extension/connect` (`ExtensionConnectView`, `vault-extension-consent`, `authorizeExtension` em `vault-delivery`), seção de dispositivos com revogação (`ExtensionDevices`, só em HTTPS), foco do item aberto pela extensão em `/vault?kind=&id=`, textos pt-BR/en.
Extensão (`apps/extension`, sem `package.json` próprio): `core` sem API do navegador (WebCrypto, PKCE, DPoP, cliente validado por Zod), adaptador Chromium, service worker, popup Vue, manifest mínimo, build reproduzível (`build:extension`), smoke `test:extension:web`. Lint, `lint:changed`, Sonar e cobertura passam a incluir `apps/extension/src`.
Docs: `docs/OPERATIONS-vault-extension.md`, capítulo hosts do manual, decisões no `plan.md`.

## Validação

Execução final em 2026-11-20 sobre a árvore do commit de revisão (backend, portal e extensão):
- Ran: `lint:changed` PASS (inclui 12 arquivos da extensão); `tsc` backend, `vue-tsc` frontend e extensão PASS.
- Ran: `vitest run` completo 4211 PASS / 1 FAIL / 184 skipped; a falha é `tacacs-tls.test.ts` (timeout), reproduzida no master sem alterações.
- Ran: `test:vault:real` 38 PASS (32 do cofre + 6 da extensão, sobre as duas migrações); `test:vault:frontend` PASS; `test:extension:web` 12/12 PASS (Chromium, `launchWebAuthFlow` real, portal simulado em HTTPS local); `security:scan` PASS; `test:manual` e `manual:check-reviewed` PASS; `change-governance` local PASS.
- Ran: revisão independente de segurança (subagente): APROVADO COM AJUSTES, ajustes aplicados.
- Skipped: `validate:sonar` (Node 24 e tokens do responsável); fluxo com backend real no navegador (homologação); `test:terminal-experience:web` (terminal não tocado).

PR75 (2026-11-20/21), checks remotos sobre `52b7dc4e4` (merge com o master `da0eba7ed`): 17 PASS, 1 skipped (`publish-windows-release`). `sonar-real` com SonarQube efêmero: Quality Gate OK, cobertura de código novo 87,1% (≥ 80%), duplicação 0,48%, 0 violações novas, 0 hotspots.
Antes disso a CI acusou, e foi corrigido:
- contrato estrito do scanner fixava a lista de `tsconfigPaths` sem a extensão (`bbfb2c397`);
- cobertura de código novo 65,1%: smoke da extensão registrado como harness `vault-extension` (`node-only`) e testes unitários do adaptador Chromium, service worker, repositório SQL e página de consentimento; local `test:coverage --base b4e8cccab` 87,5% (`1c635b646`);
- análise da base abortava porque o master não tem `apps/extension`: a CI cria só no worktree descartável da base as raízes/tsconfig novos (contenção verificada antes de criar; registrado em `scannerConfiguration.baseBootstrapped`) (`1c635b646`);
- 4 violações novas (S7773, S8786, S4036, S2871) corrigidas no código, sem baseline, e lint dos testes novos (`52b7dc4e4`).
- Ran local após as correções: `lint:changed`, tsc x3, vitest extensão + vault-security + componentes do cofre 333 PASS, `test:sonar` 255/255, `test:extension:web` 12/12, `security:scan` PASS. Em `tools/coverage`, `preflight.test.mjs` (readonly-cache) falha só ao rodar como root; arquivo inalterado e PASS na CI.

## Recuperação

`VAULT_EXTENSION_ENABLED=false` corta tudo de imediato. Desfazer a migração: remover linhas `extension` de `vault_entitlements`, apagar as duas tabelas novas e restaurar o CHECK (`docs/OPERATIONS-vault-extension.md`). Revert dos commits da frente.

## Pendências

- `npm run validate:sonar` local no candidato: exige Node 24 e os tokens digitados pelo responsável (bloqueio, não aprovação; o `sonar-real` da CI não o substitui).
- Homologação com o backend real no navegador: roteiro em `homologation.md`; o ensaio automatizado usa portal simulado.
- Planilha: META-005 (NA-0184 entregue) e META-017 (E1) sem ferramenta de `.xlsx` no ambiente; uma escrita única quando houver.
- Merge da PR75 após Sonar local e homologação, com autorização do responsável.
- Fora da frente: `tacacs-tls.test.ts` (timeout) falha também no master sem alterações; `npm run lint` completo estoura memória do V8 localmente (o gate da CI é `lint:changed`, PASS).

## Diário de interações

### 2026-11-19T16:15:00-03:00 — Encerramentos e plano da E1

Responsável pediu para atualizar os registros das dependências e iniciar a E1. PR65/68/69 confirmadas como mergeadas; os registros passaram a `closed`. A pendência da NA-0176 (PR61/62) é de frentes antigas fora do escopo, ainda acompanhadas na META-050. Plano da E1 escrito; corrigida a divergência com o contrato (sem refresh no piloto). Limitação encontrada: o cofre só aceita sessão central local, então SSO fica fora da E1. Próximo: aprovação do plano.

### 2026-11-19T16:45:00-03:00 — Método de login não restringe o uso

Responsável definiu que o uso da extensão depende só da permissão, não do método de login; escolheu tratar a confirmação por método em frente própria antes da E1 (NA-0184) e negar break-glass. Ran: leitura de `auth.service.ts` (refresh e logout iguais para todos os métodos), `oidc-flow.service.ts`, `oidc-auth.service.ts` e `ldap-identity.provider.ts`. Plano da E1 ajustado; SSO deixa de ficar fora. Roadmap numa escrita (META-005, META-017, revisão 37; hash 860933136265 → fe77a79275a6). Próximo: aprovação dos planos NA-0184 e NA-0183.

### 2026-11-19T17:00:00-03:00 — Plano aprovado

Responsável aprovou o plano; status `planned`. Começa após a NA-0184 integrada.

### 2026-11-20T15:00:00-03:00 — Início da implementação

NA-0184 mergeada (PR74) e encerrada. Branch avançada por fast-forward até o master `b4e8cccab`; status `in-development`. Roadmap pendente (sem ferramenta de `.xlsx`; decisão do responsável). Próximo: baseline (testes de `vault-security`, auth e VaultView; `validate:sonar` na base).

### 2026-11-20T17:40:00-03:00 — Implementação fim a fim da E1

Pedido: seguir a frente fim a fim. Backend, portal e extensão implementados em commits separados (`ee4620d5e`, `ec6e055c1`, `de461d295`, `67cb7832d` e o commit desta entrada). O ensaio em Chromium real mostrou que o Chromium não envia `Origin` nos GET da extensão; corrigido no backend (obrigatório no POST, opcional e validado no GET). Revisão independente de segurança (subagente, somente leitura): APROVADO COM AJUSTES, sem achados críticos/altos/médios; aplicados: código do dispositivo exibido na extensão e conferido no portal, dispositivo ativado só na troca concluída, sessão do cofre encerrada no servidor após o consentimento, limpeza de tokens expirados, hash de auditoria com domínio separado. INFO mantidos como decisão: GET sem `Origin`, reativação de dispositivo revogado por novo consentimento com step-up, código queimado em tentativa inválida.
Também: HTTPS exigido na lista de dispositivos (o harness `test:vault:frontend` acusou requisição em HTTP); hashes dos falsos positivos revisados em `security/gitleaks-fixtures.json` atualizados para os locales e o harness MySQL (linhas revisadas inalteradas).
Validações: ver a seção Validação (execução final sobre o SHA do commit).

### 2026-11-21T00:30:00-03:00 — PR75 e correções apontadas pela CI

Responsável autorizou push, PR e Sonar. PR75 aberta; a CI falhou em `static-quality` e `sonar-real` três vezes, e cada causa foi corrigida (ver Validação): contrato do scanner, cobertura de código novo, análise da base sem `apps/extension` e 4 violações novas. Checks remotos todos PASS em `52b7dc4e4`. `validate:sonar` local não executado: depende dos tokens do responsável. Roteiro de homologação escrito em `homologation.md`. Próximo: Sonar local e homologação pelo responsável; depois, merge com autorização.

### 2026-11-21T05:35:00-03:00 — Idioma do popup e migração local

Pedido: popup da extensão em português (Brasil) e aplicar a migração. O popup passa a usar sempre pt-BR, como o portal, independentemente do idioma do navegador (o dicionário en permanece no código); teste novo cobre navegador em inglês. Banco local de desenvolvimento (`sshplatform`): backup antes (`mysqldump`, fora do Git em `.tmp/`), `prisma migrate deploy` aplicou `20261116030000_add_vault_security` e `20261120150000_vault_extension`; `migrate status` sem pendências; tabelas `vault_extension_*` e o CHECK com `extension` conferidos. Ran: vitest da extensão 27 PASS, `lint:changed`, typecheck da extensão, `test:extension:web` 12/12, `test:manual` PASS. Próximo: `validate:sonar` local com os tokens do responsável e homologação.

### 2026-11-21T07:10:00-03:00 — Tela de permissões do cofre (mudança de escopo "a")

Pedido: o responsável não encontrou onde conceder a permissão nem onde baixar a extensão; escolheu a tela mínima no portal (opção "a"). Feito: seção **Permissões do cofre (gestores)** em VaultNAccess (só para gestores, aberta por **Administrar permissões**), com revelar/copiar/extensão por usuário, propostas pendentes e aprovação por outro gestor; servidor com `administration/status`, `administration/overview` (confirmação < 60 s) e aprovação pela referência guardada (hash), com auditoria correlacionada. Lógica do provedor extraída para `useVaultProviderStepUp`, usada também pela página de consentimento. Revisão independente de segurança (subagente, somente leitura): APROVADO COM AJUSTES, sem bypass, vazamento entre tenants ou injeção; aplicados: **Aprovar** só para propostas de permissão (política/item seguem pela API), cliente do cofre registrado só ao abrir a seção (cota horária), nome e e-mail do beneficiário na proposta; INFO-1 (hash como referência) e INFO-2 (e-mails só a gestores) registrados no `plan.md`.
Ran: vitest vault-security + componentes do cofre + delivery 356 PASS; vitest backend/frontend/extensão/shared 1435 PASS; `test:vault:real` 39 PASS (1 novo com MySQL real); `test:vault:frontend` PASS; `lint:changed`, `tsc`, `vue-tsc` PASS; `test:manual`, `manual:check-reviewed` PASS; `security:scan` PASS (hashes dos falsos positivos revisados dos locales atualizados, linhas inalteradas).
Encontrado: o portal local do responsável roda em `http://127.0.0.1:5173`, e o cofre e a extensão exigem HTTPS; a homologação local precisa de modo HTTPS (pendente de decisão). CI `upgrade-restore` reprovou em `41fd3ca0e` por vulnerabilidades novas nas imagens (fora do código da frente). Próximo: HTTPS local, Sonar local, homologação.
