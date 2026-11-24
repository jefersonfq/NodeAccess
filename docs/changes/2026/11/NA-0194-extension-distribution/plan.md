---
change_id: NA-0194
title: Extensão VaultNAccess E6 — distribuição pelo portal (ícones, pacote assinado, atualização por política)
type: feature
status: ready-for-review
created_at: 2026-11-23T17:20:00-03:00
base_branch: master
base_sha: fa757ac8200ac7f5058a6da04f9eac6e4186e049
branch: feature/NA-0194-20261123-extension-distribution
owner: Jeferson Quintana
planner: Claude Code
risk: medium
issue: null
---

# NA-0194 — Distribuição da extensão pelo portal (E6)

## Contexto e situação anterior

A extensão só é instalada compilando o código (`build:extension`, `build:extension:local`) e carregando a pasta sem compactação. Não há ícones, pacote, hash publicado, página de instalação nem atualização automática para outros usuários. Plano de evolução: E6 antes da E2.

## Problema e objetivo

Permitir que o operador da instalação gere um pacote oficial por implantação e que o portal o distribua: instalação manual (piloto) e instalação/atualização automática por política do Chrome/Edge.

## Escopo

- Ícones PNG 16/32/48/128 (escudo do popup, paleta do portal) no manifesto e na ação.
- `npm run package:extension` (`tools/vault-extension/package.mjs`): exige origem, versão e chave privada de assinatura (arquivo PEM fora do repositório); deriva a chave pública do manifesto e o ID; compila; gera ZIP reprodutível, CRX3 assinado, `update.xml` e `release.json` (versão, ID, SHA-256 do ZIP e do CRX, commit de origem); manifesto com `update_url` do portal. Sem segredo no pacote.
- Backend: `VAULT_EXTENSION_PACKAGE_DIR` (opcional). Publica só com a extensão habilitada, `release.json` válido, ID em `VAULT_EXTENSION_IDS`, versão ≥ mínima e hashes conferidos:
  - `GET /extension/package` (portal, autenticado): metadados para a página de instalação;
  - `GET /extension/update.xml`, `GET /extension/package.crx`, `GET /extension/package.zip` (públicos, consumidos pelo navegador/política; não contêm segredo).
- Portal: cartão **Instalar a extensão** no VaultNAccess (versão, ID, SHA-256, download, passo a passo Chrome/Edge); para administradores, o valor da política `ExtensionInstallForcelist` com botão de copiar e o aviso sobre máquinas gerenciadas.
- Docs: `OPERATIONS-vault-extension.md` (geração, guarda da chave, publicação, política), manual, plano de evolução.

Fora: Chrome Web Store; geração/guarda automática da chave pelo servidor; E2.

## Critérios de aceitação

- [x] O pacote gerado tem ícones, `key` e `update_url` corretos, ID igual ao derivado da chave e nenhum segredo; mesma entrada gera o mesmo ZIP.
- [x] O CRX3 é aceito pelo Chromium real (instalação a partir do arquivo) e o `update.xml` aponta para ele com a versão certa.
- [x] O servidor só publica pacote coerente com a configuração (ID autorizado, versão mínima, hashes) e não publica nada sem configuração.
- [x] A página de instalação mostra versão, ID, SHA-256, download e o passo a passo; a política só para administradores.

## Estratégia técnica

ZIP e CRX3 escritos com `node:zlib`/`node:crypto` (sem dependência nova): ZIP com entradas ordenadas e data fixa; CRX3 com cabeçalho protobuf mínimo (prova RSA-SHA256 e `crx_id`), conforme o formato público do Chromium. Backend lê e valida a pasta de release a cada requisição de metadados (pequena) e serve os arquivos com `Content-Type` próprios.

## Riscos e mitigações

- Chave privada de assinatura: fica com o operador, fora do repositório e do servidor de aplicação (só o pacote assinado é publicado); trocar a chave muda o ID.
- Arquivos públicos: não contêm segredo (origem do portal é pública); só são servidos com a extensão habilitada.
- No Windows/macOS, o Chrome só força instalação de extensão fora da loja em máquinas gerenciadas — documentado.

## Matriz de testes e evidências

`node --test` do empacotador (ZIP determinístico, CRX3 válido, ID); vitest do serviço/rotas de pacote e do cartão do portal; Chromium real carregando o CRX gerado; `test:extension:web`; `tsc`, `vue-tsc`, `typecheck:extension`, `lint:changed`, `security:scan`, `manual:check-reviewed`; `validate:sonar` depende dos tokens do responsável.

## Baseline

2026-11-23, `fa757ac82`: vitest `vault-security`, `apps/extension` e componentes do cofre 419 PASS (47 opt-in skipped).

## Rollback ou recuperação

Revert da PR; sem migração. Sem `VAULT_EXTENSION_PACKAGE_DIR`, nada é publicado.

## Mudanças de escopo e decisões

- 2026-11-23 (revisão independente, PASS_WITH_WARNINGS): `.gitignore` ancorado (`/release/`, para não ignorar `scripts/release/`); arquivos públicos com tamanho conferido antes da leitura e ETag; metadados do portal só com ZIP e CRX íntegros; `update.xml` gerado pelo servidor a partir do release conferido; limite de 64 KB para `release.json`; URLs do cartão comparadas exatamente.

## Correções necessárias fora do escopo

- 2026-11-23 (CI `sonar-real`, harness do cofre no navegador): em HTTP, a tela do cofre não pode chamar a API do cofre, mas o cartão de instalação consultava `/extension/package`. O cartão agora só consulta em contexto seguro (a extensão exige HTTPS).
  Ajuste seguinte (mesmo dia): o navegador trata `http://127.0.0.1` como contexto seguro, então o cartão passou a exigir também `https:` no endereço, como os demais componentes do cofre (harness `test:vault:frontend` reproduziu e confirmou).
  Capítulo `hosts` do manual revalidado (fonte mapeada mudou; procedimento sem alteração, pois o cartão já não servia em HTTP).

- 2026-11-23: `tacacs-tls.test.ts` (NA-0169) bloqueava o `sonar-real` de forma determinística em OpenSSL 3: o pacote em texto puro forma um cabeçalho TLS que anuncia 256 bytes, o servidor espera o resto até o tempo do handshake (5 s) e o teste estoura (5 s). O cliente agora fecha a escrita (`end`), o servidor recusa na hora e o teste continua exigindo que nada seja despachado. Sem mudança no servidor TACACS.
- 2026-11-23: `tacacs-health.test.ts` procurava o texto `999` no JSON inteiro, que também traz carimbos de hora em milissegundos (falha ocasional); agora procura os campos do outro tenant (`"requests":999`, `"p95Ms":900`).

## Aprovação

Decisão: `GO` — responsável aprovou E6 e E2 de ponta a ponta em 2026-11-23.
