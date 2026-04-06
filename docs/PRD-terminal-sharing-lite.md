# PRD Terminal Sharing Lite

## Objetivo
Permitir entrada facilitada em hosts e colaboração controlada em terminal, sem quebrar as regras atuais de autenticacao, autorizacao e auditoria.

## Escopo
Esta frente tem duas capacidades relacionadas, mas nao identicas:
- `host link`: link compartilhavel para abrir o terminal de um host especifico em sessao propria
- `shared terminal session`: sessao compartilhada real, com mais de uma pessoa vendo e eventualmente interagindo no mesmo terminal

Nomes recomendados na UI:
- `Abrir em sessao propria`
  - cada pessoa abre seu proprio terminal no host
  - usa `host link`
- `Compartilhar sessao ao vivo`
  - varias pessoas acompanham a mesma sessao
  - usa `shared terminal session`

## Decisao de produto
As duas capacidades fazem sentido, mas nao devem nascer juntas no mesmo corte.

Ordem recomendada:
1. `host link`
2. `shared terminal session`

Motivo:
- `host link` resolve descoberta e entrada
- `shared terminal session` resolve colaboracao em tempo real
- a segunda depende de mais regra de arbitragem, auditoria e UX operacional

## Frente 1: Host Link

### O que e
Gerar um link temporario apontando para um host especifico, para abrir o terminal desse host com menos friccao.

### Variantes
- `link autenticado interno`
  - exige login antes de abrir
  - apos login, valida tenant, permissao no host e validade
  - e a variante padrao recomendada
  - se o usuario ja estiver autenticado no NodeAccess, deve seguir direto para a conexao do host sem passo extra
- `link publico de uso unico`
  - pode ser aberto sem autenticacao previa
  - deve ser tratado como excecao controlada
  - so faz sentido com validade curta e uso unico

### Avaliacao do link publico de uso unico
Faz sentido, com guardrails fortes.

Regras minimas recomendadas:
- uso unico real
- expiracao curta configuravel: `5`, `10` ou `30` minutos
- revogacao manual a qualquer momento
- escopo restrito a um host especifico
- tenant fixo
- criacao restrita a admin ou perfil com permissao explicita
- registro de quem criou, quem abriu, IP, user agent e timestamp
- mensagem clara de risco ao gerar

Restricoes recomendadas no primeiro corte:
- nao reutilizavel
- sem acesso a mais de um host
- sem privilegios acima do que o criador conseguiria conceder
- sem bypass de politicas de host key, sessao expirada ou session audit

### Recomendacao de seguranca
Padrao da plataforma:
- `link autenticado interno`

Opcao avancada:
- `link publico de uso unico`

Isso evita transformar o fluxo excepcional em comportamento normal da plataforma.

### Modelo funcional minimo
- criador gera link para `hostId`
- define expiracao: `5`, `10` ou `30` minutos
- define tipo:
  - `authenticated`
  - `public-once`
- destinatario abre o link
- se ja estiver autenticado:
  - valida e entra direto no host
- se nao estiver autenticado:
  - vai para login
  - apos login/TOTP, retoma o mesmo link
- sistema valida:
  - link valido
  - nao expirado
  - nao revogado
  - nao consumido, no caso de `public-once`
  - tenant e escopo corretos
- entao redireciona para o terminal do host

### Auditoria minima
- `HOST_LINK_CREATED`
- `HOST_LINK_OPENED`
- `HOST_LINK_REVOKED`
- `HOST_LINK_DENIED`

Metadados minimos:
- host
- criador
- tipo do link
- expiracao
- IP
- user agent
- usuario autenticado quando houver
- motivo da negacao quando houver

## Frente 2: Shared Terminal Session

### O que e
Mais de uma pessoa entra na mesma sessao de terminal, vendo o mesmo output em tempo real e, conforme politica, podendo interagir.

### Modelo recomendado
Comecar com dois papeis:
- `owner/controller`
- `viewer`

Opcional posterior:
- `request-control`

