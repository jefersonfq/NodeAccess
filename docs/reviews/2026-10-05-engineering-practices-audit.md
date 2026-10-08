# Revisão das práticas de engenharia — 2026-10-05

Atualização de 8 de outubro de 2026: consultar as [pendências remanescentes da revisão](2026-10-08-engineering-followup.md) e a [verificação de versões e vulnerabilidades](2026-10-08-stack-security-review.md). O estado dos achados originais deve considerar as [correções implementadas](2026-10-05-engineering-hardening-implementation.md).

## Escopo e método

Revisão do código atual do workspace, incluindo alterações locais, comparada com a lista fornecida pelo usuário. Leitura dirigida de bootstrap, configuração, frontend, integrações, filas, cache, health checks, métricas, Prisma, proxy, Helm, CI e ferramentas de recuperação/carga. Sem alterações de produto, dependências, banco ou implantação.

Esta é uma varredura por controles e fluxos representativos, não uma certificação de todos os endpoints nem uma auditoria de segurança completa. Ausência de evidência nas fontes inspecionadas não prova ausência em todos os ambientes. Capacidade, vulnerabilidades de dependências, planos SQL de produção, conformidade WCAG, RPO/RTO e adoção precisam de validação própria. Testes com mocks não comprovam concorrência entre réplicas ou recuperação após crash.

Legenda da matriz: **E** = evidência de implementação no escopo; **P** = cobertura parcial ou problema concreto; **V** = verificar tecnicamente/operacionalmente; **C** = condicional, exige justificativa. E não significa certificação global.

## Achados prioritários

### NA-ENG-01 — P1: flags desativadas podem ser ativadas

- Evidência: `apps/backend/src/config/env.ts:38`, `:68`, `:125`, `:126`, `:149`. Há `z.coerce.boolean()` em flags antigas, enquanto `booleanEnv` no mesmo arquivo já interpreta strings corretamente.
- Reprodução executada com o Zod instalado: `z.coerce.boolean().default(false).parse('false')` e `.parse('0')` retornam `true`; variável ausente retorna `false`.
- Impacto: configuração explícita de desligamento pode habilitar confiança no proxy, JIT/link automático OIDC, funcionalidades e logs de queries. O impacto de segurança depende do caminho habilitado e da exposição da instalação; não foi demonstrado bypass de autenticação.
- Correção mínima: usar o parser existente em todos os booleanos de ambiente e rejeitar valores inválidos; revisar compatibilidade de instalações que dependam do comportamento anterior.
- Aceitação: matriz ausente/true/false/1/0/on/off/inválido e bootstrap real com flags desligadas, incluindo headers de IP falsificados quando o proxy não é confiável.

### NA-ENG-02 — P1: processamento Jira depende da flag de IA

- Evidência: `apps/backend/src/server.ts:531` inicia tanto `sessionAuditAiWorker` quanto `jiraOutboxWorker` dentro de `FEATURE_SESSION_AUDIT_AI_SUMMARY`. O outbox também atende início/fim de atendimento e relatórios de diagnóstico: `apps/backend/src/modules/integrations/jira-outbox.worker.ts:36`.
- Impacto: com a flag efetivamente falsa/ausente, eventos Jira podem ser persistidos sem consumidor, mesmo que o caso de uso não envolva resumo por IA.
- Correção mínima: separar os ciclos de vida dos dois workers; iniciar Jira pela sua capacidade própria, preservando checagem de integração habilitada por tenant.
- Aceitação: gerar um comentário com resumo por IA desligado e observar conclusão do evento; testar instalação sem Jira configurado.

### NA-ENG-03 — P1: webhook pode ficar preso após restart

