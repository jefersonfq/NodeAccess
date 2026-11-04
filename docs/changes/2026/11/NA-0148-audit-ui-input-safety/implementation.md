# NA-0148 — Registro da implementação

## Pedido e objetivo

Corrigir achados comprovados da NA0145 e produzir evidência das lacunas de foco com testes, simulações e revisão de UX. Não alterar ledger, servidor Sonar, backend ou engine de destaques desta frente.

## Implementação

Base ee436402db8bcce7fab4378d6ba28c1673b282b5; branch fix/NA-0148-20261104-audit-ui-input-safety. Skills frontend-full-cycle-agent e nodeaccess-manual aplicadas. Plano GO_WITH_RISKS registrado antes das fontes.

DCS: limpeza e contagem percorrem o sufixo incompleto uma vez, preservando precedência dos tokens e as etapas OSC → DCS → demais controles. IPv6: parser nativo URL para endereço completo, feedback separado de prefixo incompleto e bloqueio antes do POST ao salvar. Playback: região somente leitura deixa de cancelar todas as teclas; foco visível explícito. Modo texto: foco visível inset, sem alterar dimensões. Canvas: mantém Tab/Escape remotos; Ctrl+Alt+Shift libera teclas pressionadas e foca botão local de retorno. Blur também libera teclas; hint descrito acessivelmente, apenas visível com foco, posicionamento superior não altera canvas ou resize.

## Validação

Ran: 38 testes Vitest nos dois helpers; 2.744 combinações diferenciais por operação e sufixo adversarial de 500.004 unidades UTF-16, incluindo Unicode. Lint focado e typecheck frontend passaram. Build frontend passou, com aviso de chunks grandes existente (limiar intacto).

Ran: browser focal Chromium1234/Vite isolado5198, API/WebSocket sintéticos, fonte Vue real: Tab/ShiftTab, setas/PageDown/Ctrl+C não cancelados, rolagem PageDown efetiva e clipboard do Chromium igual ao texto selecionado da fixture, playback não editável; Tab/Escape remotos, chord com keyups Control/Alt sem Shiftdown, blur libera caractere, saída em fullscreen/retorno; IPv6 incompleto não envia POST, inválido recebe feedback, IPv4-mapped aceito. Capturas desktop1440/mobile390 abertas e inspecionadas; primeiro hint inferior ficava fora da viewport, corrigido para topo e bounds verticais/horizontais agora verificados.

Ran: test:terminal-experience:web completo passou, incluindo novo teste modo texto (Tab, ShiftTab, Fechar, readonly e linhas/colunas invariáveis). manual:capture passou após configurar MANUAL_EXPECTED_VERSION=dev correspondente ao Vite; a tentativa inicial esperava a versão default de fixture e falhou, sem alterar asserção. Cinco imagens geradas foram abertas/revisadas. test:manual passou (2 Node + 18 Vitest); manual:check-reviewed passou nos cinco capítulos, hashes avançados apenas para hosts/terminal após revisão.

Ran: regressão existente session-playback-playwright passou desktop/mobile/estados e conteúdo de escala, mas falhou orçamento de cinco páginas (8.466ms > 6.000ms) durante concorrência com build. Falha preservada em /tmp/NA0148-scale-first-failure.json e /tmp/NA0148-playback.log; controle A/B único após término do build passou: baseline 4.753ms e atual 4.269ms na paginação. A concorrência é correlação, não causa demonstrada. Reexecução completa final passou em50,9s: open2.603ms/end140ms/lista1.138ms/páginas4.047ms,600comandos/1.787eventos. Sem mudança de limites ou asserções.

Skipped: leitor de tela real, combinações reservadas por SO, RDP/VNC/SSH reais nesta frente. Transporte simulado verifica mensagens Guacd geradas, não recepção por servidor. Não houve alteração de resize, WebSocket ou transporte SSH; teste PTY real adicional não é exigido pelo diff. Nenhuma homologação humana/publicação inferida.

## Recuperação

