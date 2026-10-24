# NA-0060 — Revisão de snippets e composição de macros

## Objetivo e escopo
Avaliar e implementar melhorias de snippets e composição de macros. Após a revisão, o usuário autorizou implementação fim a fim e testes enriquecidos. A tabela abaixo preserva a priorização original; o estado entregue está registrado nesta seção.
A captura “Captura de tela 2026-10-22 193910.png” foi disponibilizada em imgs_debug e inspecionada; comparação e avaliação de regex constam ao final. O esclarecimento mais recente prioriza comandos e ações dentro da mesma macro, preservando Enter automático. Encadear várias macros fica em etapa posterior.

## Estado entregue após autorização
M01–M16 implementados no escopo descrito: validação compartilhada/API, recuperação de erros, responsividade e labels, concorrência por sessão, cópia correta, editor reutilizado, ações heterogêneas com Enter automático, timeout/cancelamento e controle compacto durante execução, inicialização aguardando executor, regex isolada, relatório de progresso declarado pelo cliente, favoritos/recentes locais, importação/exportação, cópia de passos e fila explícita, teclas Enter/Tab/Esc e envio sem Enter.

Limites intencionais: reutilização copia passos, sem referências vivas/ciclos; fila só avança ao término do executor (aguardar uma resposta final quando necessário); não comprova sucesso remoto; sem retomada/pular após falha; não executa em background fora da sessão do navegador. Sem migration ou dependência nova. Evidências e resultados atuais em implementation.md.

## Direção consolidada após o esclarecimento do colega (histórico)

O foco do primeiro corte é organizar comandos e ações dentro da mesma macro, mantendo Enter automático como padrão. Teclas explícitas e envio sem Enter são opções avançadas, posteriores. A fila de várias macros é uma evolução separada, não um pré-requisito.

Não é necessário reestruturar todo o produto. Um editor visual dos tipos existentes pode preservar seu funcionamento, mas adicionar ações independentes de enviar/aguardar/pausar exige evolução localizada do modelo serializado, validação e executor. O campo command já guarda representações serializadas; estudar formato versionado e conversão dos legados, sem assumir antecipadamente que API ou armazenamento não precisarão de ajustes.

## Tabela consolidada das melhorias

Esforço relativo, sem estimativa em dias: baixo = localizado; médio = UI/validação/testes coordenados; médio/alto = executor, compatibilidade ou contratos entre frontend/backend.

| ID | Fase / prioridade | Melhoria | Benefício e escopo | Esforço |
|---|---|---|---|---|
| M01 | 1 / Alta | Validar cada passo e macros vazias | Não descartar linhas inválidas; erros claros no formulário e validação backend | Médio |
| M02 | 1 / Alta | Estado de erro com Tentar novamente | Distinguir API indisponível de biblioteca vazia; carregamento parcial | Baixo/médio |
| M03 | 1 / Alta | Responsividade e densidade | Corrigir overflow, cabeçalho e filtros; compactar indicadores no mobile | Baixo/médio |
| M04 | 1 / Alta | Acessibilidade e descoberta das ações | Labels associados, foco visível, ícones nomeados e ações por toque/teclado | Baixo/médio |
| M05 | 1 / Alta | Evitar disparos concorrentes | Bloquear com explicação ou substituir explicitamente; impedir intercalação e substituição silenciosa | Médio |
| M06 | 1 / Média | Corrigir Copiar | Preservar placeholder do Vault; distinguir comando de passos de macro | Baixo |
| M07 | 1 / Média | Simplificar formulário e padronizar interface | Avançado recolhido, Salvar acessível, preview expansível, tipos consistentes e i18n | Baixo/médio |
| M08 | 2 / Média | Editor visual de passos na mesma macro | Adicionar, editar, duplicar, excluir e reordenar; compartilhar entre página e painel | Médio |
| M09 | 2 / Média | Ações Enviar, Aguardar e Pausar | Misturar ações na ordem necessária; preservar Enter automático e macros antigas | Médio/alto |
| M10 | 2 / Média | Timeout, cancelamento e progresso | Timeout por espera, etapa atual e resultado; parar passos futuros | Médio |
| M11 | 2 / Média | Corrigir status de inicialização e histórico | Não marcar concluído enquanto macro ainda espera; manter resumo da execução | Médio |
| M12 | 3 / Média | Regex opcional com teste de exemplo | Prompts variáveis; literal padrão, preview e processamento isolado com limites | Médio/alto |
| M13 | Posterior / Baixa | Relatório do ciclo da macro | Registrar cancelamento/timeout/conclusão; distinguir envio de sucesso remoto | Médio/alto |
| M14 | Posterior / Baixa | Favoritos/recentes e importação/exportação | Facilitar bibliotecas maiores, preservando escopo e formato | Médio |
| M15 | Posterior / Baixa | Reutilizar passos e encadear macros | Primeiro cópia explícita dos passos; referências vivas exigem versão, permissões e ciclos | Médio/alto |
| M16 | Sob demanda / Baixa | Envio sem Enter e teclas específicas | Recursos avançados sem exigir RETURN em cada comando comum | Médio/alto |

