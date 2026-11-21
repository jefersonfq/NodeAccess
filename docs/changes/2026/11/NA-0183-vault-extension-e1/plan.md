---
change_id: NA-0183
title: Extensão VaultNAccess E1 — permissão por usuário, conexão segura e busca de metadados
type: feature
status: ready-for-tests
created_at: 2026-11-19T16:15:00-03:00
base_branch: master
base_sha: 8ef8188a6af1ee0b8180a9707ad54b54b8fd4002
branch: feature/NA-0183-20261119-vault-extension-e1
owner: Jeferson Quintana
planner: Claude Code
risk: high
issue: null
---

# NA-0183 — Extensão VaultNAccess, fatia E1

## Contexto e situação anterior

Programa aprovado na NA-0182 (`docs/changes/2026/11/NA-0182-vault-extension/plan.md`). Dependências integradas: NA-0176 (PR65), NA-0178 (PR68: sessões isoladas, unlock com senha+TOTP, operações cifradas), NA-0179 (PR69: revelar/copiar no portal). Estado do código em `apps/backend/src/modules/vault-security`:
- Cliente do cofre registrado com o refresh token do portal (`POST /vault/clients`); `RedisVaultOrigin.bind` liga o cliente à sessão central (`refresh:<jti>` no Redis), e cada uso confere essa sessão. Hoje só aceita `authMethod: local`; a NA-0184 (pré-requisito desta fatia) passa a aceitar local, LDAP, OIDC e Google com confirmação por método e nega break-glass.
- Concessões em `vault_entitlements` (ação `reveal`/`copy`, CHECK no banco), alteradas só por proposta de um gestor e aprovação de outro (`vault_managers`, separação garantida no banco).
- O portal monta o catálogo no navegador a partir de `/secrets` e `/pem-keys` com o JWT central (`apps/frontend/src/services/vault-catalog.ts`); não existe API de catálogo para outro cliente.
- Contrato NA-0177 §4: extensão é cliente público, código de uso único de 60 s com PKCE S256, redirect exato, autorização opaca de 30 min **sem refresh no piloto**, só em memória, ligada à sessão central que consentiu; prova de posse com protocolo mantido (candidato DPoP).

## Problema e objetivo

Entregar a primeira fatia utilizável e segura: um usuário **com permissão `extension`** conecta a extensão (Chrome/Edge) pela página de consentimento do portal, busca seus itens pessoais e compartilhados (só metadados) e abre o item ou o host no portal. Sem segredo trafegando para a extensão.

## Escopo

Backend:
1. Permissão `extension` em `vault_entitlements` (migração aditiva do CHECK), no mesmo fluxo de proposta/aprovação por dois gestores; ausência = negado.
2. Conexão da extensão: `POST /vault/extension/authorize` (portal autenticado; exige permissão `extension`, sessão central de qualquer método aceito, step-up do método via NA-0184, `code_challenge` S256, `state`, extension ID e redirect exatos da allowlist, chave pública do dispositivo) → código opaco de 60 s, uso único. `POST /vault/extension/token` (público; código + `code_verifier` + prova DPoP com a chave do dispositivo) → autorização opaca de 30 min limitada à sessão central de origem.
3. Dispositivo da extensão: PENDING → ACTIVE no consentimento; usuário revoga os próprios; revogação da permissão revoga clientes e dispositivos.
4. API só para o cliente extensão (DPoP + autorização opaca, rate limit): `GET /vault/extension/capabilities` (flags, versão mínima, tipos) e `GET /vault/extension/items?q=&kind=&cursor=` (projeção `VaultItemSummary` com `kind`, `sourceId`, rótulo, tipo, escopo pessoal/compartilhado, host associado; nunca valor). A listagem reutiliza a ACL dos serviços de Secrets e PEM, sem duplicar regra.
5. Em cada requisição: autorização válida, sessão central de origem viva, usuário/tenant ativos, `sessionVersion` igual, permissão `extension` ativa, dispositivo ACTIVE, prova DPoP válida (nonce, `htm`/`htu`, `jti` sem replay).
6. Auditoria: EXTENSION_AUTHORIZED, EXTENSION_DENIED, CLIENT_REGISTERED, DEVICE_REVOKED, sem tokens nem URLs completas.

Frontend do portal:
7. Página de consentimento `/vault/extension/connect` (mostra a extensão, o dispositivo e o tenant; step-up; Permitir/Negar) e tela "Meus dispositivos" com revogação.
8. Na administração do cofre, a permissão "Usar extensão" junto de revelar/copiar.

