# Pendências de engenharia e segurança do NodeAccess

Registro de 8 de outubro de 2026 da revisão solicitada sobre o código atual do workspace, incluindo alterações locais. Os treze itens abaixo permanecem abertos. A prioridade considera impacto no produto; não corresponde automaticamente à severidade de um CVE.

Esta revisão complementa a [auditoria anterior](2026-10-05-engineering-practices-audit.md) e considera as [correções já implementadas](2026-10-05-engineering-hardening-implementation.md). Não reabre como ausentes os controles de leases, reserva de tarefas, deadlines de integrações ou tratamento global de erros já presentes no código.

A verificação de versões, CVEs e ferramentas está em [Segurança das dependências e da implantação](2026-10-08-stack-security-review.md). O escopo deste registro é análise: nenhuma correção de produto ou implantação foi realizada nesta revisão.

## Correções de prioridade alta

### NA REV 01 Proteção contra SSRF em webhooks

- Evidência: `apps/backend/src/shared/ssrf-guard.ts:27`; `apps/backend/src/modules/webhooks/webhook-dispatcher.service.ts:94`.
- Constatação: o reconhecimento de IPv4 mapeado em IPv6 considera apenas a forma decimal com pontos. A normalização de URL converte essa representação em hexadecimal. A resolução DNS verificada também não é vinculada à resolução usada pelo transporte HTTP.
- Reprodução local: o guard bloqueou `127.0.0.1` e `[::1]`, mas aceitou `[::ffff:7f00:1]` e `[::ffff:a9fe:a9fe]`. Não foi enviada requisição a serviços internos da produção.
- Impacto: um usuário autorizado a configurar webhooks pode contornar a restrição de destino interno, conforme a conectividade do backend. A janela de mudança de DNS também exige correção.
- Correção: classificar endereços após normalização completa, validar todos os resultados e conectar ao endereço validado; preservar o bloqueio de redirecionamentos.
- Aceitação: testes de IPv4, IPv6 e formas mapeadas, nomes com múltiplos endereços e alteração de DNS entre validação e conexão, usando destinos locais descartáveis.

### NA REV 02 Invalidação de cache durante operações assíncronas

- Evidência: `apps/frontend/src/services/service-cache.ts:344`, `:362`, `:386`, `:661`; limpeza de contexto em `apps/frontend/src/stores/auth.ts`.
- Constatação: refresh e update podem terminar depois de um clear e gravar dados antigos. TTL também pode expirar durante uma chamada pendente e iniciar outra consulta para a mesma entrada.
- Reprodução local: iniciar refresh, limpar todos os caches, gravar o novo contexto e resolver a requisição antiga resultou no valor antigo no cache. Com relógio controlado, TTL expirado e chamada pendente, houve duas execuções da factory.
- Impacto: inconsistência visual e possível reapresentação de dados do contexto anterior. Não foi demonstrado bypass de autorização do backend nem vazamento entre tenants em um fluxo completo de navegador.
- Correção: geração de contexto/invalidação conferida antes de escrever resultados; escopo explícito de usuário/tenant; preservar a chamada pendente independentemente do TTL do valor resolvido.
- Aceitação: troca de tenant, logout e login com respostas atrasadas, refresh concorrente, erro e expiração; conferir inventário e permissões exibidas.

### NA REV 03 Segurança reproduzível nos modelos de implantação

- Evidência: `docker-compose.prod.yml:44`, `:62`; `apps/frontend/src/composables/useTerminal.ts:828`; `docker/nginx.https.conf`, `docker/nginx.http.conf` e `docker/nginx.prod.conf`.
- Constatação: o Compose publica 3000/3001 em todas as interfaces. Os modelos Nginx não definem formato de access log que remova argumentos sensíveis; o cliente passa token na URL do WebSocket.
- Impacto: reinstalação ou atualização pelos modelos pode reintroduzir acesso direto e registro de tokens. Não significa que as portas foram novamente expostas na VPS após o endurecimento já executado.
- Correção: perfis com portas internas ou bind em loopback quando o proxy está no host; logs sem query string e revisão de outros registros que possam conter a URL. Avaliar ticket de conexão curto e de uso único em evolução separada.
- Aceitação: implantação limpa com teste externo de portas; abertura de terminal e inspeção dos logs para confirmar ausência de token; preservar a porta 2222 apenas conforme a política do gateway nativo.

