# OPERATIONS Terminal Browser Stability Lite

## Objetivo
Registrar a trilha de validacao da estabilidade percebida pelo usuario no terminal web, separando claramente:

- capacidade do gateway SSH/WebSocket;
- estabilidade do frontend/browser com xterm.js;
- limites do ambiente local de desenvolvimento;
- proximos testes para reduzir incerteza.

## Leitura atual
Os testes atuais nao indicam inviabilidade do projeto.

O que ficou claro ate agora:

- o gateway SSH/WebSocket aguenta carga headless maior que a carga visual do browser;
- uma sessao visual real via Playwright consegue abrir o terminal e enviar comando;
- multiplas abas/contextos visuais no mesmo Chromium headless degradam rapido no ambiente dev atual, mas o build production/preview melhorou a estabilidade;
- CPU, memoria, disco e containers ficaram com folga nas falhas observadas;
- portanto, o risco principal esta no caminho frontend/browser/xterm/dev-server, nao no gateway isolado.

## Evidencias recentes

### Gateway headless
- harness: `tools/load-tests/ws/baseline-gateway.js`
- caminho exercitado: WebSocket SSH, autenticacao, credenciais, comandos e output via gateway
- resultado observado: rampas ate 200 sessoes simultaneas com zero falhas no ambiente testado
- leitura: bom sinal para backend/gateway; nao mede renderizacao do terminal no browser

### Browser via CDP manual
- harness: `tools/frontend/terminal-cdp-load.cjs`
- resultado observado com 5 sessoes:
  - `connectedUi: 0`
  - `failedUi: 5`
  - falhas em `Page.navigate`, `Runtime.evaluate` e `DOM.getDocument`
- leitura: CDP manual e fragil para carga visual; util como diagnostico, nao como principal criterio de viabilidade

### Browser via Playwright
- harness: `tools/frontend/terminal-playwright-load.cjs`
- dependencia: `playwright`
- resultado observado com 1 sessao:
  - terminal abriu
  - xterm renderizou
  - comando foi enviado
  - relatorio: `/tmp/nodeaccess-terminal-playwright-load-1-debug5.json`
- resultado observado apos hooks de observabilidade:
  - eventos `terminal-ready`, `terminal-input-ready` e `terminal-output-received` foram emitidos corretamente
  - relatorio: `/tmp/nodeaccess-terminal-playwright-hooks-1-5174.json`
  - o input automatizado por Playwright (`keys`/`insert`) e por hook local ainda congelou a pagina no ambiente Chromium/headless atual
  - relatorio do modo hook: `/tmp/nodeaccess-terminal-playwright-hooks-hook-1-5174.json`
- resultado observado contra build production/preview em `4173`:
  - 1 sessao com `COMMAND_INPUT_MODE=hook` passou
  - relatorio: `/tmp/nodeaccess-terminal-playwright-preview-hook-1.json`
  - 2 sessoes passaram sem erros de API/console
  - relatorio: `/tmp/nodeaccess-terminal-playwright-preview-hook-2-timeout180.json`
  - 3 sessoes passaram apos renovar tokens locais de load test
  - relatorio: `/tmp/nodeaccess-terminal-playwright-preview-hook-3-renewed-timeout180.json`
  - 5 sessoes com `SESSION_TIMEOUT_MS=120000` falharam parcialmente por timeout de orcamento, nao por CPU/memoria/disco
  - relatorio: `/tmp/nodeaccess-terminal-playwright-preview-hook-5.json`
  - 5 sessoes com `SESSION_TIMEOUT_MS=180000` passaram com 5 terminais prontos e 5 comandos enviados
  - relatorio: `/tmp/nodeaccess-terminal-playwright-preview-hook-5-timeout180.json`
  - apos priorizar a abertura do shell antes de capacidades secundarias (`features` e `host-link/options`), 2 sessoes passaram com `timeToTerminalMs p95 25868ms`
  - relatorio: `/tmp/nodeaccess-terminal-playwright-priority-shell-2.json`
- apos a mesma otimizacao, 5 sessoes passaram com `timeToTerminalMs p95 99137ms`, 5 comandos enviados e sem falhas HTTP reais
  - relatorio: `/tmp/nodeaccess-terminal-playwright-priority-shell-5.json`
