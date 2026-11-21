# Operação — extensão VaultNAccess (piloto, fatia E1)

Change: NA-0183. Plano: `docs/changes/2026/11/NA-0183-vault-extension-e1/plan.md`. Contrato: NA-0177 §4.

## O que a E1 entrega

Extensão MV3 para Chrome/Edge que conecta ao portal, busca **metadados** (nome, tipo, escopo pessoal ou compartilhado) dos Secrets e chaves PEM que o usuário já vê no portal e abre o item no NodeAccess. Nenhum valor, senha, chave ou passphrase é enviado à extensão. Revelar/copiar (E2), cadastro (E3/E4), Windows Hello (E5), pacote pelo portal (E6) e preenchimento automático (E7) ficam fora.

## Pré-requisitos

- Cofre já operacional para o tenant (HTTPS, política `vault_policies`, licença Secrets, TOTP do usuário). Para contas LDAP/OIDC/Google, `VAULT_STEP_UP_EXTERNAL_ENABLED=true` (NA-0184).
- Backend com a migração `20261120150000_vault_extension` aplicada (aditiva).

## Configuração do servidor

| Variável | Padrão | Uso |
|---|---|---|
| `VAULT_EXTENSION_ENABLED` | `false` | Liga todas as rotas `/api/v1/vault-security/extension/*`. Desligado: respondem 404 e autorizações existentes deixam de valer. |
| `VAULT_EXTENSION_IDS` | vazio | IDs Chromium permitidos (32 letras a–p), separados por vírgula. O redirect aceito é sempre `https://<id>.chromiumapp.org/`. |
| `VAULT_EXTENSION_MIN_VERSION` | `0.1.0` | Versão mínima da extensão (`X-Extension-Version`); abaixo dela a API responde 426. |

O nonce DPoP é derivado do `JWT_SECRET`; o `jti` de cada prova é guardado no Redis por ~2 minutos (`vault-ext-dpop:*`).

## Gerar e carregar a extensão (piloto)

```bash
VAULTNACCESS_PORTAL_ORIGIN=https://<portal> [VAULTNACCESS_VERSION=0.1.0] [VAULTNACCESS_MANIFEST_KEY=<chave pública base64>] npm run build:extension
```

- Saída em `apps/extension/dist/` (build reprodutível; o mesmo commit e as mesmas variáveis geram arquivos idênticos).
- Carregar em `chrome://extensions` ou `edge://extensions` → modo desenvolvedor → **Carregar sem compactação** → `apps/extension/dist`.
- O ID de uma extensão sem compactação depende do caminho. Para um ID estável entre máquinas, gere um par de chaves para a extensão e informe a chave pública em `VAULTNACCESS_MANIFEST_KEY`; guarde a chave privada fora do repositório. Cadastre o ID resultante em `VAULT_EXTENSION_IDS`.
- Permissões do manifest: `identity`, `storage` e a origem do portal. Sem content scripts, `externally_connectable` ou `web_accessible_resources`.

## Conceder e revogar a permissão

A permissão `extension` usa o mesmo fluxo de concessões do cofre (dois gestores distintos, nenhum deles o beneficiário), pela API de administração:

1. Gestor A: `POST /api/v1/vault-security/administration/proposals` com `{ sessionId, change: { kind: 'grant', userId, action: 'extension', enabled: true } }` (sessão do cofre desbloqueada).
2. Gestor B: `POST /api/v1/vault-security/administration/approve` com `{ sessionId, proposalId }` em até 2 minutos.

Retirar (`enabled: false`) revoga na mesma transação todos os dispositivos e autorizações do usuário. Qualquer mudança aprovada incrementa a versão da política e invalida as autorizações em uso. O usuário pode revogar os próprios dispositivos em **VaultNAccess → Extensão do navegador: dispositivos conectados**. Logout do portal encerra a autorização da extensão na próxima requisição.

## Observabilidade

`vault_audit` registra `EXTENSION_AUTHORIZED`, `EXTENSION_CLIENT_REGISTERED`, `EXTENSION_DENIED` (com `reasonCode`, limitado a 5 por minuto por usuário) e `DEVICE_REVOKED`. Os tokens aparecem só como hash; o dispositivo, pelo thumbprint público da chave.

## Validação

- `npx vitest run apps/backend/src/modules/vault-security apps/extension apps/frontend/src/components/vault`
- `npm run test:vault:real` (MySQL/Redis descartáveis; inclui as duas migrações e os testes da extensão).
- `npm run test:extension:web` (Chromium com a extensão desempacotada e `launchWebAuthFlow` real contra um portal simulado em HTTPS local; requer `openssl` e o Chromium do Playwright).

## Rollback

1. `VAULT_EXTENSION_ENABLED=false` (efeito imediato).
2. Se preciso desfazer a migração: `DELETE FROM vault_entitlements WHERE action='extension'`; `DROP TABLE vault_extension_tokens, vault_extension_devices`; restaurar `vault_grant_action` para `('reveal','copy')`.
3. Remover a extensão dos navegadores do piloto.

## Limitações conhecidas

- O fluxo completo extensão → portal → backend reais ainda não foi exercitado num navegador; o ensaio automatizado usa um portal simulado. A homologação deve cobrir a conexão real, a negação sem permissão e a revogação.
- O Chromium não envia `Origin` nos GET da extensão; nesses pedidos o `Origin` é opcional (quando vem, precisa ser uma extensão permitida). O vínculo é a prova DPoP com a autorização e o dispositivo.
- Não há tela de administração das concessões no portal; a permissão é concedida pela API acima, como revelar/copiar.
- O popup da extensão é sempre exibido em português (Brasil), como o portal, independentemente do idioma do navegador.
