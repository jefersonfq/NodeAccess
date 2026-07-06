# PRD JIRA Session Integration Lite

## Objetivo
Definir uma integracao progressiva entre NodeAccess, sessoes SSH auditadas e tickets JIRA, sem transformar o ticket em dependencia obrigatoria do runtime do terminal.

## Estado atual
Ja existe uma base inicial implementada:
- configuracao da integracao JIRA em `/admin/integrations`
- credencial cifrada no backend
- healthcheck basico via API do JIRA
- leitura de ticket por chave
- snapshot basico do ticket no detalhe da sessao auditada
- vinculacao manual de ticket por chave na UI da sessao auditada

O que ainda nao existe:
- persistencia de snapshot do ticket no banco
- comentario no ticket
- anexo no ticket
- abertura de sessao com ticket como passo nativo do fluxo
- politicas por tenant exigindo ticket

## Problema
Hoje a sessao pode guardar referencias simples de ticket, mas ainda nao existe um desenho claro para:
- iniciar sessoes contextualizadas por ticket
- ler contexto do ticket antes da conexao
- anexar auditoria e resumos ao ticket
- manter trilha de evidencia operacional por mudanca

Sem esse desenho, existe risco de:
- acoplar demais a abertura do terminal a um sistema externo
- travar operacao quando o JIRA estiver indisponivel
- criar anexos e comentarios duplicados
- misturar governanca de ticket com governanca da sessao

## Principios
- terminal e auditoria base continuam funcionando sem JIRA
- JIRA deve ser opt-in
- funcionalidades dependentes de JIRA devem aparecer apenas quando a integracao estiver licenciada, configurada, habilitada e saudavel; quando indisponiveis, a UI deve informar claramente a dependencia em vez de exibir acoes quebradas ou esconder o motivo
- leitura de ticket e escrita de evidencias devem ser assincronas sempre que possivel
- o usuario continua podendo abrir sessao sem ticket, salvo politica futura explicita
- falha de integracao nao bloqueia SSH no MVP

## Casos de uso
### 1. Sessao iniciada a partir de ticket
- operador informa ou seleciona um ticket
- NodeAccess registra `ticketProvider`, `ticketKey` e `ticketUrl`
- a sessao fica vinculada ao contexto daquela mudanca

### 2. Leitura de contexto do ticket
- titulo
- descricao
- status
- assignee
- labels
- campos customizados relevantes

Uso esperado:
- mostrar contexto antes da sessao
- alimentar resumo por IA
- enriquecer auditoria

### 3. Anexar resultado da sessao ao ticket
- comentario com resumo
- anexo da trilha completa ou export
- links para sessao auditada no NodeAccess

### 4. Fechamento assistido
- gerar nota final orientada a CAB ou evidencias
- sugerir comentario final para o ticket
- nunca fechar ticket automaticamente no MVP

### 5. Provisionamento assistido de hosts a partir do JIRA
- NodeAccess pode ler tickets ou filas JIRA configuradas para descobrir solicitacoes de cadastro de hosts.
- Exemplo de origem:
  - fila Service Management como `/jira/servicedesk/projects/CLI/queues/custom/80`
  - JQL equivalente configurado no NodeAccess
- O objetivo e transformar dados estruturados do ticket em proposta de host, nao criar acesso sensivel sem validacao.
- Campos esperados podem vir de campos customizados ou de bloco estruturado na descricao.
- Exemplos de parametros:
  - `host_name`
  - `ip`
  - `port`
  - `ssh_user`
  - `scope`
  - `group`
  - `connection_mode`
  - `bastion`
  - `tags`
  - `ticket_key`
- A recomendacao e preferir campos customizados do JIRA quando possivel; descricao livre deve exigir parser conservador e validacao humana.
- Exemplo de bloco estruturado aceito na descricao:

```text
nodeaccess_host:
  host_name: cliente-x-fw01
  ip: 10.10.20.15
  port: 22
  ssh_user: suporte
  scope: team
  group: Cliente X
  connection_mode: agent_tenant_fallback
  tags: cliente-x, firewall
```

## Escopo por fase
### Fase 1
- configuracao da integracao JIRA
- healthcheck
- leitura basica de ticket por chave
- sessao vinculada a ticket manualmente
- vinculacao por chave no detalhe da sessao auditada, apenas quando a integracao estiver funcional
- quando a integracao estiver desabilitada, sem token, nao licenciada ou unhealthy:
  - a UI nao deve permitir novo vinculo de ticket
  - snapshots atuais nao devem tentar chamar o JIRA
  - sessoes ja vinculadas devem manter `ticketKey` e `ticketUrl` historicos
  - a tela deve explicar que a funcao depende da integracao JIRA ativa

### Fase 2
- acoes pos-sessao:
  - comentar no ticket
  - anexar resumo
  - anexar arquivo exportado

### Fase 3
- templates de comentario por tipo de mudanca
- uso de IA para gerar comentario orientado ao ticket
- sugestoes baseadas em contexto do ticket + auditoria

### Fase 4
- politicas por tenant:
  - exigir ticket para certos grupos
  - bloquear comentario automatico
  - aprovar antes de publicar no JIRA

