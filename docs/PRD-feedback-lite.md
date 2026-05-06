# PRD Feedback Lite

## Objetivo
Criar um fluxo simples de feedback dentro do NodeAccess para que usuarios enviem sugestoes, problemas ou duvidas, e admins consigam visualizar, responder e atualizar o status desse retorno.

## Resultado Esperado
O usuario deve conseguir:
- enviar feedback rapidamente dentro do produto
- acompanhar o andamento do proprio feedback
- entender se a sugestao foi aceita, esta em analise, foi concluida ou nao entrou no planejamento

O admin deve conseguir:
- visualizar feedbacks do tenant
- filtrar e organizar a fila
- responder de forma curta
- atualizar status sem precisar de ferramenta externa

## Motivacao
Hoje a plataforma nao possui um canal interno simples de escuta estruturada.

Sem isso:
- feedback fica disperso
- usuario nao sabe se foi ouvido
- admin perde contexto do pedido original
- melhorias de UX e produto ficam mais dificeis de priorizar

## Escopo do MVP
### Usuario
- botao global `Enviar feedback`
- formulario curto
- lista `Meus feedbacks`
- visualizacao do status atual
- resposta curta do admin quando houver

### Admin
- inbox de feedbacks do tenant
- filtros simples
- atualizacao de status
- campo de resposta curta ao usuario

## Tipos de Feedback
- `suggestion`
- `problem`
- `question`

## Status Recomendados
- `new`
- `in_review`
- `accepted`
- `not_planned`
- `completed`

## Fluxo do Usuario
1. clicar em `Enviar feedback`
2. escolher tipo
3. preencher titulo
4. preencher mensagem
5. enviar
6. acompanhar em `Meus feedbacks`

## Fluxo do Admin
1. abrir inbox de feedbacks
2. filtrar por status, tipo ou usuario
3. abrir item
4. atualizar status
5. escrever resposta curta
6. salvar

## Dados Recomendados
### Feedback
- `id`
- `tenantId`
- `userId`
- `type`
- `title`
- `message`
- `status`
- `adminResponse`
- `contextRoute`
- `contextScreen`
- `createdAt`
- `updatedAt`
- `closedAt`

### Metadados automaticos
- rota atual
- tela atual
- versao do frontend quando possivel
- tenant
- usuario autenticado

## UX Recomendada
### Envio
Formulario curto com:
- tipo
- titulo
- mensagem

Campos opcionais futuros:
- prioridade percebida
- permitir contato

### Lista do usuario
Mostrar:
- titulo
- tipo
- status
- data
- ultima resposta

### Inbox admin
Mostrar:
- usuario
- tipo
- titulo
- status
- data

## Linguagem Recomendada
Preferir termos simples:
- `Sugestao`
- `Problema`
- `Duvida`
- `Novo`
- `Em analise`
- `Aceito`
- `Nao planejado`
- `Concluido`

Evitar linguagem juridica ou tecnica demais.

## Regras de Acesso
- usuario comum:
  - cria feedback
  - ve apenas os proprios feedbacks
- admin do tenant:
  - ve feedbacks do tenant
  - responde e atualiza status
- platform admin:
  - nao deve ver feedback cross-tenant por padrao, a menos que isso seja decisao explicita futura

## Notificacao Inicial Recomendada
No primeiro corte, nao precisa de notificacao em tempo real.

Pode funcionar assim:
- usuario entra em `Meus feedbacks`
- ve status atualizado
- opcional futuro: badge quando houver resposta nova

## MVP Tecnico Recomendado
### Backend
- modulo `feedback`
- CRUD basico:
  - criar feedback
  - listar feedbacks do usuario
  - listar feedbacks do tenant para admin
  - atualizar status e resposta do admin

### Frontend
- botao global de envio
- modal ou drawer de envio
- pagina `Meus feedbacks`
- pagina admin `Feedbacks`

## Evolucao Futura
### Fase 2
- badge de atualizacao para usuario
- filtros mais ricos para admin
- categorias por modulo

### Fase 3
- comentarios em thread
- anexos/imagens
- votos ou consolidacao de feedback semelhante

### Fase 4
- integracao com Jira interno ou backlog
- relatorios de feedback por modulo

## Fora de Escopo Inicial
- anexos
- comentarios em thread
- workflow complexo de ticket
- SLA
- integracao externa obrigatoria

## Arquivos Provaveis
- frontend:
  - novo componente global de envio de feedback
  - nova view `MyFeedbackView.vue`
  - nova view admin `FeedbackAdminView.vue`
  - servico `feedback.service.ts`
- backend:
  - `apps/backend/src/modules/feedback/*`
  - schema Prisma e migration

## Proximo Corte Recomendado
1. formulario global de feedback
2. inbox admin do tenant
3. `Meus feedbacks` para o usuario
4. status + resposta curta do admin