- auditoria inicial de endpoints/cache com 2 sessoes passou e gerou `apiSummary`
  - relatorio: `/tmp/nodeaccess-terminal-api-cache-audit-2.json`
  - principais chamadas observadas: `GET /api/v1/users/me/preferences` 4x, `GET /api/v1/features` 3x, `GET /api/v1/host-links/options` 3x, `GET /api/v1/hosts/:id` 2x
  - `features`, `host-link/options`, inventario/sidebar e produtividade tiveram chamadas abortadas por navegacao, sem falha de terminal
  - 10 sessoes passaram com `TERMINAL_READY_TIMEOUT_MS=180000`, `SESSION_TIMEOUT_MS=360000` e screenshots apenas em falha
  - relatorio: `/tmp/nodeaccess-terminal-playwright-preview-hook-10-ready180-fixed-timeout360.json`
  - leituras de 10 sessoes: `timeToTerminalMs p95 159365ms`, `commandLatencyMs p95 72610ms`, CPU media 10%, memoria media 14.2%, disco `/tmp` 7.7%
  - 403 observados em `forwardings`, `agents` e `snippets` vieram de permissoes dos usuarios do perfil local e agora ficam explicitados como `responseErrors`
- resultado observado com 5 sessoes:
  - uma sessao chegou a renderizar terminal, mas travou no envio do primeiro comando
  - as demais ficaram esperando o container do terminal
  - CPU/memoria continuaram baixos
  - relatorio: `/tmp/nodeaccess-terminal-playwright-load-5-v3.json`
- leitura: Playwright confirma que existe uma degradacao no caminho visual com varias abas no ambiente dev atual; em production preview, 10 sessoes passam quando o timeout contempla o custo real de abertura/renderizacao no Chromium local.

## Hipoteses provaveis

1. Ambiente dev/Vite mais caro que build production
   - Vite serve muitos modulos ESM e arquivos via `@fs`.
   - Navegacoes concorrentes geram `net::ERR_ABORTED` esperados durante troca de pagina, mas isso aumenta ruido de medicao.

2. Chromium headless local como gargalo de simulacao
   - Multiplas abas/contextos no mesmo browser headless podem travar antes da plataforma saturar.
   - O teste visual deve medir estabilidade por cliente/browser, nao tentar substituir carga de gateway.

3. xterm/input como area critica
   - O terminal renderiza, mas o envio/observacao de input fica sensivel sob concorrencia visual.
   - Foco, textarea auxiliar, resize, canvas/DOM renderer e toolbar devem ser tratados como fluxo critico.

4. Falta de hooks internos de observabilidade no terminal
   - Hoje o harness precisa inferir estado por DOM/xterm.
   - Isso e mais fragil do que medir eventos de produto como `terminal-ready` e `output-received`.

## Decisao operacional
Manter dois tipos de teste, com objetivos diferentes:

### 1. Gateway/capacidade
Usar scripts headless para escala alta:

- 100, 200, 300, 500 sessoes;
- conexao WebSocket SSH real;
- comandos curtos, comandos com output pesado e sessoes longas;
- metricas de API, gateway, MySQL, Redis, CPU, memoria e disco.

Esse teste responde: "quantas sessoes a plataforma sustenta no backend/gateway?"

### 2. Browser/experiencia do usuario
Usar Playwright para escala menor por maquina:

- 1, 2, 3, 5 e 10 abas/contextos;
- Chromium e Firefox quando possivel;
- dev e production preview;
- screenshots e snapshots em falha;
- foco em tempo ate terminal, input, output, resize e estabilidade visual.

Esse teste responde: "a experiencia do usuario no navegador continua utilizavel?"

## Proximos testes recomendados

1. Rodar Playwright contra build production/preview
   - objetivo: separar custo do Vite dev de custo real do produto.
   - status: validado com 1, 2, 3, 5 e 10 sessoes usando `COMMAND_INPUT_MODE=hook`.
   - recomendacao inicial: usar `SESSION_TIMEOUT_MS=180000` para 5 sessoes locais e `SESSION_TIMEOUT_MS=360000` com `TERMINAL_READY_TIMEOUT_MS=180000` para 10 sessoes locais.
   - comando base:

```bash
FRONTEND_BASE=http://127.0.0.1:4173 \
PROFILE_FILE=tools/load-tests/data/profile.local.json \
CONCURRENCY=5 \
BROWSER=chromium \
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser \
node tools/frontend/terminal-playwright-load.cjs
```

2. Adicionar hooks leves de teste/telemetria no terminal
   - `terminal-ready`
   - `terminal-input-ready`
   - `terminal-command-sent`
   - `terminal-output-received`
   - `terminal-disconnected`

Esses hooks devem ser somente leitura/observabilidade, sem alterar permissao, autenticacao ou fluxo SSH.
Status: hooks de readiness/output/input foram adicionados e validados em dev local e production preview; o payload nao guarda texto do comando nem conteudo sensivel.

