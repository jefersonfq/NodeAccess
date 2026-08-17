# Operations Lite - MCP no NodeAccess

Guia curto para configurar, validar e usar o primeiro corte do MCP no backend.

## Estado atual
O modulo MCP atual entrega:
- autenticacao por JWT do usuario, ou por token tecnico estatico
- tokens MCP persistidos por tenant
- tela admin para criar, editar, revogar e consultar uso rapido de tokens
- tela admin `Tokens MCP` com UX guiada por perfil, busca de hosts, tooltips e exemplos de uso
- restricao opcional de modos de `ActionRun` por token MCP
- ponte JSON-RPC para discovery, tools e resources
- discovery de capabilities, tools, resources e prompts
- leitura governada de:
  - busca de hosts
  - busca de snippets
  - dashboard do host
  - execucoes de diagnostico por host
  - detalhe de `DiagnosticRun`
  - execucoes de acoes por IA por host
  - detalhe de `ActionRun`
- tools governadas de acao:
  - avaliar policy de comando SSH por IA
  - solicitar `ActionRun`
  - cancelar `ActionRun`
  - aprovar `ActionRun` com ator admin
  - rejeitar `ActionRun` com ator admin
- tools de sessao SSH interativa livre:
  - abrir sessao interativa
  - escrever no shell
  - ler buffer de saida
  - redimensionar terminal
  - fechar sessao
- allowlist por capability
- rate limit basico por principal e capability
- auditoria MCP com `authMode` e `tokenId` para tokens persistidos
- auditoria de negacao MCP para capability, modo de `ActionRun` e rate limit
- tela `Tokens MCP` com ultima chamada/capability auditada por token

Ainda nao entrega:
- JSON-RPC completo do protocolo MCP

Capabilities de sessao interativa:
- `open_interactive_ssh_session`
- `write_interactive_ssh_session`
- `read_interactive_ssh_session`
- `resize_interactive_ssh_session`
- `close_interactive_ssh_session`

Limites da sessao interativa nesta versao:
- exige token MCP persistido, ator admin e `full_operational_access` explicitamente permitido no token
- respeita `allowedHostIds` na abertura da sessao
- limita TTL por sessao e quantidade de sessoes simultaneas por token e tenant
- pode exigir `allowedHostIds` explicitamente para qualquer token de shell livre
- persiste um registro consolidado por sessao em `mcp_interactive_ssh_sessions`
- expõe consulta administrativa de sessoes persistidas e filtro por token, host e status
- permite encerramento administrativo explicito de sessao ativa
- usa registry em memoria, sem persistencia entre restarts e sem compartilhamento entre replicas
- suporta rota SSH direta com bastion efetivo, mas nao hosts via Agent

## Variaveis de ambiente

```bash
FEATURE_MCP=true
MCP_STATIC_TOKEN=defina_um_token_forte
MCP_STATIC_TENANT_SLUG=tenant-alvo
MCP_ALLOWED_CAPABILITIES=search_hosts,search_snippets,get_host_dashboard,list_host_diagnostic_runs,get_diagnostic_run,list_host_action_runs,get_action_run,evaluate_action_command_policy,request_action_run,cancel_action_run,approve_action_run,reject_action_run,open_interactive_ssh_session,write_interactive_ssh_session,read_interactive_ssh_session,resize_interactive_ssh_session,close_interactive_ssh_session
MCP_RATE_LIMIT_WINDOW_SECONDS=60
MCP_RATE_LIMIT_MAX_REQUESTS=120
MCP_INTERACTIVE_SSH_DEFAULT_TTL_SECONDS=900
MCP_INTERACTIVE_SSH_MAX_TTL_SECONDS=3600
MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TOKEN=3
MCP_INTERACTIVE_SSH_MAX_SESSIONS_PER_TENANT=20
MCP_INTERACTIVE_SSH_REQUIRE_ALLOWED_HOSTS=false
AI_SSH_ACTION_SAFE_COMMAND_PATTERNS=
AI_SSH_ACTION_APPROVAL_COMMAND_PATTERNS=
AI_SSH_ACTION_BLOCKED_COMMAND_PATTERNS=
```

