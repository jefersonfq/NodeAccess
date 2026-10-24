# NA-0059 — Registro da implementação

## Pedido e objetivo
Avaliar e, após autorização, aplicar cards de acesso rápido mais enxutos; criar e executar os testes.

## Implementação
Base SHA: 66444a9dd4c167453004bb6089278548bdd2c0d9.
Branch: feat/NA-0059-quick-access-compact. Alterações preexistentes de outras frentes preservadas.
- apps/frontend/src/components/QuickAccessHostCard.vue: pasta junto ao IP seguida de relógio e data DD/MM, com tooltip por extenso e horário por mouse/foco/toque; toque não propaga conexão; Esc fecha; protocolo em SVG no canto superior direito do card, sem selo inferior; status ativo explícito; _root_ mascarado como Raiz; fallback responsivo e descrição acessível.
- tools/frontend/recent-host-access-playwright.cjs: testes novos de layout, redução de altura, tooltip, teclado, toque sem conectar, tablet, IPv6 e ausência de pasta. QUICK_ACCESS_ONLY=1 permite executar os cards sem recuperação de pastas; execução padrão mantém esse cenário. Seletor de lista respeita breakpoint de 1280px.
- docs/manual/hosts.md, manifest.json e docs/OPERATIONS-manual-pilot.md: orientação e revisão de Hosts, incluindo o componente no hash. Cinco capturas regeneradas pela rotina oficial e inspecionadas.
- Índice e documentos desta frente atualizados.

## Validação
- Ran: npm run typecheck --workspace @nodeaccess/frontend — passou.
- Ran: npx eslint apps/frontend/src/components/QuickAccessHostCard.vue --fix — passou após corrigir avisos de formatação, sem alteração funcional.
- Ran: FRONTEND_BASE=http://127.0.0.1:5173 PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser QUICK_ACCESS_ONLY=1 RECENT_HOST_SCREENSHOT_DIR=/tmp/nodeaccess-quick-access-after node tools/frontend/recent-host-access-playwright.cjs — passou em 1440/1024/390px, sem overflow horizontal ou erros de runtime nos cenários validados. Relatório: /tmp/nodeaccess-quick-access-after/report.json.
- Ran: npm run test:manual — 2 testes Node e 18 Vitest passaram.
- Ran: FRONTEND_BASE=http://127.0.0.1:5173 PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium-browser MANUAL_EXPECTED_VERSION=dev npm run manual:capture — passou, incluindo manual integrado, 60 estados de compartilhamento e dois ciclos de tenant sem reconexão.
- Ran: npm run manual:check-reviewed e git diff --check — passaram.
- Manual: capturas desktop, tablet, mobile e tooltip revisadas; cinco imagens do manual inspecionadas.
- Medição do mesmo card de referência: 1440px de 101,19 para 82px; 1024px de 121,19 para 119,59px; 390px de 121,19 para 102px. Evidências em /tmp/nodeaccess-quick-access-after/review-{1440,1024,390}.png.
- Limitações das tentativas: suíte completa falhou duas vezes aguardando sidebar-load-error na recuperação de pastas, fora do componente alterado; não corrigida nesta frente. Primeira captura do manual falhou por versão esperada padrão; reexecução com dev passou. Inclusão de tablet revelou seletor de lista desktop incompatível com breakpoint, corrigido antes da execução aprovada.
- Skipped: PTY real e suíte completa de experiência do terminal, pois não houve mudança em geometria do terminal ou transporte. O harness do manual executou apenas seus modos específicos.

## Recuperação
Reverter somente os arquivos desta frente por diff/PR; preservar alterações locais preexistentes. Sem migração, configuração ou dependência nova. Sem commit/publicação.

## Pendências
Falha do cenário de recuperação de pastas permanece registrada para investigação separada. Evidências de teste usam fixtures locais; não representam homologação em produção. Nenhuma pendência funcional conhecida nos cards; em largura estreita a pasta quebra linha e a redução de altura é menor.

## Diário de interações

### 2026-10-22T21:53:15.109Z — Avaliação solicitada
Pedido: avaliar compactação usando prints. Foram inspecionados componente e capturas com fixtures; o harness existente passou. A pasta ao lado do IP evita competir com o nome, mas exige fallback em cards estreitos. Próximo passo: implementar a proposta em etapa posterior, mantendo o status ativo visível e validando acessibilidade dos metadados.


### 2026-10-22T22:03:19.676Z — Implementação autorizada e testes
Usuário autorizou aplicar a proposta e gerar testes. Implementado layout compacto, ampliado harness e atualizado manual conforme skill nodeaccess-manual. Typecheck, lint, regressão focada, testes e capturas do manual passaram. Redução medida e capturas revisadas. Próximo passo: validação visual do usuário; commit e publicação não solicitados.


