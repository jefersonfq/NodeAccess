# PRD Host Notifications and Knowledge Lite

## Objetivo
Criar uma central leve de informacoes operacionais por host, com notificacoes temporarias, reconhecimento por usuarios e historico auditavel.

O recurso deve ajudar usuarios a entender rapidamente o estado operacional de um host antes de interagir com ele, por exemplo:
- `Host indisponivel, cliente ciente`
- `Manutencao em andamento ate 18h`
- `Acesso liberado somente para suporte N2 hoje`
- `Servicos reiniciados, aguardando validacao`

Tambem deve preparar uma central de notificacoes mais ampla para eventos operacionais do NodeAccess, como:
- host modificado
- host acessado por usuario especifico
- acesso a host, grupo ou lista de hosts sensiveis
- chat nao lido, quando o modulo de chat existir
- notificacoes disparadas por politicas de auditoria
- avisos direcionados a admins, usuarios especificos ou grupos de usuarios

## Avaliacao inicial
A ideia agrega positivamente ao NodeAccess porque ataca uma dor real da operacao: informacoes criticas sobre hosts ficam dispersas em chat, tickets, planilhas ou memoria informal.

O recurso combina com o posicionamento do produto:
- centraliza contexto operacional no ciclo de vida do host
- reduz acesso desnecessario a host com incidente conhecido
- melhora colaboracao entre suporte, NOC, infraestrutura e DevOps
- cria trilha de quem informou, quem reconheceu e quem marcou retorno
- complementa auditoria, sessoes SSH, dashboards e logs administrativos
- abre base para notificacoes orientadas por politica, sem espalhar alertas em cada modulo

Recomendacao: estudar e implementar em cortes pequenos. O primeiro corte deve focar em notificacoes temporarias por host, exibicao clara e reconhecimento auditavel. A central transversal deve nascer como evolucao arquitetural separada, baseada em eventos e politicas, para nao acoplar Hosts, Auditoria, Chat, Terminal e Admin Logs prematuramente.

## Problema
Hoje o NodeAccess centraliza acesso, hosts e auditoria, mas informacoes humanas sobre o estado atual do host ainda tendem a ficar fora da plataforma.

Isso causa:
- usuarios tentando acessar hosts sabidamente indisponiveis
- repeticao de diagnosticos ja conhecidos
- dependencia de chat ou ticket externo para entender contexto
- falta de trilha sobre quem comunicou o problema
- falta de visibilidade sobre quem viu e reconheceu a informacao
- dificuldade de saber quando o host voltou ao normal
- falta de uma forma consistente de avisar admins ou usuarios quando eventos sensiveis acontecem
- risco de cada modulo implementar sua propria notificacao, criando UX inconsistente e manutencao cara

## Resultado esperado
Ao interagir com um host, o usuario deve saber rapidamente se existe algum aviso operacional relevante.

O usuario deve conseguir:
- criar uma informacao temporaria do host com poucos cliques
- ver notificacoes abertas nos cards/lista de hosts
- receber um aviso claro ao abrir terminal, edicao, SFTP, acessos locais ou links do host
- reconhecer que leu uma notificacao
- informar que o acesso ou servico voltou ao normal, quando tiver permissao

O admin ou usuario autorizado deve conseguir:
- acompanhar notificacoes abertas por host
- ver quem criou, reconheceu, atualizou e resolveu
- consultar a timeline do host
- filtrar eventos por tipo, status e periodo
- configurar politicas futuras de notificacao para eventos sensiveis
- receber ou direcionar notificacoes para admins, usuarios, grupos ou responsaveis por host

## Conceitos
### Notificacao temporaria do host
Aviso operacional com ciclo de vida curto ou medio, ligado a um host especifico.

Exemplos:
- indisponibilidade
- manutencao
- degradacao
- risco operacional
- restricao temporaria de acesso
- cliente ciente
- aguardando validacao

### Reconhecimento
Registro de que um usuario viu a notificacao e reconheceu o aviso.

Reconhecer nao significa resolver. Significa apenas:
- `estou ciente desta informacao antes de seguir`

### Resolucao
Registro de que a condicao deixou de valer, por exemplo:
- host voltou
- acesso normalizado
- manutencao concluida
- aviso cancelado

Resolucao deve pedir comentario curto quando fizer sentido.

### Base de conhecimento do host
Informacao mais permanente e consultiva sobre o host, separada das notificacoes urgentes.