## Regras de autenticacao

### Opcao 1 - JWT normal
Se a chamada ja estiver autenticada com JWT valido do produto, o MCP usa esse usuario.

Vantagem:
- respeita diretamente o escopo e perfil do usuario logado

Uso indicado:
- assistente interno
- frontend autenticado
- automacoes acopladas ao contexto da sessao do usuario

### Opcao 2 - Token tecnico estatico
Se nao houver JWT, as rotas MCP aceitam:
- `Authorization: Bearer <MCP_STATIC_TOKEN>`
- ou `x-mcp-token: <MCP_STATIC_TOKEN>`

Esse token resolve o tenant por `MCP_STATIC_TENANT_SLUG` e atua como o primeiro admin ativo encontrado nesse tenant.

Uso indicado:
- validacao local
- primeiros testes com cliente externo

Restricao:
- este nao e o modelo final de governanca
- em producao, a evolucao correta e token MCP persistido por tenant

## Governanca por token

Tokens MCP persistidos podem restringir:
- capabilities permitidas
- modos de `ActionRun` permitidos para `request_action_run`
- hosts permitidos por ID para `request_action_run`
- expiracao

Modos suportados:
- `read_only`
- `diagnostic_only`
- `approval_required`
- `full_operational_access`

Recomendacao atual:
- tokens de consulta: sem `request_action_run`
- tokens de diagnostico: `request_action_run` + `read_only` e `diagnostic_only`
- tokens de operacao assistida: incluir `approval_required`
- tokens de operacao completa: incluir `full_operational_access` somente para clientes MCP administrados, com policy e auditoria validadas
- tokens de sessao interativa: sempre preencher hosts permitidos antes de habilitar capabilities de shell livre

Se nenhum modo for marcado, o token nao recebe restricao adicional por modo para `ActionRun`. Para sessao interativa, `full_operational_access` precisa estar marcado explicitamente. Se nenhum host for informado, o token continua limitado apenas pelo escopo do usuario efetivo, mas para shell livre a recomendacao operacional e sempre preencher hosts permitidos. Para novos tokens criados pela UI, leitura e diagnostico ja ficam marcados por padrao.

## UX atual da tela Tokens MCP

A tela administrativa de tokens MCP agora foi ajustada para reduzir erro de configuracao e acelerar o onboarding operacional.

Hoje ela oferece:

- cards de resumo com:
  - tokens ativos
  - tokens com uso auditado
  - tokens com `full_operational_access`
  - tokens com `shell livre`
- perfis rapidos para criacao:
  - `Consulta`
  - `Diagnostico`
  - `Operacao assistida`
  - `Full governado`
  - `Shell livre`
- resumo dinamico de risco do token durante a edicao
- busca e vinculacao de hosts por nome ou IP, sem depender de digitacao manual de IDs
- resumo visual dos hosts vinculados logo abaixo do seletor
- tooltips nas capabilities com descricao, risco e modulo
- tooltips nos modos de `ActionRun` com explicacao operacional
- modal `Uso` com exemplos de:
  - discovery
  - leitura basica
  - avaliacao de policy
  - solicitacao de `ActionRun`
  - abertura de shell interativo quando o token permitir

Diretriz operacional:

- usar perfis como ponto de partida, nao como permissao definitiva;
- sempre revisar hosts permitidos antes de salvar tokens com `full` ou `shell`;
- preferir `ActionRun` governado quando shell livre nao for necessario.

## Endpoints disponiveis

### Governanca de tokens
- `GET /api/v1/mcp/admin/tokens`
- `POST /api/v1/mcp/admin/tokens`
- `PATCH /api/v1/mcp/admin/tokens/:id`
- `POST /api/v1/mcp/admin/tokens/:id/revoke`

### Logs administrativos com foco em MCP
- `GET /api/v1/logs/admin`
  - filtros uteis:
    - `action=MCP_TOOL_CALLED|MCP_RESOURCE_READ`
    - `action=MCP_DENIED|MCP_RATE_LIMITED`
    - `targetType=MCP|McpToken`
    - `mcpTokenId=<id>`
    - `mcpAuthMode=jwt|persisted_token|static_token`
