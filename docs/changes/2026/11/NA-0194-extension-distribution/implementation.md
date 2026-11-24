# NA-0194 — Registro da implementação

Base: `fa757ac82` (ver `plan.md`). Branch: feature/NA-0194-20261123-extension-distribution.

## Pedido e objetivo

Fatia E6 do plano de evolução (distribuição), aprovada de ponta a ponta junto com a E2 em 2026-11-23.

## Implementação

- Ícones PNG 16/32/48/128 (escudo, paleta do portal) em `apps/extension/public/icons`, no manifesto e na ação; `update_url` opcional no manifesto (só o `update.xml` do próprio portal).
- `tools/vault-extension/package-format.mjs`: ZIP reprodutível, CRX3 (RSA-SHA256), ID a partir da chave, `update.xml`. `package.mjs` (`npm run package:extension`): valida entrada, compila em `dist-release`, confere o manifesto, recusa material de chave privada no pacote, grava ZIP/CRX/`update.xml`/`release.json`.
- Backend `ExtensionPackage` + rotas: metadados autenticados e arquivos públicos (HTTPS) só quando a extensão está habilitada, o `release.json` é válido, o ID está autorizado, a versão não é menor que a mínima e os hashes conferem; `VAULT_EXTENSION_PACKAGE_DIR`.
- Portal: `ExtensionInstall.vue` no VaultNAccess (versão, ID, SHA-256, download, passo a passo; política para administradores).
- Validação no navegador: `npm run test:extension-package:web` (Chromium carrega o pacote e atribui o ID do `release.json`).
- Docs: `OPERATIONS-vault-extension.md`, manual (+ fonte no manifesto), plano de evolução; encerramento da NA-0193; hashes revisados dos locales (linha sinalizada inalterada; conteúdo novo só depois da linha 6909).

## Validação

- Ran: `node --test` do empacotador 6 PASS (ZIP, CRX3 por leitor independente, ID); o mesmo leitor validou um CRX empacotado pelo próprio Chromium com a mesma chave e o ID coincidiu; `test:extension-package:web` 5 checks PASS; vitest `vault-security` 308 PASS; portal 1190 PASS; `test:extension:web` PASS; `tsc`, `vue-tsc`, `typecheck:extension`, `lint:changed`, `manual:check-reviewed`, `security:scan` PASS.
- Skipped: `validate:sonar` local (tokens do responsável); instalação por política real (exige máquina gerenciada).

## Recuperação

Revert da PR; sem migração. Sem `VAULT_EXTENSION_PACKAGE_DIR`, nada é publicado.

## Pendências

- Responsável: gerar a chave de assinatura e um pacote para homologar a página de instalação.

## Diário de interações

### 2026-11-23T17:55:00-03:00 — Implementação

Implementação e validação acima.

### 2026-11-23T18:20:00-03:00 — Revisão independente e ajustes

Revisão independente (subagente, somente leitura): PASS_WITH_WARNINGS — sem leitura fora da pasta, sem vazamento, sem publicação inconsistente; formatos CRX3/ZIP conferidos contra o do Chromium. Corrigidos o MEDIUM (`.gitignore` sem âncora ignorava `scripts/release/`) e os LOW (tamanho antes da leitura e ETag; metadados só com arquivos íntegros; `update.xml` gerado pelo servidor; limite do `release.json`; URLs exatas no cartão). Ran: vitest `vault-security` 308 PASS; cartão do portal PASS.
