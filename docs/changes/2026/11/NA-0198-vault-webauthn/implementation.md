# NA-0198 — Registro da implementação

Base: `8264e7325` (master após NA-0194/0195/0196/0197). Branch: security/NA-0198-20261124-vault-webauthn.

## Pedido e objetivo

Fatia E5 do plano de evolução (Windows Hello / chave de acesso). Decisões do responsável em 2026-11-24: portal primeiro (E5a; extensão depois), `@simplewebauthn/server` como biblioteca, origem de desenvolvimento `https://localhost:5173`.

## Implementação

- Backend: tabela `vault_webauthn_credentials` (migração aditiva); `SimpleWebauthnVerifier` (porta `WebauthnVerifier`); o desafio do cofre passa a trazer opções WebAuthn quando o usuário tem credencial e a origem é um nome; `POST /sessions/unlock-webauthn` consome o desafio antes de verificar (origem, RP ID, assinatura, UV, contador pela biblioteca) e abre a sessão pelo mesmo `openSession`; `VaultWebauthnService` cadastra/remove com sessão confirmada há menos de 60 s e lista sem chaves; auditoria; limite de 10 credenciais; `manage.mjs origin`.
- Portal: botão **Usar Windows Hello / chave de acesso** nas confirmações de revelar/copiar e das permissões dos gestores, com senha + código abaixo; janela **Windows Hello e chaves de acesso** (cadastrar, listar, remover, com confirmação na própria janela, inclusive por provedor OIDC/Google); API nativa do navegador.
- Docs: contrato NA-0177 (E5a), `OPERATIONS-vault-security.md` (origem, certificado confiável, rotas), manual (`hosts`).

## Validação

- Ran: vitest vault-security + portal + shared 1542 PASS; `test:vault:real` 48 PASS (migração, credenciais com escopo, troca de origem pelo CLI); `test:vault-administration:web` 14 cenários PASS (cadastro, desbloqueio com Hello, recusa sem verificação do usuário, remoção, celular) com autenticador virtual do Chromium e o verificador real; `node --test tools/vault-security` 10 PASS; `tsc`, `vue-tsc`, `lint:changed`, `security:scan` (hashes revisados atualizados), `manual:check-reviewed` PASS.
- Ran: revisão independente de segurança (subagente): PASS_WITH_WARNINGS; MEDIUM (troca de senha/MFA não aposentava chaves; faltavam testes com criptografia real) e LOW corrigidos.
- Skipped: `validate:sonar` local (tokens do responsável); Windows Hello real (homologação do responsável).

## Recuperação

Revert da PR; a migração só cria a tabela nova (versões anteriores não a usam). Remover dispositivos desfaz o cadastro; senha + código continuam.

## Pendências

- Homologação: trocar a origem do tenant para `https://localhost:5173` (`manage.mjs origin`), certificado confiável para `localhost`, cadastrar o Windows Hello e destravar o cofre com ele.
- E5b (extensão com Windows Hello por aba do portal, SEC-16).

## Diário de interações

### 2026-11-24T03:00:00-03:00 — Implementação e simulação

Implementação, testes e simulação acima; a simulação revelou que a oferta do Hello sumia após uma recusa (corrigido).
