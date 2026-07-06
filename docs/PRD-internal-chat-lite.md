# PRD Lite - Chat Interno da Plataforma

Versao curta para estruturar um modulo de chat interno no NodeAccess.

## Objetivo

Criar um sistema de chat interno, modular e licenciavel, para comunicacao entre usuarios da plataforma, com historico, midias, busca eficiente, controle de storage, favoritos e arquitetura preparada para integracoes futuras com WhatsApp via Evolution API e API oficial.

## Visao de produto

O chat deve ser um recurso operacional do NodeAccess, nao apenas uma tela de mensagens.

Ele deve ajudar equipes tecnicas a:

- conversar dentro do contexto da plataforma
- preservar historico operacional
- compartilhar evidencias, prints, audios e videos
- favoritar contatos, mensagens e trechos relevantes
- localizar conversas antigas com desempenho aceitavel
- futuramente integrar canais externos, como WhatsApp

## Principios

- modularidade desde o inicio
- baixo acoplamento com auth, usuarios, licenca e storage
- SOLID como diretriz pratica, sem criar abstracoes prematuras
- contratos internos claros entre dominio, realtime, storage e busca
- licenciamento e habilitacao por usuario separados
- historico confiavel e recuperavel
- midias fora do banco relacional
- busca desenhada desde o primeiro corte
- UX eficiente, parecida com apps modernos de mensagem, mas adequada ao contexto operacional
- uso racional de CPU, memoria, disco e conexoes WebSocket
- preparado para mover componentes para outro servidor no futuro

## Escopo funcional

### 1. Licenciamento

Permitir habilitar o chat por licenca do tenant.

Requisitos:

- entitlement `chatEnabled`
- limites por licenca:
  - usuarios com chat habilitado
  - storage total do tenant
  - storage por usuario
  - tamanho maximo de arquivo
  - retencao de historico
  - recursos avancados, se necessario
- frontend deve esconder ou bloquear a navegacao quando o tenant nao tiver direito ao recurso
- backend deve validar entitlement em todas as rotas e eventos realtime

Documento relacionado:

- `docs/PRD-license-entitlements-lite.md`

### 2. Habilitacao por usuario

Mesmo com o tenant licenciado, o chat deve poder ser habilitado/desabilitado por usuario.

Requisitos:

- flag administrativa por usuario: `chatEnabled`
- usuario desabilitado nao pode enviar, receber em realtime ou aparecer como contato ativo de chat
- historico antigo deve permanecer auditavel conforme politica de retencao
- desabilitar chat nao deve apagar mensagens automaticamente
- UI administrativa deve exibir status do chat por usuario

### 3. Conversas e historico

Tipos recomendados:

- conversa direta 1:1
- grupo interno
- canal por equipe ou contexto operacional, em fase posterior

Historico:

- mensagens persistentes
- edicao e exclusao logica opcionais, com regras claras
- marcador de entrega/leitura
- paginação por cursor, nunca carregar historico completo
- suporte a anexos e metadados

## Recomendacao de banco, storage e busca

### Decisao recomendada para primeiro corte

Usar a stack atual:

- MySQL para dados transacionais:
  - conversas
  - participantes
  - mensagens
  - recibos de leitura
  - favoritos
  - metadados de anexos
  - quotas
- Redis para realtime leve:
  - presenca
  - fanout temporario
  - notificacoes transientes
  - rate limit
- Object storage para midias:
  - S3, MinIO ou storage compativel
  - nunca armazenar binario grande em MySQL
- MySQL FULLTEXT ou indice dedicado para busca inicial
- Search engine dedicado apenas quando volume justificar:
  - OpenSearch, Elasticsearch ou Meilisearch

### Por que nao colocar tudo no MySQL

MySQL e adequado para mensagens e metadados, mas nao e ideal para audio, fotos e videos. Binarios grandes no banco dificultam backup, restore, limpeza, custo de storage e desempenho geral.

### Estrategia de busca

Fase 1:

- MySQL com indices adequados e busca full-text para texto de mensagens
- busca por conversa, usuario, data e tipo de midia
- paginação por cursor

Fase 2:

- indexador assincrono para motor de busca dedicado
- reindexacao por tenant/conversa
- fallback para MySQL se o motor de busca estiver indisponivel

Recomendacao critica:

- nao iniciar com OpenSearch/Elasticsearch se o volume ainda for pequeno
- desenhar a interface `ChatSearchService` desde o inicio para permitir troca futura
- nao acoplar tela ou dominio diretamente a um provider de busca

## Modelo de dominio sugerido

Entidades principais:

- `ChatConversation`
  - id
  - tenantId
  - type: `direct`, `group`, futuro `channel`
  - title
  - createdBy
  - createdAt
  - updatedAt
  - lastMessageAt

- `ChatParticipant`
  - conversationId
  - userId
  - role: `member`, `admin`, `owner`
  - joinedAt
  - leftAt
  - mutedUntil
  - archivedAt

- `ChatMessage`
  - id
  - tenantId
  - conversationId
  - senderUserId
  - type: `text`, `image`, `audio`, `video`, `file`, `system`
  - bodyText
  - status
  - replyToMessageId
  - createdAt
  - editedAt
  - deletedAt

- `ChatAttachment`
  - id
  - messageId
  - tenantId
  - storageProvider
  - objectKey
  - mimeType
  - originalName
  - sizeBytes
  - durationMs
  - width
  - height
  - checksum
  - createdAt

- `ChatReadReceipt`
  - messageId
  - userId
  - readAt

- `ChatFavoriteContact`
  - userId
  - contactUserId
  - createdAt

- `ChatFavoriteMessage`
  - userId
  - messageId
  - createdAt
  - note

- `ChatFavoriteMessageRange`
  - userId
  - conversationId
  - startMessageId
  - endMessageId
  - title
  - note
  - createdAt

- `ChatStorageQuota`
  - tenantId
  - userId
  - usedBytes
  - limitBytes
  - updatedAt

## Arquitetura recomendada

### Modulo backend

Criar modulo proprio:

- `apps/backend/src/modules/chat`

Subcamadas recomendadas:

- `domain`
  - entidades, regras e tipos internos
- `application`
  - casos de uso: enviar mensagem, listar conversas, marcar lido, favoritar, buscar
- `infrastructure`
  - repositorios Prisma/MySQL
  - storage provider
  - search provider
  - realtime gateway
- `presentation`
  - rotas REST
  - schemas
  - websocket events

Interfaces importantes:

- `ChatRepository`
- `ChatAttachmentStorage`
- `ChatSearchIndex`
- `ChatRealtimePublisher`
- `ChatQuotaService`
- `ChatRetentionService`
- `ExternalChatProvider`

### Separacao de realtime

O realtime deve ser separado do dominio.

Fluxo recomendado:

1. API valida permissao/licenca/quota.
2. Caso de uso persiste mensagem.
3. Evento interno e emitido.
4. Realtime entrega para participantes conectados.
5. Indexador e rotinas assincronas processam busca, preview e metadados.

Falha no realtime nao deve perder a mensagem persistida.

## UX e design

### Objetivo de UX

Criar experiencia parecida com WhatsApp em familiaridade, mas mais adequada a um produto operacional web.

### Estrutura recomendada

Desktop:

- coluna esquerda:
  - busca
  - contatos favoritos
  - conversas recentes
  - filtros
- painel central:
  - historico da conversa
  - agrupamento por data
  - estados de entrega/leitura
  - mensagens favoritas destacaveis
- painel direito opcional:
  - detalhes do contato/grupo
  - midias compartilhadas
  - mensagens favoritas
  - trechos favoritos

Mobile:

- lista de conversas como primeira tela
- conversa em tela cheia
- detalhes em drawer
- composer fixo inferior

### Recursos de UX