## Primeiro corte recomendado

Entregar M01–M07 antes de ampliar automação. Depois implementar M08–M11: editor de passos com ações independentes e executor controlado. Se o editor vier antes das ações novas, deixar claro que apenas organiza os tipos existentes. Regex (M12) vem quando os limites de processamento e os testes estiverem prontos. M13–M16 não bloqueiam as primeiras entregas.

Exemplo de uma macro organizada:
1. Aguardar o prompt esperado.
2. Enviar comando — Enter automático ativado.
3. Aguardar a solicitação esperada, com timeout.
4. Enviar referência de secret do Vault — Enter automático ativado.
5. Aguardar a resposta final esperada.

Pausa pode ser inserida quando necessária, mas não comprova conclusão de comando. Não criar cartão RETURN após cada envio por padrão. Cancelar interrompe passos futuros, sem desfazer comandos já enviados ou enviar Ctrl+C implicitamente.

A evolução deve preservar leitura/execução dos formatos antigos e validar round-trip sem perda; definir compatibilidade de clientes antigos antes de liberar novo formato. Manter sessão de destino fixa, uma execução ativa e condição de conclusão explícita. Extrair somente a lógica de execução necessária de TerminalView, sem refatoração geral.

As seções seguintes mantêm evidências e detalhamento dos achados. Recomendações exploratórias anteriores de fila/teclas foram subordinadas às fases desta tabela. Revisão e consolidação apenas; nenhuma implementação de produto realizada.

## Cobertura
| Superfície | Recursos existentes | Evidência desta revisão |
|---|---|---|
| /snippets | Busca, filtros por escopo/tipo/grupo/secrets, lista/grupos, duplicar, copiar, editar, excluir | Chromium, fixtures, desktop 1440 e mobile 390; código |
| Formulário | Comando, sequência, esperar/enviar; modelos, catálogo de secrets, escopo e grupo | Capturas de criação; leitura dos caminhos de edição/salvamento |
| Grupos | Criação, edição, remoção; grupos indisponíveis e sem grupo | Harness de agrupamento; CRUD inspecionado por código |
| Painel no terminal | Busca, lista/grupos, criação/edição e envio | Captura com uma sequência de três passos e WebSocket simulado |
| Seletor rápido | Atalho configurável, busca, teclado, envio, retry em falha | Captura via Ctrl+Shift+S e inspeção do código |
| Executor | Sequência, expect-send, timeout, continuar/pular/cancelar, histórico curto | Inspeção estática; não executado em SSH real |
| Inicialização por host | Uma macro, modos desabilitado/sugerir/automático | HostsView e TerminalView inspecionados |
| Relatório administrativo | Período, busca, filtros, métricas e status de envio/bloqueio/falha de secret | Inspeção estática; sem validação visual nesta interação |
| API e permissões | Pessoal ou TEAM do tenant, edição/exclusão pelo criador, licença e visibilidade de grupo | Serviço e schema inspecionados; sem ensaio backend integrado |

## Achados priorizados

