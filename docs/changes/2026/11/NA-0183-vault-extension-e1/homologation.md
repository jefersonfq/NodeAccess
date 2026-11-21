# NA-0183 — Roteiro de homologação da E1

Executar com o backend e o portal reais, em HTTPS, a partir do commit da PR75. Configuração e concessão em `docs/OPERATIONS-vault-extension.md`. Registrar o resultado de cada item (PASS/FAIL, data, navegador e versão) no `implementation.md`, sem tokens, códigos, e-mails ou capturas com dados pessoais.

## Preparação

1. Ambiente com a migração `20261120150000_vault_extension` aplicada e o cofre operacional para o tenant (HTTPS, política, TOTP do usuário).
2. Gerar a extensão: `VAULTNACCESS_PORTAL_ORIGIN=https://<portal> npm run build:extension`; carregar `apps/extension/dist` em `chrome://extensions` (ou `edge://extensions`) → modo desenvolvedor → **Carregar sem compactação**. Anotar o ID exibido.
3. Backend: `VAULT_EXTENSION_ENABLED=true`, `VAULT_EXTENSION_IDS=<ID>`; reiniciar.
4. Usuários: **U1** (local) e, se houver, **U2** (LDAP ou OIDC/Google, com `VAULT_STEP_UP_EXTERNAL_ENABLED=true`); dois gestores **G1** e **G2** distintos de U1/U2. U1 deve ver ao menos um Secret pessoal e um compartilhado; ter um item que U1 **não** vê.

## Homologação local (portal de desenvolvimento)

O cofre e a extensão recusam HTTP. O servidor de desenvolvimento do portal tem um modo HTTPS opcional, ligado só quando `NODEACCESS_DEV_HTTPS_CERT` e `NODEACCESS_DEV_HTTPS_KEY` apontam para um certificado e uma chave; nesse modo o proxy envia `x-forwarded-proto: https` e `x-forwarded-host` (padrão `127.0.0.1:5173`, ou `NODEACCESS_DEV_HTTPS_HOST`).

1. `apps/backend/.env` (o servidor em desenvolvimento lê este arquivo, não o da raiz): `TRUST_PROXY=true`, `VAULT_EXTENSION_ENABLED=true`, `VAULT_EXTENSION_IDS=<ID da extensão>`; reiniciar o servidor.
2. Certificado local autoassinado (fora do Git, em `.tmp/`) e o portal com `NODEACCESS_DEV_HTTPS_CERT=… NODEACCESS_DEV_HTTPS_KEY=… npm run dev`; abrir `https://127.0.0.1:5173`.
3. Habilitar o cofre no tenant com `tools/vault-security/manage.mjs bootstrap` (dry-run e depois `--apply`), com a origem `https://127.0.0.1:5173` e dois gestores com TOTP.
4. Extensão gerada para `https://127.0.0.1:5173` com chave fixa (`VAULTNACCESS_MANIFEST_KEY`), para o ID não mudar entre instalações.
5. Chrome num perfil separado, só para o teste, aceitando o certificado local: `--user-data-dir=<pasta temporária> --ignore-certificate-errors`. Não usar esse perfil para navegar.

## Casos

| # | Passo | Esperado |
|---|---|---|
| H1 | U1 sem a permissão `extension`: popup → **Conectar**, confirmar a identidade no portal | Portal recusa ("Acesso negado. Verifique a permissão \"Usar extensão\"…"), a extensão fica desconectada; `vault_audit` com `EXTENSION_DENIED` |
| H2 | G1 em **VaultNAccess → Permissões do cofre (gestores)**: confirma a identidade e **Propor ativar** em **Usar extensão** para U1; G2 confirma e **Aprovar** | A seção não aparece para U1; G1 não vê **Aprovar** na própria proposta; após aprovar, o cofre bloqueia e U1 aparece com **Usar extensão: Sim** |
| H3 | U1 conecta de novo | O código do dispositivo no popup é igual ao do portal; após senha + TOTP a janela fecha e o popup mostra a busca; `EXTENSION_AUTHORIZED` e `EXTENSION_CLIENT_REGISTERED` na auditoria |
| H4 | Buscar por nome; filtrar por tipo; **Carregar mais** se houver mais de 50 | Só aparecem itens que U1 vê no portal (pessoais e compartilhados); nenhum valor secreto; o item que U1 não vê não aparece |
| H5 | Clicar num item | Abre `/vault?kind=…&id=…` no portal com o item em foco; **Mostrar todos** volta à lista |
| H6 | DevTools da extensão (service worker) → Application → Storage | `storage.local`/`sync` vazios; `storage.session` só com a autorização e recentes; nenhuma URL com token |
| H7 | Portal → VaultNAccess → **Extensão do navegador: dispositivos conectados** → **Revogar** | A próxima busca no popup pede nova conexão; `DEVICE_REVOKED` na auditoria |
| H8 | Reconectar; fazer logout do portal; buscar no popup | Busca negada, pede nova conexão |
| H9 | Reconectar; G1/G2 retiram a permissão (**Propor retirar** + **Aprovar**) | Busca negada; dispositivo some da lista |
| H10 | Reconectar (com permissão); aguardar 30 min sem uso | Autorização expira; popup pede nova conexão (sem renovação automática) |
| H11 | Opcional: `VAULT_EXTENSION_MIN_VERSION=9.9.9` e reiniciar | Popup pede atualização da extensão |
| H12 | Repetir H3–H5 com U2 (LDAP/OIDC/Google), se houver | Confirmação pelo provedor e mesmo resultado |
| H13 | Regressão rápida: login, SSH no navegador, revelar/copiar no cofre | Sem mudança de comportamento |
| H14 | `VAULT_EXTENSION_ENABLED=false` e reiniciar | Rotas da extensão respondem 404; a seção de dispositivos some do portal |

## Critério

Todos os itens obrigatórios (H1–H10, H13, H14) PASS. H11 e H12 são registrados como executados ou não aplicáveis, com o motivo.