### NA REV 04 Orçamento de encerramento incompatível com a implantação

- Evidência: `apps/backend/src/server.ts:758`; `charts/nodeaccess/templates/deployments.yaml:31`; `charts/nodeaccess/values.yaml:31`; `docker-compose.prod.yml`.
- Constatação: workers podem drenar por 35 segundos, enquanto a API recebe 30 segundos no Helm. Gateway configura 110 segundos de drenagem dentro de 120 segundos totais, antes das demais etapas. Compose não explicita tolerância compatível.
- Impacto: interrupção forçada de conexões ou tarefas durante deploy e recuperação posterior por lease, com risco de repetição de efeitos externos.
- Correção: dimensionar a janela total incluindo sessões, workers, fechamento de listeners e dependências; validar a soma no chart.
- Aceitação: SIGTERM com sessões ativas e tarefas lentas, observando encerramento dentro do prazo e recuperação idempotente quando aplicável.

### NA REV 05 Controle de fluxo na saída SSH

- Evidência: `apps/backend/src/modules/ssh/ssh.session.ts:196`; `apps/backend/src/modules/ssh/ssh.gateway.ts:683`.
- Constatação: o caminho principal encaminha chunks diretamente a `ws.send`, sem controle de bytes pendentes ou pausa/retomada da leitura SSH nesse transporte.
- Impacto: cliente lento com saída intensa pode acumular memória no gateway compartilhado. O limite de capacidade não foi medido nesta revisão.
- Correção: limite por conexão, controle de fluxo e encerramento previsível quando não for possível preservar a sessão com recursos limitados.
- Aceitação: cliente lento, desconexão, saída contínua e sessões paralelas em ambiente descartável; executar `npm run test:terminal-experience:web` e `npm run test:terminal-pty:real` ao alterar o transporte.

### NA REV 06 Prazo máximo de comandos Redis

- Evidência: `apps/backend/src/config/redis.ts:4`; `apps/backend/src/modules/user-dashboard/user-dashboard.service.ts:201`.
- Constatação: há limite de tentativas, mas não de duração de cada comando. O dashboard aguarda leituras e escritas do cache.
- Impacto: conexão aberta sem respostas pode reter requisições. Limitar tentativas de reconexão não limita esse cenário.
- Correção: deadline de comandos, limite da fila pendente e comportamento definido por uso: cache opcional pode degradar; autenticação, revogação e controles de segurança devem preservar sua política restritiva.
- Aceitação: Redis lento, conexão silenciosa, indisponibilidade e recuperação sem crescimento ilimitado da fila.

## Correções de prioridade média

### NA REV 07 Concorrência na aplicação de cotas

- Evidência: `apps/backend/src/modules/users/user.service.ts:250`; `apps/backend/src/modules/tenants/tenant.service.ts:139`.
- Constatação: contagem e inclusão ocorrem separadamente. Duas operações concorrentes podem aprovar a mesma última vaga.
- Correção: verificação e consumo de cota serializados por tenant; cobrir criação, ativação e restauração. Uma transação sem isolamento adequado não resolve sozinha.
- Aceitação: várias inclusões simultâneas sobre banco real, com uma única vaga restante, sem ultrapassar o limite.

### NA REV 08 Consultas por tenant no painel administrativo

- Evidência: `apps/backend/src/modules/tenants/tenant.repository.ts:95`.
- Constatação: dez operações de contagem por tenant, disparadas em paralelo sobre a coleção, sem limite local de concorrência.
- Impacto: crescimento do número de consultas e pressão no pool, especialmente com muitos tenants de degustação.
- Correção: agregações por tenant, paginação e concorrência limitada onde necessário.
- Aceitação: comparar quantidade de queries, latência e uso do pool com cardinalidade representativa; usar EXPLAIN antes de definir índices adicionais.