### P1 — Validação pode perder passos silenciosamente
Em snippet.service.ts:getExpectSendSteps, linhas sem expect/send válidos são filtradas. SnippetsView.save e SnippetsPanel.saveForm verificam texto não vazio, não a validade de cada linha. O schema valida command como string não vazia, permitindo a representação serializada com steps vazio.
Impacto: usuário pode salvar uma macro diferente da que escreveu.
Recomendação: erro por linha/passo, impedir lista vazia e preservar conteúdo inválido para correção. Validar também o conteúdo estruturado no backend.
Evidência: inspeção estática de snippet.service.ts:147, SnippetsView.vue:380, SnippetsPanel.vue:144 e snippet.schema.ts:54.

### P1 — Sequência não aguarda conclusão e não oferece controle de fila
TerminalView.vue:1710 envia passos com intervalo fixo de 120 ms. Não verifica conclusão do comando nem possui cancelamento equivalente ao expect-send. Outro acionamento pode intercalar envios; outra macro expect-send cancela a anterior sem aviso.
Impacto: inadequado para compor rotinas com prompts/comandos demorados, apesar da ordem de envio.
Recomendação: execução exclusiva por sessão, bloquear novo disparo ou permitir substituição explícita, parada entre passos e indicação do host de destino. Para esperar conclusão, definir condição explícita de output; não inferir sucesso apenas porque o texto foi enviado.
Evidência: inspeção estática, não reprodução contra shell real.

### P1 — Erro de carregamento se apresenta como lista vazia
Reproduzido HTTP 500 em /snippets: há toast genérico de erro, mas o conteúdo da biblioteca mostra “Nenhum snippet ainda”. load() não possui estado de erro/retry. No painel, Promise.all acopla snippets a secrets e grupos: a falha de um recurso impede a atualização dos demais.
Recomendação: erro com “Tentar novamente”, preservar dados já carregados e permitir degradação parcial. O seletor rápido já tem padrão de erro/retry reutilizável.
Evidência: load-error-mobile.png; SnippetsView.vue:207, SnippetsPanel.vue:94, TerminalView.vue:1574.

### P1 — Responsividade e acesso às ações
Em pt-BR/390px, filtros têm 254px de conteúdo para 234px disponíveis. Cabeçalho disputa espaço com ações; quatro indicadores empurram a biblioteca para baixo. No painel, ações ficam opacity-0 até hover, sem group-focus-within, e botões usam símbolos sem nome acessível explícito.
Recomendação: cabeçalho empilhado, indicadores compactos, filtros que quebrem linha, execução sempre descoberta por toque e foco; aria-label nos ícones.
Evidência: report.json, list-mobile.png e SnippetsPanel.vue:418/498.

### P1 — Formulário precisa de validação e rótulos associados
DOM dos quatro inputs/textareas inspecionados: sem aria-label e sem label associado; textos visuais usam p. Salvar sem nome/comando retorna silenciosamente.
Recomendação: NForm/NFormItem, associação de rótulos, erro inline, foco no primeiro campo inválido e aviso ao descartar alterações.
Evidência: consulta DOM no Chromium e SnippetsView.vue:765/380. Placeholder existe, mas não substitui o rótulo persistente.

### P2 — Composição visual de macros
Hoje sequência é textarea (um comando por linha), e expect-send usa “texto => comando”. Não há composição de snippets existentes, reordenação de passos ou parâmetros por etapa.
Recomendação: editor de passos numerados com Adicionar comando, Aguardar texto, Pausa e Inserir snippet; mover por arraste e botões subir/descer; duplicar/remover e preview.
Evidência: SnippetsView.vue:805, SnippetsPanel.vue:280, snippet.service.ts:227.