Exemplos futuros:
- finalidade do host
- sistemas relacionados
- contatos responsaveis
- runbooks curtos
- links operacionais importantes
- observacoes recorrentes

### Central de notificacoes
Inbox operacional do NodeAccess para concentrar notificacoes originadas por hosts, auditoria, chat, politicas e outros modulos.

Ela deve separar:
- notificacao exibida ao usuario
- evento que originou a notificacao
- politica que decidiu os destinatarios
- estado de leitura/reconhecimento por destinatario

### Politica de notificacao
Regra configuravel que transforma um evento operacional em notificacao para destinatarios.

Exemplos:
- se qualquer usuario acessar host critico, notificar admins
- se usuario X acessar host Y, notificar responsavel do host
- se qualquer host do grupo `Producao` for acessado fora do horario, notificar NOC
- se host for modificado, notificar admins e usuarios que favoritaram o host
- se houver chat nao lido em host critico, destacar no card e na central

### Evento fonte
Registro de origem que pode gerar notificacao.

Exemplos:
- `host_notice_created`
- `host_updated`
- `host_accessed`
- `session_started`
- `session_ended`
- `chat_message_unread`
- `audit_policy_matched`
- `host_back_online_reported`

## Escopo do MVP
### Notificacoes
- criar notificacao temporaria por host
- titulo curto
- mensagem
- severidade
- tipo
- validade opcional
- status
- reconhecimento por usuario
- resolver/reabrir notificacao
- timeline basica por host

### Exibicao no ciclo do host
- badge nos cards/lista de hosts quando houver notificacao aberta nao reconhecida pelo usuario atual
- indicador distinto para notificacao aberta ja reconhecida
- balao/drawer informativo ao abrir host, terminal, SFTP, acessos locais ou edicao
- area compacta no detalhe/edicao do host com notificacoes abertas
- item na barra/contexto do terminal do host ativo

### Auditoria
- logar criacao
- logar reconhecimento
- logar atualizacao
- logar resolucao
- logar reabertura
- preservar usuario, horario, host, tenant e comentario

### Preparacao para central transversal
- desenhar modelo separando `HostNotice` de `Notification`
- permitir que uma notificacao tenha contexto de host, grupo ou lista de hosts
- preservar fonte do evento e politica aplicada
- permitir destinatarios por usuario, grupo, admin do tenant ou papel operacional
- registrar leitura/reconhecimento por destinatario

## Fora do escopo do MVP
- chat em tempo real por host
- comentarios em thread longa
- anexos
- mencoes com notificacao push
- integracao obrigatoria com Jira
- IA para sumarizar timeline
- bloqueio automatico de conexao SSH
- base de conhecimento completa com editor rico
- politicas complexas com linguagem propria
- notificacao externa por email/Slack/Teams
- escalonamento de SLA
- automacao de resposta ao evento

## Tipos recomendados
- `incident`
- `maintenance`
- `degraded`
- `access_restriction`
- `customer_notice`
- `general_note`

## Severidade recomendada
- `info`
- `warning`
- `critical`

## Status recomendados
- `open`
- `resolved`
- `expired`
- `cancelled`

## Regras de negocio
- notificacao pertence a um `tenant` e a um `host`
- visibilidade segue a visibilidade do host
- usuario que consegue ver o host consegue ver notificacoes abertas do host
- usuario que consegue ver o host pode reconhecer notificacoes
- criacao deve seguir permissao configuravel:
  - fase 1 recomendada: admin ou usuario com permissao de gerenciar hosts
  - opcional por tenant: permitir que qualquer usuario com acesso ao host crie notificacao
- resolucao deve seguir permissao configuravel:
  - fase 1 recomendada: criador, admin ou usuario com permissao de gerenciar hosts
- notificacao expirada nao deve exigir reconhecimento novo
- notificacao resolvida deve sair do destaque principal, mas permanecer na timeline
- reconhecimento deve ser por usuario e por notificacao
- reconhecer notificacao nao deve liberar nenhum acesso especial
- o recurso nao deve expor dados de hosts que o usuario nao pode acessar
- notificacoes transversais devem respeitar tenant, permissao e visibilidade do recurso de origem
- eventos sensiveis podem gerar notificacao sem expor detalhe completo ao destinatario sem permissao
- leitura simples e reconhecimento operacional devem ser estados separados
- notificacao enviada por politica deve guardar qual politica decidiu o envio
- politica de notificacao nao deve bloquear o fluxo principal que gerou o evento
- falha ao entregar notificacao nao deve impedir login, terminal, edicao de host ou auditoria primaria

