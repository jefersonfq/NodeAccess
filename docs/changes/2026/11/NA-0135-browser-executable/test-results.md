# NA-0135 — Validações

Base b76faaec6031f3ebed1372a65dcede08f930cde0; execução em /tmp/nodeaccess-NA-0135.

- Ran: regressão antes da correção: duas variantes sem override (ausente/vazio) FAIL, override explícito PASS. Orquestrador real com servidor e executor de fixture; prova ausência de propagação, não ausência física do binário no runner. /tmp/NA0135-before.log.
- Ran: 17 contratos browser PASS após correção. Mesmo caminho enviado aos cinco filhos, override preservado, CHROMIUM_PATH externo conflitante ignorado, vazio usa gerenciado. /tmp/NA0135-after.log.
- Ran: negativo com Playwright real e caminho explícito inexistente rejeitado, primeiro harness failed e servidor encerrado, sem fallback.
- Ran: ESLint dois arquivos zero erros/warnings; diff-check limpo.
- Ran: cinco harnesses reais PASS com Chromium1234 explícito: frontend44labels+10nativos, tabela, terminal completo, plataforma e seis cenários de flows. Todos exit0/semtimeout e encerramento do servidor; browser-summary.json. Capturas privadas em coverage/browser de cada harness.
- Ran: raiz reproduziu17/17 contratos e revisou fonte PASS_WITH_WARNINGS; /tmp/na0135-root-review.log. Próximo: rerunCI integrado com instalação1248 gerenciada.

## Limites e atribuição

WSL possui /usr/bin/chromium-browser, mas não possui Chromium1248 requerido pelo pacote instalado. Não removemos binários nem alteramos máquina para simular GitHub. A falha histórica GitHub ocorreu antes de LCOV, e rawcoverage.log foi apagado; incompatibilidade com fallback de sistema é causa provável, não confirmação retroativa. O defeito de propagação default foi reproduzido em contrato. A prova do executável gerenciado1248 instalado pelo workflow depende de rerun CI integrado.

Nenhum timeout, requisito, mapa, denominador, componente ou baseline foi alterado. Testes não creditam page.evaluate como execução Node. Apenas seleção de executável no opt-in coletor.