### P2 — Timeout, status e histórico precisam de precisão
Expect-send tem timeout global de 15 segundos; histórico guarda quatro entradas e é removido no encerramento. Inicialização por host é marcada done assim que sendSnippetToTerminal retorna, mesmo quando expect-send continua esperando. Relatório persiste SENT, BLOCKED e FAILED_SECRET_RESOLUTION, não resultado remoto nem ciclo completo da macro.
Recomendação: timeout por passo; separar “Enviado”, “Aguardando”, “Concluído”, “Cancelado” e “Tempo esgotado”; conservar resumo da execução sem valores sensíveis. Vincular status da inicialização ao executor.
Evidência: TerminalView.vue:1334/1664/1690/1772 e snippet-execution-event.service.ts:4.

### P2 — Copiar precisa distinguir preview de conteúdo reutilizável
copySnippet copia preview mascarado: {{secret:alias}} vira {{secret:alias:***}}. Em expect-send, o texto copiado contém a notação de edição, não um comando de shell.
Recomendação: “Copiar comando” apenas para comando; “Copiar passos” ou exportação para macro; preservar referência original ao secret, jamais seu valor.
Evidência: SnippetsView.vue:411 e snippet.service.ts:120.

### P2 — Simplificar criação e descoberta
Modelos e catálogo de secrets abertos tornam o formulário extenso, especialmente no celular. Painel mostra nome/tipo/passos, mas preview de sequência fica truncado numa linha; seletor rápido não dá a mesma identificação visual do tipo/quantidade.
Recomendação: opções avançadas recolhidas quando não usadas, salvar acessível durante rolagem, preview de passos expansível, identificação consistente de comando/macro, favoritos/recentes para bibliotecas grandes.
Evidência: create-desktop.png, create-mobile.png, terminal-panel.png, terminal-picker.png.

### P3 — Manutenção e consistência
Formulários e regras de salvar se repetem na página e no painel, que não têm os mesmos recursos. Em locale inglês, indicadores e algumas ações continuam em português.
Recomendação: compartilhar editor/validador ao implementar os passos; completar i18n. PRD de macros contém descrição histórica divergente do código atual; revisar documentação junto da implementação.
Evidência: comparação estática página/painel e capturas exploratórias em inglês.

## Proposta para “empilhar”
Exemplo de editor, ainda não implementado:

1. Enviar: cd /opt/app
2. Inserir passos do snippet: Diagnóstico
3. Aguardar texto: diagnóstico concluído (timeout configurável)
4. Enviar: comando seguinte

A pilha salva é a receita; fila de execução é outro recurso. Primeiro corte recomendado: inserir uma cópia dos passos de snippets existentes, com indicação da origem, evitando que uma edição futura altere silenciosamente rotinas já salvas. Referências vivas exigem versionamento, tratamento de remoção/permissões e proteção contra ciclos.
Cada execução deve permanecer vinculada à sessão escolhida. Comandos interativos precisam de condições explícitas. Cancelar interrompe passos futuros; não desfaz comandos já enviados nem deve mandar Ctrl+C implicitamente.
Direção atual: organizar ações dentro de uma macro, com destino fixo, condição de término, timeout e cancelamento. Fila entre macros é posterior. Ao encadear macros existentes, usar cópia/versionamento explícito e revalidar permissões/secrets. A captura agora foi inspecionada: mostra composição de passos dentro de uma macro; a composição interna é a prioridade; fila entre macros é opcional/posterior.

## Etapas sugeridas
1. Corrigir validação, erro/retry, mobile, rótulos e copiar.
2. Introduzir editor visual compartilhado, reordenação acessível e timeout por passo.
3. Evoluir executor com exclusividade por sessão, cancelamento e progresso; fila entre macros fica posterior.
4. Avaliar favoritos, importação/exportação e referências versionadas conforme uso.

## Critérios de aceitação futuros
- Nenhum passo inválido descartado silenciosamente; erros por etapa e macros vazias rejeitadas.
- Biblioteca diferencia vazio, filtro sem resultado, loading, erro e falta de licença.
- Formulário/painel operáveis por teclado e toque; sem overflow em pt-BR a 390px.
- Reordenar preserva dados; inserir macro não altera a original.
- Dois disparos não intercalam rotinas; trocar aba não troca destino; timeout/cancelamento visíveis.
- Placeholder copiado continua válido; valores de secrets não entram em preview/log.
- Testar executor com WebSocket simulado e host descartável conforme escopo da implementação; testar área útil do terminal se UI alterada.