### NA REV 09 Verificação efetiva das migrations

- Evidência: `apps/backend/src/shared/health.ts:99`.
- Constatação: consultar COUNT em `_prisma_migrations` apenas comprova acesso à tabela. O resultado não valida migrations pendentes, falhas ou compatibilidade com a aplicação.
- Correção: verificação de compatibilidade na implantação e estado de prontidão correspondente, evitando consultas caras em toda probe.
- Aceitação: banco atualizado, migration pendente e migration falha produzem estados coerentes.

### NA REV 10 Privilégios do container e CSP

- Evidência: `docker/backend.Dockerfile:28`; `docker-compose.prod.yml`; `docker/nginx.https.conf:79`.
- Constatação: imagem e Compose não restringem o usuário do backend; o chart Helm já possui restrições próprias. A CSP da aplicação permanece em Report Only com permissões amplas para scripts.
- Correção: usuário sem privilégios no perfil Compose, permissões de volumes compatíveis e redução de capacidades; coletar violações e validar CSP efetiva antes de ativá-la.
- Aceitação: bootstrap, auditoria, uploads e gateway funcionando sem root; testes dos componentes de edição, terminal e arquivos sob a nova política.

### NA REV 11 Responsabilidades concentradas nas telas

- Evidência: `apps/frontend/src/views/HostsView.vue` com aproximadamente 8,2 mil linhas e `apps/frontend/src/views/TerminalView.vue` com 5,3 mil linhas na revisão.
- Impacto: formulários, navegação, estado e fluxos distintos compartilham arquivos extensos, aumentando a superfície de regressão. Tamanho isolado não comprova lentidão.
- Correção: extrair um fluxo por mudança, começando por formulários e painéis independentes, preservando composição e padrões existentes.
- Aceitação: estados de carregamento, vazio, erro, permissão e sucesso; teclado, foco, mobile e troca de tenant. Aplicar os testes obrigatórios do terminal quando a área útil ou o transporte mudar.

### NA REV 12 Monitoramento do gateway e do acesso remoto

- Evidência: `charts/nodeaccess/templates/monitoring.yaml:11`.
- Constatação: o ServiceMonitor seleciona a API; as regras disponíveis concentram-se em OIDC e Redis.
- Correção: coletar o gateway e acompanhar sucesso/latência de conexão, sessões interrompidas, memória/buffers e atraso das filas; definir alertas associados a impacto e SLOs.
- Aceitação: falhas controladas geram métricas e alertas com identificação do componente e procedimento de atendimento.

### NA REV 13 Verificações de segurança na entrega

- Evidência: `.github/workflows/quality-gate.yml` e demais workflows examinados.
- Constatação: não foram encontradas etapas dedicadas de SAST, SCA e varredura de imagens no conjunto examinado.
- Correção: automatizar scans com versões fixadas, triagem por aplicabilidade, exceções com prazo e geração de inventário SBOM por artefato. A revisão de dependências vinculada contém resultados e proposta de ferramentas.
- Aceitação: vulnerabilidade conhecida inserida em fixture de validação aciona o bloqueio esperado; falha do scanner não aparece como resultado sem vulnerabilidades; relatório fica associado ao commit e à imagem.

## Validações operacionais pendentes

Carga, stress e execução prolongada; EXPLAIN sobre dados representativos; Web Vitals; acessibilidade com teclado e leitor de tela; restauração integral de backup com RPO e RTO medidos. A existência de ferramentas ou testes anteriores não substitui evidência para a versão e o ambiente que serão liberados.

## Acompanhamento

Todos os itens estão abertos em 8 de outubro de 2026, sem responsável ou prazo comercial definido. Cada correção deve registrar PR/commit, teste executado, resultado e versão implantada. Priorizar NA REV 01 a 06 e os componentes de runtime com alertas aplicáveis antes de ampliar o acesso público ou iniciar o cadastro automático de trials.
