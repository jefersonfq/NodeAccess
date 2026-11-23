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

- Atalho do manifesto (NA-0192): `commands._execute_action` com `Alt+Shift+V` (sem permissão nova); o usuário troca em `chrome://extensions/shortcuts`. A página de conexão devolve `lang=pt-BR|en`, guardado só como código em `storage.session` junto da autorização.

### Revelar e copiar na extensão (NA-0195)

- Os botões aparecem nos Secrets quando a política do tenant permite revelar/copiar e o usuário tem a permissão daquela ação (dois gestores). Cada entrega segue as regras do portal: item liberado para entrega, escopo, cotas (`operations`, `tenant:operations`) e auditoria `DELIVERY_RELEASE_COMMITTED` (com o dispositivo).
- Prova: o popup pede o código do autenticador (`POST /extension/unlock`); vale o tempo de confirmação do tenant (1 a 15 min) para aquela autorização. Erros: `EXTENSION_UNLOCK_DENIED`; limite de 5 tentativas a cada 5 minutos.
- Entrega: `POST /extension/deliver` devolve um JWE para uma chave efêmera do popup; o valor some em 15 s e copiar pede **Confirmar cópia**. A extensão não limpa a área de transferência (como o portal).
- Para desligar: política do tenant (revelar/copiar) ou retirar as permissões pelos gestores.

### Pacote oficial e distribuição pelo portal (NA-0194)

1. Gere uma chave RSA de assinatura (uma vez por instalação) e guarde-a fora do repositório e do servidor de aplicação: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out vaultnaccess-signing.pem`. A chave define o ID da extensão; perdê-la ou trocá-la muda o ID (todos reinstalam e o novo ID entra em `VAULT_EXTENSION_IDS`).
2. Gere o pacote: `VAULTNACCESS_PORTAL_ORIGIN=https://<portal> VAULTNACCESS_VERSION=x.y.z VAULTNACCESS_SIGNING_KEY=/caminho/seguro/vaultnaccess-signing.pem [VAULTNACCESS_RELEASE_DIR=release/vaultnaccess] npm run package:extension`. Saída: `vaultnaccess-x.y.z.zip` (instalação manual, reprodutível), `vaultnaccess-x.y.z.crx` (assinado, CRX3), `update.xml` e `release.json` (versão, ID, SHA-256, commit). O comando imprime o ID e o valor da política.
3. Publique a pasta no servidor com `VAULT_EXTENSION_PACKAGE_DIR=<pasta>`, mantenha `VAULT_EXTENSION_ENABLED=true` e o ID em `VAULT_EXTENSION_IDS`. O servidor só publica se o `release.json` for válido, o ID estiver autorizado, a versão não for menor que `VAULT_EXTENSION_MIN_VERSION` e os hashes conferirem.
4. Rotas: `GET /api/v1/vault-security/extension/package` (portal, autenticado: metadados, só com os dois arquivos íntegros) e, públicas (HTTPS, com ETag), `package.zip`, `package.crx` e `update.xml` — não contêm segredo. O `update.xml` servido é gerado pelo servidor a partir do `release.json` conferido; o da pasta serve só como referência.
5. Usuários: cartão **Instalar a extensão** no VaultNAccess (download, SHA-256, passo a passo). Empresas: política `ExtensionInstallForcelist` do Chrome/Edge com `<id>;https://<portal>/api/v1/vault-security/extension/update.xml` (mostrada aos administradores no cartão); instala e atualiza sozinha. No Windows/macOS o navegador só aceita essa política para extensões fora da loja em máquinas gerenciadas (domínio/MDM).
6. Nova versão: gere com versão maior e publique a pasta; quem instalou por política atualiza sozinho; para obrigar a atualização, suba `VAULT_EXTENSION_MIN_VERSION`.

Validação: `node --test tools/vault-extension/package*.test.mjs` (ZIP reprodutível, CRX3 verificado por leitor independente e contra um CRX empacotado pelo próprio Chromium) e `npm run test:extension-package:web` (o Chromium carrega o pacote e atribui o ID do `release.json`).

### Dispositivo confiável (NA-0193)