- Evidência: `apps/backend/src/modules/webhooks/webhook-dispatcher.service.ts:98` grava `PROCESSING`; `webhook.repository.ts:213` busca apenas `PENDING` e `RETRY_SCHEDULED`. Não foi encontrado reclaim de `PROCESSING` nesse módulo/bootstrap.
- Impacto: queda depois da reserva lógica e antes do resultado deixa entrega fora do consumidor normal. Resultado remoto pode ser desconhecido.
- Correção: lease persistido com expiração e recuperação de tarefas vencidas; preservar identificador de entrega para deduplicação pelo receptor.
- Aceitação: matar o consumidor antes do envio, durante a resposta e depois do sucesso remoto, reiniciar e verificar recuperação e semântica de entrega ao menos uma vez.

### NA-ENG-04 — P1: filas não reservam tarefas atomicamente entre réplicas

- Evidência: `jira-interaction.repository.ts:53` seleciona eventos devidos; `jira-outbox.worker.ts:9` protege apenas a instância com `running`. Webhooks também usam seleção seguida de update (`webhook.repository.ts:213`, `webhook-dispatcher.service.ts:98`). Helm configura duas réplicas API em `charts/nodeaccess/values.yaml:21`.
- Impacto: duas APIs podem executar o mesmo comentário/upload/entrega. A chave única do outbox Jira evita duplicação ao enfileirar, mas não torna a chamada externa idempotente. Crash entre sucesso remoto e persistência local também pode repetir o efeito.
- Correção: claim atômico e lease por tarefa, com fencing quando necessário; definir deduplicação externa por operação. Não adicionar Redis lock genérico como substituto da semântica de entrega.
- Aceitação: dois consumidores concorrentes sobre MySQL real; crash na fronteira envio/commit; um efeito esperado ou duplicidade explicitamente detectável quando o provedor não suporta deduplicação.

### NA-ENG-05 — P1: outbox de webhooks pode duplicar entregas já criadas

- Evidência: `webhook-dispatcher.service.ts:46` cria uma entrega por subscription e só depois marca o evento processado. `webhook.repository.ts:184` usa `create`; `apps/backend/prisma/schema.prisma:2488` declara `idempotencyKey`, mas o modelo não tem unicidade dessa chave.
- Impacto: falha depois de criar parte/todas as entregas e antes de marcar o outbox leva a novas entregas, com novos event IDs, na rodada seguinte. Também ocorre com consumidores concorrentes.
- Correção: unicidade adequada ao evento/subscription e inserção idempotente; antes da migration, verificar duplicados existentes e política de conservação do histórico.
- Aceitação: interromper entre duas subscriptions e antes de `markOutboxProcessed`; reprocessar sem duplicar entregas lógicas.

### NA-ENG-06 — P1: integrações Jira sem deadline explícito e retry sem término

- Evidência: `jira.service.ts:103`, `:113`, `:122`, `:129` fazem `fetch` sem `AbortSignal`; worker executa eventos sequencialmente (`jira-outbox.worker.ts:20`); `jira-interaction.repository.ts:61` mantém `RETRY` sem máximo de tentativas/status terminal.
- Impacto: resposta lenta bloqueia os demais eventos naquela instância; erros permanentes continuam sendo tentados. Timeouts internos do runtime não substituem um orçamento da aplicação.
- Correção: deadline cobrindo headers/corpo, classificação de erro permanente/transitório, limite de tentativas, jitter e estado terminal reprocessável. Retry de escrita precisa tratar sucesso remoto com ACK perdido.
- Aceitação: conexão sem resposta, corpo que não termina, 401/403/429/503, integração desativada e sucesso seguido de falha do commit local.

### NA-ENG-07 — P2: shutdown não encerra todos os produtores e trabalhos

- Evidência: `server.ts:775` para alguns workers, mas não chama `webhookDispatcher.stop()`; timers de Directory Sync em `:555`/`:560` não são retidos para cancelamento. `jira-outbox.worker.ts:15` cancela o timer, sem aguardar execução em andamento.
- Impacto: novos trabalhos podem disputar recursos durante encerramento; `process.exit(0)` pode interromper efeito externo antes de persistir resultado. O gateway já tem drenagem: preservar esse controle.
- Correção: parar agendadores, aguardar operações em andamento com prazo máximo e persistir/recuperar tarefas ambíguas antes de desconectar dependências.
- Aceitação: SIGTERM durante comentário, webhook e sync; verificar ausência de novo tick e recuperação no restart, dentro do termination grace period.

