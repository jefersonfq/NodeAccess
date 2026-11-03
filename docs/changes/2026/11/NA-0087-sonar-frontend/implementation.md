# NA-0087 — Registro da implementação

## Pedido e objetivo

Tratar os 165 achados frontend com rastreabilidade individual, correções reversíveis, testes/simulações e revisão visual. O usuário autorizou todos os achados e commits locais em branches separadas; não autorizou publicação por inferência.

## Implementação

Base SHA `3aa5513789d63ef24b3e268c5f2077fde7db616e`, branch `fix/NA-0087-20261103-sonar-frontend`, worktree `/tmp/nodeaccess-NA-0087`. Helpers de varredura linear e autômatos preservam gramática anterior de prompts/respostas, inclusive whitespace multiline. Parser de Include e Encryption passa a respeitar linhas. Validação de email, caminhos e texto evita retrocesso; computed de cache ordena cópia.

Labels de checkbox usam o próprio componente; seletores recebem nomes no input interno filtrável; campos nativos têm aria-label. Indicador de host é botão com estado, canvas remoto é application, botão de histórico mantém semântica nativa e métricas estáticas deixam a ordem Tab. Sem mudança de transporte, dependências, regras Sonar ou exclusão de backups.

Inventário: 77 ocorrências fixed e 88 context_reviewed em dispositions.json, com rationale/evidence/risk por ID. A revisão contextual não marca falsos positivos no servidor nem equivale a ausência no scanner. Casos de controles de terminal, exemplos, placeholders e ordenação determinística foram preservados após inspeção.

## Validação

Ran: 742 testes frontend, 7 testes dirigidos/adversariais, ESLint, typecheck/build, terminal-experience, snippets, platform-settings, auditoria em seis cenários, observabilidade, composição gráfica, importação Royal TS e manual. Evidências e comandos em test-results.md; 44 labels verificados individualmente por DOM. Manual: cinco capturas examinadas visualmente, textos de procedimento mantidos e hashes atualizados somente após checks.

Skipped: PTY real (nenhuma mudança de resize/transporte), produção e homologação humana. Planned: revisão independente e Sonar agregado pela integração. Falhas de preparação/fixture e suas correções estão documentadas, sem declarar primeira tentativa como passe.

## Recuperação

Reversão por commit local desta branch; grupos de até cinco correções lógicas. Nenhuma migração, dado de usuário, configuração persistente ou instalação externa foi modificada. Documentação da frente sincronizada exclusivamente para docs do projeto canônico, preservando mudanças de outras frentes.

## Pendências

Reanálise Sonar e revisão independente são da integração NA-0089; publicação/homologação humana não realizadas. Planilha de metas fica sob coordenação da frente principal para evitar escrita concorrente. Testes automáticos de nome/foco não substituem homologação com leitor de tela humano. Aviso de tamanho de chunk existente permanece, sem reduzir limite.

## Diário de interações

### 2026-11-03T14:10:00-03:00 — Escopo autorizado

Recebida atribuição dos 165 achados e autorização de tratar todos com branches/testes/prints. Criados plano e registro; nenhuma supressão/exclusão para diminuir score.

### 2026-11-03T14:42:00-03:00 — Revisão e validação

Inspeção DOM mostrou que label externo não nomeava NCheckbox e aria-label no NSelect raiz não chegava ao foco interno. Corrigida associação real e validada cada ocorrência. Classificadores lineares passaram testes adversariais e de equivalência; fluxos simulados, manual e revisão visual concluídos. Registradas 165 decisões e evidências sanitizadas; próximo passo é commits locais e revisão integrada, sem deploy.

### 2026-11-03T14:48:43-03:00 — Evidências finais e recuperação

Ampliado DOM para oito campos nativos e dois autocomplete. Os atributos username não eram encaminhados pelo NInput; corrigidos em input-props e verificados no input real. Totais finais: 78 fixed e 87 context_reviewed, 165 IDs únicos. Últimos testes de terminal, build, ESLint e manual passaram após esse ajuste; capturas finais revistas. Commits locais separados, sem publicação. Revisão independente reproduziu 28 testes dirigidos e DOM sem bloqueadores preliminares; integração ainda fará Sonar agregado. Sincronização documental canônica restrita à pasta NA-0087; documentos compartilhados do manual seguem pelo commit de integração para preservar concorrência.

### 2026-11-03T15:01:00-03:00 — Retorno do scanner integrado

Recebidos cinco alertas persistentes e três novos no harness. Refinados quatro labels para associação explícita for/id, preservando nomes e layout; canvas application mantido por representar superfície remota interativa, com histórico da correção anterior e contexto residual documentados. Removidos Function e busca de git via PATH no harness. Ran: parsing negativo/positivo, DOM por ocorrência com clique no label, snippets responsivo, teclado/encoding gráfico, lint e typecheck. Sem nova varredura local; próximo passo é integração e análise serial. A atualização suplementar não substitui nem apaga decisões anteriores.

### 2026-11-03T15:03:37-03:00 — Recuperação do harness

Encerrado processo órfão de tentativa antiga de screenshot. Cleanup de contexto/browser passa a executar finally; falha de captura injetada encerrou com exit 1 antes do timeout de 30 s, execução normal retornou exit 0. Sem alteração da aplicação. Git absoluto documentado como requisito WSL/Linux. Revisão visual do filtro mobile e fixtures concluída; próximo passo é aplicar este delta na integração serial.
