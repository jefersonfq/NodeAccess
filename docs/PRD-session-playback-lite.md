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
