# PRD Session Playback Lite

## Nome recomendado
`Playback de Sessao SSH`

Tambem pode aparecer como subcapacidade de `Auditoria de Sessao SSH`.

## Objetivo
Permitir revisar uma sessao SSH auditada como replay navegavel do terminal, usando os eventos ja capturados pela auditoria, sem implementar gravacao de video no primeiro corte.

O objetivo visual e oferecer uma experiencia de "terminal fake" historico:
uma tela parecida com terminal real, em modo somente leitura, carregando
comandos, saidas e eventos da sessao a partir da auditoria SSH.

## Contexto
O NodeAccess ja possui base de auditoria de sessao com eventos como:
- `session_started`
- `stdin`
- `stdout`
- `resize`
- `session_error`
- `session_ended`

Esses eventos sao persistidos em chunks JSONL e ja servem para preview, download e timeline de comandos. O playback deve reaproveitar essa fonte de verdade em vez de criar uma trilha paralela.

## Problema
A auditoria atual preserva a trilha bruta e facilita revisao tecnica, mas ainda nao entrega uma experiencia visual simples para:
- entender a sequencia temporal da sessao
- revisar o que apareceu no terminal
- pular para comandos ou eventos importantes
- compartilhar evidencia operacional com menos friccao
- investigar incidentes sem depender de leitura manual do JSONL

## Decisao de produto
Priorizar replay textual/event-based do terminal.

Nao priorizar gravacao de video no curto prazo.

Motivos:
- menor custo de armazenamento
- melhor busca e correlacao com comandos
- reaproveita a auditoria existente
- menor risco no gateway SSH
- evita novo pipeline pesado de captura de tela
- combina melhor com resumo por IA, timeline e evidencias de compliance

Isso ainda atende o objetivo de "gravar a sessao SSH": a gravacao e a trilha ordenada de eventos do terminal, reproduzida em modo read-only. A diferenca e que nao gera um arquivo de video; gera replay fiel o suficiente para auditoria operacional, busca e correlacao com comandos.

## Formatos de playback suportados
O produto deve separar claramente tres formatos possiveis de playback, porque
eles atendem necessidades diferentes e possuem custos muito diferentes.

### 1. Terminal fake a partir do stream auditavel
Formato recomendado como base do produto.

Como funciona:
- usa os eventos capturados da sessao SSH (`stdin`, `stdout`, `resize`, erro,
  inicio/fim)
- renderiza esses eventos em um terminal read-only no browser
- preserva ANSI e comportamento visual quando a captura for suficiente
- permite play/pause, velocidade, seek por tempo/comando e timeline

Vantagens:
- armazenamento muito menor que video
- permite busca, timeline, correlacao com comandos e enriquecimento por IA
- funciona bem para SSH textual, inclusive sessoes longas
- nao exige capturar tela do usuario
- melhor para auditoria operacional e compliance tecnico

Limitacoes:
- depende da fidelidade da captura de terminal
- TUIs como `vim`, `top`, `tmux`, `less` podem exigir tratamento melhor de ANSI,
  resize e snapshots textuais
- nao mostra elementos fora do terminal, como mouse, navegador, abas ou acoes na
  UI do NodeAccess

### 2. Exportacao em formato reprodutivel (`asciinema` ou similar)
Formato recomendado para compartilhar evidencia tecnica sem gerar video.

Como funciona:
- converte o stream auditavel para um formato padrao de terminal recording
- primeira opcao sugerida: `asciinema v2`
- pode ser exportado por sessao inteira ou por intervalo

Vantagens:
- leve
- portavel
- boa compatibilidade com replay textual
- mais simples de anexar a tickets ou evidencias

Limitacoes:
- nao cobre a tela completa do usuario
- redaction/mascaramento precisa ocorrer antes da exportacao
- ainda depende da fidelidade dos eventos capturados

### 3. Gravacao visual tipo video/screencast
Formato opcional e posterior, nao recomendado para o MVP.

Existem duas interpretacoes diferentes de "video":

1. `video-renderizado-do-playback`
   - NodeAccess renderiza o terminal fake no backend ou em worker/headless e gera
     MP4/WebM a partir do stream auditavel
   - nao grava a tela real do usuario
   - gera uma evidencia visual compartilhavel
   - continua limitado ao terminal, mas com custo maior que asciinema