## Politicas de entrega futuras
As politicas devem ser avaliadas de forma assincrona ou fora do caminho critico sempre que possivel.

### Escopos de evento
- host especifico
- grupo de hosts
- lista manual de hosts
- todos os hosts de um tenant
- usuario especifico
- grupo de usuarios
- role administrativa

### Condicoes iniciais recomendadas
- host acessado
- sessao iniciada
- host modificado
- notificacao critica criada
- notificacao resolvida
- chat nao lido
- regra de auditoria acionada

### Destinatarios iniciais recomendados
- admins do tenant
- criador/responsavel do host
- usuarios especificos
- grupos de usuarios
- usuarios com permissao de gerenciar hosts

### Canais internos
- central de notificacoes
- badge no host
- badge no menu lateral/topbar
- balao contextual no terminal ou detalhe do host

### Canais externos
Fora do MVP. Avaliar depois:
- email
- webhook
- Slack/Teams
- Jira

## Modelo de dados sugerido
### `HostNotice`
- `id`
- `tenantId`
- `hostId`
- `createdByUserId`
- `resolvedByUserId`
- `type`
- `severity`
- `status`
- `title`
- `message`
- `startsAt`
- `expiresAt`
- `resolvedAt`
- `resolutionNote`
- `createdAt`
- `updatedAt`

### `HostNoticeAcknowledgement`
- `id`
- `tenantId`
- `hostNoticeId`
- `hostId`
- `userId`
- `acknowledgedAt`
- `createdAt`

### `HostTimelineEvent`
Opcional no MVP. Pode nascer como view derivada de `HostNotice`, `HostNoticeAcknowledgement`, `Session`, `AdminLog` e eventos de auditoria.

Campos se persistir depois:
- `id`
- `tenantId`
- `hostId`
- `actorUserId`
- `eventType`
- `source`
- `sourceId`
- `summary`
- `metadataJson`
- `createdAt`

### `Notification`
Modelo futuro para a central transversal. Pode ser introduzido na Fase 2, ou nascer junto se o time decidir investir na base correta desde o primeiro corte.

- `id`
- `tenantId`
- `sourceType`
- `sourceId`
- `eventType`
- `scopeType`
- `hostId`
- `hostGroupId`
- `severity`
- `title`
- `message`
- `status`
- `policyId`
- `createdAt`
- `expiresAt`

### `NotificationRecipient`
- `id`
- `tenantId`
- `notificationId`
- `recipientType`
- `userId`
- `groupId`
- `role`
- `readAt`
- `acknowledgedAt`
- `acknowledgementNote`
- `createdAt`

### `NotificationPolicy`
- `id`
- `tenantId`
- `name`
- `enabled`
- `eventTypesJson`
- `conditionsJson`
- `recipientRulesJson`
- `severity`
- `requireAcknowledgement`
- `createdByUserId`
- `createdAt`
- `updatedAt`

Observacao:
- evitar criar uma linguagem de regras complexa no primeiro corte
- preferir condicoes estruturadas simples e previsiveis
- manter avaliador de politicas desacoplado dos modulos de origem

## Contratos compartilhados
Criar schemas em `packages/shared` para:
- criar notificacao
- atualizar notificacao
- reconhecer notificacao
- resolver notificacao
- listar notificacoes por host
- resumo de notificacoes por host
- timeline do host
- listar notificacoes recebidas pelo usuario
- marcar notificacao como lida
- reconhecer notificacao recebida
- criar/atualizar politica de notificacao, quando a fase de politicas iniciar

Os schemas devem validar:
- titulo curto
- mensagem com limite razoavel
- severidade conhecida
- tipo conhecido
- `expiresAt` futuro quando informado

## Backend recomendado
Modulo novo e desacoplado:
- `apps/backend/src/modules/host-notices`

Para a central transversal, modulo separado:
- `apps/backend/src/modules/notifications`

Camadas sugeridas:
- `host-notice.routes.ts`
- `host-notice.controller.ts`
- `host-notice.service.ts`
- `host-notice.repository.ts`
- `host-notice.presenter.ts`

Camadas futuras de notificacao:
- `notification.routes.ts`
- `notification.controller.ts`
- `notification.service.ts`
- `notification.repository.ts`
- `notification-policy.service.ts`
- `notification-dispatcher.ts`
- `notification.presenter.ts`

Responsabilidades:
- controller valida entrada e chama use case/service
- service aplica regra de negocio, permissao e auditoria
- repository encapsula Prisma/SQL
- presenter formata payload de UI sem vazar campos desnecessarios

