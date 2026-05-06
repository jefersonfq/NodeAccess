# PRD Session Audit Lite

## Nome recomendado
`Auditoria de Sessao SSH`

Subcapacidades dentro do mesmo dominio:
- `Auditoria de comandos`
- `Gravacao de sessao`
- `Replay de sessao`
- `Resumo por IA`
- `Guardrails de comando`
- `Contexto operacional por ticket`

## Objetivo
Adicionar rastreabilidade de uso do terminal SSH sem degradar perceptivelmente a latencia do produto nem aumentar demais o custo operacional do backend principal.

## Problema
Hoje o NodeAccess registra autenticacao, logs administrativos e sessoes, mas nao preserva com detalhe:
- comandos enviados durante a sessao
- saida observada no terminal
- contexto temporal do que aconteceu
- trilha suficiente para auditoria operacional e compliance

Isso limita:
- investigacao de incidente
- trilha de mudanca operacional
- revisao posterior de uso indevido
- base para replay visual da sessao
- geracao de resumo operacional amigavel
- uso de IA para leitura posterior ou em tempo real
- correlacao entre sessao tecnica e demanda formal de mudanca

## Direcionamento de Produto
- tratar auditoria de comandos e gravacao de sessao como partes relacionadas, mas nao identicas
- priorizar um desenho assicrono e desacoplado do gateway SSH
- evitar parse pesado em tempo real no caminho critico da sessao
- manter captura suficiente para auditoria futura, mesmo quando a classificacao de comando nao for perfeita
- separar claramente:
  - captura bruta
  - enriquecimento por IA
  - enforcement preventivo
  - apresentacao e relatorio

## Principio Central
O artefato primario deve ser o `stream auditavel da sessao`, nao uma lista "magica" de comandos inferidos em tempo real.

Motivo:
- shell interativo nao garante fronteira confiavel de comando
- existe echo local/remoto, autocomplete, backspace, prompt customizado, `vim`, `top`, `less`, `nano`, `tmux`
- capturar apenas "comandos" perde contexto e gera falso positivo

## Lista simplificada de comandos
### Posicionamento
A lista de comandos deve existir como uma visao derivada da auditoria SSH, nao como fonte primaria.

Motivo:
- ajuda a revisar rapidamente uma sessao
- facilita investigacao operacional e compliance
- permite exportacao amigavel para CAB, incidente ou suporte
- preserva o stream bruto como evidencia completa quando a inferencia de comandos for imperfeita

### UX recomendada
- manter a lista dentro do detalhe da auditoria da sessao, em aba propria `Comandos`
- exibir aviso claro de que os comandos sao reconstruidos a partir da captura SSH
- mostrar comando, horario, ator, confianca e saida associada
- manter a saida recolhida por padrao para reduzir ruido visual
- permitir expandir a saida por comando
- permitir busca por comando e saida
- permitir limite de comandos carregados para evitar telas pesadas
- permitir exportacao CSV/JSON da lista carregada ou filtrada

### Exportacao recomendada
Primeiro corte:
- exportar CSV no frontend a partir dos comandos carregados
- incluir:
  - sessao
  - host
  - usuario/ator
  - indice
  - horario
  - confianca
  - comando
  - saida resumida

Evolucao:
- endpoint dedicado para exportacao server-side quando houver necessidade de exportar todos os comandos de sessoes muito grandes
- tela global de busca de comandos apenas quando os comandos derivados forem persistidos/indexados

### Regra de comunicacao
A UI deve evitar afirmar que a lista e perfeita. Texto recomendado:
`Lista derivada da captura SSH. Use o download bruto para trilha completa.`

## Recomendacao Tecnica
### Fonte de verdade
- capturar eventos no gateway SSH
- registrar ao menos:
  - `input`
  - `output`
  - `resize`
  - `connect`
  - `disconnect`
  - `error`