### 2026-10-22T22:09:26.901Z — Data curta, posição e máscara de raiz
Pedido: relógio e data após a pasta, protocolo à direita e _root_ como Raiz. Implementado no componente; HostsView fornece lastAccessedAt original nos quatro usos, sem tentar interpretar texto formatado. Data curta DD/MM; tooltip com mês por extenso, ano e horário; ausência/data inválida mostra travessão. Máscara apenas visual e traduções pt-BR/en, com título “Este host está no diretório raiz do inventário.”.
Arquivos: QuickAccessHostCard.vue, HostsView.vue, locales/pt-BR.json e en.json, harness de acessos recentes, capítulo e manifesto do manual, capturas oficiais, plano e registro.
Ran: typecheck frontend; eslint do componente; regressão focada QUICK_ACCESS_ONLY=1 em 1440/1024/390 px com asserções de data curta/longa, relógio adjacente à pasta, protocolo à direita, Raiz e título explicativo, além dos cenários anteriores; test:manual (2 Node + 18 Vitest); manual:capture com MANUAL_EXPECTED_VERSION=dev. Todos passaram. Capturas dos cards em /tmp/nodeaccess-quick-access-v2 e cinco capturas oficiais inspecionadas. Gate editorial e diff conferidos ao encerrar.
Limitações: suite de recuperação de pastas anteriormente falhou e não foi repetida nesta interação; nenhuma alteração nesse fluxo. Datas usam o fuso local do navegador, alinhado ao tooltip existente. Sem commit/publicação. Próximo passo: validação visual do usuário.


### 2026-10-22T22:12:14.518Z — Correção do identificador real da raiz
Usuário informou persistência de _root_ e perguntou pelos demais ajustes. Causa confirmada: tenant.repository.ts cria a raiz como __root__, mas a máscara e a fixture anterior usavam somente _root_. Reproduzido no Chromium local com cache desabilitado via CDP: antes Pasta: __root__, depois Pasta: Raiz e tooltip explicativo. Não atribuído a cache.
Correção localizada em QuickAccessHostCard.vue: aceitar ambos os identificadores após trim, mantendo nomes comuns intactos. Harness recent-host-access-playwright.cjs agora verifica as duas formas. Data junto à pasta e protocolo à direita revalidados.
Ran: typecheck frontend, lint do componente, git diff --check, regressão focada em 1440/1024/390px com ambas as formas da raiz, manual:capture (versão dev) e test:manual (2 Node + 18 Vitest); passaram. Capturas oficiais e raiz inspecionadas. Evidências: /tmp/nodeaccess-root-fix/report.json e root-8-mobile.png. Texto do capítulo permanece correto; hash revalidado e gate editorial executado ao encerrar.
Limitações: validação com API simulada usando identificador real confirmado no backend, sem inspeção da sessão pessoal do usuário. Recuperação de pastas fora da regressão focada, conforme registro anterior. Próximo passo: usuário conferir /hosts atualizado. Sem commit/publicação.


### 2026-10-22T22:16:56.621Z — Ícones SVG de protocolo
Usuário autorizou implementar a proposta de ícones para reduzir os cards. Criado HostProtocolIcon.vue, apresentação SVG sem dependências: SSH terminal/cadeado, RDP monitor, Telnet terminal/T e VNC monitor/V. QuickAccessHostCard.vue exibe ícone antes do nome com texto acessível e tooltip; foco no card mostra protocolo e último acesso, Esc fecha. Clique no ícone não propaga conexão. Selo e linha inferior removidos; sessão ativa continua visível.
Arquivos: componentes, quatro usos em HostsView.vue (remoção da prop obsoleta), traduções pt-BR/en, harness, capítulo de Hosts, manifesto, capturas e registros.
Ran: typecheck frontend; eslint dos dois componentes (ajustada anotação void, segunda execução sem avisos); regressão focada em 1440/1024/390px e quatro protocolos; manual:capture com versão dev; test:manual (2 Node + 18 Vitest); todos passaram. Capturas de quatro protocolos e cinco imagens oficiais inspecionadas. Evidências: /tmp/nodeaccess-protocol-icons/report.json e protocol-{ssh,rdp,telnet,vnc}.png. Cards de exemplo sem sessão ativa medidos em 62px, ante 82px na etapa anterior.
Manual atualizado, ícone incluído no hash de Hosts e gate editorial executado ao encerrar. Limitação anterior da recuperação de pastas permanece fora da regressão focada. Sem mudança em terminal/transporte, sem dependências, commit ou publicação. Próximo passo: conferir /hosts e tooltips na interface local.


### 2026-10-22T22:18:57.431Z — Protocolo à direita do nome
Pedido: mover ícones para a direita do nome. Reordenado o template de QuickAccessHostCard.vue para nome seguido de protocolo, com espaçamento existente e ícone sem encolher. Teste de geometria agora verifica ícone após o nome com distância máxima de 10px em três larguras. Tooltip, teclado e estado ativo preservados; cards de exemplo seguem em 62px.
Ran: lint do componente, git diff --check, regressão focada QUICK_ACCESS_ONLY=1 em 1440/1024/390px e quatro protocolos, manual:capture (dev), test:manual (2 Node + 18 Vitest); todos passaram. Captura desktop e cinco imagens oficiais inspecionadas. Evidências: /tmp/nodeaccess-protocol-right/report.json e hosts-home-desktop.png. Capítulo Hosts atualizado e hash revalidado; gate editorial conferido ao encerrar.
Skipped: novo typecheck, pois a alteração apenas reordenou elementos do template, sem mudar tipos ou lógica; validação anterior permanece registrada. Sem commit/publicação. Limitação anterior da recuperação de pastas inalterada. Próximo passo: usuário conferir o posicionamento.