### NA-ENG-08 — P2: headers de segurança perdem herança em locations

- Evidência: `docker/nginx.prod.conf:72` declara headers no server; locations de assets/index/API declaram seu próprio `add_header Cache-Control` em `:83`, `:103`, `:184`. Padrão repetido em `nginx.http.conf`, `nginx.https.conf` e no template Kubernetes. Não há CSP nesses quatro arquivos inspecionados.
- Causa: no modelo padrão do Nginx, `add_header` no nível inferior substitui a herança das diretivas superiores. Referência: [documentação oficial](https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header), consultada em 2026-10-05.
- Impacto: determinadas respostas podem não receber os headers esperados; falta defesa CSP na configuração examinada. Um ingress externo pode acrescentar controles, mas isso precisa de evidência.
- Correção: include reutilizável compatível com a versão instalada, em todas as locations relevantes; introduzir CSP primeiro em report-only e validar Swagger, terminal, Monaco, workers e conexões WS. Não assumir disponibilidade de diretivas de versões mais novas.
- Aceitação: HTTP/HTTPS/Helm, SPA/index/assets/API/erros 4xx/5xx/redirects, com verificações de headers e fluxos do navegador.

### NA-ENG-09 — P2: HTTP frontend sem timeout padrão; exceções de componentes sem contenção global

- Evidência: `apps/frontend/src/services/api.ts:10` cria Axios sem timeout. `apps/frontend/src/main.ts:12` não instala error handler; busca dirigida não encontrou `onErrorCaptured`/`errorCaptured`. `router/index.ts:180` trata especificamente falhas de chunks.
- Impacto: requisição que não conclui pode prolongar loading; exceção de componente pode deixar um painel inutilizável sem fallback ou diagnóstico sanitizado. O tratamento atual de 401 e recuperação do backend é útil, mas cobre outro tipo de erro.
- Correção: prazo por classe de operação e cancelamento ao abandonar leitura; fronteiras de erro nos painéis auxiliares e registro global sanitizado. Recuperação deve preservar sessão SSH e formulários; não recarregar a página automaticamente por qualquer exceção.
- Aceitação: API pendurada, leitura cancelada e erro injetado em painel secundário; terminal permanece utilizável e usuário recebe opção de recuperação.

### NA-ENG-10 — P2: páginas concentram responsabilidades demais

- Evidência de tamanho no workspace: `HostsView.vue` 8.183 linhas; `TerminalView.vue` 5.303; `ImportHostsModal.vue` 2.684; `admin/IntegrationsView.vue` 2.706. Hosts contém regras/formulários de forwarding, importação e integração além da navegação do inventário.
- Impacto: maior superfície de regressão, estado e testes acoplados. Tamanho isolado não prova duplicação nem gargalo de renderização.
- Correção: extrair um fluxo por mudança, começando por formulários/modais independentes e lógica já duplicada comprovada; manter coordenação/foco/transportes do terminal no dono atual até testes garantirem equivalência.
- Aceitação: comportamento equivalente em loading/vazio/erro/permissão, teclado/mobile, preservação de rascunhos e troca de tenant. Mudança de área útil do terminal exige `npm run test:terminal-experience:web`; resize/transporte exige também PTY real conforme AGENTS.md.

### NA-ENG-11 — P2: resposta de webhook é carregada inteira para guardar 512 caracteres

- Evidência: `webhook-dispatcher.service.ts:139`: `(await res.text()).slice(0, 512)`.
- Impacto: o limite limita armazenamento, não bytes recebidos/memória. Até dez respostas por rodada, multiplicadas por réplicas, podem consumir recursos desproporcionais. Existe abort por tempo, o que não é limite de tamanho.
- Correção: leitura incremental limitada por bytes, cancelamento do body restante e snippet sanitizado.
- Aceitação: resposta muito grande/stream contínuo dentro do deadline; medir teto de memória e conclusão da rodada.

