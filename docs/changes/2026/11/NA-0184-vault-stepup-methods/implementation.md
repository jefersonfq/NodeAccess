# NA-0184 — Registro da implementação

Base: 8ef8188a6af1ee0b8180a9707ad54b54b8fd4002. Branch prevista: security/NA-0184-20261119-vault-stepup-methods.

## Pedido e objetivo

O cofre e a extensão devem depender só da permissão do usuário, não do método de login. Confirmação de identidade por método (local, LDAP, OIDC, Google), mesma barra de MFA, break-glass negado.

## Implementação

Fase 1 (local/LDAP e política por método):
- `vault-domain.ts`: `VaultAuthMethod`; a origem guarda o método assinado; a autorização traz `email`, `methods` e `passwordHash` opcional.
- `vault-identity.ts`: `vaultAuthMethod` aceita `local` sempre e `ldap`/`oidc`/`google` só com a flag; break-glass e valores desconhecidos negados. `MethodVaultReauthentication`: local = bcrypt + TOTP; LDAP = senha no diretório do mesmo usuário + TOTP; OIDC/Google negados até a fase 2.
- `vault.repository.ts`: TOTP continua obrigatório; o hash local só é exigido pelo adaptador local; métodos por tenant: local se login local ligado e SSO não obrigatório; LDAP se SSO não obrigatório; OIDC/Google sim.
- `vault.service.ts`: registro, uso e desbloqueio conferem o método contra a política atual do tenant; o desafio informa `stepUp` (`password_totp` ou `provider`).
- `env.ts` (`VAULT_STEP_UP_EXTERNAL_ENABLED`, padrão desligado) e `container.ts` (LDAP do login central).

Fase 2 (backend OIDC/Google):
- `oidc.service.ts`: `reauthenticate` adiciona `prompt=login` e `max_age=0`. `oidc-flow.service.ts`: fluxo `vault-step-up` com `binding` (digest do desafio); o login central recusa transação de confirmação e vice-versa; troca de código e validação de ID token reaproveitadas.
- `vault-provider.ts`: OIDC exige `auth_time` de até 5 min, identidade vinculada ao mesmo usuário e não revogada; MFA do provedor ou TOTP. Google exige token novo (`iat` até 5 min), `nonce` derivado do desafio, domínio do tenant e `googleId` já vinculado (sem vínculo por e-mail); TOTP sempre.
- `vault.service.ts`/`vault.routes.ts`: `sessions/provider/begin`, `sessions/provider/complete` (prova de uso único presa ao desafio; falha consome o desafio e audita `PROVIDER_PROOF_REJECTED`) e `sessions/unlock-provider`; registro e desafio informam `stepUp`.
- Retorno OIDC usa o mesmo redirect já cadastrado (`/auth/oidc/callback`); a finalidade gravada no fluxo separa login e confirmação.

Fase 2 (portal):
- `vault-delivery.ts`: `prepare()` registra o cliente ao abrir o diálogo para saber o tipo de confirmação; `unlockWithProvider()` faz desafio → início no provedor → prova → TOTP quando exigido → `unlock-provider`. O formulário de senha é recusado para sessões de provedor e vice-versa.
- `vault-provider-confirm.ts`: janela de confirmação OIDC com retorno por `BroadcastChannel` de mesma origem (funciona mesmo se o provedor cortar `window.opener` com COOP), sem gravar nada no navegador, limite de 5 min e cancelamento; botão Google (GIS) com `nonce`.
- `oidc.service.ts`: `state` das confirmações com prefixo `vsu.` (o ponto não existe em base64url); `OidcCallbackView` encaminha esses retornos e nunca conclui login com eles; o roteador deixa a página de retorno abrir mesmo com usuário logado na janela.
- `VaultDeliveryPanel.vue`: botão "Confirmar no provedor de login", campo de TOTP quando exigido e cancelamento. **Mudança de comportamento da NA-0179:** durante a espera pelo provedor (sem nenhum valor revelado), perder o foco ou ocultar a página não trava a sessão; saída da página, troca de tenant/identidade e o limite de 5 min continuam valendo. Fora dessa espera, a perda de foco trava como antes.
- Textos pt-BR/en; `OidcCallbackView` também teve a formatação do template ajustada pelo lint (sem mudança funcional).
- Harness real Keycloak (`tools/oidc/keycloak-certification.ts`) ganhou o cenário de confirmação: login, depois confirmação na mesma sessão do navegador, exigindo a tela de credenciais de novo, `auth_time` recente, vínculo com o desafio e separação de finalidade.

## Validação

Ran (Keycloak real, `npm run test:oidc:keycloak`): PASS com `vaultStepUpForcedLogin`, `vaultStepUpFreshAuthTime`, `vaultStepUpBindingEnforced`, `vaultStepUpPurposeSeparated`, além dos itens anteriores (PKCE, nonce, MFA delegado, replay). A primeira execução falhou porque o Keycloak não enviava `auth_time`: desde a versão 25 o claim vem do escopo `basic`, ausente no realm de teste; o realm passou a incluí-lo. **Operação:** provedores OIDC precisam emitir `auth_time` quando há `max_age`, como pede a especificação; sem ele o cofre nega a confirmação.

