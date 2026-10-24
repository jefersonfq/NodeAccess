# Terminal Macros — estado implementado (NA-0060)

Comandos simples, sequências e expect-send legados são preservados. Novas macros usam formato versionado macro-v1 no campo command, validado no shared/backend e pelo editor.
Passos: enviar texto (Enter padrão), esperar literal/regex com timeout, pausa e teclas Enter/Tab/Esc. Editor compartilhado na biblioteca/painel, reordenação acessível, cópia de passos, validação por etapa e teste de regex.
Execução por sessão, cancelamento, limites, fila explícita com até 20 macros e interrupção da fila em falha/desconexão. Inicialização por host aguarda executor. Resultado “concluído” é da rotina do cliente, não sucesso remoto.
Regex é avaliada em Worker terminável; timeout de processamento separado da espera. Buffer normalizado incrementalmente e limitado. Saída antiga não deve disparar respostas após novo envio.
Referências de secrets resolvidas no gateway existente; não armazenar valores. Nenhuma DSL livre, loops ou interpolação automática de capturas.
Clientes REST antigos recebem apenas formatos reconhecidos; clientes novos anunciam suporte pelo header X-NodeAccess-Snippet-Format: macro-v1. API legada não deve interpretar formato novo como texto de shell.
Biblioteca: favoritos/recentes locais por usuário/tenant; exportação portátil e importação pessoal com prévia e tratamento de falha parcial.
Relatório: progresso informado pelo cliente complementa metadata de eventos existentes, com escopo tenant/usuário/snippet/execução; não cria evento SENT quando não houve envio e não prova resultado remoto. Envio é melhor esforço.
Evidências, limitações e próximos ajustes: docs/changes/2026/10/NA-0060-snippets-review/implementation.md.