### NA-ENG-12 — P2: autosave externo acumula backups sem retenção

- Evidência: `apps/backend/src/modules/ssh/session-files.ts:87` cria `.nodeaccess-backups`; `:93` gera um backup novo por save, sem retenção nesse fluxo. Rascunhos locais preservados no agente são comportamento intencional de recuperação.
- Impacto: edição frequente cresce armazenamento remoto, mesmo com limite de tamanho por arquivo; rascunhos também precisam de política de recuperação/limpeza.
- Correção: quota/retensão explícita, somente para artefatos pertencentes ao NodeAccess, sem apagar rascunhos pendentes silenciosamente; mostrar recuperação ao usuário.
- Aceitação: muitos saves, quota/disco cheio, quedas e recuperação; original e último backup válido preservados. Não ampliar atomicidade declarada: hash seguido de rename ainda tem janela contra outro escritor externo.

## Matriz da lista fornecida

Itens repetidos na lista usam a mesma avaliação. Agrupamentos abaixo cobrem cada técnica; estado misto explicita o que está implementado e o que depende de validação.

| Área / técnicas | Estado | Evidência e melhoria aplicável |
|---|---|---|
| Frontend: componentização | P | Componentes reutilizados existem; NA-ENG-10 orienta extração incremental. |
| Frontend/UX: Design System | P | Naive UI, `assets/main.css`, `ActionTooltip.ts`, `SkeletonTable.vue`; consolidar tokens/estados e eliminar divergências demonstradas, sem criar outra biblioteca. |
| Frontend: lazy loading/code splitting | E/V | Rotas com imports dinâmicos em `router/index.ts`; chunks em `vite.config.ts`. Medir bundle inicial, dependências de `vendor-ui` e imports de recursos opcionais. |
| Frontend: virtualização | C/V | Hosts já pagina no servidor; não justificar virtualização apenas pelo tamanho do catálogo. Medir listas realmente extensas, sidebar e histórico antes de escolher. |
| Frontend: debounce/throttle | E/V | Hosts usa debounce; utilitário de arquivos pagina e debouceia busca. Verificar requests obsoletas/cancelamento por fluxo. |
| Frontend: state management | P | Pinia e serviços; `stores/auth.ts` limpa caches na mudança de contexto. Testar respostas em voo durante troca de usuário/tenant; NA-ENG-10. |
| Frontend: Error Boundary/tratamento global | P | Recuperação HTTP/chunks existe; falta contenção de exceções de componente nas fontes examinadas; NA-ENG-09. |
| Frontend: Web Vitals | V | Telemetria de eventos UX não equivale a LCP/INP/CLS. Não encontrados coletores específicos no código pesquisado; medir sob consentimento/política e com baixo custo. |
| Frontend: WCAG | P/V | Há aria-labels/labels e harness de foco; não foi executada auditoria WCAG. Verificar leitor de tela, contraste, zoom, teclado e foco em modais. |
| Backend: Clean Architecture, SOLID, DI | P | Módulos controller/service/repository e `container.ts` com injeção explícita. Revisar dependências por mudança; não introduzir framework DI nem camadas sem necessidade. |
| Backend: stateless services | P | API tem dependências externas; registries de SSH/agentes são deliberadamente locais. Filas compartilhadas precisam claims (NA-ENG-04); não migrar streams SSH para Redis. |
| Backend/API: idempotência | P | Jira enqueue e inbound webhook têm unicidade; outbound delivery não (NA-ENG-04/05). Escritas SFTP/SSH não podem ganhar retry cego. |
| Backend/proxy: rate limiting | P | Auth Redis em `auth-rate-limit.service.ts`, Nginx IP 120r/m e limites MCP/agente. Validar NAT corporativo, rotas dedicadas e limites por usuário/custo; NA-ENG-01. |
| Backend/resiliência: timeout | P | Health/SFTP/webhook têm orçamento; Jira e HTTP frontend precisam cobertura (NA-ENG-06/09). Timeout via Promise.race não cancela query/IO subjacente. |
| Backend/resiliência: retry/backoff | P | Webhooks e Jira implementados; Jira sem término e sem jitter (NA-ENG-06). Respeitar idempotência e não repetir comando SSH. |
| Backend/resiliência: circuit breaker | E/C | `local-ai-provider-router.ts` tem circuito por tenant/provedor. Considerar integrações externas lentas após medir; não instalar circuito genérico em toda chamada. |
| Backend: bulkhead | P | Limites locais para utilitários, sessões e lotes; testar competição entre auditoria, importação e SSH, além de isolamento entre tenants. |
| Backend: graceful shutdown | P | Drenagem real do gateway, sinais e disconnect; completar produtores/workers (NA-ENG-07). |
| Backend: health checks | P | live/ready/deep verificam DB/Redis/storage. `health.ts:101` apenas conta migrations: não verifica pendência/failed/checksum. Probes sequenciais e timeout sem cancelamento merecem teste de saturação. |
| API: versioning | E/V | Prefixo `/api/v1`; definir política de compatibilidade/depreciação e contratos do agente/WS além da URL. |
| API: OpenAPI/Swagger | E/V | Bootstrap Swagger e schemas de Hosts; validar cobertura e alterações incompatíveis na CI. Swagger presente não comprova todos os contratos. |
| API: pagination | E/V | Hosts possui limite máximo e summary/IDs; auditar endpoints de exportação/histórico/catalogos individualmente. |
| API: filtering/sorting server-side | E/V | Contrato/query de Hosts suporta consulta no backend; medir EXPLAIN representativo por filtro, ACL e cardinalidade. |
| API: Request ID/Correlation ID | P | `server.ts:662` inclui `request.id` em amostras/logs; falta propagação uniforme observada frontend → API → evento → integração. Sanitizar IDs recebidos. |
| API: validação de schema, DTOs | E/V | Zod compartilhado, JSON Schema e `HostPublicSchema` em routes; booleanos de env falham (NA-ENG-01). Revisar schemas de resposta contra exposição de campos por endpoint. |
| Banco: índices, EXPLAIN/ANALYZE, N+1 | E/V | Prisma tem índices compostos; harnesses `tools/backend/hosts-dependency-index-check.cjs` e `tools/session-audit/reconstruction-sql-review.mts`. Não medidos planos/custos de produção nem N+1 de todos os módulos. |
| Banco: connection pool | E/V | Prisma singleton em `config/database.ts`; orçamento via URL documentado em `docs/MYSQL-CONFIG-RECOMMENDATION.md`. Dimensionar soma de réplicas/workers; documentação não comprova URL implantada. |
| Banco: slow query log | E/V | `docker/mysql/conf.d/nodeaccess.cnf` habilita log, limiar 2s. Verificar mount, rotação/retenção e volume; usar limiar investigativo sem registrar segredos. |
| Banco: normalização | E/V | Relações/constraints Prisma; revisar invariantes concretas, especialmente unicidade das entregas. |
| Banco: desnormalização, read replica, particionamento | C | Há projeções de auditoria e configuração HA; replica de recuperação não equivale a leitura escalada. Só propor leitura/partição após crescimento e consultas medidas; manter auth/ACL em fonte consistente. |
| Banco: migrations versionadas | E/P | Diretório Prisma e Helm migration job; health deep não certifica estado da migração. |
| Banco: backup + restore testado | E/V | Scripts MySQL/auditoria/avatares e harnesses de restore isolado existentes. Recertificar restore com chave de criptografia, volumes e build atuais, medir RPO/RTO; não confundir arquivo de backup com recuperação comprovada. |
| Cache: cache-aside, TTL, invalidação | E/V | Redis em dashboards/sidebar; frontend `service-cache.ts` TTL, clear e BroadcastChannel; auth limpa contexto. Testar eventos ACL/tenant e respostas em voo. |
| Cache: Redis | E/V | Compartilha controle/cache/rate limit; configuração ioredis lazy/maxRetries. Medir fila offline, prazo de comando e comportamento quando Redis cai. |
| Cache: distributed lock | P/C | Claims necessários onde tarefa é compartilhada (NA-ENG-04). Não recomendar lock para todos os serviços; validar leases/fencing em coordenação existente. |
| Cache: stampede protection | P | Frontend coalesce promises; expiração de promise pendente pode voltar a executar factory. Dashboards Redis fazem get/build/set sem singleflight nas funções lidas. Medir concorrência e limitar rebuild por chave. |
| Proxy: reverse proxy, TLS termination | E/V | Templates Nginx/Ingress existentes; validar configuração efetivamente aplicada e propagação de proto/IP. |
| Proxy: request size limit | P/V | Kubernetes frontend declara 50m; perfis Nginx variam e backend usa limites por rota/default. Harmonizar limites por operação, preservando SFTP streaming e limites de frames WS. |
| Proxy: security headers, CSP | P | NA-ENG-08; ingress externo precisa evidência própria. |
| Proxy: compression, keepalive, load balancing | E/V | Gzip/keepalive Nginx e réplicas Helm; medir NAT, WS longo, drain e distribuição. Não comprimir tráfego SSH indiscriminadamente. |
| Arquitetura: Modular Monolith | E | Módulos de domínio com API/gateway separados; manter desenho atual. |
| Arquitetura: DDD, Hexagonal | P/C | Serviços/repositories por domínio; usar fronteiras e interfaces em pontos de integração que precisem testes, sem reescrever a aplicação. |
| Arquitetura: event-driven, queue/messaging | E/P | App event bus/outboxes e workers; NA-ENG-03/04/05/06/07 mostram cobertura incompleta de entrega/recuperação. |
| Arquitetura: CQRS, microservices | C | Projeções de auditoria já separam consulta específica. Não há justificativa nesta revisão para CQRS global ou novos microservices. |
| Resiliência: backpressure | P/V | Lotes/limites presentes; validar buffers SSH/WS, consumidor lento e payload de webhook (NA-ENG-11). |
| Resiliência: DLQ | P | Webhook tem DEAD com histórico; Jira não tem estado terminal no worker lido. Validar reprocessamento autorizado e preservação do evento. |
| Resiliência: degradação graciosa | P/V | Recuperação frontend e health distinguem cenários; falha de auth/ACL deve fechar acesso, falha de analytics pode degradar. Simular dependências separadamente. |
| Observabilidade: logs estruturados | E/V | Pino redaction/sanitização em `config/logger.ts`; procurar segredo em erros e payloads de integrações com testes, sem registrar conteúdos SSH. |
| Observabilidade: métricas, RED, dashboards | E/P | HTTP normalizado, histogramas e `/metrics`; dashboard operacional. Completar filas/tempo de espera/editor; histórico em memória é por instância e reinicia. |
| Observabilidade: tracing distribuído/OpenTelemetry | V | Não encontradas integrações OTel nas fontes/manifests pesquisados. Começar por request/correlation ID; instrumentar sob amostragem e avaliar overhead, sem spans por tecla do terminal. |
| Observabilidade: USE | P/V | Dashboard operacional mede recursos; estabelecer CPU/memória/event-loop/pool/buffers por componente e saturação real. |
| Observabilidade: alertas baseados em impacto | P | `charts/nodeaccess/templates/monitoring.yaml` cobre OIDC/Redis; falta cobertura equivalente observada de SSH, auditoria, filas e capacidade. |
| SRE: SLI, SLO, error budget | P/V | PRD tem meta de terminal; não verificado conjunto operacional completo de objetivos/janelas/orçamento. Definir login, abertura SSH, latência, persistência de auditoria e entregas. |
| SRE: postmortem sem culpados | V | Não localizado processo/template específico na pesquisa documental; estabelecer fluxo leve com ações rastreáveis. |
| SRE: runbooks | E/V | HA/DR, SSO, rotação de chave e carga documentados; executar exercício e ligar alertas a procedimentos. |
| SRE: Chaos Engineering | C | Simulações de falha já existem; priorizar crashes/ACK perdido/Redis lento em laboratório antes de plataforma de chaos. |
| Segurança: Secrets Management | E/V | AES-GCM, env/Helm secrets, redaction e runbook de rotação. Recertificar guarda/restore de chaves, permissões de artefatos e exposição em erro; não imprimir valores na revisão. |
| Segurança: RBAC, Least Privilege | E/V | Guards, ACL e escopo tenant presentes; testes representativos não provam todos os endpoints. Matriz de usuário/tenant/agente/sessão e revogação durante operação. |
| Segurança: MFA | E/V | TOTP/service/fluxos existentes; validar enforcement em todos os caminhos de login/SSO/native conforme política. |
| Segurança: SAST, SCA, SBOM | V | Não encontrados jobs específicos de CodeQL/Semgrep/audit/dependency-review/Trivy/SBOM nos workflows pesquisados. Lint/typecheck não equivalem a esses controles. Não foi executado scan de CVEs nesta revisão. |
| Segurança: DAST | P/V | Harnesses de segurança/agente e testes de fluxo existem; não equivalem a varredura DAST autenticada ampla. Usar tenant descartável e não emitir tráfego destrutivo em produção. |
| Segurança: Secure by Default | P | NA-ENG-01; revisar defaults do Guacd, exposição de portas/docs e segredos gerados por perfil sem presumir bypass. |
| Segurança: Threat Modeling | V | PRDs/revisões de segurança são evidência parcial; consolidar limites de confiança browser/API/gateway/agente/host/tenant e abuso de cópia/editor. |
| DevOps: CI/CD | E/P | Quality gate faz lint changed/typecheck/test/build; certifications especializadas existem. Não presumir deploy automático nem todos os E2E no gate obrigatório. |
| DevOps: IaC, containers | E/V | Helm/Compose/Docker e scripts reproduzíveis; validar diferenças entre perfis e defaults. |
| DevOps: immutable deployment | P/V | Releases/switch/rollback existem; verificar pinagem de imagens/artefatos, checksums e proibição operacional de edição manual. |
| DevOps: Blue/Green, Canary | C | Sessões SSH longas exigem drain/afinidade e compatibilidade do protocolo; justificar investimento com frequência/risco de releases. |
| DevOps/Produto: Feature Flags | E/P | Flags env e tenant; parser de env inválido (NA-ENG-01). Registrar dono, default, expiração e rollback de cada flag. |
| Testes: unit, integration, E2E | E/V | Vitest, protocolos reais opt-in, Playwright/CDP e harnesses. Mock UI não equivale a auth+DB+gateway reais; completar cenários de filas/crash encontrados. |
| Testes: contract tests | E/V | OIDC/SCIM/Helm na CI; acrescentar verificação OpenAPI e versões agente/WS para mudanças de contrato. |
| Testes/performance: load test, stress test | E/V | `tools/load-tests` k6/API/WS e matriz de capacidade; revisar relatórios atuais antes de afirmar limite de 300 usuários. Rodar carga com auditoria, ACL e dependências realistas. |
| Testes: soak test | V | Certificação contínua por horas/dias não executada aqui. Medir memória, buffers, filas, disco e ciclos de conexão/edição. |
| Testes: mutation testing | C | Priorizar auth/ACL/idempotência quando cobertura funcional estiver madura; não adotar globalmente como primeira ação. |
| UX: Progressive Disclosure | E/V | Modais, menus e ações contextuais existem; revisar fricção nos fluxos, não adicionar controles pela checklist. |
| UX: Optimistic UI | C | Útil em preferências reversíveis; evitar declarar sucesso antecipado de SSH, upload, backup, revogação ou mudança de permissão. |
| UX: Skeleton Loading, Empty States, feedback imediato | E/V | SkeletonTable/mensagens/loading presentes; verificar erro vs vazio e resultado ambíguo por fluxo. NA-ENG-09 melhora encerramento de espera. |
| UX: Undo | C | Aplicar onde houver operação reversível e permissão preservada; backup de arquivo não é undo universal. Não prometer desfazer efeito remoto irreversível. |
| UX: Keyboard navigation | P/V | Harness `test:critical-ux-focus:web`, labels/aria e terminal; revisar todos os novos modais com teclado/leitor de tela/mobile. |
| Engenharia: Code Review, Coding Standards, DoD | E/V | PR template, change governance, `ai/patterns.md`, `docs/engineering/definition-of-done.md`. Verificar aplicação real/branch protection além da presença documental. |
| Engenharia: ADR, RFC | P/V | PRD-lite/tech proposals/change plans registram decisões; usar registro curto com contexto/tradeoff nas mudanças maiores. Não duplicar documentação sem necessidade. |
| Engenharia: Technical Debt tracking, refactoring contínuo | P/V | Este backlog torna dívida explícita; atribuir dono/aceitação e extrair por fluxo, sem refactor geral. |
| Performance: profiling, benchmarking | E/V | Harnesses terminal/carga e amostras HTTP existem; medir antes/depois CPU/event-loop/render/pool, não inferir gargalo por linhas. |
| Performance: async processing | E/P | Outboxes e workers retiram integração do request; fortalecer entrega/recuperação, NA-ENG-02 a 07. |
| Produto: telemetria de uso, feature analytics | E/P | `user-productivity-telemetry.service.ts`, eventos UX e reports; não confundir coleta com adoção medida. Definir funil por recurso, minimização de dados, retenção e isolamento de contexto. |
| Produto: A/B testing | C | Só após métricas confiáveis e volume suficiente; começar com piloto e flags. Não experimentar políticas de segurança por variação casual. |