## Evidências e limites
Capturas em /tmp/nodeaccess-snippets-review: list-desktop.png, list-mobile.png, create-desktop.png, create-mobile.png, terminal-panel.png, terminal-picker.png e load-error-mobile.png.
Harness de revisão derivado dos existentes, em /tmp/nodeaccess-snippets-review.cjs e /tmp/nodeaccess-snippets-terminal-review.cjs, com APIs/WebSocket simulados.
Harness de página acusou overflow em pt-BR; execução exploratória continuou para capturas, mantendo ok:false no report.json. Duas primeiras tentativas excederam orçamento de performance (2826/2624ms); execução final 2202ms abaixo do limite de 2500ms. Não generalizar essas medições de três fixtures para produção.
Não foram exercitados CRUD real, permissões em múltiplas contas, SSH real, startup real nem relatório com dados reais. Não há homologação ou implementação aprovada por esta revisão.

## Captura do colega e regex — avaliação de 22/10/2026

Captura localizada e inspecionada em imgs_debug/Captura de tela 2026-10-22 193910.png. Ela mostra uma única macro com instruções ordenadas; não demonstra, por si só, chamada de uma macro por outra. O esclarecimento posterior prioriza organização de ações dentro da mesma macro; encadeamento entre macros fica em etapa posterior.

### Correspondência do exemplo com o NodeAccess
| Elemento visível | Proposta de passo | Lacuna atual |
|---|---|---|
| WAITFOR | Aguardar texto ou regex | Hoje expect exige send no mesmo passo e usa includes sem diferenciar maiúsculas |
| SLEEP=500 / SLEEP=1200 | Pausa de 500/1200 ms | Sequência usa intervalo fixo de 120 ms; não há pausa configurável |
| Texto do comando | Enviar texto, com opção “Enviar Enter” | normalizeTerminalCommand acrescenta newline automaticamente |
| RETURN | Pressionar Enter | Falta representar tecla de forma independente do texto |
| Entrada sensível | Enviar referência de secret do Vault | Nunca copiar o valor da captura para macro, teste, documentação ou log |
| Edição/inserção/remoção de linha | Passos numerados, duplicar/remover, subir/descer e arraste | Hoje edição por textarea |
| Atalho | Abrir seletor rápido; atalhos individuais em etapa posterior | Seletor configurável existe; validar conflitos antes de acrescentar atalhos individuais |

Equivalente conceitual: aguardar prompt da conta → pausa opcional → enviar comando de elevação + Enter → aguardar prompt de senha → enviar {{secret:credencial-operacional}} + Enter → aguardar prompt esperado da nova sessão.
A última espera é uma melhoria sobre a pausa final do exemplo: um atraso não prova que a elevação terminou. Prompt também é sinal operacional, não prova de identidade/privilégio; se a rotina exigir confirmação, incluir verificação explícita do resultado.
Preservar pausas configuráveis por compatibilidade, mas preferir aguardar uma resposta específica quando disponível.

### Recomendação de regex
Sim, como opção avançada de “Aguardar”, mantendo “Texto literal” como padrão. Aproveitar a linguagem visual já usada em TerminalHighlightRuleEditor (literal/regex, exemplo e preview), sem reutilizar diretamente o matcher de destaques para disparar comandos.

Casos úteis: variações no nome do host/usuário, prompts em português/inglês e mensagens com valores variáveis. Regex reconhece a resposta; a fila controla ordem, timeout e cancelamento. Não executar código nem usar automaticamente grupos capturados para montar comandos nesta fase.

Exemplo ilustrativo, sem delimitadores /.../, com ignorar maiúsculas:
~~~text
(?:password|senha)(?:[ \t]+(?:for|para)[ \t]+[A-Za-z0-9._-]+)?[ \t]*:[ \t]*$
~~~
Reconhece Password:, Senha: e password for/ senha para usuário simples. Não cobre todas as traduções, domínios ou formatos de prompt; ajustar com amostra sanitizada do terminal. Usar apenas na etapa esperada após o comando correspondente, não procurar no histórico inteiro.

