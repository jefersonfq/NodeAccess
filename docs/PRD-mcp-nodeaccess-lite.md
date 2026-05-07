# PRD Lite - MCP no NodeAccess

## Objetivo
Avaliar e introduzir MCP no NodeAccess como camada padronizada para expor contexto operacional, recursos e ferramentas controladas para assistentes de IA, mantendo isolamento por tenant, permissoes existentes e auditoria completa.

MCP deve ser tratado como interface de integracao e nao como regra de negocio. A regra de negocio continua nos modulos existentes de hosts, sessoes, auditoria, snippets, dashboards e permissoes.

## Problema
O NodeAccess concentra informacoes valiosas para operacao:
- hosts e grupos
- sessoes SSH
- auditoria de comandos
- dashboards por host
- falhas de conexao
- snippets e procedimentos
- origem de acesso e trilhas administrativas

Sem uma interface padronizada, cada assistente ou integracao de IA exigiria uma integracao propria, aumentando acoplamento, custo de manutencao e risco de exposicao indevida de dados.

## Beneficios esperados
- permitir que assistentes consultem dados do NodeAccess com contexto real
- reduzir copia manual de informacoes entre telas e ferramentas externas
- reutilizar permissoes, escopo de usuario e tenant isolation ja existentes
- criar base governada para IA operacional
- facilitar integracoes futuras sem criar APIs especificas para cada ferramenta
- melhorar analise de auditoria, incidentes e historico de hosts

## Estado atual relevante do produto
O NodeAccess ja possui base suficiente para iniciar MCP sem inventar uma camada paralela de negocio.

Modulos e dados que ja existem e podem ser expostos de forma governada:
- hosts e grupos com escopo por usuario/tenant
- dashboard por host
- sessoes SSH e auditoria
- comandos reconstruidos por sessao
- snippets
- diagnostic playbooks e `DiagnosticRun`
- logs administrativos e trilhas de acesso

Direcao tecnica:
- MCP deve reutilizar services existentes
- MCP nao deve criar consultas diretas ao banco fora dos modulos do produto
- MCP deve expor primeiro apenas o que ja esta disponivel na UI ou em APIs internas consolidadas

## Principio de seguranca
Comecar por MCP read-only.

No primeiro corte, MCP nao deve:
- executar comando SSH
- abrir sessao SSH
- alterar hosts
- alterar credenciais
- revelar senhas, PEM, tokens ou valores resolvidos de 1Password
- acessar dados fora do escopo do usuario autenticado

## Formas de uso

### NodeAccess como MCP Server
O NodeAccess expoe recursos e ferramentas para clientes externos de IA.

Exemplos:
- listar hosts acessiveis
- consultar resumo de host
- consultar dashboard de host
- consultar sessoes recentes
- consultar auditoria de sessao
- consultar comandos reconstruidos
- buscar snippets

### NodeAccess como MCP Client
O NodeAccess consome servidores MCP externos para enriquecer contexto.

Exemplos:
- Jira
- GitLab
- Confluence
- Grafana
- Zabbix
- CMDB
- base documental interna

Recomendacao: iniciar por NodeAccess como MCP Server read-only. MCP Client deve vir depois, quando a camada de governanca estiver consolidada.

## Capacidades iniciais recomendadas

### Resources
- `nodeaccess://me`
- `nodeaccess://hosts`
- `nodeaccess://hosts/{id}`
- `nodeaccess://hosts/{id}/dashboard`
- `nodeaccess://hosts/{id}/sessions`
- `nodeaccess://hosts/{id}/diagnostic-playbooks`
- `nodeaccess://hosts/{id}/diagnostic-runs`
- `nodeaccess://sessions/{id}/audit`
- `nodeaccess://sessions/{id}/commands`
- `nodeaccess://diagnostic-runs/{id}`

### Tools read-only
- `search_hosts`
- `get_host_summary`
- `get_host_dashboard`
- `list_host_sessions`
- `get_session_audit`
- `list_session_commands`
- `search_snippets`
- `list_diagnostic_playbooks`
- `list_host_diagnostic_runs`
- `get_diagnostic_run`

### Prompts
- `summarize_host`
- `investigate_failed_connections`
- `prepare_audit_report`
- `review_session_commands`
- `summarize_diagnostic_run`

## Autorizacao
Cada chamada MCP deve aplicar:
- tenant do usuario autenticado
- papel do usuario
- grupos do usuario
- escopo do host: personal, team, global
- permissoes granulares futuras quando RBAC estiver habilitado
- limites de licenca quando aplicavel

