# Operar o piloto de rede/TACACS+

## Instalação

Atualize o conjunto API/gateway/frontend e aplique as migrações pelo procedimento habitual antes de usar perfis de rede. A migração é aditiva e não habilita o serviço.

O SSH de servidores e o uso de AAA externo não exigem o processo abaixo. Para disponibilizar o serviço próprio, inicie uma instância separada do backend compilado:

```sh
NODEACCESS_TACACS_ENABLE=true NODEACCESS_TACACS_BIND=127.0.0.1 NODEACCESS_TACACS_PORT=4949 \
  node --env-file=apps/backend/.env apps/backend/dist/modules/network-access/tacacs-main.js
```

Em uma imagem de release do backend, o caminho é `dist/modules/network-access/tacacs-main.js`. Também há um Compose opcional:

```sh
NODEACCESS_BACKEND_IMAGE=<imagem-backend-atualizada> \
  docker compose -f docker-compose.tacacs.yml --profile tacacs up -d
```

O `.env` precisa conter endereços de banco alcançáveis pelo container. `localhost` dentro do container não é o host: use a rede/endereço de banco da sua instalação, sem publicar MySQL para a internet. O Compose é independente da implantação principal; ajuste a rede conforme sua instalação. Por padrão publica somente `127.0.0.1:4949`. Para equipamentos reais, vincule explicitamente ao endereço da rede de gerenciamento e limite as origens no firewall. O serviço usa TCP; 4949 é o padrão do piloto, e muitos equipamentos precisam receber essa porta explicitamente em vez de TCP 49.

A imagem de backend deve ser construída com o fluxo de release existente. O listener não sobe dentro da API nem acompanha automaticamente o gateway.

## Configuração inicial na interface

1. Em Configurações → Equipamentos de rede e TACACS+, escolha o padrão de novos hosts, se necessário. Hosts existentes não mudam.
2. Cadastre o equipamento, usando um host SSH existente, o IP de origem que o listener verá e um segredo aleatório de pelo menos 32 caracteres. Configure o mesmo segredo no equipamento.
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

Laboratório integrado: requer banco local já migrado e dependência **de teste** Python `tacacs_plus==2.6` em virtualenv ou container; não é dependência do produto. O teste cria tenants temporários, valida API/ACL/AAA/auditoria, usa listener efêmero em loopback e remove os próprios registros no final.

```sh
RUN_NETWORK_ACCESS_LIVE=true \
  node --env-file=apps/backend/.env --import tsx tools/network-access/live.mjs
```

Use `PYTHON=/caminho/venv/bin/python` ou `PYTHONPATH=/caminho/dependencias` para selecionar o cliente de teste. Relatório: `/tmp/nodeaccess-network-live.json`.

O laboratório também injeta falha de auditoria e corrupção de política no próprio tenant descartável, testa rotações/revogação e executa ondas concorrentes de autorização/accounting. Execute uma instância do laboratório por vez, pois o IP de origem é exclusivo no piloto. A suíte TCP cobre timeouts, sobrecarga e recuperação com dependências controladas. Veja a [matriz de resiliência](../reviews/2026-09-11-network-access-resilience.md).

UX usa navegador CDP e uma API/frontend local de teste com administrador de laboratório; intercepta todas as gravações do módulo e impede gravações nos demais endpoints:

```sh
RUN_NETWORK_UX=true FRONTEND_BASE=http://127.0.0.1:5187 \
  node --env-file=apps/backend/.env tools/network-access/ux.cjs
```

A suíte PTY real deve receber um `HOST_ID` descartável e a instância isolada de frontend/gateway. Nunca execute sondagens de laboratório em equipamento de cliente sem escopo específico.

## Limitações conhecidas

É um piloto de protocolo e de UX: não é servidor AAA homologado de produção. Faltam homologação por fabricante/firmware, TLS, alta disponibilidade do serviço, rate limit distribuído, retenção automatizada de eventos AAA, grupos/conjuntos reutilizáveis de comandos e automações CLI com paginação/prompts específicos. As permissões deste piloto são por usuário e host. Não oferece detecção automática de fabricante nem executa comandos ocultos para tentar descobri-lo.

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
PYTHONPATH=/caminho/dependencias-python npm run test:network-access:lab

# Três fases: funcionamento normal, falhas/timeouts injetados e recuperação.
PYTHONPATH=/caminho/dependencias-python NETWORK_SOAK_SECONDS=120 \
  NETWORK_SOAK_CLIENTS=4 npm run test:network-access:soak
```

O teste de carga aceita de 30 a 1.800 segundos e de um a oito clientes concorrentes. Usa MySQL real, mas limites de timeout reduzidos em um listener exclusivo de laboratório. Confere a decisão de cada comando, inclusive durante falhas, e exige zero operações pendentes no fim de cada fase. O relatório separa amostras de memória do processo Node, CPU, atraso do event loop e resultados das três fases; não contabiliza memória/CPU do MySQL nem dos subprocessos Python.

A CLI simulada suporta consultas e alteração controlada de hostname, sem executar comandos do sistema operacional. Valida senha recusada sem fallback, comando negado sem alteração de estado, concessão/revogação dentro de sessão SSH aberta, encerramento do listener AAA primário, uso do secundário e recuperação. Os listeners são independentes, mas compartilham o processo e banco do laboratório: não constitui teste de alta disponibilidade entre máquinas.

Não é firmware Cisco/Juniper. Para homologação de fabricante, há caminhos documentados pelo Containerlab para [Cisco IOL](https://containerlab.dev/manual/kinds/cisco_iol/) e [vJunos-router](https://containerlab.dev/manual/kinds/vr-vjunosrouter/), que exigem preparar a imagem apropriada. Nenhuma imagem desses fabricantes foi executada nesta entrega.
