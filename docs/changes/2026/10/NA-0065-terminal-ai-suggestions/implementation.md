# NA-0065 — Registro da implementação

## Pedido e objetivo
Corrigir abertura/foco/aspas e integrar consulta de comandos à área do terminal, com alternativas e navegação por teclado, mantendo assistente contextual separado.

## Implementação
Base SHA: 66444a9dd4c167453004bb6089278548bdd2c0d9.
TerminalCommandSuggestion usa posicionamento do autocomplete, limites da área do terminal e foco após renderização; combobox/listbox, seleção com setas e Enter sem envio automático. TerminalPane/handle expõem âncora e dimensões; TerminalView mantém vinculação à sessão. Interceptor/useTerminal distinguem consulta @ai/@ia e contexto @ia-ass/@ai-ass. Sem alteração no transporte ou resize.
Contrato local-ai adiciona alternatives opcional. LocalAiService solicita até duas alternativas adicionais, normaliza aspas simples de apresentação antes da avaliação, deduplica e verifica policy individualmente. terminal-command-format mantém aspas internas, rejeita conteúdo ambíguo/controles/markdown na inserção; frontend também rejeita respostas inválidas. Compatibilidade com resposta anterior e assistente contextual preservada.
Manual Terminal, locais, testes e harnesses atualizados. Consulta rápida não envia buffer nem texto da pergunta ao SSH. Nova política não executa comandos automaticamente.

## Validação
Rodada atual: test:terminal-ai — 148 aprovados em 15 arquivos; 3 ensaios reais ignorados por padrão (/tmp/ai-reliability-unit-final.log). Inclui HTTP real descartável para abortar chamada ao provedor, deadline, circuit/fallback, revisão de comandos, contexto, erros e contratos dos quatro adapters.
npm test — 2114 aprovados/41 ignorados em 238 arquivos aprovados/11 ignorados (/tmp/ai-reliability-full.log). Suíte geral anterior aos últimos refinamentos de prompt, plataformas e cores; refinamentos revalidados por testes específicos e Playwright.
test:terminal-ai:real — 3 aprovados com qwen2.5-coder:3b local, Linux portas/disco e Windows TCP (/tmp/ai-reliability-real-final.log). Host/permissões/auditoria de teste; nenhum SSH. Primeiro ensaio Windows exigiu revisão; prompt refinado para cmdlet simples e rodada seguinte passou. Geração continua não determinística.
Playwright claro/escuro em 1440/768/390: escolha de contexto, cancelamento, falhas acionáveis, pergunta preservada, atalhos, teclado, policy, timeout, duplicidade, troca de sessão e respostas tardias. Logs /tmp/ai-reliability-web-final.log e /tmp/ai-reliability-web-light-final.log. Capturas /tmp/nodeaccess-terminal-ai-command-light/context-390.png e context-1440.png revisadas; correção de contraste confirmada.
Regressão terminal passou durante implementação; rodada após refinamento de contraste em /tmp/ai-reliability-terminal-final.log.
Typecheck frontend/backend, build frontend e lint focado passaram (/tmp/ai-reliability-frontend-types.log, /tmp/ai-reliability-backend-types-final.log, /tmp/ai-reliability-build.log, /tmp/ai-reliability-lint-final.log). Build conserva aviso de vendor-ui acima de 950 kB.
manual:capture (dev), test:manual (18 Vitest + testes Node), cinco imagens oficiais revisadas. Manifesto atualizado após validação; manual:check-reviewed e git diff --check registrados no fechamento.

## Confiabilidade e tratamento de erros
Resposta estruturada comum, com envelopes nativos de Ollama/OpenAI/Anthropic e JSON mode para OpenAI-compatible. Código e timeout atravessam controller, serviço, router e provider; cancelamento não inicia fallback nem contabiliza falha de circuito. Falhas têm códigos públicos sanitizados e auditoria sem comando/pergunta.
Revisão adicional aplica-se somente a sugestões do terminal, preservando bloqueios/aprovações do tenant e mantendo a política global das demais automações. Comandos compostos, desconhecidos e opções mutáveis exigem revisão. Sistema cadastrado do host remoto guia prompt e validação; Windows Server e ferramentas Linux exclusivas são considerados.
TerminalCommandSuggestion mantém rascunho em memória e oferece retry/cancelamento; TerminalView permite selecionar contexto no @ia-ass, preserva pergunta e cancela ao editar/fechar/trocar sessão. Seleção e saída possuem limite, sem envio duplicado de buffer. Dica local de atalhos; contraste ajustado no tema claro.

