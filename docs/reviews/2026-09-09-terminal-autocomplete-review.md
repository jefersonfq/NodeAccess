# Revisao do autocomplete do terminal

Atualização: os achados abaixo descrevem o estado anterior. As correções e a validação posterior estão em [Autocomplete: correções e validação](2026-09-09-terminal-autocomplete-fixes.md).

Escopo: sugestoes locais/contextuais, caminhos remotos, historico por usuario/tenant/host e entidades reconhecidas na sessao. Trabalho de revisao e enriquecimento de testes; os arquivos de producao nao foram alterados.

## Resultado e prioridades

Foram reproduzidos oito defeitos nos testes de servicos e dois comportamentos indesejados no navegador, alem de uma lacuna de feedback. A insercao por autocomplete nao executou comandos automaticamente nos cenarios testados.

| ID | Prioridade | Cenario e impacto | Correcao proposta |
|---|---|---|---|
| AC-01 | Alta | `cat /tmp/team\ docs/re` sugere `/tmp/team docs/report.txt` sem escapar o diretorio pai: o shell passa a interpretar outro conjunto de argumentos. | Escapar o operando inteiro, preservando cada segmento e o contexto de aspas. |
| AC-05 | Alta | Um arquivo remoto chamado `report\n.txt` aparece como `report.txt`: a sugestao altera a identidade do arquivo. | Excluir nomes que nao podem ser representados com seguranca ou codifica-los sem mudar o nome; nunca apenas remover controles. |
| AC-06 | Alta | Aceitar no meio da linha usa Ctrl+U, que remove o prefixo ate o cursor mas deixa o sufixo antigo; a simulacao de Readline reproduz um comando diferente do escolhido. | Substituir a linha completa de forma compativel com o modo de edicao, ou limitar a aceitacao a posicoes confiaveis. Certificar a correcao em PTY real. |
| AC-10 | Alta | Com `sy` e popup aberto, Ctrl+SetaDireita enviou `stemctl --failed`: completou o comando em vez de navegar por palavra. | Respeitar modificadores Ctrl/Alt/Meta/Shift; aceitar somente os atalhos explicitamente destinados ao autocomplete. |
| AC-09 | Media | Esc durante uma consulta remota pendente, antes de o popup existir, nao impede a abertura apos a resposta. | Cancelar/incrementar a geracao da consulta mesmo sem popup visivel. |
| AC-03 | Media | Uma listagem iniciada antes de invalidar o cache termina depois e volta a inserir dados antigos. | Associar a resposta a uma geracao do cache/escopo e descartar geracoes invalidadas. |
| AC-02 | Media | `cat ~/docs/re` com cwd `/var/log` consulta `/var/log/~/docs`. | Resolver `~` pela home da sessao, independentemente do cwd. |
| AC-04 | Media | localStorage sem quota lanca excecao durante o registro do comando bem-sucedido. | Tratar falha de escrita/remocao e manter historico em memoria sem afetar processamento de output. |
| AC-07 | Media | `kubectl get pods -A` alimenta a lista com namespace e pod como entidades equivalentes. | Modelar pod e namespace juntos; sugerir o comando com namespace correto. |
| AC-08 | Media | Nome de service recebido em dois chunks (`nodeaccess-age` + `nt.service`) nao e reconstituido. | Acumular linhas incompletas por sessao/comando com limite de memoria, antes de extrair entidades. |
| UX-01 | Media | Consulta negada e diretorio vazio deixam o popup ausente, sem distinguir os motivos. | Feedback discreto e nao bloqueante: carregando, vazio, indisponivel/sem acesso e nova tentativa manual. |

A prioridade Alta considera risco de alterar a intencao do comando. Nao significa que o autocomplete o executa automaticamente: a submissao permanece uma acao posterior do usuario.