- A primeira conexão (página do portal com senha e código) torna o navegador confiável por 7 dias, contados a partir da última autorização completa.
- Depois disso, ao abrir o popup sem autorização (por exemplo, após **Atualizar** a extensão ou reabrir o navegador), a extensão chama `POST /api/v1/vault-security/extension/renew` assinado com a chave do dispositivo: automático enquanto o login do portal que autorizou continuar ativo; se esse login acabou, o popup pede só o código do autenticador.
- Cinco códigos errados, **Revogar** em **Dispositivos conectados**, retirar **Usar extensão**, **Desconectar todas** (versão de sessão) ou **Desconectar** na extensão (`POST /extension/forget`) encerram a confiança: volta a exigir a página do portal.
- Auditoria: `EXTENSION_RENEWED` (`SESSION`/`OTP`), `EXTENSION_RENEW_DENIED` (`OTP_INVALID`/`TRUST_ENDED`), `EXTENSION_TRUST_ENDED`.
- Migração `20261123170000_vault_extension_trust` (aditiva: tipo `trust` em `vault_extension_tokens`).

### Homologação local com atualização ao subir o ambiente (NA-0190)

- Configure uma vez `apps/extension/local.json` (fora do Git, só valores públicos): `{ "portalOrigin": "https://127.0.0.1:5173", "manifestKey": "<chave pública base64>", "version": "0.1.0" }`. As variáveis `VAULTNACCESS_PORTAL_ORIGIN`, `VAULTNACCESS_MANIFEST_KEY` e `VAULTNACCESS_VERSION` têm prioridade.
- `npm run dev` compila a extensão em `apps/extension/dist-local` (separada da `dist` dos testes) antes de subir o ambiente; `npm run build:extension:local` faz o mesmo sob demanda. Sem origem configurada, não faz nada; uma falha não impede o ambiente de subir.
- O identificador da compilação vem do código da extensão e da configuração: sem mudança no código, não recompila nem pede atualização. Ele aparece em `chrome://extensions` como `version_name`.
- Carregue `apps/extension/dist-local` sem compactação uma única vez (no Windows com WSL: `\\wsl.localhost\<distribuição>\…\apps\extension\dist-local`). Depois, quando o portal de desenvolvimento anunciar outra compilação (`/vaultnaccess-build.json`), o popup mostra **Nova versão da extensão disponível** com **Atualizar**, que recarrega a extensão a partir da pasta.
- Se o portal não responder, **Conectar ao NodeAccess** mostra "Não foi possível conectar ao NodeAccess" sem abrir a janela de autorização; confira se o ambiente está no ar e a origem configurada.
- Mantenha a mesma chave pública para o ID não mudar (o ID precisa estar em `VAULT_EXTENSION_IDS`). Compilações de teste e de produção não têm identificador e nunca consultam o portal para isso; a atualização automática em produção é a fatia E6 (pacote assinado e `update_url`).

## Conceder e revogar a permissão

A permissão `extension` usa o mesmo fluxo de concessões do cofre (dois gestores distintos, nenhum deles o beneficiário). No portal: **VaultNAccess → Permissões do cofre (gestores)** (manual, capítulo Hosts). A seção só aparece para gestores (`vault_managers`) e cada ação pede confirmação de identidade com menos de 1 minuto.

1. Gestor A confirma a identidade e seleciona **Propor ativar** em **Usar extensão** na linha do usuário.
2. Gestor B confirma a identidade e seleciona **Aprovar** na proposta, em até 2 minutos.

Pela API, o mesmo fluxo: `POST /api/v1/vault-security/administration/proposals` com `{ sessionId, change: { kind: 'grant', userId, action: 'extension', enabled: true } }`, e `POST /administration/approve` com `{ sessionId, proposalId }` ou `{ sessionId, reference }` (o hash da proposta, listado em `POST /administration/overview` para gestores). `POST /administration/status` informa se o usuário é gestor, sem sessão do cofre.

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
- A tela de permissões cobre só concessões por usuário (revelar, copiar, extensão); mudanças de política e de itens continuam pela API. Lista até 500 usuários ativos do tenant.
- O popup da extensão é sempre exibido em português (Brasil), como o portal, independentemente do idioma do navegador.