Evitar:
- colocar regra de notificacao dentro do modulo de SSH
- consultar catalogo inteiro de hosts para montar badges
- acoplar timeline diretamente ao terminal
- criar dependencia circular entre `hosts`, `sessions` e `host-notices`
- chamar UI de notificacao diretamente a partir de auditoria, chat ou terminal
- fazer politicas de notificacao dependerem de ifs espalhados em varios modulos
- bloquear o evento de origem esperando entrega de notificacao

## Endpoints sugeridos
### Host
- `GET /hosts/:hostId/notices`
- `POST /hosts/:hostId/notices`
- `GET /hosts/:hostId/notices/summary`
- `GET /hosts/:hostId/timeline`

### Notificacao
- `PATCH /host-notices/:noticeId`
- `POST /host-notices/:noticeId/ack`
- `POST /host-notices/:noticeId/resolve`
- `POST /host-notices/:noticeId/reopen`

### Lista operacional
- `GET /host-notices/open`
  - filtros:
    - severidade
    - tipo
    - host
    - criado por
    - nao reconhecida por mim

### Central de notificacoes futura
- `GET /notifications`
- `GET /notifications/unread-count`
- `POST /notifications/:notificationId/read`
- `POST /notifications/:notificationId/ack`
- `GET /notification-policies`
- `POST /notification-policies`
- `PATCH /notification-policies/:policyId`
- `POST /notification-policies/:policyId/test`

## Frontend recomendado
Criar uma experiencia leve, sempre proxima do host.

Componentes provaveis:
- `HostNoticeBadge.vue`
- `HostNoticePanel.vue`
- `HostNoticeForm.vue`
- `HostNoticeTimeline.vue`
- `HostNoticePopover.vue`

Servicos:
- `hostNotice.service.ts`
- `notification.service.ts` quando a central transversal iniciar

Possivel store/composable:
- `useHostNotices`
  - somente se houver reutilizacao real entre Hosts, Terminal, SFTP e Host detail
  - evitar estado global pesado no primeiro corte
- `useNotifications`
  - recomendado para badge global, dropdown/topbar e central de notificacoes
  - deve carregar contadores leves e pagina de inbox sob demanda

## UX recomendada
### Tela de Hosts
Nos cards/lista:
- badge discreta, mas visivel, quando houver notificacao aberta
- cor por severidade, mas sempre com texto/icone para nao depender apenas de cor
- tooltip/popover com titulo, severidade, idade e CTA `Reconhecer`
- filtro rapido `Com avisos`
- opcional: filtro `Nao reconhecidos por mim`

Evitar:
- transformar cada card em mural de comentarios
- ocupar espaco permanente quando nao houver aviso
- misturar notificacoes resolvidas na listagem principal

### Terminal
Ao abrir host com notificacao aberta nao reconhecida:
- mostrar balao/drawer compacto antes ou logo apos a conexao
- CTA principal: `Reconhecer e continuar`
- CTA secundario: `Ver detalhes`
- nao bloquear input SSH por padrao no MVP

Quando a notificacao for critica:
- destacar no topo do terminal do host ativo
- permitir recolher apos reconhecimento

### Edicao/detalhe do host
Adicionar secao `Informacoes do host` ou `Avisos do host`:
- notificacoes abertas
- botao `Nova notificacao`
- timeline recente
- link para historico completo

### Central de notificacoes
Tela ou drawer operacional:
- notificacoes abertas do tenant que o usuario pode ver
- filtros por severidade, tipo e reconhecimento
- busca por host ou texto
- acao rapida de reconhecer
- acao de resolver para usuarios autorizados
- separacao visual entre:
  - `Avisos de host`
  - `Acessos e auditoria`
  - `Chat`
  - `Sistema`
- filtro `Exigem reconhecimento`
- filtro `Nao lidas`
- acao `Marcar como lida`
- acao `Reconhecer`
- link direto para host, sessao, log ou conversa quando o usuario tiver permissao

### Politicas de notificacao
Tela administrativa futura:
- lista de politicas ativas/inativas
- evento monitorado
- escopo de hosts/usuarios
- destinatarios
- exigencia de reconhecimento
- teste de politica com preview de destinatarios
- logs recentes gerados pela politica

### Timeline do host
Visao cronologica:
- notificacao criada
- usuarios reconheceram
- notificacao atualizada
- host acessado
- sessao encerrada
- host modificado
- politica de auditoria disparada
- chat associado ao host recebeu mensagem
- notificacao resolvida