2. `screen-recording-do-browser`
   - grava a tela do usuario/navegador durante a sessao
   - poderia capturar UI, mouse, alternancia de abas e pop-ups
   - exige permissao explicita do browser/usuario ou componente nativo/agente
   - tem alto risco de privacidade e custo de armazenamento
   - deve ser opt-in por tenant, com politica clara e aviso visivel

Recomendacao:
- nao gravar a tela real do usuario no primeiro ciclo
- se houver demanda por "video", priorizar `video-renderizado-do-playback`, pois
  preserva a fonte auditavel existente e evita capturar informacoes fora do
  terminal
- usar `screen-recording-do-browser` apenas para cenarios regulados que exigem
  evidencia visual completa e aceitam consentimento, retencao e custo maiores

## Gravacao visual opcional: requisitos de seguranca
Se o produto evoluir para video/screencast, a feature deve nascer como modulo
separado e opt-in.

Regras obrigatorias:
- habilitacao por tenant e, idealmente, por politica/grupo/host
- aviso claro para o usuario antes e durante a gravacao
- registro administrativo quando a politica de gravacao for alterada
- retencao configuravel e exclusao segura
- criptografia em repouso
- controle de acesso mais restrito que o playback textual
- auditoria de quem assistiu, exportou ou baixou o video
- mascara/blur nao deve ser prometida como perfeita no MVP
- exportacao deve exigir permissao explicita e gerar log administrativo

Riscos especificos:
- pode capturar senhas, tokens, dados pessoais, chats, tabs do browser ou outras
  informacoes fora do escopo da sessao SSH
- aumenta muito armazenamento e processamento
- pode reduzir aceitacao dos usuarios se parecer vigilancia ampla
- requer politica juridica/compliance mais clara que o playback textual

Casos onde video pode fazer sentido:
- ambientes regulados que exigem evidencia visual
- operacoes de alto risco em hosts criticos
- sessoes privilegiadas temporarias
- acesso de terceiros/fornecedores
- treinamento e revisao operacional, desde que com consentimento e redaction

## Refinamento: visualizacao como terminal fake
A visualizacao deve parecer um terminal, mas nunca deve se comportar como uma
sessao ativa.

Regras:
- renderizar em xterm.js ou componente equivalente em modo read-only
- bloquear teclado, paste e qualquer envio de input real
- exibir aviso claro de que se trata de replay historico
- manter controles de reproducao fora da area do terminal
- reproduzir `stdout`, `stdin` quando autorizado e eventos de `resize` na ordem
  da auditoria
- permitir modo instantaneo para carregar o estado final sem esperar o timing
  original
- permitir modo temporal com velocidades configuraveis
- preservar ANSI escape sequences quando seguro e suportado
- degradar de forma explicita quando o stream nao tiver fidelidade suficiente

### Modos de visualizacao
1. `Replay do stream`
   - reproduz eventos na ordem em que foram capturados
   - prioriza fidelidade visual do que apareceu no terminal
   - ideal para investigacao operacional

2. `Comandos interpretados`
   - usa a lista derivada de comandos reconstruidos
   - ajuda auditoria e revisao rapida
   - deve exibir nivel de confianca da reconstrucao

3. `Hibrido`
   - terminal fake no centro
   - timeline lateral ou inferior com comandos/eventos
   - clique em comando pula para o ponto aproximado do replay

O modo hibrido e o recomendado para a primeira UX completa.

## Escopo MVP
### Backend
- expor endpoint de playback por `sessionId`
- retornar eventos completos necessarios para reproducao, sem truncamento do preview
- preservar ordenacao por `seq`
- incluir metadados basicos da sessao
- respeitar as mesmas permissoes da auditoria, ou permissao mais restrita
- nao alterar a captura no gateway no primeiro corte, salvo bug claro na trilha atual

### Frontend
- adicionar acao `Playback` no detalhe da auditoria
- renderizar a sessao em terminal read-only usando xterm.js
- reproduzir eventos `stdout`, `stdin` autorizado e `resize`
- mostrar controles basicos:
  - play
  - pause
  - reiniciar
  - velocidade `1x`, `2x`, `4x`
  - carregar instantaneamente
  - pular para inicio/fim