### Diretriz de arquitetura
Essa frente deve nascer desacoplada do fluxo normal de terminal.

Separacoes recomendadas:
- `host link` continua como frente independente; nao deve depender de sessao compartilhada
- `shared terminal session` deve ter entidade, token e eventos proprios
- a sessao SSH original continua existindo como hoje; a camada compartilhada apenas coordena presenca, permissao de input e espelhamento
- o terminal atual nao deve ser reescrito para suportar a feature; o ideal e adicionar uma camada fina de colaboracao em volta do fluxo existente
- se a feature for desligada, o terminal individual deve seguir funcionando sem fallback complexo

Boundary minima recomendada:
- modulo backend proprio:
  - `shared-session.repository`
  - `shared-session.service`
  - `shared-session.controller`
  - `shared-session.gateway` ou namespace dedicado
- store/composable frontend proprio:
  - presenca
  - papel atual
  - dono do controle
  - participantes
- eventos de auditoria proprios, sem misturar com `host link`

### Estrategia de rollback
Se houver dificuldade tecnica, a feature deve poder ser reduzida de escopo sem quebrar o core:
- fase 1 pode cair para `viewer-only`
- controle pode ficar restrito ao owner no primeiro corte
- o convite pode nascer apenas como `link autenticado interno`
- se necessario, a criacao da sessao compartilhada pode ser escondida por feature flag sem impactar terminal, auditoria ou host link

### Regras minimas
- participante deve estar na mesma organizacao
- participante deve ter acesso normal ao host
- sessao deve ser marcada explicitamente como compartilhada
- apenas um controlador por vez no primeiro corte
- viewers nao enviam input
- troca de controle precisa ser explicita e auditada

### O que nao fazer no primeiro corte
- varios usuarios digitando ao mesmo tempo sem arbitragem
- compartilhamento cross-tenant
- link publico abrindo sessao compartilhada controlavel sem trilha forte
- acoplamento direto do terminal individual a logica de convite, presenca e arbitragem

### Auditoria minima
- sessao marcada como `shared`
- lista de participantes
- entrada e saida de cada participante
- quem estava com controle
- cada input associado ao usuario que enviou

Eventos sugeridos:
- `SHARED_SESSION_CREATED`
- `SHARED_SESSION_JOINED`
- `SHARED_SESSION_LEFT`
- `SHARED_SESSION_CONTROL_GRANTED`
- `SHARED_SESSION_CONTROL_REVOKED`
- `SHARED_SESSION_INPUT`

## Relacao entre as frentes
No futuro, um `host link` pode ser usado para entrar em uma `shared terminal session`, mas isso deve vir depois.

No primeiro corte:
- `host link` abre host em sessao propria
- `shared terminal session` nasce como fluxo proprio, iniciado por usuario autenticado dentro da plataforma

## Fases recomendadas

### Fase 1
- `host link` autenticado interno
- expiracao curta
- revogacao
- auditoria completa

### Fase 2
- `host link` publico de uso unico
- expiracao configuravel `5/10/30 min`
- auditoria reforcada
- permissao restrita para criacao

### Fase 3
- `shared terminal session`
- owner + viewers
- um controlador por vez
- session audit com identidade por participante

### Fase 3.1 sugerida
Primeiro corte tecnico com menor risco:
- owner cria sessao compartilhada a partir de uma sessao ja aberta
- convidados entram por `link autenticado interno`
- participantes entram inicialmente como `viewer`
- apenas owner envia input
- backend registra presenca e eventos de entrada/saida
- auditoria marca a sessao como compartilhada e relaciona participantes

### Fase 3.2 sugerida
Evolucao controlada:
- concessao explicita de controle para um participante por vez
- indicador visual de quem esta com controle
- eventos de auditoria para grant/revoke
- opcionalmente pedido de controle posterior

Escopo recomendado:
- manter `viewer-only` como estado padrao
- participante nao assume controle automaticamente ao entrar
- owner continua com controle por default
- participante precisa solicitar controle explicitamente
- owner aprova ou nega
- controle tem duracao curta e revogavel