### Fase 5
- sincronizacao/provisionamento assistido de hosts:
  - configurar JQL ou fila de origem
  - mapear campos JIRA para campos de `Host`
  - importar como `HostDraft` ou proposta pendente
  - validar duplicidade por IP/nome/tenant
  - exigir aprovacao de admin antes de criar o host final no NodeAccess
  - registrar origem e snapshot do ticket usado
  - opcionalmente comentar no ticket apos aprovacao/criacao

## Integracao recomendada
### Configuracao
- `baseUrl`
- `clientEmail` ou conta tecnica
- `apiToken`
- `projectKeys` permitidos opcional
- `enabled`
- `healthStatus`
- `lastHealthcheckAt`

### Modelo operacional
- integracao por tenant
- credenciais cifradas
- leitura e escrita via service dedicado
- sem chamada ao JIRA no websocket SSH

### Provisionamento de hosts
- usar job assincrono, nunca no caminho critico do terminal
- usar JQL configuravel em vez de depender diretamente da URL visual da fila
- permitir salvar a URL da fila apenas como ajuda de UX, convertendo para uma regra de busca quando possivel
- manter whitelist de projetos permitidos, como `CLI`
- registrar `lastSyncAt`, `lastSeenIssueKey` ou cursor equivalente
- evitar recriar host ja existente:
  - comparar por `tenantId + ip + port`
  - comparar por `ticketKey` ja importado
  - comparar por nome normalizado quando fizer sentido
- criar proposta pendente em vez de criar host automaticamente no primeiro corte
- se a criacao automatica for habilitada no futuro, deve ser opt-in por tenant e por projeto/fila
- secrets e credenciais SSH nao devem vir da descricao do ticket; devem ser escolhidos no NodeAccess ou referenciados via mecanismo seguro

## Regras de resiliencia
- se o JIRA cair, a sessao continua
- se a leitura do ticket falhar, a sessao ainda pode abrir
- se a escrita pos-sessao falhar:
  - registrar job `FAILED`
  - permitir retry manual
- nada deve bloquear a auditoria base
- se a varredura de hosts falhar:
  - registrar job `FAILED`
  - preservar ultima execucao bem-sucedida
  - nao remover hosts existentes automaticamente
  - permitir retry manual

## Entidades sugeridas
### `JiraIntegration`
- `id`
- `tenantId`
- `enabled`
- `baseUrl`
- `encryptedApiToken`
- `apiTokenIv`
- `serviceAccountEmail`
- `healthStatus`
- `healthMessage`
- `lastHealthcheckAt`
- `createdAt`
- `updatedAt`

### `SessionTicketLink`
- `id`
- `sessionAuditId`
- `provider`
- `ticketKey`
- `ticketUrl`
- `ticketSnapshotJson`
- `createdAt`

### `JiraSyncJob`
- `id`
- `tenantId`
- `sessionAuditId`
- `kind`
- `status`
- `payloadJson`
- `resultJson`
- `errorMessage`
- `createdAt`
- `updatedAt`

### `JiraHostImportRule`
- `id`
- `tenantId`
- `enabled`
- `projectKey`
- `queueId` opcional
- `jql`
- `fieldMappingJson`
- `descriptionParser`
- `defaultScope`
- `defaultGroupId`
- `defaultConnectionMode`
- `createdAt`
- `updatedAt`

### `HostImportDraft`
- `id`
- `tenantId`
- `provider`
- `ticketKey`
- `ticketUrl`
- `ticketSnapshotJson`
- `parsedHostJson`
- `status` (`pending`, `approved`, `rejected`, `failed`)
- `approvedByUserId`
- `createdHostId`
- `errorMessage`
- `createdAt`
- `updatedAt`

## APIs esperadas
- `GET /integrations/jira`
- `PUT /integrations/jira`
- `POST /integrations/jira/test`
- `GET /integrations/jira/tickets/:key`
- `POST /session-audit/:sessionId/link-ticket`
- `POST /session-audit/:sessionId/jira/comment`
- `POST /session-audit/:sessionId/jira/attach`
- `GET /integrations/jira/host-import-rules`
- `PUT /integrations/jira/host-import-rules/:id`
- `POST /integrations/jira/host-import-rules/:id/run`
- `GET /host-import-drafts`
- `POST /host-import-drafts/:id/approve`
- `POST /host-import-drafts/:id/reject`

## Relacao com IA
JIRA e IA devem permanecer desacoplados:
- a integracao JIRA pode existir sem IA
- a integracao IA pode existir sem JIRA
- o valor mais alto vem quando ambas coexistem, mas sem dependencia circular

Fluxo recomendado:
1. sessao vinculada a ticket
2. auditoria concluida
3. IA gera resumo opcional
4. operador revisa
5. comentario/anexo vai para o JIRA

## Proximos passos recomendados
1. PRD tecnico da integracao JIRA
2. persistir `ticketSnapshotJson` na sessao auditada
3. permitir informar ticket ja na abertura da sessao SSH, sem tornar isso obrigatorio
4. publicacao pos-sessao com retry manual
5. comentario orientado por IA, mas sempre revisavel antes de enviar
6. avaliar `JiraHostImportRule` para ler uma fila/JQL de clientes e criar `HostImportDraft`

## Sugestao registrada
Sugestao prioritaria para a proxima fase:
- adicionar o campo opcional de ticket no inicio do fluxo de conexao SSH
- a sessao ja nasce vinculada quando o tenant tiver JIRA configurado e saudavel
- a ausencia de ticket nao bloqueia o funcionamento normal da plataforma no MVP
