# Operations - Teste de Performance de Paginas

## Objetivo

Padronizar como medir carregamento de paginas do NodeAccess usando navegador real, tempos de API, payloads, renderizacao e comportamento percebido.

Use este procedimento antes/depois de mudancas que possam afetar:

- telas com listas grandes;
- dashboards;
- mapas em tempo real;
- telas administrativas;
- filtros, sidebar, cards ou tabelas;
- polling, cache ou chamadas paralelas;
- alteracoes em queries, indices ou payloads.

## Principio

Medir com navegador real sempre que o problema envolver UX percebida.

`EXPLAIN`, logs de API e tempo de banco ajudam, mas nao substituem:

- tempo ate primeira renderizacao util;
- quantidade de requests;
- peso dos payloads;
- renderizacao da lista/tabela;
- skeleton/loading ainda visivel;
- chamadas duplicadas no boot da pagina.

## Quando Rodar

Rodar este teste em pelo menos estes casos:

- antes de otimizar uma tela;
- depois de otimizar uma tela;
- antes de adicionar hierarquia, agrupamento ou filtros em listas;
- quando houver relato de loading perceptivel;
- quando a massa de dados puder chegar a 3k, 5k ou mais registros;
- antes de aceitar mudanca que adiciona polling ou novos endpoints no `onMounted`.

## Metricas Minimas

Para cada pagina testada, registrar:

- URL testada;
- volume de dados;
- modo de exibicao relevante, exemplo: lista/cards;
- tempo de navegacao do browser;
- tempo de `DOMContentLoaded`;
- tempo de `load`;
- endpoints chamados;
- duracao por endpoint;
- status HTTP por endpoint;
- payload por endpoint;
- quantidade de linhas/cards renderizados;
- skeleton/loading ainda visivel apos janela de espera;
- chamadas duplicadas ou inesperadas;
- erros de console/rede.

## Padrao de Cenario

### Baseline

Medir com a massa atual do ambiente.

Exemplo:

- 800 hosts;
- 180 grupos;
- poucos links/tags;
- usuario admin;
- pagina `/hosts`;
- modo lista.

### Escala Simulada

Criar massa temporaria e identificavel.

Regra obrigatoria:

- usar prefixo claro, exemplo `PERF_TEST_`;
- registrar volume antes/depois;
- limpar ao final;
- validar que nao sobrou massa temporaria.

Exemplo de validacao:

```sql
SELECT COUNT(*) AS remaining_perf_hosts
FROM hosts
WHERE name LIKE 'PERF_TEST_%';
```

O resultado esperado apos limpeza e `0`.

## Procedimento com Chromium Headless

Usar Chromium real com DevTools Protocol quando Playwright/Puppeteer nao estiverem instalados.

Fluxo:

1. Confirmar que API e frontend estao rodando.
2. Abrir Chromium headless com `--remote-debugging-port`.
3. Injetar token local de dev no `localStorage`.
4. Navegar para a pagina alvo.
5. Coletar recursos via Performance API e Network CDP.
6. Esperar uma janela fixa apos carregamento, normalmente 2,5s a 5s.
7. Registrar recursos de API, linhas/cards renderizados e skeletons.
8. Repetir com massa maior.
9. Limpar massa temporaria.

Flags recomendadas:

```bash
chromium \
  --headless=new \
  --remote-debugging-port=9226 \
  --user-data-dir=/tmp/nodeaccess-page-perf \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-sandbox \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1440,1000 \
  about:blank
```

Observacao:

- `--no-sandbox` pode ser necessario quando o teste roda como root no ambiente de automacao.
- usar perfil temporario por execucao evita cache/localStorage contaminado.

## Coleta no Browser

Dentro da pagina, coletar:

```js
const nav = performance.getEntriesByType('navigation')[0]
const resources = performance.getEntriesByType('resource')
  .filter((r) => r.name.includes('/api/v1/'))
  .map((r) => ({
    name: r.name,
    startTime: Math.round(r.startTime),
    duration: Math.round(r.duration),
    transferSize: r.transferSize || 0,
    encodedBodySize: r.encodedBodySize || 0,
  }))

const rows = document.querySelectorAll('[data-host-id]').length
```