Referencia para AC-06: no Readline, `unix-line-discard` (Ctrl+U) remove do cursor ao inicio da linha, conforme o [manual GNU Bash](https://www.gnu.org/s/bash/manual/html_node/Commands-For-Killing.html). A reproducao usa esse modelo de edicao; outros modos de shell exigem validacao propria.

## Melhorias de experiencia adicionais

- Preservar Tab como aceitacao previsivel, Esc como cancelamento inclusive durante carregamento e os atalhos normais de edicao do shell. Explicar claramente a diferenca entre inserir e executar quando Enter aceita uma sugestao.
- Mostrar o caminho completo quando houver truncamento, com descricao acessivel e sem cobrir a linha digitada.
- Revisar a ligacao ARIA entre o textarea que mantem o foco e as opcoes. O teste atual verifica a opcao ativa no listbox, mas nao certifica a experiencia em leitor de tela.
- Centralizar traducoes: ainda existem textos fixos como “Pasta”, “Arquivo”, “Recente”, “Consultando host” e “selecionado”.
- Oferecer gestao clara do historico local (limpar e decidir se deseja memorizar). Manter a separacao entre memoria local e entidades efemeras da sessao.
- Preservar os comportamentos que passaram: listas limitadas, proximidade do cursor, reaproveitamento do canal SFTP, debounce, isolamento de escopo e ausencia de execucao automatica.

## Evidencias e testes

Novos arquivos:
- `apps/frontend/src/services/terminal-autocomplete-resilience-review.test.ts`: 14 cenarios novos, sendo seis verificacoes positivas e oito defeitos reproduzidos como `it.fails`.
- `tools/frontend/terminal-autocomplete-review.cjs`: simulacoes adicionais no navegador; integrado ao harness `tools/frontend/terminal-experience-playwright.cjs` com fixtures de atraso, vazio e permissao negada.

Vitest: 80 casos no conjunto revisado, compostos por 72 verificacoes convencionais e oito falhas esperadas. O resumo “80 passed” do runner inclui `it.fails`: nao representa 80 comportamentos corretos. Ao corrigir cada AC, converter seu teste em `it` normal; uma correcao nao acompanhada dessa conversao faz o teste de falha esperada alertar.

Navegador: a suite existente passou antes do enriquecimento. A revisao ampliada passou nos temas escuro e claro, em desktop e viewport movel, com observacoes registradas para Esc, Ctrl+SetaDireita e falta de feedback. Esses comportamentos sao achados registrados, nao correcoes aprovadas pelo teste. Os testes sao feitos contra o frontend real, com SSH/SFTP e API simulados e sem conexoes de producao.

Resultados dos dois temas:
- 1.000 ciclos locais em aproximadamente 221 ms (escuro) e 230 ms (claro) no ambiente de teste, sem consultas SFTP adicionais. Nao e uma medicao de latencia SSH de producao.
- Popup dentro da area do terminal e fora da linha do cursor, com distancia de 6 px.
- Viewport movel de 390 px: popup de 298 px dentro de container de 314 px.
- Digitacao continuou durante falha remota; resposta de uma busca anterior nao substituiu a consulta atual.
- Reconexao, descarte de output antigo, copy/paste e navegacao existentes continuaram passando.

Artefatos locais:
- `/tmp/nodeaccess-autocomplete-review-dark.json`
- `/tmp/nodeaccess-autocomplete-observations-dark.json`
- `/tmp/nodeaccess-autocomplete-review-light.json`
- `/tmp/nodeaccess-autocomplete-observations-light.json`
- `/tmp/nodeaccess-autocomplete-review-light.png`
- `/tmp/nodeaccess-autocomplete-review-light-mobile.png`
- `/tmp/nodeaccess-terminal-autocomplete.png`
- `/tmp/nodeaccess-terminal-autocomplete-mobile.png`

As primeiras execucoes da extensao do harness precisaram corrigir o isolamento entre cenarios: nao enviar Escape ao popup ja fechado e restaurar o estado esperado pelo teste seguinte. Esses ajustes foram somente nos testes.

## Como repetir

```bash
npx vitest run apps/frontend/src/services/terminal-autocomplete-resilience-review.test.ts
FRONTEND_BASE=http://127.0.0.1:5190 npm run test:terminal-experience:web
FRONTEND_BASE=http://127.0.0.1:5190 UI_THEME=light npm run test:terminal-experience:web
```

A porta e a do frontend local usado nesta revisao; ajuste conforme o ambiente. Nao foi alterada area util, resize, WebSocket nem transporte de producao. Nao foi executada certificacao SSH/PTY real neste trabalho de revisao. Ela sera necessaria para validar uma futura correcao de substituicao/edicao da linha no terminal.

## Pontos de implementacao

- Caminhos/cache: `apps/frontend/src/services/terminal-path-autocomplete.service.ts` (`toCompletions`, `escapeShellPathSegment`, `resolveLookupDirectory`, `loadDirectory`, `clearRemotePathAutocomplete`).
- Insercao: `apps/frontend/src/services/terminal-autocomplete.service.ts` (`terminalCompletionInsertion`).
- Teclado e feedback: `apps/frontend/src/components/TerminalPane.vue` (`onShortcutKey`, `closeInlineAutocomplete`, `onTerminalInputChange` e template do popup).
- Historico: `apps/frontend/src/services/terminal-autocomplete-history.service.ts`.
- Entidades: `apps/frontend/src/services/terminal-session-entity-index.service.ts`.
