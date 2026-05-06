# MCP - Governanca e Full Access

Este documento consolida exemplos práticos para validar o MCP do NodeAccess com governanca por token, policy de comandos SSH por IA e `full_operational_access`.

## Estado atual

Atualmente o MCP suporta:

- autenticacao por JWT, token tecnico estatico ou token MCP persistido;
- allowlist de capabilities por ambiente e por token MCP;
- restricao de modos de `ActionRun` por token MCP;
- avaliacao de policy de comando antes da solicitacao;
- revalidacao da policy no backend ao criar e ao executar o `ActionRun`;
- `full_operational_access` para ator efetivo admin;
- auditoria de sucesso em `MCP_TOOL_CALLED` e `MCP_RESOURCE_READ`;
- auditoria de negacao em `MCP_DENIED` e `MCP_RATE_LIMITED`;
- sessao SSH interativa livre por MCP para tokens persistidos com full access explicito;
- logs filtraveis por `mcpTokenId` e `mcpAuthMode`.

O acesso full governado por `ActionRun` continua sendo o caminho recomendado para automacoes previsiveis. A sessao SSH interativa livre existe para clientes que aceitam o risco de dar shell ao agente, com controle por token, host e auditoria.

Limites da primeira versao da sessao interativa:

- exige token MCP persistido, ator admin e `full_operational_access` explicitamente marcado;
- exige as capabilities `open/write/read/resize/close_interactive_ssh_session`;
- respeita `allowedHostIds` ao abrir a sessao;
- aplica TTL maximo e limites de sessoes simultaneas por token e tenant;
- pode exigir `allowedHostIds` explicitamente via `MCP_INTERACTIVE_SSH_REQUIRE_ALLOWED_HOSTS=true`;
- persiste resumo consolidado por sessao em `mcp_interactive_ssh_sessions`;
- suporta rota direta, incluindo bastion efetivo, mas nao abre hosts por Agent;
- registry em memoria, portanto sessoes caem se o processo API reiniciar ou em ambiente multi-replica sem sticky routing.

Estado atual da governanca/full access:

- full governado por `ActionRun` ja cobre policy, host permitido, modo permitido e auditoria;
- shell livre via MCP ja cobre token persistido, capability interativa, `full_operational_access`, host permitido, auditoria por evento e persistencia por sessao;
- a operacao admin ja consegue consultar sessoes MCP shell por token e encerrar sessoes ativas.
- a UI de `Tokens MCP` ja orienta a configuracao com perfis, busca de hosts, tooltips e resumo dinamico de risco.

## Regras de seguranca

Para um cliente MCP solicitar `full_operational_access`, todas as condicoes abaixo precisam ser verdadeiras:

- `FEATURE_MCP=true`;
- tenant com entitlement `mcp`;
- tenant com entitlement `aiSshActions`;
- token MCP ativo, nao revogado e nao expirado;
- token com capability `request_action_run`, se houver restricao por capability;
- token com modo `full_operational_access`, se houver restricao por modo;
- token com o host de destino em `allowedHostIds`, se houver restricao por host;
- ator efetivo do token com perfil admin;
- usuario efetivo com acesso ao host;
- comando nao classificado como `blocked` pela policy.

Para shell interativo livre, a regra e mais restritiva:

- sempre token MCP persistido;
- sempre ator efetivo admin;
- sempre `full_operational_access` explicitamente permitido no token;
- sempre capability interativa especifica;
- host permitido por `allowedHostIds`, quando preenchido.

Comandos classificados como `approval_required` podem executar em:

- `approval_required`, depois de aprovacao administrativa;
- `full_operational_access`, sem etapa pendente de aprovacao.

Comandos classificados como `blocked` continuam negados em qualquer modo.

## Variaveis uteis

```bash
export BASE_URL="http://localhost:3000/api/v1"
export MCP_TOKEN="<TOKEN_MCP_PERSISTIDO>"
export HOST_ID=1
```

## Cenario 1 - Token MCP de consulta

Objetivo: permitir apenas discovery e leitura.

Configurar o token na UI:

- capabilities: `search_hosts`, `get_host_dashboard`, `list_host_diagnostic_runs`, `get_diagnostic_run`;
- modos de `ActionRun`: nenhum ou somente `read_only`;
- sem `request_action_run`.

Validar busca de hosts:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"prod","limit":5}' \
  "${BASE_URL}/mcp/tools/search-hosts"
```

Validar bloqueio de action run:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":1,"mode":"diagnostic_only","channel":"mcp","summary":"Teste bloqueado","steps":[{"id":"step-1","label":"Uptime","command":"uptime","timeoutSeconds":15}]}' \
  "${BASE_URL}/mcp/tools/request-action-run"
```

Resultado esperado:

- HTTP `403`;
- log administrativo com `targetType=MCP`;
- action `MCP_DENIED`;
- details contendo `capability=request_action_run` e `authMode=persisted_token`.

## Cenario 2 - Token MCP de diagnostico

Objetivo: permitir steps seguros sem acesso operacional amplo.

Configurar o token na UI:

- capabilities: `evaluate_action_command_policy`, `request_action_run`, `list_host_action_runs`, `get_action_run`;
- modos de `ActionRun`: `read_only`, `diagnostic_only`;
- sem `approval_required`;
- sem `full_operational_access`.

Avaliar um comando seguro:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"diagnostic_only","steps":[{"id":"step-1","label":"Carga atual","command":"uptime"}]}' \
  "${BASE_URL}/mcp/tools/evaluate-action-command-policy"
```

Solicitar o run:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":'"${HOST_ID}"',"mode":"diagnostic_only","channel":"mcp","summary":"Coleta diagnostica via MCP","steps":[{"id":"step-1","label":"Carga atual","command":"uptime","timeoutSeconds":15}]}' \
  "${BASE_URL}/mcp/tools/request-action-run"
```

Resultado esperado:

- `ActionRun` criado;
- status inicial `approved`;
- execucao automatica pelo runner;
- logs `MCP_TOOL_CALLED` e `AI_SSH_ACTION_RUN_REQUESTED`.

## Cenario 3 - Comando que exige aprovacao

Objetivo: validar que comandos de impacto operacional nao passam em `diagnostic_only`.

Avaliar plano com restart:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"diagnostic_only","steps":[{"id":"step-1","label":"Restart nginx","command":"systemctl restart nginx"}]}' \
  "${BASE_URL}/mcp/tools/evaluate-action-command-policy"
```

Resultado esperado:

- `maxRisk=approval_required`;
- `canRequest=false`;
- `recommendation=use_approval_required`.

Solicitar incorretamente em `diagnostic_only`:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":'"${HOST_ID}"',"mode":"diagnostic_only","channel":"mcp","summary":"Restart incorreto","steps":[{"id":"step-1","label":"Restart nginx","command":"systemctl restart nginx","timeoutSeconds":60}]}' \
  "${BASE_URL}/mcp/tools/request-action-run"
```

Resultado esperado:

- HTTP `403`;
- o run nao deve ser criado.

## Cenario 4 - Operacao assistida com aprovacao

Objetivo: permitir comando `approval_required` com aprovacao humana.

Configurar o token na UI:

- capabilities: `evaluate_action_command_policy`, `request_action_run`, `approve_action_run`, `reject_action_run`, `list_host_action_runs`, `get_action_run`;
- modos de `ActionRun`: `approval_required`;
- ator efetivo admin para aprovar/rejeitar via MCP.

Solicitar o run:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":'"${HOST_ID}"',"mode":"approval_required","channel":"mcp","summary":"Reiniciar servico nginx","approvalReason":"Proposta MCP exige aprovacao humana","steps":[{"id":"step-1","label":"Restart nginx","command":"systemctl restart nginx","timeoutSeconds":60}]}' \
  "${BASE_URL}/mcp/tools/request-action-run"
```

Resultado esperado:

- `ActionRun` criado com status `pending_approval`;
- nao executa antes da aprovacao.

Depois, aprovar:

```bash
export RUN_ID=<RUN_ID>

curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"runId":'"${RUN_ID}"',"approvalReason":"Aprovado pelo operador responsavel"}' \
  "${BASE_URL}/mcp/tools/approve-action-run"
```

Resultado esperado:

- status muda para `approved` e depois `running/completed` ou `failed`;
- logs `MCP_TOOL_CALLED`, `AI_SSH_ACTION_RUN_APPROVED` e `AI_SSH_ACTION_RUN_FINISHED`.

## Cenario 5 - Full operational access

Objetivo: permitir execucao automatica de comandos classificados como `approval_required`, sem etapa pendente de aprovacao, mantendo policy e auditoria.

Configurar o token na UI:

- capabilities: `evaluate_action_command_policy`, `request_action_run`, `list_host_action_runs`, `get_action_run`;
- modos de `ActionRun`: `full_operational_access`;
- hosts permitidos: preencher o ID do host que recebera acesso full;
- confirmar explicitamente o aviso de `full_operational_access` no modal;
- token criado por admin ativo do tenant.

Na UI atual, a configuracao recomendada e:

- usar o perfil `Full governado` como ponto de partida;
- revisar as capabilities resultantes;
- buscar e vincular hosts pelo seletor de hosts;
- validar o resumo dinamico de risco antes de salvar.

Avaliar o plano:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"full_operational_access","steps":[{"id":"step-1","label":"Restart nginx","command":"systemctl restart nginx"}]}' \
  "${BASE_URL}/mcp/tools/evaluate-action-command-policy"
```