Para telas sem `data-host-id`, definir um seletor estavel antes de medir.

## Template de Resultado

Usar este formato no fechamento da analise:

```md
Pagina: /hosts
Modo: lista
Ambiente: dev local
Janela pos-load: 3s

| Volume | Endpoint principal | Payload | Itens renderizados | Observacao |
|---:|---:|---:|---:|---|
| 815 | /hosts?page=1&limit=40 em 109ms | 23KB | 40 | baseline |
| 3.015 | /hosts?page=1&limit=40 em 58ms | 23KB | 40 | massa temporaria |
| 5.015 | /hosts?page=1&limit=40 em 48ms | 23KB | 40 | massa temporaria |

Achados:
- listagem principal escala bem por paginacao;
- payload nao cresce com total de registros;
- loading percebido vem de chamadas paralelas/inicializacao;
- investigar chamadas duplicadas de X.

Limpeza:
- PERF_TEST_* restantes: 0.
```

## Cenario Especifico: Hosts

Para medir a tela `/hosts`, existe um harness CDP salvo em:

```bash
tools/frontend/hosts-cdp-perf.cjs
```

Ele mede:

- navegacao inicial de `/hosts`;
- clique de `Todos os hosts` para `Recentes`;
- retorno de `Recentes` para `Todos os hosts`;
- repeticao quente dos mesmos cliques;
- chamadas de API observadas pelo CDP;
- duracao e tamanho dos recursos de API;
- snapshots de DOM antes/depois de cada clique;
- quantidade de cards, linhas, botoes, itens da sidebar e nos da arvore;
- long tasks, layout shifts e mutacoes DOM por clique;
- erros globais do browser.

Execucao recomendada:

```bash
chromium-browser \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --remote-debugging-port=9339 \
  --user-data-dir=/tmp/nodeaccess-hosts-perf \
  --window-size=1440,1000 \
  about:blank
```

Em outro terminal:

```bash
FRONTEND_BASE=http://127.0.0.1:5173 \
CDP_BASE=http://127.0.0.1:9339 \
RECENT_IDS=236,235,829,424,629,830,726,173 \
POST_CLICK_WAIT_MS=1200 \
PERF_MODES=normal,list-minimal,no-presence \
node tools/frontend/hosts-cdp-perf.cjs
```

O script assume admin local por padrao:

- `ADMIN_USER_ID=1`
- `ADMIN_EMAIL=admin@nodeaccess.local`
- `TENANT_ID=1`

Para outro ambiente, sobrescrever essas variaveis. O JWT e assinado com `JWT_SECRET` lido de `apps/backend/.env` ou de `BACKEND_ENV_PATH`.

Modos de diagnostico disponiveis em dev:

- `normal`: tela real.
- `list-minimal`: renderizacao minima da lista, com nome, endpoint e conectar. Ajuda a medir o piso de custo estrutural por item.
- `no-presence`: desliga `access-map` e indicadores de presenca. Ajuda a isolar concorrencia de polling/presenca com troca de filtro.

O relatorio inclui `summary[]` para comparar rapidamente `nodeCount`, `longTaskTotalMs` e `frameSettleMs` entre modos.

## Cenario Especifico: Sidebar de Hosts / ACL

Para validar friccao diaria no sidebar de `/hosts`, incluindo arvore corporativa ACL, menus de contexto, busca e drag/drop, existe um harness CDP em:

```bash
tools/frontend/sidebar-cdp-ux.cjs
```

Ele mede e simula, sem mutacao por padrao:

- carga inicial do sidebar;
- navegacao por `Todos os hosts`, `Recentes` e secao corporativa;
- busca no sidebar, quando `SIDEBAR_SEARCH` for informado;
- menu de contexto de pasta corporativa;
- menu de contexto da raiz `Pastas Corporativas`, validando que nao vaza o menu de pasta comum;
- fechamento do menu de contexto ao clicar fora;
- abertura dos fluxos de renomear pasta, criar pasta, criar host e gerenciar permissoes;
- menu de contexto de host dentro da arvore;
- prontidao de drag/drop no host da arvore;
- auditoria objetiva de UX: textos cortados, alvos pequenos, overlays fora da viewport, alinhamento dos headers, densidade e foco por teclado;
- snapshots responsivos em viewports configuraveis;
- screenshots opcionais para comparacao visual;
- chamadas de API, erros de browser, long tasks, layout shifts, mutacoes DOM e crescimento de nos.