Fluxo recomendado:
1. viewer entra como `viewer`
2. viewer clica `Solicitar controle`
3. owner recebe pedido visivel
4. owner aceita ou nega
5. se aceitar:
   - viewer vira `controller` temporario
   - owner vira observador com poder de revogar
6. ao expirar lease, encerrar sessao ou revogar:
   - controle volta para o owner

Regra adicional:
- o owner pode `retomar controle` a qualquer momento, mesmo com lease ainda vigente
- a duracao `2/5/10/30 min` funciona como limite maximo da concessao ao participante, nao como bloqueio ao owner
- a retomada antecipada deve ficar auditada como revogacao/retomada pelo owner

Regras de protecao:
- nunca mais de um controlador ao mesmo tempo
- nenhum input concorrente de dois usuarios
- owner sempre pode revogar o controle imediatamente
- opcionalmente bloquear concessao em hosts `global` sem confirmacao extra
- se o owner sair ou a sessao terminar, o controle lease encerra automaticamente

Lease de controle recomendado:
- curto por default: `2` ou `5 min`
- renovacao sempre explicita
- sem renovacao silenciosa

UX minima recomendada:
- banner explicito:
  - `Sessao ao vivo`
  - `Controlando agora: Fulano`
- quando outra pessoa estiver controlando, o owner deve ver acao explicita de `Retomar controle`

Refinamento visual futuro:
- ao transferir controle para o participante, a viewport do terminal pode deslocar levemente antes de se estabilizar no primeiro comando/output
- isso deve ser tratado como polimento de UX da transicao de controle, nao como falha funcional do recurso

Evolucao futura de retomada do viewer:
- se o participante fechar a janela, navegar sem querer ou perder a tela de acompanhamento, a plataforma pode indicar na tela principal que a `sessao ao vivo` ainda esta ativa
- enquanto o link continuar valido e a sessao compartilhada nao tiver sido revogada/encerrada, o participante autorizado deve conseguir voltar sem precisar de um novo link do owner
- essa retomada nao deve burlar:
  - expiracao do link
  - revogacao da sessao compartilhada
  - perda de acesso ao host
  - troca de tenant ou sessao autenticada invalida
- botoes distintos:
  - `Solicitar controle`
  - `Aceitar`
  - `Negar`
  - `Revogar controle`
- feedback claro quando o usuario estiver apenas observando

Protecao de auditoria:
- nao misturar input de colaboracao com input do owner sem identidade
- cada input deve ser associado ao usuario que tinha controle naquele instante
- registrar janelas de controle, nao apenas eventos soltos
- manter:
  - auditoria da sessao base
  - eventos administrativos de colaboracao
- opcional posterior:
  - enriquecer `session_audit` com epochs de controle

Regra recomendada:
- eventos de permissao e governanca ficam em `AdminLog`
- contexto de colaboracao da sessao fica refletido em `SessionAudit`

Eventos minimos adicionais:
- `SHARED_SESSION_CONTROL_REQUESTED`
- `SHARED_SESSION_CONTROL_GRANTED`
- `SHARED_SESSION_CONTROL_DENIED`
- `SHARED_SESSION_CONTROL_REVOKED`
- `SHARED_SESSION_CONTROL_EXPIRED`
- `SHARED_SESSION_INPUT`

Metadados minimos por evento:
- `sharedSessionId`
- `sessionId`
- `hostId`
- `requestedBy`
- `approvedBy` quando houver
- `controllerUserId`
- `leaseStartedAt`
- `leaseExpiresAt`
- `reason` quando houver negacao/revogacao

Uso recomendado de `AdminLog`:
- responder quem pediu controle
- quem aprovou ou negou
- quando o controle foi concedido
- quando terminou e por qual motivo
- manter trilha operacional clara e pesquisavel

Enriquecimento recomendado de `SessionAudit`:
- marcar a sessao como colaborativa:
  - `sharedSession: true`
  - `participantsCount`
- registrar participantes:
  - `userId`
  - `name`
  - `role`
  - `joinedAt`
  - `leftAt`
