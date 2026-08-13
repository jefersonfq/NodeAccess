---
change_id: NA-0033
title: Integração Jira e rastreabilidade de atendimentos SSH
type: feature
status: in_progress
created_at: 2026-08-13T20:05:00-03:00
base_branch: master
base_sha: 788c65be9f87d0556a8ef3e739fdf56056db88a3
branch: feature/NA-0033-20260813-jira-session-traceability
owner: codex
planner: codex
risk: high
issue: null
---

# NA-0033 — Integração Jira e rastreabilidade de atendimentos SSH

## Contexto e situação anterior

O NodeAccess suporta Jira por e-mail de conta de serviço e API token, com
Basic Auth. A integração valida `/rest/api/3/myself`, consulta tickets e permite
vincular um ticket a uma auditoria já criada. Não existem OAuth 2.0 3LO,
política para exigir ticket antes da conexão, agrupamento de reconexões/abas
num atendimento, comentário/anexo automático ou transição do chamado.

## Problema e objetivo

Permitir que cada atendimento SSH seja rastreável no Jira sem transformar o
fechamento de uma aba em uma alteração perigosa de workflow. Validar leitura
com credenciais reais e, quando houver autorização de escrita, publicar no
ticket um link seguro para a auditoria e opcionalmente uma evidência controlada.

## Decisões funcionais iniciais

- obrigatoriedade do ticket é configurável por tenant: `optional` ou `required`;
- quando obrigatório, o ticket deve ser validado antes da primeira conexão;
- abas duplicadas e reconexões pertencem ao mesmo atendimento enquanto houver
  uma interaction ID válida, evitando comentários e transições duplicados;
- fechar uma aba ou cair o websocket não encerra o chamado;
- ao encerrar explicitamente o atendimento, a UI informa quais ações Jira
  ocorrerão e pede confirmação quando houver transição;
- publicar comentário/link, anexar arquivo e transicionar chamado são opções
  independentes, desabilitadas quando scopes/permissões não forem suficientes;
- o link aponta para a auditoria autenticada do NodeAccess; não contém token;
- anexo nunca inclui segredos e usa export sanitizado, tamanho limitado e
  retenção explicitada;
- falha do Jira não derruba uma sessão SSH já ativa; fica pendência idempotente
  e observável para retry.

## Escopo

### 1. Autenticação e preflight

- manter compatibilidade com API token;
- adicionar OAuth 2.0 3LO para Jira Cloud: Client ID, Client Secret, callback,
  consentimento, refresh token e cloud ID;
- cifrar client secret, access token e refresh token;
- descobrir e exibir capacidades efetivas: leitura, comentário, anexo e
  transição;
- preflight read-only com `/myself`, ticket permitido e projetos configurados;
- mensagens públicas sem corpo bruto de erro ou credenciais.

### 2. Política de atendimento

- modo `optional|required`;
- projetos, tipos e estados de ticket permitidos;
- comportamento fail-open/fail-closed quando Jira estiver indisponível, com
  recomendação `fail-closed` apenas para validação inicial obrigatória;
- break-glass auditado para administradores autorizados;
- configuração independente para comentário, link, anexo e transição final.

### 3. Ciclo de vida e idempotência

- criar conceito de atendimento/interação acima das conexões SSH;
- uma interaction ID pode conter sessão inicial, reconexões e abas duplicadas;
- encerramento explícito ou timeout de inatividade configurável;
- chave idempotente por atendimento e ação Jira;
- outbox/retry para escrita no Jira sem bloquear o gateway SSH.

### 4. Rastreabilidade no Jira

- comentário inicial opcional com usuário, host e horário, sem segredo;
- comentário final com duração, sessões relacionadas e link da auditoria;
- anexo sanitizado opcional; preferir link para evitar duplicação e retenção;
- transição final opcional por ID/nome permitido, nunca assumir "Done";
- registrar status, tentativas e erro sanitizado no NodeAccess.

### 5. UX

- campo de ticket antes de conectar, com loading, válido, inválido e Jira
  indisponível;
- ticket persistido ao duplicar aba/reconectar dentro do mesmo atendimento;
- banner discreto no terminal com ticket e link;
- diálogo de encerramento informa se somente a sessão ou todo o atendimento
  será encerrado e quais ações Jira serão executadas;
- tela administrativa mostra modo de autenticação, capacidades e teste por
  operação sem efetuar escrita destrutiva.