Execucao recomendada:

```bash
chromium-browser \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --remote-debugging-port=9343 \
  --user-data-dir=/tmp/nodeaccess-sidebar-ux \
  --window-size=1440,1000 \
  about:blank
```

Em outro terminal:

```bash
FRONTEND_BASE=http://127.0.0.1:5173 \
CDP_BASE=http://127.0.0.1:9343 \
SIDEBAR_SEARCH=prod \
REPORT_PATH=/tmp/nodeaccess-sidebar-ux.json \
node tools/frontend/sidebar-cdp-ux.cjs
```

A auditoria de UX vem ligada por padrao. Para salvar evidencias visuais:

```bash
SIDEBAR_UX_AUDIT=1 \
SIDEBAR_UX_VIEWPORTS=1440x1000,1024x900,390x844 \
SIDEBAR_SCREENSHOT_DIR=/tmp/nodeaccess-sidebar-shots \
FRONTEND_BASE=http://127.0.0.1:5173 \
CDP_BASE=http://127.0.0.1:9343 \
REPORT_PATH=/tmp/nodeaccess-sidebar-ux-visual.json \
node tools/frontend/sidebar-cdp-ux.cjs
```

No relatorio, avaliar principalmente:

- `uxFindings`: lista priorizada de problemas objetivos de UX/aparencia;
- `uxSnapshots[].overflowedText`: labels cortadas ou quebrando em locais indevidos;
- `uxSnapshots[].smallTargets`: botoes, itens de arvore ou menus pequenos demais;
- `uxSnapshots[].overlays[].offscreen`: menus/modais fora da area visivel;
- `uxSnapshots[].panelHeaderAlignment`: alinhamento de seta, titulo e acoes dos paineis do sidebar;
- `scenarios[]` com `corporate-header-context-menu-state` e `corporate-header-context-menu-clickoutside`: validade do menu raiz e fechamento ao clicar fora;
- `keyboardChecks`: se o foco por teclado chega em areas uteis do sidebar;
- `uxSnapshots[].screenshot`: caminho das imagens quando `SIDEBAR_SCREENSHOT_DIR` for usado.

Para cenarios seguros mais amplos, incluindo abrir/cancelar acoes destrutivas, ESC em menus, ACL de host e validacoes de estado:

```bash
SIDEBAR_SCENARIO_SET=extended \
FRONTEND_BASE=http://127.0.0.1:5173 \
CDP_BASE=http://127.0.0.1:9343 \
REPORT_PATH=/tmp/nodeaccess-sidebar-ux-extended.json \
node tools/frontend/sidebar-cdp-ux.cjs
```

Os testes que alteram dados ficam desligados. Para executar drag/drop real entre pastas ACL:

```bash
SIDEBAR_MUTATE=1 \
SIDEBAR_DRAG_FROM_HOST_ID=123 \
SIDEBAR_DRAG_TO_FOLDER_TEXT=Destino \
node tools/frontend/sidebar-cdp-ux.cjs
```

Use um tenant de teste para `SIDEBAR_MUTATE=1`, pois o host sera realmente movido e herdara a ACL da pasta destino.

## Cenario Especifico: Playback de Auditoria SSH

Para validar a tela de terminal fake e a fidelidade da reconstrucao de comandos,
existem dois testes complementares:

```bash
tools/frontend/session-playback-cdp-flow.cjs
tools/session-audit/reconstruction-fidelity.ts
```

O harness CDP valida experiencia no browser:

- entrada pela lista e pelo detalhe de auditoria;
- deep link `?tab=playback`;
- terminal fake read-only;
- controles de replay;
- opcao de horarios;
- overflow visual real, texto cortado, console errors e chamadas de API;
- desktop e viewport estreito.

Execucao recomendada:

```bash
chromium-browser \
  --headless=new \
  --disable-gpu \
  --no-sandbox \
  --remote-debugging-port=9347 \
  --user-data-dir=/tmp/nodeaccess-playback-cdp \
  --window-size=1440,1000 \
  about:blank
```

Em outro terminal:

```bash
FRONTEND_BASE=http://127.0.0.1:5173 \
CDP_BASE=http://127.0.0.1:9347 \
REPORT_PATH=/tmp/nodeaccess-session-playback-cdp.json \
node tools/frontend/session-playback-cdp-flow.cjs
```

Quando o Vite em `5173` estiver com bundle antigo/HMR preso, subir frontend
paralelo e testar nele:

```bash
VITE_WS_URL=ws://localhost:3001 npm run dev -w apps/frontend -- --host 127.0.0.1 --port 5174
```

Depois:

```bash
FRONTEND_BASE=http://127.0.0.1:5174 \
CDP_BASE=http://127.0.0.1:9347 \
REPORT_PATH=/tmp/nodeaccess-session-playback-cdp-5174.json \
node tools/frontend/session-playback-cdp-flow.cjs
```

Se o script falhar com `EPERM 127.0.0.1:<porta>`, rerodar com permissao elevada
no runner. Isso e restricao de sandbox do ambiente de automacao, nao falha do
NodeAccess.

Ocorrencias ja enfrentadas neste fluxo:

- se a tela estreita reportar `terminal fake nao encontrado`, primeiro confirmar
  se o shell principal recolheu o sidebar; em viewport de `390px`, sidebar aberto
  deixa area util estreita demais e pode esconder/espremir o playback;
- se o ajuste parece correto no codigo mas o CDP continua mostrando o mesmo DOM,
  reiniciar o Vite em porta paralela, preferencialmente `5174`, e usar um
  `--user-data-dir` novo no Chromium;
- a barra de abas do Naive UI pode ter conteudo interno mais largo que o wrapper.
  Isso nao e overflow visual quando algum ancestral com `overflow-x: hidden`,
  `auto`, `scroll` ou `clip` recorta dentro da viewport;
- status `403` de integracoes opcionais, como ticket/Jira sem permissao ou sem
  configuracao completa, nao deve falhar o playback se a auditoria principal,
  preview e comandos retornarem `200`;
- quando o harness roda contra app ja montado e altera viewport via CDP, validar
  tambem o caminho com perfil limpo. Alguns problemas aparecem apenas no primeiro
  render ou apenas apos transicao desktop -> narrow.

O teste de fidelidade valida o interpretador diretamente:

```bash
REPORT_PATH=/tmp/nodeaccess-session-audit-reconstruction-fidelity.json \
npx tsx tools/session-audit/reconstruction-fidelity.ts
```

Ele gera cargas sinteticas de `100`, `200` e `300` comandos, alem de casos de
saida combinada, ANSI, resize, backspace, `Tab`, `vim dnf.log`, pager e comandos
interativos. Use esse teste antes/depois de alterar gateway SSH, auditoria,
normalizador ou playback.

O relatorio tambem cruza o resultado esperado com a saida do normalizador:

- quantidade de comandos esperada vs. reconstruida;
- comandos exatos reconstruidos;
- marcadores obrigatorios de saida;
- marcadores proibidos de saida, como vazamento de tela cheia, `DEBUG` de arquivo
  aberto no `vim` e secrets mascarados;
- score de fidelidade por cenario;
- cenarios realistas com autocomplete, `Ctrl-C`, stdout em chunks, `sudo` com
  secret, saida que parece prompt e sessao similar a `/admin/session-audit/4177`.

Comandos interativos sao tratados como excecao explicita: o teste exige que a
acao apareca e que a saida seja resumida, mas nao exige replay textual completo
de `vim`, `htop`, `top`, `tmux` e similares. Para esses casos, a trilha bruta
continua sendo a evidencia pericial.

Proximo cenario recomendado: auditoria SSH real com carga longa

Objetivo:

- abrir uma sessao SSH real pelo NodeAccess;
- executar `100`, `200` e `300` comandos de entrada em uma mesma sessao ou em
  tres sessoes separadas;