- enviar texto
- emojis
- upload de imagem, video, audio e arquivo
- gravacao de audio no browser quando suportado
- preview antes de enviar midia
- indicador de upload
- erro claro quando faltar storage
- marcador de lido
- favoritos de contato
- favoritos de mensagem
- favoritos de trecho de mensagens
- busca global e busca dentro da conversa
- filtros por midia, data, contato e favorito
- empty states claros
- loading skeleton para historico
- feedback de falha de envio com tentativa de reenviar

## Controle de storage

Requisitos:

- quota por tenant
- quota por usuario
- bloqueio de upload quando exceder limite
- aviso preventivo quando usuario estiver perto do limite
- tela de uso de storage
- limpeza por politica de retencao
- relatorio de maiores consumidores de storage
- compressao/transcodificacao opcional futura para imagens/videos

Mensagens recomendadas:

- `Sua caixa de mensagens esta quase cheia`
- `Envio bloqueado: limite de armazenamento atingido`
- `Libere espaco removendo midias antigas ou solicite aumento de limite`

Regra importante:

- texto de mensagens consome pouco e pode ter retencao diferente de midias
- midias devem ter politica de limpeza mais agressiva e configuravel

## Backup, recuperacao e limpeza

### Backup

- backup do MySQL cobre mensagens e metadados
- backup do object storage cobre anexos
- snapshots devem ter correlacao por tenant e timestamp
- checksum dos anexos deve permitir validacao de integridade

### Recuperacao

- restore completo por tenant deve ser planejado
- restore parcial por conversa pode ser fase futura
- anexos ausentes devem ser tratados com placeholder claro na UI

### Limpeza

- politica por tenant:
  - reter mensagens por N dias
  - reter midias por N dias
  - limpar conversas arquivadas apos N dias
- job assincrono para expurgo
- soft delete antes de hard delete quando necessario
- log administrativo para execucao de limpeza

## Integracao futura com WhatsApp

Preparar arquitetura, mas nao implementar no MVP.

Providers futuros:

- Evolution API
- WhatsApp Business Cloud API oficial

Diretriz:

- integracao externa deve ser adaptador, nao parte do dominio central
- mensagens internas e externas devem ser normalizadas para um contrato comum
- provider externo nao deve definir o modelo interno

Interface sugerida:

- `ExternalChatProvider`
  - enviar mensagem
  - receber webhook
  - mapear status de entrega
  - baixar midia
  - validar assinatura/callback

Cuidados:

- consentimento e LGPD
- custos por conversa/mensagem no WhatsApp oficial
- rate limits
- webhooks assinados
- armazenamento de midias externas
- separacao clara entre contato interno e contato externo

## Recurso opcional em outra maquina

O chat deve poder evoluir para componente separado.

Arquitetura preparada para:

- API principal usando modulo local no primeiro corte
- workers de chat separados no futuro
- realtime gateway separado no futuro
- storage e search independentes
- filas/Redis como fronteira entre API e processamento assíncrono

Nao recomendado no MVP:

- criar microservico separado antes de validar uso real

Recomendado:

- modular monolith primeiro
- contratos internos claros
- workers separaveis depois

## Performance e eficiencia

Requisitos:

- paginação por cursor em mensagens
- nao carregar anexos binarios junto com historico
- thumbnails e previews sob demanda
- upload direto para storage quando viavel
- limitar tamanho e tipo de arquivo
- rate limit por usuario
- compressao de imagens futura
- processamento de video/audio assíncrono
- evitar fanout caro para usuarios offline
- nao usar polling agressivo; preferir WebSocket/eventos
- indices por `tenantId`, `conversationId`, `createdAt`, `senderUserId`

## Seguranca e privacidade

- isolamento por tenant
- autorizacao por participante da conversa
- validacao de tipo/tamanho de arquivo
- antivirus/scan de anexos como evolucao recomendada
- URLs de midia assinadas e temporarias
- nao expor object keys diretamente quando evitavel
- logs sem conteudo sensivel desnecessario
- auditoria de acoes administrativas
- politica clara para retencao e exclusao
- avaliar criptografia em repouso para anexos
- avaliar criptografia ponta a ponta apenas se houver requisito formal, pois aumenta complexidade de busca, moderacao e recuperacao