## Fora do primeiro corte

- criar tickets automaticamente;
- tornar anexo o mecanismo principal de consulta;
- transicionar chamado com credencial somente leitura;
- fechar chamado automaticamente ao fechar aba, perder websocket ou reconectar;
- expor auditoria por link público.

## Critérios de aceitação

- [ ] API token atual continua funcional e sem regressão.
- [ ] OAuth 2.0 3LO completa consentimento, refresh e revogação com segredos cifrados.
- [ ] Preflight informa capacidades reais sem executar escrita.
- [ ] Política `required` bloqueia nova interação sem ticket válido.
- [ ] Reconexão e aba duplicada não duplicam atendimento nem evento Jira.
- [ ] Fechar aba não transiciona chamado.
- [ ] Encerramento explícito apresenta consequências e é idempotente.
- [ ] Link de auditoria exige autenticação e respeita tenant/permissão.
- [ ] Comentário/anexo/transição respeitam capabilities e falham com retry seguro.
- [ ] Logs e artefatos não contêm tokens, client secret ou conteýo SSH integral.
- [ ] Playwright cobre optional/required, falha do Jira, reconexão, duplicação e encerramento.
- [ ] Harness real valida leitura; escrita usa ticket sandbox explicitamente autorizado.
- [ ] Typechecks, testes direcionados, documentação e governança passam.

## Estratégia técnica

Evoluir a integração por adapters de autenticação e capabilities, mantendo
o fluxo atual de API token. Introduzir policy e interaction ID sem acoplar o
gateway SSH a chamadas Jira. Side effects seguem por outbox idempotente e a UI
consome um preflight sanitizado antes de habilitar cada opção administrativa.

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Fechar chamado por queda/aba | somente encerramento explícito do atendimento |
| Evento duplicado em reconexão | interaction ID e chave idempotente |
| Jira indisponível derrubar SSH | validação antes da entrada e outbox depois |
| Escopo maior que o necessário | capabilities e opções independentes |
| Segredo em logs/callback | redaction, state/PKCE e relatório sanitizado |
| Anexo duplicar evidência sensível | link autenticado como padrão e anexo opt-in |

## Matriz de testes e evidências

- unitários: auth adapter, scopes/capabilities, normalização de ticket,
  policy, idempotência e payload sanitizado;
- integração mock: OAuth callback/refresh, 401/403/404/429/5xx, timeout,
  comentário, multipart de anexo e transições por workflow;
- Playwright: configuração, ticket obrigatório, break-glass, conexão,
  reconexão, aba duplicada e encerramento;
- Jira real read-only: `/myself`, accessible resources, projeto e issue;
- Jira sandbox com escrita, se disponibilizado: comentário, anexo e transição
  apenas em ticket de teste dedicado.

## Segurança das credenciais reais

- receber valores somente por `.env` local ignorado ou secret store do CI;
- nunca imprimir URL com code, Authorization, tokens ou client secret;
- relatórios contêm somente status, latência, capability e hash do site;
- Client ID/Secret sem callback + consentimento não são tratados como acesso
  suficiente para Jira Cloud OAuth 2.0 3LO.

## Baseline

- branch-base: `master`;
- SHA-base: `788c65be9f87d0556a8ef3e739fdf56056db88a3`;
- autenticação atual: Basic Auth com e-mail + API token;
- capacidades atuais: health check, leitura de issue e vínculo posterior à auditoria.

## Evidências parciais

- variáveis OAuth locais presentes, com URLs HTTPS, sem exposição de valores;
- `.env` raiz e `apps/backend/.env` confirmados como ignorados pelo Git;
- adapter OAuth read-only implementado para authorize, code exchange, refresh,
  accessible resources e `/myself` via cloud ID;
- 4 testes OAuth aprovados, incluindo ausência de scopes de escrita e erro sanitizado;
- typecheck global ainda bloqueado por cinco erros preexistentes de
  `exactOptionalPropertyTypes` em `auth/scim.service.ts`.

## Rollback ou recuperação

Desabilitar a política e os side effects Jira por feature/config. O fluxo SSH
volta a opcional e a integração read-only atual permanece disponível. Migrations
serão aditivas; nenhum ticket Jira será alterado no rollback.

## Aprovação

- Decisão: `GO_WITH_RISKS`
- Aprovado por: usuário
- Aprovado em: 2026-08-13