- `GET /api/v1/logs/mcp-interactive-sessions`
  - filtros uteis:
    - `search=<sessionId|host|user>`
    - `status=open|closed|expired|failed`
    - `hostId=<id>`
    - `tokenId=<id>`
    - `page=<n>`
    - `limit=<n>`
- `POST /api/v1/logs/mcp-interactive-sessions/:sessionId/close`
  - fecha administrativamente uma sessao MCP shell ativa

### Discovery
- `POST /api/v1/mcp/jsonrpc`
- `GET /api/v1/mcp/capabilities`
- `GET /api/v1/mcp/tools`
- `GET /api/v1/mcp/resources`
- `GET /api/v1/mcp/prompts`
- `GET /api/v1/mcp/prompts/:key`

### Tools
- `POST /api/v1/mcp/tools/search-hosts`
- `POST /api/v1/mcp/tools/search-snippets`
- `POST /api/v1/mcp/tools/evaluate-action-command-policy`
- `POST /api/v1/mcp/tools/request-action-run`
- `POST /api/v1/mcp/tools/cancel-action-run`
- `POST /api/v1/mcp/tools/approve-action-run`
- `POST /api/v1/mcp/tools/reject-action-run`
- `POST /api/v1/mcp/tools/open-interactive-ssh-session`
- `POST /api/v1/mcp/tools/write-interactive-ssh-session`
- `POST /api/v1/mcp/tools/read-interactive-ssh-session`
- `POST /api/v1/mcp/tools/resize-interactive-ssh-session`
- `POST /api/v1/mcp/tools/close-interactive-ssh-session`

### Resources
- `GET /api/v1/mcp/resources/hosts/:id/dashboard`
- `GET /api/v1/mcp/resources/hosts/:id/diagnostic-runs`
- `GET /api/v1/mcp/resources/diagnostic-runs/:runId`
- `GET /api/v1/mcp/resources/hosts/:id/ai-ssh-action-runs`
- `GET /api/v1/mcp/resources/ai-ssh-action-runs/:runId`

## Exemplos de uso

### Codex CLI local

O cadastro do cliente usa apenas o nome da variavel, nunca o token literal:

```bash
codex mcp add nodeaccess \
  --url http://127.0.0.1:3000/api/v1/mcp/jsonrpc \
  --bearer-token-env-var NODEACCESS_MCP_TOKEN
```

Para evitar digitacao interativa e manter o segredo fora do repositorio, salve o
token persistido em `~/.config/nodeaccess/codex-mcp-token`, aplique permissao
`0600` e inicie o cliente pelo launcher:

```bash
chmod 0600 ~/.config/nodeaccess/codex-mcp-token
./scripts/codex-nodeaccess.sh
```

O launcher exporta `NODEACCESS_MCP_TOKEN` apenas para o processo do Codex. A
capability `search_hosts` exige um termo de busca nao vazio; probes com `query`
vazia retornam `MCP_QUERY_REQUIRED` por desenho.

Na primeira execucao, ou quando o arquivo estiver vazio, o launcher solicita o
token automaticamente. Para substituir uma credencial existente:

```bash
./scripts/codex-nodeaccess.sh --setup-token
```

O prompt permanece visivel, mas os caracteres do token nao aparecem enquanto
sao digitados ou colados. O valor e salvo fora do repositorio com permissao
`0600`.

### Listar capabilities

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  http://localhost:3000/api/v1/mcp/capabilities
```

### JSON-RPC initialize

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"test-client","version":"0.1.0"}}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC tools/list

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC prompts/get

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"prompts/get","params":{"name":"summarize_diagnostic_run"}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### REST prompt especifico

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  http://localhost:3000/api/v1/mcp/prompts/summarize_diagnostic_run
```

### JSON-RPC tools/call

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_hosts","arguments":{"query":"db","limit":5}}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC tools/call para solicitar action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"request_action_run","arguments":{"hostId":1,"mode":"diagnostic_only","channel":"mcp","summary":"Coleta operacional via MCP","steps":[{"id":"step-1","label":"Carga atual","command":"uptime","timeoutSeconds":15}]}}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC tools/call para avaliar policy de comando

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"evaluate_action_command_policy","arguments":{"command":"systemctl restart nginx"}}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