- encerrar a sessao para consolidar a auditoria;
- validar a mesma sessao na aba `Playback` e na aba `Comandos`;
- comparar stream visual, comandos reconstruidos e outputs esperados.

Padrao de carga sugerido:

- usar comandos deterministas e numerados, por exemplo
  `printf 'NA_AUDIT_%03d start\n'`, `pwd`, `whoami`, `date +%s`,
  `printf 'NA_AUDIT_%03d end\n'`;
- incluir comandos com output multi-linha, como `printf 'linha1\nlinha2\n'`;
- incluir edicao de linha quando possivel: digitar comando errado, corrigir com
  backspace e executar a versao final;
- incluir pelo menos um caso com output grande, como `seq 1 300`;
- incluir um caso de pager/editor controlado, como abrir `less` ou `vim`, sair e
  confirmar que a aba `Comandos` nao transforma tecla de controle em comando
  shell indevido;
- evitar comandos destrutivos; quando precisar criar artefato, usar caminho
  temporario claramente identificado, exemplo `/tmp/nodeaccess-audit-playback-*`.

Validacoes esperadas no playback:

- `Carregar final` nao reduz o texto renderizado;
- play/pause/reiniciar nao duplica output;
- o terminal fake permanece read-only e nao envia input para host;
- marcadores `NA_AUDIT_001`, `NA_AUDIT_100`, `NA_AUDIT_200` e `NA_AUDIT_300`
  aparecem na ordem correta;
- linhas longas quebram ou rolam sem sair da viewport;
- ANSI basico, prompt redesenhado, resize e caracteres de controle nao poluem a
  leitura com sequencias cruas indevidas;
- quando houver baixa fidelidade por TUI/editor/pager, a UI deve sinalizar isso
  em vez de sugerir reconstrucao perfeita.

Validacoes esperadas na aba `Comandos`:

- quantidade de comandos reconstruidos bate com a carga executada, descontando
  comandos que foram apenas teclas de controle dentro de TUI;
- ordem, comando final e timestamp aproximado batem com o playback;
- `output` associado ao comando nao vem deslocado para o comando anterior ou
  seguinte;
- filtros de busca localizam os marcadores numerados;
- acao `Ver no playback` abre a aba de playback no ponto aproximado do comando;
- comandos com baixa confianca aparecem com indicador coerente e nao bloqueiam a
  leitura do restante da sessao.

Leitura do relatorio:

- `scenarios[].expectedCommands` deve bater com `actualCommands`;
- `findings[]` indica comando distorcido, output ausente ou quantidade divergente;
- `durationMs` ajuda a acompanhar custo do interpretador em cargas maiores;
- o CDP valida renderizacao, mas nao substitui o teste de fidelidade do parser;
- divergencia na aba `Comandos` deve ser tratada primeiro no normalizador/parser;
- divergencia visual no `Playback` com comandos corretos deve ser tratada no
  renderizador do terminal fake ou na interpretacao de ANSI/controle.

### Interpretacao de Hosts

Se `/api/v1/hosts?page=1&limit=...` fica baixo e constante, mas a alternancia entre `Recentes` e `Todos os hosts` demora, priorizar investigacao de renderizacao e estado no frontend.

Sinais de backend/API:

- `/hosts` acima de 200ms de forma consistente em dev local;
- payload da pagina acima de 100KB;
- endpoint duplicado no mesmo clique sem mudanca de filtro;
- `inventory`, `sidebar-bootstrap` ou `access-map` no caminho do clique sem necessidade.

Sinais de frontend/renderizacao:

- clique quente demora sem request de API relevante;
- `frameSettleMs` alto em `recent-to-all-warm`;
- `longTaskTotalMs` ou `longTaskCount` alto em `measures[].deltas`;
- `mutationCount` alto sem mudanca visual equivalente;
- `nodeCount` crescendo apos alternancias repetidas;
- muitos cards/linhas sendo remontados ao voltar para `Todos`;
- badges/sidebar recalculando com base na lista completa;
- polling de presenca concorrendo com troca de filtro.

### Opcoes de Otimizacao e Riscos

1. Profiling de renderizacao