## Ordem recomendada de execução

1. **Configuração segura:** NA-ENG-01 em mudança isolada, com regressão dos perfis de instalação e flags.
2. **Confiabilidade das integrações:** separar Jira/IA; deadline/estado terminal; claim e recovery de filas; unicidade das entregas; shutdown. Cada mudança com testes de concorrência/crash e migração somente quando necessária.
3. **Robustez percebida pelo usuário:** prazos/cancelamento HTTP, contenção de exceções sem perder SSH, UX de resultado ambíguo e recuperação do editor.
4. **Operação e segurança:** headers/CSP graduais, limites de bodies, retenção/quota, scans no CI, restore recertificado e alertas de impacto.
5. **Manutenção/performance:** uma extração de componente por fluxo; perfis de carga/soak e SQL; Web Vitals/correlação amostrada e objetivos de serviço.

Sem justificativa nesta revisão para migrar o produto a microservices, CQRS global, framework DI, nova fila externa, réplicas de leitura ou particionamento. Primeiro corrigir semântica e medir o desenho atual.

## Validação desta revisão

- Executada reprodução do parser booleano com a dependência Zod instalada; resultado incorreto para strings `false`/`0` confirmado.
- Executada suíte dirigida: **27 testes passaram em 4 arquivos** (cache 4, Jira outbox 3, dispatcher de webhooks 15, health 5). Comando: `npx vitest run apps/backend/src/modules/webhooks/webhook-dispatcher.service.test.ts apps/backend/src/modules/integrations/jira-outbox.worker.test.ts apps/backend/src/shared/health.test.ts apps/frontend/src/services/service-cache.test.ts --reporter=dot`. Esses testes não cobrem os cenários novos de concorrência/crash identificados.
- Demais falhas foram identificadas por inspeção de caminhos e invariantes; não foi executado crash de pods nem concorrência MySQL real nesta rodada. Os cenários de aceitação acima especificam como reproduzir e certificar as correções.
- Evidências históricas de terminal/SFTP/editor estão em `docs/reviews/2026-10-03-terminal-file-utilities-implementation.md`; não foram reexecutadas nesta revisão e não certificam a lista completa.