### Pipeline recomendado
1. gateway SSH publica eventos de sessao em buffer pequeno e nao bloqueante
2. eventos sao enviados para uma fila duravel
3. um consumidor separado agrega os eventos por sessao
4. o consumidor persiste:
   - metadados no banco
   - chunks de stream em storage barato
5. processamento posterior deriva:
   - resumo da sessao
   - tentativa de extracao de comandos
   - replay visual

## Casos de uso futuros desejados
- gerar resumo automatico da sessao por IA
- detectar comandos potencialmente destrutivos
- bloquear ou exigir confirmacao em comandos de alto risco
- vincular sessao a ticket externo
- anexar resumo e trilha da sessao ao ticket
- gerar relatorio amigavel para auditoria e compliance

## IA: posicionamento recomendado
### Modos suportados
- `post-session`
  - menor risco operacional
  - menor impacto em latencia
  - ideal para MVP de resumo e classificacao
- `near-real-time`
  - analise por janela de eventos durante a sessao
  - pode gerar alertas e sugestoes
- `real-time enforcement`
  - caminho mais sensivel
  - deve entrar apenas depois que a captura e o modelo de risco estiverem estaveis

### Recomendacao pragmatica
- MVP: IA apenas `post-session`
- fase seguinte: `near-real-time` para alertas
- bloqueio em tempo real apenas para tenants opt-in e com politica explicita

## Guardrails de comando
### Objetivo
Permitir reduzir risco operacional sem depender de parser perfeito do shell.

### Abordagem recomendada
- usar politica por tenant com niveis:
  - `observe`
  - `warn`
  - `confirm`
  - `block`
- aplicar primeiro em padroes simples de alto risco
- registrar sempre:
  - comando observado
  - regra aplicada
  - acao tomada
  - usuario e host

### Exemplos de padroes de alto risco
- `rm -rf /`
- `mkfs`
- `dd if=`
- `shutdown`
- `reboot`
- `userdel`
- `chmod -R 777 /`

### Regra importante
- o sistema nao deve prometer bloqueio perfeito de shell arbitrario no MVP
- guardrails devem ser vendidos como controle progressivo, nao como sandbox total

## JIRA / ticket context
### Objetivo
Associar a sessao a uma mudanca, incidente ou tarefa formal.

### Fluxo desejado
1. usuario informa ou seleciona ticket
2. NodeAccess consulta dados basicos do ticket
3. sessao inicia vinculada ao ticket
4. auditoria da sessao preserva `ticketKey` e metadados relevantes
5. ao finalizar, o sistema pode:
   - gerar resumo por IA
   - anexar arquivo bruto ou link da sessao
   - publicar comentario no ticket

### Dados minimos do ticket
- `provider`
- `ticketKey`
- `title`
- `status`
- `assignee`
- `url`

### Recomendacao
- começar com integracao de leitura e vinculo manual
- adiar escrita automatica no ticket para fase posterior
- anexo/comentario automatico deve ser opt-in por tenant

## RabbitMQ: avaliacao
RabbitMQ e uma boa opcao se o objetivo for desacoplar captura e processamento.

Pontos a favor:
- desacopla o gateway do processamento pesado
- permite retry e consumidores separados
- reduz impacto de picos no gateway
- facilita adicionar pipeline futuro de replay, alertas e analytics

Pontos de atencao:
- nao deve virar armazenamento definitivo da sessao
- aumenta superficie operacional
- para escala inicial do NodeAccess, pode ser mais do que o necessario se tudo ficar no mesmo host

## Recomendacao pragmatica
### Fase inicial recomendada
- usar fila apenas como transporte assincrono
- storage final fora da fila
- gateway sem parser complexo
- manter tudo no monolito enquanto houver um unico gargalo operacional principal
- extrair worker separado antes de extrair varios microservicos especializados

### Storage final recomendado
- banco relacional para metadados, indices e status
- arquivo chunkado compactado para stream bruto
- preferencia por storage barato:
  - disco local persistente em instalacoes simples
  - S3/MinIO em instalacoes mais maduras

