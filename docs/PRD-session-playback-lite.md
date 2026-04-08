# PRD Session Playback Lite

## Nome recomendado
`Playback de Sessao SSH`

Tambem pode aparecer como subcapacidade de `Auditoria de Sessao SSH`.

## Objetivo
Permitir revisar uma sessao SSH auditada como replay navegavel do terminal, usando os eventos ja capturados pela auditoria, sem implementar gravacao de video no primeiro corte.

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
- reproduzir eventos `stdout` e `resize`
- mostrar controles basicos:
  - play
  - pause
  - reiniciar
  - velocidade `1x`, `2x`, `4x`
- manter input desabilitado; o playback nunca envia comando real

### Timeline
- reaproveitar a timeline de comandos quando disponivel
- permitir pular para um comando ou evento relevante
- indicar inicio, fim e erro de sessao
- quando houver sessao compartilhada, exibir contexto de controle como informacao lateral, nao como dependencia do replay

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

### Evolucoes futuras
- indice por `seq` e tempo para seek rapido
- snapshots periodicos do estado de terminal
- compactacao dos chunks
- storage driver S3/MinIO
- busca no output
- exportacao `asciinema v2`
- marcadores de risco por IA
- recortes exportaveis por intervalo

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
- eventos de resize sao aplicados durante a reproducao
- controles basicos funcionam sem reconectar ao host
- sessoes com erro mostram estado final corretamente
- sessao compartilhada continua exibindo contexto de participantes/controle quando ja existir na auditoria
- usuario sem permissao nao acessa playback nem por URL direta

## Riscos
- sessoes grandes podem carregar devagar sem paginacao
- output com ANSI complexo pode nao reproduzir perfeitamente no primeiro corte
- comandos interativos como `vim`, `top`, `less`, `tmux` podem exigir fidelidade maior de terminal
- segredos podem aparecer no output ou input se o host os ecoar
- seek preciso sem snapshots pode ser caro em sessoes longas

## Recomendacao de ordem
1. endpoint de playback com eventos completos
2. tela read-only com reproducao linear
3. timeline com salto por comando
4. paginacao/janelas para sessoes longas
5. exportacao `asciinema v2`
6. busca, snapshots e marcadores por IA