- registrar janelas de controle:
  - `controllerUserId`
  - `grantedByUserId`
  - `startedAt`
  - `endedAt`
  - `endReason`

Objetivo desse enrich:
- deixar claro no detalhe da auditoria que houve mais de um participante
- evitar leitura enganosa de que apenas o owner executou toda a sessao
- permitir timeline consistente entre sessao, participantes e controle

Modelo tecnico sugerido:
- adicionar `SharedSessionControlLease` ou equivalente
- campos minimos:
  - `id`
  - `sharedSessionId`
  - `controllerUserId`
  - `grantedByUserId`
  - `startedAt`
  - `expiresAt`
  - `revokedAt`
  - `revokeReason`

Boundary de implementacao:
- o broker compartilhado continua responsavel por presenca/output
- arbitragem de input fica em camada propria da `shared-session`
- nao alterar o contrato do terminal individual alem do necessario para identificar o controlador ativo

### Backlog tecnico executavel - Fase 3.2

#### 1. Dados
- adicionar entidade `SharedSessionControlLease`
- adicionar campo ou marca de `sharedSession` na auditoria, se ainda nao existir de forma clara
- definir estrutura de persistencia para:
  - participantes da sessao
  - janelas de controle
  - motivo de revoke/expire

Entregavel minimo:
- migration com `SharedSessionControlLease`
- schema compartilhado para:
  - `request control`
  - `grant/deny/revoke`
  - `control lease public`

Status atual:
- modelagem Prisma concluida
- migration criada
- contratos compartilhados de controle concluidos

#### 2. Backend HTTP
- endpoint para solicitar controle
- endpoint para aprovar controle
- endpoint para negar controle
- endpoint para revogar controle
- endpoint opcional para listar estado atual de controle

Regras obrigatorias:
- apenas viewer pode solicitar
- apenas owner pode aprovar/negar/revogar
- apenas um lease ativo por `sharedSession`
- lease expirado nao pode continuar aceitando input

Entregavel minimo:
- service desacoplado de arbitragem
- `AdminLog` para request/grant/deny/revoke/expire

Status atual:
- endpoints de `request/grant/deny/revoke` concluidos
- `AdminLog` de request/grant/deny/revoke concluido
- lease ativa persistida e retornada no contrato

#### 3. Gateway compartilhado
- canal dedicado para:
  - `control_requested`
  - `control_granted`
  - `control_denied`
  - `control_revoked`
  - `control_expired`
- broker deve conhecer o controlador ativo
- input vindo do viewer so passa se houver lease valido
- input do owner deve respeitar regra de controlador ativo

Regra de seguranca:
- se existir lease ativo para outro usuario, input concorrente deve ser bloqueado
- em caso de duvida ou estado invalido, fallback seguro e negar input

Entregavel minimo:
- um unico controlador real por vez
- lease expira sozinho
- revogacao imediata pelo owner

Status atual:
- broker de controle no backend concluido
- terminal do owner respeita lease ativa sem alterar o fluxo normal quando nao houver controle concedido
- input de viewer continua bloqueado por padrao e so pode seguir quando houver lease valida

#### 4. Auditoria
- gravar eventos de permissao em `AdminLog`
- enriquecer `SessionAudit` com:
  - `sharedSession: true`
  - `participantsCount`
  - participantes
  - control epochs

Entregavel minimo:
- detalhe da auditoria deve mostrar que havia mais de um participante
- timeline deve indicar quem controlou e em qual janela

Status atual:
- detalhe da `SessionAudit` enriquecido com contexto de sessao compartilhada
- participantes e quantidade de participantes expostos na auditoria detalhada
- janelas de controle expostas com controller, grantor e motivo de encerramento

#### 5. UI owner
- banner de sessao colaborativa
- lista de participantes
- pedidos pendentes de controle
- acoes:
  - `Aceitar`
  - `Negar`
  - `Revogar controle`
- indicador persistente de quem controla agora

Entregavel minimo:
- owner consegue operar sem sair do terminal
- estado visual sempre explicito