Resultado esperado:

- `maxRisk=approval_required`;
- `canRequest=true`;
- `recommendation=can_request`.

Solicitar o run full:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":'"${HOST_ID}"',"mode":"full_operational_access","channel":"mcp","summary":"Operacao MCP full governada","steps":[{"id":"step-1","label":"Restart nginx","command":"systemctl restart nginx","timeoutSeconds":60}]}' \
  "${BASE_URL}/mcp/tools/request-action-run"
```

Resultado esperado:

- `ActionRun` criado com status inicial `approved`;
- execucao inicia automaticamente;
- comando ainda passa pela policy antes de executar;
- logs administrativos incluem `MCP_TOOL_CALLED`, `AI_SSH_ACTION_RUN_REQUESTED` e `AI_SSH_ACTION_RUN_FINISHED`.

## Cenario 6 - Full access bloqueado por modo do token

Objetivo: validar que o token precisa permitir `full_operational_access`.

Configurar o token na UI:

- capabilities: `evaluate_action_command_policy`, `request_action_run`;
- modos de `ActionRun`: somente `diagnostic_only`.

Tentar full:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":'"${HOST_ID}"',"mode":"full_operational_access","channel":"mcp","summary":"Full bloqueado por token","steps":[{"id":"step-1","label":"Restart nginx","command":"systemctl restart nginx","timeoutSeconds":60}]}' \
  "${BASE_URL}/mcp/tools/request-action-run"
```

Resultado esperado:

- HTTP `403`;
- action `MCP_DENIED`;
- details contendo `mode=full_operational_access`;
- nenhum `ActionRun` criado.

## Cenario 6.1 - Full access bloqueado por host do token

Objetivo: validar que um token restrito a hosts especificos nao consegue operar outro host.

Configurar o token na UI:

- capabilities: `evaluate_action_command_policy`, `request_action_run`;
- modos de `ActionRun`: `full_operational_access`;
- hosts permitidos: `10`;

Tentar operar outro host:

```bash
export HOST_ID=12

curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":'"${HOST_ID}"',"mode":"full_operational_access","channel":"mcp","summary":"Full bloqueado por host","steps":[{"id":"step-1","label":"Restart nginx","command":"systemctl restart nginx","timeoutSeconds":60}]}' \
  "${BASE_URL}/mcp/tools/request-action-run"
```

Resultado esperado:

- HTTP `403`;
- action `MCP_DENIED`;
- details contendo `hostId=12`;
- nenhum `ActionRun` criado.

## Cenario 7 - Full access com comando bloqueado

Objetivo: validar que `blocked` vence qualquer modo.

Avaliar comando destrutivo:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"full_operational_access","steps":[{"id":"step-1","label":"Comando destrutivo","command":"rm -rf /var/lib/mysql"}]}' \
  "${BASE_URL}/mcp/tools/evaluate-action-command-policy"
```

Resultado esperado:

- `maxRisk=blocked`;
- `canRequest=false`;
- `recommendation=blocked`.

Se a solicitacao for enviada mesmo assim:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":'"${HOST_ID}"',"mode":"full_operational_access","channel":"mcp","summary":"Comando bloqueado","steps":[{"id":"step-1","label":"Comando destrutivo","command":"rm -rf /var/lib/mysql","timeoutSeconds":60}]}' \
  "${BASE_URL}/mcp/tools/request-action-run"
```

Resultado esperado:

- HTTP `403`;
- nenhum `ActionRun` criado.

## Cenario 8 - JSON-RPC com full access

O mesmo fluxo pode ser chamado via `tools/call`.

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"request_action_run","arguments":{"hostId":1,"mode":"full_operational_access","channel":"mcp","summary":"Operacao full via JSON-RPC","steps":[{"id":"step-1","label":"Restart nginx","command":"systemctl restart nginx","timeoutSeconds":60}]}}}' \
  "${BASE_URL}/mcp/jsonrpc"
```

Resultado esperado:

- mesma governanca do endpoint REST;
- capability e modo do token validados;
- policy de comando revalidada;
- logs de MCP e de ActionRun gerados.

## Cenario 9 - Sessao SSH interativa livre

Objetivo: permitir que um cliente MCP opere um shell livre no host, com risco assumido, escopo por token e auditoria.

Configurar o token na UI:

- capabilities: `open_interactive_ssh_session`, `write_interactive_ssh_session`, `read_interactive_ssh_session`, `resize_interactive_ssh_session`, `close_interactive_ssh_session`;
- modos de `ActionRun`: `full_operational_access`;
- hosts permitidos: preencher o ID do host alvo;
- token criado por admin ativo do tenant.

Na UI atual, a configuracao recomendada e:

- usar o perfil `Shell livre` como ponto de partida;
- confirmar explicitamente o full access;
- buscar e vincular hosts permitidos pelo seletor;
- verificar se o resumo de risco indica `Shell livre` com host restrito antes de salvar.

Abrir a sessao:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":'"${HOST_ID}"',"reason":"Manutencao assistida por IA aprovada pelo cliente","ttlSeconds":900,"cols":120,"rows":32}' \
  "${BASE_URL}/mcp/tools/open-interactive-ssh-session"
```