## Validacao local da sessao interativa

Preparar ambiente local com mock SSH e token MCP persistido:

```bash
node tools/load-tests/scripts/mock-ssh-server.js
LOADTEST_USER_COUNT=10 node tools/load-tests/scripts/seed-local-loadtest.js
node tools/load-tests/scripts/seed-mcp-interactive-token.js
```

O script `seed-mcp-interactive-token.js`:

- habilita `mcp` e `aiSshActions` no tenant `loadtest`;
- cria ou atualiza o admin `loadtest-mcp-admin@nodeaccess.local`;
- cria token persistido com as cinco capabilities interativas;
- restringe o token ao primeiro host `loadtest-mock-*`;
- imprime o valor do token para usar nos curls.

Para validar o fluxo completo automaticamente:

```bash
MCP_VALIDATE_BASE_URL=http://127.0.0.1:3013/api/v1 \
node tools/load-tests/scripts/validate-mcp-interactive-ssh.js
```

O validador prepara um token MCP temporario, chama `tools`, abre sessao, envia `uptime`, le output, fecha, testa bloqueio por host fora do allowlist, confere auditoria e valida o registro persistido em `mcp_interactive_ssh_sessions`.

Subir a API:

```bash
FEATURE_MCP=true APP_PORT_API=3013 npm run dev -w apps/backend
```

Abrir sessao:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":6,"reason":"Validacao MCP interativa local","ttlSeconds":120,"cols":120,"rows":32}' \
  http://127.0.0.1:3013/api/v1/mcp/tools/open-interactive-ssh-session
```

Enviar comando e ler output:

```bash
curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"'"${SESSION_ID}"'","data":"uptime\n"}' \
  http://127.0.0.1:3013/api/v1/mcp/tools/write-interactive-ssh-session

curl \
  -H "Authorization: Bearer ${MCP_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"'"${SESSION_ID}"'","cursor":0,"maxBytes":16000}' \
  http://127.0.0.1:3013/api/v1/mcp/tools/read-interactive-ssh-session
```

Resultado esperado no mock:

- output contendo `Welcome to NodeAccess mock SSH`;
- output contendo `load average`;
- logs `MCP_INTERACTIVE_SSH_*` com `authMode=persisted_token`, `tokenId`, `sessionId` e `hostId`;
- registro persistido da sessao com `status=closed`, `closeReason=client_closed`, bytes de entrada e bytes de saida lidos;
- tentativa com host fora de `allowedHostIds` retorna `403` e gera `MCP_DENIED` com `capability=open_interactive_ssh_session`.

## Operacao administrativa das sessoes MCP shell

Na UI:

- `Administracao > Tokens MCP > Shell` abre `Administracao > Logs` com o modal `Sessoes MCP shell` filtrado por token;
- o modal lista sessoes persistidas com host, usuario, status, bytes, fechamento e motivo;
- sessoes `open` podem ser encerradas pelo admin com a acao `Encerrar`.

No backend:

- o encerramento administrativo usa `POST /api/v1/logs/mcp-interactive-sessions/:sessionId/close`;
- o registro persistido passa para `status=closed` com `closeReason=admin_closed`;
- a trilha administrativa continua em `admin_logs` e a trilha consolidada fica em `mcp_interactive_ssh_sessions`.

## Proximos passos recomendados

- consolidar checklist final de producao para clientes que vao habilitar shell livre via IA;
- definir estrategia para multi-replica, sticky routing ou estado compartilhado das sessoes interativas;
- decidir politica de revogacao imediata de token com sessao shell ativa;
- endurecer limites por ambiente, tenant e token conforme a exposicao crescer.

### JSON-RPC tools/call para avaliar um plano de steps

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"evaluate_action_command_policy","arguments":{"mode":"diagnostic_only","steps":[{"id":"step-1","label":"Carga atual","command":"uptime"},{"id":"step-2","label":"Reiniciar nginx","command":"systemctl restart nginx"}]}}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC tools/call para cancelar action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"cancel_action_run","arguments":{"runId":12}}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC tools/call para aprovar action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"approve_action_run","arguments":{"runId":12,"approvalReason":"Aprovado pelo fluxo MCP"}}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC tools/call para rejeitar action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"reject_action_run","arguments":{"runId":12,"approvalReason":"Rejeitado pelo fluxo MCP"}}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC resources/read

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"resources/read","params":{"uri":"nodeaccess://hosts/1/dashboard?periodDays=30"}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC resources/read filtrando status de diagnostico

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":10,"method":"resources/read","params":{"uri":"nodeaccess://hosts/1/diagnostic-runs?status=running,failed"}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC resources/read filtrando status da IA no diagnostico

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":11,"method":"resources/read","params":{"uri":"nodeaccess://hosts/1/diagnostic-runs?aiSummaryStatus=READY,FAILED"}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC resources/read filtrando status de action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":9,"method":"resources/read","params":{"uri":"nodeaccess://hosts/1/ai-ssh-action-runs?status=running,failed"}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### JSON-RPC resources/read filtrando canal e modo de action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":12,"method":"resources/read","params":{"uri":"nodeaccess://hosts/1/ai-ssh-action-runs?channel=mcp,local_ai&mode=diagnostic_only,approval_required"}}' \
  http://localhost:3000/api/v1/mcp/jsonrpc
```