## Recuperação
Mudanças locais sem migração. Reverter somente esta frente preservando trabalho anterior no workspace. Contrato de alternativas é opcional e tolera respostas antigas. Sem commit ou publicação.

## Pendências
Ensaios de navegador usam provider/SSH simulados. Modelo Ollama local também validado separadamente pelo serviço com host/permissões de teste; cadeia completa navegador/API autenticada/SSH real não certificada. Prefixo deve ser digitado no início de linha vazia. Aspas ambíguas são recusadas em vez de remoção indiscriminada. Nenhuma dependência nova.

## Diário de interações
### 2026-10-23T12:04:19-03:00 — Avaliação solicitada
Distinguido painel de IA existente de autocomplete. Identificados prefixo @ai, modo inicial explain e confirmação de inserção sem Enter. Ensaio existente concluído sem erros. Próximo passo: implementar e testar fluxo compacto caso solicitado.

### 2026-10-23T14:50:58-03:00 — Correção e consulta rápida implementadas

Pedido: corrigir erro de abertura e simplificar consulta cotidiana, enriquecendo testes. As seções iniciais registram a avaliação anterior; esta entrada substitui suas pendências de implementação.

Implementação: reproduzido Invalid linked format do vue-i18n com @ai literal em pt-BR/en; corrigido com interpolação. TerminalCommandSuggestion.vue oferece pergunta/resposta compacta, foco, Enter/Escape, timeout de 20s, AbortSignal e retry. terminal-ai-command.service valida inserção; TerminalView vincula resposta à aba/sessão e exige entrada vazia confiável. Consulta omite buffer; assistente contextual permanece pelo botão/atalho, com proteção contra respostas tardias. Prefixo aceita @ia/@ai, preserva chunks e apaga somente caracteres mostrados. useTerminal utiliza TerminalInputModel em vez de contador duplicado, corrigindo estado após Ctrl+C; TerminalPane/handle expõem condição de inserção. Backend omite aviso sobre saída do terminal quando contexto não foi enviado. Locales, manual, scripts e harnesses atualizados. Base SHA permanece 66444a9dd4c167453004bb6089278548bdd2c0d9.

Ran: reprodução anterior com duas falhas i18n (/tmp/terminal-ai-opening-before.log); correção coberta nos dois idiomas.
Ran: test:terminal-ai — 39 testes/5 arquivos aprovados (/tmp/terminal-ai-flow-unit-final.log).
Ran: entrada/autocomplete — 17 testes/2 arquivos (/tmp/terminal-ai-input-regression.log).
Ran: npm test — 2012 aprovados, 38 ignorados; 230 arquivos aprovados/11 ignorados (/tmp/terminal-ai-flow-full.log). Rodada anterior aos últimos refinamentos de entrada/aviso backend, revalidados depois pelos testes focados.
Ran: test:terminal-ai:web claro/escuro em 1440/768/390. Prefixos, portas, ausência de buffer/pergunta no SSH, inserção sem Enter, Enter explícito para executar, cancelamento, erro/retry, policy, controles/multiline, envio duplicado, resposta tardia, edição, linha alterada, troca de sessão, timeout e desconexão aprovados. Ctrl+C validado na rodada escura final. Logs /tmp/terminal-ai-command-light.log e /tmp/terminal-ai-command-final.log; capturas /tmp/nodeaccess-terminal-ai-command-dark e /tmp/nodeaccess-terminal-ai-command-light.
Ran: test:terminal-experience:web repetido após ajuste da entrada (/tmp/terminal-ai-flow-regression-final.log).
Ran: typechecks frontend/backend, build frontend e lint focado sem erros; build mantém aviso de chunk vendor-ui grande. Logs /tmp/terminal-ai-flow-types.log, /tmp/terminal-ai-backend-types.log, /tmp/terminal-ai-flow-build.log e /tmp/terminal-ai-flow-lint-final.log.
Ran: manual:capture (dev), test:manual (18 Vitest e testes Node), manual:check-reviewed e git diff --check. Cinco capturas oficiais e imagens da consulta inspecionadas; hash editorial Terminal atualizado após revisão.

Limitações: provider e transporte SSH simulados. Harness real-ai-ssh adaptado, não executado. Qualidade de modelo real não certificada; prefixo completo colado não abre consulta. Sem alteração de resize/transporte, migração, commit ou publicação. Recuperação por reversão localizada preservando alterações anteriores. Próximo passo: revisão do usuário; nenhuma falha pendente nos testes executados.