Frente isolada sem migração; reversão dos commits restaura os comportamentos anteriores. Preservar integração e alterações canônicas do usuário. NA0147 altera imports/função de exportação e destaques no mesmo arquivo de auditoria/TerminalPane; deltas são disjuntos e a integração deve preservar ambos. Manifesto terminal requer hash integrado após união.

## Pendências

Checkpoint local autorizado após checks finais; revisões independentes raiz/tooling passaram com limites. Integração/scanner e publicação permanecem responsabilidade coordenada da raiz. Root coordena planilha, índices, integração, scanner e publicação. resolution.json contém propostas de resolução, não status do servidor nem novas dispositions duplicadas. Adequação do role application com leitor de tela continua sem comprovação formal; não converter essa limitação em aceite humano.

## Diário de interações

### 2026-11-04T09:42:04-03:00 — Plano antes de implementação

Autorizada correção fim a fim. Inspecionados pontos de código e capítulos mapeados, delimitado impacto e matriz de validação. Plano enviado à raiz antes de alterações de produto; nenhuma homologação presumida.

### 2026-11-04T10:14:00-03:00 — Implementação e evidências

Prova browser anterior mostrou Tab preso no playback e Tab/Escape retidos no canvas. Implementadas correções localizadas, com testes acima. Revistas capturas e ajustado apenas posicionamento da dica mobile. Manual atualizado e revalidado. A falha de escala permanece explícita para controle A/B; nenhuma regra ou timeout foi reduzido. Revisão independente solicitada à raiz/tooling; planilha e publicação continuam coordenadas pela raiz.

### 2026-11-04T10:17:00-03:00 — Controle de escala e revisão final

A/B único e suíte completa final passaram, com falha inicial preservada e sem atribuir causalidade à carga concorrente. Raiz revisou foco/canvas/IPv6 sem bloqueio aparente; corrigida somente indentação de @paste.prevent, comprovando JavaScript do template compilado byteidêntico. Cinco capturas do manual e evidências finais foram abertas e avaliadas. Raiz reproduziu independentemente38testes e revisou helpers/foco com PASS_WITH_WARNINGS (APIWS sintético/AT não formal). Tooling reproduziu38/38 e revisou os deltas com PASS_WITH_WARNINGS; nenhuma afirmação de scanner ou AT formal.

### 2026-11-04T10:23:21-03:00 — Revisão independente e estado encerrado

Tooling reproduziu38/38 em /tmp/NA0148-independent.log e revisou helpers/integrações/canvas: PASS_WITH_WARNINGS. Revisão não repetiu browser/manual/PTY; atribuição mantida ao autor. Acrescentadas somente duas guardas de visibilidade status connected para hint/botão Retomar. Browser final RRNSS5 passou incluindo mensagem closed, ação oculta e nenhuma tecla enviada. Blur validado é perda de foco DOM; não há nova garantia sobre Alt-Tab/window.blur/visibilitychange. Lint final passou; build/tipos final passou (build47,33s, aviso legado de tamanho de chunk preservado). Raiz e tooling revisaram as duas guardas sem bloqueio.

### 2026-11-04T11:53:32-03:00 — Ajuste incremental de tipagem do matcher

Lint integrado estrito identificou no-unsafe-assignment no retorno any de expect.any(String) no teste IPv6. Sobre baseca69c83f24f3e55d9f2b98714d5f3a47dbcd0a1b, acrescentado somente cast unknown ao matcher; todas as asserções e comportamento preservados. Emissão JavaScript comparada com a base: byte-idêntica. Ran:34/34 testes IPv6PASS, ESLint arquivo commax-warnings0:0erros0warnings, gitdiffcheckPASS. Nenhum produto, integração, baseline ou regra alterado; sem necessidade de repetir browser/PTY para mudança exclusivamente de tipo emteste. Evidências privadas /tmp/NA0148-ipv6-lint-tests.log e /tmp/NA0148-ipv6-lint.log. Próximo: raiz aplicar checkpoint incremental e repetir gates integrados.