- manter input desabilitado; o playback nunca envia comando real
- exibir indicador de fidelidade do replay quando a sessao tiver comandos
  interativos, ANSI complexo ou eventos insuficientes

### Timeline
- reaproveitar a timeline de comandos quando disponivel
- permitir pular para um comando ou evento relevante
- indicar inicio, fim e erro de sessao
- quando houver sessao compartilhada, exibir contexto de controle como informacao lateral, nao como dependencia do replay
- separar eventos por tipo:
  - comandos reconstruidos
  - input bruto autorizado
  - output
  - resize
  - erro
  - troca de controle em sessao compartilhada
  - inicio/fim

## Comandos interativos e fidelidade
O playback deve reconhecer que nem toda sessao SSH segue o padrao simples
`comando -> saida`. Programas interativos, shells aninhados e interfaces TUI
podem dificultar a reconstrucao.

### Classes de comportamento
- `simple_command`: comando shell comum com prompt e saida linear.
- `long_output`: comando com saida longa ou streaming, como `tail -f`,
  `journalctl -f` ou logs continuos.
- `pager`: uso de `less`, `more`, `man` ou visualizacao paginada.
- `fullscreen_tui`: uso de `vim`, `nano`, `top`, `htop`, `tmux`, `screen` ou
  interface que redesenha a tela.
- `interactive_client`: uso de `mysql`, `psql`, `redis-cli`, `mongo`, `ftp`,
  `sftp` ou clientes com prompt proprio.
- `subshell_or_privilege`: uso de `bash`, `sh`, `zsh`, `sudo su`, `su -` ou
  troca de contexto interativo.
- `remote_hop`: uso de `ssh` para saltar manualmente para outro host dentro da
  sessao.

### Nivel de confianca
Cada comando/evento interpretado deve poder receber uma classificacao:
- `alta`: prompt, enter e saida foram correlacionados de forma clara.
- `media`: comando provavel, mas houve edicao de linha, autocomplete,
  sequencias ANSI ou contexto parcial.
- `baixa`: fluxo interativo ou fullscreen; usar stream bruto como fonte
  principal.

### Diretrizes de UX
- Nao prometer reconstrucao perfeita para comandos interativos.
- Exibir badge como `sessao interativa detectada` quando aplicavel.
- Em `fullscreen_tui`, priorizar replay do stream bruto no terminal fake.
- Em `interactive_client`, indicar que os comandos podem pertencer ao cliente
  interativo, nao ao shell principal.
- Em `remote_hop`, destacar que a auditoria continua sendo da sessao SSH
  original, mas o destino operacional pode ter mudado dentro do terminal.
- Permitir alternar entre `stream` e `comandos interpretados`.

### Caracteres e inputs especiais
Para maior fidelidade, a captura/replay deve tratar:
- `Enter`
- `Backspace`
- `Delete`
- setas
- `Tab` e autocomplete
- `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`
- `Ctrl+R`
- paste multi-linha
- resize
- caracteres ANSI e clear screen
- prompts coloridos

Se a auditoria atual nao preservar parte desses eventos com fidelidade, o PRD
deve registrar a lacuna antes de prometer replay fiel.

## Fora do escopo do MVP
- gravacao de video
- captura de tela do navegador
- screen recording do browser/desktop do usuario
- geracao server-side de MP4/WebM
- OCR
- edicao ou anotacao colaborativa do replay
- busca full-text no output
- snapshots para seek instantaneo
- compressao nova obrigatoria
- storage externo tipo S3/MinIO
- enforcement ou bloqueio de comando

## Regras de seguranca
- playback e evidencia sensivel; nao deve ser publico
- acesso deve respeitar tenant, papel e escopo autorizado
- `stdin` deve ser tratado com cuidado, pois pode conter segredo digitado
- no MVP, preferir mostrar `stdin` apenas como timeline/metadado para perfis autorizados, nao como texto destacado por padrao
- manter download bruto como recurso separado e mais sensivel
- considerar mascaramento futuro de padroes sensiveis no output e input
- registrar auditoria administrativa quando alguem abrir ou exportar playback, se isso for exigido pela politica do tenant
- em qualquer visualizacao que renderize input, aplicar politica de mascara e
  permissao explicita