Status atual:
- acoes de grant/deny/revoke expostas na tela da sessao ao vivo
- participantes e pedidos pendentes visiveis no painel lateral
- indicador visual de quem controla agora concluido

#### 6. UI viewer
- botao `Solicitar controle`
- feedback:
  - `solicitado`
  - `aprovado`
  - `negado`
  - `expirado`
- estado visual `somente leitura` vs `controlando`

Entregavel minimo:
- viewer nunca fica em estado ambiguo sobre poder ou nao digitar

Status atual:
- viewer pode solicitar controle na tela da sessao ao vivo
- estado visual de `somente leitura` vs `controlando` concluido
- expiracao, revogacao e bloqueio de input com feedback no terminal concluidos

#### 7. Ordem sugerida
1. dados + schemas
2. service HTTP + `AdminLog`
3. arbitragem no gateway
4. UI owner
5. UI viewer
6. enrich de `SessionAudit`

#### 8. Corte minimo seguro
Se precisarmos reduzir escopo:
- implementar request/grant/revoke sem renovacao
- lease unico de `2 min`
- sem fila de pedidos
- sem multiplos niveis de permissao
- enrich de auditoria em bloco resumido, sem timeline visual sofisticada

## Direcao tecnica resumida
- modelar link e sessao compartilhada como entidades separadas
- nao usar o mesmo token/objeto para resolver ambos os problemas
- manter enforcement principal no backend
- frontend deve explicar claramente:
  - se o link exige login
  - se e uso unico
  - se esta expirado
  - se a sessao esta compartilhada
  - quem esta no controle

## Proposta tecnica inicial - Fase 3.1

### Objetivo tecnico do primeiro corte
Permitir que uma sessao SSH ja aberta seja observada por outros usuarios autenticados do mesmo tenant, sem reescrever o gateway SSH atual e sem misturar a logica de colaboracao com `host link`.

### Estrategia base
- a sessao SSH continua sendo criada e mantida pelo `ssh.gateway`
- a camada compartilhada observa e retransmite o output da sessao existente
- no primeiro corte, apenas o owner envia input
- viewers entram por fluxo proprio e recebem espelhamento de output + presenca

### Entidades sugeridas

#### `SharedSession`
- `id`
- `tenantId`
- `hostId`
- `ownerUserId`
- `sessionId`
- `status`: `ACTIVE` | `ENDED` | `REVOKED`
- `joinTokenHash`
- `expiresAt`
- `createdAt`
- `updatedAt`

#### `SharedSessionParticipant`
- `id`
- `sharedSessionId`
- `userId`
- `role`: `OWNER` | `VIEWER`
- `joinedAt`
- `leftAt`
- `lastSeenAt`

Observacao:
- no primeiro corte nao precisa tabela de grant de controle separada, porque o controle fica fixo no owner
- se a fase evoluir, pode entrar `SharedSessionControlLease` ou campo dedicado no `SharedSession`

### Repositorio/backend module
- `shared-session.repository`
  - CRUD da sessao compartilhada
  - participantes
  - lookups por token
- `shared-session.service`
  - criacao
  - validacao de acesso
  - join/leave
  - encerramento
  - auditoria
- `shared-session.controller`
  - endpoints HTTP para create/get/revoke/resolve
- `shared-session.gateway`
  - websocket/namespace dedicado para viewers e presenca

### Endpoints HTTP sugeridos

#### `POST /shared-sessions`
Cria sessao compartilhada a partir de uma sessao SSH ativa.

Body minimo:
- `sessionId`
- `expiresInMinutes`

Resposta:
- `sharedSessionId`
- `joinUrl`
- `expiresAt`
- `host`
- `owner`

Regras:
- sessao precisa existir e estar ativa
- owner precisa ser o dono da sessao ou admin
- session audit deve estar habilitada ou, no minimo, a sessao precisa aceitar trilha de auditoria complementar

#### `GET /shared-sessions/:id`
Retorna estado resumido da sessao compartilhada para tela interna.