### Alternativas
- `Redis Streams` pode ser suficiente para MVP e operacao mais simples
- `RabbitMQ` faz mais sentido se a equipe quer separar servicos desde cedo

## Arquitetura recomendada por estagio
### Estagio 1: menor custo operacional
- gateway SSH publica eventos
- API/backend grava metadados
- um worker interno ou processo separado consome fila
- IA apenas assicrona por job

### Estagio 2: isolamento moderado
- worker de auditoria separado
- worker de IA separado
- integracao externa de tickets separada por adaptador

### Estagio 3: quando microservico faz sentido
- microservico dedicado apenas se houver necessidade clara de:
  - escala independente
  - filas e retries diferentes
  - SLA diferente do gateway
  - storage e retention com crescimento proprio

### Posicionamento recomendado
- nao quebrar em varios microservicos logo no inicio
- priorizar:
  - gateway
  - modulo `session-audit`
  - um worker
- separar servicos adicionais apenas quando a carga ou governanca exigir

## Posicionamento recomendado
- nao fazer parser de "comando final" no gateway
- nao persistir output completo em MySQL
- nao depender de RabbitMQ como retention store
- nao colocar chamada de IA no caminho sincrono do terminal
- nao colocar chamada ao JIRA no caminho sincrono de abertura da sessao

## Escopo Fase 1
### Meta
Captura confiavel e barata da sessao para auditoria basica.

### Entregas
- flag por tenant para habilitar `sessionAudit`
- eventos de sessao emitidos pelo gateway SSH
- fila assincrona entre gateway e worker
- agregacao por `sessionId`
- persistencia de metadados de auditoria
- persistencia de chunks compactados da stream
- tela administrativa para listar sessoes auditadas
- download/export da trilha bruta por sessao
- campo opcional de vinculo com ticket externo
- resumo textual simples gerado apos encerramento da sessao

### O que fica fora da fase 1
- replay visual completo
- deteccao confiavel de comando estruturado
- OCR ou video
- analytics avancado
- alerta comportamental em tempo real
- bloqueio automatico de comandos
- escrita automatica de comentario/anexo em ticket

## Escopo Fase 2
- replay textual da sessao com timeline
- busca por intervalo de tempo dentro da sessao
- tentativa de extracao de comandos em modo best-effort
- filtros por host, usuario, grupo e periodo
- politica de retencao configuravel
- integracao de leitura com JIRA
- resumo por IA mais estruturado:
  - objetivo
  - acoes executadas
  - riscos
  - proximo passo
- tela amigavel de sessao com resumo e download

## Escopo Fase 3
- heuristica de comandos com contexto de prompt
- mascaramento de segredos em exibicao
- alertas por padroes suspeitos
- exportacao para trilhas de compliance
- comentarios ou anexos automaticos em ticket
- modo `warn` ou `confirm` para comandos de alto risco

## Modelo conceitual
### Entidades sugeridas
- `SessionAudit`
  - `id`
  - `sessionId`
  - `tenantId`
  - `userId`
  - `hostId`
  - `ticketProvider`
  - `ticketKey`
  - `ticketUrl`
  - `startedAt`
  - `endedAt`
  - `status`
  - `storageDriver`
  - `chunkCount`
  - `bytesIn`
  - `bytesOut`
  - `auditEnabled`
  - `aiSummaryStatus`
  - `aiSummaryText`
- `SessionAuditChunk`
  - `id`
  - `sessionAuditId`
  - `seq`
  - `startedAt`
  - `endedAt`
  - `storageKey`
  - `compressedSize`
  - `rawSize`
- `SessionAuditDerivedCommand`
  - `id`
  - `sessionAuditId`
  - `seq`
  - `timestamp`
  - `commandText`
  - `confidence`
  - `source`
- `SessionAuditGuardrailEvent`
  - `id`
  - `sessionAuditId`
  - `timestamp`
  - `ruleId`
  - `decision`
  - `rawInput`
  - `confidence`
