# Coleta dos ensaios existentes — NA-0155

Base: `28a77996deb4c004690e828c4a3a1f6dd292d198`. Execução nesta worktree, não no checkout principal.

## Decisão e implementação

Em 2026-11-04 (America/Sao_Paulo), após GO_WITH_RISKS da raiz e revisão do plano pelo agente backend, o coletor passou a exigir oito ensaios: frontend, table, terminal, platform, flows, ha, audit-input e highlight-budget. O gate existente importa a lista; nenhuma tolerância para ensaio ausente, retorno diferente de zero ou timeout foi introduzida. Timeouts, origem loopback, fingerprint, mapas, denominador e quatro limiares permanecem intactos.

HA e audit-input usam captura CDP na origem compartilhada. A auditoria acopla o helper antes da primeira navegação; o helper existente encerra a captura antes de fechar página/contexto/browser. O diretório de artefatos da auditoria agora aceita saída privada do coletor, validada com artifactPath antes de iniciar Chromium.

Highlight-budget continua executando integralmente seu browser, workers e editor Vue com servidor Vite próprio. Somente sua execução Node é coletada: não se atribui a origem de seu servidor à captura CDP da origem compartilhada. Os ensaios frontend/table preexistentes também não possuem hook CDP (table abre HTML local); seu metadado é node-only, sem promessa de captura inexistente. Terminal/platform/flows/ha/audit-input têm modo node-and-browser. Corpos de page.evaluate continuam sem crédito Node. O arquivo terminal-highlight-budget.mjs não precisou mudar.

As três listas de diagnóstico foram ampliadas somente para os nomes/basenames novos exatos. CI revalida coverageMode por enum, mantendo remoção de campos livres, caminhos, mensagens e nomes desconhecidos.

## Testes realmente executados

Com Node 24.22.1, `node --test tools/coverage/browser.test.mjs tools/coverage/run.test.mjs tools/coverage/harness-diagnostics.test.mjs tools/sonarqube/ci-coverage-diagnostics.test.mjs`: 65 contratos passaram após atualização das expectativas antigas de cinco para oito processos. Os novos negativos comprovam bloqueio em falha e ausência de cada novo ensaio, remoção de CDP para fixtures sem origem compatível, preservação de NODE_V8_COVERAGE, outputs privados e enum de diagnóstico sem campos livres.

ESLint estrito dos oito arquivos tooling alterados: zero erros/warnings. Logs privados: `/tmp/NA0155-tooling-tests.log` e `/tmp/NA0155-tooling-lint.log`. Primeira tentativa ocorreu antes de o link de dependências estar disponível e falhou importação; não foi considerada execução válida. A rodada seguinte identificou quatro expectativas antigas (quantidade/metadado), corrigidas explicitamente.

## Limites e próximo passo

Os testes unitários do coletor simulam subprocessos e servidor; não substituem execução real dos oito harnesses. Browser conjunto e medição oficial aguardam congelamento das fontes HA/SSR e coordenação da raiz. Ganho de cobertura não declarado antes medição. A revisão independente backend foi solicitada. Nenhuma alteração de produto, baseline, exclusão ou estado Sonar foi realizada. Planilha de planejamento e diário consolidado ficam sob responsabilidade do agente coordenador da frente/raiz.

## Ensaio real concluído

Em 2026-11-04T12:33:34–12:37:59-03:00, os oito harnesses completos passaram (265,486s), todos exit0 e sem timeout. Node24.22.1 e Chromium1234 local; NODE_V8_COVERAGE em coverage/node-v8 e capturaCDP em coverage/browser/chromium-v8. Foram produzidas12capturas/960scripts; quantidade não equivale a ganho de cobertura. Servidor127.0.0.1:42801 encerrado, conexão recusada apóscleanup. Resumo sanitizado em browser-rehearsal.json. HA7cenários findings[]; auditoria4grupos; budgetCPU1x/4x, workers e UI reais passaram.

O logger Vite registrou ResizeObserver loop completed with undelivered notifications duranteHA. O registro foi preservado; não foi declarado erro corrigido nem atribuído causalmente ao produto. Chromium1248 hospedado não foi reproduzido neste ensaio.

Revisão independente backend PASS_WITH_WARNINGS:65contratos reproduzidos e22browser.test finais apósmetadado, sembloqueador. O revisor não repetiu oito browsers nem medição ampla. Evidências privadas /tmp/NA0155-eight-browser.log e coverage/browser/*.log; arquivosfonte revisados constam tooling-source-digests.json. Fontecongelada durante todaexecução, nenhuma alteração de gate/baseline.