Extensão (`apps/extension`, novo workspace):
9. MV3 com portas e adaptadores (NA-0182): `core` sem API do navegador; adaptador Chromium (`identity.launchWebAuthFlow`, `storage.session`, `tabs`); cliente HTTP validado pelos esquemas de `packages/shared`; popup Vue com busca, filtro por tipo, recentes (só IDs na sessão) e abrir no portal.
10. Permissões: `identity`, `storage`, `activeTab` e host permission só da origem NodeAccess configurada. Sem content scripts, `externally_connectable` ou `web_accessible_resources`.
11. Chave de dispositivo ECDSA P-256 não exportável (WebCrypto) guardada no IndexedDB da extensão; autorização só em memória (`storage.session`). Expirou ou o worker reiniciou: nova conexão.

Fora: revelar/copiar (E2), cadastro (E3/E4), Windows Hello (E5), pacote piloto pelo portal (E6, aqui só build local), autofill (E7), Firefox. O método de login não restringe o uso: vale a permissão; a confirmação de identidade vem da NA-0184.

## Critérios de aceitação

- [ ] Usuário sem permissão `extension` não recebe código nem autorização (local, LDAP, OIDC, Google, tenant trocado); break-glass sempre negado; evento auditado.
- [ ] Usuário com permissão conecta a extensão com qualquer método aceito.
- [ ] Revogar a permissão, o dispositivo ou a sessão central de origem (logout) nega a próxima requisição da extensão.
- [ ] Código PKCE com state/verifier/redirect/extension ID errado, repetido ou expirado não gera autorização.
- [ ] Autorização usada sem prova DPoP válida, de outro dispositivo ou repetida é negada.
- [ ] Busca devolve apenas itens que a ACL permite ao usuário (pessoais e compartilhados), sem nenhum valor secreto, em teste com dois usuários e dois tenants.
- [ ] Nada reutilizável em `storage.local`/`sync`, logs ou URL após uso (inspeção E2E).
- [ ] Servidor exigindo versão mínima maior bloqueia a extensão.
- [ ] SSH/RDP, login, portal do cofre e revelar/copiar existentes sem regressão.
- [ ] Testes, `npm run validate:sonar`, revisão independente de segurança e checks remotos PASS.

## Estratégia técnica

1. Baseline: testes do módulo `vault-security`, do auth e do VaultView; `validate:sonar` na base.
2. Contratos em `packages/shared/src/vault/extension.ts` (Zod) primeiro, depois o backend com testes de domínio e MySQL/Redis reais (padrão `vault.mysql.test.ts`).
3. DPoP: verificar JWS com `jose` (já dependência do backend), sem criptografia própria; nonce do servidor; `jti` com TTL no Redis.
4. Itens: novo `VaultCatalogService` que chama os serviços existentes com a identidade resolvida pela autorização da extensão, sem novas consultas paralelas de ACL.
5. Extensão: Vite com build reproduzível, sem dependências além de Vue/Zod; testes do `core` com Vitest; E2E Playwright com Chromium carregando a extensão desempacotada.
6. Flag `vault-extension` no servidor (desligada por padrão), separada de `vault-reveal`/`vault-copy`.

## Riscos e mitigações

- Superfície nova de autenticação: tudo atrás de flag, permissão negada por padrão, revisão independente focada em OAuth/PKCE/DPoP antes do merge.
- Divergência de ACL entre portal e extensão: a extensão reutiliza os mesmos serviços; teste de equivalência portal × extensão com os mesmos usuários.
- Redirect da extensão: allowlist exata `https://<extension-id>.chromiumapp.org/` por canal, configurada no servidor.
- Dependências do build da extensão (cadeia de suprimentos): lockfile, Grype e Sonar no novo workspace.

## Matriz de testes e evidências

Unitários do domínio e `core` da extensão; integração Fastify + MySQL + Redis reais para autorização, troca de código, DPoP, revogação e listagem; E2E com a extensão carregada (conectar, buscar, abrir, revogar). Cenários SEC-02/06/13/18 do contrato e EXT-01..06, 15, 16 da NA-0182. Regressão: `vault-security`, auth, VaultView e `npm run test:terminal-experience:web` se o layout do portal for tocado. `npm run validate:sonar` e revisão independente.

## Baseline

Registrada em 2026-11-20 sobre o master `b4e8cccab` (branch em `f15da8517`, só documentos acima da base):
- Ran: `vitest run` de `apps/backend/src/modules/vault-security`, `apps/backend/src/modules/auth` e `apps/frontend/src/views/vault-views.test.ts`: 36 arquivos, 471 PASS / 0 FAIL (33 skipped, reais opt-in).
- Ran: `npm run test:vault:real` (MySQL + Redis reais): 32 PASS / 0 FAIL.
- Ran: `npm run test:vault:frontend` (Chromium HTTPS): PASS (como root exige `PLAYWRIGHT_BROWSERS_PATH=/home/jeferson/.cache/ms-playwright`).
- Sonar: `npm run validate:sonar` PASS em `723b80dc0` (NA-0184; 4164 testes, gate OK, 0 achados inesperados). Diff de `apps/ packages/ tools/ scripts/` entre `723b80dc0` e `b4e8cccab` vazio, então vale como baseline. Nova execução exige Node 24 e os tokens digitados pelo responsável; fica para o candidato da E1.