Executar comando livre:

```bash
export SESSION_ID="<SESSION_ID>"

curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"'"${SESSION_ID}"'","data":"uptime\n"}' \
  "${BASE_URL}/mcp/tools/write-interactive-ssh-session"
```

Ler o buffer:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"'"${SESSION_ID}"'","cursor":0,"maxBytes":16000}' \
  "${BASE_URL}/mcp/tools/read-interactive-ssh-session"
```

Fechar:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"'"${SESSION_ID}"'"}' \
  "${BASE_URL}/mcp/tools/close-interactive-ssh-session"
```

Resultado esperado:

- logs `MCP_INTERACTIVE_SSH_OPENED`, `MCP_INTERACTIVE_SSH_INPUT`, `MCP_INTERACTIVE_SSH_OUTPUT_READ` e `MCP_INTERACTIVE_SSH_CLOSED`;
- details contendo `tokenId`, `authMode=persisted_token`, `sessionId` e `hostId`;
- registro em `mcp_interactive_ssh_sessions` com status, motivo de fechamento e bytes;
- se faltar full access explicito, capability ou host permitido, a chamada deve gerar `MCP_DENIED`.

## Cenario 10 - Encerramento administrativo de sessao interativa

Objetivo: permitir que um admin finalize uma sessao MCP shell ativa sem depender do cliente MCP.

Pre-condicao:

- existe uma sessao `open` em `mcp_interactive_ssh_sessions`.

Encerrar pela API admin:

```bash
curl \
  -H "Authorization: Bearer <JWT_ADMIN_WEB>" \
  -H "Content-Type: application/json" \
  -X POST \
  "${BASE_URL}/logs/mcp-interactive-sessions/${SESSION_ID}/close"
```

Resultado esperado:

- resposta com `closed=true`;
- sessao persistida com `status=closed`;
- `closeReason=admin_closed`;
- a UI de logs reflete o encerramento no modal `Sessoes MCP shell`.

## Consultar logs de governanca

Todas as chamadas MCP autenticadas por token persistido usam:

- `authMode=persisted_token`;
- `tokenId=<id do token>`.

Exemplos:

```bash
curl \
  -H "Authorization: Bearer <JWT_ADMIN_WEB>" \
  "${BASE_URL}/logs/admin?targetType=MCP&action=MCP_DENIED&mcpTokenId=1&mcpAuthMode=persisted_token"
```

```bash
curl \
  -H "Authorization: Bearer <JWT_ADMIN_WEB>" \
  "${BASE_URL}/logs/admin?targetType=MCP&action=MCP_RATE_LIMITED&mcpTokenId=1&mcpAuthMode=persisted_token"
```

Na UI:

1. Abra `Administracao > Tokens MCP`.
2. Clique em `Uso` no token.
3. Use os atalhos `Negados` ou `Rate limit`.
4. Ou abra `Administracao > Logs` e use os filtros rapidos `MCP denied` e `MCP rate limit`.

## Checklist de validacao rapida

1. Criar token MCP com `request_action_run`.
2. Marcar `full_operational_access` em `Modos de ActionRun permitidos`.
3. Preencher `Hosts permitidos` com o ID do host alvo.
4. Confirmar explicitamente o alerta de full access no modal.
5. Avaliar um comando `approval_required`.
6. Confirmar que `canRequest=true` em modo `full_operational_access`.
7. Solicitar o `ActionRun`.
8. Verificar que o run nasce `approved` e executa automaticamente.
9. Testar comando `blocked` e confirmar que falha.
10. Remover `full_operational_access` do token e confirmar `MCP_DENIED`.
11. Trocar o `hostId` para um host fora da lista e confirmar `MCP_DENIED`.
12. Abrir uma sessao interativa, enviar `uptime\n`, ler o buffer e fechar a sessao.
13. Validar a sessao persistida no modal `Sessoes MCP shell`.
14. Encerrar administrativamente uma sessao `open` e confirmar `closeReason=admin_closed`.
15. Validar logs em `Administracao > Logs`.

## Proximos passos

- fechar checklist de producao para liberar clientes com acesso full via IA;
- definir como sessoes interativas vao se comportar em multi-replica;
- decidir se revogar token deve encerrar sessoes abertas imediatamente ou apenas bloquear novas operacoes;
- manter a recomendacao de preferir `ActionRun` governado quando o caso nao exigir shell livre.