UX sugerida: Tipo de correspondência, padrão/texto, ignorar maiúsculas, timeout e “Testar com exemplo”. O preview marca o trecho e informa erro de sintaxe ou ausência de correspondência. Diferenciar timeout de espera do limite de processamento do matcher.

### Requisitos do executor para matching confiável
- Manter fluxo normalizado de saída por sessão, tratando ANSI e CR de forma incremental, inclusive códigos divididos entre pacotes.
- Acumular fragmentos até reconhecer o prompt, que pode não terminar em newline.
- Não transformar o padrão regex em lowercase; usar flags configuradas e restritas. Não permitir g/y com estado lastIndex no detector.
- Manter posição consumida e restante do buffer; não apagar todo o chunk após cada match. Descartar correspondências antigas e definir o marco de início de cada espera.
- Ao iniciar manualmente, permitir avaliar somente o prompt atual conforme regra explícita, para não ficar aguardando um prompt que já apareceu. Não varrer scrollback como se fosse saída nova.
- Espera, envio e pausa devem ser ações independentes. Tecla separada fica para necessidade avançada; envio mantém Enter automático padrão. Preservar compatibilidade de macros antigas no carregamento; evitar reinterpretar comandos comuns como instruções de macro.
- Uma execução por sessão; processamento assíncrono deve carregar ID de execução/etapa e descartar respostas após cancelamento, timeout, troca de macro ou desconexão.
- Compilar/validar regex fora da thread principal em Worker terminável, com limites de padrão, buffer, frequência e tempo de processamento. Reutilizar Worker por executor, evitando um por fragmento. Definir orçamento com testes; não assumir que apenas limitar o buffer resolve.
- RegExp pode ter tempo exponencial para certos padrões. Timeout via setTimeout na mesma thread não interrompe uma avaliação síncrona travada. Alternativa futura: engine de complexidade previsível, sujeita a avaliação de compatibilidade e dependência; nenhuma dependência escolhida nesta revisão.
- Não depender do fallback experimental do V8. A documentação descreve limitações desse fallback: https://v8.dev/blog/non-backtracking-regexp .
- Padrão que reconhece vazio deve ser rejeitado; resultado de comprimento zero nunca pode avançar/enviar. Heurísticas de regex perigosa são auxiliares, não garantia.

### Escopo recomendado após o exemplo
1. Corrigir as falhas P1 da revisão.
2. Editor visual único com enviar (Enter automático), esperar literal e pausa; timeout e validação por passo. Regex e teclas avançadas seguem as fases da tabela consolidada.
3. Execução controlada dentro da macro, incluindo condição final e tratamento de falha; encadeamento entre macros fica posterior.
Não iniciar implementação somente com new RegExp(step.expect): isso deixaria descobertos espera sem envio, pausas, teclas e isolamento de processamento.

### Validação desta avaliação
Ran: 8 exemplos sintéticos positivos/negativos do padrão acima e 1 rejeição de sintaxe inválida em Node; passaram. Artefato: /tmp/nodeaccess-snippets-review/regex-proposal-check.json.
Manual: captura inspecionada, sem transcrever valor sensível. Leitura localizada de processExpectSendOutput, normalizeTerminalCommand e editor/matcher dos destaques.
Skipped: integração com terminal, testes de desempenho adversarial/Worker, ANSI fragmentado, desconexão/cancelamento e SSH real — implementação ainda não realizada.
Planned: esses testes, mais saída antiga, prompt já visível, prompt repartido, regex de match vazio, timeout, preservação de sufixo e ausência de envio após cancelamento.

## Revisão UX de 23/10
Removido resumo persistente do terminal a pedido do usuário. Controle compacto flutuante somente durante execução; resultado em notificação temporária sem empilhamento. Cobertura ampliada de executor e Playwright; evidências no diário de implementação.

## Revisão de falhas de 23/10
Corrigida renderização i18n ao selecionar Esperar e enviar; 59 testes específicos e Playwright de CRUD/execução/falhas. Cobertura inclui payload corrompido, concorrência, prompts duplicados, envio parcial, saída tardia, timeout da fila e falha do registro sem reenvio. Detalhes no diário.