- registrar evento administrativo de visualizacao do playback quando a tela for
  aberta, especialmente para sessoes sensiveis
- permitir evolucao futura para redaction por politica do tenant

## UX recomendada
Tela de detalhe da auditoria:
- resumo/metadados no topo
- abas ou secoes:
  - `Resumo`
  - `Comandos`
  - `Playback`
  - `Bruto/Download`
- o playback deve deixar claro que e uma reproducao historica, nao uma sessao ativa
- em sessoes longas, avisar quando o carregamento pode demorar
- o terminal fake deve ter aparencia proxima do terminal real, mas com estado
  visual distinto para evitar confusao com sessao ativa
- controles recomendados:
  - play/pause
  - reiniciar
  - velocidade
  - carregar final
  - pular para comando anterior/proximo
  - copiar trecho permitido
  - alternar stream/comandos
- indicadores recomendados:
  - duracao total
  - tempo atual do replay
  - total de eventos
  - fidelidade estimada
  - comandos interativos detectados
  - aviso de redaction/mascaramento quando aplicado

## Pontos de entrada na UI
O acesso principal ao terminal fake deve ficar na auditoria de sessoes, porque
o playback e uma evidencia historica, nao uma acao operacional do host ativo.

Entradas recomendadas:
- lista `/admin/session-audit`: coluna `Acoes` com `Playback` ou
  `Reproduzir sessao`
- detalhe `/admin/session-audit/:id`: aba completa `Playback`, com terminal
  read-only, timeline e controles de reproducao
- timeline/comandos do detalhe: acao `Ver no playback` por comando, abrindo o
  replay no ponto aproximado por `seq` ou timestamp
- telas de usuario, host ou recurso podem ter link secundario para a auditoria
  filtrada, mas nao devem virar a superficie principal do playback

Estados da acao:
- habilitada quando houver stream auditavel disponivel para a sessao
- desabilitada com tooltip quando a sessao nao tiver eventos suficientes,
  estiver expirada/removida por retencao ou ainda estiver processando
- para sessao em andamento, mostrar estado especifico como `Em andamento` ou
  `Playback disponivel apos encerramento`, evitando parecer terminal ao vivo

## Padrao de testes CDP/Chromium
O playback deve seguir o mesmo padrao de validacao usado nos harnesses de
frontend em `tools/frontend`, com script reprodutivel via Chromium/CDP e
relatorio JSON para comparacao futura.

Script sugerido:
- `tools/frontend/session-playback-cdp-flow.cjs`

Cenarios funcionais minimos:
- autenticar como usuario autorizado e acessar a lista de auditoria
- abrir o terminal fake pela acao da lista
- abrir o terminal fake pela aba no detalhe da sessao
- abrir `Ver no playback` a partir de um comando e validar salto aproximado na
  timeline
- validar bloqueio de input real no terminal fake
- validar usuario sem permissao por URL direta
- validar estados sem playback disponivel, sessao em andamento, sessao com erro
  e stream removido por retencao

Validacoes de informacao e layout:
- conferir se metadados principais aparecem sem quebra visual: usuario, host,
  tenant, inicio/fim, duracao, status e quantidade de eventos
- conferir se labels, badges e tooltips nao cortam texto em desktop e largura
  menor
- validar que o terminal fake nao distorce fonte, altura de linha, ANSI basico
  ou resize
- validar que timeline, botoes e terminal nao se sobrepoem
- registrar screenshot ou metricas de bounding boxes quando houver overflow,
  texto cortado ou elemento fora da viewport

Validacoes de experiencia:
- na visao do usuario, o replay deve comunicar claramente que e historico e
  read-only
- na visao do recurso/host, o admin deve conseguir chegar do host para as
  sessoes auditadas relacionadas, mas o playback completo continua no detalhe
  da auditoria
- controles principais devem ser acessiveis por teclado e ter foco visivel
- estados de loading, vazio, erro, sem permissao e processando devem ter mensagem
  clara e acao seguinte evidente

Validacoes de performance:
- medir tempo ate abrir a lista de auditoria
- medir tempo ate renderizar o primeiro frame do terminal fake
- medir tempo de salto por comando/timestamp
- medir long task/renderizacao em sessoes grandes simuladas
- registrar quantidade de requests, erros 4xx/5xx inesperados e erros de
  console