MCP nunca deve consultar banco diretamente sem passar por services/repositorios que ja aplicam escopo.

## Auditoria
Toda chamada MCP deve gerar trilha auditavel.

Eventos sugeridos:
- `MCP_TOKEN_CREATED`
- `MCP_TOKEN_REVOKED`
- `MCP_RESOURCE_READ`
- `MCP_TOOL_CALLED`
- `MCP_DENIED`
- `MCP_RATE_LIMITED`

Campos minimos:
- tenant
- usuario
- client id ou token id
- capability chamada
- parametros sanitizados
- status
- duracao
- origem IP quando disponivel

## Configuracao administrativa
Adicionar em Configuracoes:
- habilitar/desabilitar MCP por tenant
- criar/revogar tokens MCP
- escopos permitidos por token
- allowlist de tools/resources
- modo read-only
- rate limit
- expiracao do token
- ultima atividade
- logs de chamadas

## Arquitetura sugerida
Modulo separado no backend:

```txt
apps/backend/src/modules/mcp
```

Arquivos sugeridos:

```txt
mcp.routes.ts
mcp.controller.ts
mcp.service.ts
mcp.capabilities.ts
mcp.authorization.ts
mcp.audit.ts
mcp.schemas.ts
```

Nao colocar MCP no gateway SSH. Gateway deve continuar focado em transporte SSH/WebSocket.

## Rollout recomendado

### Fase 0 - PRD e matriz de risco
- definir capabilities
- definir dados proibidos
- definir auditoria
- definir politica por tenant

### Fase 1 - MCP Server read-only
- resources de hosts, dashboards, sessoes e diagnosticos
- tools read-only
- auditoria basica
- feature flag
- contrato inicial de autenticacao tecnica

Backlog sugerido da Fase 1:

1. Contratos e catalogo de capabilities
- criar `mcp.capabilities.ts` com allowlist explicita
- classificar cada capability como `resource`, `tool` ou `prompt`
- marcar cada capability com dependencia de modulo, escopo e risco

2. Transporte e autenticacao
- criar endpoint MCP no backend API, separado do gateway SSH
- suportar autenticacao tecnica por token proprio do MCP
- negar uso quando o tenant estiver com MCP desligado

3. Read-only de hosts e dashboards
- `search_hosts`
- `get_host_summary`
- `get_host_dashboard`
- `nodeaccess://hosts`
- `nodeaccess://hosts/{id}`
- `nodeaccess://hosts/{id}/dashboard`

4. Read-only de sessoes e auditoria
- `list_host_sessions`
- `get_session_audit`
- `list_session_commands`
- `nodeaccess://hosts/{id}/sessions`
- `nodeaccess://sessions/{id}/audit`
- `nodeaccess://sessions/{id}/commands`

5. Read-only de diagnosticos
- `list_diagnostic_playbooks`
- `list_host_diagnostic_runs`
- `get_diagnostic_run`
- `nodeaccess://hosts/{id}/diagnostic-playbooks`
- `nodeaccess://hosts/{id}/diagnostic-runs`
- `nodeaccess://diagnostic-runs/{id}`

6. Auditoria e limites
- registrar `MCP_RESOURCE_READ`, `MCP_TOOL_CALLED`, `MCP_DENIED`
- guardar token/client id, usuario efetivo, tenant, capability, latencia e status
- aplicar rate limit por token e por tenant

7. Hardening do payload
- sanitizar parametros livres
- truncar listas e blobs muito grandes
- jamais retornar segredo, PEM, password ou valor resolvido de secret
- manter saidas de auditoria e diagnostico no mesmo padrao de redaction do produto

8. Testes e validacao
- testes de autorizacao cross-tenant
- testes de escopo de host
- testes de negacao por capability desabilitada
- smoke test com cliente MCP contra ambiente local

### Fase 2 - Tela administrativa
- tokens
- allowlist
- logs
- rate limit

### Fase 3 - Integracao com Assistente Local
- usar as mesmas capabilities internamente
- evitar duplicidade entre assistente interno e MCP externo

### Fase 4 - Acoes controladas
Somente depois de estabilizar leitura.

Possiveis tools com confirmacao:
- `test_host_connection`
- `request_diagnostic_run`
- `request_diagnostic_summary`
- `export_audit_report`
- `create_snippet`
- `open_host_terminal_proposal`

