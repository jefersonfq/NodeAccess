# API e gateway Compose sem root

O arquivo `docker-compose.nonroot.yml` é uma adoção **explícita** para API e gateway UID/GID `1000:1000`, já usados no perfil Kubernetes. O Compose principal continua compatível com instalações antigas. Frontend/TLS, MySQL, Redis e guacd não são alterados por este override.

Use primeiro uma cópia descartável da instalação. Não basta acrescentar `user`: arquivos de auditoria, avatars e chaves SSH podem pertencer a root com modo `0600`. A preparação abaixo mantém conteúdo e modos e registra os donos anteriores em inventário com gravação atômica e fsync. O inventário contém nomes de arquivos operacionais: armazene-o privadamente, junto do backup, nunca em Git/PR.

## Antes da adoção

1. Execute os backups existentes de banco, auditoria, avatars, configuração e chaves. Confira restauração e identifique a versão da imagem atual.
2. Use o mesmo diretório/projeto/arquivos Compose da instalação. Identifique os mounts reais de API e gateway com `docker inspect` (somente `.Mounts`; não exporte variáveis de ambiente).
3. Pare API e gateway em janela de manutenção. Confirme que nenhum outro container, processo de host ou nó HA escreve nos diretórios. A ferramenta exige árvore estável; não migre storage compartilhado em uso.
4. Verifique o UID1000 e os grupos da imagem. Se há Docker socket/observabilidade montado, não abra permissões do socket: esse acesso privilegiado precisa de avaliação própria. O override não concede grupo Docker.
5. Prepare separadamente os volumes reais de `session-audit`, `user-avatars` e o diretório bind da host key SSH. Não execute a ferramenta em volumes de MySQL/Redis, certificados ou diretórios de projetos.

## Preparação de um volume nomeado

Preencha os valores conforme a instalação. `NODEACCESS_STATE_DIR` precisa ser um diretório novo, absoluto e privado para **cada** volume/diretório; não reutilize inventários.

```bash
NODEACCESS_VOLUME=nome_real_do_volume
NODEACCESS_IMAGE=nodeaccess-backend:versao_instalada
NODEACCESS_STATE_DIR=/caminho/privado/backup-nonroot/session-audit
NODEACCESS_HELPER="$(pwd)/scripts/deploy/runtime-permissions.mjs"

docker volume inspect "$NODEACCESS_VOLUME" >/dev/null
install -d -m 700 "$NODEACCESS_STATE_DIR"
docker run --rm --network none --read-only --tmpfs /tmp \
  --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE \
  --security-opt no-new-privileges:true \
  --mount "type=volume,src=${NODEACCESS_VOLUME},dst=/migration" \
  --mount "type=bind,src=${NODEACCESS_STATE_DIR},dst=/state" \
  --mount "type=bind,src=${NODEACCESS_HELPER},dst=/maintenance.mjs,readonly" \
  "$NODEACCESS_IMAGE" node /maintenance.mjs prepare
```

Repita com diretório de inventário próprio para avatars. Para a host key, substitua **somente** o mount `/migration` por `type=bind,src=/caminho/absoluto/ssh-gateway,dst=/migration`. Esse diretório deve existir e conter apenas os arquivos da host key esperada. A aplicação continuará montando-o somente leitura.

O comando recusa symlinks, hard links, sockets/dispositivos, bits especiais, inventário existente e inventário dentro do volume. Não usa `chmod -R`, não segue symlinks nem altera conteúdo. Uma falha durante a preparação preserva o inventário; mantenha os serviços parados e revise o resultado antes de restaurar. Não apague o inventário para esconder uma falha.

Depois das três preparações, usando a mesma seleção de projeto/arquivos da instalação:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.nonroot.yml up -d api ssh-gateway
docker compose -f docker-compose.prod.yml -f docker-compose.nonroot.yml exec -T api node -e 'console.log(process.getuid(), process.getgid())'
docker compose -f docker-compose.prod.yml -f docker-compose.nonroot.yml exec -T ssh-gateway node -e 'console.log(process.getuid(), process.getgid())'
```

Exigir `1000 1000`, health ready, login/MFA, SSH, gravação/replay, SFTP e avatar. O ensaio automatizado cobre ambiente descartável; isso não substitui a homologação da instalação. Mantenha o override em **todos** os comandos operacionais seguintes. Instalações HA e ferramentas que geram novos comandos Compose precisam incorporar essa seleção antes da adoção; não remova o override implicitamente em update/restart.

## Retorno ao perfil anterior

1. Pare API/gateway e todos os escritores do storage.
2. Execute o mesmo container de manutenção, mesmos mounts e inventário de cada preparação, substituindo `prepare` por `restore`.
3. A restauração verifica identidade de cada arquivo/diretório e modos. Arquivos originais recuperam donos anteriores; arquivos criados no período nonroot conservam conteúdo e modos, recebendo o dono anterior da pasta mais próxima registrada. Isso mantém sua leitura no perfil root com capabilities removidas. Metadados desses arquivos novos também ficam no inventário.
4. Arquivos removidos/substituídos, symlinks, modos alterados ou novos donos inesperados interrompem a operação para revisão manual. Não force um inventário divergente. O inventário não substitui o backup completo.
5. Somente após restaurar todos os diretórios, recrie API/gateway com o conjunto anterior de arquivos Compose, sem o override. Valide os mesmos fluxos e health.

Não há downgrade de schema/banco nem troca automática de imagens. Para voltar uma release, siga também o procedimento específico de recuperação de versão.

## Ensaios reproduzíveis

```bash
node --test scripts/deploy/runtime-permissions.test.mjs
RUN_NONROOT_REAL=true node tools/deploy/runtime-nonroot-real.mjs
RUN_CONTAINER_STACK_REAL=true node tools/deploy/container-stack-real.mjs
```

Os ensaios usam volumes, credenciais e containers descartáveis; não leem `.env`. O segundo valida migração/rollback real, hashes e host key; o terceiro valida API/gateway UID1000, login/MFA, tenant, SSH/SFTP, indisponibilidade Redis e desligamento.

## CSP da interface

Os perfis Nginx HTTP/HTTPS/prod/Kubernetes aplicam CSP à aplicação. Scripts inline e `eval` são bloqueados; o bootstrap de service worker passou a módulo processado pelo Vite, incluído em asset com hash. Estilos inline permanecem necessários à UI. Monaco mantém o CDN versionado já usado pelo loader; a CSP permite somente seu caminho exato. Atualizações do loader precisam revalidar `tools/frontend/csp-security-playwright.cjs`, que compara a configuração instalada e exercita editor/worker reais. Self-hosting/SRI do editor permanece uma melhoria separada.

Documentos remotos em `/api/v1/web-access/proxy` e seus subcaminhos conservam a política do upstream. A CSP da aplicação não pode bloquear os scripts legítimos desses sistemas. O isolamento desse conteúdo remoto em origem separada continua uma frente própria de segurança; não confundir a CSP da SPA com proteção global de conteúdo externo na mesma origem.