Resposta minima:
- host
- owner
- status
- participantes ativos
- expiresAt

#### `POST /shared-sessions/:token/resolve`
Resolve convite autenticado para ingresso.

Regras:
- usuario autenticado
- mesmo tenant
- link valido, nao expirado, nao revogado
- usuario com acesso normal ao host

Resposta minima:
- `sharedSessionId`
- `role`
- `host`
- `owner`
- `wsChannel`

#### `DELETE /shared-sessions/:id`
Revoga/encerra compartilhamento.

Regras:
- owner ou admin

### Eventos websocket sugeridos

Namespace/canal proprio, separado do websocket SSH atual.

#### cliente -> servidor
- `shared_session_join`
  - `sharedSessionId`
- `shared_session_leave`
  - `sharedSessionId`
- `shared_session_ping`
  - `sharedSessionId`

#### servidor -> cliente
- `shared_session_snapshot`
  - estado inicial
  - host
  - owner
  - participantes
  - role atual
- `shared_session_participant_joined`
- `shared_session_participant_left`
- `shared_session_output`
  - chunk de stdout
  - no primeiro corte apenas output; input do owner nao precisa virar evento separado para viewers se o output ja espelha o suficiente
- `shared_session_ended`
- `shared_session_error`

### Integracao com `ssh.gateway`
Para manter baixo acoplamento:
- `ssh.gateway` publica output da sessao ativa para um broker interno opcional
- `shared-session.gateway` consome esse broker apenas para sessoes marcadas como compartilhadas
- se nao houver sessao compartilhada para aquele `sessionId`, nada muda no fluxo atual

Forma minima de fazer isso:
- registro em memoria por `sessionId`
- callback/event emitter interno para `stdout`, `session_ended`, `session_error`
- sem alterar o contrato principal do websocket SSH com o terminal owner

### Integracao com auditoria
Nao reescrever `session_audit`.

Complemento recomendado:
- `AdminLog` para eventos de colaboracao:
  - `SHARED_SESSION_CREATED`
  - `SHARED_SESSION_JOINED`
  - `SHARED_SESSION_LEFT`
  - `SHARED_SESSION_REVOKED`
- opcional posterior:
  - enrich do `session_audit` com metadados de participantes por sessao

No primeiro corte, o essencial e:
- trilha de quem criou
- quem entrou
- quando entrou/saiu
- host e sessao de origem

### Frontend sugerido

#### store/composable novo
- `useSharedTerminalSession`
Campos:
- `sharedSessionId`
- `role`
- `owner`
- `participants`
- `status`
- `expiresAt`

Responsabilidades:
- conectar no canal compartilhado
- manter presenca local
- expor estado para a UI

#### fluxo de UI
- owner abre terminal normal
- aciona `Compartilhar sessao`
- gera link autenticado interno
- viewer abre link
- se autenticado e autorizado, cai em uma tela de `shared session`
- essa tela mostra:
  - host
  - owner
  - participantes
  - status `somente visualizacao`

### Feature flag recomendada
- `FEATURE_SHARED_TERMINAL_SESSION`

Se desligada:
- endpoints retornam `404` ou `403` controlado
- UI oculta a entrada de compartilhamento
- terminal individual segue identico

### Critério de sucesso do primeiro corte
- owner compartilha sessao ativa
- status atual:
  - item 1 concluido: modelagem Prisma e schemas compartilhados
  - item 2 concluido: modulo HTTP desacoplado com `create`, `get`, `resolve` e `revoke`
  - item 3 concluido no backend: broker em memoria + websocket dedicado para presenca/output em modo `viewer-first`
  - item 4 concluido no frontend: acao rapida no terminal, entrada por link e tela `viewer-only`
  - proximo passo: refinamentos de UX e, se fizer sentido, concessao explicita de controle numa fase posterior
- viewer autenticado e autorizado entra
- viewer recebe output em tempo real
- owner continua operando normalmente
- eventos de criacao/join/leave ficam auditados
- desligar a feature nao quebra o terminal atual