### 2026-10-22T22:25:52.369Z — Revisão dos tooltips duplicados
Pedido: investigar impressão de dois tooltips no acesso rápido. Reproduzido em Chromium com cache desabilitado: hover no relógio seguido de foco no card deixou dois tooltips visíveis. Adicionalmente, title nativo repetia os conteúdos dos tooltips customizados.
Correção em QuickAccessHostCard.vue: estado único activeHint, title vazio nos gatilhos customizados, troca sem animações sobrepostas, fechamento ao apontar para nome/IP/pasta ou sair do card com mouse. Eventos PointerEvent distinguem mouse/toque; click de consulta não conecta e Esc fecha. Largura dos tooltips limitada ao viewport, corrigindo corte lateral observado na captura mobile.
Testes em recent-host-access-playwright.cjs verificam title vazio, hover+foco com somente uma dica, troca protocolo/horário, toque, teclado, geometria dentro do viewport, quatro protocolos e estados anteriores. Reprodução isolada passou de duas para uma dica visível.
Ran: regressão focada em 1440/1024/390px e quatro protocolos, lint, typecheck e git diff --check — aprovados. Manual:capture (dev) e test:manual (2 Node + 18 Vitest) passaram durante esta interação, antes do refinamento final de PointerEvent/largura; cinco imagens oficiais inspecionadas. Refinamento final validado pela regressão focada e captura mobile. Texto do manual continua correto; hash revalidado e gate editorial executado ao encerrar.
Tentativas intermediárias: duas execuções detectaram dica fechando após toque no mobile. Rastreamento mostrou eventos mouseleave de compatibilidade após click; corrigidos com PointerEvent ignorando hover/leave de touch. Reexecuções finais passaram. Evidências: /tmp/nodeaccess-tooltip-fix/report.json e clock-tooltip-mobile.png. Scripts temporários de diagnóstico removidos.
Limitações: fixtures locais; recuperação de pastas permanece fora da regressão focada conforme registro anterior. Sem alteração de transporte/terminal ou publicação. Próximo passo: conferir interação em /hosts.


### 2026-10-22T22:30:34.952Z — Caminho completo no tooltip da pasta
Pedido: mostrar raiz e subpastas, como Raiz → Banco de dados → Dbs. Criado utilitário host-folder-breadcrumb.ts com navegação por parentId, tradução da raiz, proteção contra ciclos e indicação de ancestral ausente. HostsView.vue usa mapas computados separados das árvores corporativa/pessoal já carregadas e passa folderPath nos quatro usos de QuickAccessHostCard.vue. Nome imediato no card permanece intacto; tooltip nativo existente recebe o caminho, sem duplicar dicas. Raiz mantém explicação existente.
Arquivos: utilitário e teste unitário, HostsView.vue, QuickAccessHostCard.vue, harness recent-host-access-playwright.cjs, capítulo/manifesto/capturas do manual e registros.
Ran: 4 testes unitários de breadcrumb; typecheck frontend; lint do componente/utilitário/teste; regressão focada em 1440/1024/390px, quatro protocolos, caminhos corporativo/pessoal e ancestral ausente; manual:capture (dev); test:manual (2 Node + 18 Vitest); todos passaram. Captura do fluxo e cinco imagens oficiais revisadas. Evidências: /tmp/nodeaccess-folder-path/report.json e folder-path-desktop.png. Gate editorial e diff conferidos ao encerrar.
Limitações: caminho depende da árvore autorizada carregada; ancestral ausente gera … → trecho conhecido, nó indisponível conserva apenas o nome recebido. Não mistura árvores nem faz chamadas extras. Recuperação de pastas fora da regressão focada, conforme registro anterior. Sem commit/publicação. Próximo passo: conferir o tooltip da pasta em /hosts.


### 2026-10-22T22:36:02.175Z — Protocolo no canto superior direito
Pedido: padronizar a posição do novo ícone SSH. Aplicado ml-auto no gatilho do protocolo em QuickAccessHostCard.vue, compartilhado por SSH/RDP/Telnet/VNC. Ícone permanece no canto superior direito com nomes curtos ou longos; tooltip e altura dos cards preservados. Harness valida distância das bordas superior/direita nos três viewports e quatro protocolos.
Ran: regressão focada QUICK_ACCESS_ONLY=1 em 1440/1024/390px, lint do componente, manual:capture (dev), test:manual (2 Node + 18 Vitest) e git diff --check; passaram. Captura desktop e cinco imagens oficiais inspecionadas. Evidências: /tmp/nodeaccess-protocol-corner/report.json e hosts-home-desktop.png. Capítulo Hosts atualizado e hash revalidado.
Skipped: novo typecheck, pois alteração apenas de classe CSS. Limitação anterior da recuperação de pastas permanece fora da regressão focada. Sem commit/publicação. Próximo passo: conferir posição em /hosts.
