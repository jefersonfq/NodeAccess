# NA-0147 — Registro da implementação

## Pedido e objetivo
Executar correção SQ-0069 e isolamento real de regex dos destaques.

## Implementação
Base ee436402db8bcce7fab4378d6ba28c1673b282b5; branch fix/NA-0147-20261104-terminal-highlight-budget. Plano antes de produto. Escopo inclui consumidores adicionais para não deixar caminho síncrono vulnerável.

## Validação
Ran: baseline 63 testes; suíte final 108 testes em 6 arquivos; revisão independente 84 testes PASS. Browser real, terminal completo, 15 jornadas de destaques, manual, typecheck e build validados conforme test-results.md. Prova anterior NA0145 não substitui estes ensaios.

## Recuperação
Sem migração/transporte; reversão reintroduz risco. Dependências compartilhadas somente leitura.

## Pendências
Implementação e revisão técnica concluídas localmente. Integração, cobertura/Sonar conjuntos, homologação humana, publicação e atualização da planilha de planejamento permanecem com a raiz; não inferidos destes testes.

## Diário de interações

### 2026-11-04T09:40:54-03:00 — Planejamento
Usuário autorizou correções e simulações. Raiz atribuiu NA0147. Revisão encontrou seis consumidores adicionais do matcher além do terminal; propõe migração conjunta para evitar falsa proteção. Nenhuma fonte de produto alterada neste ponto.

### 2026-11-04T09:40:57-03:00 — Baseline e revisão de arquitetura
Horário corrigido pelo mtime do log de execução; o horário 06:42 registrado anteriormente era incorreto. Ran:63 testes dirigidos PASS, fonte ainda ee436. Raiz aprovou alcance de todos consumidores e pediu limite de workers; adotado um Worker compartilhado com fila limitada, latest-wins, isolamento de falha e descarte. Skillfrontend/manual lidas; fluxo mapeado do terminal terá revalidação editorial e estado de timeout documentado. Matriz inclui saturação, justiça e CPU lento. Aguardando GO técnico final antes de produto.

### 2026-11-04T10:19:40-03:00 — Isolamento e revisão adversarial
Ran: baseline63/3; contratos iniciais85/4 e depois104/6 PASS, typecheckfrontend e buildVite7 PASS. Terminalexperience completo PASS, highlights15jornadas PASS após harness esperar cores reais assíncronas semrelaxarasserções. Manualcapture3fluxos PASS com MANUAL_EXPECTED_VERSION=dev, cincoPNGs reais revistos. Primeiro manualcapture falhou porversiondefaultfixture9.8.7, corrigida variável doensaiodev semmudarpadrão. Primeiropreviewbrowser revelou DataCloneError comproxyVue, corrigido snapshotdeprimitivos e regressão reactive+structuredClone. Harness isolado tinha duasinstânciasVue porimportcachehardcoded; corrigido virtualmodule comgrafoViteúnico.
Revisão raiz identificou zero-widthUnicode e ordemexecantesquota; corrigidos avançoporcodepoint e condiçãoquotaantesexec, comcontrato. Prova adicional revelou targetWorker persistindo2s: CPUmedida0.57s após0.5s e2.07s após2.3s, consistentecomfonteprimáriaChromium. Raiz aprovou suspensãoGLOBALdefinitivaapósprimeirotimeout/falha, semrecriarporconfigouowner; semhardCPU50claim. Cancelamento comum aguarda mesmojob ouwatchdogparaevitaracúmuloanteriora50ms. Plano atualizado; ensaio final distingue resposta50ms e teardownfísico comjanela diagnóstica5s, sem aumentar timeoutdeexecução.
Fonte primária: https://chromium.googlesource.com/chromium/src/+/494419358caf690316f160a1f27d9e771a14c033/third_party/blink/renderer/core/workers/worker_thread.cc .

### 2026-11-04T10:30:16-03:00 — Revisão final e circuito permanente
Ran: browser real Chromium151 com CPU1x/4x PASS; respostas53/55ms, um único Worker por página, dez reconfigurações e novo consumidor rejeitados após timeout, teardown físico observado em2005/2007ms. Editor real desktop/mobile continua respondendo e informa revisar/salvar/recarregar; reload restaura destaques. Prints em evidence/. Telemetria corrigida após revisão da raiz: nenhuma duração inventada em startup/capacidade/input-limit; quatro negativos PASS. Revisão independente frontend:84/84 PASS, sem bloqueador, com limitações de CPU residual e mocks explicitadas. Nenhum scanner/VPS/SSH real executado nesta frente. Manual final integrado e planilha serão revalidados pela raiz; não alegar homologação humana.

### 2026-11-04T10:47:31-03:00 — Estado de suspensão visível no terminal
Revisão da raiz encontrou aviso restrito ao popover/title. Corrigido rótulo visível **Destaques · pausados**, sem faixa adicional, mantendo controles e área útil. Manual explica o rótulo. Ran: terminal-experience completo PASS com regex adversarial real no shell, popover fechado, geometria idêntica, input registrado após timeout e botão dentro viewport390px; prints desktop/mobile inspecionados. Primeiras duas tentativas não acionavam matcher porque a fixture permanecia em alternate buffer do htop, corretamente ignorado pelo produto; cenário passa a emitir saída1049l antes da linha adversarial, sem mudar timeout/política. Lint focal e vue-tsc PASS. Revisão frontend do delta: PASS_WITH_WARNINGS, sem repetir browser; execução browser atribuída ao autor. Raiz repetirá manual/capturas/hashes conjuntos após integração.
