# Operar o piloto de rede/TACACS+ sobre TLS

## Compatibilidade e segurança

O listener próprio suporta exclusivamente **TLS 1.3 com autenticação mútua por certificados (mTLS)**, conforme a variante de transporte da [RFC 9887](https://www.rfc-editor.org/rfc/rfc9887.html). TACACS+ legado sem TLS não é suportado: sua obfuscação MD5 não fornece proteção adequada de confidencialidade e integridade. Não há fallback, STARTTLS nem opção de aceitar clientes sem certificado. A antiga variável de reconhecimento do risco não habilita compatibilidade.

Isso não altera o uso de AAA externo pelos equipamentos nem o acesso SSH comum. O suporte continua sendo um piloto PAP/ASCII, autorização shell por comandos exatos e accounting, sem homologação automática de fabricante/firmware. Equipamentos precisam implementar a variante TLS; um túnel externo envolvendo o protocolo legado não equivale a esse suporte.

## Instalação e identidade

Atualize API/gateway/frontend e aplique a migração aditiva `20261104230000_tacacs_tls_identity` antes do daemon. Ela adiciona o fingerprint do certificado e mantém o campo de segredo antigo apenas para histórico de schema: o serviço TLS não o consulta. Registros sem fingerprint permanecem sem acesso, mesmo se a política já estava habilitada. O cadastro explícito de certificado é necessário. Não usar implantação mista com daemon antigo.

Provisione com sua PKI:

- Certificado do servidor com SAN DNS/IP correspondente ao nome/endereço configurado nos clientes, chave privada correspondente e finalidade de servidor TLS.
- Certificado individual de cliente com finalidade de cliente TLS e **SAN iPAddress igual ao IP de origem observado pelo daemon**. CN sozinho não identifica um equipamento.
- Cadeia de CA confiável e CRLs vigentes para os emissores relevantes. Certificado/CRL inválido ou indisponível não permite contornar validação.
- Fingerprint SHA-256 exclusivo por equipamento, cadastrado junto ao IP de origem e ao host do tenant. O fingerprint é público; não substitui posse da chave privada, CA, SAN ou revogação. Equipamentos atrás de um mesmo IP NAT não são suportados por este perfil de identidade.

Exemplo para obter apenas o fingerprint público:

```sh
openssl x509 -in equipamento.crt -noout -fingerprint -sha256
```

Copie somente os 64 dígitos hexadecimais (separadores `:` são aceitos). Nunca envie a chave privada para a interface. Restrinja a chave do servidor ao UID do processo; monte os arquivos somente para leitura.

```sh
NODEACCESS_TACACS_ENABLE=true \
NODEACCESS_TACACS_TLS_KEY_FILE=/run/tacacs-pki/server.key \
NODEACCESS_TACACS_TLS_CERT_FILE=/run/tacacs-pki/server.crt \
NODEACCESS_TACACS_TLS_CA_FILE=/run/tacacs-pki/ca.crt \
NODEACCESS_TACACS_TLS_CRL_FILE=/run/tacacs-pki/ca.crl \
NODEACCESS_TACACS_BIND=127.0.0.1 NODEACCESS_TACACS_PORT=300 \
  node --env-file=apps/backend/.env apps/backend/dist/modules/network-access/tacacs-main.js
```

Em imagem de release, o executável é `dist/modules/network-access/tacacs-main.js`. O Compose opcional exige o diretório PKI no ambiente de interpolação:

```sh
NODEACCESS_TACACS_PKI_DIR=/caminho/privado/pki \
NODEACCESS_BACKEND_IMAGE=<imagem-backend-atualizada> \
  docker compose -f docker-compose.tacacs.yml --profile tacacs up -d
```

Porta de serviço padrão: TCP300, distinta da TCP49 legada. O Compose publica somente loopback por padrão; ajuste o bind apenas com regras de firewall apropriadas. Em execução sem privilégio de bind em portas baixas, use uma porta interna não privilegiada e publique TCP300; não execute o serviço como root para contornar a restrição. Configure no equipamento o nome TLS/SNI e a validação da identidade do servidor, além do destino TCP. Banco/Redis devem ser alcançáveis pelo container; `localhost` no container não é o host.

## Rotação, revogação e recuperação

Atualizar o fingerprint de um equipamento invalida o anterior no próximo pedido AAA, inclusive em uma conexão existente. Para trocar chave/certificado/CA/CRL do daemon, atualize os arquivos de forma controlada e reinicie o processo: esta versão não promete recarga automática. O encerramento fecha as conexões antigas. Programe a renovação antes da expiração e distribua cadeias/CRLs também aos clientes; não desative verificações para resolver indisponibilidade.

A revogação do cadastro, tenant, usuário ou ACL continua aplicada aos próximos pedidos. Em falha de PKI/AAA, o padrão é negar; revise também o fallback configurado no equipamento, fora do controle do NodeAccess. Recuperação segura: desativar a política e parar o daemon, corrigir PKI/configuração e revalidar. Não reativar o protocolo legado como rollback nem apagar eventos AAA.

## Configuração inicial na interface

1. Em Integrações → Equipamentos de rede e TACACS+, escolha o padrão de novos hosts, se necessário. Hosts existentes não mudam.
2. Cadastre o equipamento, usando um host SSH existente, o IP de origem que o listener verá e a impressão SHA-256 do certificado individual de cliente. Confira o SAN IP, a cadeia confiável e a CRL; ative o cadastro somente após configurar mTLS no equipamento.
3. Cadastre a credencial AAA individual vinculada ao usuário NodeAccess. Conceda a ACL de conexão ao host pelo inventário habitual.
4. Cadastre a lista explícita de comandos por usuário/equipamento. Exemplo: `show version`, um comando completo por linha. Não inclua senhas ou segredos em políticas de comandos.
5. Habilite a política do tenant e confirme o impacto. A indicação “habilitado” é configuração, não prova de que o processo está online.
6. Configure autenticação, autorização para TODOS os níveis relevantes e accounting no equipamento. Não copie uma receita de outro fabricante. Junos AV-pairs e outros dialectos ainda não são implementados neste piloto.
7. Valide senha correta/errada, comando permitido/negado, ACL revogada e parada do serviço. Observe resultados recentes na interface e alterações administrativas na auditoria.

Não usar conta de SSH compartilhada para prometer rastreabilidade individual no AAA. Para AAA externo, o equipamento continua usando sua configuração atual; não é necessário cadastrá-lo no listener próprio.

## Testes reproduzíveis

```sh
npm run typecheck
npm run test:network-access
```

Laboratório integrado: requer backend compilado e banco local descartável já migrado e Python com biblioteca padrão `ssl` compatível com TLS 1.3, além de OpenSSL para gerar a PKI descartável; não usa biblioteca TACACS+ legada. O teste cria tenants temporários, valida API/ACL/AAA/auditoria, usa listener efêmero em loopback e remove os próprios registros no final.

```sh
# Recompilar após qualquer alteração; os labs executam o JavaScript de dist.
node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/backend/tsconfig.json
RUN_NETWORK_ACCESS_LIVE=true \
  node --env-file=/caminho/privado/lab.env tools/network-access/live.mjs
```

O arquivo de ambiente deve apontar apenas para recursos descartáveis do laboratório; não use banco de produção. O coletor `NODEACCESS_TLS_COVERAGE=true node --test tools/network-access/tls-lab.test.mjs` cria MySQL/Redis próprios, compila antes da execução e verifica a limpeza.

Use `PYTHON=/caminho/python3` para selecionar o cliente independente de teste. Relatório: `/tmp/nodeaccess-network-live.json`.

O laboratório também injeta falha de auditoria e corrupção de política no próprio tenant descartável, testa rotações/revogação e executa ondas concorrentes de autorização/accounting. Execute uma instância do laboratório por vez, pois o IP de origem é exclusivo no piloto. A suíte TLS cobre timeouts, sobrecarga e recuperação com dependências controladas. Veja a [matriz de resiliência](../reviews/2026-09-11-network-access-resilience.md).

UX usa navegador CDP e uma API/frontend local de teste com administrador de laboratório; intercepta todas as gravações do módulo e impede gravações nos demais endpoints:

```sh
RUN_NETWORK_UX=true FRONTEND_BASE=http://127.0.0.1:5187 \
  node --env-file=apps/backend/.env tools/network-access/ux.cjs
```

A suíte PTY real deve receber um `HOST_ID` descartável e a instância isolada de frontend/gateway. Nunca execute sondagens de laboratório em equipamento de cliente sem escopo específico.

## Limitações conhecidas

É um piloto de protocolo e de UX: não é servidor AAA homologado de produção. Faltam homologação por fabricante/firmware, alta disponibilidade do serviço, rate limit distribuído, retenção automatizada de eventos AAA, grupos/conjuntos reutilizáveis de comandos e automações CLI com paginação/prompts específicos. As permissões deste piloto são por usuário e host. Não oferece detecção automática de fabricante nem executa comandos ocultos para tentar descobri-lo.

Antes de produção, a configuração efetiva do equipamento precisa demonstrar que comandos negados não são executados e que falhas não acionam fallback indevido. As medições locais não comprovam capacidade para 300 usuários concorrentes.

Para exercitar o executável TACACS+ compilado em processo separado, inicie-o em loopback e informe `NETWORK_TACACS_EXTERNAL_PORT` ao laboratório integrado. O campo `authorizationMs` do relatório mede chamadas diretas ao serviço com banco/auditoria, não latência ponta a ponta.

O teste `tools/network-access/ssh-live.cjs` valida o fluxo API/gateway com um host Linux descartável em `127.0.0.1:2249`, incluindo entrada enviada imediatamente após `connected`, recusa de SFTP e preservação da sessão:

```sh
RUN_NETWORK_SSH_LIVE=true HOST_ID=<host-descartavel> \
  node --env-file=apps/backend/.env tools/network-access/ssh-live.cjs
```

Use `API_BASE`, `GATEWAY_BASE`, `ADMIN_USER_ID` e `TENANT_ID` para apontar para o laboratório. O teste recusa hosts fora do endpoint descartável, altera temporariamente o perfil e restaura o valor original no final. Não execute esse teste em paralelo com outro teste que altere o mesmo host.

## Saúde, diagnóstico e recuperação operacional

A seção **Saúde do serviço TACACS+** distingue política desabilitada, ausência de observação, serviço observado como disponível, degradação e falha do monitoramento. A API administrativa `/network-access/health` retorna somente a atividade do tenant autenticado. Uma falha de diagnóstico não altera as ACLs nem apaga campos em edição.

O daemon publica observações no Redis a cada cinco segundos, por conexão dedicada com timeout e sem fila offline. A API precisa apontar para o mesmo Redis do daemon. Observações com mais de 20 segundos são consideradas atrasadas; após até 60 segundos deixam de aparecer. A tela atualiza a cada dez segundos enquanto visível. Reinícios criam uma nova identidade de instância e zeram seus contadores; uma instância encerrada pode continuar aparecendo temporariamente como degradada até expirar.

Contadores de pedidos/erros/timeouts e amostras de latência são mantidos em memória limitada: até 1.024 tenants observados por instância, com as últimas 128 latências por tenant. Se houver mais tenants, históricos antigos são descartados. Ausência de histórico não significa ausência de pedidos. As contagens não substituem a auditoria persistida. Rejeições anteriores à identificação de um tenant aparecem apenas nas métricas locais agregadas.

Configure `NODEACCESS_TACACS_HEALTH_PORT=4950` para diagnóstico **somente em loopback**:

- `GET /live`: processo aceitando verificações de vida.
- `GET /ready`: HTTP 200 quando listener e banco foram observados disponíveis e não há saturação/operação além do timeout; HTTP 503 caso contrário.
- `GET /metrics`: contadores agregados do processo, recusas, timeouts, operações pendentes, limites e RSS. Não retorna o detalhamento dos tenants, usuários, comandos ou segredos.

O Compose opcional já usa `/ready` como healthcheck e não publica essa porta. O healthcheck sozinho não reinicia um container Docker. O watchdog do daemon encerra com código 1 quando uma operação AAA permanece pendente por `NODEACCESS_TACACS_STALL_MS` (padrão 60.000 ms, configurável entre 15.000 e 300.000). O supervisor, como `restart: unless-stopped` do Compose, é responsável por reiniciar. Ao encerrar, conexões são fechadas; não existe liberação automática de comandos. Para instalações fora do Compose, configure um supervisor equivalente.

O watchdog não torna a dependência disponível nem substitui redundância. Uma falha persistente pode provocar novas tentativas de reinício. Monitoramento indisponível é comunicado como informação desconhecida, nunca como confirmação de saúde.

## Laboratório de equipamento e carga sustentada

```sh
# SSH real para CLI de laboratório; o dispositivo consulta TACACS+ via cliente Python independente.
RUN_NETWORK_ACCESS_LIVE=true RUN_NETWORK_DEVICE_EMULATION=true \
  node --env-file=/caminho/privado/lab.env tools/network-access/live.mjs

# Três fases: funcionamento normal, falhas/timeouts injetados e recuperação.
RUN_NETWORK_ACCESS_LIVE=true RUN_NETWORK_DEVICE_EMULATION=true RUN_NETWORK_ACCESS_SOAK=true \
  NETWORK_SOAK_SECONDS=120 NETWORK_SOAK_CLIENTS=4 \
  node --env-file=/caminho/privado/lab.env tools/network-access/live.mjs
```

O teste de carga aceita de 30 a 1.800 segundos e de um a oito clientes concorrentes. Usa MySQL real, mas limites de timeout reduzidos em um listener exclusivo de laboratório. Confere a decisão de cada comando, inclusive durante falhas, e exige zero operações pendentes no fim de cada fase. O relatório separa amostras de memória do processo Node, CPU, atraso do event loop e resultados das três fases; não contabiliza memória/CPU do MySQL nem dos subprocessos Python.

A CLI simulada suporta consultas e alteração controlada de hostname, sem executar comandos do sistema operacional. Valida senha recusada sem fallback, comando negado sem alteração de estado, concessão/revogação dentro de sessão SSH aberta, encerramento do listener AAA primário, uso do secundário e recuperação. Os listeners são independentes, mas compartilham o processo e banco do laboratório: não constitui teste de alta disponibilidade entre máquinas.

Não é firmware Cisco/Juniper. Para homologação de fabricante, há caminhos documentados pelo Containerlab para [Cisco IOL](https://containerlab.dev/manual/kinds/cisco_iol/) e [vJunos-router](https://containerlab.dev/manual/kinds/vr-vjunosrouter/), que exigem preparar a imagem apropriada. Nenhuma imagem desses fabricantes foi executada nesta entrega.

O painel é carregado apenas ao expandir a integração. As políticas continuam isoladas por cliente e restritas aos administradores. Links antigos para `/admin/settings?section=network-access` redirecionam para `/admin/integrations?section=network-access`.


### Atalhos de teste

`npm run test:network-access:lab` provisiona um laboratório Docker local descartável e executa também soak de 30 s, health e watchdog. Não carrega `apps/backend/.env`; o laboratório gera sua própria configuração e limpa os recursos identificados pela execução. Requer Docker local, Node 24, Python 3 e OpenSSL.

Para um soak mais longo em banco descartável preparado pelo operador, use `NODEACCESS_NETWORK_LAB_ENV=/caminho/privado/lab.env NETWORK_SOAK_SECONDS=120 npm run test:network-access:soak`. Esse atalho exige o arquivo explícito e compila shared/backend antes do ensaio; não há fallback para o ambiente da aplicação. O comando direto documentado acima também exige build atualizado.