No MVP, pode comecar apenas com eventos de notificacao e depois receber sessoes/auditoria.

## Design visual
Direcao recomendada:
- operacional, denso e escaneavel
- badges pequenos em cards/lista
- drawer lateral para detalhes sem tirar o usuario do fluxo
- severidade visual clara:
  - `info`: neutro/azul discreto
  - `warning`: amarelo/laranja controlado
  - `critical`: vermelho, com texto explicito
- cards de notificacao com borda lateral por severidade, nao fundo inteiro colorido
- timeline vertical simples com data, ator e evento

Estados obrigatorios:
- sem notificacoes
- carregando
- erro ao carregar
- sem permissao para criar/resolver
- sem permissao para ver detalhe do evento de origem
- notificacao expirada
- notificacao ja reconhecida
- notificacao resolvida
- notificacao lida, mas nao reconhecida
- politica desabilitada

Acessibilidade:
- botoes com labels claros
- foco visivel no popover/drawer
- notificacao critica com texto, nao apenas cor
- reconhecimento acionavel por teclado
- `aria-live` apenas para mudancas relevantes, sem ruido no terminal

## Arquitetura e principios
- modulo proprio no backend
- contratos compartilhados em `packages/shared`
- UI por composicao, sem componente gigante
- regra de permissao no backend como fonte primaria
- frontend apenas reflete capacidades recebidas
- auditoria sempre no servidor
- consultas de resumo leves para cards/lista de hosts
- timeline como agregacao progressiva, nao como dependencia do caminho critico
- feature flag ou entitlement recomendado se houver risco de ruido operacional
- central transversal deve usar eventos internos ou dispatcher, nao chamadas diretas entre telas
- politicas devem ser avaliadas em servico proprio
- notificacao deve ser consumo derivado, nao fonte primaria da auditoria
- AdminLog e SessionAudit continuam sendo fontes oficiais de auditoria

## Performance
Para a tela de Hosts:
- nao carregar todas as notificacoes completas junto com o catalogo
- usar resumo leve por host quando necessario:
  - `openCount`
  - `unacknowledgedCountForMe`
  - `highestSeverity`
  - `latestTitle`
  - `latestCreatedAt`
- respeitar paginacao server-side da tela de Hosts
- evitar polling frequente por padrao
- refresh sob demanda ao criar/reconhecer/resolver
- opcional futuro: WebSocket/SSE apenas para ambientes que precisem de tempo real

Para a central transversal:
- contador global deve ser endpoint leve
- inbox deve ser paginada
- politicas devem usar indices por `tenantId`, `eventType`, `hostId`, `userId` e `createdAt`
- eventos de alta frequencia, como sessao iniciada, precisam de deduplicacao ou janela de agregacao quando configurado
- notificacoes de chat nao lido devem ser agregadas por conversa, nao uma notificacao por mensagem em ambientes movimentados

## Auditoria e logs
Registrar em `AdminLog` ou estrutura equivalente:
- `HOST_NOTICE_CREATED`
- `HOST_NOTICE_UPDATED`
- `HOST_NOTICE_ACKNOWLEDGED`
- `HOST_NOTICE_RESOLVED`
- `HOST_NOTICE_REOPENED`
- `HOST_NOTICE_EXPIRED`
- `NOTIFICATION_CREATED`
- `NOTIFICATION_READ`
- `NOTIFICATION_ACKNOWLEDGED`
- `NOTIFICATION_POLICY_CREATED`
- `NOTIFICATION_POLICY_UPDATED`
- `NOTIFICATION_POLICY_DISABLED`
- `NOTIFICATION_POLICY_MATCHED`

Metadados minimos:
- `tenantId`
- `hostId`
- `noticeId`
- `actorUserId`
- `severity`
- `type`
- `status`
- `previousStatus`
- `newStatus`
- `resolutionNote` quando houver
- `policyId` quando houver
- `sourceType`
- `sourceId`
- `recipientType`
- `recipientId`

## Privacidade e seguranca
- mensagem nao deve conter segredo; UI deve orientar isso
- limite de tamanho para evitar abuso
- sanitizar exibicao de texto
- nao renderizar HTML vindo do usuario
- rate limit simples para criacao se todos os usuarios puderem criar
- deletar fisicamente nao deve existir no MVP; preferir resolver/cancelar
- platform admin nao deve ver dados cross-tenant fora de contexto explicito
- notificacoes derivadas de auditoria podem ser sensiveis; limitar payload no inbox
- se o destinatario nao tiver acesso ao recurso de origem, mostrar somente mensagem generica ou ocultar a notificacao
- politicas que notificam "any admin" devem resolver destinatarios no tenant correto
- evitar mencionar comandos, segredos ou payloads de terminal no texto da notificacao