### Listar tools

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  http://localhost:3000/api/v1/mcp/tools
```

### Buscar hosts

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"db","limit":5}' \
  http://localhost:3000/api/v1/mcp/tools/search-hosts
```

### Buscar snippets

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query":"mysql","limit":5}' \
  http://localhost:3000/api/v1/mcp/tools/search-snippets
```

### Ler dashboard do host

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  "http://localhost:3000/api/v1/mcp/resources/hosts/1/dashboard?periodDays=30"
```

### Listar diagnosticos do host

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  http://localhost:3000/api/v1/mcp/resources/hosts/1/diagnostic-runs
```

### Listar diagnosticos do host filtrando status

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  "http://localhost:3000/api/v1/mcp/resources/hosts/1/diagnostic-runs?status=running,failed"
```

### Listar diagnosticos do host filtrando status da IA

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  "http://localhost:3000/api/v1/mcp/resources/hosts/1/diagnostic-runs?aiSummaryStatus=READY,FAILED"
```

### Ler detalhe de um diagnostico

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  http://localhost:3000/api/v1/mcp/resources/diagnostic-runs/10
```

### Solicitar action run

Antes de solicitar, a integracao ou IA deve avaliar o comando ou o plano de steps com `evaluate-action-command-policy`. Isso permite escolher `diagnostic_only`, `approval_required` ou bloquear a proposta antes de criar o `ActionRun`.

O backend tambem valida a policy novamente no `request-action-run`; a avaliacao previa e uma etapa de UX e decisao para a IA, nao a unica barreira de seguranca.

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":1,"mode":"diagnostic_only","channel":"mcp","summary":"Coleta operacional via MCP","steps":[{"id":"step-1","label":"Carga atual","command":"uptime","timeoutSeconds":15}]}' \
  http://localhost:3000/api/v1/mcp/tools/request-action-run
```

### Avaliar policy de comando SSH por IA

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"command":"systemctl restart nginx"}' \
  http://localhost:3000/api/v1/mcp/tools/evaluate-action-command-policy
```

### Avaliar policy de plano de steps por IA

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"diagnostic_only","steps":[{"id":"step-1","label":"Carga atual","command":"uptime"},{"id":"step-2","label":"Reiniciar nginx","command":"systemctl restart nginx"}]}' \
  http://localhost:3000/api/v1/mcp/tools/evaluate-action-command-policy