Execucao de comando SSH direta deve ficar fora do primeiro ciclo.

### Fase 5 - Autonomia controlada
Somente depois de policy, auditoria e aprovacao por tenant estarem maduras.

Direcao:
- mesma camada interna de capabilities para UI, assistente interno, GPT, Claude ou cliente MCP
- modo `read_only`, `approval_required` e `autonomous`
- autonomia nunca implicita
- sem shell arbitrario livre
- diagnosticos e acoes devem continuar governados por playbooks, tools e policies

### Fase 6 - Acesso operacional amplo por IA com autorizacao explicita
O produto pode evoluir para permitir que a IA conecte no host, rode diagnosticos, comandos e acoes com mais liberdade, mas isso deve existir como modo operacional explicito, nunca como comportamento padrao.

Premissas:
- autorizacao explicita do usuario ou do admin responsavel
- policy por tenant, grupo, host e ferramenta
- trilha completa de auditoria por acao
- janela de validade da autorizacao
- possibilidade de revogacao imediata
- escopo tecnico limitado ao que foi aprovado

Controles minimos obrigatorios:
- modo de acesso separado por nivel:
  - `read_only`
  - `diagnostic_only`
  - `approval_required`
  - `full_operational_access`
- aprovacao com duracao, escopo e identidade do aprovador
- registro de quem autorizou, quando autorizou, qual IA/provedor atuou e em nome de qual usuario
- replay textual das acoes executadas
- capacidade de kill switch por tenant e por sessao
- rate limit e teto de execucao por janela
- redaction de segredos antes de persistir output e antes de enviar contexto ao provider

Regras de produto:
- `full_operational_access` deve ficar desligado por padrao
- execucoes autonomas devem ocorrer por uma sessao tecnica identificavel, nunca misturadas com a sessao interativa comum do usuario
- o produto deve diferenciar claramente `diagnostico`, `acao proposta` e `acao executada`
- a IA pode sugerir shell livre, mas a execucao deve continuar sujeita a policy, aprovacao e auditoria
- para cenarios de alto risco, preferir `propor e confirmar` a `executar direto`

Capacidades futuras possiveis nesse modo:
- conectar no host por sessao governada
- executar playbooks e ferramentas aprovadas
- rodar comandos sob politica
- coletar evidencias e correlacionar com auditoria
- aplicar acoes de remediacao permitidas
- revalidar estado apos a acao

Fora desse modo:
- nenhuma IA externa deve receber acesso operacional amplo por inferencia
- nenhuma integracao deve pular a camada de policy do NodeAccess
- nenhuma acao destrutiva deve acontecer sem trilha auditavel e sem identidade de aprovacao

## Criterios de aceite do MVP
- usuario so ve dados que ja poderia ver na UI
- admin consegue desabilitar MCP por tenant
- token pode ser revogado
- chamadas sao auditadas
- dados sensiveis nao sao retornados
- chamadas respeitam rate limit
- falha de MCP nao afeta login, hosts, terminal ou auditoria

## Fora do MVP
- criar um segundo motor de diagnostico exclusivo para MCP
- permitir que o modelo gere shell arbitrario
- permitir conexao SSH direta sem passar pela camada governada do produto
- duplicar regras de autorizacao fora dos services existentes
- expor actions destrutivas sem aprovacao humana

## Riscos
- exposicao indevida entre tenants
- exposicao de segredo em resposta de IA
- prompt injection induzindo tool call perigosa
- automacao alem do permitido pelo usuario
- custo operacional de suporte e auditoria

## Mitigacoes
- read-only primeiro
- allowlist explicita de capabilities
- sanitizacao de parametros e respostas
- auditoria obrigatoria
- rate limit
- escopos por token
- sem acesso direto a secrets
- sem execucao SSH no MVP

## Relacao com outras frentes
- `docs/PRD-local-ai-lite.md`: MCP pode ser a camada padronizada de ferramentas do assistente.
- `docs/PRD-session-audit-lite.md`: MCP pode expor auditoria em modo leitura.
- `docs/PRD-host-dashboard.md`: MCP pode expor resumo por host.
- `docs/PRD-ai-diagnostic-scripts-lite.md`: MCP deve reaproveitar a mesma base governada de diagnosticos e playbooks.
- `docs/PRD-api-keys-lite.md`: tokens MCP devem seguir principios semelhantes de governanca.
- `docs/PRD-rbac-lite.md`: futuras permissoes granulares devem controlar capabilities MCP.