Ran (fase 2 portal): Vitest completo 4107 PASS/178 skipped, 0 falhas; typecheck e ESLint PASS. Testes novos: `prepare`, desbloqueio por janela e por Google, TOTP exigido/inválido, início desconhecido, formulário errado por método, janela (estado próprio, HTTPS, popup bloqueado, cancelamento, tempo), encaminhamento só de estados `vsu.`, painel (diálogo de provedor, foco tolerado só na espera, `pagehide` trava).

Ran (fase 2 backend): Vitest de `vault-security`, auth e cofre do frontend 552 PASS/33 skipped; typecheck e ESLint PASS (corrigido também um `async` sem `await` preexistente em `oidc.service.test.ts`, arquivo tocado). Testes novos: adaptador do provedor (OIDC e Google, positivos e 18 negativas), separação login × confirmação no fluxo OIDC, `prompt`/`max_age` só na reautenticação, prova de uso único, desafio consumido em falha, TOTP quando o provedor não comprova MFA, métodos locais sem fluxo de provedor.

Ran (fase 1): Vitest de `vault-security`, auth e cofre do frontend 474 PASS/33 skipped; ESLint dos arquivos alterados sem erros; typecheck do backend PASS. Testes novos: vínculo por método com e sem flag, break-glass/valores desconhecidos, LDAP (usuário diferente, senha inválida, diretório fora, política), OIDC/Google sem senha, política do tenant no registro e em cliente existente, derivação de métodos. Três casos antigos que esperavam negação total (sem hash local, login local desligado, SSO obrigatório) foram trocados por testes da derivação, que é o comportamento novo.

Ran (base): leitura de `vault-identity.ts`, `auth.service.ts` (`issueTokens` grava `refresh:<jti>` para todos os métodos; logout apaga), `oidc-flow.service.ts`, `oidc-auth.service.ts` (fallback ao TOTP quando o provedor não comprova MFA) e `ldap-identity.provider.ts`; harness Keycloak existente. Planned: testes da matriz do plano.

## Recuperação

Documental até a aprovação; depois flag `vault-step-up-external` e revert da PR.

## Pendências

Depois: baseline, implementação, Sonar, revisão independente.

## Diário de interações

### 2026-11-19T16:45:00-03:00 — Abertura

Responsável escolheu frente própria antes da E1 da extensão e negou break-glass no cofre. Plano escrito com adaptadores por método. Próximo: aprovação do responsável.

### 2026-11-19T17:00:00-03:00 — Plano aprovado

Responsável aprovou o plano; status `planned`. 

### 2026-11-19T17:40:00-03:00 — Base e fase 1

Planos aprovados; PR73 aberta com o plano da E1 e os encerramentos. Branch criada do master 8ef8188a6. Base registrada no plano. Fase 1 implementada e validada em unidade; `npm run test:vault:real` (MySQL/Redis reais) 32 PASS, limpeza confirmada. Próximo: fase 2 (reautenticação OIDC/Google), depois Sonar e revisão independente.

### 2026-11-19T18:40:00-03:00 — Fase 2 no backend

Responsável escolheu, para Google, novo token GIS ligado ao desafio + TOTP. Backend da fase 2 implementado; Vitest 552 PASS e `npm run test:vault:real` 32 PASS (limpeza confirmada). Portal e Keycloak concluídos depois (ver Implementação/Validação). Pendente: Sonar e revisão independente.

### 2026-11-19T20:10:00-03:00 — Portal e Keycloak

Portal da fase 2 implementado (janela de confirmação, Google, TOTP quando exigido, tolerância a perda de foco só durante a espera). Vitest completo 4107 PASS; Keycloak real PASS depois de incluir o escopo `basic` no realm de teste. Próximo: gate Sonar e revisão independente de segurança; depois push/PR.

### 2026-11-19T20:40:00-03:00 — Revisão independente e correções

Ran: revisão independente estática do intervalo 8ef8188a6..bc591536e: PASS_WITH_WARNINGS, sem desvio de autenticação; confirmou método vindo do token assinado, separação senha × provedor, separação login × confirmação, vínculo sem e-mail e consumo do desafio antes da decisão. Corrigido:
- (média) a flag só barrava registro novo: `RedisVaultOrigin.assert` agora nega em cada uso método externo com a flag desligada e origem sem método (clientes antigos, negados até novo registro).
- (baixa-média) `auth_time` precisa ser posterior ao início da confirmação (`startedAt` gravado no fluxo), além do limite de 5 min: provedor que ignore `prompt=login` não reaproveita o login original.
- (baixa) limite de 5 inícios de confirmação por 5 min por usuário.
- (baixa) falha de provedor ou prova inválida auditadas como `PROVIDER_PROOF_FAILED` (rótulo neutro; continua negando).
- Lacunas de teste cobertas: flag desligada com cliente existente, login anterior ao início, limite de inícios, esquema das rotas novas (prefixo de `state`, campos extras, TOTP inválido).
Aceito e registrado, sem mudança: Google prova "sessão Google no navegador + TOTP", sem forçar nova senha (decisão do responsável); o token Google da confirmação poderia ser reapresentado ao login Google enquanto válido, no mesmo navegador do usuário (impacto mínimo). Testes de unidade do cofre/auth 453 PASS (+ rotas 23 PASS); Keycloak real PASS; `npm run test:vault:real` 32 PASS.