3. Comparar Chromium vs Firefox
   - objetivo: identificar se o limite observado e especifico do Chromium/headless.
   - usar `BROWSER=firefox` quando o browser Playwright estiver instalado/disponivel.

4. Rodar matriz curta
   - 1 sessao: deve passar sempre.
   - 2 sessoes: baseline de estabilidade visual.
   - 3 sessoes: ponto intermediario.
   - 5 sessoes: meta inicial de confianca por maquina/browser.
   - 10 sessoes: stress visual local, nao criterio de viabilidade do produto.

5. Isolar congelamento de input automatizado
   - production preview com `COMMAND_INPUT_MODE=hook` passou em 1 e 5 sessoes;
   - comparar `COMMAND_INPUT_MODE=keys`, `insert`, `paste` e `hook`;
   - capturar trace/video do Playwright quando o navegador permitir;
   - validar se o problema ocorre tambem com navegador visivel (`HEADLESS=0`).

## Criterios de sucesso iniciais

- 1 sessao visual abre terminal e envia comando de forma consistente.
- 3 sessoes visuais simultaneas passam sem travar browser.
- 5 sessoes visuais em build production passam ou falham com causa clara e recuperavel.
- 10 sessoes visuais em build production passam como stress local quando o timeout de readiness e ajustado para o custo real do Chromium.
- Gateway headless continua sustentando a meta de sessoes simultaneas definida para a release.
- Falhas visuais geram relatorio com estagio, screenshot, metricas e sem token sensivel.

## Sinais de alerta

- terminal individual falhar de forma intermitente em production;
- input ficar bloqueado depois do terminal renderizar;
- resize gerar loop ou congelamento;
- pagina fechar ou recarregar durante sessao SSH ativa;
- CPU/memoria baixos com browser travado, indicando loop/foco/renderizacao;
- erros reais de API/WebSocket, nao apenas `net::ERR_ABORTED` por navegacao.

## Backlog tecnico sugerido

1. Instrumentar eventos de estado do terminal para harness e telemetria.
2. Rodar Playwright em build production/preview.
3. Separar metricas de tempo:
   - tempo ate shell/banner;
   - tempo ate input pronto;
   - tempo de envio de comando;
   - tempo ate primeiro output apos comando.
4. Revisar foco/input do xterm sob multiplas abas.
5. Revisar custo de modulos carregados na tela de terminal.
6. Validar se toolbar, snippets, SFTP, busca e paineis laterais adicionam watchers/polling no caminho critico.
7. Definir limite recomendado por browser/usuario e deixar carga alta para gateway headless.
8. Avaliar code splitting/lazy loading dos paineis auxiliares do terminal:
   - `SnippetsPanel`;
   - `FileManager`;
   - `TunnelManager`;
   - modais e fluxos pesados que nao precisam existir antes do shell estar pronto.
9. Investigar caches adicionais com criterio de invalidação explicito:
   - frontend: deduplicar chamadas auxiliares por aba e tratar `403` esperado sem poluir console;
   - Hosts: cache curto e warmup pos-login ja cobrem `hosts/sidebar-bootstrap`, `inventory:list` e primeira pagina padrao em cards/lista; proximas melhorias devem ser validadas por `apiSummary`/harness antes de ampliar escopo;
   - backend: revisar caches Redis/in-memory ja existentes para hosts, dashboards e mapa de acesso;
   - SSH/gateway: evitar cache de estado vivo da sessao, mas avaliar cache curto de metadados estaveis como host, politica de auditoria e decisao de permissao no momento da abertura.
10. Usar `apiSummary` do harness para comparar antes/depois de qualquer cache ou lazy loading, priorizando endpoints com alta contagem, payload maior ou status esperado recorrente.

## Melhorias aplicadas

- A tela de terminal deixou de bloquear a abertura do primeiro shell aguardando `features` e `host-link/options`.
- Essas capacidades continuam carregando em background para preservar botoes/licencas como feedback, IA local, JIT e multiconnect.
- Quando ja existe aba aberta e a decisao depende de `multiConnect`, a tela ainda aguarda as capacidades antes de permitir uma nova aba, preservando a expectativa de licenca do usuario.

## Como interpretar esta frente
Essa frente nao deve ser lida como "o projeto escala ou nao escala" isoladamente.

A decisao correta vem da combinacao:

- gateway headless para capacidade de backend;
- Playwright para estabilidade percebida no browser;
- production preview para remover ruido do dev server;
- observabilidade do terminal para trocar inferencia fragil por eventos confiaveis.