```

Resposta esperada:
- `safe`: pode seguir em modo `read_only` ou `diagnostic_only`, conforme o contexto
- `approval_required`: deve criar `ActionRun` em modo `approval_required`
- `blocked`: nao deve solicitar execucao

Quando `steps` for enviado, a resposta inclui:
- `maxRisk`
- `canRequest`
- `recommendation`
- `approvalRequiredSteps`
- `blockedSteps`
- classificacao por step

### Solicitar action run com aprovacao obrigatoria

Use `approval_required` quando a IA ou integracao precisar propor comando com impacto operacional controlado. A solicitacao fica pendente ate aprovacao administrativa.

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"hostId":1,"mode":"approval_required","channel":"mcp","summary":"Reiniciar servico apos validacao de incidente","approvalReason":"Proposta gerada por IA e exige aprovacao humana","steps":[{"id":"step-1","label":"Reiniciar servico nginx","command":"systemctl restart nginx","timeoutSeconds":60}]}' \
  http://localhost:3000/api/v1/mcp/tools/request-action-run
```

Regras atuais:
- `read_only` e `diagnostic_only` aceitam apenas comandos classificados como seguros
- `approval_required` aceita comandos de risco operacional controlado, mas nao executa antes da aprovacao
- comandos destrutivos continuam bloqueados em qualquer modo
- `full_operational_access` exige ator admin, token MCP com esse modo permitido quando houver restricao por token, e continua negando comandos classificados como `blocked`
- quando o token MCP possuir modos permitidos, `request_action_run` e bloqueado se o modo solicitado nao estiver na lista

### Overrides de policy de comandos por ambiente

As variaveis abaixo aceitam regex separadas por `;;`.

```bash
AI_SSH_ACTION_SAFE_COMMAND_PATTERNS="^systemctl status nginx$"
AI_SSH_ACTION_APPROVAL_COMMAND_PATTERNS="^docker restart "
AI_SSH_ACTION_BLOCKED_COMMAND_PATTERNS="^mysql .*--execute=.*DROP"
```

Precedencia:
- `blocked` padrao e customizado sempre vence
- `safe` customizado so vale se nao bater em `blocked`
- `approval_required` padrao e customizado exige aprovacao administrativa

### Cancelar action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"runId":12}' \
  http://localhost:3000/api/v1/mcp/tools/cancel-action-run
```

### Aprovar action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"runId":12,"approvalReason":"Aprovado pelo fluxo MCP"}' \
  http://localhost:3000/api/v1/mcp/tools/approve-action-run
```

### Rejeitar action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"runId":12,"approvalReason":"Rejeitado pelo fluxo MCP"}' \
  http://localhost:3000/api/v1/mcp/tools/reject-action-run
```

### Listar actions por IA do host

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  http://localhost:3000/api/v1/mcp/resources/hosts/1/ai-ssh-action-runs
```

### Listar actions por IA do host filtrando status

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  "http://localhost:3000/api/v1/mcp/resources/hosts/1/ai-ssh-action-runs?status=running,failed"
```

### Listar actions por IA do host filtrando canal e modo

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  "http://localhost:3000/api/v1/mcp/resources/hosts/1/ai-ssh-action-runs?channel=mcp,local_ai&mode=diagnostic_only,approval_required"
```

### Ler detalhe de um action run

```bash
curl \
  -H "Authorization: Bearer ${MCP_STATIC_TOKEN}" \
  http://localhost:3000/api/v1/mcp/resources/ai-ssh-action-runs/12
```

## Como validar rapidamente

1. habilitar `FEATURE_MCP=true`
2. definir `MCP_STATIC_TOKEN`
3. definir `MCP_STATIC_TENANT_SLUG`
4. subir o backend
5. abrir `Administracao > Tokens MCP`
6. criar um token MCP persistido
7. testar `POST /api/v1/mcp/jsonrpc` com `initialize`
8. testar `GET /api/v1/mcp/capabilities`
9. testar `GET /api/v1/mcp/tools`
10. testar `POST /api/v1/mcp/tools/search-hosts`
11. testar `resources/read` via JSON-RPC para host, diagnostico ou action run
12. testar `evaluate_action_command_policy` via JSON-RPC ou REST antes de criar um `ActionRun`
13. testar `tools/call` ou REST para criar um `ActionRun`
14. testar cancelamento do `ActionRun`
15. se o token/JWT for admin, testar aprovacao e rejeicao do `ActionRun`
16. clicar em `Logs` no token e validar a trilha filtrada por `targetId`
17. clicar em `Tools`, `Resources` ou `Approvals` em um token MCP e validar:
    - `targetType=MCP`
    - `mcpTokenId` preenchido
    - `mcpAuthMode=persisted_token`