### 2026-10-23T15:01:15-03:00 — Avaliação do fluxo inline e atalhos distintos
Usuário relatou foco ausente no painel e comando inserido com aspas; sugeriu pergunta no terminal, sugestões com setas/Enter e @ia-ass para contexto. Inspecionados TerminalCommandSuggestion, TerminalView, TerminalPane, interceptor e parsing backend. Campo tenta focus em onMounted; causa da perda de foco ainda não reproduzida. Inserção usa assist.content literalmente e backend apenas trim: aspas de apresentação podem chegar à linha; conteúdo exato do incidente não disponível. Autocomplete existente já tem seleção, posicionamento e descrição; API atual retorna uma única sugestão. Recomendado modo local de pergunta ancorado ao cursor, envio por Enter, setas para escolha, Enter para inserir sem executar e Escape para cancelar; @ai/@ia para consulta e @ia-ass para contextual. Múltiplas alternativas exigem contrato e policy por comando. Não remover aspas indiscriminadamente. Apenas avaliação nesta interação, sem alterações de produto ou testes executados. Próximo passo: implementar integração e reproduzir foco/aspas, com testes de entrada sem vazamento SSH e concorrência.

### 2026-10-23T15:22:07-03:00 — Implementação inline autorizada
Entregue pergunta junto ao cursor, foco automático, alternativas, seleção ↑/↓, Enter para inserir e outro Enter para executar, e @ia-ass para contexto. Aspas normalizadas antes da policy e verificadas em testes; conteúdo ambíguo recusado. Testes de falha/concorrência ampliados. Capturas revelaram necessidade de conter popup no terminal e quebrar linha dos botões no mobile; ajustes revalidados no Playwright. Sem comandos em servidores reais. Próximo passo: concluir checks de build/manual e revisão do usuário.

### 2026-10-23T15:23:06-03:00 — Fechamento das validações
60 testes específicos e Playwright final aprovados; build frontend/shared, typecheck backend e verificações do manual concluídos sem erro. Suíte geral anterior: 2032 aprovados. Cinco imagens oficiais e capturas desktop/mobile revistas; quebra de linha dos botões confirmada no tema claro. Manifesto atualizado somente após revisão. Limites: fixtures de IA/SSH, sem modelo real ou publicação. Próximo passo: revisão do usuário no ambiente local.

### 2026-10-23T15:32:20-03:00 — Recusa de consulta de portas no ambiente local
Usuário confirmou ambiente local. Consulta somente leitura ao registro de auditoria mostrou kind command, risk safe e canInsert false: recusa de formato, não bloqueio de policy. Conteúdo original não armazenado (somente hash), portanto seu formato exato não foi recuperado. Repetição direta com modelo local qwen2.5-coder:3b e host demonstrativo revelou resposta JSON seguida de alternativa fora do objeto.

Correções: Ollama recebe format json somente nas solicitações estruturadas do terminal; prompt exige alternativas no mesmo objeto. Markdown contendo exatamente uma linha é normalizado antes da policy; scripts não são achatados. Interface distingue bloqueio, aprovação, formato e falta de autorização e mostra conteúdo recusado. Auditoria registra insertionReason sem guardar comando. Políticas de risco preservadas. Arquivos: local-ai.provider, providers/ollama.provider, LocalAiService, terminal-command-format, TerminalCommandSuggestion, terminal-ai-command, locales, testes e manual Terminal.

Ran: test:terminal-ai — 75 aprovados; teste real opt-in ignorado na rotina padrão (/tmp/ai-rejection-unit-final.log).
Ran: TEST_OLLAMA_PORTS=1 vitest local-ai.service.test -t real local provider — um teste aprovado com o modelo local, pergunta exata, normalização e classificador padrão reais (/tmp/ai-ports-real-integration.log). Host, permissões, orçamento e auditoria isolados em fixtures; nenhum SSH executado.
Ran: test:terminal-ai:web — pergunta exata, motivos específicos, conteúdo recusado, navegação/falhas/concorrência em três larguras (/tmp/ai-rejection-web.log).
Ran: test:terminal-experience:web, typecheck frontend/backend, test:manual e manual:capture dev passaram. Lint não apontou problemas nos arquivos de interface/normalização, mas encontrou dois erros preexistentes de tipagem do reader no streaming de ollama.provider.ts, reproduzidos também no arquivo de HEAD (/tmp/ai-rejection-provider-lint-baseline.log); esse trecho não foi alterado. Cinco PNGs inspecionados. Logs /tmp/ai-rejection-terminal.log, /tmp/ai-rejection-types.log, /tmp/ai-rejection-backend-types.log, /tmp/ai-rejection-lint-final.log, /tmp/ai-rejection-manual-unit.log e /tmp/ai-rejection-manual.log.
Limites: geração é não determinística; não foi recuperado o texto da resposta original, nem executado comando em host real. Suíte geral/build não repetidos nesta correção localizada. Sem commit/publicação. manual:check-reviewed e git diff --check passaram. Próximo passo: usuário repetir a consulta local; erros futuros exibem causa e conteúdo.