## Rollback ou recuperação

Flag `vault-extension` desligada nega autorizações e invalida clientes da extensão. Migração só acrescenta o valor `extension` ao CHECK; o revert remove linhas `extension` antes de restaurar o CHECK. Extensão não publicada; remover o pacote local basta.

## Mudanças de escopo e decisões

2026-11-19: uso da extensão depende só da permissão, não do método de login (decisão do responsável); confirmação por método na NA-0184, pré-requisito; break-glass negado.

2026-11-19: o contrato NA-0177 prevalece sobre a NA-0182 na renovação: no piloto não há refresh, e a autorização vence em 30 min (o plano da NA-0182 citava refresh vinculado à chave).

2026-11-20 (implementação, sem mudar o escopo aprovado):
- Armazenamento próprio (`vault_extension_devices`, `vault_extension_tokens`), porque as rotas públicas da extensão não conhecem o usuário antes de localizar o token; `vault_records` exige identidade. Só o hash dos tokens é guardado.
- O step-up do consentimento reutiliza a sessão desbloqueada do portal com prova < 60 s (`VaultService.confirmed`, o mesmo critério da administração).
- O dispositivo nasce ACTIVE no consentimento: o estado PENDING existe só na página, sem registro no servidor.
- Toda mudança de política aprovada invalida as autorizações em uso (mesma regra das sessões do cofre).
- `Origin` é obrigatório no POST `/token` e opcional nos GET, porque o Chromium não o envia em GET de extensão com host permission (achado do ensaio em Chromium real). Quando presente, precisa ser uma extensão permitida.
- `apps/extension` sem `package.json`: usa `vite`, `vue` e `zod` da raiz; nenhuma dependência nova e nenhuma alteração do lockfile. Manifest sem `activeTab`, que não é necessário.
- Item 8 (permissão "Usar extensão" na administração): o portal não tem tela de concessões; a permissão entra na mesma API de administração de revelar/copiar.
- E2E: o ensaio automatizado roda a extensão desempacotada em Chromium com `launchWebAuthFlow` real contra um portal simulado em HTTPS local. O fluxo com o backend real no navegador fica para a homologação.

2026-11-21 (mudança de escopo, decisão do responsável): tela mínima de permissões do cofre no portal (opção "a"), porque sem ela a permissão "Usar extensão" só existia pela API e o segundo gestor não tinha como descobrir a proposta a aprovar (o servidor guarda só o hash).
- Seção no VaultNAccess visível só para gestores do cofre: lista os usuários do tenant com revelar/copiar/extensão, propõe ativar ou retirar e lista as propostas pendentes para outro gestor aprovar.
- Mesmas regras já testadas: dois gestores distintos, beneficiário nunca participa, confirmação de identidade < 60 s por ação, proposta vale 2 min, toda aprovação incrementa a versão da política e bloqueia as sessões do cofre.
- Servidor: leitura `administration/status` (é gestor?) e `administration/overview` (com confirmação); aprovação aceita também a referência da proposta (o hash já guardado), sem expor nem guardar o identificador original; auditoria correlaciona proposta e aprovação pelo mesmo hash.
- Sem tela para política (`policy`) e itens web (`item`); aparecem na lista sem **Aprovar** e continuam pela API, para que nenhum gestor aprove sem ver o conteúdo.
- Decisão (revisão independente, INFO-1): o hash da proposta passa a valer como referência de aprovação. Qualquer outro gestor ativo do tenant, com confirmação < 60 s, pode aprovar; deixa de existir "o proponente escolhe quem aprova". Não amplia privilégio: continuam valendo gestor ativo, mesmo tenant, proponente e beneficiário excluídos e validade de 2 min.
- Minimização (INFO-2): a lista mostra nome e e-mail (para distinguir homônimos) só a gestores, com confirmação, sem cache e só na memória da página até o bloqueio.
- O cliente do cofre só é registrado quando o gestor abre a seção (**Administrar permissões**), para não consumir a cota horária de clientes a cada visita.

2026-11-21 (homologação local, decisão do responsável): modo HTTPS opcional no servidor de desenvolvimento do portal (`apps/frontend/vite.config.ts`), ligado só com `NODEACCESS_DEV_HTTPS_CERT`/`NODEACCESS_DEV_HTTPS_KEY`; o proxy envia `x-forwarded-proto`/`x-forwarded-host` para o servidor com `TRUST_PROXY=true`. Sem as variáveis, nada muda. Não afeta build nem produção.

## Aprovação

Decisão: `GO_WITH_RISKS`

Aprovado pelo responsável em 2026-11-19. Risco: autenticação nova (mitigada por flag, permissão negada por padrão e revisão independente). Começa após a NA-0184 integrada.