Validacoes com sessao SSH real e carga longa:
- executar uma sessao real de teste com `100`, `200` e `300` comandos
  deterministicos e marcados, gerando auditoria pelo fluxo normal do gateway SSH
- encerrar a sessao antes de validar, para garantir consolidacao da auditoria
- abrir a mesma sessao pela aba `Playback` e pela aba `Comandos`
- confirmar que marcadores do inicio, meio e fim aparecem na ordem correta no
  terminal fake
- confirmar que a aba `Comandos` reconstruiu quantidade, ordem, input final e
  output associado de forma coerente
- confirmar que `Ver no playback` em comandos do inicio, meio e fim posiciona o
  terminal fake no ponto aproximado correto
- repetir o teste em desktop e largura estreita para validar que playback,
  filtros, controles e tabs nao quebram visualmente

Validacoes de fidelidade da reconstrucao:
- executar vetores sinteticos deterministas contra o normalizador real do
  backend, sem depender apenas da tela
- validar cargas de `100`, `200` e `300` comandos simples, com comando esperado,
  ordem, timestamp e marcador de output esperado
- validar output combinado em poucos chunks, pois o gateway pode enviar varios
  comandos/outputs no mesmo bloco de `stdout`
- validar correcao de linha com `Backspace`, `Delete`, `Tab`, ANSI, resize e
  prompt redesenhado
- validar editores/pagers: `vi`, `vim`, `nano`, `less`, `more`, `top`, `htop`,
  garantindo que a UI indique baixa fidelidade quando necessario
- validar que comandos de saida de TUI, como `q`, `:q` e `exit`, nao aparecem
  como comando shell indevido quando forem apenas controle do programa
- comparar `stdin` reconstruido, `stdout` limpo e `stdout` bruto disponivel para
  detectar distorcao de entrada ou perda de evidencia

Falhas que devem ser capturadas explicitamente:
- comando digitado parcialmente, corrigido com backspace, aparecendo com texto
  antigo na aba `Comandos`
- `Tab`/autocomplete contaminando o comando final
- comando de pager/editor, como `q` ou `:q`, sendo exibido como comando shell
  quando foi apenas controle interno do programa
- output deslocado para o comando anterior ou seguinte
- output grande truncado sem aviso
- ANSI/controle bruto poluindo a leitura do terminal fake
- resize alterando quebra de linha de forma incoerente entre playback e comando
  reconstruido
- eventos combinados em um mesmo chunk gerando perda de fronteira entre comando
  e output

Script complementar sugerido:
- `tools/session-audit/reconstruction-fidelity.ts`

Esse script deve gerar relatorio JSON proprio e falhar quando houver divergencia
entre comando esperado e comando reconstruido. Ele complementa o CDP: o CDP
valida experiencia/renderizacao; o teste de fidelidade valida o interpretador.

Importante: quando o teste sintetico passa, mas a sessao real falha, a suspeita
principal deve ir para captura/ordem dos eventos do gateway SSH, chunking,
timestamp ou tratamento de controle/ANSI recebido do terminal real. Quando a
sessao real mostra comandos corretos na aba `Comandos`, mas o terminal fake
distorce a visualizacao, a suspeita principal deve ir para o renderizador do
playback.

Saida esperada do harness:
- `ok`
- `startedAt` e `finishedAt`
- ambiente (`frontendBase`, `apiBase`, `cdpBase`)
- sessao usada no teste
- cenarios executados com `passed/failed`
- tempos principais em milissegundos
- erros de console/rede relevantes
- observacoes de UX, como overflow, labels cortados, falta de tooltip ou estado
  ambiguo

## API sugerida
Endpoint conceitual:
- `GET /session-audits/:sessionId/playback`

Resposta conceitual:
- metadados da sessao
- lista ordenada de eventos ou stream paginado
- campos minimos por evento:
  - `seq`
  - `timestamp`
  - `type`
  - `text`
  - `bytes`
  - `cols`
  - `rows`

Para sessoes grandes, avaliar paginacao por janela:
- `fromSeq`
- `limit`
- `untilSeq`