18. abrir `Administracao > Logs` e usar os filtros `JWT`, `Token MCP` e `Token estatico`

## Erros esperados

### `403 MCP desabilitado neste ambiente`
`FEATURE_MCP` nao esta habilitado.

### `401 Token MCP invalido`
o token enviado nao bate com `MCP_STATIC_TOKEN`.

### `401 Tenant MCP nao configurado`
`MCP_STATIC_TENANT_SLUG` nao foi definido.

### `401 Tenant MCP invalido ou inativo`
o slug informado nao resolve um tenant ativo.

### `401 Nenhum admin ativo disponivel para MCP neste tenant`
o tenant existe, mas nao ha admin ativo para resolver a identidade tecnica.

### `403 Capability MCP bloqueada`
`MCP_ALLOWED_CAPABILITIES` foi definido e a capability chamada nao esta na allowlist.

### `403 Modo de ActionRun nao permitido para este token MCP`
o token MCP persistido possui restricao de modos e a chamada tentou solicitar um `mode` nao permitido.

### `403 MCP_ACTION_RUN_APPROVAL_FORBIDDEN`
o ator MCP autenticado nao tem perfil administrativo para aprovar um `ActionRun`.

### `403 MCP_ACTION_RUN_REJECTION_FORBIDDEN`
o ator MCP autenticado nao tem perfil administrativo para rejeitar um `ActionRun`.

### `400 MCP_ACTION_RUN_STATUS_NOT_SUPPORTED`
o filtro `status` enviado para listar `ActionRuns` contem um valor fora da lista suportada.

### `400 MCP_DIAGNOSTIC_RUN_STATUS_NOT_SUPPORTED`
o filtro `status` enviado para listar `DiagnosticRuns` contem um valor fora da lista suportada.

### `400 MCP_DIAGNOSTIC_AI_SUMMARY_STATUS_NOT_SUPPORTED`
o filtro `aiSummaryStatus` enviado para listar `DiagnosticRuns` contem um valor fora da lista suportada.

### `400 MCP_ACTION_RUN_CHANNEL_NOT_SUPPORTED`
o filtro `channel` enviado para listar `ActionRuns` contem um valor fora da lista suportada.

### `400 MCP_ACTION_RUN_MODE_NOT_SUPPORTED`
o filtro `mode` enviado para listar `ActionRuns` contem um valor fora da lista suportada.

### `429 MCP_RATE_LIMITED`
o principal excedeu o limite definido por janela.

### `MCP_JSONRPC_METHOD_NOT_SUPPORTED`
o metodo JSON-RPC enviado ainda nao foi implementado neste corte.

### `MCP_JSONRPC_RESOURCE_NOT_SUPPORTED`
a `uri` enviada em `resources/read` nao bate com os resources suportados hoje.

## Observacoes de seguranca
- preferir allowlist explicita de capabilities
- nao reutilizar o token tecnico em outros modulos
- usar tenant dedicado para testes quando possivel
- nao expor `MCP_STATIC_TOKEN` em frontend publico
- tratar o token tecnico atual como provisao temporaria para a frente
- preferir tokens persistidos do tenant para integracoes reais
- usar expiracao quando o cliente MCP nao for permanente
- revisar logs por token especifico quando houver duvida sobre uso
- usar `mcpAuthMode` nos logs para separar uso humano com JWT de uso tecnico com token MCP
- usar a coluna `Ultima chamada` em `Tokens MCP` para triagem rapida antes de abrir os logs completos
- aprovar `ActionRun` via MCP apenas quando o ator for realmente admin e o fluxo exigir isso
- rejeitar `ActionRun` via MCP apenas quando o ator for realmente admin e o fluxo exigir isso

## Proximo passo recomendado
- logs MCP filtrados por token ja estao disponiveis na UI
- formato mais aderente ao protocolo MCP completo
- politica mais fina por token, incluindo renovacao controlada e possivel IP allowlist futura
- avaliar filtros por `aiSummaryStatus`, `channel` e `mode` no consumo real, antes de adicionar novos eixos