## Ajuste complementar de ergonomia — preset do terminal
Aplicar preset agora também fecha/persiste a sugestão. Playwright dedicado simula Windows, macOS e Linux e verifica ausência após reload, sem reconexão no clique. Ver diário para evidências.

## Reavaliação após entrega — 2026-10-23
Cobertura funcional ampla, mas não equivalente a certificação com shell real. Foco recomendado: confiabilidade de output, simplicidade de edição e recuperação de rascunho, sem ampliar DSL.

| Prioridade | Esfera | Achado/recomendação | Evidência |
|---|---|---|---|
| Alta | Executor | Corrigir backspace entre chunks: normalização muda conforme fragmentação; pode causar matching diferente e timeout | MacroOutput.clean: bloco ab + backspace + c resulta ac; dividido entre ab e backspace+c resulta abc, reproduzido com a classe real transpilada |
| Alta | Validação operacional | Acrescentar ensaio SSH descartável com shell real, echo, prompts, perda de conexão e secrets de teste | Evidências atuais de navegador usam transporte simulado; não confundir envio com sucesso remoto |
| Média | Editor | Resumir/recolher passos e identificar explicitamente qual passo foi testado; amostra/resultado hoje globais | MacroStepEditor.vue renderiza todos os campos e usa sample/result únicos |
| Média | Descoberta | Adicionar exemplos MACRO e priorizar Comando/Macro para novos cadastros; manter leitura/edição legada | Lista de tipos contém quatro opções; templates não têm MACRO |
| Média | Cards | Reduzir ações/badges simultâneos; manter principal visível e mover secundárias para menu acessível | SnippetCard.vue mantém favorito/copiar/duplicar/editar/excluir junto com tipo/escopo/grupo/secrets/passos/autor |
| Média | Clareza | Prévia de macro deve rotular Enviar/Aguardar/Pausar/Tecla | deserializeSnippetCommand concatena conteúdos sem indicar ação em cada linha |
| Média | Rascunhos | Revisar proteção de reload/fechamento e desmontagem do painel; considerar rascunho temporário sem valores resolvidos | Página protege fechamento/rota e painel closeForm; não encontrado beforeunload nesses componentes |
| Média | Manutenção | Compartilhar estado/validação do formulário entre página e painel por extração localizada | Editor compartilhado, mas formulário/salvamento/confirmações ainda distribuídos; SnippetsView 1245 linhas |
| Baixa | Produto avançado | Adiar loops, condições, referências vivas e execução em background | Aumentam semântica e risco; não resolvem principais fricções atuais |

Capturas atuais de Novo snippet em 1440/390 inspecionadas; rodapé preservado e sem faixa preta. Editor longo e cards analisados por código nesta reavaliação. Nenhuma modificação de produto.

## Consolidação implementada após reavaliação
- MacroOutput aplica backspace também ao texto acumulado; executor rejeita matching assíncrono de snapshot alterado.
- MacroStepEditor usa identidade estável por passo e Recolher/Expandir; MacroWaitTest isola amostra/resultado e invalida resultados após edição.
- Dois modelos de ações disponíveis na página/painel: diagnóstico Linux e aguardar prompt. Prévia de ações rotulada em ambas as superfícies.
- Comando/Macro priorizados; formatos antigos agrupados sem remover compatibilidade. Cards da biblioteca usam menu Mais ações para duplicar/editar/excluir.
- useSnippetDraft compartilha proteção de descarte/reload e recuperação em memória após desmontagem, por usuário/tenant/superfície. Descarte explícito não recupera rascunho.
- snippet-form.service compartilha validação/regex; salvamento bloqueia chamadas concorrentes.
- Novo ensaio opt-in test:snippets:ssh usa OpenSSH/PTY Docker local descartável com executor real. Não constitui certificação browser→gateway→Vault→SSH integral.
- Sem loops, condicionais, referências vivas ou execução em background; não foram priorizados para esta entrega.