### 2026-10-23T15:40:11-03:00 — Avaliação de melhorias de IA e IA-ass
Solicitada avaliação, sem autorização nova de implementação. Priorizadas: contrato estruturado consistente nos providers; erros acionáveis diferenciando provider/formato/policy/licença; revisão conservadora de classificação de shell (classificador atual tem fallback safe); contexto explícito e limitado no assistente; coerência entre comando e plataforma do host; cancelamento/timeout até provider e proteção contra respostas obsoletas; recuperação de pergunta/estado; descoberta de atalhos sem poluição; observabilidade sem comandos/segredos; cenários de regressão com modelo real opt-in. Recomendações baseadas nas evidências das interações anteriores; nenhum teste novo ou mudança de produto nesta avaliação. Próximo passo sugerido: consolidar confiabilidade/erros/validação antes de adicionar recursos.

### 2026-10-23T15:59:02-03:00 — Melhorias de confiabilidade autorizadas
Implementadas as frentes priorizadas de contratos, erros, cancelamento, revisão conservadora, plataforma remota, contexto explícito, rascunho/atalhos e observabilidade. Arquivos principais: local-ai.controller/service/provider/router, local-ai-tools, adapters, terminal-assist-contract, terminal-command-review, terminal-ai-request/errors; TerminalView/Pane/CommandSuggestion, terminal-ai-context/errors e useTerminal. Sem migração/dependências, sem alteração de resize/transporte SSH.
Testes: 148 específicos, 2114 gerais, 3 consultas reais ao modelo local; HTTP descartável provou cancelamento; Playwright e regressão terminal, typechecks/build/lint e manual. Resultados detalhados acima. Bibliotecas/provedores externos validados por fixtures, não por chamadas pagas. Não foi executado comando SSH, nem publicado ou commitado. Próximo passo: revisão do usuário no ambiente local.
Fontes de contrato consultadas: OpenAI https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses e Claude https://platform.claude.com/docs/en/build-with-claude/structured-outputs. JSON/schema ajudam a manter formato; validação local continua obrigatória.

### 2026-10-23T16:42:58-03:00 — Melhorar diversidade de sugestões da consulta rápida
Usuário confirmou que a única sugestão ocorre no @ia. Identificada contradição no prompt: exigia exatamente um comando, apesar de solicitar alternativas depois. buildTerminalAssistPrompt agora distingue consulta com alternativas de modo unitário: principal recomendada mais até duas alternativas distintas, quando apropriado, com explicação de diferença/uso. Instrui evitar duplicatas e manter uma única opção em pedidos exatos ou sem alternativas válidas. Configurações do tenant, @ia-ass, contrato e política não foram alterados.

Ran: test:terminal-ai — 148 aprovados/3 opt-in ignorados (/tmp/ai-options-unit.log). Testes verificam instruções multiopção e preservação do modo unitário.
Ran: test:terminal-ai:real — 3 consultas aprovadas com Ollama local, Linux portas/disco e Windows TCP. Caso portas exige ao menos duas opções distintas aprovadas pela política, além de explicações; não conta opções recusadas. Rodada final usa AbortSignal de 20s por consulta (/tmp/ai-options-real-deadline.log).
Ran: typecheck backend e git diff --check passaram (/tmp/ai-options-types.log). Sem comandos SSH, commit ou publicação. Manual esclarece recomendação/alternativas e casos de opção única; revalidação registrada ao concluir. Base SHA permanece 66444a9dd4c167453004bb6089278548bdd2c0d9.
Limite: geração não determinística; não se fabricam opções para completar quantidade. Próximo passo: usuário repetir a consulta @ia no ambiente local.

### 2026-10-23T16:44:34-03:00 — Revalidação da diversidade no @ia
manual:capture dev passou: navegação/recuperação, compartilhamento em 60 estados e troca de tenant em dois ciclos. Cinco capturas demonstrativas revisadas. test:manual passou (18 Vitest e verificações Node); manual:check-reviewed e git diff --check passaram. Logs /tmp/ai-options-manual.log e /tmp/ai-options-manual-unit.log. Registro editorial em docs/OPERATIONS-manual-pilot.md; hash existente continua atual. Sem alteração de layout/área útil do terminal, sem novo ensaio SSH ou publicação. Próximo passo: revisão local do usuário com pergunta aberta no @ia.