## Modelo tecnico recomendado
### Primeiro corte
- ler chunks existentes via `SessionAuditStorage`
- converter linhas JSONL para contrato de playback
- nao criar novas tabelas
- nao duplicar o stream em outro formato
- frontend calcula deltas de tempo com base em `timestamp`
- renderizar stream em xterm.js read-only
- usar lista de comandos existente apenas como indice/timeline, nao como fonte
  primaria do replay
- levantar gap tecnico da captura atual para:
  - backspace/delete
  - setas/autocomplete
  - paste multi-linha
  - Ctrl+C/Ctrl+D/Ctrl+Z
  - ANSI fullscreen
  - resize
  - delimitacao de prompt/comando

### Evolucoes futuras
- indice por `seq` e tempo para seek rapido
- snapshots periodicos do estado de terminal
- compactacao dos chunks
- storage driver S3/MinIO
- busca no output
- exportacao `asciinema v2`
- exportacao de trecho reproduzivel por intervalo de tempo/comando
- marcadores de risco por IA
- recortes exportaveis por intervalo
- classificador de comandos interativos
- indicador de confianca por comando reconstruido
- snapshots de tela textual para seek fiel em sessoes longas
- redaction configuravel por tenant
- modo comparativo `stream bruto` vs `comandos interpretados`
- exportacao visual renderizada em MP4/WebM a partir do terminal fake
- politica opt-in para gravacao visual de tela somente em tenants que exigirem
  evidencia completa

## Relacao com IA
A IA nao deve ser dependencia do playback.

Ela pode enriquecer a experiencia depois:
- marcar comandos relevantes
- apontar trechos de risco
- gerar resumo de intervalo
- criar evidencia para CAB/ticket
- sugerir pontos de revisao

## Criterios de aceite do MVP
- usuario autorizado abre playback de uma sessao concluida
- usuario autorizado consegue acessar playback pela lista de auditoria, pelo
  detalhe da sessao e por link de comando quando houver timeline disponivel
- terminal read-only reproduz output na ordem correta
- eventos de resize sao aplicados durante a reproducao quando existirem na
  auditoria
- controles basicos funcionam sem reconectar ao host
- sessoes com erro mostram estado final corretamente
- sessao compartilhada continua exibindo contexto de participantes/controle quando ja existir na auditoria
- usuario sem permissao nao acessa playback nem por URL direta
- tela informa claramente que e replay historico, nao sessao ativa
- input real fica bloqueado em todos os estados da tela
- comandos reconstruidos aparecem como timeline, mas o stream auditado permanece
  como fonte primaria da reproducao
- harness CDP/Chromium do playback executa fluxo basico, validacao visual,
  bloqueio de input, permissao e performance inicial com relatorio JSON
- harness CDP/Chromium valida desktop e largura estreita com terminal fake
  encontrado, sem overflow visual real e sem depender de sidebar aberto
- sessao SSH real com carga de `100`, `200` e `300` comandos gera playback
  navegavel e aba `Comandos` coerente com os marcadores executados
- sessoes com `vim`, `top`, `less`, `mysql`, `psql`, `sudo su` ou `ssh`
  aninhado recebem aviso de possivel baixa fidelidade na interpretacao de
  comandos
- quando `stdin` estiver oculto por politica, o replay continua util usando
  output/timeline/metadados

## Riscos
- sessoes grandes podem carregar devagar sem paginacao
- output com ANSI complexo pode nao reproduzir perfeitamente no primeiro corte
- comandos interativos como `vim`, `top`, `less`, `tmux` podem exigir fidelidade maior de terminal
- segredos podem aparecer no output ou input se o host os ecoar
- seek preciso sem snapshots pode ser caro em sessoes longas
- replay pode ser confundido com terminal real se a UI nao diferenciar bem
- comandos reconstruidos podem induzir conclusao errada se nao houver indicador
  de confianca
- shells aninhados e saltos manuais para outro host podem mudar o contexto
  operacional sem o NodeAccess conseguir inferir perfeitamente

## Recomendacao de ordem
1. endpoint de playback com eventos completos
2. tela read-only com reproducao linear
3. timeline com salto por comando
4. paginacao/janelas para sessoes longas
5. exportacao `asciinema v2`
6. busca, snapshots e marcadores por IA
7. exportacao visual opcional gerada a partir do terminal fake
8. screen recording opt-in apenas se houver requisito regulatorio/compliance
