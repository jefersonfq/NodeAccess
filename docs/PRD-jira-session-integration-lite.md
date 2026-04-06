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

## Escopo por fase
### Fase 1
- configuracao da integracao JIRA
- healthcheck
- leitura basica de ticket por chave
- sessao vinculada a ticket manualmente
- vinculacao por chave no detalhe da sessao auditada, apenas quando a integracao estiver funcional

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

## Regras de resiliencia
- se o JIRA cair, a sessao continua
- se a leitura do ticket falhar, a sessao ainda pode abrir
- se a escrita pos-sessao falhar:
  - registrar job `FAILED`
  - permitir retry manual
- nada deve bloquear a auditoria base

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

## APIs esperadas
- `GET /integrations/jira`
- `PUT /integrations/jira`
- `POST /integrations/jira/test`
- `GET /integrations/jira/tickets/:key`
- `POST /session-audit/:sessionId/link-ticket`
- `POST /session-audit/:sessionId/jira/comment`
- `POST /session-audit/:sessionId/jira/attach`

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

## Sugestao registrada
Sugestao prioritaria para a proxima fase:
- adicionar o campo opcional de ticket no inicio do fluxo de conexao SSH
- a sessao ja nasce vinculada quando o tenant tiver JIRA configurado e saudavel
- a ausencia de ticket nao bloqueia o funcionamento normal da plataforma no MVP