- `SessionAuditAiArtifact`
  - `id`
  - `sessionAuditId`
  - `kind`
  - `model`
  - `status`
  - `storageKey`

## Evento minimo sugerido
- `sessionId`
- `tenantId`
- `userId`
- `hostId`
- `type`
- `timestamp`
- `payload`
- `seq`
- `source`

Tipos esperados:
- `session_started`
- `stdin`
- `stdout`
- `resize`
- `session_ended`
- `session_error`
- `guardrail_decision`
- `ai_summary_requested`
- `ai_summary_completed`

## Regras de Produto
- auditoria deve ser opt-in por tenant ou por feature flag no inicio
- sessao sem auditoria habilitada nao deve gerar carga residual relevante
- expiracao da sessao web continua encerrando a sessao SSH na politica atual
- auditoria deve respeitar visibilidade e papel do usuario
- visualizacao da trilha auditada deve ser restrita a admin ou papel equivalente
- secrets nao devem ser expostos por API publica sem controle de acesso
- replay e extracao de comandos sao secundarios; a captura bruta e o requisito principal
- resumo por IA deve deixar claro que e derivado e pode conter erro
- bloqueio de comando deve ser opt-in e com politica auditavel
- integracao com ticket nao pode impedir a sessao tecnica se o provider externo cair, salvo politica explicita do tenant

## Regras de Seguranca
- cifrar artefatos de auditoria em repouso quando possivel
- aplicar retencao e expiracao configuravel
- permitir purge por tenant
- logar acesso a trilhas auditadas
- considerar mascaramento de segredos apenas em leitura derivada, nao alterando o bruto original
- nao enviar segredos desnecessarios para modelo de IA
- permitir desligar IA mantendo auditoria bruta
- separar credencial de integracao com ticket da credencial do host

## Riscos
- custo alto de armazenamento se gravar tudo sem compactacao
- parse incorreto de comandos interativos
- impacto de latencia se a captura bloquear o gateway
- crescimento de custo operacional se a fila for superdimensionada cedo demais
- replay parcial em apps terminal-heavy como `vim`, `top` e `tmux`
- falso positivo ou falso negativo em guardrails
- dependencia externa do JIRA aumentar falha operacional se entrar no caminho critico
- custo de IA crescer sem politica de escopo e retention

## Decisoes recomendadas
- nome do dominio: `Auditoria de Sessao SSH`
- `Auditoria de comandos` vira um produto derivado, nao o artefato primario
- `Gravacao de sessao` deve ser textual/event-driven primeiro, nao video
- usar fila como transporte, nao como storage final
- com a escala atual, avaliar `Redis Streams` primeiro e `RabbitMQ` quando houver necessidade clara de isolamento de servico
- IA entra primeiro como pos-processamento
- JIRA entra primeiro como contexto e correlacao, nao como dependencia de runtime
- microservicos apenas quando a operacao provar necessidade real

## Arquivos provaveis
- backend gateway:
  - `apps/backend/src/modules/ssh/*`
- backend API:
  - novo modulo `session-audit`
- worker:
  - agregacao de stream
  - jobs de IA
  - jobs de integracao com ticket
- frontend:
  - `apps/frontend/src/views/admin/*`
- shared:
  - `packages/shared/src/*`

## Perguntas em aberto
- auditoria sera licenciada como modulo separado no futuro?
- feature flag sera por tenant, por host ou por sessao?
- retention default sera 7, 30 ou 90 dias?
- storage inicial sera disco local, MinIO ou S3?
- a extracao de comandos precisa entrar no MVP ou pode ser fase 2?
- resumo por IA sera por todas as sessoes ou apenas sessoes vinculadas a ticket?
- bloquear comando sera por regex, politica declarativa ou motor dedicado?
- integracao inicial sera apenas JIRA ou um conceito generico de `work item provider`?