## MVP recomendado

Primeiro corte:

- entitlement `chatEnabled`
- habilitar/desabilitar chat por usuario
- conversa 1:1
- texto
- emojis
- historico paginado
- marcar como lido
- favoritos de contatos
- favoritos de mensagens
- busca textual simples com MySQL FULLTEXT
- anexos de imagem e arquivo pequeno
- quota basica por usuario/tenant
- backup via MySQL + object storage
- UI desktop funcional

Nao incluir no MVP:

- audio gravado no browser
- video pesado
- grupos complexos
- favoritos de trecho
- WhatsApp
- search engine dedicado
- microservico separado
- criptografia ponta a ponta

## Fase 2

- grupos internos
- audio
- video
- favoritos de trecho de mensagens
- busca avancada por midia, data e favorito
- painel de storage por usuario
- jobs de limpeza configuraveis
- previews/thumbnails
- mobile refinado
- indexador assíncrono

## Fase 3

- Evolution API
- WhatsApp Business Cloud API oficial
- motor de busca dedicado, se necessario
- realtime gateway separado
- processamento de midia separado
- politicas avancadas de retencao por tenant/grupo
- exportacao legal/auditoria de conversas conforme permissao

## Decisoes criticas

1. Nao armazenar audio, foto ou video diretamente no MySQL.
2. Comecar com modular monolith, nao microservico.
3. Criar interface de busca desde o inicio, mesmo que a implementacao inicial seja MySQL.
4. Separar licenca do tenant, habilitacao por usuario e permissao de conversa.
5. Tratar WhatsApp como provider externo futuro, nao como base do chat interno.
6. Definir quota e retencao antes de liberar midia ampla.
7. Nao prometer experiencia identica ao WhatsApp no primeiro corte; priorizar confiabilidade e controle operacional.

## Riscos

- custo de storage crescer rapidamente com audio/video
- busca ficar lenta se desenhada tarde
- anexos dificultarem backup e restore se ficarem no banco relacional
- WebSocket consumir recursos se presenca/fanout forem mal planejados
- integracao WhatsApp contaminar dominio interno
- UX ficar pesada se tentar replicar todos os recursos de mensageria de uma vez
- favoritos de trechos exigirem modelo bem pensado para nao quebrar com exclusao/edicao de mensagens

## Criterios de aceite

- chat so aparece para tenant licenciado
- usuario sem chat habilitado nao acessa rotas nem eventos realtime do chat
- mensagens 1:1 persistem e carregam por paginação
- leitura e nao lido funcionam corretamente
- busca retorna historico antigo com tempo aceitavel no volume alvo definido
- anexos respeitam limite de tipo, tamanho e quota
- usuario recebe aviso claro de falta de storage
- favoritos de contato e mensagem funcionam
- backup e restore possuem procedimento documentado
- arquitetura permite trocar storage/search/provider sem reescrever o dominio

## Arquivos provaveis

Backend:

- `apps/backend/src/modules/chat/*`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/src/modules/license/*`
- `apps/backend/src/modules/users/*`
- `apps/backend/src/shared/realtime/*`, se existir ou for criado

Frontend:

- `apps/frontend/src/views/ChatView.vue`
- `apps/frontend/src/components/chat/*`
- `apps/frontend/src/services/chat.service.ts`
- `apps/frontend/src/router/index.ts`
- `apps/frontend/src/layouts/AppLayout.vue`

Shared:

- `packages/shared/src/schemas/chat.schema.ts`
- `packages/shared/src/types/*`

Infra:

- storage S3/MinIO compativel
- Redis
- job runner/worker para limpeza, indexacao e processamento futuro

## Status

- documentado para avaliacao arquitetural e retomada futura
- sem implementacao iniciada neste PRD