Melhor primeira etapa quando a API ja esta rapida. Usar Performance panel do Chrome ou CDP tracing para identificar componentes, watchers e recalculos caros.

Riscos:

- baixo risco funcional, pois e observacional;
- pode gerar falsos positivos se o ambiente dev estiver com HMR, extensoes ou CPU instavel;
- exige comparar antes/depois no mesmo perfil e mesma massa.

2. Reducao de peso dos cards

Aplicar quando o profiling mostrar custo por card: muitos tooltips, tags, icones, computeds chamados repetidamente ou componentes pesados por item.

Possiveis cortes seguros:

- cachear metadados por host;
- limitar tags/links visiveis;
- adiar tooltips pesados para hover;
- evitar recriar arrays/objetos no template;
- trocar renderizacao condicional cara por computed local.

Riscos:

- regressao visual em cards/lista;
- tooltip ou acao ficar menos informativa;
- quebrar consistencia entre modo card e lista;
- otimizacao prematura se o gargalo real for outro watcher global.

3. Virtualizacao

Usar somente se a tela renderizar muitos itens simultaneamente. Se a lista ja pagina 24/40 itens, virtualizacao tende a ter baixo retorno para o painel principal.

Pode fazer sentido em:

- sidebar/arvore corporativa com muitos nos visiveis;
- tabela sem paginacao real;
- listas auxiliares com centenas de itens abertos ao mesmo tempo.

Riscos:

- maior complexidade de foco e teclado;
- problemas com altura dinamica de cards;
- scroll, selecao, menu de contexto e drag/drop ficam mais frageis;
- testes visuais precisam cobrir desktop/mobile e estados vazios/carregando.

4. Reduzir ou diferir chamadas auxiliares

Aplicar quando o CDP mostrar que `inventory`, `access-map`, `agents/status`, `forwardings` ou preferencias competem com a primeira renderizacao.

Riscos:

- indicadores de presenca ou status podem aparecer alguns ms depois;
- usuario pode ver contador/status temporariamente incompleto;
- precisa preservar feedback de loading discreto para nao parecer erro.

## Interpretacao

### Bom sinal

- endpoint paginado mantem payload constante;
- numero de DOM nodes renderizados fica limitado;
- `DOMContentLoaded` e `load` nao crescem com volume total;
- endpoints principais ficam abaixo de 200ms em dev local;
- nao ha chamadas duplicadas no boot.

### Sinal de alerta

- payload cresce junto com total de registros;
- tela renderiza todos os itens em vez de pagina atual;
- skeleton permanece apos endpoints concluirem;
- chamadas de polling disparam antes da primeira renderizacao util;
- mesmo endpoint aparece duplicado no primeiro segundo;
- sidebar depende de listagem completa para montar contadores;
- `POST` de telemetria/produtividade falha e aparece no caminho critico.

## Regras para Massa Temporaria

Massa de teste deve ser:

- identificavel por prefixo;
- criada em lote;
- sem credenciais reais;
- preferencialmente `GLOBAL` ou em grupo dedicado de teste;
- removida no final;
- validada com contagem de sobra.

Nao usar:

- nomes reais de clientes;
- IPs reais sensiveis;
- senhas, PEM ou segredos;
- massa que altere auditoria ou sessoes reais.

## SLA Inicial Sugerido para Telas de Lista

Em ambiente dev local, como referencia inicial:

- endpoint principal paginado: ate 200ms;
- payload da pagina: ate 100KB;
- primeira renderizacao util: ate 1,5s;
- tela estabilizada: ate 3s;
- zero chamadas duplicadas desnecessarias no boot;
- zero massa temporaria restante apos o teste.

Esses numeros nao sao contrato de producao. Servem como baseline para comparar antes/depois no mesmo ambiente.

## Backlog Padrao quando Houver Regressao

Classificar o achado em uma das frentes:

- Query/indice;
- Payload;
- Renderizacao;
- Polling;
- Cache;
- Estado/loading;
- Chamada duplicada;
- Telemetria no caminho critico.

Cada item deve ter:

- evidencia do teste;
- impacto percebido;
- arquivo/endpoint suspeito;
- proposta de menor correcao;
- validacao esperada.