## Fases sugeridas
### Fase 1 - Notificacao operacional por host
- schema e contratos
- CRUD minimo
- reconhecimento
- resolucao
- resumo por host
- badges em cards/lista
- popover/drawer ao interagir com host
- logs administrativos

### Fase 2 - Central de notificacoes
- tela/drawer global
- filtros
- busca
- acao em massa de reconhecimento
- visao `nao reconhecidas por mim`
- modelo `Notification`
- destinatarios por usuario/admin/grupo
- contador de nao lidas
- leitura separada de reconhecimento

### Fase 3 - Politicas de notificacao
- politicas simples para eventos:
  - host modificado
  - host acessado
  - sessao iniciada
  - notificacao critica criada
  - chat nao lido
  - regra de auditoria acionada
- destinatarios:
  - admins
  - usuarios especificos
  - grupos
  - responsavel/criador do host
- preview/teste de politica
- logs de match e entrega

### Fase 4 - Timeline do host
- timeline unificada
- eventos de notificacao
- eventos de acesso/sessao
- eventos de auditoria administrativa relevantes
- eventos de modificacao do host
- eventos de chat quando houver

### Fase 5 - Base de conhecimento do host
- notas permanentes por host
- runbooks curtos
- responsaveis
- links relacionados
- possivel integracao com links associados e diagnosticos

### Fase 6 - Integracoes e automacao
- abrir notificacao a partir de webhook ou integracao
- correlacionar com Jira/incidente
- resumo por IA da timeline
- sugestao de resolucao ou follow-up

## Criterios de aceite do MVP
- usuario autorizado cria notificacao em um host
- usuario com acesso ao host ve badge na listagem
- usuario ve balao/drawer ao abrir terminal do host com notificacao aberta nao reconhecida
- usuario reconhece notificacao e o destaque muda para reconhecido
- usuario autorizado resolve notificacao informando que o acesso voltou ou explicando a resolucao
- logs mostram quem criou, reconheceu e resolveu
- host sem notificacao nao ganha ruido visual
- tela de Hosts continua usando resumo leve e paginacao
- usuario sem acesso ao host nao ve notificacao
- desenho tecnico deixa caminho claro para central transversal sem obrigar sua implementacao completa no MVP

## Riscos e trade-offs
- risco de poluicao visual se toda informacao virar alerta
- risco de notificacoes antigas ficarem abertas para sempre
- risco de virar sistema de tickets paralelo
- risco de bloquear o fluxo tecnico se o reconhecimento for intrusivo demais
- risco de consultas pesadas se a timeline tentar agregar tudo no primeiro corte
- risco de excesso de notificacoes se politicas forem amplas demais
- risco de vazamento de contexto se notificacao de auditoria expor detalhe para destinatario sem permissao
- risco de acoplamento se cada modulo gerar notificacao por conta propria

Mitigacoes:
- validade opcional e filtros por status
- separar notificacao temporaria de base de conhecimento permanente
- nao bloquear SSH por padrao
- usar resumo leve em listagens
- comecar com timeline apenas de notificacoes
- separar evento, politica, notificacao e destinatario
- criar templates/payloads minimos por tipo de evento
- exigir preview/teste antes de ativar politicas amplas
- agregar notificacoes repetitivas, especialmente chat e acessos frequentes

## Recomendacao
Vale estudar e provavelmente priorizar depois de validar com usuarios reais de suporte/NOC/infra.

O melhor MVP e pequeno:
1. notificacao temporaria por host
2. badge em Hosts
3. aviso no terminal/interacoes com host
4. reconhecimento por usuario
5. resolucao com log

A central transversal deve ser desenhada desde o inicio, mas implementada depois do fluxo de host estar validado. O caminho recomendado e:
1. provar valor com avisos temporarios por host
2. introduzir inbox global e estado de leitura/reconhecimento
3. adicionar politicas simples de notificacao
4. integrar eventos de auditoria, chat e modificacao de host
5. evoluir para base de conhecimento e timeline completa

Base de conhecimento e central completa devem vir em fases seguintes, para preservar clareza e evitar transformar o NodeAccess em um ticketing system paralelo antes da hora.
